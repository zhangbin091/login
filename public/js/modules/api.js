/**
 * 接口层：基于 jQuery 的 ajax 封装。
 *
 * 约定：后端统一返回 { code, message, data }，code === 0 为成功。
 *   - 成功 -> resolve(data)
 *   - 业务失败 / 网络异常 -> reject({ code, message, data })
 * 用 jQuery 3 的 Promise（Promises/A+），可直接 await。
 */
define(['jquery'], function ($) {
  'use strict';

  var CODE = {
    OK: 0,
    PARAM: 1001,
    GEETEST_FAIL: 1002,
    BAD_CREDENTIALS: 1003,
    TOO_FREQUENT: 1004,
    FLOW_INVALID: 1005,
    ACCOUNT_INVALID: 1006,
    SMS_TOO_FREQUENT: 1007,
    SMS_INVALID: 1008,
    UNAUTHORIZED: 1009
  };

  function request(url, options) {
    var opts = options || {};
    var type = opts.type || 'GET';
    var data = opts.data || {};

    // 写操作统一发 JSON：避免 jQuery 表单序列化把嵌套对象压成 [object Object]
    var asJson = type !== 'GET' && typeof data === 'object';
    if (asJson && Object.keys(data).length === 0) data = {}; // 保证空对象也能发出 {}

    var deferred = $.Deferred();

    $.ajax({
      url: url,
      type: type,
      data: asJson ? JSON.stringify(data) : data,
      contentType: asJson ? 'application/json; charset=UTF-8' : undefined,
      processData: !asJson,
      dataType: 'json',
      timeout: opts.timeout || 15000,
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .done(function (res) {
        if (res && res.code === CODE.OK) {
          deferred.resolve(res.data, res.message);
        } else {
          deferred.reject({
            code: (res && res.code) || -1,
            message: (res && res.message) || '请求失败',
            data: res && res.data
          });
        }
      })
      .fail(function (xhr) {
        var body = xhr && xhr.responseJSON;
        deferred.reject({
          code: body ? body.code : -1,
          message: (body && body.message) || '网络异常，请稍后重试',
          data: body ? body.data : null,
          status: xhr && xhr.status
        });
      });

    return deferred.promise();
  }

  return {
    CODE: CODE,

    get: function (url, data, options) {
      return request(url, $.extend({}, options, { type: 'GET', data: data }));
    },

    post: function (url, data, options) {
      return request(url, $.extend({}, options, { type: 'POST', data: data }));
    },

    // ---------- 业务接口 ----------

    /** ① 极验初始化 */
    geetestRegister: function () {
      return request('/api/geetest/register', { type: 'POST' });
    },

    /** ② 账密校验（含极验二次校验），返回 { ticket } */
    loginCredentials: function (payload) {
      return request('/api/login/credentials', { type: 'POST', data: payload });
    },

    /** ③ 用户账号查询，返回 { accounts: [{ id, label, masked }] } */
    queryPhones: function (ticket) {
      return request('/api/account/phones', { type: 'GET', data: { ticket: ticket } });
    },

    /** ④ 发送短信验证码 */
    sendSms: function (ticket, accountId) {
      return request('/api/sms/send', { type: 'POST', data: { ticket: ticket, accountId: accountId } });
    },

    /** ⑤ 校验短信验证码 */
    verifySms: function (payload) {
      return request('/api/sms/verify', { type: 'POST', data: payload });
    }
  };
});
