/**
 * views-history.js — 账本 / 参考锚点 / 衰减曲线的渲染（纯函数）
 *
 * 只负责「数据 → HTML 字符串」，不碰事件、不碰状态。
 * 所有用户输入（设备名）必须经 escapeHtml；所有文案不粉饰：
 * 无参考数据就说没有，账本只在本机就说只在本机。
 */

import {
  formatCurrency, formatDaily, formatDays, formatNumber,
  formatCurrencyRange, formatPercentRange,
} from './format.js';
import { escapeHtml } from './views.js';
import { categoryLabel } from './category.js';
import { rankByDaily } from './history-store.js';

/* ------------------------------------------------------------------ *
 * 参考回收率锚点
 * ------------------------------------------------------------------ */

/**
 * 锚点是纯展示：给行业区间与口径声明，不给「你这台值多少」，也不提供一键填入。
 * @param {object|null} hint benchmarkHint() 的返回值；null 时不渲染
 */
export function benchmarkHintHTML(hint) {
  if (!hint) return '';

  if (hint.noData) {
    // 没有数据时把话说在 summary 上：点开发现「没有」是一种欺骗
    const summary = hint.bandLabel
      ? `不知道该填多少？${escapeHtml(hint.bandLabel)}有没有参考区间`
      : '不知道该填多少？看看有没有行业参考';
    const lead = hint.bandLabel
      ? `${escapeHtml(hint.categoryLabel)}持有${escapeHtml(hint.bandLabel)}：`
      : '';
    return `
      <details class="details details--hint" data-benchmark>
        <summary class="details__summary">${summary}</summary>
        <div class="details__body">
          <p>${lead}${escapeHtml(hint.note)}</p>
        </div>
      </details>`;
  }

  const percentText = formatPercentRange(hint.rangePercent);
  const amountText = hint.amountRange
    ? `按你的实付折算约 ${formatCurrencyRange(hint.amountRange, 0)}。`
    : '';
  const sources = (hint.sources || []).join('；');
  const sourceLine = sources
    ? `数据来源：${escapeHtml(sources)}${hint.cutoff ? ` · 截至 ${escapeHtml(hint.cutoff)}` : ''}`
    : '';

  return `
    <details class="details details--hint" data-benchmark>
      <summary class="details__summary">不知道该填多少？看看行业参考区间</summary>
      <div class="details__body">
        <p>${escapeHtml(hint.categoryLabel)}持有${escapeHtml(hint.bandLabel)}，行业报告的保值率大约在
        ${percentText}。${amountText}</p>
        <p class="benchmark__caliber"><strong>注意口径</strong>：${escapeHtml(hint.caliberNote)}</p>
        ${sourceLine ? `<p class="benchmark__source">${sourceLine}</p>` : ''}
      </div>
    </details>`;
}

/* ------------------------------------------------------------------ *
 * 日均成本衰减曲线
 * ------------------------------------------------------------------ */

/** 结论句直接嵌进 <summary>：不让用户点开才拿到答案，点开只是看形状 */
function curveSummaryText(summary) {
  const parts = [];
  if (summary.halfAhead) {
    parts.push(`再持有 ${formatDays(summary.halfAhead)}（与已持有时间相同），日均成本降到一半`);
  }
  if (summary.nextStep) {
    parts.push(`再持有 ${formatDays(summary.nextStep.daysAhead)}，降到 ${formatDaily(summary.nextStep.target)}/天以内`);
  }
  if (parts.length === 0) return '日均购置成本会随持有天数继续摊薄';
  return parts.join('；');
}

/**
 * 内联 SVG 曲线：当前点左侧实线（已经走过的摊分），右侧虚线（如果继续持有）。
 * 无图表库——一条双曲线用 polyline 足够，不值得为此引入依赖。
 */
