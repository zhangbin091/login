'use strict';

/**
 * 极验 4.0 服务端接入。
 *
 * 真实模式（配置了 GEETEST_ID / GEETEST_KEY）：
 *   - 前端加载 gt4.js 调 initGeetest4，register 由 gt4.js 在浏览器里自行完成
 *   - 拿到 { lot_number, captcha_output, pass_token, gen_time } 后交给后端
 *   - 后端做二次校验（本文件的 validateReal）
 *
 * 模拟模式（未配置 KEY）：
 *   - prepare() 发放一个一次性的 lot_number
 *   - 前端用本地滑块组件完成"验证"
 *   - validateMock() 核对 lot_number + 票据，保证流程完整可跑
 *
 * 关于 register：极验 v4 的 /register 是给私有化部署 / 宕机兜底用的可选接口，
 * SaaS 账号通常直接返回 403。v4 标准接入只需要服务端实现 /validate，
 * 所以这里**不**用 register 探活来决定模式——否则真实极验永远不生效。
 */

const crypto = require('crypto');
const config = require('../config');

const VALIDATE_API = 'https://gcaptcha4.geetest.com/validate';

/** lot_number -> 过期时间戳（模拟模式用） */
const mockTickets = new Map();

function isRealMode() {
  if (config.geetest.disabled) return false;
  return Boolean(config.geetest.captchaId && config.geetest.captchaKey);
}

/** 清理过期的模拟票据 */
function sweepMockTickets() {
  const now = Date.now();
  for (const [lotNumber, expireAt] of mockTickets) {
    if (expireAt <= now) mockTickets.delete(lotNumber);
  }
}
setInterval(sweepMockTickets, 60 * 1000).unref();

/**
 * 前端初始化所需的下发数据。
 * 模式只由"是否配置了 ID/KEY"决定，不做网络探活，避免因第三方接口抖动而误降级。
 * @returns {Promise<{mode:'gt4'|'mock', captchaId?:string, scriptUrl?:string, lotNumber?:string}>}
 */
async function prepare() {
  if (isRealMode()) {
    return {
      mode: 'gt4',
      captchaId: config.geetest.captchaId,
      scriptUrl: config.geetest.scriptUrl,
    };
  }

  const lotNumber = crypto.randomUUID();
  mockTickets.set(lotNumber, Date.now() + config.geetest.mockTtlMs);
  return { mode: 'mock', lotNumber };
}

/**
 * 校验前端回传的极验参数。
 * @param {{lot_number:string, captcha_output:string, pass_token:string, gen_time:string}} params
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function validate(params) {
  if (!params || !params.lot_number) {
    return { ok: false, reason: '缺少验证参数' };
  }
  return isRealMode() ? validateReal(params) : validateMock(params);
}

/** 真实模式：向极验发起二次校验 */
async function validateReal(params) {
  const { lot_number: lotNumber, captcha_output: captchaOutput, pass_token: passToken, gen_time: genTime } = params;

  try {
    // sign_token = HMAC-SHA256(lot_number, captcha_key)
    const signToken = crypto
      .createHmac('sha256', config.geetest.captchaKey)
      .update(lotNumber)
      .digest('hex');

    const body = new URLSearchParams({
      lot_number: lotNumber,
      captcha_output: captchaOutput,
      pass_token: passToken,
      gen_time: genTime,
      sign_token: signToken,
    });

    const res = await fetch(`${VALIDATE_API}?captcha_id=${encodeURIComponent(config.geetest.captchaId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(5000),
    });

    const data = await res.json();
    if (data.result === 'success') return { ok: true };
    return { ok: false, reason: data.reason || '验证失败' };
  } catch (err) {
    console.error('[geetest] validate 请求失败:', err.message);
    return { ok: false, reason: '验证服务暂不可用' };
  }
}

/** 模拟模式：核对一次性 lot_number */
async function validateMock(params) {
  const { lot_number: lotNumber, captcha_output: captchaOutput } = params;

  const expireAt = mockTickets.get(lotNumber);
  if (!expireAt) return { ok: false, reason: '验证已失效，请重新验证' };
  mockTickets.delete(lotNumber); // 一次性，防重放

  if (expireAt <= Date.now()) return { ok: false, reason: '验证已过期，请重新验证' };
  if (captchaOutput !== 'mock-pass') return { ok: false, reason: '验证未通过' };

  return { ok: true };
}

module.exports = { prepare, validate, isRealMode };
