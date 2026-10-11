# 登录流程 Demo

一个完整的「极验 + 账密 + 短信」多因子登录示例。

**技术栈**：Express · EJS · RequireJS · jQuery · Vue 2 · ElementUI

---

## 登录流程

```
用户输入用户名 / 密码，点击登录
        │
        ▼
① 极验验证            POST /api/geetest/register   → 前端完成验证，拿到四个参数
        │
        ▼
② 账密校验            POST /api/login/credentials  → 服务端二次校验极验 + 校验账密 → ticket
        │
        ▼
③ 用户账号查询        GET  /api/account/phones     → 返回脱敏手机号列表
        │
        ▼
④ 短信验证码弹窗       POST /api/sms/send           → 选择手机号，发送验证码
        │
        ▼
⑤ 校验验证码          POST /api/sms/verify         → 成功，写入会话
        │
        ▼
   跳转 /success
```

## 快速开始

```bash
npm install
npm start          # http://localhost:3000
```

演示账号：

| 用户名 | 密码 | 绑定手机号 |
| --- | --- | --- |
| `admin` | `admin123` | 13800138000 / 13900139000 |
| `test` | `test123` | 13612345678 |

> 默认使用**本地模拟验证**（未配置极验 KEY），滑块拖到底即通过，方便直接跑通全流程。
> 验证码会打印到服务端控制台，同时在页面上以通知形式回显（仅非生产环境）。

## 目录结构

```
login/
├── app.js                    Express 入口：视图、静态资源、会话、路由挂载
├── config/index.js           全部可调参数（端口、极验、限流、短信策略）
├── routes/
│   ├── pages.js              页面路由（EJS 渲染）
│   └── api.js                业务接口，统一响应 { code, message, data }
├── services/
│   ├── geetest.js            极验 4.0 接入（真实模式 + 模拟模式）
│   ├── user.js               用户 / 账号数据、手机号脱敏
│   ├── flow.js               登录流程状态机（ticket）
│   ├── sms.js                验证码生成与校验
│   └── rateLimit.js          登录频率限制
├── views/
│   ├── login.ejs             登录页（只做挂载点，模板在 JS 里）
│   └── success.ejs           登录成功页
├── public/
│   ├── css/login.css
│   └── js/
│       ├── require.config.js RequireJS 配置
│       ├── main.js           登录页入口：装载 Vue + ElementUI
│       ├── success.js        成功页入口：退出登录
│       └── modules/
│           ├── api.js        接口层（jQuery ajax 封装）
│           ├── geetest.js    极验封装（真实 gt4 + 本地模拟滑块）
│           ├── login.js      登录页根组件
│           └── sms-dialog.js 短信验证码弹窗组件
└── scripts/
    ├── smoke-test.js         接口层冒烟测试（18 项）
    └── e2e-browser.js        真实浏览器端到端测试
```

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/geetest/register` | 极验初始化，返回 `mode: 'gt4' \| 'mock'` |
| POST | `/api/login/credentials` | 极验二次校验 + 账密校验，返回 `ticket` |
| GET | `/api/account/phones?ticket=` | 查询脱敏手机号列表 |
| POST | `/api/sms/send` | 发送短信验证码 |
| POST | `/api/sms/verify` | 校验验证码，成功写入会话 |
| GET | `/api/session` | 当前登录态 |
| POST | `/api/logout` | 退出登录 |

统一响应：`{ code, message, data }`，`code === 0` 为成功。

| code | 含义 |
| --- | --- |
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 极验校验失败 |
| 1003 | 用户名或密码错误 |
| 1004 | 操作过于频繁（已锁定） |
| 1005 | 登录流程票据失效 |
| 1006 | 账号无效 |
| 1007 | 验证码发送过于频繁 |
| 1008 | 验证码错误 / 过期 |
| 1009 | 未登录 |

## 接入真实极验

去 [极验控制台](https://console.geetest.com/) 申请验证 ID 与 KEY，然后：

```bash
# PowerShell
$env:GEETEST_ID="你的 captcha_id"; $env:GEETEST_KEY="你的 captcha_key"; npm start
```

```bash
# bash
GEETEST_ID=xxx GEETEST_KEY=xxx npm start
```

配置后自动切换到 gt4 真实模式：前端加载 `gt4.js` 走行为验证，服务端用
`HMAC-SHA256(lot_number, captcha_key)` 生成 `sign_token` 向极验发起二次校验。
**极验探活失败时会自动降级为本地模拟验证**，避免验证服务抖动导致完全无法登录。

## 接入真实短信

替换 `services/sms.js` 中的 `issue()`：目前只生成验证码并打到控制台，
把 `console.log` 换成阿里云 / 腾讯云短信 SDK 调用即可，其余流程不用动。

## 安全设计要点

- **极验必须在服务端二次校验**，否则前端可绕过（见 `services/geetest.js`）
- **极验票据一次性**，用完即删，防重放
- **ticket 与 sessionID 绑定**，不能跨会话搬运
- **完整手机号不下发前端**，只返回 `138****8000` 形式
- **验证码只存服务端**，带有效期、最大尝试次数、重发间隔
- **限流按 `IP + 用户名`** 计数，连续失败即锁定，配合极验防暴力破解
- 密码以 SHA-256 存储（演示用；生产请用 bcrypt / argon2）

> `express-session` 默认使用内存存储，且 `services/*` 的状态都在进程内存中，
> 仅适合单实例演示。多实例部署请把会话与流程状态换成 Redis。

## 测试

```bash
npm start            # 另开一个终端
npm test             # 接口冒烟测试，18 项
npm run test:e2e     # 真实浏览器端到端测试（需要本机有 Chrome / Edge）
```

`npm run test:e2e` 会通过 CDP 驱动无头浏览器，完整走一遍
「填账密 → 拖极验滑块 → 账密校验 → 账号查询 → 短信弹窗 → 发送验证码 → 校验 → 跳转成功页」，
并断言最终页面内容。

## 已知取舍

- 用户数据、验证码、流程状态均为内存实现，重启即清空
- `node_modules` 直接以 `/vendor` 静态暴露给 RequireJS，生产环境应改为构建产物或 CDN
- 前端模板写在 JS 字符串里（Vue 完整版含编译器），无构建步骤；如需上生产建议引入
  vue-loader / Vite 做预编译
