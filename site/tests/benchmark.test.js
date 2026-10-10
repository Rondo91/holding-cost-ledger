import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BENCHMARKS, BENCHMARK_META } from '../assets/js/benchmark-data.js';
import {
  hasBenchmarkCategory, getBenchmark, findBand, benchmarkHint,
} from '../assets/js/benchmark.js';

/* ------------------------------------------------------------------ *
 * 分段查找逻辑（fixture 直测，不依赖真实数据是否已填入）
 * ------------------------------------------------------------------ */

const FIXTURE_BANDS = [
  { maxMonths: 12, label: '1 年以内', range: [0.55, 0.80] },
  { maxMonths: 24, label: '1–2 年', range: [0.40, 0.65] },
  { maxMonths: 36, label: '2–3 年', range: [0.28, 0.50] },
  { maxMonths: null, label: '3 年以上', range: [0.12, 0.35] },
];

test('findBand 按持有月数命中正确段，边界含当日', () => {
  assert.equal(findBand(FIXTURE_BANDS, 0.5).label, '1 年以内');
  assert.equal(findBand(FIXTURE_BANDS, 12).label, '1 年以内');    // 恰好 12 个月 → 第一段（≤）
  assert.equal(findBand(FIXTURE_BANDS, 12.1).label, '1–2 年');
  assert.equal(findBand(FIXTURE_BANDS, 24).label, '1–2 年');
  assert.equal(findBand(FIXTURE_BANDS, 36).label, '2–3 年');
  assert.equal(findBand(FIXTURE_BANDS, 60).label, '3 年以上');    // 兜底段
  assert.equal(findBand(FIXTURE_BANDS, 1000).label, '3 年以上');
});

test('findBand 对非法输入返回 null', () => {
  assert.equal(findBand(FIXTURE_BANDS, -1), null);
  assert.equal(findBand(FIXTURE_BANDS, NaN), null);
  assert.equal(findBand(FIXTURE_BANDS, undefined), null);
  assert.equal(findBand([], 6), null);
  assert.equal(findBand(null, 6), null);
});

/* ------------------------------------------------------------------ *
 * 与当前数据文件的联动
 * ------------------------------------------------------------------ */

test('hasBenchmarkCategory：「其他」与未知品类永远没有锚点', () => {
  assert.equal(hasBenchmarkCategory('phone'), true);
  assert.equal(hasBenchmarkCategory('other'), false);
  assert.equal(hasBenchmarkCategory('nope'), false);
  assert.equal(hasBenchmarkCategory(undefined), false);
});

test('benchmarkHint：品类已知但无数据 → noData 降级而不是编数', () => {
  // 耳机：没有按年限分段的公开数据，如实留空
  const hint = benchmarkHint({ category: 'earphones', daysHeld: 730, price: 5000 });
  assert.equal(hint.noData, true);
  assert.ok(hint.note.length > 0);
  assert.equal(hint.categoryLabel, '耳机');
  assert.equal(hint.amountRange, undefined);   // 没有区间就不许出现折算金额
});

test('benchmarkHint：未知品类与「其他」返回 null（不渲染锚点）', () => {
  assert.equal(benchmarkHint({ category: 'nope', daysHeld: 365, price: 4000 }), null);
  assert.equal(benchmarkHint({ category: 'other', daysHeld: 365, price: 4000 }), null);
  assert.equal(benchmarkHint({}), null);
  assert.equal(benchmarkHint(null), null);
});

test('getBenchmark：手机按持有年限给出不同区间（保值率随年限陡降）', () => {
  assert.deepEqual(getBenchmark('phone', 6).range, [0.42, 0.78]);   // 1 年以内
  assert.deepEqual(getBenchmark('phone', 17).range, [0.25, 0.63]);  // 1–2 年
  assert.deepEqual(getBenchmark('phone', 30).range, [0.15, 0.50]);  // 2–3 年
  assert.equal(getBenchmark('phone', 17).band, '1–2 年');
});

