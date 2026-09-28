/**
 * views.js — 结果区渲染
 *
 * 只负责「数据 → HTML 字符串」，不碰事件、不碰状态。
 * 数字层级：主金额（hero） > 日均与百分比（stat） > 公式与假设（details）
 */

import {
  formatCurrency,
  formatDaily,
  formatPercent,
  formatDays,
  formatCurrencyRange,
  formatDailyRange,
  formatPercentRange,
} from './format.js';
import { netZone } from './calc.js';

/** 所有插入 innerHTML 的用户输入都必须经过这里 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ *
 * 基础结果
 * ------------------------------------------------------------------ */

/**
 * 分区 B：只依赖 P 与 D，用户不需要查任何外部价格就能拿到。
 */
export function baseSectionHTML(result) {
  if (!result) return '';

  const hero = `
    <div class="result-hero">
      <div class="result-hero__label">日均购置成本</div>
      <div class="result-hero__value">${formatDaily(result.dailyAmortized)}<span class="unit">/天</span></div>
      <div class="result-hero__note">按 ${formatDays(result.days)} 摊分 · 估算值</div>
    </div>`;

  const stats = `
    <dl class="stats">
      <div class="stat">
        <dt class="stat__label">已持有</dt>
        <dd class="stat__value">${formatDays(result.days)}</dd>
      </div>
      <div class="stat">
        <dt class="stat__label">已投入金额</dt>
        <dd class="stat__value">${formatCurrency(result.invested)}</dd>
      </div>
    </dl>`;

  return hero + stats;
}

/**
 * 残值入口 / 状态说明。
 * 用户选择「暂时不需要」时明确说明未计入残值，而不是显示 0 元。
 */
