'use strict';

/**
 * 短信验证码服务。
 * 演示环境只把验证码打到控制台 / 回显到接口，不真正发送。
 * 真实项目在这里对接阿里云 / 腾讯云短信 SDK。
 */

const crypto = require('crypto');
const config = require('../config');

/** 生成指定位数的数字验证码 */
function generateCode() {
  const { codeLength } = config.sms;
  const max = 10 ** codeLength;
  // 用 crypto 取随机数，避免 Math.random 可预测
  return String(crypto.randomInt(0, max)).padStart(codeLength, '0');
}

/**
 * 为一个 flow 生成 / 重发验证码。
 * @returns {{ok:boolean, code?:string, resendAfter?:number, reason?:string}}
 */
function issue(flow, account) {
  const now = Date.now();
  const current = flow.sms;

  // 重发间隔限制
  if (current && current.accountId === account.id && now - current.sentAt < config.sms.resendSeconds * 1000) {
    return {
      ok: false,
      reason: '发送过于频繁',
      resendAfter: Math.ceil((config.sms.resendSeconds * 1000 - (now - current.sentAt)) / 1000),
    };
  }

  const code = generateCode();
  flow.sms = {
    accountId: account.id,
    code,
    sentAt: now,
    expireAt: now + config.sms.ttlSeconds * 1000,
    attempts: 0,
    verified: false,
  };

  // TODO: 接入真实短信通道
  console.log(`[sms] 向 ${account.number} 发送验证码: ${code}（${config.sms.ttlSeconds}s 内有效）`);

  return { ok: true, code };
}

/**
 * 校验验证码。
 * @returns {{ok:boolean, reason?:string}}
 */
function verify(flow, account, code) {
  const sms = flow.sms;

  if (!sms || sms.accountId !== account.id) {
    return { ok: false, reason: '请先获取验证码' };
  }
  if (sms.verified) {
    return { ok: false, reason: '验证码已使用，请重新获取' };
  }
  if (Date.now() > sms.expireAt) {
    return { ok: false, reason: '验证码已过期，请重新获取' };
  }
  if (sms.attempts >= config.sms.maxAttempts) {
    return { ok: false, reason: '错误次数过多，请重新获取验证码' };
  }

  sms.attempts += 1;

  if (String(code || '').trim() !== sms.code) {
    return { ok: false, reason: '验证码不正确' };
  }

  sms.verified = true;
  return { ok: true };
}

module.exports = { issue, verify };
