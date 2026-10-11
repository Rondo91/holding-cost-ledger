/**
 * app.js — 工具页入口
 *
 * 单一 state 对象 + 单向渲染：任何输入变化 → derive() → render()。
 * 事件绑定全部走委托，结果区用 innerHTML 重绘，因此不依赖表单提交。
 */

import { fullResult } from './calc.js';
import {
  parseAmount, toDisplayAmount, priceBand, daysBand, recoveryBand, formatNumber,
} from './format.js';
import {
  validateDeviceName, validatePrice, validatePurchaseDate, validateSecondHand,
} from './validate.js';
// v2.1 改动过 views.js（刻度线）与 views-history.js（曲线常显 / 面积填充 / 排行条）。
// 版本号不能省：只给入口 app.js 加 ?v=，浏览器仍会拿旧模块——
// 新结构对不上新样式，页面只在老用户的缓存里坏掉。
import {
  baseSectionHTML, residualAreaHTML, fullSectionHTML, formulaHTML,
  ocrReviewHTML, escapeHtml,
} from './views.js?v=2.1.0';
import {
  benchmarkHintHTML, curveBlockHTML, historySectionHTML, recallBannerHTML,
} from './views-history.js?v=2.1.0';
import { benchmarkHint } from './benchmark.js';
import { CATEGORY_OPTIONS, categoryLabel, inferCategory } from './category.js';
import { curveWindow, curvePoints, curveSummary } from './curve.js';
import {
  MAX_RECORDS, loadHistory, saveToHistory, deleteFromHistory, clearHistory,
  exportHistoryJSON,
} from './history-store.js';
// v2.0 改动过这两个模块。版本号不能省：只给入口 app.js 加 ?v=
// 浏览器仍会拿缓存里的旧 analytics.js，而旧白名单不认 history_saved
// ——新事件会被数据库静默拒收，线上完全看不出异常。
import { track, initAnalytics, flush, submitFeedback } from './analytics.js?v=2.0.0';
import { recognizeOrderScreenshot, resolveVisionModels, attemptsLeft } from './ocr.js?v=2.0.0';
import { isCloudConfigured } from './config.js';

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

