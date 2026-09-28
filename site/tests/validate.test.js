import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDeviceName,
  validatePrice,
  validatePurchaseDate,
  validateSecondHand,
  mergeLevel,
} from '../assets/js/validate.js';

const NOW = new Date(2025, 0, 1); // 2025-01-01 本地时间

test('设备名称是选填项', () => {
  assert.equal(validateDeviceName('').ok, true);
  assert.equal(validateDeviceName(undefined).ok, true);
  assert.equal(validateDeviceName('iPhone 13').ok, true);
  assert.equal(validateDeviceName('x'.repeat(61)).ok, false);
});

test('支付金额必填且必须为正数', () => {
  assert.equal(validatePrice('').ok, false);
  assert.equal(validatePrice(null).ok, false);
  assert.equal(validatePrice(0).ok, false);
  assert.equal(validatePrice(-100).ok, false);
  assert.equal(validatePrice('abc').ok, false);
  assert.equal(validatePrice('4,999').ok, true);
  assert.equal(validatePrice(4999).ok, true);
});

test('支付金额超出软上限时提示而非拒绝', () => {
  const r = validatePrice(250000);
  assert.equal(r.ok, true);
  assert.equal(r.level, 'warn');
  assert.ok(r.message.length > 0);
});

test('购买日期必填、不能是未来、不能过于久远', () => {
  assert.equal(validatePurchaseDate('', NOW).ok, false);
  assert.equal(validatePurchaseDate('2025-06-01', NOW).ok, false); // 未来
  assert.equal(validatePurchaseDate('2026-02-31', NOW).ok, false); // 不存在
  assert.equal(validatePurchaseDate('1990-01-01', NOW).level, 'warn'); // 过于久远

  const ok = validatePurchaseDate('2024-03-15', NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.level, null);
});

test('购买日期允许就是今天（当天购买记 1 天）', () => {
  const r = validatePurchaseDate('2025-01-01', NOW);
  assert.equal(r.ok, true);
  assert.equal(r.level, null);
});

test('二手价是选填项，留空完全正常', () => {
  assert.equal(validateSecondHand('', 5000).ok, true);
  assert.equal(validateSecondHand(null, 5000).ok, true);
  assert.equal(validateSecondHand(undefined, 5000).ok, true);
});

test('二手价为负数时拒绝', () => {
  assert.equal(validateSecondHand(-1, 5000).ok, false);
  assert.equal(validateSecondHand({ min: -1, max: 100 }, 5000).ok, false);
});

test('二手价区间下限大于上限时拒绝', () => {
  const r = validateSecondHand({ min: 3000, max: 2000 }, 5000);
  assert.equal(r.ok, false);
  assert.ok(r.message.includes('下限'));
});

test('二手价区间合法时通过', () => {
  const r = validateSecondHand({ min: 2000, max: 3000 }, 5000);
  assert.equal(r.ok, true);
  assert.equal(r.level, null);
});

test('二手价远高于买入价时提示确认', () => {
  assert.equal(validateSecondHand(20000, 5000).level, 'warn');
  assert.equal(validateSecondHand({ min: 100, max: 20000 }, 5000).level, 'warn');
  // 三倍以内不提示
  assert.equal(validateSecondHand(15000, 5000).level, null);
});

test('mergeLevel 取最严重级别', () => {
  assert.equal(mergeLevel([{ level: null }, { level: 'warn' }]), 'warn');
  assert.equal(mergeLevel([{ level: 'warn' }, { level: 'error' }]), 'error');
  assert.equal(mergeLevel([{ level: null }, { level: null }]), null);
});
