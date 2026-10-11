'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');

const config = require('./config');
const geetest = require('./services/geetest');
const pagesRouter = require('./routes/pages');
const apiRouter = require('./routes/api');

const app = express();

// ---------- 视图：EJS ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- 中间件 ----------
app.use(express.json());
// extended: true 才能解析 jQuery 序列化出的嵌套参数（如 geetest[lot_number]=xxx）
app.use(express.urlencoded({ extended: true }));

// 静态资源
app.use(express.static(path.join(__dirname, 'public')));

// 把 node_modules 暴露成 /vendor，供 RequireJS 加载 vue / element-ui / jquery
// 生产环境建议改为构建产物或 CDN
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));

app.use(
  session({
    name: 'login.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000,
    },
  })
);

// ---------- 路由 ----------
app.use('/', pagesRouter);
app.use('/api', apiRouter);

// ---------- 404 ----------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ code: 1404, message: '接口不存在', data: null });
  }
  res.status(404).send('404 Not Found');
});

// ---------- 统一错误处理 ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ code: 1500, message: '服务器内部错误', data: null });
  }
  res.status(500).send('500 Internal Server Error');
});

app.listen(config.port, () => {
  console.log(`\n  登录流程 Demo 已启动: http://localhost:${config.port}`);
  console.log(`  极验模式: ${geetest.isRealMode() ? '真实（gt4）' : '本地模拟（mock）'}`);
  console.log('  测试账号: admin / admin123  |  test / test123\n');
});

module.exports = app;
