'use strict';

/**
 * 用户 & 账号数据（演示用内存数据，真实项目替换为数据库 / 用户中心接口）。
 */

const crypto = require('crypto');

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

const USERS = [
  {
    id: 'u_1001',
    username: 'admin',
    nickname: '管理员',
    passwordHash: sha256('admin123'),
    accounts: [
      { id: 'acc_1', label: '主号', number: '13800138000' },
      { id: 'acc_2', label: '备用', number: '13900139000' },
    ],
  },
  {
    id: 'u_1002',
    username: 'test',
    nickname: '测试账号',
    passwordHash: sha256('test123'),
    accounts: [{ id: 'acc_1', label: '手机', number: '13612345678' }],
  },
];

/**
 * 校验用户名 / 密码。
 * @returns {object|null} 命中返回用户对象，否则 null
 */
function verifyCredentials(username, password) {
  if (!username || !password) return null;
  const user = USERS.find((item) => item.username === username.trim());
  if (!user) return null;
  return user.passwordHash === sha256(password) ? user : null;
}

/** 按用户 id 查询可用账号（手机号）列表 */
function getAccounts(userId) {
  const user = USERS.find((item) => item.id === userId);
  return user ? user.accounts : [];
}

/** 手机号脱敏：13800138000 -> 138****8000 */
function maskPhone(number) {
  const value = String(number || '');
  if (!/^\d{11}$/.test(value)) {
    return value.length > 4 ? `${value.slice(0, 3)}****${value.slice(-2)}` : value;
  }
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

/** 对外返回的账号结构：只给脱敏号，完整号码留在服务端 */
function toPublicAccount(account) {
  return { id: account.id, label: account.label, masked: maskPhone(account.number) };
}

module.exports = { verifyCredentials, getAccounts, maskPhone, toPublicAccount };
