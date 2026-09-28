import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toLocalDate,
  holdingDays,
  baseResult,
  fullResult,
  isPayback,
  netZone,
} from '../assets/js/calc.js';

// 固定基准日期，避免测试随运行日期漂移
const T = '2025-01-01';

test('toLocalDate 接受合法日期，拒绝不存在与畸形日期', () => {
  assert.equal(toLocalDate('2024-01-01').getFullYear(), 2024);
  assert.equal(toLocalDate('2024-01-01').getMonth(), 0);
  assert.equal(toLocalDate('2024-01-01').getDate(), 1);

  // 2 月 31 日会被 Date 自动进位，必须拦住
  assert.equal(toLocalDate('2026-02-31'), null);
  assert.equal(toLocalDate('2026-13-01'), null);
  assert.equal(toLocalDate('随便写的'), null);
  assert.equal(toLocalDate(''), null);
  assert.equal(toLocalDate(null), null);
  assert.equal(toLocalDate(undefined), null);

  assert.equal(toLocalDate(new Date('invalid')), null);
});

test('toLocalDate 把时间戳归一到本地零点', () => {
  const d = toLocalDate(new Date(2024, 5, 15, 23, 59, 59));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
  assert.equal(d.getMilliseconds(), 0);
});

test('holdingDays 含购买当天，当天购买记 1 天', () => {
  assert.equal(holdingDays('2025-01-01', T), 1);
});

test('holdingDays 按自然日计算，跨闰年正确', () => {
  // 2024 是闰年，2024-01-01 → 2025-01-01 相隔 366 个自然日
  assert.equal(holdingDays('2024-01-01', '2025-01-01'), 367);
  // 非闰年相隔 365
  assert.equal(holdingDays('2023-01-01', '2024-01-01'), 366);
  // 前一天
  assert.equal(holdingDays('2024-12-31', T), 2);
});

test('holdingDays 对未来日期仍返回至少 1（由上层拦截，此处不抛错）', () => {
  assert.equal(holdingDays('2025-06-01', T), 1);
});

test('holdingDays 无法解析时返回 null', () => {
  assert.equal(holdingDays('not-a-date', T), null);
  assert.equal(holdingDays('2024-01-01', 'not-a-date'), null);
});

test('baseResult 口径：已投入 = P，日均购置成本 = P / D', () => {
  const r = baseResult({ price: 5000, purchaseDate: '2024-01-01', calcDate: '2025-01-01' });
  assert.equal(r.days, 367);
  assert.equal(r.invested, 5000);
  assert.ok(Math.abs(r.dailyAmortized - 5000 / 367) < 1e-12);
});

test('baseResult 拒绝非正数与非法日期', () => {
  assert.equal(baseResult({ price: 0, purchaseDate: T, calcDate: T }), null);
  assert.equal(baseResult({ price: -1, purchaseDate: T, calcDate: T }), null);
  assert.equal(baseResult({ price: 'abc', purchaseDate: T, calcDate: T }), null);
  assert.equal(baseResult({ price: 100, purchaseDate: 'bad', calcDate: T }), null);
});

test('fullResult：残值为空时不出净额与回收率（不是 0）', () => {
  const r = fullResult({ price: 5000, secondHand: null, purchaseDate: T, calcDate: T });
  assert.equal(r.hasResidual, false);
  assert.equal(r.netSpend, null);
  assert.equal(r.dailyNet, null);
  assert.equal(r.recovery, null);
  // 日均购置成本仍然可用
  assert.equal(r.dailyAmortized, 5000);
});

test('fullResult：空字符串等同未填写', () => {
  const r = fullResult({ price: 5000, secondHand: '', purchaseDate: T, calcDate: T });
  assert.equal(r.hasResidual, false);
});

test('fullResult：点值残值，口径为 P-S、(P-S)/D、S/P', () => {
  const r = fullResult({
    price: 5000,
    secondHand: 2000,
    purchaseDate: '2024-01-01',
    calcDate: '2025-01-01',
  });
  assert.equal(r.hasResidual, true);
  assert.equal(r.isRange, false);
  assert.equal(r.netSpend, 3000);
  assert.ok(Math.abs(r.dailyNet - 3000 / 367) < 1e-12);
  assert.ok(Math.abs(r.recovery - 0.4) < 1e-12);
});

test('fullResult：区间残值，净额与日均区间方向正确（左小右大）', () => {
  const r = fullResult({
    price: 5000,
    secondHand: [2000, 3000],
    purchaseDate: '2024-01-01',
    calcDate: '2025-01-01',
  });
  assert.equal(r.isRange, true);
  // 净持有支出 = [P-b, P-a]
  assert.deepEqual(r.netSpend, [2000, 3000]);
  // 日均净支出 = [(P-b)/D, (P-a)/D]
  assert.ok(Math.abs(r.dailyNet[0] - 2000 / 367) < 1e-12);
  assert.ok(Math.abs(r.dailyNet[1] - 3000 / 367) < 1e-12);
  // 回收率 = [a/P, b/P]
  assert.ok(Math.abs(r.recovery[0] - 0.4) < 1e-12);
  assert.ok(Math.abs(r.recovery[1] - 0.6) < 1e-12);
});

test('fullResult：区间上下限写反也能自动归位', () => {
  const r = fullResult({ price: 5000, secondHand: [3000, 2000], purchaseDate: T, calcDate: T });
  assert.deepEqual(r.netSpend, [2000, 3000]);
  assert.deepEqual(r.residual, [2000, 3000]);
});

test('fullResult：残值高于买入价 → 净额为负，属已回本而非错误', () => {
  const r = fullResult({ price: 3000, secondHand: 4000, purchaseDate: T, calcDate: T });
  assert.equal(r.netSpend, -1000);
  assert.equal(isPayback(r.netSpend), true);
  assert.equal(netZone(r.netSpend), 'payback');
  assert.ok(Math.abs(r.recovery - 4 / 3) < 1e-12);
});

test('netZone 对区间返回三态', () => {
  // 整体仍在支出
  assert.equal(netZone([2000, 3000]), 'cost');
  // 区间跨越 0
  assert.equal(netZone([-1000, 1000]), 'partial');
  // 整体已回本
  assert.equal(netZone([-3000, -1000]), 'payback');

  assert.equal(isPayback([-3000, -1000]), true);
  assert.equal(isPayback([-1000, 1000]), false);
  assert.equal(isPayback([2000, 3000]), false);
});

test('fullResult：跨 0 区间的回收率区间正确', () => {
  const r = fullResult({ price: 5000, secondHand: [4000, 6000], purchaseDate: T, calcDate: T });
  assert.deepEqual(r.netSpend, [-1000, 1000]);
  assert.equal(netZone(r.netSpend), 'partial');
  assert.ok(Math.abs(r.recovery[0] - 0.8) < 1e-12);
  assert.ok(Math.abs(r.recovery[1] - 1.2) < 1e-12);
});

test('fullResult：区间含非法值则退回「未计入残值」', () => {
  const r = fullResult({ price: 5000, secondHand: [2000, 'x'], purchaseDate: T, calcDate: T });
  assert.equal(r.hasResidual, false);
});

test('fullResult：日均成本的量级符合直觉（避免口径写反）', () => {
  // 5000 元用满一年，日均约 13.66 元
  const r = fullResult({ price: 5000, purchaseDate: '2024-01-01', calcDate: '2025-01-01' });
  assert.ok(r.dailyAmortized > 13 && r.dailyAmortized < 14);
});
