/**
 * ocr.js — 订单截图识别
 *
 * 产品立场：AI 只负责「读」，程序只负责「算」。
 *   - 识别结果永远不直接参与计算，必须经用户逐项确认
 *   - 模型自己标注为不确定的字段，界面上标「待确认」，绝不猜测填充
 *   - 截图不落库：只在浏览器内读成 data URL 后直接交给模型，走存储服务是做不到的
 *   - 任何环节失败都退化为纯手动，工具本身始终可用
 */

import { getCloud } from './cloud.js';
import { isCloudConfigured } from './config.js';

const MAX_ATTEMPTS = 5;              // 每次会话的识别次数上限，避免密钥通道被当作开放代理
const ATTEMPT_KEY = 'hcb_ocr_attempts';
const TIMEOUT_MS = 45000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** 一次识别里最多试几个模型。换模型只对「模型自己出问题」有意义 */
const MAX_MODEL_ATTEMPTS = 2;
const RETRYABLE_STATUS = new Set(['call_failed', 'parse_failed']);

const SYSTEM_PROMPT = [
  '你是一个电商订单信息抽取器。从用户提供的订单截图中抽取字段，只输出 JSON，不要输出任何解释文字。',
  '无法确定的字段必须置为 null，并把字段名放进 unsure 数组。绝不猜测、绝不编造。',
  '输出结构：{"deviceName": string|null, "orderDate": "YYYY-MM-DD"|null, "paidAmount": number|null, "platform": string|null, "unsure": string[]}',
  '字段规则：',
  '- deviceName：设备名称与规格（例如 iPhone 13 128G）。不含店铺名、赠品、配件。',
  '- orderDate：下单日期，统一为 YYYY-MM-DD。无法确定年份时置为 null。',
  '- paidAmount：订单实付金额，只取数字。截图里若同时出现原价、优惠、实付，取实付。',
  '  若订单包含多件商品而无法判断单件价格，置为 null 并加入 unsure。',
  '- platform：来源平台，例如 京东 / 淘宝 / 天猫 / 拼多多 / 苹果官网。',
].join('\n');

let cachedModels = null;
let lookupDone = false;

function attemptsUsed() {
  try {
    return Number(sessionStorage.getItem(ATTEMPT_KEY) || '0') || 0;
  } catch { return 0; }
}

function bumpAttempts() {
  try { sessionStorage.setItem(ATTEMPT_KEY, String(attemptsUsed() + 1)); } catch { /* 忽略 */ }
}

export function attemptsLeft() {
  return Math.max(0, MAX_ATTEMPTS - attemptsUsed());
}

/* ------------------------------------------------------------------ *
 * 模型选型（纯函数，可单测）
 * ------------------------------------------------------------------ */

/**
 * 把模型目录里可用的视觉模型按偏好排序。
 *
 * 排序理由：截图字段抽取是**窄任务且对延迟敏感**——它不需要推理，只需要一次准确的视觉读取。
 * 让一个推理模型用高思考强度去做这件事，用户要多等十几秒，准确率却不会更好。
 * 所以「非推理 + 平台默认」排最前，纯粹的推理模型排最后。
 *
 * 稀疏字段规则：只有显式 true 才认定「只走推理」；字段缺失视为未知，不因此排除。
 */
export function rankVisionModels(models) {
  const usable = (Array.isArray(models) ? models : []).filter(
    (m) => m && m.disabled !== true && m.supportsImages === true && m.disabledMultimodal !== true
  );
  if (usable.length === 0) return [];

  const declaredThinking = (m) => m.onlyReasoning === true;
  const rank = (m) => {
    if (!declaredThinking(m) && m.isDefault === true) return 0; // 默认项且不纯推理：最好
    if (!declaredThinking(m)) return 1;                          // 不纯推理
    if (m.isDefault === true) return 2;                          // 纯推理但是平台默认
    return 3;                                                    // 纯推理
  };

  // Array.prototype.sort 是稳定的，同档位保持目录原有顺序
  return [...usable].sort((a, b) => rank(a) - rank(b));
}

/**
 * 取出按偏好排序的候选模型。
 * @returns {Promise<{models: object[], reason: string|null}>}
 */
export async function resolveVisionModels() {
  const cloud = getCloud();
  if (!cloud) {
    return { models: [], reason: isCloudConfigured() ? 'no_cloud' : 'not_configured' };
  }
  if (lookupDone) {
    return cachedModels && cachedModels.length
      ? { models: cachedModels, reason: null }
      : { models: [], reason: 'no_model' };
  }

  try {
    const list = await cloud.llm.models.list();
    lookupDone = true;
    cachedModels = rankVisionModels(list);
    return cachedModels.length
      ? { models: cachedModels, reason: null }
      : { models: [], reason: 'no_model' };
  } catch {
    lookupDone = true;
    cachedModels = null;
    return { models: [], reason: 'lookup_failed' };
  }
}

/* ------------------------------------------------------------------ *
 * 单次调用
 * ------------------------------------------------------------------ */