test('getBenchmark：超过统计年限的段返回「没有数据」，不拿相邻段顶替', () => {
  const found = getBenchmark('phone', 60);   // 3 年以上
  assert.equal(found.range, null);
  assert.equal(found.band, '3 年以上');
  assert.ok(found.note.includes('3 年'));
});

test('getBenchmark：无数据品类（耳机/其他）一律返回 null', () => {
  assert.equal(getBenchmark('earphones', 12), null);
  assert.equal(getBenchmark('other', 12), null);
  assert.equal(getBenchmark('nope', 12), null);
});

test('benchmarkHint：按实付金额折算金额区间，并带上品类自己的数据时间', () => {
  const hint = benchmarkHint({ category: 'phone', daysHeld: 400, price: 5000 }); // 约 13 个月
  assert.equal(hint.noData, false);
  assert.equal(hint.bandLabel, '1–2 年');
  assert.deepEqual(hint.rangePercent, [0.25, 0.63]);
  assert.deepEqual(hint.amountRange, [1250, 3150]);
  assert.equal(hint.cutoff, '2026 年 7 月');   // 品类自带 asOf
  assert.ok(hint.sources.join('').includes('转转'));
});

test('benchmarkHint：年限超出统计范围 → noData，且带上段标签', () => {
  const hint = benchmarkHint({ category: 'phone', daysHeld: 1500, price: 5000 });
  assert.equal(hint.noData, true);
  assert.equal(hint.bandLabel, '3 年以上');
  assert.ok(hint.note.includes('不给数字'));
  assert.equal(hint.amountRange, undefined);   // 没有区间就不许出现折算金额
});

/* ------------------------------------------------------------------ *
 * 数据文件自检：数据一旦填入，必须满足完整性规则
 * 防止未来手滑写出畸形段或无出处的区间
 * ------------------------------------------------------------------ */

test('数据完整性：非 null 的 bands 必须升序、区间合法、来源非空', () => {
  for (const [cat, entry] of Object.entries(BENCHMARKS)) {
    if (entry.bands === null) continue;   // 未填入数据的品类，如实走「暂无参考」

    assert.ok(Array.isArray(entry.bands) && entry.bands.length > 0, `${cat}: bands 非空数组`);
    let prevMax = 0;
    entry.bands.forEach((band, i) => {
      const isLast = i === entry.bands.length - 1;
      assert.ok(typeof band.label === 'string' && band.label, `${cat}: 每段必须有中文标签`);

      // 「该段没有数据」只能出现在最后一段，且必须写明原因，不允许静默留空
      if (!band.range) {
        assert.ok(isLast, `${cat}: 无数据的段只能是最后一段`);
        assert.ok(typeof band.note === 'string' && band.note.length > 0, `${cat}: 无数据段必须说明原因`);
        return;
      }
      const [lo, hi] = band.range;
      assert.ok(lo > 0 && hi > lo && hi <= 1, `${cat}: 区间需满足 0 < lo < hi ≤ 1`);
      if (band.maxMonths === null) {
        assert.ok(isLast, `${cat}: 无上限段只能是最后一段`);
      } else {
        assert.ok(band.maxMonths > prevMax, `${cat}: maxMonths 必须升序`);
        prevMax = band.maxMonths;
      }
    });
    assert.ok(
      Array.isArray(entry.sources) && entry.sources.length > 0
      && entry.sources.every((s) => typeof s === 'string' && s.trim() !== ''),
      `${cat}: 有数据就必须有可引用的来源`,
    );
  }
});

test('口径声明与无数据文案必须非空（界面必渲染项）', () => {
  assert.ok(BENCHMARK_META.caliberNote.includes('发售价'));
  assert.ok(BENCHMARK_META.caliberNote.includes('实付'));
  assert.ok(BENCHMARK_META.noDataNote.length > 0);
});
