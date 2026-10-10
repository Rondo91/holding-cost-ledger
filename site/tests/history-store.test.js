import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY_KEY, HISTORY_CORRUPT_KEY, SCHEMA_VERSION, MAX_RECORDS,
  loadHistory, saveToHistory, deleteFromHistory, clearHistory,
  exportHistoryJSON, rankByDaily,
} from '../assets/js/history-store.js';

/* ------------------------------------------------------------------ *
 * 内存 storage（注入式，模拟浏览器 localStorage）
 * ------------------------------------------------------------------ */

function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => map,
  };
}

/** setItem 一律抛错（模拟配额耗尽 / 隐私模式） */
function quotaStorage() {
  const inner = memStorage();
  return {
    getItem: inner.getItem,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: inner.removeItem,
  };
}

const INPUT = { deviceName: 'iPhone 13', purchaseDate: '2023-06-01', price: 4999, category: 'phone' };
const SNAPSHOT = {
  calcDate: '2026-10-09', days: 1227, dailyAmortized: 4.07,
  hasResidual: false, netSpend: null, dailyNet: null, recovery: null,
};

test('保存 → 读取往返一致', () => {
  const s = memStorage();
  const out = saveToHistory(s, { input: INPUT, residual: 2000, snapshot: SNAPSHOT });
  assert.equal(out.ok, true);
  assert.equal(out.updated, false);

  const h = loadHistory(s);
  assert.equal(h.corrupt, false);
  assert.equal(h.readonly, false);
  assert.equal(h.records.length, 1);
  const r = h.records[0];
  assert.equal(r.input.deviceName, 'iPhone 13');
  assert.equal(r.input.purchaseDate, '2023-06-01');
  assert.equal(r.input.price, 4999);
  assert.equal(r.input.category, 'phone');
  assert.equal(r.residual, 2000);
  assert.deepEqual(r.snapshot, SNAPSHOT);
  assert.ok(r.id.startsWith('rec-'));
  assert.ok(r.createdAt && r.updatedAt);
});

test('空库读取返回空数组且无损坏标记', () => {
  const h = loadHistory(memStorage());
  assert.deepEqual(h.records, []);
  assert.equal(h.corrupt, false);
  assert.equal(h.readonly, false);
});

test('判重：同名同日期同金额 → 更新而不是新增', () => {
  const s = memStorage();
  saveToHistory(s, { input: INPUT, residual: null });
  const out = saveToHistory(s, { input: INPUT, residual: 2500, snapshot: SNAPSHOT });
  assert.equal(out.ok, true);
  assert.equal(out.updated, true);

  const h = loadHistory(s);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].residual, 2500);
  assert.deepEqual(h.records[0].snapshot, SNAPSHOT);
});

test('判重键忽略设备名首尾空格；价格不同视为两台设备', () => {
  const s = memStorage();
  saveToHistory(s, { input: INPUT });
  const padded = saveToHistory(s, {
    input: { ...INPUT, deviceName: `  ${INPUT.deviceName}  ` },
  });
  assert.equal(padded.updated, true);   // trim 后同名 → 更新

  const other = saveToHistory(s, { input: { ...INPUT, price: 5999 } });
  assert.equal(other.updated, false);
  assert.equal(loadHistory(s).records.length, 2);
});

test('category 为 auto 或缺失时落库为 other，不再保留 auto', () => {
  const s = memStorage();
  saveToHistory(s, { input: { ...INPUT, category: 'auto' } });
  saveToHistory(s, { input: { ...INPUT, deviceName: 'X', category: undefined } });
  const h = loadHistory(s);
  assert.equal(h.records[0].input.category, 'other');
  assert.equal(h.records[1].input.category, 'other');
});

test('残值区间自动归一 [a,b]，非法残值归 null', () => {
  const s = memStorage();
  saveToHistory(s, { input: INPUT, residual: [2500, 2000] });
  assert.deepEqual(loadHistory(s).records[0].residual, [2000, 2500]);

  saveToHistory(s, { input: INPUT, residual: 'garbage' });
  assert.equal(loadHistory(s).records[0].residual, null);
});

test('单条删除 / 清空', () => {
  const s = memStorage();
  const a = saveToHistory(s, { input: INPUT });
  saveToHistory(s, { input: { ...INPUT, price: 3000 } });

  const del = deleteFromHistory(s, a.id);
  assert.deepEqual(del, { ok: true, removed: 1 });
  assert.equal(loadHistory(s).records.length, 1);

  const cleared = clearHistory(s);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed, 1);
  assert.deepEqual(loadHistory(s).records, []);
  assert.equal(s.getItem(HISTORY_KEY), null);   // removeItem 而非写空数组
});

test('损坏 JSON：原文转移到留档键，账本重置，corrupt 置位', () => {
  const s = memStorage();
  saveToHistory(s, { input: INPUT });
  const rawBefore = s.getItem(HISTORY_KEY);
  s.setItem(HISTORY_KEY, '{oops 不是 JSON');

  const h = loadHistory(s);
  assert.equal(h.corrupt, true);
  assert.deepEqual(h.records, []);
  assert.equal(s.getItem(HISTORY_CORRUPT_KEY), '{oops 不是 JSON');   // 留档
  assert.equal(s.getItem(HISTORY_KEY), '{oops 不是 JSON');            // 原键不动，下次保存时覆盖

  // 损坏后可以继续保存（覆盖损坏数据，留档仍可找回）
  const out = saveToHistory(s, { input: INPUT });
  assert.equal(out.ok, true);
  assert.equal(loadHistory(s).records.length, 1);
  assert.ok(rawBefore.length > 0);
});