function curveSVG({ points, currentDay, currentDaily }) {
  if (!Array.isArray(points) || points.length < 2) return '';
  const W = 640, H = 240;
  const padL = 64, padR = 20, padT = 18, padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const fromDay = points[0].day;
  const toDay = points[points.length - 1].day;
  const maxDaily = points[0].daily;   // 单调递减，首点即最大

  const x = (day) => padL + ((day - fromDay) / (toDay - fromDay)) * plotW;
  const y = (daily) => padT + (1 - daily / maxDaily) * plotH;

  const solid = points.filter((p) => p.day <= currentDay);
  const dashed = points.filter((p) => p.day >= currentDay);
  const toPoly = (list) => list.map((p) => `${x(p.day).toFixed(1)},${y(p.daily).toFixed(1)}`).join(' ');

  const gridMax = padT;
  const gridMid = padT + plotH / 2;
  const gridBase = padT + plotH;
  const label = (v) => formatCurrency(Math.round(v), 0);

  const dotX = x(currentDay).toFixed(1);
  const dotY = y(currentDaily).toFixed(1);

  return `
    <svg class="curve__svg" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="日均购置成本随持有天数下降的曲线：当前第 ${formatNumber(currentDay, 0)} 天，日均 ${formatDaily(currentDaily)}，之后继续摊薄">
      <g class="curve__grid">
        <line x1="${padL}" y1="${gridMax}" x2="${W - padR}" y2="${gridMax}"></line>
        <line x1="${padL}" y1="${gridMid}" x2="${W - padR}" y2="${gridMid}"></line>
        <line x1="${padL}" y1="${gridBase}" x2="${W - padR}" y2="${gridBase}"></line>
      </g>
      <g class="curve__labels">
        <text x="${padL - 8}" y="${gridMax + 4}" text-anchor="end">${label(maxDaily)}</text>
        <text x="${padL - 8}" y="${gridMid + 4}" text-anchor="end">${label(maxDaily / 2)}</text>
        <text x="${padL - 8}" y="${gridBase + 4}" text-anchor="end">¥0</text>
        <text x="${padL}" y="${H - 12}" text-anchor="middle">${formatNumber(fromDay, 0)} 天</text>
        <text x="${W - padR}" y="${H - 12}" text-anchor="end">${formatNumber(toDay, 0)} 天</text>
      </g>
      ${solid.length > 1 ? `<polyline class="curve__line" points="${toPoly(solid)}"></polyline>` : ''}
      ${dashed.length > 1 ? `<polyline class="curve__line curve__line--dashed" points="${toPoly(dashed)}"></polyline>` : ''}
      <line class="curve__now" x1="${dotX}" y1="${padT}" x2="${dotX}" y2="${gridBase}"></line>
      <circle class="curve__dot" cx="${dotX}" cy="${dotY}" r="4"></circle>
      <text class="curve__dot-label" x="${dotX}" y="${Number(dotY) - 10}" text-anchor="middle">${formatDaily(currentDaily)}</text>
    </svg>`;
}

/**
 * 分区 B 尾部的衰减曲线块。
 * @param {object|null} summary curveSummary() 的返回值
 * @param {{ points: object[], currentDay: number, currentDaily: number }} svgData
 */
export function curveBlockHTML(summary, svgData) {
  if (!summary) return '';
  return `
    <details class="details details--curve" id="curve-details">
      <summary class="details__summary">${curveSummaryText(summary)}</summary>
      <div class="details__body">
        ${curveSVG(svgData)}
        <p class="curve__note">这条曲线只做一件事：把已付金额摊到更多天。摊分数学不等于继续持有更划算
        ——本工具不判断该不该留，也不构成任何建议。</p>
      </div>
    </details>`;
}

/* ------------------------------------------------------------------ *
 * 账本区
 * ------------------------------------------------------------------ */

function residualStateText(record) {
  if (record.residual === null) return '残值未计入';
  if (Array.isArray(record.residual)) {
    return `已按 ${formatCurrencyRange(record.residual)} 折算`;
  }
  return `已按 ${formatCurrency(record.residual)} 折算`;
}

/** 「上次 ¥4.07/天 → 今天 ¥3.86/天」：快照只用来做对比提示 */
function snapshotCompareText(record, todayDaily) {
  const last = record.snapshot?.dailyAmortized;
  if (typeof last !== 'number' || !Number.isFinite(last)) return '';
  if (Math.abs(last - todayDaily) < 0.005) return '';
  return `<span class="history__trend">上次 ${formatDaily(last)}/天 → 今天 ${formatDaily(todayDaily)}/天</span>`;
}