const el = {
  device: $('#f-device'),
  date: $('#f-date'),
  price: $('#f-price'),
  category: $('#f-category'),
  categoryHint: $('#h-category'),
  eDevice: $('#e-device'),
  eDate: $('#e-date'),
  ePrice: $('#e-price'),

  secInput: $('#sec-input'),
  recallBanner: $('#recall-banner'),
  saveRow: $('#save-row'),
  saveBtns: $('#save-btns'),
  saveNote: $('#save-note'),
  curveBody: $('#curve-body'),
  anchorSlot: $('#anchor-slot'),

  secBase: $('#sec-base'),
  baseBody: $('#base-body'),
  residualBody: $('#residual-body'),
  residualForm: $('#residual-form'),
  shMode: $('#sh-mode'),
  shPointWrap: $('#sh-point-wrap'),
  shRangeWrap: $('#sh-range-wrap'),
  sh: $('#f-sh'),
  shMin: $('#f-sh-min'),
  shMax: $('#f-sh-max'),
  eSh: $('#e-sh'),

  secFull: $('#sec-full'),
  fullBody: $('#full-body'),

  secHistory: $('#sec-history'),
  historyBody: $('#history-body'),

  formula: $('#formula-details'),
  formulaBody: $('#formula-body'),

  feedbackEntry: $('#feedback-entry'),
  feedback: $('#feedback'),
  fbSubmit: $('#fb-submit'),

  ocr: $('#ocr'),
  ocrFile: $('#ocr-file'),
  ocrFilename: $('#ocr-filename'),
  ocrThumb: $('#ocr-thumb'),
  ocrProgress: $('#ocr-progress'),
  ocrResult: $('#ocr-result'),
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/** residualChoice：pending 未决定 / skipped 明确跳过；residualFormOpen：表单是否展开（两者正交） */
const state = {
  deviceName: '',
  purchaseDate: '',
  priceRaw: '',
  category: 'auto',
  shMode: 'point',
  shPointRaw: '',
  shMinRaw: '',
  shMaxRaw: '',
  residualChoice: 'pending',
  residualFormOpen: false,
  touched: { device: false, date: false, price: false, sh: false },
  ocr: { data: null, unsure: [], busy: false, available: 'checking' },
  feedback: { helpful: null, nextAction: null },
  // 账本：只存本机，不上传。savedId 用于把「记入账本」按钮切成已记入态
  savedId: null,
  savedUpdated: false,
  recallId: null,
};

/* ------------------------------------------------------------------ *
 * 本地账本
 * ------------------------------------------------------------------ */

/**
 * history-store 只认 {getItem,setItem,removeItem} 接口，这里包一层 localStorage。
 * setItem 的异常（配额耗尽、隐私模式）不在这里吞掉——上层要把它翻译成用户能懂的提示。
 */
const historyStorage = {
  getItem: (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => {
    try { localStorage.removeItem(key); } catch { /* 忽略 */ }
  },
};

/** 今天的本地日期 YYYY-MM-DD（快照里记下计算日，供「上次 vs 今天」对比） */
function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 生效品类：手动选择优先，否则按设备名称推断。
 * 推断错了只影响参考锚点展示，不影响任何计算；用户可以随时手动改。
 */
function effectiveCategory() {
  if (state.category && state.category !== 'auto') return state.category;
  return inferCategory(state.deviceName);
}

/** 只在首次发生时才上报的节点 */
const firedOnce = new Set();
function trackOnce(key, eventName, options) {
  if (firedOnce.has(key)) return;
  firedOnce.add(key);
  track(eventName, options);
}

/**
 * 输入停稳后才把结果区揭示出来。
 *
 * 起因是上线后的第一组真实数据：价格输入到一半（输入「4」想看「4999」的花费）时，
 * 「看到基础结果」这个漏斗节点就已经触发了，把打了一半的数字当成了完成。
 * 这既让用户看到一闪而过的错数字，也让埋点记录了一个假的完成和一个假的金额档位。
 */
const RENDER_DEBOUNCE_MS = 200;   // 已展示过：轻微防抖，避免打字时数字乱跳
const SETTLE_MS = 900;            // 首次揭示：等输入停稳，失焦可直接提前
let resultsRevealed = false;
let renderTimer = null;
let settleTimer = null;

/* ------------------------------------------------------------------ *
 * Derive
 * ------------------------------------------------------------------ */

function currentSecondHand() {
  if (state.shMode === 'point') {
    const v = parseAmount(state.shPointRaw);
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  const a = parseAmount(state.shMinRaw);
  const b = parseAmount(state.shMaxRaw);
  const hasA = Number.isFinite(a);
  const hasB = Number.isFinite(b);
  if (hasA && hasB) return [a, b];
  // 区间只填了一边：按一个价格处理，比拒绝计算更符合实际使用
  if (hasA) return a;
  if (hasB) return b;
  return null;
}

function derive() {
  const price = parseAmount(state.priceRaw);
  const priceOk = Number.isFinite(price) && price > 0;
  const secondHand = currentSecondHand();

  const result = (priceOk && state.purchaseDate)
    ? fullResult({ price, purchaseDate: state.purchaseDate, secondHand })
    : null;

  return { price, priceOk, secondHand, result };
}

/* ------------------------------------------------------------------ *
 * 校验展示
 * ------------------------------------------------------------------ */

function applyFieldState(inputEl, errorEl, outcome, { show }) {
  const bad = Boolean(show && outcome && outcome.level === 'error');
  const soft = Boolean(show && outcome && outcome.level === 'warn');
  if (!inputEl) return;

  // 金额输入的外框是 .input-affix，样式要落在可见的边框上
  const target = inputEl.closest('.input-affix') || inputEl;
  target.classList.toggle('is-invalid', bad);
  target.classList.toggle('is-warn', !bad && soft);
  // 读屏需要知道字段本身无效；错误文本由 role="status" 的节点播报
  inputEl.setAttribute('aria-invalid', bad ? 'true' : 'false');

  if (!errorEl) return;

  if (bad || soft) {
    errorEl.textContent = outcome.message;
    errorEl.hidden = false;
    errorEl.style.color = bad ? '' : 'var(--warn-text)';
  } else {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }
}

function validateAll({ show }) {
  const vDevice = validateDeviceName(state.deviceName);
  const vDate = validatePurchaseDate(state.purchaseDate);
  const vPrice = validatePrice(state.priceRaw);
  const vSh = validateSecondHand(currentSecondHand() ?? '', parseAmount(state.priceRaw));

  applyFieldState(el.device, el.eDevice, vDevice, { show: show && state.touched.device });
  applyFieldState(el.date, el.eDate, vDate, { show: show && state.touched.date });
  applyFieldState(el.price, el.ePrice, vPrice, { show: show && state.touched.price });
  applyFieldState(el.sh, el.eSh, vSh, { show: show && state.touched.sh });

  return { vDevice, vDate, vPrice, vSh };
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

/* 当前处于可见状态的结果类元素：只在「隐藏 → 显示」的沿上播出现动画 */
const visibleNow = new WeakSet();

const prefersReducedMotion = () =>
  Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * 主数字滚动出场（v2.1）：只在结果区「首次揭示」时播一次，之后输入更新直接跳
 * ——已展示过还每次滚动的话，打字时数字会一直乱跳。区间形态（a – b）不滚，
 * 两个数同时滚没有意义；prefers-reduced-motion 下直接显示终值。
 */
function countUpHeroValue(scope) {
  const value = scope?.querySelector('.result-hero__value');
  const textNode = value?.firstChild;
  if (!textNode || textNode.nodeType !== 3) return;   // 数字必须是文本首节点
  if (prefersReducedMotion()) return;

  const raw = textNode.textContent.trim();
  const m = raw.match(/^¥([\d,]+(?:\.\d+)?)$/);
  if (!m) return;                                     // 区间 / 收益等形态直接显示

  const decimals = m[1].includes('.') ? m[1].split('.')[1].length : 0;
  const target = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(target) || target <= 0) return;

  const DURATION = 450;
  const start = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const frame = (now) => {
    const t = Math.min(1, (now - start) / DURATION);
    textNode.textContent = `¥${formatNumber(target * easeOut(t), decimals)}`;
    if (t < 1) requestAnimationFrame(frame);
    else textNode.textContent = raw;   // 收尾回到原字符串，避免格式化误差
  };
  textNode.textContent = `¥${formatNumber(0, decimals)}`;
  requestAnimationFrame(frame);
}

function animateNewlyShown() {
  [el.secBase, el.secFull, el.formula, el.feedbackEntry].forEach((node) => {
    if (!node) return;
    if (!node.hidden && !visibleNow.has(node)) {
      visibleNow.add(node);
      node.classList.remove('reveal-in');
      void node.offsetWidth;   // 重启动画（同一元素反复出现时）
      node.classList.add('reveal-in');
      // 结果区首次出现时，主数字滚动出场（两个结果分区各自一次）
      if (node === el.secBase) countUpHeroValue(el.baseBody);
      else if (node === el.secFull) countUpHeroValue(el.fullBody);
    } else if (node.hidden) {
      visibleNow.delete(node);
    }
  });
}

/**
 * 只做 DOM 更新，不产生任何埋点。
 * 埋点与「结果第一次真的被看到」绑定，出现的时机由 requestUpdate 决定。
 */
function render() {
  const { result } = derive();

  const hasBase = Boolean(result) && resultsRevealed;
  const hasFull = hasBase && result.hasResidual;

  // 分区 B
  el.secBase.hidden = !hasBase;
  el.saveRow.hidden = !hasBase;
  if (hasBase) {
    el.baseBody.innerHTML = baseSectionHTML(result);
    renderCurve(result);
    renderAnchor(result);
    updateSaveRow();
    el.residualBody.innerHTML = residualAreaHTML(state.residualChoice, {
      formOpen: state.residualFormOpen,
      residual: result.hasResidual ? result.residual : null,
      isRange: result.isRange,
    });
    el.residualForm.hidden = !state.residualFormOpen;
    el.shPointWrap.hidden = state.shMode !== 'point';
    el.shRangeWrap.hidden = state.shMode !== 'range';
  } else {
    el.curveBody.innerHTML = '';
    el.anchorSlot.innerHTML = '';
  }

  // 分区 C
  el.secFull.hidden = !hasFull;
  if (hasFull) el.fullBody.innerHTML = fullSectionHTML(result);

  // 公式与口径：有基础结果即可展开，但保持弱层级
  el.formula.hidden = !hasBase;
  if (hasBase && !el.formulaBody.dataset.ready) {
    el.formulaBody.innerHTML = formulaHTML();
    el.formulaBody.dataset.ready = '1';
  }

  // 反馈入口：看到「完整结果」之后才出现。
  // 两问针对的是净持有支出与回收率；只看到基础结果就提问，
  // 用户回答的是数字好不好看，不是它有没有影响判断（v1.6 口径变更，见 CHANGELOG）
  el.feedbackEntry.hidden = !hasFull;

  // 分段按钮状态
  el.shMode.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.shMode));
  });

  // 品类提示：只在自动识别成功时说明依据；手动选择后以用户判断为准，不再覆盖
  const inferred = state.category === 'auto' ? inferCategory(state.deviceName) : null;
  if (el.categoryHint) {
    if (inferred) {
      el.categoryHint.textContent =
        `按名称识别为：${categoryLabel(inferred)}。识别错了可以手动改——品类只影响参考区间，不影响计算。`;
      el.categoryHint.hidden = false;
    } else {
      el.categoryHint.hidden = true;
      el.categoryHint.textContent = '';
    }
  }

  animateNewlyShown();
}

