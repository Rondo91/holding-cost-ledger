/**
 * curve.js — 日均成本衰减曲线（纯函数）
 *
 * 这条曲线只做一件事：把已付金额 P 摊到更多天。P ÷ D 随 D 增大单调下降。
 * 摊分数学不等于「继续持有更划算」——本工具不判断该不该留，也不构成任何建议。
 * 这条边界由界面固定文案兜底，不在这里做任何「建议」性质的输出。
 */

/**
 * 曲线横轴窗口。
 *   持有不足 30 天 → [1, 60]（早期曲线变化最陡，从头看）
 *   否则 → [0.5D, 1.5D]（当前点大致居中，左右各看一半）
 */
export function curveWindow(days) {
  const d = Number.isFinite(days) && days >= 1 ? Math.round(days) : 1;
  if (d < 30) return { fromDay: 1, toDay: 60 };
  return { fromDay: Math.max(1, Math.round(d * 0.5)), toDay: Math.round(d * 1.5) };
}

/**
 * 采样曲线点：[{ day, daily }]，daily = P / day，单调递减。
 * 采样点均匀落在 fromDay..toDay 上，天数取整（曲线只是示意，不承担计算职责）。
 */
export function curvePoints(args) {
  const { price, fromDay, toDay, samples = 48 } = args || {};
  if (!(Number.isFinite(price) && price > 0)) return [];
  const from = Math.max(1, Math.round(fromDay) || 1);
  const to = Math.max(from + 1, Math.round(toDay) || from + 1);
  const n = Math.max(2, Math.min(120, Math.round(samples) || 2));

  const points = [];
  for (let i = 0; i < n; i++) {
    const day = Math.round(from + ((to - from) * i) / (n - 1));
    points.push({ day, daily: price / day });
  }
  return points;
}

/**
 * 还要再持有多少天，日均才能降到 targetDaily 及以下。
 * 数学：P / (D + x) ≤ target ⟺ x ≥ P / target − D
 * @returns {number|null} 天数（≥1）；当前已不高于目标时返回 null
 */
export function daysToReach(price, daysHeld, targetDaily) {
  if (!(Number.isFinite(price) && price > 0)) return null;
  if (!(Number.isFinite(daysHeld) && daysHeld >= 1)) return null;
  if (!(Number.isFinite(targetDaily) && targetDaily > 0)) return null;

  const need = price / targetDaily - daysHeld;
  if (need <= 0) return null;
  return Math.ceil(need);
}

/**
 * 曲线结论摘要。summary 句直接嵌在 <summary> 里——
 * 不让用户点开才拿到答案，点开只是看形状。
 *
 * halfAhead：日均降到当前一半还需的天数。数学上恒等于 D
 * （P/(D+x) = (P/D)/2 ⟺ D+x = 2D），测试里钉死这个事实。
 *
 * nextStep：降到「下一个整元/天以内」还需的天数。
 * 当前日均 4.07 → 目标 ¥4；当前正好 4.00 → 目标 ¥3（「以内」不含已达成的档）。
 */
export function curveSummary(args) {
  const { price, days } = args || {};
  if (!(Number.isFinite(price) && price > 0)) return null;
  if (!(Number.isFinite(days) && days >= 1)) return null;

  const currentDaily = price / days;
  const halfAhead = daysToReach(price, days, currentDaily / 2);

  const target = Number.isInteger(currentDaily)
    ? currentDaily - 1
    : Math.floor(currentDaily);
  const daysAhead = target > 0 ? daysToReach(price, days, target) : null;

  return {
    currentDaily,
    days,
    halfAhead,
    nextStep: target > 0 && daysAhead !== null
      ? { target, daysAhead }
      : null,
  };
}
