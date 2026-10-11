/**
 * 极验验证封装。
 *
 * 对外只暴露一个 verify()，返回 Promise：
 *   resolve({ lot_number, captcha_output, pass_token, gen_time })  验证通过
 *   reject({ code: 'CLOSE' })                                      用户主动关闭
 *   reject({ message: '...' })                                     其它失败
 *
 * 两种模式：
 *   - gt4 ：加载极验官方 gt4.js，走真实行为验证
 *   - mock：后端未配置 GEETEST_KEY 时启用，用本地滑块模拟，保证流程可跑通
 */
define(['jquery', 'modules/api'], function ($, api) {
  'use strict';

  var GT4_SCRIPT_ID = 'geetest-gt4-js';

  /** 动态加载外部脚本 */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existed = document.getElementById(GT4_SCRIPT_ID);
      if (existed) {
        // 已加载完成
        if (window.initGeetest4) return resolve();
        // 正在加载中
        existed.addEventListener('load', resolve, { once: true });
        existed.addEventListener('error', function () { reject(new Error('极验脚本加载失败')); }, { once: true });
        return;
      }

      var script = document.createElement('script');
      script.id = GT4_SCRIPT_ID;
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('极验脚本加载失败，请检查网络')); };
      document.head.appendChild(script);
    });
  }

  /** 关闭所有残留的极验弹层（gt4 的浮层不在 Vue 管控范围内） */
  var activeCaptcha = null;
  function destroyActive() {
    if (activeCaptcha && typeof activeCaptcha.destroy === 'function') {
      try { activeCaptcha.destroy(); } catch (e) { /* ignore */ }
    }
    activeCaptcha = null;
  }

  // ---------------------------------------------------------------- 真实模式

  function verifyReal(config) {
    return loadScript(config.scriptUrl || 'https://static.geetest.com/v4/gt4.js').then(function () {
      return new Promise(function (resolve, reject) {
        if (typeof window.initGeetest4 !== 'function') {
          return reject({ message: '极验未正确初始化' });
        }

        window.initGeetest4(
          {
            captchaId: config.captchaId,
            product: 'bind',   // 点击后弹出浮层
            language: 'zho',
            riskType: 'slide',
            hideBar: ['close']
          },
          function (captchaObj) {
            activeCaptcha = captchaObj;

            captchaObj
              .onReady(function () {
                captchaObj.showCaptcha();
              })
              .onSuccess(function () {
                activeCaptcha = null;
                resolve(captchaObj.getValidate());
              })
              .onError(function () {
                activeCaptcha = null;
                reject({ message: '验证失败，请重试' });
              })
              .onClose(function () {
                activeCaptcha = null;
                reject({ code: 'CLOSE' });
              });
          }
        );
      });
    });
  }

  // ---------------------------------------------------------------- 模拟模式

  /**
   * 本地滑块。行为对齐极验：拖到最右侧才算通过。
   */
  function verifyMock(lotNumber) {
    return new Promise(function (resolve, reject) {
      var dragging = false;
      var startX = 0;
      var offset = 0;
      var maxOffset = 0;

      var $mask = $(
        '<div class="gt-mock-mask">' +
          '<div class="gt-mock">' +
            '<button type="button" class="gt-mock__close" title="关闭">&times;</button>' +
            '<div class="gt-mock__title">安全验证</div>' +
            '<div class="gt-mock__sub">当前为本地模拟验证（未配置极验 KEY）</div>' +
            '<div class="gt-mock__panel">拖动下方滑块完成拼图验证</div>' +
            '<div class="gt-mock__track">' +
              '<div class="gt-mock__fill"></div>' +
              '<div class="gt-mock__knob">&gt;&gt;</div>' +
              '<div class="gt-mock__text">向右拖动滑块填充拼图</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );

      var $track = $mask.find('.gt-mock__track');
      var $knob = $mask.find('.gt-mock__knob');
      var $fill = $mask.find('.gt-mock__fill');
      var $text = $mask.find('.gt-mock__text');

      $('body').append($mask);
      // 触发过渡动画
      window.requestAnimationFrame(function () { $mask.addClass('is-open'); });

      function bindEvents() {
        $knob.on('mousedown touchstart', onStart);
        $(document).on('mousemove touchmove', onMove);
        $(document).on('mouseup touchend', onEnd);
      }

      function unbindEvents() {
        $knob.off('mousedown touchstart', onStart);
        $(document).off('mousemove touchmove', onMove);
        $(document).off('mouseup touchend', onEnd);
      }

      function pointX(e) {
        var original = e.originalEvent || e;
        var touch = original.touches && original.touches[0];
        return touch ? touch.clientX : original.clientX;
      }

      function onStart(e) {
        e.preventDefault();
        dragging = true;
        startX = pointX(e);
        maxOffset = $track.width() - $knob.outerWidth();
        $text.hide();
      }

      function onMove(e) {
        if (!dragging) return;
        e.preventDefault();
        offset = Math.min(Math.max(pointX(e) - startX, 0), maxOffset);
        $knob.css('left', offset + 'px');
        $fill.css('width', offset + $knob.outerWidth() / 2 + 'px');
      }

      function onEnd() {
        if (!dragging) return;
        dragging = false;

        var progress = maxOffset > 0 ? offset / maxOffset : 0;
        if (progress >= 0.98) {
          cleanup();
          resolve({
            lot_number: lotNumber,
            captcha_output: 'mock-pass',
            pass_token: 'mock-pass-token',
            gen_time: String(Math.floor(Date.now() / 1000))
          });
          return;
        }

        // 未拖到底：回弹
        offset = 0;
        $knob.animate({ left: 0 }, 150);
        $fill.animate({ width: 0 }, 150, function () { $text.show(); });
      }

      function cleanup() {
        unbindEvents();
        $mask.removeClass('is-open');
        window.setTimeout(function () { $mask.remove(); }, 180);
      }

      // 关闭 / 取消
      $mask.find('.gt-mock__close').on('click', function () {
        cleanup();
        reject({ code: 'CLOSE' });
      });

      bindEvents();
    });
  }

  return {
    /**
     * 执行一次验证。
     * @returns {Promise<{lot_number:string, captcha_output:string, pass_token:string, gen_time:string}>}
     */
    verify: function () {
      destroyActive();

      return api.geetestRegister().then(function (config) {
        if (config.mode === 'gt4') return verifyReal(config);
        return verifyMock(config.lotNumber);
      });
    }
  };
});
