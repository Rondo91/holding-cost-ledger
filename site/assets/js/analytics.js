/**
 * analytics.js — 匿名埋点
 *
 * 两种运行模式：
 *   1. 云端模式（已配置云服务）——事件写入后台数据库，可跨用户聚合出真实指标
 *   2. 本地模式（未开通云服务）——事件写入浏览器 localStorage 的环形缓冲，只在本机可见
 *
 * 模式由 config.js 决定，代码路径完全一致，调用方无需关心。
 * 两种模式下的隐私约束相同：
 *   - 不要求注册，没有账号概念；session_id 由浏览器生成，关闭标签页即失效
 *   - 金额与日期一律不上报原文，只上报所属区间
 *   - 表结构里没有姓名、地址、手机号、订单号字段，这里也不会产生这些字段
 *   - 订单截图的内容与识别结果一律不上报，只上报成功/失败与命中字段数
 *
 * 上报失败绝不影响使用：所有异常都被吞掉并降级为控制台日志。
 */

import { getCloud } from './cloud.js';
import { isCloudConfigured } from './config.js';

const SESSION_KEY = 'hcb_session_id';
const LOCAL_EVENTS_KEY = 'hcb_events_local';
const LOCAL_FEEDBACK_KEY = 'hcb_feedback_local';
const LOCAL_MAX = 300;

const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE = 25;

/** 与数据表的 CHECK 约束保持一致，不在名单内的事件直接丢弃，避免整批写入被拒 */
const ALLOWED_EVENTS = new Set([
  'page_view', 'input_started', 'field_completed', 'base_result_viewed',
  'residual_prompt_shown', 'residual_entered', 'residual_skipped', 'full_result_viewed',
  'formula_expanded', 'formula_collapsed', 'feedback_opened', 'feedback_answered',
  'feedback_dismissed', 'ocr_upload_started', 'ocr_result', 'ocr_field_confirmed',
  'ocr_field_edited', 'ocr_fallback_manual', 'client_error',
]);

/** props 的键白名单，同样与数据表约束保持一致 */
const ALLOWED_PROP_KEYS = new Set([
  'field', 'price_band', 'days_band', 'residual_type', 'recovery_band',
  'status', 'reason', 'code', 'page', 'fields_found', 'fields_unsure', 'section',
  // AI 环节的可观测性：不记这两项就永远得靠人肉读屏幕才知道用了什么模型、花了多久
  'model', 'duration_ms',
]);

/**
 * 这些事件立即上报，不做批量等待。两个原因：
 *   1. 关键漏斗节点，页面一关就丢，会直接低估完成率
 *   2. 事件时间戳由数据库在写入时生成，批量上报最多会让它偏移数秒；
 *      而「中位完成时长」正是两个事件的时间戳相减，两端都必须准
 */
const MILESTONE_EVENTS = new Set([
  'page_view',
  'input_started',
  'base_result_viewed',
  'full_result_viewed',
  'feedback_answered',
]);

let sessionId = null;
let queue = [];
let timer = null;
let flushing = false;
let listenersBound = false;

function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* 某些环境禁用了 crypto */ }
  return `sess-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

export function getSessionId() {
  if (sessionId) return sessionId;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored && stored.length >= 8 && stored.length <= 64) {
      sessionId = stored;
      return sessionId;
    }
  } catch { /* 隐私模式下 sessionStorage 可能不可用 */ }

  sessionId = newId();
  try { sessionStorage.setItem(SESSION_KEY, sessionId); } catch { /* 同上 */ }
  return sessionId;
}

function sanitizeProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROP_KEYS.has(k)) continue;
    if (v === null || v === undefined || typeof v === 'object') continue;
    out[k] = typeof v === 'string' ? v.slice(0, 64) : v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 本地模式
 * ------------------------------------------------------------------ */

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function appendLocal(key, record) {
  try {
    const list = readLocal(key);
    list.push({ ...record, ts: new Date().toISOString() });
    while (list.length > LOCAL_MAX) list.shift();
    localStorage.setItem(key, JSON.stringify(list));
  } catch { /* 隐私模式或超出配额，静默放弃 */ }
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */

/**
 * 记录一个事件。
 * @param {string} eventName 必须在白名单内
 * @param {{ step?: 'input'|'base'|'residual'|'full', props?: object }} [options]
 */
export function track(eventName, options = {}) {
  if (!ALLOWED_EVENTS.has(eventName)) return;

  const step = ['input', 'base', 'residual', 'full'].includes(options.step)
    ? options.step
    : null;

  const entry = {
    session_id: getSessionId(),
    event_name: eventName,
    step,
    props: sanitizeProps(options.props),
  };

  if (!isCloudConfigured()) {
    appendLocal(LOCAL_EVENTS_KEY, entry);
    return;
  }

  queue.push(entry);
  if (queue.length >= MAX_QUEUE || MILESTONE_EVENTS.has(eventName)) {
    void flush();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * 把队列里的批次写进 calc_events。
 * 失败不重试、不堆积——埋点数据的重要性低于页面本身的可用性。
 */
export async function flush() {
  if (flushing || queue.length === 0) return;
  const cloud = getCloud();
  if (!cloud) { queue = []; return; }

  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const { error } = await cloud.database.from('calc_events').insert(batch);
    if (error) console.warn('[analytics] 事件上报被拒绝', error.code || error.message);
  } catch (err) {
    console.warn('[analytics] 事件上报失败（不影响使用）', err?.message || err);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

/**
 * 反馈两问写入独立表。只有用户点了提交才调用。
 * @returns {Promise<'cloud'|'local'|'failed'>} 实际落到哪里，用于给用户如实回话
 */
export async function submitFeedback(helpful, nextAction) {
  const record = { session_id: getSessionId(), helpful, next_action: nextAction };

  const cloud = getCloud();
  if (!cloud) {
    appendLocal(LOCAL_FEEDBACK_KEY, record);
    return 'local';
  }

  try {
    const { error } = await cloud.database.from('calc_feedback').insert(record);
    if (error) {
      console.warn('[analytics] 反馈写入被拒绝', error.code || error.message);
      return 'failed';
    }
    return 'cloud';
  } catch (err) {
    console.warn('[analytics] 反馈写入失败', err?.message || err);
    return 'failed';
  }
}

/** 页面隐藏或关闭时尽力把剩余事件送出去 */
export function initAnalytics() {
  if (listenersBound) return;
  listenersBound = true;

  const send = () => { void flush(); };
  globalThis.addEventListener?.('pagehide', send);
  globalThis.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send();
  });
}

/* ------------------------------------------------------------------ *
 * 本地模式下的自检入口
 * 没有后端时，事件只存在本机，用这两个方法取出来看。
 * 在浏览器控制台执行：__hcbEvents.dump()
 * ------------------------------------------------------------------ */

globalThis.__hcbEvents = {
  mode: () => (isCloudConfigured() ? 'cloud' : 'local'),
  dump: () => readLocal(LOCAL_EVENTS_KEY),
  dumpFeedback: () => readLocal(LOCAL_FEEDBACK_KEY),
  clear: () => {
    try {
      localStorage.removeItem(LOCAL_EVENTS_KEY);
      localStorage.removeItem(LOCAL_FEEDBACK_KEY);
    } catch { /* 忽略 */ }
  },
};
