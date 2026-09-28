/**
 * calc.js — 持有成本计算（纯函数）
 *
 * 本模块无 DOM、无副作用、无全局状态，可直接被 node --test 单测。
 * 口径定义见设计说明页「计算口径」，不在此处擅自变更。
 *
 * 符号：
 *   P = 实际支付金额（已扣优惠，不含订单中其他商品）
 *   S = 当前预计二手价（可为空）
 *   D = 持有天数
 *   T = 计算日期（默认打开页面的当天）
 */

const MS_PER_DAY = 86400000;

/**
 * 把 Date / 'YYYY-MM-DD' / 时间戳 归一化为**本地零点**的 Date。
 * 用本地零点求差是为了避免时区与夏令时导致的 ±1 天误差。
 * @returns {Date|null}
 */
export function toLocalDate(input) {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  if (typeof input === 'string') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input.trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const date = new Date(y, mo - 1, d);
    // 校验回读，拒绝 2026-02-31 这类被自动进位的不存在日期
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
      return null;
    }
    return date;
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return null;
}

/**
 * 持有天数 D = max(1, 计算日期 - 购买日期 + 1)
 * 按自然日计算，**包含购买当天**。当天购买 → D = 1。
 * @returns {number|null} 无法解析时返回 null
 */
export function holdingDays(purchaseDate, calcDate = new Date()) {
  const from = toLocalDate(purchaseDate);
  const to = toLocalDate(calcDate);
  if (!from || !to) return null;
  const elapsed = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  return Math.max(1, elapsed + 1);
}

/**
 * 基础结果：只依赖 P 与 D，不需要用户做任何额外查询。
 * 已投入金额 = P
 * 日均购置成本 = P / D
 */
export function baseResult({ price, purchaseDate, calcDate = new Date() }) {
  const P = Number(price);
  if (!Number.isFinite(P) || P <= 0) return null;
  const days = holdingDays(purchaseDate, calcDate);
  if (days === null) return null;
  return {
    price: P,
    days,
    invested: P,
    dailyAmortized: P / days,
  };
}

/**
 * 完整结果。secondHand 三种形态：
 *   null / undefined  → 未计入残值（只返回基础结果，净额与回收率均为 null）
 *   number            → 点值 S
 *   [a, b]（a ≤ b）    → 区间
 *
 * 估算净持有支出   = P - S
 * 日均净持有支出   = (P - S) / D
 * 按实付回收率     = S / P
 *
 * 区间时：净持有支出 = [P-b, P-a]，日均净支出 = [(P-b)/D, (P-a)/D]，回收率 = [a/P, b/P]
 */
export function fullResult({
  price,
  secondHand = null,
  purchaseDate,
  calcDate = new Date(),
}) {
  const base = baseResult({ price, purchaseDate, calcDate });
  if (!base) return null;

  const { price: P, days } = base;
  const empty = {
    ...base,
    hasResidual: false,
    isRange: false,
    netSpend: null,
    dailyNet: null,
    recovery: null,
  };

  if (secondHand === null || secondHand === undefined || secondHand === '') {
    return empty;
  }

  if (Array.isArray(secondHand)) {
    const raw = secondHand.map(Number);
    if (raw.length !== 2 || !raw.every(Number.isFinite)) return empty;
    const a = Math.min(raw[0], raw[1]);
    const b = Math.max(raw[0], raw[1]);
    return {
      ...base,
      hasResidual: true,
      isRange: true,
      residual: [a, b],
      netSpend: [P - b, P - a],
      dailyNet: [(P - b) / days, (P - a) / days],
      recovery: [a / P, b / P],
    };
  }

  const S = Number(secondHand);
  if (!Number.isFinite(S)) return empty;

  return {
    ...base,
    hasResidual: true,
    isRange: false,
    residual: S,
    netSpend: P - S,
    dailyNet: (P - S) / days,
    recovery: S / P,
  };
}

/**
 * 净持有支出是否已回本（≤ 0）。
 * S > P 时净额为负，属于正常结果（以旧换新、设备升值），不是错误。
 * 区间取上界判断——上界也 ≤ 0 才算「整体已回本」。
 */
export function isPayback(netSpend) {
  if (Array.isArray(netSpend)) return netSpend[1] <= 0;
  return typeof netSpend === 'number' && netSpend <= 0;
}

/**
 * 净额区间的文字判定：帮助渲染层对区间做三态处理
 *   'payback'  整体已回本
 *   'partial'  区间跨越 0
 *   'cost'     整体仍在支出
 */
export function netZone(netSpend) {
  if (Array.isArray(netSpend)) {
    if (netSpend[1] <= 0) return 'payback';
    if (netSpend[0] <= 0) return 'partial';
    return 'cost';
  }
  if (typeof netSpend !== 'number') return null;
  return netSpend <= 0 ? 'payback' : 'cost';
}
