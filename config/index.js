'use strict';

/**
 * 全局配置。
 * 所有可调项都支持环境变量覆盖，方便本地 / 测试 / 生产切换。
 */
module.exports = {
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'login-flow-demo-secret',

  /**
   * 极验 4.0（行为验证）。
   * 未配置 GEETEST_ID / GEETEST_KEY 时自动降级为本地模拟验证（mock），
   * 保证项目 clone 下来 npm start 就能跑通完整流程。
   * 申请地址：https://www.geetest.com/
   */
  geetest: {
    captchaId: process.env.GEETEST_ID || '3fcca12fad61a25061886999c1b57310',
    captchaKey: process.env.GEETEST_KEY || '3227d058da508d151a0a9d5b1dcf5d01',
    // gt4.js 的加载地址，真实模式下前端会动态加载它
    scriptUrl: process.env.GEETEST_SCRIPT_URL || 'https://static.geetest.com/v4/gt4.js',
    // 模拟验证时，一次 lot_number 的有效期
    mockTtlMs: 5 * 60 * 1000,
  },

  /**
   * 登录频率限制：连续失败达到 maxFailures 次后锁定 lockSeconds 秒，
   * 配合极验一起防止暴力尝试 / 频繁登录。
   */
  loginLimit: {
    maxFailures: 3,
    lockSeconds: 60,
  },

  /**
   * 短信验证码策略。
   */
  sms: {
    codeLength: 6,
    ttlSeconds: 300,      // 验证码有效期
    resendSeconds: 60,    // 重发间隔
    maxAttempts: 5,       // 单个验证码最多校验次数
    // 非生产环境把验证码回显到接口响应 / 控制台，方便调试
    exposeCode: process.env.NODE_ENV !== 'production',
  },

  // 一次登录流程（含短信环节）的整体有效期
  flowTtlMs: 10 * 60 * 1000,
};
