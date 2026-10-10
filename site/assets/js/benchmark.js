/**
 * benchmark.js — 参考回收率查找与折算（纯函数）
 *
 * 只做两件事：按「品类 × 持有年限段」找到参考区间；把区间按实付金额折算成金额。
 * 不做任何「代填」「推荐」——锚点是给用户做参考的，不是替用户做决定的。
 */

import { BENCHMARKS, BENCHMARK_META } from './benchmark-data.js';

/** 平均每月天数（365.25 / 12），用于持有天数 → 持有月数 */
const DAYS_PER_MONTH = 30.4375;

/** 该品类是否有参考数据可用（不含 'other'——「其他」永远不给锚点） */
export function hasBenchmarkCategory(category) {
  return category !== 'other' && Object.prototype.hasOwnProperty.call(BENCHMARKS, category);
}

/**
 * 在分段表里找到持有月数所属的段（bands 按 maxMonths 升序，null 为无上限兜底段）。
 * 单独导出以便用 fixture 直接测分段逻辑，不依赖真实数据是否已填入。
 * @returns {object|null} 命中的 band；月数非法时 null
 */
export function findBand(bands, monthsHeld) {
  if (!Array.isArray(bands) || bands.length === 0) return null;
  if (!Number.isFinite(monthsHeld) || monthsHeld < 0) return null;
  return bands.find((b) => b.maxMonths === null || monthsHeld <= b.maxMonths)
    ?? bands[bands.length - 1];
}

/**
 * 按品类与持有月数取参考区间。
 * @returns {{ band: string, range: [number, number] }|null}
 *   null：品类未知 / 无数据 / 月数非法。调用方据此不渲染锚点。
 */
export function getBenchmark(category, monthsHeld) {
  const entry = BENCHMARKS[category];
  if (!entry || !Array.isArray(entry.bands) || entry.bands.length === 0) return null;

  const band = findBand(entry.bands, monthsHeld);
  if (!band) return null;

  // 该年限段没有可引用的数据（例如「3 年以上」）：如实返回没有，不拿相邻段顶替
  if (!band.range) {
    return { band: band.label, range: null, note: band.note || BENCHMARK_META.noDataNote };
  }

  const [lo, hi] = band.range;
  if (!(lo > 0) || !(hi > lo)) return null;   // 数据自检，畸形段按无数据处理
  return { band: band.label, range: [lo, hi] };
}

/**
 * 组装渲染参考锚点所需的全部数据。
 *
 * @param {{ category: string, daysHeld: number, price?: number }} args
 * @returns {object|null}
 *   null：品类未知或「其他」→ 界面不显示锚点（不显示「猜品类」的过程）
 *   { noData: true }：品类已知但无可靠数据 → 显示「暂无可靠参考」
 *   其余：完整锚点数据，amountRange 为按实付折算的金额区间
 */
export function benchmarkHint(args) {
  const { category, daysHeld, price } = args || {};
  if (!hasBenchmarkCategory(category)) return null;
  const entry = BENCHMARKS[category];

  if (!Array.isArray(entry.bands) || entry.bands.length === 0) {
    return {
      category,
      categoryLabel: entry.label,
      noData: true,
      note: entry.note || BENCHMARK_META.noDataNote,
    };
  }

  const monthsHeld = Number.isFinite(daysHeld) && daysHeld > 0
    ? daysHeld / DAYS_PER_MONTH
    : null;
  const found = getBenchmark(category, monthsHeld);
  if (!found) return null;

  // 品类有数据、但这个持有年限段没有：同样走「没有」而不是编一个
  if (!found.range) {
    return {
      category,
      categoryLabel: entry.label,
      noData: true,
      bandLabel: found.band,
      note: found.note,
    };
  }

  const [lo, hi] = found.range;
  const amountRange = (Number.isFinite(price) && price > 0)
    ? [lo * price, hi * price]
    : null;

  return {
    category,
    categoryLabel: entry.label,
    noData: false,
    bandLabel: found.band,
    rangePercent: [lo, hi],
    amountRange,
    sources: entry.sources,
    cutoff: entry.asOf || BENCHMARK_META.cutoff,
    caliberNote: BENCHMARK_META.caliberNote,
  };
}
