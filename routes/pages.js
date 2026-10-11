'use strict';

/**
 * 页面路由（EJS 渲染）。
 */

const express = require('express');
const config = require('../config');

const router = express.Router();

/** 登录页 */
router.get('/', (req, res) => {
  res.render('login', {
    title: '用户登录',
    year: new Date().getFullYear(),
    // 只透出非敏感信息给模板
    clientConfig: {
      geetestMockEnabled: !(config.geetest.captchaId && config.geetest.captchaKey),
    },
  });
});

/** 登录成功页 */
router.get('/success', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/');
  }
  res.render('success', {
    title: '登录成功',
    year: new Date().getFullYear(),
    user: req.session.user,
  });
});

/** 直接访问 /logout 时先清会话再回登录页 */
router.get('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => res.redirect('/'));
    return;
  }
  res.redirect('/');
});

module.exports = router;
