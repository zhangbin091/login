'use strict';

/**
 * 浏览器端到端测试：用 Chrome DevTools Protocol 驱动真实页面，
 * 完整走一遍「输入账密 -> 极验 -> 账密校验 -> 账号查询 -> 短信验证 -> 跳转成功页」。
 *
 * 依赖本机已安装 Chrome / Edge，且开发服务器已启动（npm start）。
 * 用法：node scripts/e2e-browser.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const DEBUG_PORT = 9333;
const USERNAME = process.env.E2E_USER || 'admin';
const PASSWORD = process.env.E2E_PASS || 'admin123';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const hit = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('未找到 Chrome / Edge，请用 CHROME_PATH 指定可执行文件路径');
  return hit;
}

async function waitForDebugEndpoint(retries = 40) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('浏览器调试端口未就绪');
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const resolver = this.pending.get(msg.id);
      if (resolver) {
        this.pending.delete(msg.id);
        resolver(msg);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里执行一段 async 函数体（字符串），返回其 resolve 值 */
  async evaluate(body) {
    const expression = `(async () => { ${body} })()`;
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (res.error) throw new Error('CDP 调用失败: ' + JSON.stringify(res.error));
    if (res.result && res.result.exceptionDetails) {
      const details = res.result.exceptionDetails;
      const desc = (details.exception && details.exception.description) || details.text;
      throw new Error('页面执行异常: ' + desc);
    }
    return res.result.result.value;
  }
}

/** 轮询 CDP 目标列表，等目标 URL 变成期望路径 */
async function waitForTargetUrl(targetId, pathname, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const target = list.find((t) => t.id === targetId);
    if (target && new URL(target.url).pathname === pathname) return target.url;
    await sleep(200);
  }
  throw new Error(`等待跳转到 ${pathname} 超时`);
}

/** 页面正在跳转时执行上下文会被销毁，重试几次 */
async function evalWithRetry(cdp, body, attempts = 12) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await cdp.evaluate(body);
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw lastErr;
}

/** 注入到页面的驱动脚本：完成全部交互 */
const DRIVER = `
  const log = [];
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // 全程记录 ElementUI 的提示信息（message / notification 会自动消失，事后抓不到）
  const seenMessages = [];
  new MutationObserver(() => {
    $$('.el-message__content, .el-notification__content').forEach(el => {
      const t = el.textContent.trim();
      if (t && !seenMessages.includes(t)) seenMessages.push(t);
    });
  }).observe(document.body, { childList: true, subtree: true });

  const waitFor = async (fn, desc, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('等待超时: ' + desc);
  };

  const setInput = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const findByText = (sel, text) =>
    $$(sel).find(el => el.textContent.trim().includes(text));

  // ---- 1. 输入用户名 / 密码 ----
  // 注意：Vue2 以 el 挂载时会「替换」挂载点元素，所以 #app 已不存在，直接用 .card 定位
  const inputs = $$('.card .el-form input.el-input__inner');
  if (inputs.length < 2) throw new Error('未找到登录表单输入框');
  setInput(inputs[0], ${JSON.stringify(USERNAME)});
  setInput(inputs[1], ${JSON.stringify(PASSWORD)});
  log.push('已填写账号密码');

  // ---- 2. 点击登录 ----
  const loginBtn = findByText('.card button.el-button--primary', '登');
  if (!loginBtn) throw new Error('未找到登录按钮');
  loginBtn.click();
  log.push('已点击登录');

  // ---- 3. 等待验证弹层出现（真实极验 或 本地模拟）----
  let isRealGeetest = false;
  try {
    await waitFor(
      () => $('.gt-mock__knob') || $('[class*=geetest_box_wrap]') || $('[class*=geetest_wrap]'),
      '验证弹层',
      25000
    );
  } catch (e) {
    throw new Error(
      e.message + ' | 出现过的提示: ' + JSON.stringify(seenMessages) +
      ' | 当前 URL: ' + location.href
    );
  }

  isRealGeetest = !$('.gt-mock__knob');

  if (isRealGeetest) {
    // 真实极验：滑块必须由真人拖动，合成事件无法通过（这正是它的防机器人设计）
    const gtNodes = $$('[class*=geetest],[id*=geetest]');
    log.push('检测到真实极验弹层（已渲染 ' + gtNodes.length + ' 个节点）');
    return {
      ok: true,
      realMode: true,
      log,
      messages: seenMessages,
      gt: {
        initGeetest4: typeof window.initGeetest4,
        scriptLoaded: !!document.getElementById('geetest-gt4-js'),
        nodeCount: gtNodes.length,
        hasPuzzle: !!(document.querySelector('[class*=geetest_wrap]') && document.querySelector('[class*=geetest_container]')),
      }
    };
  }

  const knob = $('.gt-mock__knob');
  const track = $('.gt-mock__track');
  const kRect = knob.getBoundingClientRect();
  const tRect = track.getBoundingClientRect();
  const maxOffset = tRect.width - kRect.width;

  const startX = kRect.left + kRect.width / 2;
  const startY = kRect.top + kRect.height / 2;
  const fire = (type, x, y) => document.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  );

  knob.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, clientX: startX, clientY: startY
  }));
  for (let i = 1; i <= 10; i += 1) {
    fire('mousemove', startX + (maxOffset * i) / 10, startY);
    await new Promise(r => setTimeout(r, 16));
  }
  fire('mouseup', startX + maxOffset, startY);
  log.push('已完成极验滑块拖动');

  // ---- 4. 等待短信弹窗出现 ----
  try {
    await waitFor(() => {
      const w = $('.sms-dialog .el-dialog__wrapper, .sms-dialog');
      return w && w.style.display !== 'none' && $('.sms-dialog .el-radio');
    }, '短信验证弹窗');
  } catch (e) {
    throw new Error(
      e.message +
      ' | 出现过的提示: ' + JSON.stringify(seenMessages) +
      ' | 滑块仍未关闭: ' + !!$('.gt-mock-mask') +
      ' | 当前 URL: ' + location.href
    );
  }
  await waitFor(() => $('.sms-dialog .el-radio input'), '手机号单选按钮');
  const phones = $$('.sms-dialog .el-radio__label').map(e => e.textContent.trim());
  log.push('弹窗内手机号: ' + JSON.stringify(phones));

  // ---- 5. 发送验证码 ----
  const sendBtn = findByText('.sms-dialog button.el-button', '发送验证码');
  if (!sendBtn) throw new Error('未找到发送验证码按钮');
  sendBtn.click();
  log.push('已点击发送验证码');

  // 从开发模式的通知里读取验证码
  const code = await waitFor(() => {
    const t = document.body.innerText;
    const m = t.match(/短信验证码：(\\d{4,8})/);
    return m && m[1];
  }, '开发模式验证码回显');
  log.push('拿到验证码: ' + code);

  // ---- 6. 填入验证码并提交 ----
  await waitFor(() => $('.sms-dialog .sms__code-row input'), '验证码输入框');
  setInput($('.sms-dialog .sms__code-row input'), code);
  const submitBtn = findByText('.sms-dialog .el-dialog__footer button.el-button--primary', '确认登录');
  if (!submitBtn) throw new Error('未找到确认登录按钮');
  submitBtn.click();
  log.push('已提交验证码');

  // 注意：提交成功后页面会跳转，跳转会让当前执行上下文销毁，
  // 所以这里不等待跳转，交给 Node 侧轮询目标 URL。
  return { ok: true, log, messages: seenMessages };
`;

