/**
 * format.js — 数值格式化（纯函数）
 *
 * 层级原则：主金额最大、百分比与日均次之、公式与说明最弱。
 * 格式化本身只负责文本产出，层级由样式表控制。
 */

const DASH = '—';
const MINUS = '\u2212'; // 真正的减号，视觉上比连字符更稳

/** 是否为可用于展示的有限数 */
export function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * 千分位数字。
 * @param {number} n
 * @param {number|'auto'} decimals 固定小数位；'auto' 表示整数不带小数、非整数保留 2 位
 */
export function formatNumber(n, decimals = 'auto') {
  if (!isFiniteNumber(n)) return DASH;
  const d = decimals === 'auto'
    ? (Number.isInteger(n) ? 0 : 2)
    : Math.max(0, Math.min(6, decimals));
  const rounded = Number(n.toFixed(d));
  // -0 归一为 0，避免出现「−0」
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  const [int, frac] = Math.abs(safe).toFixed(d).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = safe < 0 ? MINUS : '';
  return sign + grouped + (frac ? '.' + frac : '');
}

/** 金额，不带货币符号 */
export function formatAmount(n, decimals = 'auto') {
  return formatNumber(n, decimals);
}

/** 金额，带 ¥。负值保留负号，由调用方决定是否改写为「已回本」文案 */
export function formatCurrency(n, decimals = 'auto') {
  if (!isFiniteNumber(n)) return DASH;
  const sign = n < 0 ? MINUS : '';
  return sign + '¥' + formatNumber(Math.abs(n), decimals);
}

/** 日均类金额：固定 2 位，便于纵向对齐 */
export function formatDaily(n) {
  return formatCurrency(n, 2);
}

/** 比率 → 百分比文本。recovery 传 0.684 → '68.4%' */
export function formatPercent(ratio, decimals = 1) {
  if (!isFiniteNumber(ratio)) return DASH;
  const pct = ratio * 100;
  const d = Math.max(0, Math.min(4, decimals));
  const rounded = Number(pct.toFixed(d));
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  return `${formatNumber(safe, d)}%`;
}

/** 天数 */
export function formatDays(days) {
  if (!isFiniteNumber(days)) return DASH;
  return `${formatNumber(days, 0)} 天`;
}

/**
 * 区间格式化。values 为 [a, b]，formatter 接收单个数值。
 * 用 en dash 连接，两端各自套用同一格式化规则。
 */
export function formatRange(values, formatter) {
  if (!Array.isArray(values) || values.length !== 2) return DASH;
  const [a, b] = values;
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return DASH;
  return `${formatter(a)} – ${formatter(b)}`;
}

/** 金额区间 */
export function formatCurrencyRange(values, decimals = 'auto') {
  return formatRange(values, (v) => formatCurrency(v, decimals));
}

/** 百分比区间 */
export function formatPercentRange(values, decimals = 1) {
  return formatRange(values, (v) => formatPercent(v, decimals));
}

/** 日均金额区间 */
export function formatDailyRange(values) {
  return formatRange(values, (v) => formatDaily(v));
}

/**
 * 从带千分位、货币符号、全角字符的输入里取出数值。
 * 例：'¥4,999' / '４，９９９' / '4999.5 ' → 4999 / 4999 / 4999.5
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  if (typeof input !== 'string') return NaN;
  const normalized = input
    .trim()
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，,\s¥￥]/g, '');
  if (normalized === '') return NaN;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

/** 输入框失焦时把数值回填为带千分位的文本；空值原样返回 */
export function toDisplayAmount(input) {
  const n = parseAmount(input);
  if (!Number.isFinite(n)) return typeof input === 'string' ? input : '';
  return formatNumber(n, Number.isInteger(n) ? 0 : 2);
}

/**
 * 金额分桶 —— 用于匿名埋点。
 * 金额本身绝不上报，只上报所属区间，这是隐私策略的一部分。
 */
export function priceBand(n) {
  if (!isFiniteNumber(n) || n < 0) return 'unknown';
  if (n < 500) return '<500';
  if (n < 1500) return '500-1500';
  if (n < 3000) return '1500-3000';
  if (n < 6000) return '3000-6000';
  if (n < 10000) return '6000-10000';
  if (n < 20000) return '10000-20000';
  return '>=20000';
}

/** 持有天数分桶 */
export function daysBand(days) {
  if (!isFiniteNumber(days) || days < 0) return 'unknown';
  if (days < 31) return '<1m';
  if (days < 91) return '1-3m';
  if (days < 366) return '3-12m';
  if (days < 731) return '1-2y';
  if (days < 1096) return '2-3y';
  return '>=3y';
}

/** 回收率分桶 */
export function recoveryBand(ratio) {
  if (!isFiniteNumber(ratio)) return 'unknown';
  const p = ratio * 100;
  if (p < 0) return '<0';
  if (p < 20) return '0-20';
  if (p < 40) return '20-40';
  if (p < 60) return '40-60';
  if (p < 80) return '60-80';
  if (p <= 100) return '80-100';
  return '>100';
}
