import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  curveWindow, curvePoints, daysToReach, curveSummary,
} from '../assets/js/curve.js';

/* ------------------------------------------------------------------ *
 * daysToReach
 * ------------------------------------------------------------------ */

test('daysToReach：P=5000、D=367、目标 ¥13/天 → 再持有 18 天', () => {
  // 5000 / 13 = 384.6…；384.6 − 367 = 17.6 → ceil = 18
  assert.equal(daysToReach(5000, 367, 13), 18);
});

test('daysToReach：目标恰好等于当前日均 → null（已经不高于目标）', () => {
  const current = 5000 / 367;
  assert.equal(daysToReach(5000, 367, current), null);
  assert.equal(daysToReach(5000, 367, 999), null);   // 目标高于当前
});

test('daysToReach：目标正好可达时含当日（need 为整数不进位）', () => {
  // 4000 / 100 = 40 → 需要 40 − 30 = 10 天，恰为整数
  assert.equal(daysToReach(4000, 30, 100), 10);
});

test('daysToReach：非法输入返回 null', () => {
  assert.equal(daysToReach(-1, 100, 5), null);
  assert.equal(daysToReach(5000, 0, 5), null);
  assert.equal(daysToReach(5000, 100, 0), null);
  assert.equal(daysToReach(5000, 100, -3), null);
  assert.equal(daysToReach(NaN, 100, 5), null);
});

/* ------------------------------------------------------------------ *
 * curveWindow
 * ------------------------------------------------------------------ */

test('curveWindow：持有不足 30 天 → 从头看 60 天', () => {
  assert.deepEqual(curveWindow(1), { fromDay: 1, toDay: 60 });
  assert.deepEqual(curveWindow(29), { fromDay: 1, toDay: 60 });
});

test('curveWindow：30 天起 → 当前点居中 [0.5D, 1.5D]', () => {
  assert.deepEqual(curveWindow(30), { fromDay: 15, toDay: 45 });
  assert.deepEqual(curveWindow(100), { fromDay: 50, toDay: 150 });
  assert.deepEqual(curveWindow(1227), { fromDay: 614, toDay: 1841 });
});

test('curveWindow：非法天数按 1 处理', () => {
  assert.deepEqual(curveWindow(0), { fromDay: 1, toDay: 60 });
  assert.deepEqual(curveWindow(-5), { fromDay: 1, toDay: 60 });
  assert.deepEqual(curveWindow(NaN), { fromDay: 1, toDay: 60 });
});

/* ------------------------------------------------------------------ *
 * curvePoints
 * ------------------------------------------------------------------ */

test('curvePoints：单调递减，每个点的 daily 严格等于 P / day', () => {
  const points = curvePoints({ price: 5000, fromDay: 50, toDay: 150, samples: 60 });
  assert.equal(points.length, 60);
  assert.equal(points[0].day, 50);
  assert.equal(points[points.length - 1].day, 150);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i].daily <= points[i - 1].daily, '日均随天数递减');
    assert.equal(points[i].daily, 5000 / points[i].day);
  }
});

test('curvePoints：首点恰为当前天时，其值精确等于当前日均 P/D', () => {
  const points = curvePoints({ price: 4999, fromDay: 367, toDay: 1101, samples: 10 });
  assert.equal(points[0].daily, 4999 / 367);
});

test('curvePoints：非法价格返回空数组，samples 有上下限', () => {
  assert.deepEqual(curvePoints({ price: 0, fromDay: 1, toDay: 60 }), []);
  assert.deepEqual(curvePoints({ price: -5, fromDay: 1, toDay: 60 }), []);
  assert.deepEqual(curvePoints({}), []);
  // samples 钳到 [2, 120]
  assert.equal(curvePoints({ price: 100, fromDay: 1, toDay: 10, samples: 1 }).length, 2);
  assert.equal(curvePoints({ price: 100, fromDay: 1, toDay: 10, samples: 9999 }).length, 120);
});

/* ------------------------------------------------------------------ *
 * curveSummary
 * ------------------------------------------------------------------ */

test('curveSummary：半衰天数恒等于已持有天数（P/(D+x)=(P/D)/2 ⟺ x=D）', () => {
  const s = curveSummary({ price: 5000, days: 367 });
  assert.equal(s.currentDaily, 5000 / 367);
  assert.equal(s.halfAhead, 367);

  const s2 = curveSummary({ price: 199, days: 30 });
  assert.equal(s2.halfAhead, 30);
});

test('curveSummary：下一整元档 4.07 → 目标 ¥4', () => {
  const s = curveSummary({ price: 5000, days: 367 });   // 日均 ≈ 13.62
  assert.equal(s.nextStep.target, 13);
  assert.equal(s.nextStep.daysAhead, 18);
});

test('curveSummary：日均恰为整数时目标取下一档（¥4.00 → ¥3）', () => {
  const s = curveSummary({ price: 400, days: 100 });    // 日均恰为 4
  assert.equal(s.nextStep.target, 3);
  assert.equal(s.nextStep.daysAhead, 34);               // 400/3 = 133.3 → 133.3−100 = 33.3 → 34
});

test('curveSummary：日均不足 ¥1/天时没有下一整元档', () => {
  const s = curveSummary({ price: 50, days: 100 });     // 日均 0.5
  assert.equal(s.nextStep, null);
});

test('curveSummary：非法输入返回 null', () => {
  assert.equal(curveSummary({ price: 0, days: 100 }), null);
  assert.equal(curveSummary({ price: 100, days: 0 }), null);
  assert.equal(curveSummary({}), null);
  assert.equal(curveSummary(null), null);
});
