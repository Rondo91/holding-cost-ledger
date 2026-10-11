import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  benchmarkHintHTML, curveBlockHTML, historySectionHTML, recallBannerHTML,
} from '../assets/js/views-history.js';
import { curveWindow, curvePoints, curveSummary } from '../assets/js/curve.js';

/* ------------------------------------------------------------------ *
 * 参考锚点
 * ------------------------------------------------------------------ */

test('benchmarkHintHTML：null 不渲染', () => {
  assert.equal(benchmarkHintHTML(null), '');
  assert.equal(benchmarkHintHTML(undefined), '');
});

test('benchmarkHintHTML：无数据品类如实说，不编数字', () => {
  const html = benchmarkHintHTML({
    category: 'camera', categoryLabel: '相机', noData: true,
    note: '这个品类暂无可靠的公开参考数据。与其给你一个编的数字，不如不显示。',
  });
  assert.ok(html.includes('暂无可靠的公开参考数据'));
  assert.ok(html.includes('details'));
  assert.ok(!html.includes('%'));   // 没有区间数字
});

test('benchmarkHintHTML：年限超出统计范围时，把「没有」写进 summary', () => {
  const html = benchmarkHintHTML({
    category: 'phone', categoryLabel: '手机', noData: true, bandLabel: '3 年以上',
    note: '公开数据大多只统计到 3 年。用 3 年的数值顶上会高估，所以这里不给数字。',
  });
  // 点开发现「没有」是一种欺骗：结论必须出现在 summary 上
  assert.ok(html.includes('3 年以上'));
  assert.ok(html.includes('看看有没有行业参考') === false);
  assert.ok(html.includes('手机持有3 年以上'));
  assert.ok(html.includes('不给数字'));
});

test('benchmarkHintHTML：完整锚点含区间、折算金额、口径声明与来源', () => {
  const html = benchmarkHintHTML({
    category: 'phone', categoryLabel: '手机', noData: false,
    bandLabel: '2–3 年',
    rangePercent: [0.28, 0.5],
    amountRange: [1399.72, 2499.5],
    sources: ['转转《手机行情报告》（2024）'],
    cutoff: '2024 年 1 月',
    caliberNote: '行业保值率按发售价口径统计；本工具的回收率按实付金额计算。',
  });
  assert.ok(html.includes('手机'));
  assert.ok(html.includes('2–3 年'));
  assert.ok(html.includes('28.0% – 50.0%'));
  assert.ok(html.includes('¥1,400 – ¥2,500'));   // 折算金额（0 位小数）
  assert.ok(html.includes('注意口径'));
  assert.ok(html.includes('发售价口径统计'));
  assert.ok(html.includes('数据来源：转转'));
  assert.ok(html.includes('截至 2024 年 1 月'));
});

