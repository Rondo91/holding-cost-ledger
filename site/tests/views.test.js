import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fullResult } from '../assets/js/calc.js';
import {
  escapeHtml,
  baseSectionHTML,
  residualAreaHTML,
  fullSectionHTML,
  formulaHTML,
  ocrReviewHTML,
} from '../assets/js/views.js';

const T = '2025-01-01';

test('escapeHtml 挡住注入', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('a & b "c" \'d\''), 'a &amp; b &quot;c&quot; &#39;d&#39;');
  assert.equal(escapeHtml(null), '');
});

test('无结果时不渲染结果区', () => {
  assert.equal(baseSectionHTML(null), '');
  assert.equal(fullSectionHTML(null), '');
  assert.equal(fullSectionHTML(fullResult({ price: 100, purchaseDate: T, calcDate: T })), '');
});

test('基础结果区包含日均成本、持有天数与已投入金额', () => {
  const r = fullResult({ price: 5000, purchaseDate: '2024-01-01', calcDate: '2025-01-01' });
  const html = baseSectionHTML(r);
  assert.ok(html.includes('日均购置成本'));
  assert.ok(html.includes('¥13.62'));   // 5000 / 367
  assert.ok(html.includes('367 天'));
  assert.ok(html.includes('¥5,000'));
});

test('残值入口两种状态文案正确', () => {
  const pending = residualAreaHTML('pending');
  assert.ok(pending.includes('填写当前二手价'));
  assert.ok(pending.includes('暂时不需要'));
  assert.ok(!pending.includes('未计入残值'));

  // 明确跳过后要说明「未计入残值」，而不是显示 0 元
  const skipped = residualAreaHTML('skipped');
  assert.ok(skipped.includes('未计入残值'));
  assert.ok(!skipped.includes('¥0'));
  assert.ok(skipped.includes('现在补充二手价'));

  // 表单展开时不再重复引导
  assert.equal(residualAreaHTML('pending', { formOpen: true }), '');
});

test('残值已填写：收起表单后显示摘要与修改入口', () => {
  const point = residualAreaHTML('pending', { residual: 2200, isRange: false });
  assert.ok(point.includes('已填写当前二手价'));
  assert.ok(point.includes('¥2,200'));
  assert.ok(point.includes('修改二手价'));

  const range = residualAreaHTML('pending', { residual: [2000, 3000], isRange: true });
  assert.ok(range.includes('¥2,000 – ¥3,000'), `实际输出：${range}`);

  // 摘要态优先于「已跳过」提示（有值就不可能处于未计入状态）
  const withSkipped = residualAreaHTML('skipped', { residual: 2200 });
  assert.ok(withSkipped.includes('已填写当前二手价'));
  assert.ok(!withSkipped.includes('未计入残值'));
});

test('完整结果：点值形态', () => {
  const r = fullResult({ price: 5000, secondHand: 2000, purchaseDate: T, calcDate: T });
  const html = fullSectionHTML(r);
  assert.ok(html.includes('估算净持有支出'));
  assert.ok(html.includes('¥3,000'));
  assert.ok(html.includes('日均净持有支出'));
  assert.ok(html.includes('按实付回收率'));
  assert.ok(html.includes('40.0%'));
});

test('完整结果：已回本时改写为「净收益」而不是负数', () => {
  const r = fullResult({ price: 3000, secondHand: 4000, purchaseDate: T, calcDate: T });
  const html = fullSectionHTML(r);
  assert.ok(html.includes('已回本，净收益'));
  assert.ok(html.includes('¥1,000'));
  assert.ok(!html.includes('−¥1,000'), '不应把负号原样抛给用户');
  assert.ok(html.includes('133.3%'));
  assert.ok(html.includes('日均净收益'), '已回本时不应继续叫「支出」');
  assert.ok(!html.includes('日均净持有支出'));
});

test('完整结果：区间已回本时收益区间保持左小右大', () => {
  const r = fullResult({ price: 3000, secondHand: [4000, 6000], purchaseDate: T, calcDate: T });
  assert.deepEqual(r.netSpend, [-3000, -1000]);
  const html = fullSectionHTML(r);
  assert.ok(html.includes('已回本，净收益'));
  assert.ok(html.includes('¥1,000 – ¥3,000'), `实际输出：${html}`);
  assert.ok(html.includes('¥1,000.00 – ¥3,000.00'), '日均收益区间也要保持升序');
});

test('完整结果：区间跨越回本点时给出明确提示', () => {
  const r = fullResult({ price: 5000, secondHand: [4000, 6000], purchaseDate: T, calcDate: T });
  const html = fullSectionHTML(r);
  assert.ok(html.includes('跨越了回本点'));
  assert.ok(html.includes('估算净持有支出'));
});

test('公式区块覆盖全部口径并声明不做的事', () => {
  const html = formulaHTML();
  assert.ok(html.includes('日均购置成本 = P ÷ D'));
  assert.ok(html.includes('按实付回收率 = S ÷ P'));
  assert.ok(html.includes('max(1, T − 购买日期 + 1)'));
  assert.ok(html.includes('区间'));
  assert.ok(html.includes('不判断设备是否值得继续使用'));
});

test('AI 识别复核区：缺失字段标「未识别」，模型不确定的标「待确认」', () => {
  const html = ocrReviewHTML(
    { deviceName: 'iPhone 13', orderDate: '2024-03-15', paidAmount: 4999, platform: null },
    ['orderDate'],
  );
  assert.ok(html.includes('iPhone 13'));
  assert.ok(html.includes('2024-03-15'));
  assert.ok(html.includes('待确认'), '模型自标不确定的字段要提示待确认');
  assert.ok(html.includes('未识别，请填写'), '识别为空的字段要提示补填');
  assert.ok(html.includes('不会自动参与计算'));
});

test('AI 识别复核区对字段值做转义', () => {
  const html = ocrReviewHTML({ deviceName: '"><script>alert(1)</script>' }, []);
  assert.ok(!html.includes('<script>'));
});
