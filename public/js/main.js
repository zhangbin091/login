/**
 * 登录页入口。
 * 加载 Vue2 + ElementUI，挂载登录组件。
 */
define(['vue', 'ELEMENT', 'modules/login'], function (Vue, ELEMENT, LoginPage) {
  'use strict';

  Vue.use(ELEMENT, { size: 'medium' });
  Vue.config.productionTip = false;
  Vue.config.devtools = true;

  // 全局配置（由 EJS 注入），供各模块读取
  Vue.prototype.$appConfig = window.__APP_CONFIG__ || {};

  new Vue({
    el: '#app',
    components: { LoginPage: LoginPage },
    template: '<login-page />'
  });
});