test('benchmarkHintHTML：数据来源与标签经过 HTML 转义', () => {
  const html = benchmarkHintHTML({
    category: 'phone', categoryLabel: '<script>手机</script>', noData: false,
    bandLabel: '1 年<b>以内</b>',
    rangePercent: [0.5, 0.8],
    amountRange: null,
    sources: ['<img src=x>'],
    cutoff: '',
    caliberNote: 'x',
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('benchmarkHintHTML：无实付金额时省略折算句，其余仍在', () => {
  const html = benchmarkHintHTML({
    category: 'phone', categoryLabel: '手机', noData: false,
    bandLabel: '1 年以内', rangePercent: [0.55, 0.8], amountRange: null,
    sources: ['某报告'], cutoff: '2024 年 1 月', caliberNote: '口径说明。',
  });
  assert.ok(html.includes('55.0% – 80.0%'));
  assert.ok(!html.includes('折算'));
});

/* ------------------------------------------------------------------ *
 * 衰减曲线
 * ------------------------------------------------------------------ */

const CURVE = (() => {
  const summary = curveSummary({ price: 5000, days: 367 });
  const win = curveWindow(367);
  return {
    summary,
    svgData: {
      points: curvePoints({ price: 5000, fromDay: win.fromDay, toDay: win.toDay }),
      currentDay: 367,
      currentDaily: summary.currentDaily,
    },
  };
})();

test('curveBlockHTML：常显展示（v2.1 起），结论句与 SVG 直接可见', () => {
  const html = curveBlockHTML(CURVE.summary, CURVE.svgData);
  assert.ok(html.includes('curve-block'));
  assert.ok(!html.includes('<details'));   // 不再折叠：曲线提到明面
  assert.ok(html.includes('降到一半'));
  assert.ok(html.includes('再持有 367 天'));
  assert.ok(html.includes('/天以内'));
});

test('curveBlockHTML：SVG 无障碍属性与边界声明', () => {
  const html = curveBlockHTML(CURVE.summary, CURVE.svgData);
  assert.ok(html.includes('role="img"'));
  assert.ok(html.includes('aria-label'));
  assert.ok(html.includes('不构成任何建议'));
  assert.ok(html.includes('不判断该不该留'));
});

test('curveBlockHTML：当前点左侧实线（带面积）右侧虚线', () => {
  const html = curveBlockHTML(CURVE.summary, CURVE.svgData);
  assert.ok(html.includes('curve__area'));   // v2.1：实线区面积填充
  assert.ok(html.includes('curve__line'));
  assert.ok(html.includes('curve__line--dashed'));
  assert.ok(html.includes('curve__dot'));
});

test('curveBlockHTML：summary 为 null 不渲染', () => {
  assert.equal(curveBlockHTML(null, null), '');
});

/* ------------------------------------------------------------------ *
 * 账本区
 * ------------------------------------------------------------------ */

const T = '2026-10-09';

function makeRecord(id, name, date, price, residual = null, snapshot = null, category = 'phone') {
  return {
    id, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    input: { deviceName: name, purchaseDate: date, price, category },
    residual, snapshot,
  };
}

test('historySectionHTML：设备名经 HTML 转义', () => {
  const html = historySectionHTML({
    records: [makeRecord('r1', '<script>alert(1)</script>', '2025-10-09', 3650)],
    calcDate: T,
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('historySectionHTML：行内含今日日均、持有天数、残值状态与操作按钮', () => {
  const html = historySectionHTML({
    records: [
      makeRecord('r1', 'iPhone 13', '2025-10-09', 3650, 2000,
        { calcDate: '2026-10-01', days: 358, dailyAmortized: 10.19 }),
    ],
    calcDate: T,
  });
  assert.ok(html.includes('iPhone 13'));
  assert.ok(html.includes('data-action="history-recall"'));
  assert.ok(html.includes('data-action="history-delete"'));
  assert.ok(html.includes('data-id="r1"'));
  assert.ok(html.includes('残值未计入') === false);
  assert.ok(html.includes('已按 ¥2,000 折算'));
  assert.ok(html.includes('上次 ¥10.19/天 → 今天'));   // 快照只做对比提示
});

test('historySectionHTML：残值未计时如实标注', () => {
  const html = historySectionHTML({
    records: [makeRecord('r2', '旧手机', '2023-10-09', 2000, null)],
    calcDate: T,
  });
  assert.ok(html.includes('残值未计入'));
  assert.ok(!html.includes('已按'));
});

test('historySectionHTML：≥2 台才渲染排行卡，且注明口径', () => {
  const one = historySectionHTML({
    records: [makeRecord('r1', 'A', '2025-10-09', 3650)], calcDate: T,
  });
  assert.ok(!one.includes('日均最贵'));

  const two = historySectionHTML({
    records: [
      makeRecord('r1', 'A', '2025-10-09', 3650),
      makeRecord('r2', 'B', '2021-10-09', 2000),
    ],
    calcDate: T,
  });
  assert.ok(two.includes('日均最贵'));
  assert.ok(two.includes('仅对比日均购置成本'));
  assert.ok(two.includes('rank__bar'));   // v2.1：相对日均的对比条
});

test('historySectionHTML：隐私说明如实——本机存储、会丢、共用电脑可见', () => {
  const html = historySectionHTML({
    records: [makeRecord('r1', 'A', '2025-10-09', 3650)], calcDate: T,
  });
  assert.ok(html.includes('只保存在这台浏览器里'));
  assert.ok(html.includes('清空浏览器数据会一并丢失'));
  assert.ok(html.includes('共用电脑'));
  assert.ok(html.includes('导出备份'));
  assert.ok(html.includes('清空账本'));
});

test('historySectionHTML：清空有行内两步确认条（默认隐藏）', () => {
  const html = historySectionHTML({
    records: [makeRecord('r1', 'A', '2025-10-09', 3650)], calcDate: T,
  });
  assert.ok(html.includes('history__confirm'));
  assert.ok(html.includes('hidden'));
  assert.ok(html.includes('data-action="history-clear-confirm"'));
  assert.ok(html.includes('data-action="history-clear-cancel"'));
  assert.ok(html.includes('无法恢复'));
});

test('historySectionHTML：损坏与只读状态如实提示，只读时禁用写操作', () => {
  const corruptHtml = historySectionHTML({ records: [], calcDate: T, corrupt: true });
  assert.ok(corruptHtml.includes('损坏'));

  const readonlyHtml = historySectionHTML({ records: [], calcDate: T, readonly: true });
  assert.ok(readonlyHtml.includes('停用写入'));
  assert.ok(!readonlyHtml.includes('data-action="history-clear"'));   // 没有清空按钮
  assert.ok(readonlyHtml.includes('disabled'));                        // 导出禁用
});

test('recallBannerHTML：说明按今天重算，含退出按钮，名称转义', () => {
  const html = recallBannerHTML(makeRecord('r1', '<b>X</b>', '2025-10-09', 3650));
  assert.ok(html.includes('按今天的日期重新计算'));
  assert.ok(html.includes('持有天数变了，数字也会变'));
  assert.ok(html.includes('data-action="history-exit-recall"'));
  assert.ok(!html.includes('<b>'));
});

test('recallBannerHTML：无名称的记录显示「未命名设备」', () => {
  const html = recallBannerHTML(makeRecord('r1', '', '2025-10-09', 3650));
  assert.ok(html.includes('未命名设备'));
});