/* ------------------------------------------------------------------ *
 * 衰减曲线与参考锚点
 * ------------------------------------------------------------------ */

/**
 * 曲线只依赖 P 与 D，有基础结果就能画。
 * 用签名比对避免每次输入都重绘——v2.1 起曲线常显，重绘不再有「折叠被合上」
 * 之虞，但白重绘一个 SVG 仍是不必要的开销。
 * v2.1 起 curve_expanded 埋点随「曲线常显」自然退役：用户不再需要任何展开
 * 动作，该事件没有对应行为，不再上报（数据表白名单保留，不删旧事件）。
 */
function renderCurve(result) {
  const sig = `${result.price}|${result.days}`;
  if (el.curveBody.dataset.sig === sig) return;
  el.curveBody.dataset.sig = sig;

  const summary = curveSummary({ price: result.price, days: result.days });
  if (!summary) { el.curveBody.innerHTML = ''; return; }

  const win = curveWindow(result.days);
  const points = curvePoints({ price: result.price, fromDay: win.fromDay, toDay: win.toDay });
  el.curveBody.innerHTML = curveBlockHTML(summary, {
    points,
    currentDay: result.days,
    currentDaily: summary.currentDaily,
  });
}

/**
 * 参考锚点：品类 × 持有年限段的行业区间，纯展示、不代填。
 * 品类未知时整块不渲染——「没识别出」和「这个品类没有可靠数据」是两件事，都要如实说。
 */
function renderAnchor(result) {
  const category = effectiveCategory();
  const sig = `${category}|${result.price}|${result.days}`;
  if (el.anchorSlot.dataset.sig === sig) return;
  el.anchorSlot.dataset.sig = sig;

  const hint = benchmarkHint({ category, daysHeld: result.days, price: result.price });
  el.anchorSlot.innerHTML = benchmarkHintHTML(hint);
  if (!hint) return;

  trackOnce('benchmark_hint_shown', 'benchmark_hint_shown', {
    step: 'residual',
    props: { category: category || 'unknown' },
  });

  const details = el.anchorSlot.querySelector('[data-benchmark]');
  if (!details || details.dataset.bound === '1') return;
  details.dataset.bound = '1';
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    trackOnce(`benchmark_hint_expanded:${category}`, 'benchmark_hint_expanded', {
      step: 'residual',
      props: { category: category || 'unknown' },
    });
  });
}

/* ------------------------------------------------------------------ *
 * 本地账本
 * ------------------------------------------------------------------ */

function loadHistoryState() {
  try {
    return loadHistory(historyStorage);
  } catch {
    return { records: [], corrupt: false, readonly: false };
  }
}