test('畸形记录被过滤，不拖垮整个账本', () => {
  const s = memStorage();
  saveToHistory(s, { input: INPUT });
  const parsed = JSON.parse(s.getItem(HISTORY_KEY));
  parsed.records.push(
    { id: 'bad1', input: { purchaseDate: '2024-01-01' } },                    // 缺 price
    { id: 'bad2', input: { purchaseDate: '不是日期', price: 100 } },          // 日期畸形
    null,
  );
  s.setItem(HISTORY_KEY, JSON.stringify(parsed));

  const h = loadHistory(s);
  assert.equal(h.records.length, 1);
  assert.equal(h.records[0].id, parsed.records[0].id);
});

test('更高 schema 版本：只读不写（防回滚损坏数据）', () => {
  const s = memStorage();
  s.setItem(HISTORY_KEY, JSON.stringify({
    version: SCHEMA_VERSION + 1,
    records: [{
      id: 'rec-future', createdAt: '2027-01-01T00:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z',
      input: { deviceName: '未来设备', purchaseDate: '2026-01-01', price: 1000, category: 'phone' },
      residual: null, snapshot: null,
    }],
  }));

  const h = loadHistory(s);
  assert.equal(h.readonly, true);
  assert.equal(h.records.length, 1);   // 数据仍可展示

  assert.equal(saveToHistory(s, { input: INPUT }).reason, 'readonly');
  assert.equal(deleteFromHistory(s, 'rec-future').ok, false);
  assert.equal(clearHistory(s).ok, false);
});

test('配额耗尽：保存失败但不抛错，返回 quota 原因', () => {
  const s = quotaStorage();
  const out = saveToHistory(s, { input: INPUT });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'quota');
});

test('软上限 200 条：超限拒绝新增（绝不静默删），更新不受限', () => {
  const s = memStorage();
  const first = saveToHistory(s, { input: INPUT });
  assert.equal(first.full, false);

  for (let i = 1; i < MAX_RECORDS; i++) {
    saveToHistory(s, { input: { ...INPUT, deviceName: `设备 ${i}`, price: 1000 + i } });
  }
  assert.equal(loadHistory(s).records.length, MAX_RECORDS);

  const rejected = saveToHistory(s, { input: { ...INPUT, deviceName: '第 201 台', price: 99999 } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'full');
  assert.equal(loadHistory(s).records.length, MAX_RECORDS);   // 没有静默删旧记录

  const update = saveToHistory(s, { input: INPUT, residual: 1234 });
  assert.equal(update.ok, true);   // 已有记录的更新不受上限限制
  assert.equal(update.updated, true);
});

test('非法输入拒绝保存', () => {
  const s = memStorage();
  assert.equal(saveToHistory(s, {}).reason, 'invalid_input');
  assert.equal(saveToHistory(s, { input: { purchaseDate: '2024-01-01' } }).reason, 'invalid_input');
  assert.equal(saveToHistory(s, { input: { purchaseDate: '2024-01-01', price: 0 } }).reason, 'invalid_input');
});

test('导出：结构含 app 标识、版本、导出时间与全部记录', () => {
  const s = memStorage();
  saveToHistory(s, { input: INPUT, residual: 2000 });
  const parsed = JSON.parse(exportHistoryJSON(s));
  assert.equal(parsed.app, 'holding-cost-ledger');
  assert.equal(parsed.version, SCHEMA_VERSION);
  assert.ok(typeof parsed.exportedAt === 'string' && parsed.exportedAt);
  assert.equal(parsed.records.length, 1);
});

/* ------------------------------------------------------------------ *
 * 排行：按今天重算
 * ------------------------------------------------------------------ */

const T = '2026-10-09';

function makeRecord(id, name, date, price) {
  return {
    id, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    input: { deviceName: name, purchaseDate: date, price, category: 'other' },
    residual: null, snapshot: null,
  };
}

test('rankByDaily 按今日日均降序，快照不参与排序', () => {
  const records = [
    makeRecord('a', '贵的新机', '2026-04-09', 6000),    // 半年 → 日均 ~32.97
    makeRecord('b', '便宜的老机', '2021-10-09', 2000),  // 五年 → 日均 ~1.10
    makeRecord('c', '中档', '2025-10-09', 3650),        // 一年 → 日均 10.00
  ];
  const ranked = rankByDaily(records, T);
  assert.deepEqual(ranked.map((e) => e.record.id), ['a', 'c', 'b']);
  assert.equal(ranked[2].daily, 2000 / 1827);   // 2021-10-09 → 2026-10-09 含当天
});

test('rankByDaily 过滤无法计算的记录（畸形日期），空数组安全', () => {
  const records = [
    makeRecord('ok', '正常', '2025-10-09', 3650),
    makeRecord('bad', '畸形', 'not-a-date', 1000),
  ];
  const ranked = rankByDaily(records, T);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].record.id, 'ok');
  assert.deepEqual(rankByDaily([], T), []);
  assert.deepEqual(rankByDaily(null, T), []);
});