export function residualAreaHTML(choice) {
  // 表单展开时不再显示引导，避免与表单重复
  if (choice === 'form-open') return '';

  if (choice === 'skipped') {
    return `
      <div class="notice notice--accent">
        <div class="notice__title">未计入残值</div>
        <p>你还没有填写当前二手价，因此没有计算净持有支出、日均净支出和回收率
        ——这些数值在没有残值的情况下没有意义，显示为 0 元会造成误读。</p>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn--ghost" data-action="residual-open">现在补充二手价</button>
      </div>`;
  }

  return `
    <div class="notice">
      <div class="notice__title">想知道这台设备现在还值多少？</div>
      <p>如果你刚在二手平台看过同款，可以把它填进来，就能看到扣除残值后的真实持有成本和回收率。
      <strong>没有查过也不用编一个</strong>——跳过不影响上面的结果。</p>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" data-action="residual-open">填写当前二手价</button>
      <button type="button" class="btn btn--ghost" data-action="residual-skip">暂时不需要</button>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * 完整结果
 * ------------------------------------------------------------------ */

/** 已回本时把「负支出」翻成正收益：取反会让左右顺序颠倒，必须同时交换 */
function asGain(values) {
  return Array.isArray(values) ? [-values[1], -values[0]] : -values;
}

function heroFor(fullResult) {
  const { netSpend, isRange, residual } = fullResult;
  const zone = netZone(netSpend);

  if (zone === 'payback') {
    const gainHTML = isRange
      ? formatCurrencyRange(asGain(netSpend))
      : formatCurrency(asGain(netSpend));
    return `
      <div class="result-hero">
        <div class="result-hero__label">已回本，净收益</div>
        <div class="result-hero__value">${gainHTML}</div>
        <div class="result-hero__note">
          预计二手价不低于当初实付金额，持有期间没有净支出 · 估算值
        </div>
      </div>`;
  }

  const valueHTML = isRange
    ? formatCurrencyRange(netSpend)
    : formatCurrency(netSpend);
  const residualText = isRange
    ? `按二手价 ${formatCurrencyRange(residual)} 估算`
    : `已扣除预计二手价 ${formatCurrency(residual)}`;

  const partialNote = zone === 'partial'
    ? `<div class="notice notice--warn">
         <div class="notice__title">这个区间跨越了回本点</div>
         <p>二手价的上下限分别落在买入价的两侧，所以净持有支出可能是支出、也可能已经回本。
         收窄二手价的范围会让结论更明确。</p>
       </div>`
    : '';

  return `
    <div class="result-hero">
      <div class="result-hero__label">估算净持有支出</div>
      <div class="result-hero__value">${valueHTML}</div>
      <div class="result-hero__note">${residualText} · 估算值</div>
    </div>
    ${partialNote}`;
}

function statsFor(fullResult) {
  const { dailyNet, recovery, isRange, netSpend } = fullResult;
  const payback = netZone(netSpend) === 'payback';

  // 已回本时不再叫「支出」：负支出换个标签读起来才成立
  const dailyValues = payback ? asGain(dailyNet) : dailyNet;
  const dailyHTML = isRange ? formatDailyRange(dailyValues) : formatDaily(dailyValues);
  const recoveryHTML = isRange ? formatPercentRange(recovery) : formatPercent(recovery);

  const dailyLabel = payback ? '日均净收益' : '日均净持有支出';
  const dailySub = payback
    ? '把回本的部分摊到每天，相当于每天赚回来的钱'
    : '扣除预计残值后，每天实际花掉的钱';

  return `
    <dl class="stats">
      <div class="stat">
        <dt class="stat__label">${dailyLabel}</dt>
        <dd class="stat__value">${dailyHTML}</dd>
        <dd class="stat__sub">${dailySub}</dd>
      </div>
      <div class="stat">
        <dt class="stat__label">按实付回收率</dt>
        <dd class="stat__value">${recoveryHTML}</dd>
        <dd class="stat__sub">预计二手价 ÷ 实际支付金额</dd>
      </div>
    </dl>`;
}

/** 分区 C：需要残值参与，因此只在用户提供二手价后出现 */
export function fullSectionHTML(result) {
  if (!result || !result.hasResidual) return '';
  return heroFor(result) + statsFor(result);
}

/* ------------------------------------------------------------------ *
 * 公式、口径与假设
 * ------------------------------------------------------------------ */

export function formulaHTML() {
  return `
    <div>
      <div class="details__label">符号定义</div>
      <ul class="assumption-list">
        <li><strong>P</strong> 实际支付金额：购买时实际支付的金额，已扣除优惠，不含订单中的其他商品</li>
        <li><strong>S</strong> 当前预计二手价：现在出售预计能收到的金额，建议填同款近期成交价而非平台挂牌价</li>
        <li><strong>D</strong> 持有天数：从购买日期到计算日期的自然日数，包含购买当天</li>
        <li><strong>T</strong> 计算日期：默认是打开页面的当天</li>
      </ul>
    </div>
    <div>
      <div class="details__label">计算口径</div>
      <ul class="formula-list">
        <li>D = max(1, T − 购买日期 + 1)</li>
        <li>已投入金额 = P</li>
        <li>日均购置成本 = P ÷ D</li>
        <li>估算净持有支出 = P − S</li>
        <li>日均净持有支出 = (P − S) ÷ D</li>
        <li>按实付回收率 = S ÷ P</li>
        <li class="formula-list__note">填写价格区间 [a, b] 时：净持有支出 = [P − b, P − a]，日均净支出 = [(P − b) ÷ D, (P − a) ÷ D]，回收率 = [a ÷ P, b ÷ P]</li>
      </ul>
    </div>
    <div>
      <div class="details__label">计算假设</div>
      <ul class="assumption-list">
        <li>持有天数按自然日计算，包含购买当天，因此当天买入记为 1 天</li>
        <li>未填写二手价时，不计算净持有支出与回收率，而不是按 0 元处理</li>
        <li>二手价由用户手动填入，属于估算；平台挂牌价通常高于实际成交价</li>
        <li>本工具只做成本计算，不判断设备是否值得继续使用，也不提供换机建议</li>
        <li>全部结果均为估算，不构成交易或投资建议</li>
      </ul>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * AI 识别结果复核
 * ------------------------------------------------------------------ */

const OCR_FIELDS = [
  { key: 'deviceName', label: '设备名称', type: 'text' },
  { key: 'orderDate', label: '下单日期', type: 'date' },
  { key: 'paidAmount', label: '实付金额', type: 'text' },
  { key: 'platform', label: '来源平台', type: 'text' },
];

/**
 * 识别结果一律以「待确认」状态呈现，用户逐字段确认或修改后才会写入计算。
 * @param {object} data 识别出的字段
 * @param {string[]} unsure 模型自己标注为不确定的字段名
 */
export function ocrReviewHTML(data = {}, unsure = []) {
  const rows = OCR_FIELDS.map((f) => {
    const raw = data[f.key];
    const value = raw === null || raw === undefined ? '' : String(raw);
    const missing = value.trim() === '';
    const flag = missing || unsure.includes(f.key);
    const inputType = f.type === 'date' ? 'date' : 'text';

    const note = missing
      ? '<span class="ocr-review__flag">未识别，请填写</span>'
      : flag
        ? '<span class="ocr-review__flag">待确认</span>'
        : '';

    return `
      <div class="ocr-review__row${flag ? ' ocr-review__row--unsure' : ''}"
           data-ocr-field="${f.key}">
        <label class="ocr-review__name" for="ocr-${f.key}">${f.label}</label>
        <div>
          <input class="ocr-review__input" id="ocr-${f.key}" type="${inputType}"
                 value="${escapeHtml(value)}" data-ocr-input="${f.key}">
          ${note}
        </div>
      </div>`;
  }).join('');

  return `
    <p class="ocr__desc" style="margin-top:0">
      识别结果不会自动参与计算。请逐项核对，修改后点「确认并填入」才会写入。
    </p>
    <div class="ocr-review">${rows}</div>`;
}
