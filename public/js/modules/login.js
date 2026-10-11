/**
 * 登录页根组件。
 *
 * 完整流程：
 *   点击登录
 *     -> ① 极验验证            geetest.verify()
 *     -> ② 后端校验用户名密码   POST /api/login/credentials
 *     -> ③ 用户账号查询         GET  /api/account/phones
 *     -> ④ 弹出短信验证码弹窗
 *     -> ⑤ 校验通过跳转成功页
 */
define([
  'vue',
  'ELEMENT',
  'modules/api',
  'modules/geetest',
  'modules/sms-dialog'
], function (Vue, ELEMENT, api, geetest, SmsDialog) {
  'use strict';

  return {
    name: 'login-page',

    components: { SmsDialog: SmsDialog },

    data: function () {
      return {
        form: {
          username: '',
          password: ''
        },
        rules: {
          username: [
            { required: true, message: '请输入用户名', trigger: 'blur' },
            { min: 2, max: 32, message: '用户名长度为 2 ~ 32 个字符', trigger: 'blur' }
          ],
          password: [
            { required: true, message: '请输入密码', trigger: 'blur' },
            { min: 6, message: '密码至少 6 位', trigger: 'blur' }
          ]
        },
        loading: false,
        // 短信环节
        smsVisible: false,
        ticket: '',
        accounts: []
      };
    },

    methods: {
      onSubmit: function () {
        var self = this;
        if (this.loading) return;

        this.$refs.form.validate(function (valid) {
          if (valid) self.doLogin();
        });
      },

      doLogin: async function () {
        this.loading = true;

        try {
          // ① 极验验证
          var gtParams = await geetest.verify();

          // ② 服务端校验用户名 / 密码（并二次校验极验结果）
          var credential = await api.loginCredentials({
            username: this.form.username,
            password: this.form.password,
            geetest: gtParams
          });

          this.ticket = credential.ticket;

          // ③ 用户账号查询：拿到脱敏手机号列表
          var accountResult = await api.queryPhones(this.ticket);

          if (!accountResult.accounts || !accountResult.accounts.length) {
            this.$message.error('该账号未绑定手机号，无法完成短信验证');
            return;
          }

          this.accounts = accountResult.accounts;

          // ④ 打开短信验证码弹窗
          this.smsVisible = true;
        } catch (err) {
          this.handleError(err);
        } finally {
          this.loading = false;
        }
      },

      /** 统一错误提示 */
      handleError: function (err) {
        var error = err || {};

        // 用户主动关闭极验，静默处理
        if (error.code === 'CLOSE') return;

        var code = error.code;

        if (code === api.CODE.TOO_FREQUENT) {
          this.$message.warning(error.message);
          return;
        }

        if (code === api.CODE.BAD_CREDENTIALS) {
          var remain = error.data && error.data.remainAttempts;
          this.$message.error(remain ? error.message + '，还可尝试 ' + remain + ' 次' : error.message);
          this.form.password = '';
          return;
        }

        if (code === api.CODE.GEETEST_FAIL) {
          this.$message.error(error.message || '验证未通过，请重新验证');
          return;
        }

        this.$message.error(error.message || '登录失败，请稍后重试');
      },

      /** ⑤ 短信验证成功 */
      onSmsSuccess: function (data) {
        window.location.href = (data && data.redirect) || '/success';
      },

      /** 短信环节票据失效，回到初始状态重新走一遍 */
      onSmsExpired: function () {
        this.ticket = '';
        this.accounts = [];
        this.$message.warning('登录会话已过期，请重新登录');
      }
    },

    template: [
      '<div class="card">',
      '  <div class="card__brand">',
      '    <div class="card__logo">L</div>',
      '    <div class="card__brand-name">Login Flow Demo</div>',
      '  </div>',

      '  <h1 class="card__title">账号登录</h1>',
      '  <p class="card__subtitle">验证通过后还需完成短信二次校验</p>',

      '  <el-form ref="form" :model="form" :rules="rules" @submit.native.prevent>',
      '    <el-form-item prop="username">',
      '      <el-input',
      '        v-model="form.username"',
      '        placeholder="请输入用户名"',
      '        clearable',
      '        prefix-icon="el-icon-user"',
      '        @keyup.enter.native="onSubmit"',
      '      />',
      '    </el-form-item>',

      '    <el-form-item prop="password">',
      '      <el-input',
      '        v-model="form.password"',
      '        type="password"',
      '        placeholder="请输入密码"',
      '        show-password',
      '        prefix-icon="el-icon-lock"',
      '        @keyup.enter.native="onSubmit"',
      '      />',
      '    </el-form-item>',

      '    <el-form-item>',
      '      <el-button type="primary" :loading="loading" @click="onSubmit">',
      '        {{ loading ? "登录中..." : "登 录" }}',
      '      </el-button>',
      '    </el-form-item>',
      '  </el-form>',

      '  <div class="card__tip">',
      '    <div>演示账号：<code>admin / admin123</code>　<code>test / test123</code></div>',
      '    <div>登录流程：极验验证 → 账密校验 → 账号查询 → 短信验证</div>',
      '  </div>',

      '  <sms-dialog',
      '    :visible.sync="smsVisible"',
      '    :ticket="ticket"',
      '    :accounts="accounts"',
      '    @success="onSmsSuccess"',
      '    @expired="onSmsExpired"',
      '  />',
      '</div>'
    ].join('\n')
  };
});