async function main() {
  const browser = findBrowser();
  const profile = path.join(os.tmpdir(), `e2e-profile-${Date.now()}`);

  console.log(`\n浏览器 E2E -> ${BASE}`);
  console.log(`浏览器: ${browser}\n`);

  const proc = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let cdp;
  try {
    await waitForDebugEndpoint();

    const target = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // 收集页面 console 报错，便于定位前端问题
    const errors = [];
    cdp.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(msg.params.exceptionDetails.text + ' ' +
          (msg.params.exceptionDetails.exception || {}).description);
      }
    });

    // 显式导航并等待 RequireJS 把 Vue / ElementUI 装载完
    await cdp.send('Page.navigate', { url: BASE + '/' });

    const ready = await cdp.evaluate(`
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (document.querySelector('.card .el-form input.el-input__inner')) return true;
        await new Promise(r => setTimeout(r, 150));
      }
      throw new Error('等待 Vue 挂载超时，当前 URL=' + location.href +
        ' body=' + document.body.innerHTML.slice(0, 300));
    `);
    console.log('页面就绪:', ready, `(${BASE}/)`);

    const result = await cdp.evaluate(DRIVER);

    console.log('交互步骤:');
    result.log.forEach((line) => console.log('  · ' + line));
    console.log('');

    if (result.realMode) {
      console.log('  ✓ 真实极验已加载（initGeetest4: ' + result.gt.initGeetest4 + '）');
      console.log('  ✓ gt4.js 已注入: ' + result.gt.scriptLoaded);
      console.log('  ✓ 极验 DOM 节点数: ' + result.gt.nodeCount);
      console.log('  ✓ 拼图容器已渲染: ' + result.gt.hasPuzzle);
      if (errors.length) {
        console.log('\n页面 JS 异常:');
        errors.forEach((e) => console.log('  ! ' + e));
      }
      console.log('\n真实极验的滑块必须由真人拖动，自动化到此为止。');
      console.log('请在浏览器里手动完成滑块，确认能否走到短信验证弹窗。');
      console.log('若要跑完整自动化流程：$env:GEETEST_DISABLED=1 后重启服务再执行。\n');
      console.log('结果：真实模式组件加载正常\n');
      process.exitCode = errors.length === 0 ? 0 : 1;
      return;
    }

    // ---- 7. 等待跳转到成功页（在 Node 侧轮询，避免执行上下文被销毁）----
    const finalUrl = await waitForTargetUrl(target.id, '/success', 20000);
    console.log(`  ✓ 已跳转到成功页: ${finalUrl}`);

    const page = await evalWithRetry(cdp, `
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && !document.body.innerText.includes('登录成功')) {
        await new Promise(r => setTimeout(r, 150));
      }
      return { text: document.body.innerText, hasNick: document.body.innerText.includes(${JSON.stringify('管理员')}) };
    `);

    console.log(`  ✓ 成功页展示用户昵称: ${page.hasNick}`);
    console.log(`  ✓ 成功页展示登录手机号: ${page.text.includes('138****8000')}`);

    if (result.messages && result.messages.length) {
      console.log('\n页面提示（ElMessage / Notification）:');
      result.messages.forEach((m) => console.log('  · ' + m));
    }

    if (errors.length) {
      console.log('\n页面 JS 异常:');
      errors.forEach((e) => console.log('  ! ' + e));
    }

    const passed = result.ok && page.hasNick && errors.length === 0;
    console.log(`\n结果：${passed ? '通过' : '失败'}\n`);
    process.exitCode = passed ? 0 : 1;
  } catch (err) {
    console.error('\nE2E 失败：', err.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.ws.close();
    proc.kill();
    // 浏览器退出前 profile 目录可能仍被占用，清理失败不影响测试结论
    await sleep(1200);
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      console.warn('（临时 profile 目录稍后可手动清理：' + profile + '）');
    }
  }
}

main();
