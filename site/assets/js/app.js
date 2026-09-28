/**
 * app.js — 工具页入口
 *
 * 单一 state 对象 + 单向渲染：任何输入变化 → derive() → render()。
 * 事件绑定全部走委托，结果区用 innerHTML 重绘，因此不依赖表单提交。
 */

import { fullResult } from './calc.js';
import {
  parseAmount, toDisplayAmount, priceBand, daysBand, recoveryBand,
} from './format.js';
import {
  validateDeviceName, validatePrice, validatePurchaseDate, validateSecondHand,
} from './validate.js';
import {
  baseSectionHTML, residualAreaHTML, fullSectionHTML, formulaHTML,
  ocrReviewHTML, escapeHtml,
} from './views.js';
import { track, initAnalytics, flush, submitFeedback } from './analytics.js';
import { recognizeOrderScreenshot, resolveVisionModels, attemptsLeft } from './ocr.js';
import { isCloudConfigured } from './config.js';

/* ------------------------------------------------------------------ *
 * DOM
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

const el = {
  device: $('#f-device'),
  date: $('#f-date'),
  price: $('#f-price'),
  eDevice: $('#e-device'),
  eDate: $('#e-date'),
  ePrice: $('#e-price'),

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

  formula: $('#formula-details'),
  formulaBody: $('#formula-body'),

  feedbackEntry: $('#feedback-entry'),
  feedback: $('#feedback'),
  fbSubmit: $('#fb-submit'),

  ocr: $('#ocr'),
  ocrFile: $('#ocr-file'),
  ocrFilename: $('#ocr-filename'),
  ocrProgress: $('#ocr-progress'),
  ocrResult: $('#ocr-result'),
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

/** pending → 未决定 / form-open → 表单展开 / skipped → 明确跳过 */
const state = {
  deviceName: '',
  purchaseDate: '',
  priceRaw: '',
  shMode: 'point',
  shPointRaw: '',
  shMinRaw: '',
  shMaxRaw: '',
  residualChoice: 'pending',
  touched: { device: false, date: false, price: false, sh: false },
  ocr: { data: null, unsure: [], busy: false, available: 'checking' },
  feedback: { helpful: null, nextAction: null },
};

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
  if (hasBase) {
    el.baseBody.innerHTML = baseSectionHTML(result);
    el.residualBody.innerHTML = residualAreaHTML(state.residualChoice);
    el.residualForm.hidden = state.residualChoice !== 'form-open';
    el.shPointWrap.hidden = state.shMode !== 'point';
    el.shRangeWrap.hidden = state.shMode !== 'range';
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

  // 反馈入口：看到结果之后才出现
  el.feedbackEntry.hidden = !hasBase;

  // 分段按钮状态
  el.shMode.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.shMode));
  });
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

function bindActions() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'residual-open') {
      state.residualChoice = 'form-open';
      render();
      el.sh.focus();
      return;
    }

    if (action === 'residual-skip') {
      state.residualChoice = 'skipped';
      track('residual_skipped', { step: 'residual' });
      render();
      return;
    }

    if (action === 'residual-close') {
      const { result } = derive();
      state.residualChoice = result && result.hasResidual ? 'form-open' : 'pending';
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
  el.ocrResult.hidden = true;
  el.ocrResult.innerHTML = '';
  track('ocr_upload_started', { step: 'input' });

  if (attemptsLeft() <= 0) {
    setOcrNote('本次识别的次数已用完，请手动填写。');
    track('ocr_fallback_manual', { props: { reason: 'rate_limited' } });
    return;
  }

  setOcrNote('正在识别，通常需要几秒…');
  state.ocr.busy = true;

  const out = await recognizeOrderScreenshot(file, {
    onProgress: (stage) => setOcrNote(`${stage}…`),
  });
  state.ocr.busy = false;

  if (!out.ok) {
    setOcrNote(out.message || '识别失败，请手动填写。');
    track('ocr_result', { props: { status: out.status } });
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
  track('ocr_result', {
    props: { status: 'ok', fields_found: found, fields_unsure: state.ocr.unsure.length },
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

  el.ocrResult.hidden = true;
  el.ocrResult.innerHTML = '';
  setOcrNote('已填入。下面是按识别结果算出的持有成本，请留意是否正确。');

  requestUpdate({ showErrors: true, settleNow: true });
  el.secBase.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------ *
 * 反馈
 * ------------------------------------------------------------------ */

function openFeedback() {
  el.feedback.hidden = false;
  track('feedback_opened', { step: 'full' });
  document.body.style.overflow = 'hidden';
}

function closeFeedback(answered) {
  el.feedback.hidden = true;
  document.body.style.overflow = '';
  if (!answered) track('feedback_dismissed', { step: 'full' });
}

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

  render();
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
