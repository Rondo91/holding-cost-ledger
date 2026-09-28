/**
 * validate.js — 输入校验（纯函数）
 *
 * 原则：必填项尽量少（日期 + 买入价即可出第一个结果）；
 *       能提示的不拦截，真正无意义的才拦。
 * 返回统一形状：{ ok, level: 'error'|'warn'|null, message }
 */

const MAX_PRICE = 200000;      // 软上限，超出提示确认而非拒绝
const MAX_NAME_LEN = 60;
const MAX_AGE_YEARS = 25;      // 购买日期不能早于今天往前 25 年

const OK = Object.freeze({ ok: true, level: null, message: '' });

const err = (message) => ({ ok: false, level: 'error', message });
const warn = (message) => ({ ok: true, level: 'warn', message });

/** 今天的本地零点 */
function todayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDateParts(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** 设备名称：选填 */
export function validateDeviceName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length > MAX_NAME_LEN) {
    return err(`名称请控制在 ${MAX_NAME_LEN} 字以内`);
  }
  return OK;
}

/** 实际支付金额：必填，> 0 */
export function validatePrice(value) {
  if (value === '' || value === null || value === undefined) {
    return err('请填写实际支付金额');
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[，,\s¥￥]/g, ''));
  if (!Number.isFinite(n)) return err('金额格式不正确，请填写数字');
  if (n <= 0) return err('金额需大于 0');
  if (n > MAX_PRICE) {
    return warn('金额较大，请确认是否包含了订单中的其他商品');
  }
  return OK;
}

/** 购买日期：必填，不能是未来，不能过于久远 */
export function validatePurchaseDate(value, now = new Date()) {
  if (!value) return err('请选择购买日期');
  const date = parseDateParts(value);
  if (!date) return err('日期格式不正确');

  const today = todayStart(now);
  if (date.getTime() > today.getTime()) {
    return err('购买日期不能晚于今天');
  }

  const floor = new Date(today.getFullYear() - MAX_AGE_YEARS, today.getMonth(), today.getDate());
  if (date.getTime() < floor.getTime()) {
    return warn('购买日期较早，请确认是否填错');
  }
  return OK;
}

/**
 * 当前预计二手价：选填。
 * 传入数字视为点值，传入 { min, max } 视为区间。
 * 无二手价是完全正常的状态，此时返回 OK。
 */
export function validateSecondHand(value, price) {
  if (value === '' || value === null || value === undefined) return OK;

  const P = Number(price);

  if (typeof value === 'object' && !Array.isArray(value)) {
    const a = Number(value.min);
    const b = Number(value.max);
    if (!Number.isFinite(a) && !Number.isFinite(b)) return err('请填写有效的价格');
    if (Number.isFinite(a) && a < 0) return err('价格不能为负数');
    if (Number.isFinite(b) && b < 0) return err('价格不能为负数');
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      return err('区间下限不能大于上限');
    }
    if (Number.isFinite(P) && P > 0) {
      const top = Number.isFinite(b) ? b : a;
      if (top > P * 3) return warn('二手价远高于买入价，请确认是否填错');
    }
    return OK;
  }

  const n = typeof value === 'number' ? value : Number(String(value).replace(/[，,\s¥￥]/g, ''));
  if (!Number.isFinite(n)) return err('价格格式不正确，请填写数字');
  if (n < 0) return err('价格不能为负数');
  if (Number.isFinite(P) && P > 0 && n > P * 3) {
    return warn('二手价远高于买入价，请确认是否填错');
  }
  return OK;
}

/** 把一条校验结果合并进汇总状态（取最严重的一级） */
export function mergeLevel(results) {
  if (results.some((r) => r && r.level === 'error')) return 'error';
  if (results.some((r) => r && r.level === 'warn')) return 'warn';
  return null;
}

export const LIMITS = Object.freeze({ MAX_PRICE, MAX_NAME_LEN, MAX_AGE_YEARS });
