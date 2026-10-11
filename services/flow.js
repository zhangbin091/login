'use strict';

/**
 * 登录流程状态机。
 *
 * 一次登录被拆成三段，靠 ticket 串起来：
 *   1) 账密校验通过  -> create() 生成 ticket
 *   2) 账号查询      -> get(ticket) 拿到脱敏账号列表
 *   3) 短信校验      -> 读写 flow.sms
 *
 * 完整手机号、验证码只存在服务端，不下发到浏览器。
 * ticket 与 sessionID 绑定，防止被搬运到其它会话。
 */

const crypto = require('crypto');
const config = require('../config');
const { getAccounts, toPublicAccount } = require('./user');

/** ticket -> flow */
const flows = new Map();

function create({ userId, username, nickname, sessionId }) {
  const ticket = crypto.randomUUID();

  flows.set(ticket, {
    ticket,
    sessionId,
    userId,
    username,
    nickname,
    // 完整账号信息（含真实手机号）只留在服务端
    accounts: getAccounts(userId),
    createdAt: Date.now(),
    expireAt: Date.now() + config.flowTtlMs,
    sms: null, // { accountId, code, expireAt, sentAt, attempts, verified }
  });

  return ticket;
}

/** 取出并做有效性校验 */
function get(ticket, sessionId) {
  if (!ticket) return null;
  const flow = flows.get(ticket);
  if (!flow) return null;

  if (flow.expireAt <= Date.now()) {
    flows.delete(ticket);
    return null;
  }
  if (flow.sessionId !== sessionId) return null;

  return flow;
}

function remove(ticket) {
  flows.delete(ticket);
}

/** 该 flow 下可用于展示的脱敏账号列表 */
function publicAccounts(flow) {
  return flow.accounts.map(toPublicAccount);
}

/** 根据 accountId 找真实账号 */
function findAccount(flow, accountId) {
  return flow.accounts.find((item) => item.id === accountId) || null;
}

/** 定时清理过期流程 */
setInterval(() => {
  const now = Date.now();
  for (const [ticket, flow] of flows) {
    if (flow.expireAt <= now) flows.delete(ticket);
  }
}, 60 * 1000).unref();

module.exports = { create, get, remove, publicAccounts, findAccount };
