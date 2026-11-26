// yt-shim.js — 「YT 直播」WebView 專用：補上油猴 API 的最小子集，並提供頁內選單
// 在 document-start 注入到 https://www.youtube.com（含聊天室 iframe）；儲存直接用 localStorage（同網域，主頁與聊天室共用）
(function () {
  'use strict';
  if (window.__ytShim) return;
  window.__ytShim = true;

  var cmds = [];
  window.GM_registerMenuCommand = function (name, fn) { cmds.push({ name: String(name), fn: fn }); };

  if (window.top !== window) return;            // 選單只放在最上層頁面
  var AB = window.YtBridge;

  var CSS = [
    '.tab{position:fixed;left:0;top:50%;transform:translateY(-50%);width:20px;height:56px;padding:0;border:0;',
    'border-radius:0 10px 10px 0;background:rgba(0,0,0,.45);color:#fff;font-size:16px;line-height:56px;opacity:.5}',
    '.panel{position:fixed;left:26px;top:50%;transform:translateY(-50%);min-width:176px;max-width:80vw;max-height:80vh;overflow:auto;',
    'background:rgba(24,24,24,.97);color:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,.5);',
    'font:14px/1.4 Roboto,Arial,"Noto Sans TC","Noto Sans JP",sans-serif}',
    '.panel[hidden]{display:none}',
    '.panel button{display:block;width:100%;padding:12px 14px;border:0;background:none;color:inherit;font:inherit;text-align:left}',
    '.panel button:active{background:rgba(255,255,255,.15)}',
    '.panel hr{margin:2px 0;border:0;border-top:1px solid rgba(255,255,255,.2)}'
  ].join('');

  function mount() {
    if (document.getElementById('ytshim-host')) return;
    var host = document.createElement('div');
    host.id = 'ytshim-host';
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    var tab = document.createElement('button');
    tab.className = 'tab';
    tab.textContent = '⋯';
    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.hidden = true;
    root.append(style, tab, panel);
    document.documentElement.append(host);

    function item(label, fn) {
      var b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', function () {
        panel.hidden = true;
        try { fn(); } catch (e) { console.warn('[ytshim]', e); }
      });
      panel.append(b);
    }

    function openUrl() {
      var v = prompt('輸入 YouTube 網址');
      if (!v) return;
      v = v.trim();
      if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
      try {
        var u = new URL(v);
        if (/(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be') location.href = u.href;
        else alert('只能開啟 YouTube 網址');
      } catch (e) { alert('網址格式不對'); }
    }

    function fill() {
      panel.replaceChildren();
      cmds.forEach(function (c) { item(c.name, c.fn); });
      if (cmds.length) panel.append(document.createElement('hr'));
      item('▶ YouTube 首頁', function () { location.href = 'https://www.youtube.com/'; });
      item('↻ 重新整理', function () { location.reload(); });
      item('🔗 開啟網址…', openUrl);
      if (AB && typeof AB.close === 'function') {
        panel.append(document.createElement('hr'));
        item('← 回到歌曲庫', function () { AB.close(); });
      }
    }

    tab.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.hidden) { fill(); panel.hidden = false; } else panel.hidden = true;
    });
    document.addEventListener('click', function (e) {
      if (!panel.hidden && e.composedPath().indexOf(host) < 0) panel.hidden = true;
    }, true);
    document.addEventListener('fullscreenchange', function () {
      host.style.display = document.fullscreenElement ? 'none' : '';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
