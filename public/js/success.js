/**
 * 登录成功页入口。
 * 只做一件事：退出登录。
 */
define(['jquery', 'modules/api'], function ($, api) {
  'use strict';

  $(function () {
    var $btn = $('#logoutBtn');

    $btn.on('click', function () {
      $btn.prop('disabled', true).text('正在退出...');

      api
        .post('/api/logout')
        .always(function () {
          window.location.href = '/';
        });
    });
  });
});