function historyRowHTML(entry) {
  const { record, days, daily } = entry;
  const name = record.input.deviceName.trim() || '未命名设备';
  const cat = categoryLabel(record.input.category);
  const id = escapeHtml(record.id);

  return `
    <li class="history__row" data-record-id="${id}">
      <div class="history__info">
        <span class="history__name">${escapeHtml(name)}</span>
        ${cat ? `<span class="history__cat">${escapeHtml(cat)}</span>` : ''}
      </div>
      <div class="history__nums">
        <span class="history__daily">${formatDaily(daily)}<span class="unit">/天</span></span>
        <span class="history__meta">已持有 ${formatDays(days)} · ${residualStateText(record)}</span>
        ${snapshotCompareText(record, daily)}
      </div>
      <div class="history__ops">
        <button type="button" class="btn btn--quiet" data-action="history-recall" data-id="${id}">回看</button>
        <button type="button" class="btn btn--quiet" data-action="history-delete" data-id="${id}">删除</button>
      </div>
    </li>`;
}

function rankCardHTML(ranked) {
  if (ranked.length < 2) return '';
  const top = ranked.slice(0, 3);
  const items = top.map((entry, i) => {
    const name = entry.record.input.deviceName.trim() || '未命名设备';
    return `
      <li class="rank__item">
        <span class="rank__no">${i + 1}</span>
        <span class="rank__name">${escapeHtml(name)}</span>
        <span class="rank__daily">${formatDaily(entry.daily)}<span class="unit">/天</span></span>
      </li>`;
  }).join('');
  return `
    <div class="rank">
      <div class="rank__title">还在持有的设备里，日均最贵的是——</div>
      <ol class="rank__list">${items}</ol>
      <p class="rank__note">按今天的持有天数计算，仅对比日均购置成本；
      净支出排行需要每台都补充二手价，缺一台就不可比，所以不排。</p>
    </div>`;
}

/**
 * 账本区完整 HTML（section 内部）。
 * 数字一律按今天重算：快照排行没有可比性，各条记录的快照日期不同。
 */
export function historySectionHTML({ records, calcDate = new Date(), corrupt = false, readonly = false, full = false } = {}) {
  const ranked = rankByDaily(records, calcDate);
  const count = ranked.length;

  const notices = [];
  if (corrupt) {
    notices.push(`
      <div class="notice notice--warn">
        <div class="notice__title">账本数据损坏，已重置</div>
        <p>原内容已备份在浏览器里（hcb_history_corrupt）。如果你需要找回，请导出浏览器存储后检查。</p>
      </div>`);
  }
  if (readonly) {
    notices.push(`
      <div class="notice notice--warn">
        <div class="notice__title">账本由更新版本创建，已停用写入</div>
        <p>为避免损坏数据，本页面只展示、不修改。回看仍可用。</p>
      </div>`);
  }
  if (full) {
    notices.push(`
      <div class="notice notice--warn">
        <div class="notice__title">账本已满（200 条）</div>
        <p>继续记入前请先导出备份，再手动清理旧记录——本站绝不自动删除你的账本。</p>
      </div>`);
  }

  const rows = ranked.map(historyRowHTML).join('');
  const exportDisabled = readonly ? ' disabled' : '';

  return `
    ${notices.join('')}
    ${rankCardHTML(ranked)}
    <ul class="history__list">${rows}</ul>
    <p class="history__privacy">共 ${formatNumber(count, 0)} 条记录。数字按今天的日期重新计算，每天打开都会变
    ——这是「按天摊分」的口径属性。记录只保存在这台浏览器里，不上传、不联网；
    清空浏览器数据会一并丢失，重要记录建议定期导出。共用电脑请注意：任何使用这台浏览器的人都能看到账本。</p>
    <div class="btn-row history__actions">
      <button type="button" class="btn btn--ghost" data-action="history-export"${exportDisabled}>导出备份</button>
      ${readonly ? '' : `<button type="button" class="btn btn--quiet" data-action="history-clear">清空账本</button>`}
    </div>
    <div class="history__confirm" data-role="history-clear-confirm" hidden>
      <span>清空后无法恢复，共 ${formatNumber(count, 0)} 条记录。</span>
      <button type="button" class="btn btn--primary" data-action="history-clear-confirm">确认清空</button>
      <button type="button" class="btn btn--quiet" data-action="history-clear-cancel">取消</button>
    </div>`;
}

/** 回看提示条：回填表单后出现在表单上方 */
export function recallBannerHTML(record) {
  const name = record?.input?.deviceName?.trim() || '未命名设备';
  return `
    <div class="recall-banner" role="status">
      <p>正在回看「${escapeHtml(name)}」的记录。结果按今天的日期重新计算
      ——持有天数变了，数字也会变。</p>
      <button type="button" class="btn btn--quiet" data-action="history-exit-recall">退出回看</button>
    </div>`;
}
