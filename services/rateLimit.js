'use strict';

/**
 * 登录频率限制：连续失败 N 次锁定一段时间，配合极验一起避免频繁登录 / 暴力破解。
 * 演示用内存实现，多实例部署请换成 Redis。
 */

const config = require('../config');

/** key -> { failures, lockedUntil } */
const buckets = new Map();

function buildKey(username, ip) {
  return `${ip || 'unknown'}|${(username || '').trim().toLowerCase()}`;
}

/** @returns {{locked:boolean, retryAfter:number}} */
function check(username, ip) {
  const bucket = buckets.get(buildKey(username, ip));
  if (!bucket || !bucket.lockedUntil) return { locked: false, retryAfter: 0 };

  const remain = bucket.lockedUntil - Date.now();
  if (remain <= 0) {
    buckets.delete(buildKey(username, ip));
    return { locked: false, retryAfter: 0 };
  }
  return { locked: true, retryAfter: Math.ceil(remain / 1000) };
}

/** 记录一次失败，达到阈值则锁定 */
function fail(username, ip) {
  const key = buildKey(username, ip);
  const bucket = buckets.get(key) || { failures: 0, lockedUntil: 0 };
  bucket.failures += 1;

  if (bucket.failures >= config.loginLimit.maxFailures) {
    bucket.lockedUntil = Date.now() + config.loginLimit.lockSeconds * 1000;
    bucket.failures = 0; // 锁定后计数归零，锁定期满重新计
  }
  buckets.set(key, bucket);
  return bucket;
}

/** 登录成功，清空计数 */
function reset(username, ip) {
  buckets.delete(buildKey(username, ip));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (!bucket.lockedUntil || bucket.lockedUntil <= now) buckets.delete(key);
  }
}, 60 * 1000).unref();

module.exports = { check, fail, reset };
