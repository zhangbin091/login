/**
 * 短信验证码弹窗（Vue2 + ElementUI 组件）。
 *
 * props:
 *   visible   Boolean  显示状态（配合 .sync 使用）
 *   ticket    String   账密校验通过后拿到的流程票据
 *   accounts  Array    脱敏手机号列表 [{ id, label, masked }]
 * emits:
 *   update:visible
 *   success  { redirect }  验证通过
 */
define(['vue', 'ELEMENT', 'modules/api'], function (Vue, ELEMENT, api) {
  'use strict';

  return {
    name: 'sms-dialog',

    props: {
      visible: { type: Boolean, default: false },
      ticket: { type: String, default: '' },
      accounts: { type: Array, default: function () { return []; } }
    },

    data: function () {
      return {
        accountId: '',
        code: '',
        sending: false,
        submitting: false,
        countdown: 0,
        timer: null,
        // 发送成功后带回来的提示信息
        maskedSentTo: ''
      };
    },

    computed: {
      dialogVisible: {
        get: function () { return this.visible; },
        set: function (val) { this.$emit('update:visible', val); }
      },

      sendDisabled: function () {
        return this.sending || this.countdown > 0 || !this.accountId;
      },

      sendText: function () {
        if (this.countdown > 0) return this.countdown + 's 后重发';
        return this.sending ? '发送中' : '发送验证码';
      },

      hintText: function () {
        if (this.maskedSentTo) {
          return '验证码已发送至 ' + this.maskedSentTo + '，5 分钟内有效';
        }
        return '未收到？请检查手机号后重新发送';
      }
    },

    watch: {
      // 打开弹窗时重置输入
      visible: function (val) {
        if (val) {
          this.code = '';
          this.maskedSentTo = '';
          if (!this.accountId && this.accounts.length) {
            this.accountId = this.accounts[0].id;
          }
        }
      },

      // 账号列表首次到达时默认选中第一个
      accounts: function (list) {
        if (list && list.length && !this.accountId) {
          this.accountId = list[0].id;
        }
      }
    },

    beforeDestroy: function () {
      this.clearTimer();
    },

    methods: {
      clearTimer: function () {
        if (this.timer) {
          window.clearInterval(this.timer);
          this.timer = null;
        }
      },

      startCountdown: function (seconds) {
        var self = this;
        this.clearTimer();
        this.countdown = seconds;

        this.timer = window.setInterval(function () {
          self.countdown -= 1;
          if (self.countdown <= 0) self.clearTimer();
        }, 1000);
      },

      /** ④ 发送验证码 */
      handleSend: function () {
        var self = this;

        if (!this.accountId) {
          this.$message.warning('请先选择接收短信的手机号');
          return;
        }

        this.sending = true;

        api
          .sendSms(this.ticket, this.accountId)
          .then(function (data) {
            self.maskedSentTo = data.masked || '';
            self.startCountdown(data.resendAfter || 60);
            self.$message.success('验证码已发送至 ' + (data.masked || '您的手机'));

            // 开发环境后端会回显验证码，方便自助联调
            if (data.devCode) {
              self.$notify({
                title: '开发模式',
                message: '短信验证码：' + data.devCode + '（生产环境不会回显）',
                type: 'info',
                duration: 8000
              });
            }
          })
          .catch(function (err) {
            // 后端已给出剩余重发秒数时，同步一下倒计时
            if (err.data && err.data.resendAfter) {
              self.startCountdown(err.data.resendAfter);
            }
            self.$message.error(err.message || '验证码发送失败');
          })
          .always(function () {
            self.sending = false;
          });
      },

      /** ⑤ 提交验证码 */
      handleSubmit: function () {
        var self = this;

        if (!this.accountId) {
          this.$message.warning('请先选择接收短信的手机号');
          return;
        }
        if (!/^\d{4,8}$/.test(this.code)) {
          this.$message.warning('请输入正确的短信验证码');
          return;
        }

        this.submitting = true;

        api
          .verifySms({ ticket: this.ticket, accountId: this.accountId, code: this.code })
          .then(function (data) {
            self.$message.success('验证成功，正在跳转...');
            self.dialogVisible = false;
            // 稍等一下让提示可见
            window.setTimeout(function () {
              self.$emit('success', data || {});
            }, 400);
          })
          .catch(function (err) {
            if (err.code === api.CODE.FLOW_INVALID) {
              self.dialogVisible = false;
              self.$emit('expired');
            }
            self.$message.error(err.message || '验证失败');
          })
          .always(function () {
            self.submitting = false;
          });
      }
    },

    template: [
      '<el-dialog',
      '  class="sms-dialog"',
      '  title="短信验证"',
      '  width="400px"',
      '  append-to-body',
      '  :visible.sync="dialogVisible"',
      '  :close-on-click-modal="false"',
      '  :close-on-press-escape="false"',
      '>',
      '  <p class="sms__desc">为确认是本人操作，请完成短信验证码校验。</p>',

      '  <p class="sms__label">接收短信的手机号</p>',
      '  <el-radio-group v-model="accountId" class="sms__phones">',
      '    <el-radio v-for="item in accounts" :key="item.id" :label="item.id">',
      '      <span>{{ item.masked }}</span>',
      '      <span class="sms__tag">{{ item.label }}</span>',
      '    </el-radio>',
      '  </el-radio-group>',

      '  <div class="sms__field">',
      '    <div class="sms__code-row">',
      '      <el-input',
      '        v-model="code"',
      '        maxlength="6"',
      '        placeholder="请输入验证码"',
      '        autocomplete="off"',
      '        @keyup.enter.native="handleSubmit"',
      '      />',
      '      <el-button',
      '        class="sms__send-btn"',
      '        :disabled="sendDisabled"',
      '        :loading="sending"',
      '        @click="handleSend"',
      '      >{{ sendText }}</el-button>',
      '    </div>',
      '    <p class="sms__hint">{{ hintText }}</p>',
      '  </div>',

      '  <div slot="footer">',
      '    <el-button @click="dialogVisible = false">取消</el-button>',
      '    <el-button type="primary" :loading="submitting" @click="handleSubmit">确认登录</el-button>',
      '  </div>',
      '</el-dialog>'
    ].join('\n')
  };
});