function renderHistory() {
  const h = loadHistoryState();
  el.secHistory.hidden = h.records.length === 0 && !h.corrupt && !h.readonly;
  el.historyBody.innerHTML = historySectionHTML({
    records: h.records,
    calcDate: new Date(),
    corrupt: h.corrupt,
    readonly: h.readonly,
    full: h.records.length >= MAX_RECORDS,
  });
  if (h.records.length > 0) {
    trackOnce('history_viewed', 'history_viewed', { step: 'history' });
  }
}

/** 账本区自己藏起来之后（例如清空），临时顶一条提示出来 */
function toastInHistory(text) {
  el.secHistory.hidden = false;
  el.historyBody.innerHTML = `<div class="notice" role="status">${escapeHtml(text)}</div>`;
  setTimeout(() => renderHistory(), 2500);
}

function showSaveNote(text) {
  if (!el.saveNote) return;
  if (!text) {
    el.saveNote.hidden = true;
    el.saveNote.textContent = '';
    return;
  }
  el.saveNote.textContent = text;
  el.saveNote.hidden = false;
}

/** 保存按钮区：记入后仍可再点以更新（补填二手价后需要更新同一条记录） */
function updateSaveRow() {
  if (!el.saveBtns) return;
  const saved = Boolean(state.savedId);
  el.saveBtns.innerHTML = `
    <button type="button" class="btn btn--ghost" data-action="history-save">
      ${saved ? '已记入 ✓' : '记入账本'}
    </button>
    ${saved ? '<button type="button" class="btn btn--quiet" data-action="history-goto">查看账本</button>' : ''}`;
}

const SAVE_FAILURE_TEXT = {
  full: `账本已满（${MAX_RECORDS} 条）。请先导出备份，再手动清理旧记录——本站绝不自动删除你的账本。`,
  quota: '浏览器存储空间不足，这条没有记上。可以先导出备份再清理。',
  readonly: '账本由更新版本创建，本页只展示、不修改。',
  invalid_input: '还没有可以记入的内容：至少要有购买日期和实付金额。',
  storage: '这次没能读到本地账本，请刷新页面重试。',
};

/**
 * 记入账本。手动点击才存——自动保存会把「随便试算一下」也写进账本，
 * 也会把隐私承诺从「你主动存的」放宽成「算过的都在浏览器里」。
 */
function saveCurrent() {
  const { result } = derive();
  if (!result) {
    showSaveNote(SAVE_FAILURE_TEXT.invalid_input);
    return;
  }

  const category = effectiveCategory() || 'other';
  const out = saveToHistory(historyStorage, {
    input: {
      deviceName: state.deviceName,
      purchaseDate: state.purchaseDate,
      price: result.price,
      category,
    },
    residual: result.hasResidual ? result.residual : null,
    snapshot: {
      calcDate: todayISO(),
      days: result.days,
      dailyAmortized: result.dailyAmortized,
      hasResidual: result.hasResidual,
      netSpend: result.netSpend ?? null,
      dailyNet: result.dailyNet ?? null,
      recovery: result.recovery ?? null,
    },
  });

  if (!out.ok) {
    showSaveNote(SAVE_FAILURE_TEXT[out.reason] || '记录失败，请稍后再试。');
    return;
  }

  state.savedId = out.id;
  state.savedUpdated = out.updated;
  track('history_saved', {
    step: 'history',
    props: {
      category,
      residual_type: result.hasResidual ? (result.isRange ? 'range' : 'point') : 'none',
    },
  });
  showSaveNote(out.updated ? '已更新这条记录。' : '已记入账本，记录只存在这台浏览器里。');
  renderHistory();
  updateSaveRow();
}

