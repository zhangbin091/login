'use strict';

/**
 * 业务接口。
 * 统一响应结构：{ code, message, data }
 *   code = 0 表示成功，非 0 见 CODES。
 * 业务失败一律返回 HTTP 200 + 非 0 code，方便前端统一处理；
 * 只有"未登录"这类需要跳转的用 401。
 */

const express = require('express');

const config = require('../config');
const geetest = require('../services/geetest');
const userService = require('../services/user');
const flowService = require('../services/flow');
const smsService = require('../services/sms');
const rateLimit = require('../services/rateLimit');

const router = express.Router();

const CODES = {
  OK: 0,
  PARAM: 1001,
  GEETEST_FAIL: 1002,
  BAD_CREDENTIALS: 1003,
  TOO_FREQUENT: 1004,
  FLOW_INVALID: 1005,
  ACCOUNT_INVALID: 1006,
  SMS_TOO_FREQUENT: 1007,
  SMS_INVALID: 1008,
  UNAUTHORIZED: 1009,
};

const ok = (res, data = null, message = 'ok') => res.json({ code: CODES.OK, message, data });
const fail = (res, code, message, data = null) => res.json({ code, message, data });

/** 取客户端 IP，兼容反向代理 */
function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.ip || req.connection.remoteAddress || '';
}

/** 统一取出 flow，顺带做有效性校验 */
function requireFlow(req, res) {
  const flow = flowService.get(req.body.ticket || req.query.ticket, req.sessionID);
  if (!flow) {
    fail(res, CODES.FLOW_INVALID, '登录会话已失效，请重新登录');
    return null;
  }
  return flow;
}

/**
 * ① 极验初始化：下发前端所需配置
 *    真实模式返回 captchaId，模拟模式返回一次性 lotNumber
 */
router.post('/geetest/register', async (req, res) => {
  try {
    const data = await geetest.prepare();
    ok(res, data);
  } catch (err) {
    console.error('[api] geetest/register', err);
    fail(res, CODES.GEETEST_FAIL, '验证初始化失败，请稍后重试');
  }
});

/**
 * ② 账密校验
 *    入参: { username, password, geetest: { lot_number, captcha_output, pass_token, gen_time } }
 *    出参: { ticket }  —— 后续用短信环节都靠它
 */
router.post('/login/credentials', async (req, res) => {
  const { username, password, geetest: gtParams } = req.body || {};
  const ip = clientIp(req);

  if (!username || !password) {
    return fail(res, CODES.PARAM, '请输入用户名和密码');
  }

  // 1) 频率限制：锁定期间直接拒绝，不再消耗验证资源
  const limit = rateLimit.check(username, ip);
  if (limit.locked) {
    return fail(res, CODES.TOO_FREQUENT, `操作过于频繁，请 ${limit.retryAfter} 秒后再试`, {
      retryAfter: limit.retryAfter,
    });
  }

  // 2) 极验二次校验（必须在服务端做，否则前端可绕过）
  try {
    const result = await geetest.validate(gtParams);
    if (!result.ok) {
      rateLimit.fail(username, ip);
      return fail(res, CODES.GEETEST_FAIL, result.reason || '验证未通过，请重新验证');
    }
  } catch (err) {
    console.error('[api] geetest validate', err);
    return fail(res, CODES.GEETEST_FAIL, '验证服务异常，请稍后重试');
  }

  // 3) 用户名 / 密码校验
  const user = userService.verifyCredentials(username, password);
  if (!user) {
    const bucket = rateLimit.fail(username, ip);
    const remain = bucket.lockedUntil
      ? 0
      : Math.max(0, config.loginLimit.maxFailures - bucket.failures);
    return fail(res, CODES.BAD_CREDENTIALS, '用户名或密码错误', { remainAttempts: remain });
  }

  rateLimit.reset(username, ip);

  // 4) 生成流程票据
  const ticket = flowService.create({
    userId: user.id,
    username: user.username,
    nickname: user.nickname,
    sessionId: req.sessionID,
  });

  ok(res, { ticket });
});

/**
 * ③ 用户账号查询：返回脱敏手机号列表
 */
router.get('/account/phones', (req, res) => {
  const flow = requireFlow(req, res);
  if (!flow) return;
  ok(res, { accounts: flowService.publicAccounts(flow) });
});

/**
 * ④ 发送短信验证码
 *    入参: { ticket, accountId }
 */
router.post('/sms/send', (req, res) => {
  const flow = requireFlow(req, res);
  if (!flow) return;

  const account = flowService.findAccount(flow, req.body.accountId);
  if (!account) {
    return fail(res, CODES.ACCOUNT_INVALID, '所选账号无效，请重新登录');
  }

  const result = smsService.issue(flow, account);
  if (!result.ok) {
    return fail(res, CODES.SMS_TOO_FREQUENT, result.reason, { resendAfter: result.resendAfter });
  }

  ok(
    res,
    {
      masked: userService.maskPhone(account.number),
      ttl: config.sms.ttlSeconds,
      resendAfter: config.sms.resendSeconds,
      // 仅开发环境回显，生产环境为 undefined
      devCode: config.sms.exposeCode ? result.code : undefined,
    },
    '验证码已发送'
  );
});

/**
 * ⑤ 校验短信验证码 -> 登录成功
 *    入参: { ticket, accountId, code }
 */
router.post('/sms/verify', (req, res) => {
  const flow = requireFlow(req, res);
  if (!flow) return;

  const { accountId, code } = req.body || {};
  if (!accountId || !code) {
    return fail(res, CODES.PARAM, '请选择手机号并输入验证码');
  }

  const account = flowService.findAccount(flow, accountId);
  if (!account) {
    return fail(res, CODES.ACCOUNT_INVALID, '所选账号无效，请重新登录');
  }

  const result = smsService.verify(flow, account, code);
  if (!result.ok) {
    return fail(res, CODES.SMS_INVALID, result.reason);
  }

  // 登录成功：写入会话，销毁流程票据
  req.session.user = {
    id: flow.userId,
    username: flow.username,
    nickname: flow.nickname,
    phone: userService.maskPhone(account.number),
    loginAt: Date.now(),
  };
  flowService.remove(flow.ticket);

  ok(res, { redirect: '/success' }, '登录成功');
});

/** 当前登录态 */
router.get('/session', (req, res) => {
  if (!req.session || !req.session.user) {
    return fail(res, CODES.UNAUTHORIZED, '未登录');
  }
  ok(res, { user: req.session.user });
});

/** 退出登录 */
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => ok(res, null, '已退出登录'));
    return;
  }
  ok(res, null, '已退出登录');
});

module.exports = router;
module.exports.CODES = CODES;
