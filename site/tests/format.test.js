import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatNumber,
  formatCurrency,
  formatDaily,
  formatPercent,
  formatDays,
  formatCurrencyRange,
  formatDailyRange,
  formatPercentRange,
  parseAmount,
  toDisplayAmount,
  priceBand,
  daysBand,
  recoveryBand,
  isFiniteNumber,
} from '../assets/js/format.js';

const DASH = '\u2014';
const MINUS = '\u2212';

test('formatNumber 千分位与小数位', () => {
  assert.equal(formatNumber(4320), '4,320');
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(999), '999');
  assert.equal(formatNumber(1000), '1,000');
  assert.equal(formatNumber(3.4246, 2), '3.42');
  assert.equal(formatNumber(3.426, 2), '3.43');
});

test('formatNumber 不产生 −0', () => {
  assert.equal(formatNumber(-0.0001, 0), '0');
  assert.equal(formatNumber(-0, 2), '0.00');
  assert.equal(formatNumber(0), '0');
});

test('formatNumber 对无效值返回破折号而非 NaN', () => {
  assert.equal(formatNumber(NaN), DASH);
  assert.equal(formatNumber(Infinity), DASH);
  assert.equal(formatNumber(undefined), DASH);
  assert.equal(formatNumber(null), DASH);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(0), true);
});

test('formatCurrency 带符号，负值保留真实减号', () => {
  assert.equal(formatCurrency(4320), '¥4,320');
  assert.equal(formatCurrency(0), '¥0');
  assert.equal(formatCurrency(-1000), `${MINUS}¥1,000`);
  assert.equal(formatCurrency(NaN), DASH);
});

test('formatDaily 固定两位，便于纵向对齐', () => {
  assert.equal(formatDaily(13.6239), '¥13.62');
  assert.equal(formatDaily(5000), '¥5,000.00');
  assert.equal(formatDaily(0.5), '¥0.50');
});

test('formatPercent 由比率转百分比', () => {
  assert.equal(formatPercent(0.684, 1), '68.4%');
  assert.equal(formatPercent(1.3333, 1), '133.3%');
  assert.equal(formatPercent(0, 0), '0%');
  assert.equal(formatPercent(NaN), DASH);
});

test('formatDays', () => {
  assert.equal(formatDays(367), '367 天');
  assert.equal(formatDays(1), '1 天');
  assert.equal(formatDays(NaN), DASH);
});

test('区间格式化', () => {
  assert.equal(formatCurrencyRange([2000, 3000]), '¥2,000 – ¥3,000');
  assert.equal(formatDailyRange([5.448, 8.174]), '¥5.45 – ¥8.17');
  assert.equal(formatPercentRange([0.4, 0.6]), '40.0% – 60.0%');
  assert.equal(formatCurrencyRange(null), DASH);
  assert.equal(formatCurrencyRange([1]), DASH);
});

test('parseAmount 容忍千分位、货币符号、全角数字与空格', () => {
  assert.equal(parseAmount('4999'), 4999);
  assert.equal(parseAmount('¥4,999'), 4999);
  assert.equal(parseAmount('4,999.5'), 4999.5);
  assert.equal(parseAmount(' ￥ 4999 '), 4999);
  assert.equal(parseAmount('４，９９９'), 4999);
  assert.equal(Number.isNaN(parseAmount('')), true);
  assert.equal(Number.isNaN(parseAmount('abc')), true);
  assert.equal(Number.isNaN(parseAmount('12元')), true);
});

test('toDisplayAmount 回填千分位', () => {
  assert.equal(toDisplayAmount('4999'), '4,999');
  assert.equal(toDisplayAmount('1234567'), '1,234,567');
  assert.equal(toDisplayAmount('4999.5'), '4,999.50');
  assert.equal(toDisplayAmount(''), '');
});

test('金额分桶覆盖各档位', () => {
  assert.equal(priceBand(300), '<500');
  assert.equal(priceBand(4999), '3000-6000');
  assert.equal(priceBand(20000), '>=20000');
  assert.equal(priceBand(-1), 'unknown');
  assert.equal(priceBand(NaN), 'unknown');
});

test('持有天数分桶', () => {
  assert.equal(daysBand(10), '<1m');
  assert.equal(daysBand(60), '1-3m');
  assert.equal(daysBand(200), '3-12m');
  assert.equal(daysBand(367), '1-2y');
  assert.equal(daysBand(1200), '>=3y');
  assert.equal(daysBand(NaN), 'unknown');
});

test('回收率分桶', () => {
  assert.equal(recoveryBand(0.1), '0-20');
  assert.equal(recoveryBand(0.4), '40-60');
  assert.equal(recoveryBand(1), '80-100');
  assert.equal(recoveryBand(1.2), '>100');
  assert.equal(recoveryBand(NaN), 'unknown');
});