function scrollToId(node) {
  if (!node) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

/** 回看 = 回填表单后按今天的日期重算，结果由提示条说明「数字会变」 */
function recallRecord(id) {
  const record = loadHistoryState().records.find((r) => r.id === id);
  if (!record) return;

  state.deviceName = record.input.deviceName;
  state.purchaseDate = record.input.purchaseDate;
  state.priceRaw = String(record.input.price);
  state.category = record.input.category === 'other' ? 'auto' : record.input.category;
  state.residualChoice = 'pending';
  state.residualFormOpen = false;

  if (record.residual === null) {
    state.shMode = 'point';
    state.shPointRaw = '';
    state.shMinRaw = '';
    state.shMaxRaw = '';
  } else if (Array.isArray(record.residual)) {
    state.shMode = 'range';
    state.shMinRaw = String(record.residual[0]);
    state.shMaxRaw = String(record.residual[1]);
  } else {
    state.shMode = 'point';
    state.shPointRaw = String(record.residual);
  }

  el.device.value = state.deviceName;
  el.date.value = state.purchaseDate;
  el.price.value = state.priceRaw;
  if (el.category) el.category.value = state.category;
  el.sh.value = state.shPointRaw;
  el.shMin.value = state.shMinRaw;
  el.shMax.value = state.shMaxRaw;

  state.recallId = id;
  state.savedId = id;
  state.savedUpdated = true;
  el.recallBanner.innerHTML = recallBannerHTML(record);

  track('history_recall', { step: 'history', props: { category: record.input.category } });
  requestUpdate({ settleNow: true });
  scrollToId(el.secInput);
}

function resetForm() {
  state.deviceName = '';
  state.purchaseDate = '';
  state.priceRaw = '';
  state.category = 'auto';
  state.shMode = 'point';
  state.shPointRaw = '';
  state.shMinRaw = '';
  state.shMaxRaw = '';
  state.residualChoice = 'pending';
  state.residualFormOpen = false;
  state.touched = { device: false, date: false, price: false, sh: false };
  state.savedId = null;
  state.savedUpdated = false;
  state.recallId = null;

  el.device.value = '';
  el.date.value = '';
  el.price.value = '';
  if (el.category) el.category.value = 'auto';
  el.sh.value = '';
  el.shMin.value = '';
  el.shMax.value = '';
  el.recallBanner.innerHTML = '';
  el.curveBody.dataset.sig = '';
  el.anchorSlot.dataset.sig = '';
  resultsRevealed = false;
  showSaveNote('');
}

function exitRecall() {
  resetForm();
  requestUpdate();
}

/** 单条删除：按钮原地变「确认删除？」两步确认，零弹窗，3 秒后自动还原 */
const pendingDelete = new Map();
function requestDelete(btn, id) {
  if (pendingDelete.has(id)) {
    clearTimeout(pendingDelete.get(id));
    pendingDelete.delete(id);
    const out = deleteFromHistory(historyStorage, id);
    if (!out.ok) return;
    track('history_deleted', { step: 'history', props: { reason: 'single' } });
    if (state.recallId === id) exitRecall();
    if (state.savedId === id) { state.savedId = null; state.savedUpdated = false; }
    renderHistory();
    updateSaveRow();
    return;
  }
  pendingDelete.set(id, setTimeout(() => {
    pendingDelete.delete(id);
    renderHistory();
  }, 3000));
  btn.textContent = '确认删除？';
}

function clearAllHistory() {
  const out = clearHistory(historyStorage);
  if (!out.ok) return;
  track('history_deleted', { step: 'history', props: { reason: 'clear_all' } });
  if (state.recallId) exitRecall();
  state.savedId = null;
  state.savedUpdated = false;
  updateSaveRow();
  toastInHistory(`账本已清空，共移除 ${out.removed} 条记录。`);
}

function exportHistory() {
  const blob = new Blob([exportHistoryJSON(historyStorage)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `持有成本账本备份-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  track('history_exported', { step: 'history' });
}

/**
 * 漏斗埋点。只在输入停稳、结果已经真的展示给用户之后才记。
 * trackOnce 保证每个节点只记一次，所以这里可以放心地重复调用。
 */
function trackMilestones() {
  const { result } = derive();
  if (!result) return;

  trackOnce('residual_prompt_shown', 'residual_prompt_shown', { step: 'base' });
  trackOnce('base_result_viewed', 'base_result_viewed', {
    step: 'base',
    props: { price_band: priceBand(result.price), days_band: daysBand(result.days) },
  });

  if (result.hasResidual) {
    trackOnce('residual_entered', 'residual_entered', {
      step: 'residual',
      props: {
        residual_type: result.isRange ? 'range' : 'point',
        recovery_band: recoveryBand(result.isRange ? result.recovery[0] : result.recovery),
      },
    });
    trackOnce('full_result_viewed', 'full_result_viewed', { step: 'full' });
  }
}

function clearTimers() {
  if (renderTimer !== null) { clearTimeout(renderTimer); renderTimer = null; }
  if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
}

/** 结果首次出现：立刻揭示，并记下漏斗节点 */
function reveal() {
  clearTimers();
  resultsRevealed = true;
  render();
  trackMilestones();
}

/**
 * 输入变化后统一走这里。两条时间线各管各的：
 *   视觉（200ms）——结果已经展示过就防抖重画，打字过程中数字不乱跳
 *   判定（900ms）——等输入停稳再决定「结果算不算已经看到」，漏斗埋点只在这一刻记
 * 失焦、切换填写方式、应用识别结果属于用户明确结束输入，直接跳到判定。
 *
 * @param {{ showErrors?: boolean, settleNow?: boolean }} options
 */
function requestUpdate({ showErrors = false, settleNow = false } = {}) {
  validateAll({ show: showErrors });

  const { result } = derive();

  // 输入还不构成有效结果：收起结果区，并允许下次重新触发首次揭示
  if (!result) {
    clearTimers();
    resultsRevealed = false;
    render();
    return;
  }

  if (resultsRevealed) {
    if (renderTimer !== null) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, RENDER_DEBOUNCE_MS);
  }

  if (settleNow) { reveal(); return; }

  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    // 首次：揭示；之后：原地重画并补记可能新增的漏斗节点（例如刚填完残值）
    if (!resultsRevealed) { reveal(); return; }
    render();
    trackMilestones();
  }, SETTLE_MS);
}

/* ------------------------------------------------------------------ *
 * 字段事件
 * ------------------------------------------------------------------ */

function bindField(inputEl, stateKey, touchedKey, normalize) {
  inputEl.addEventListener('focus', () => {
    trackOnce('input_started', 'input_started', { step: 'input', props: { field: stateKey } });
  });

  inputEl.addEventListener('input', () => {
    state[stateKey] = inputEl.value;
    requestUpdate();
  });

  // date 控件在部分移动端浏览器上不触发 input，补一个 change
  inputEl.addEventListener('change', () => {
    state[stateKey] = inputEl.value;
    requestUpdate({ settleNow: true });
  });

  inputEl.addEventListener('blur', () => {
    state.touched[touchedKey] = true;

    // 金额在失焦时补上千分位；聚焦时保留纯数字，避免光标跳动
    if (normalize === 'amount' && inputEl.value.trim() !== '') {
      inputEl.value = toDisplayAmount(inputEl.value);
      state[stateKey] = inputEl.value;
    }
    requestUpdate({ showErrors: true, settleNow: true });

    if (inputEl.value.trim() === '') return;

    const outcome = stateKey === 'priceRaw'
      ? validatePrice(state.priceRaw)
      : stateKey === 'purchaseDate'
        ? validatePurchaseDate(state.purchaseDate)
        : validateDeviceName(state.deviceName);
    if (outcome.level === 'error') return;

    trackOnce(`field_completed:${stateKey}`, 'field_completed', {
      step: 'input',
      props: stateKey === 'priceRaw'
        ? { field: stateKey, price_band: priceBand(parseAmount(state.priceRaw)) }
        : { field: stateKey },
    });
  });
}

/* ------------------------------------------------------------------ *
 * 残值区事件
 * ------------------------------------------------------------------ */

function bindResidualInputs() {
  const map = [
    [el.sh, 'shPointRaw'],
    [el.shMin, 'shMinRaw'],
    [el.shMax, 'shMaxRaw'],
  ];
  map.forEach(([inputEl, key]) => {
    inputEl.addEventListener('input', () => {
      state[key] = inputEl.value;
      requestUpdate();
    });
    inputEl.addEventListener('blur', () => {
      state.touched.sh = true;
      if (inputEl.value.trim() !== '') {
        inputEl.value = toDisplayAmount(inputEl.value);
        state[key] = inputEl.value;
      }
      requestUpdate({ showErrors: true, settleNow: true });
    });
  });

  el.shMode.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (!btn) return;
    state.shMode = btn.dataset.mode;
    requestUpdate({ settleNow: true });
    (state.shMode === 'point' ? el.sh : el.shMin).focus();
  });
}

/* ------------------------------------------------------------------ *
 * 委托点击
 * ------------------------------------------------------------------ */

/**
 * 示例预填（v2.1）：访客不用先想数据就能看到产品输出。
 * 故意不新增埋点事件——示例值混进真实输入的统计会污染口径，
 * 而埋点白名单是数据库约束的一部分，不为教程功能改表。
 * 后续真实的输入/结果事件照常产生（用户确实看到了结果）。
 */
const DEMO_INPUT = {
  deviceName: 'iPhone 13 128G',
  purchaseDate: '2023-09-15',
  priceRaw: '4999',
};

function fillDemo() {
  state.deviceName = DEMO_INPUT.deviceName;
  state.purchaseDate = DEMO_INPUT.purchaseDate;
  state.priceRaw = DEMO_INPUT.priceRaw;
  state.category = 'auto';   // 让名称推断接管（iPhone → 手机）
  el.device.value = DEMO_INPUT.deviceName;
  el.date.value = DEMO_INPUT.purchaseDate;
  el.price.value = DEMO_INPUT.priceRaw;
  if (el.category) el.category.value = 'auto';
  requestUpdate({ settleNow: true });
}

function bindActions() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'demo-fill') {
      fillDemo();
      return;
    }

    if (action === 'residual-open') {
      state.residualFormOpen = true;
      render();
      el.sh.focus();
      return;
    }

    if (action === 'residual-skip') {
      state.residualChoice = 'skipped';
      state.residualFormOpen = false;
      track('residual_skipped', { step: 'residual' });
      render();
      return;
    }

    if (action === 'residual-close') {
      // 收起只关表单；已填的值由摘要态承接，用户随时能确认自己填过什么
      state.residualFormOpen = false;
      render();
      return;
    }

    if (action === 'feedback-open') {
      openFeedback();
      return;
    }

    if (action === 'ocr-confirm') {
      applyOcrResult();
      return;
    }

    /* ---- 账本 ---- */

    if (action === 'history-save') {
      saveCurrent();
      return;
    }

    if (action === 'history-goto') {
      scrollToId(el.secHistory);
      return;
    }

    if (action === 'history-recall') {
      recallRecord(btn.dataset.id);
      return;
    }

    if (action === 'history-delete') {
      requestDelete(btn, btn.dataset.id);
      return;
    }

    if (action === 'history-clear') {
      const bar = el.historyBody.querySelector('[data-role="history-clear-confirm"]');
      if (bar) bar.hidden = false;
      return;
    }

    if (action === 'history-clear-cancel') {
      const bar = el.historyBody.querySelector('[data-role="history-clear-confirm"]');
      if (bar) bar.hidden = true;
      return;
    }

    if (action === 'history-clear-confirm') {
      clearAllHistory();
      return;
    }

    if (action === 'history-export') {
      exportHistory();
      return;
    }

    if (action === 'history-exit-recall') {
      exitRecall();
      return;
    }
  });

  // 选项按钮
  document.addEventListener('click', (e) => {
    const choice = e.target.closest('.choice');
    if (!choice) return;
    const group = choice.closest('[data-q]');
    if (!group) return;
    const q = group.dataset.q;
    group.querySelectorAll('.choice').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    choice.setAttribute('aria-pressed', 'true');
    if (q === 'helpful') state.feedback.helpful = choice.dataset.value;
    if (q === 'next_action') state.feedback.nextAction = choice.dataset.value;
    el.fbSubmit.disabled = !(state.feedback.helpful && state.feedback.nextAction);
  });
}

/* ------------------------------------------------------------------ *
 * AI 截图识别
 * ------------------------------------------------------------------ */

function setOcrNote(text) {
  el.ocrProgress.hidden = false;
  el.ocrProgress.textContent = text;
}

/**
 * 每次模型尝试单独上报。
 * ocr_result 的 duration_ms 是整次识别的总时长、model 只记最终生效者——
 * 失败的那次尝试在汇总里是隐形的，所以「哪个模型快」这个问题一直没数据回答。
 * ocr_result 保持原样，两条时间线并存，历史数据不受影响。
 */
function trackOcrAttempts(out) {
  (out.attempts || []).forEach((a) => {
    track('ocr_attempt', {
      step: 'input',
      props: {
        attempt: String(a.attempt),
        model: a.modelName,
        duration_ms: a.durationMs,
        status: a.status,
      },
    });
  });
}

async function refreshOcrAvailability() {
  // 未配置模型服务时直接按不可用处理，不必发请求
  if (!isCloudConfigured()) {
    state.ocr.available = 'unavailable';
    markOcrUnavailable('本次部署未接入模型服务，识别能力不可用。请手动填写下面的字段，计算结果不受任何影响。');
    return;
  }
  const { models } = await resolveVisionModels();
  if (models.length === 0) {
    state.ocr.available = 'unavailable';
    markOcrUnavailable('识别能力当前不可用，请手动填写下面的字段。');
    return;
  }
  state.ocr.available = 'ready';
  const label = el.ocr.querySelector('label[for="ocr-file"]');
  if (label) label.hidden = false;
}

function markOcrUnavailable(message) {
  const label = el.ocr.querySelector('label[for="ocr-file"]');
  if (label) label.hidden = true;
  const tag = el.ocr.querySelector('.ocr__tag');
  if (tag) tag.textContent = '当前不可用';
  setOcrNote(message);
}

el.ocrFile?.addEventListener('change', async () => {
  const file = el.ocrFile.files?.[0];
  if (!file) return;

  el.ocrFilename.textContent = file.name;
  // 本地缩略图：只在浏览器内预览，让用户确认「就是这张图」
  if (el.ocrThumb) {
    if (el.ocrThumb.dataset.url) URL.revokeObjectURL(el.ocrThumb.dataset.url);
    const url = URL.createObjectURL(file);
    el.ocrThumb.dataset.url = url;
    el.ocrThumb.src = url;
    el.ocrThumb.hidden = false;
  }
  el.ocrResult.hidden = true;
  el.ocrResult.innerHTML = '';
  track('ocr_upload_started', { step: 'input' });

  if (attemptsLeft() <= 0) {
    setOcrNote('本次识别的次数已用完，请手动填写。');
    track('ocr_fallback_manual', { props: { reason: 'rate_limited' } });
    return;
  }

  // 实测一次识别约 10–20 秒（v1.3 duration_ms 落库值 18.2s），文案按实话说
  setOcrNote('正在识别，通常需要 10–20 秒…');
  state.ocr.busy = true;
  el.ocrProgress.classList.add('is-busy');

  const out = await recognizeOrderScreenshot(file, {
    onProgress: (stage) => setOcrNote(`${stage}…`),
  });
  state.ocr.busy = false;
  el.ocrProgress.classList.remove('is-busy');

  if (!out.ok) {
    setOcrNote(out.message || '识别失败，请手动填写。');
    trackOcrAttempts(out);
    track('ocr_result', {
      props: { status: out.status, model: out.modelName, duration_ms: out.durationMs },
    });
    if (out.status === 'not_configured' || out.status === 'no_model') {
      markOcrUnavailable('识别能力当前不可用，请手动填写下面的字段。');
    } else {
      track('ocr_fallback_manual', { props: { reason: out.status } });
    }
    return;
  }

  state.ocr.data = out.data;
  state.ocr.unsure = out.unsure || [];

  const found = Object.values(out.data).filter((v) => v !== null && v !== undefined).length;
  trackOcrAttempts(out);
  track('ocr_result', {
    props: {
      status: 'ok',
      fields_found: found,
      fields_unsure: state.ocr.unsure.length,
      model: out.modelName,
      duration_ms: out.durationMs,
    },
  });

  // 把用了哪个模型说出来。用户有权知道自己的截图交给了什么处理
  const via = out.modelName ? `（${out.modelName}）` : '';
  setOcrNote(`识别完成${via}。请核对下面每一项，确认后才会填入。`);
  el.ocrResult.innerHTML = `
    ${ocrReviewHTML(out.data, state.ocr.unsure)}
    <div class="btn-row">
      <button type="button" class="btn btn--primary" data-action="ocr-confirm">确认并填入</button>
      <button type="button" class="btn btn--quiet" data-action="ocr-cancel-manual">不用了，我手动填</button>
    </div>`;
  el.ocrResult.hidden = false;
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action="ocr-cancel-manual"]');
  if (!btn) return;
  el.ocrResult.hidden = true;
  el.ocrResult.innerHTML = '';
  setOcrNote('已切换为手动填写。');
  track('ocr_fallback_manual', { props: { reason: 'user_choice' } });
});

function initCategorySelect() {
  if (!el.category) return;
  el.category.innerHTML = CATEGORY_OPTIONS
    .map((o) => `<option value="${o.value}">${o.label}</option>`)
    .join('');
  el.category.value = state.category;
  el.category.addEventListener('change', () => {
    state.category = el.category.value;
    requestUpdate({ settleNow: true });
  });
}

/** 识别值与用户确认值是否等价（'4,999' 与 4999 视为一致） */
function sameValue(a, b) {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (sa === sb) return true;
  const na = parseAmount(sa);
  const nb = parseAmount(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

/**
 * 用户确认后才把识别结果写进计算状态。
 * 与原始识别值不一致的字段记为「被修改」，只上报字段名，不上报值。
 */
function applyOcrResult() {
  if (!state.ocr.data) return;

  const inputs = el.ocrResult.querySelectorAll('[data-ocr-input]');
  const confirmed = [];
  const edited = [];

  inputs.forEach((input) => {
    const key = input.dataset.ocrInput;
    const current = input.value.trim();
    if (current === '') return;

    if (!sameValue(state.ocr.data[key], current)) edited.push(key);
    else confirmed.push(key);

    if (key === 'deviceName') {
      state.deviceName = current;
      el.device.value = current;
    } else if (key === 'orderDate') {
      state.purchaseDate = current;
      el.date.value = current;
      state.touched.date = true;
    } else if (key === 'paidAmount') {
      state.priceRaw = toDisplayAmount(current);
      el.price.value = state.priceRaw;
      state.touched.price = true;
    }
    // platform 只用于展示，不参与计算
  });

  confirmed.forEach((f) => track('ocr_field_confirmed', { props: { field: f } }));
  edited.forEach((f) => track('ocr_field_edited', { props: { field: f } }));

  // 识别填入也算「字段完成」：原本只有手输失焦才记，导致识别这条路径在漏斗数据里是空白
  if (state.purchaseDate) {
    trackOnce('field_completed:purchaseDate', 'field_completed', {
      step: 'input',
      props: { field: 'purchaseDate' },
    });
  }
  const filledPrice = parseAmount(state.priceRaw);
  if (Number.isFinite(filledPrice)) {
    trackOnce('field_completed:priceRaw', 'field_completed', {
      step: 'input',
      props: { field: 'priceRaw', price_band: priceBand(filledPrice) },
    });
  }

  el.ocrResult.hidden = true;
  el.ocrResult.innerHTML = '';
  setOcrNote('已填入。下面是按识别结果算出的持有成本，请留意是否正确。');

  requestUpdate({ showErrors: true, settleNow: true });
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.secBase.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------ *
 * 反馈
 * ------------------------------------------------------------------ */

let feedbackLastFocus = null;

function openFeedback() {
  feedbackLastFocus = document.activeElement;
  el.feedback.hidden = false;
  track('feedback_opened', { step: 'full' });
  document.body.style.overflow = 'hidden';
  // 重新打开时恢复提交按钮（上次提交中被禁用/改写文案）
  el.fbSubmit.disabled = !(state.feedback.helpful && state.feedback.nextAction);
  el.fbSubmit.textContent = '提交';
  // aria-modal 声明了模态，焦点就必须真的进来
  el.feedback.querySelector('.feedback__panel')?.focus();
}

function closeFeedback(answered) {
  el.feedback.hidden = true;
  document.body.style.overflow = '';
  if (!answered) track('feedback_dismissed', { step: 'full' });
  // 焦点归还给触发者，键盘/读屏用户不丢位置
  if (feedbackLastFocus && typeof feedbackLastFocus.focus === 'function') {
    feedbackLastFocus.focus();
  }
  feedbackLastFocus = null;
}

/* Tab 键在弹层内循环，不逃逸到背景 */
el.feedback?.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || el.feedback.hidden) return;
  const items = Array.from(el.feedback.querySelectorAll('button:not([disabled])'));
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active.classList.contains('feedback__panel'))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});

el.fbSubmit?.addEventListener('click', async () => {
  const { helpful, nextAction } = state.feedback;
  if (!helpful || !nextAction) return;

  el.fbSubmit.disabled = true;
  el.fbSubmit.textContent = '提交中…';

  const status = await submitFeedback(helpful, nextAction);
  track('feedback_answered', { step: 'full' });
  void flush();

  el.fbSubmit.textContent = status === 'failed'
    ? '提交失败'
    : status === 'local'
      ? '已记录在本机'
      : '已提交，谢谢';
  setTimeout(() => {
    closeFeedback(true);
    el.fbSubmit.textContent = '提交';
  }, 700);
});

$('#fb-close')?.addEventListener('click', () => closeFeedback(false));

el.feedback?.addEventListener('click', (e) => {
  if (e.target === el.feedback) closeFeedback(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.feedback.hidden) closeFeedback(false);
});

/* ------------------------------------------------------------------ *
 * 公式展开埋点
 * ------------------------------------------------------------------ */

el.formula?.addEventListener('toggle', () => {
  track(el.formula.open ? 'formula_expanded' : 'formula_collapsed', {
    props: { section: 'formula' },
  });
});

/* ------------------------------------------------------------------ *
 * 初始化
 * ------------------------------------------------------------------ */

function init() {
  initAnalytics();
  track('page_view', { step: 'input', props: { page: 'tool' } });

  bindField(el.device, 'deviceName', 'device', 'raw');
  bindField(el.date, 'purchaseDate', 'date', 'raw');
  bindField(el.price, 'priceRaw', 'price', 'amount');
  bindResidualInputs();
  bindActions();
  initCategorySelect();

  render();
  renderHistory();
  void refreshOcrAvailability();

  // 键盘可达性：结果出现后不抢焦点，但让屏幕阅读器知道状态变了
  el.secBase?.setAttribute('aria-live', 'polite');
  el.secFull?.setAttribute('aria-live', 'polite');
}

// 任何未捕获的异常都记一笔，但绝不让它冒泡打断用户
window.addEventListener('error', (e) => {
  track('client_error', { props: { code: String(e?.message || 'unknown').slice(0, 40) } });
});

try {
  init();
} catch (err) {
  console.error('[app] 初始化失败', err);
  track('client_error', { props: { code: 'init_failed' } });
}