/** 文件 → data URL（不经过任何网络与服务端存储） */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

/** 从累积的文本里取出 JSON 对象，容忍模型多写了解释文字或代码块围栏 */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(trimmed); } catch { /* 继续尝试更宽松的截取 */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
}

const STRING_FIELDS = ['deviceName', 'orderDate', 'paidAmount', 'platform'];

/** 归一化模型输出：类型不对就当作没识别出来，而不是硬塞给用户 */
function normalize(raw) {
  const data = {};
  const unsure = new Set(
    Array.isArray(raw?.unsure) ? raw.unsure.filter((f) => STRING_FIELDS.includes(f)) : []
  );

  for (const key of STRING_FIELDS) {
    const v = raw?.[key];
    if (v === null || v === undefined || v === '') {
      data[key] = null;
      unsure.add(key);
      continue;
    }
    if (key === 'paidAmount') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[，,\s¥￥元]/g, ''));
      if (Number.isFinite(n) && n > 0) data[key] = n;
      else { data[key] = null; unsure.add(key); }
      continue;
    }
    const s = String(v).trim();
    if (!s) { data[key] = null; unsure.add(key); continue; }
    if (key === 'orderDate' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      data[key] = null;
      unsure.add(key);
      continue;
    }
    data[key] = s.slice(0, 80);
  }

  return { data, unsure: [...unsure] };
}

/** 用指定模型识别一次 */
async function callModel(cloud, model, dataUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let text = '';
  let finishReason = null;

  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: model.id,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请从这张订单截图里抽取字段，按要求只输出 JSON。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: true,
      temperature: 0,
      response_format: { type: 'json_object' },
      signal: controller.signal,
    })) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) text += delta;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
  } catch (err) {
    const code = err?.error?.code || err?.code || '';
    return {
      ok: false,
      status: code === 'content_filter' ? 'content_filter' : 'call_failed',
      message: code === 'content_filter'
        ? '这张图片无法识别，请手动填写'
        : '识别没成功，可以直接手动填写，不影响后面的计算',
    };
  } finally {
    clearTimeout(timer);
  }

  if (finishReason === 'content_filter') {
    return { ok: false, status: 'content_filter', message: '这张图片无法识别，请手动填写' };
  }

  const raw = extractJson(text);
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 'parse_failed', message: '没能从截图里读出有效信息，请手动填写' };
  }

  const { data, unsure } = normalize(raw);
  if (STRING_FIELDS.every((k) => data[k] === null)) {
    return { ok: false, status: 'parse_failed', message: '这张截图里没找到可用的订单信息，请手动填写' };
  }

  return { ok: true, status: 'ok', data, unsure, modelName: model.name ?? model.id };
}

/* ------------------------------------------------------------------ *
 * 对外入口
 * ------------------------------------------------------------------ */

/**
 * 识别一张订单截图。
 *
 * @param {File} file
 * @param {{ onProgress?: (stage: string) => void }} [options]
 * @returns {Promise<{ok: boolean, status: string, data?: object, unsure?: string[], modelName?: string, message?: string}>}
 *   status: ok | invalid_file | too_large | rate_limited | not_configured | no_cloud | no_model
 *         | lookup_failed | call_failed | parse_failed | content_filter
 */
export async function recognizeOrderScreenshot(file, options = {}) {
  const report = (stage) => options.onProgress?.(stage);

  if (!file) return { ok: false, status: 'invalid_file', message: '没有拿到图片' };
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, status: 'invalid_file', message: '只支持 PNG、JPG、WebP 格式的截图' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, status: 'too_large', message: '图片超过 8MB，请压缩后再试' };
  }
  if (attemptsUsed() >= MAX_ATTEMPTS) {
    return { ok: false, status: 'rate_limited', message: '本次识别的次数已用完，请手动填写' };
  }

  report('读取图片');
  let dataUrl;
  try {
    dataUrl = await readAsDataURL(file);
  } catch {
    return { ok: false, status: 'invalid_file', message: '图片读取失败，请换一张试试' };
  }

  const { models, reason } = await resolveVisionModels();
  if (models.length === 0) {
    return {
      ok: false,
      status: reason || 'no_model',
      message: '截图识别当前不可用，请手动填写下面的字段',
    };
  }

  const cloud = getCloud();
  bumpAttempts();   // 一次用户动作算一次，不按模型重试次数计

  const candidates = models.slice(0, MAX_MODEL_ATTEMPTS);
  let lastFailure = { ok: false, status: 'call_failed', message: '识别没成功，请手动填写' };

  for (const model of candidates) {
    report(`识别中（${model.name ?? model.id}）`);
    const outcome = await callModel(cloud, model, dataUrl);
    if (outcome.ok) return outcome;

    lastFailure = outcome;
    // 内容被拦截、参数错误这类问题换模型也没用，直接收手
    if (!RETRYABLE_STATUS.has(outcome.status)) return outcome;
  }

  return lastFailure;
}
