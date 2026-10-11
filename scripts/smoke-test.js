'use strict';

/**
 * 端到端冒烟测试：覆盖正常流程 + 关键异常分支。
 * 用法：先 `npm start`，再 `node scripts/smoke-test.js`
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}

/** 极简 cookie jar，让每个"浏览器会话"各自独立 */
function createSession() {
  const jar = new Map();
  return {
    async request(path, { method = 'GET', body } = {}) {
      const headers = {};
      if (jar.size) {
        headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      if (body) headers['Content-Type'] = 'application/json';

      const res = await fetch(BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });

      for (const raw of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }

      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* 非 JSON（页面） */ }
      return { status: res.status, location: res.headers.get('location'), json, text };
    },
  };
}

/** 走一遍客户端"极验"，拿到可回传后端的参数 */
async function runGeetest(session) {
  const res = await session.request('/api/geetest/register', { method: 'POST', body: {} });
  const cfg = res.json.data;
  if (cfg.mode === 'gt4') {
    throw new Error('当前为真实极验模式，请用模拟模式（不配置 GEETEST_ID/KEY）运行本脚本');
  }
  return {
    lot_number: cfg.lotNumber,
    captcha_output: 'mock-pass',
    pass_token: 'mock-pass-token',
    gen_time: String(Math.floor(Date.now() / 1000)),
  };
}

async function main() {
  console.log(`\n冒烟测试 -> ${BASE}\n`);

  // ---------------------------------------------------------- 正常流程
  console.log('【正常流程】');
  const s = createSession();

  const gt = await runGeetest(s);
  const cred = await s.request('/api/login/credentials', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123', geetest: gt },
  });
  check('账密校验通过并返回 ticket', cred.json.code === 0 && !!cred.json.data.ticket, cred.json);
  const ticket = cred.json.data.ticket;

  const phones = await s.request(`/api/account/phones?ticket=${ticket}`);
  const accounts = phones.json.data.accounts;
  check('账号查询返回 2 个手机号', accounts.length === 2, phones.json);
  check('手机号已脱敏', accounts[0].masked === '138****8000', accounts[0]);
  check('不返回明文手机号', !JSON.stringify(phones.json).includes('13800138000'));

  const send = await s.request('/api/sms/send', { method: 'POST', body: { ticket, accountId: 'acc_1' } });
  check('发送验证码成功', send.json.code === 0, send.json);

  const bad = await s.request('/api/sms/verify', {
    method: 'POST',
    body: { ticket, accountId: 'acc_1', code: '000000' },
  });
  check('错误验证码被拒绝 (1008)', bad.json.code === 1008, bad.json);

  const okVerify = await s.request('/api/sms/verify', {
    method: 'POST',
    body: { ticket, accountId: 'acc_1', code: send.json.data.devCode },
  });
  check('正确验证码通过并返回跳转地址', okVerify.json.code === 0 && okVerify.json.data.redirect === '/success', okVerify.json);

  const page = await s.request('/success');
  check('登录后可访问 /success', page.status === 200 && page.text.includes('管理员'), page.status);

  const logout = await s.request('/api/logout', { method: 'POST', body: {} });
  check('退出登录成功', logout.json.code === 0);

  const afterLogout = await s.request('/success');
  check('退出后 /success 重定向回登录页', afterLogout.status === 302 && afterLogout.location === '/', afterLogout.status);

  // ---------------------------------------------------------- 异常分支
  console.log('\n【安全 / 异常分支】');

  const s2 = createSession();
  const guest = await s2.request('/success');
  check('未登录访问 /success 被拦截', guest.status === 302 && guest.location === '/', guest.status);

  const noTicket = await s2.request('/api/account/phones?ticket=fake-ticket');
  check('伪造 ticket 被拒绝 (1005)', noTicket.json.code === 1005, noTicket.json);

  // 极验 lot_number 一次性
  const replayGt = await runGeetest(s2);
  const replayBody = { username: 'test', password: 'test123', geetest: replayGt };
  const first = await s2.request('/api/login/credentials', { method: 'POST', body: replayBody });
  const replay = await s2.request('/api/login/credentials', { method: 'POST', body: replayBody });
  check('极验参数首次可用', first.json.code === 0, first.json);
  check('极验参数重放被拒绝 (1002)', replay.json.code === 1002, replay.json);

  // 票号不能跨会话使用
  const s3 = createSession();
  const crossTicket = await s3.request(`/api/account/phones?ticket=${first.json.data.ticket}`);
  check('ticket 不能跨会话使用 (1005)', crossTicket.json.code === 1005, crossTicket.json);

  // 注意：限流按 `IP + 用户名` 计数，且命中锁定后所有请求都会先被 1004 拦截，
  // 所以下面几个"前置拦截"的用例必须放在"锁定"用例之前。
  const s5 = createSession();
  const wrongPwd = await s5.request('/api/login/credentials', {
    method: 'POST',
    body: { username: 'test', password: 'nope', geetest: await runGeetest(s5) },
  });
  check('密码错误返回剩余次数', wrongPwd.json.code === 1003 && typeof wrongPwd.json.data.remainAttempts === 'number', wrongPwd.json);

  const s6 = createSession();
  const noGt = await s6.request('/api/login/credentials', {
    method: 'POST',
    body: { username: 'test', password: 'test123' },
  });
  check('跳过极验直接登录被拒绝 (1002)', noGt.json.code === 1002, noGt.json);

  // 错误密码 -> 连续失败锁定
  const s4 = createSession();
  let locked = null;
  for (let i = 1; i <= 4; i += 1) {
    const g = await runGeetest(s4);
    const r = await s4.request('/api/login/credentials', {
      method: 'POST',
      body: { username: 'admin', password: 'wrong-password', geetest: g },
    });
    if (r.json.code === 1004) locked = r.json;
  }
  check('连续失败触发频率限制 (1004)', !!locked, locked);

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n测试执行失败：', err.message);
  process.exit(1);
});
