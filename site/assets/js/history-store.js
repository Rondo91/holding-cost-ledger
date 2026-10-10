/**
 * history-store.js — 本地账本存储（注入式 storage，纯逻辑可单测）
 *
 * 账本数据只存在用户浏览器的 localStorage 里：不上传、不联网、无任何同步路径。
 * 这是隐私承诺的一部分（v2.0 起从「不保存你填的数字」精确化为
 * 「你主动记入账本的记录只存在你的浏览器里」），由架构保证而非口头承诺。
 *
 * 所有函数第一个参数收 { getItem, setItem, removeItem } 适配层：
 * 浏览器里传 localStorage（app.js 会包一层 try/catch），单测里传内存实现。
 *
 * 容错原则：任何存储异常都不允许打断计算主流程——账本失败最多是「没记上」。
 */

import { baseResult } from './calc.js';

export const HISTORY_KEY = 'hcb_history';
export const HISTORY_CORRUPT_KEY = 'hcb_history_corrupt';
export const SCHEMA_VERSION = 2;

/** 软上限。超限不自动删除（账本数据绝不静默删），提示用户导出后手动清理 */
export const MAX_RECORDS = 200;

function newRecordId() {
  try {
    if (globalThis.crypto?.randomUUID) return `rec-${globalThis.crypto.randomUUID()}`;
  } catch { /* 某些环境禁用了 crypto */ }
  return `rec-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

/* ------------------------------------------------------------------ *
 * 记录归一化
 * ------------------------------------------------------------------ */

/** 残值三种形态：null / number / [a, b]（与 calc.js 的 secondHand 一致） */
function normalizeResidual(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const raw = v.map(Number);
    if (raw.length !== 2 || !raw.every(Number.isFinite)) return null;
    return [Math.min(raw[0], raw[1]), Math.max(raw[0], raw[1])];
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidRecordShape(r) {
  return Boolean(
    r && typeof r === 'object'
    && typeof r.id === 'string' && r.id.length > 0
    && r.input && typeof r.input === 'object'
    && typeof r.input.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.input.purchaseDate)
    && Number.isFinite(Number(r.input.price)) && Number(r.input.price) > 0
  );
}

function normalizeRecord(r) {
  return {
    id: r.id,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : (r.createdAt || ''),
    input: {
      deviceName: typeof r.input.deviceName === 'string' ? r.input.deviceName.slice(0, 60) : '',
      purchaseDate: r.input.purchaseDate,
      price: Number(r.input.price),
      category: typeof r.input.category === 'string' && r.input.category ? r.input.category : 'other',
    },
    residual: normalizeResidual(r.residual),
    snapshot: (r.snapshot && typeof r.snapshot === 'object') ? r.snapshot : null,
  };
}

/** 判重键：同一台设备 = 设备名 + 购买日期 + 实付金额 三者一致 */
function recordIdentity(record) {
  const name = (record.input.deviceName || '').trim();
  return `${name}\u0000${record.input.purchaseDate}\u0000${record.input.price}`;
}

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

/**
 * @returns {{ version: number, records: object[], corrupt: boolean, readonly: boolean }}
 *   corrupt：本次读取发现数据损坏，原文已转移到 hcb_history_corrupt 留档并重置
 *   readonly：账本由更高 schema 版本创建（用户回滚到旧版页面），只读不写
 */
export function loadHistory(storage) {
  let raw = null;
  try { raw = storage.getItem(HISTORY_KEY); } catch { raw = null; }
  if (raw === null || raw === '') {
    return { version: SCHEMA_VERSION, records: [], corrupt: false, readonly: false };
  }

  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.records)) {
    // 损坏：原文隔离留档后重置。绝不静默丢弃——用户可以从留档键里自己找回
    try { storage.setItem(HISTORY_CORRUPT_KEY, raw); } catch { /* 留档也失败就只能放弃 */ }
    return { version: SCHEMA_VERSION, records: [], corrupt: true, readonly: false };
  }

  const version = Number.isFinite(parsed.version) ? parsed.version : 1;
  return {
    version,
    records: parsed.records.filter(isValidRecordShape).map(normalizeRecord),
    corrupt: false,
    readonly: version > SCHEMA_VERSION,
  };
}

function persist(storage, records) {
  // Quota 等异常向上抛，由调用方翻译成用户能懂的提示
  storage.setItem(HISTORY_KEY, JSON.stringify({ version: SCHEMA_VERSION, records }));
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */

/**
 * 记入账本。同名同日期同金额视为同一台设备 → 更新而不是新增。
 * @returns {{ ok: boolean, id?: string, updated?: boolean, full?: boolean, reason?: string }}
 *   reason: 'readonly'（高版本数据保护）| 'full'（达到软上限，拒绝新增）
 *         | 'quota'（写入失败）| 'invalid_input' | 'storage'（读取失败）
 */
export function saveToHistory(storage, { input, residual = null, snapshot = null } = {}) {
  let history;
  try { history = loadHistory(storage); } catch { return { ok: false, reason: 'storage' }; }
  if (history.readonly) return { ok: false, reason: 'readonly' };
  if (!input || typeof input.purchaseDate !== 'string' || !(Number(input.price) > 0)) {
    return { ok: false, reason: 'invalid_input' };
  }

  const now = new Date().toISOString();
  const incoming = {
    input: {
      deviceName: typeof input.deviceName === 'string' ? input.deviceName.slice(0, 60) : '',
      purchaseDate: input.purchaseDate,
      price: Number(input.price),
      category: (typeof input.category === 'string' && input.category && input.category !== 'auto')
        ? input.category
        : 'other',
    },
  };

  const existing = history.records.find((r) => recordIdentity(r) === recordIdentity(incoming));
  if (existing) {
    existing.residual = normalizeResidual(residual);
    existing.snapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    existing.input.category = incoming.input.category;
    existing.updatedAt = now;
    try { persist(storage, history.records); } catch { return { ok: false, reason: 'quota' }; }
    return { ok: true, id: existing.id, updated: true, full: history.records.length >= MAX_RECORDS };
  }

  if (history.records.length >= MAX_RECORDS) {
    return { ok: false, reason: 'full', full: true };
  }

  const record = {
    id: newRecordId(),
    createdAt: now,
    updatedAt: now,
    input: incoming.input,
    residual: normalizeResidual(residual),
    snapshot: snapshot && typeof snapshot === 'object' ? snapshot : null,
  };
  const records = [record, ...history.records];
  try { persist(storage, records); } catch { return { ok: false, reason: 'quota' }; }
  return { ok: true, id: record.id, updated: false, full: records.length >= MAX_RECORDS };
}

/** 删除单条 */
export function deleteFromHistory(storage, id) {
  let history;
  try { history = loadHistory(storage); } catch { return { ok: false, removed: 0 }; }
  if (history.readonly || typeof id !== 'string') return { ok: false, removed: 0 };

  const records = history.records.filter((r) => r.id !== id);
  if (records.length === history.records.length) return { ok: true, removed: 0 };
  try { persist(storage, records); } catch { return { ok: false, removed: 0, reason: 'quota' }; }
  return { ok: true, removed: 1 };
}

/** 清空账本（removeItem 而非写空数组——数据少一层残留） */
export function clearHistory(storage) {
  let history;
  try { history = loadHistory(storage); } catch { return { ok: false, removed: 0 }; }
  if (history.readonly) return { ok: false, removed: 0 };
  const removed = history.records.length;
  try { storage.removeItem(HISTORY_KEY); } catch { return { ok: false, removed: 0 }; }
  return { ok: true, removed };
}

/** 导出为 JSON 字符串（备份用；localStorage 会被清浏览器数据连带清掉） */
export function exportHistoryJSON(storage) {
  let history;
  try { history = loadHistory(storage); } catch { history = { records: [] }; }
  return JSON.stringify({
    app: 'holding-cost-ledger',
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    records: history.records,
  }, null, 2);
}

/* ------------------------------------------------------------------ *
 * 排行
 * ------------------------------------------------------------------ */

/**
 * 按今天的日期重算各台设备的日均购置成本并排序（降序）。
 * 账本的心智是「每天翻开，数字是今天的」：快照里的日均是记录那天的数，
 * 各条记录的快照日期不同，按快照排行没有可比性。
 *
 * @returns {Array<{ record, days, daily }>} 按日均从高到低
 */
export function rankByDaily(records, calcDate = new Date()) {
  const entries = (Array.isArray(records) ? records : [])
    .map((record) => {
      const base = baseResult({
        price: record.input.price,
        purchaseDate: record.input.purchaseDate,
        calcDate,
      });
      return base ? { record, days: base.days, daily: base.dailyAmortized } : null;
    })
    .filter(Boolean);
  entries.sort((a, b) => b.daily - a.daily);
  return entries;
}
