// ==UserScript==
// @name         YT 手機直向鎖定 + 打call快速組合
// @namespace    yt-mobile-combo
// @version      0.3.2
// @description  直向觀看：播放器固定在上、聊天室在下、鎖住捲動與縮放；控制列顯示畫面實際時刻（只有時分秒，改寫自 Youtube Live Clock）；留言曲目單轉進度條章節（改寫自 YouTube Setlist to Chapters）；聊天室「打call」快速組合面板（移植自 yt-chat-combo 0.4.0）
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

/*
 * 內含改寫自下列專案的邏輯：
 *  - YouTube Setlist to Chapters 0.2.0 — Copyright (c) nathan60107, MIT License
 *    https://github.com/nathan60107/YoutubeSetlist2Chapters
 *  - Youtube Live Clock 1.8.1 — Derek（https://greasyfork.org/scripts/453367）
 *  - yt-chat-combo 0.4.0（使用者自己的擴充功能）
 *
 * MIT License (nathan60107 部分)
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions: The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
 * KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR
 * ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

(() => {
  'use strict';

  // =====================================================================
  // 共用：儲存（優先 GM 儲存，沒有就退回 localStorage；兩個 frame 共用同一份）
  // =====================================================================
  const DATA_KEY = 'ytcombo_us';
  const LOCK_KEY = 'ylk_enabled';

  const sget = (k, d) => {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(k);
        if (v === undefined) return d;
        return typeof v === 'string' ? JSON.parse(v) : v;
      }
    } catch (e) { /* fallthrough */ }
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) { return d; }
  };
  const sset = (k, v) => {
    try {
      if (typeof GM_setValue === 'function') { GM_setValue(k, JSON.stringify(v)); return; }
    } catch (e) { /* fallthrough */ }
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ }
  };

  const path = location.pathname;
  if (path.startsWith('/live_chat')) {
    if (!path.startsWith('/live_chat_replay')) chatMain();
  } else {
    topMain();
  }

  // =====================================================================
  // 上層頁面：直向鎖定（播放器在上、聊天室在下；鎖捲動 / 縮放）
  // =====================================================================
  function topMain() {
    if (window.top !== window) return;
    if (window.__ylkLoaded) return;
    window.__ylkLoaded = true;

    const root = document.documentElement;
    let enabled = sget(LOCK_KEY, true) !== false;
    let chatTried = null;     // 每部影片只嘗試展開一次收合的聊天室
    let origViewport = null;  // 原本的 viewport meta 內容

    const CSS = `
      html.ylk, html.ylk body { overflow: hidden !important; overscroll-behavior: none !important; touch-action: pan-x pan-y !important; }
      html.ylk body { position: fixed !important; inset: 0 !important; width: 100% !important; }
      html.ylk #masthead-container, html.ylk ytd-app > #masthead { display: none !important; }
      html.ylk ytd-watch-flexy { visibility: hidden !important; }
      html.ylk ytd-watch-flexy ytd-player#ytd-player,
      html.ylk ytd-watch-flexy ytd-live-chat-frame#chat { visibility: visible !important; }
      html.ylk ytd-watch-flexy ytd-player#ytd-player {
        position: fixed !important; top: 0 !important; left: 0 !important;
        width: 100vw !important; height: 56.25vw !important;
        max-width: none !important; max-height: none !important; margin: 0 !important;
        border-radius: 0 !important; background: #000 !important; z-index: 2000 !important;
      }
      html.ylk ytd-watch-flexy ytd-player#ytd-player #container,
      html.ylk ytd-watch-flexy ytd-player#ytd-player .html5-video-player { width: 100% !important; height: 100% !important; border-radius: 0 !important; }
      html.ylk ytd-watch-flexy ytd-live-chat-frame#chat {
        position: fixed !important; top: 56.25vw !important; left: 0 !important; right: auto !important;
        width: 100vw !important; height: calc(100vh - 56.25vw) !important; height: calc(100dvh - 56.25vw) !important;
        min-height: 0 !important; max-height: none !important; margin: 0 !important;
        border: 0 !important; border-radius: 0 !important; z-index: 2000 !important;
      }
      html.ylk ytd-watch-flexy ytd-live-chat-frame#chat { overflow: hidden !important; }
      html.ylk ytd-watch-flexy ytd-live-chat-frame#chat iframe {
        max-width: none !important; transform-origin: 0 0 !important; transform: scale(var(--ylk-s, 1)) !important;
        width: calc(100vw / var(--ylk-s, 1)) !important;
        height: calc((100vh - 56.25vw) / var(--ylk-s, 1)) !important;
        height: calc((100dvh - 56.25vw) / var(--ylk-s, 1)) !important;
      }
      @media (orientation: landscape) {
        html.ylk ytd-watch-flexy ytd-player#ytd-player { width: 65vw !important; height: 100vh !important; height: 100dvh !important; }
        html.ylk ytd-watch-flexy ytd-live-chat-frame#chat { top: 0 !important; left: auto !important; right: 0 !important; width: 35vw !important; height: 100vh !important; height: 100dvh !important; }
        html.ylk ytd-watch-flexy ytd-live-chat-frame#chat iframe { width: calc(35vw / var(--ylk-s, 1)) !important; height: calc(100vh / var(--ylk-s, 1)) !important; height: calc(100dvh / var(--ylk-s, 1)) !important; }
      }
      .ytp-chrome-bottom .ytp-time-display { display: flex !important; align-items: center; }
      #ylk-clock { margin: 0 8px 0 4px; white-space: nowrap; }
      #ylk-chapter { margin: 0 8px 0 4px; max-width: 45vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .ytp-progress-bar { overflow: visible !important; }
      .ylk-ch-segs { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 42; }
      .ylk-ch-seg { position: absolute; top: 0; height: 100%; background: rgba(100,181,246,.55); border-right: 1.5px solid rgba(100,181,246,.8); box-sizing: border-box; }
      #ylk-btn {
        position: fixed; z-index: 2147483000; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 50%;
        background: rgba(0,0,0,.5); color: #fff; font-size: 16px; line-height: 34px; text-align: center; opacity: .55;
        right: 8px; bottom: 90px; display: none;
      }
      #ylk-btn.show { display: block; }
      html.ylk #ylk-btn { right: auto; bottom: auto; left: 6px; top: 6px; }
    `;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.documentElement.append(style);

    const btn = document.createElement('button');
    btn.id = 'ylk-btn';
    btn.type = 'button';
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.body.append(btn);

    const isWatch = () => location.pathname === '/watch' && !!document.querySelector('ytd-watch-flexy');
    const videoId = () => new URLSearchParams(location.search).get('v');

    // 嘗試把 viewport 鎖成裝置寬度、禁止縮放；瀏覽器若在「電腦版網站」模式忽略它也無妨（CSS 的 touch-action 另有防護）
    function setViewport(on) {
      let m = document.querySelector('meta[name="viewport"]');
      if (on) {
        if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.append(m); }
        if (origViewport === null) origViewport = m.getAttribute('content') || '';
        m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
      } else if (m && origViewport !== null) {
        if (origViewport) m.setAttribute('content', origViewport); else m.remove();
        origViewport = null;
      }
    }

    const fireResize = () => {
      window.dispatchEvent(new Event('resize'));
      setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    };

    // 聊天室放大倍率：設定 uiScale > 0 時用它（1＝不放大）；0＝自動（viewport 仍是電腦版寬度時才放大）
    function calcScale() {
      const d = sget(DATA_KEY, {}) || {};
      const manual = Number(d.settings && d.settings.uiScale);
      if (manual > 0) return Math.min(4, Math.max(0.5, manual));
      return window.innerWidth > 560 ? Math.min(3, Math.round((window.innerWidth / 400) * 100) / 100) : 1;
    }

    function apply() {
      const watch = isWatch();
      const on = enabled && watch && !document.fullscreenElement;
      btn.classList.toggle('show', watch && !document.fullscreenElement);
      btn.textContent = on ? '🔒' : '🔓';
      btn.title = on ? '解除鎖定' : '鎖定直向版面';
      if (on !== root.classList.contains('ylk')) {
        root.classList.toggle('ylk', on);
        if (!on) root.style.removeProperty('--ylk-s');
        setViewport(on);
        if (on) window.scrollTo(0, 0);
        fireResize();
      }
      if (on) {
        const sc = String(calcScale());
        if (root.style.getPropertyValue('--ylk-s') !== sc) root.style.setProperty('--ylk-s', sc);
        if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
        const vid = videoId();
        if (chatTried !== vid) {
          const c = document.querySelector('ytd-watch-flexy ytd-live-chat-frame#chat');
          if (c) {
            if (c.hasAttribute('collapsed')) {
              const b = c.querySelector('#show-hide-button button') || c.querySelector('#show-hide-button');
              if (b) b.click();
            }
            chatTried = vid;
          }
        }
      }
    }

    // ---- 時鐘（改寫自 Youtube Live Clock 1.8.1，Derek）----
    // 直播存檔：顯示目前畫面的實際時刻，只有時分秒、不含日期；直播中：顯示已直播時長
    let clockInfo = null;
    const p2 = (n) => String(n).padStart(2, '0');
    const hms = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    const dur = (sec) => {
      sec = Math.max(0, Math.floor(sec));
      const hh = Math.floor(sec / 3600), mm = Math.floor((sec / 60) % 60), ss = sec % 60;
      return hh > 0 ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
    };
    function readClockInfo(vid) {
      const sc = document.querySelector('#microformat script');
      if (!sc) return undefined;                                   // 資料還沒載入
      try {
        const j = JSON.parse(sc.textContent);
        if (j.embedUrl && !j.embedUrl.includes(vid)) return undefined; // 還是上一部影片的資料
        const pub = j.publication && j.publication[0];
        return pub ? { start: Date.parse(pub.startDate), ended: !!pub.endDate } : null;
      } catch (e) { return undefined; }
    }
    function tickClock() {
      let el = document.getElementById('ylk-clock');
      const td = document.querySelector('.ytp-chrome-bottom .ytp-time-display');
      const pb = document.querySelector('.ytp-chrome-bottom .ytp-progress-bar');
      if (!isWatch() || !td || !pb) { if (el) el.remove(); return; }
      const vid = videoId();
      if (!clockInfo || clockInfo.vid !== vid) {
        const r = readClockInfo(vid);
        if (r === undefined) return;
        clockInfo = { vid, none: !r, ...(r || {}) };
      }
      if (clockInfo.none) { if (el) el.remove(); return; }
      const pos = Number(pb.getAttribute('aria-valuenow'));
      if (!Number.isFinite(pos)) return;
      if (!el) {
        el = document.createElement('span');
        el.id = 'ylk-clock';
        td.insertBefore(el, td.childNodes[1] || null);
      }
      el.textContent = clockInfo.ended ? ` (${hms(new Date(clockInfo.start + Math.floor(pos) * 1000))})` : ` (${dur(pos)})`;
    }

    // ---- 曲目單章節（改寫自 YouTube Setlist to Chapters 0.2.0，nathan60107，MIT）----
    // 原作用 youtubei.js 抓留言；這裡改用頁面自己的 ytcfg 直接呼叫 /youtubei/v1/next，不需要那個 1.4MB 的函式庫。
    // 流程：抓前 3 頁置頂留言 → 挑時間戳最多（至少 2 個）的留言 → 逐行解析成章節 → 在進度條上畫藍色區段，
    //       並把「目前章節名稱」顯示在控制列（觸控沒有滑鼠懸停提示）。
    const CH_KEY = 'ylk_chapters';
    let chaptersOn = sget(CH_KEY, true) !== false;
    let ch = { vid: null, status: 'idle', note: '', chapters: null, segments: null };
    const COMMENT_PAGES = 3;
    const DEFAULT_SONG_SEC = 240;
    const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const ycfg = (k) => { try { return W.ytcfg && W.ytcfg.get ? W.ytcfg.get(k) : undefined; } catch (e) { return undefined; } };

    async function rawNext(payload) {
      let ctx = null;
      try { const c = ycfg('INNERTUBE_CONTEXT'); if (c) ctx = JSON.parse(JSON.stringify(c)); } catch (e) { /* ignore */ }
      if (!ctx) ctx = { client: { clientName: 'WEB', clientVersion: String(ycfg('INNERTUBE_CLIENT_VERSION') || '2.20260101.00.00'), hl: 'ja', gl: 'JP' } };
      const key = ycfg('INNERTUBE_API_KEY');
      const res = await fetch('/youtubei/v1/next?prettyPrint=false' + (key ? '&key=' + encodeURIComponent(key) : ''), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Youtube-Client-Name': String(ycfg('INNERTUBE_CONTEXT_CLIENT_NAME') || 1),
          'X-Youtube-Client-Version': String(ycfg('INNERTUBE_CONTEXT_CLIENT_VERSION') || ctx.client.clientVersion),
        },
        body: JSON.stringify({ context: ctx, ...payload }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }

    function findCommentSectionToken(node) {
      if (!node || typeof node !== 'object') return null;
      if (node.itemSectionRenderer && node.itemSectionRenderer.sectionIdentifier === 'comment-item-section') {
        const c0 = node.itemSectionRenderer.contents && node.itemSectionRenderer.contents[0];
        const t = c0 && c0.continuationItemRenderer && c0.continuationItemRenderer.continuationEndpoint &&
          c0.continuationItemRenderer.continuationEndpoint.continuationCommand &&
          c0.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
        if (t) return t;
      }
      for (const v of Array.isArray(node) ? node : Object.values(node)) {
        const r = findCommentSectionToken(v);
        if (r) return r;
      }
      return null;
    }

    // 下一頁留言的 token 一定在留言清單的「最後一項」（遞迴搜尋會撞到回覆的展開 token）
    function findNextPageToken(page) {
      for (const ep of page.onResponseReceivedEndpoints || []) {
        const reload = ep.reloadContinuationItemsCommand;
        const items = reload && reload.slot === 'RELOAD_CONTINUATION_SLOT_BODY'
          ? reload.continuationItems
          : ep.appendContinuationItemsAction && ep.appendContinuationItemsAction.continuationItems;
        if (!items || !items.length) continue;
        const last = items[items.length - 1];
        const token = last && last.continuationItemRenderer && last.continuationItemRenderer.continuationEndpoint &&
          last.continuationItemRenderer.continuationEndpoint.continuationCommand &&
          last.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
        if (token) return token;
      }
      return null;
    }

    // ---- 曲目單解析（逐行移植）----
    const TS_G = /\d{1,2}:\d{2}(?::\d{2})?/g;
    const TS = /\d{1,2}:\d{2}(?::\d{2})?/;
    const EMOJI_SHORTCODE_RE = /:_[^\s:]*:/g;
    const TOFU_RE = /□/g;
    const LEADING_SEP_RE = /^(?:[\s\u200B\-–—|•·:└├]|～(?=\s))+/;
    const TRAILING_SEP_RE = /[\s\u200B\-–—|•·:]+$/;
    const NUMBERING_ONLY_RE = /^(?:[\d０-９]+|[①-⓿㉑-㊿])[.．、]?$/;
    const countTs = (text) => (text.match(TS_G) || []).length;
    const cleanTitlePart = (part) => part.replace(EMOJI_SHORTCODE_RE, '').replace(TOFU_RE, '').replace(LEADING_SEP_RE, '').replace(TRAILING_SEP_RE, '');
    function titleFromNextLine(before, next) {
      if (before && !NUMBERING_ONLY_RE.test(before)) return '';
      if (next === undefined) return '';
      const t = next.trim();
      if (TS.test(t)) return '';
      return cleanTitlePart(t);
    }
    function tsToSec(x) {
      const a = x.split(':').map(Number);
      return a.length === 3 ? a[0] * 3600 + a[1] * 60 + a[2] : a[0] * 60 + a[1];
    }
    function parseLine(line, next) {
      const trimmed = line.trim();
      const start = TS.exec(trimmed);
      if (!start) return null;
      const startSec = tsToSec(start[0]);
      const afterStart = start.index + start[0].length;
      const rest = trimmed.slice(afterStart);
      const second = TS.exec(rest);
      const secondSec = second ? tsToSec(second[0]) : undefined;
      const trailing = second && secondSec > startSec ? second : null;
      const endSec = trailing && /\S/.test(rest.slice(0, trailing.index)) ? secondSec : undefined;
      const consumedUntil = trailing ? afterStart + trailing.index + trailing[0].length : afterStart;
      const after = cleanTitlePart(trimmed.slice(consumedUntil));
      const before = cleanTitlePart(trimmed.slice(0, start.index));
      const title = after || titleFromNextLine(before, next) || before;
      if (!title) return null;
      return endSec !== undefined ? { timestampSec: startSec, endTimestampSec: endSec, title } : { timestampSec: startSec, title };
    }

    async function loadChapters(vid) {
      const watch = await rawNext({ videoId: vid });
      let token = findCommentSectionToken(watch);
      if (!token) return { chapters: null, note: '找不到留言區（可能關閉了留言）' };
      const cands = [];
      for (let i = 0; i < COMMENT_PAGES && token; i++) {
        const page = await rawNext({ continuation: token });
        const muts = (page.frameworkUpdates && page.frameworkUpdates.entityBatchUpdate && page.frameworkUpdates.entityBatchUpdate.mutations) || [];
        for (const m of muts) {
          const pl = m.payload && m.payload.commentEntityPayload;
          if (!pl) continue;
          if (pl.properties && pl.properties.replyLevel) continue;   // 回覆不會放曲目單
          const text = (pl.properties && pl.properties.content && pl.properties.content.content) || '';
          cands.push({ text, n: countTs(text) });
        }
        token = findNextPageToken(page);
      }
      if (!cands.length) return { chapters: null, note: '沒有抓到任何留言' };
      const best = cands.reduce((a, b) => (b.n > a.n ? b : a));
      if (best.n < 2) return { chapters: null, note: `看了 ${cands.length} 則留言，沒有含 2 個以上時間戳的` };
      const lines = best.text.split('\n');
      const chapters = lines.map((l, i) => parseLine(l, lines[i + 1])).filter(Boolean);
      if (chapters.length <= 1) return { chapters: null, note: '曲目單留言解析後不到 2 章' };
      return { chapters, note: `${chapters.length} 章` };
    }

    function computeSegments(chapters, dur) {
      const sorted = [...chapters].sort((a, b) => a.timestampSec - b.timestampSec)
        .filter((c, i, arr) => i === 0 || c.timestampSec !== arr[i - 1].timestampSec);
      return sorted.map((c, i) => {
        const next = sorted[i + 1] ? sorted[i + 1].timestampSec : dur;
        const rawEnd = c.endTimestampSec !== undefined ? c.endTimestampSec : c.timestampSec + DEFAULT_SONG_SEC;
        return { startSec: c.timestampSec, endSec: Math.min(rawEnd, next, dur), title: c.title };
      });
    }

    function removeChapterUi() {
      document.querySelectorAll('.ylk-ch-segs').forEach((e) => e.remove());
      const t = document.getElementById('ylk-chapter');
      if (t) t.remove();
    }

    function startChapterLoad(vid) {
      removeChapterUi();
      ch = { vid, status: 'loading', note: '讀取留言中…', chapters: null, segments: null };
      loadChapters(vid).then((r) => {
        if (ch.vid !== vid) return;                       // 已切換影片
        ch.status = r.chapters ? 'ready' : 'none';
        ch.chapters = r.chapters;
        ch.note = r.note;
        console.log('[ylk] chapters', vid, r.note);
      }, (e) => {
        if (ch.vid !== vid) return;
        ch.status = 'error';
        ch.note = '失敗：' + ((e && e.message) || e);
        console.warn('[ylk] chapters failed', e);
      });
    }

    function tickChapters() {
      if (!chaptersOn || !isWatch()) {
        if (ch.vid) { removeChapterUi(); ch = { vid: null, status: 'idle', note: '', chapters: null, segments: null }; }
        return;
      }
      const vid = videoId();
      if (!vid) return;
      if (ch.vid !== vid) { startChapterLoad(vid); return; }
      if (ch.status !== 'ready') return;
      const pb = document.querySelector('.ytp-progress-bar');
      const v = document.querySelector('video.html5-main-video');
      if (!pb || !v) return;
      const dur = v.duration;
      if (!isFinite(dur) || dur <= 0) return;               // 直播中沒有固定長度，不畫
      // 進度條被 YouTube 重建（版面變動、換畫質）時自動重畫
      let box = pb.querySelector(':scope > .ylk-ch-segs');
      const key = String(Math.round(dur));
      if (!box || box.dataset.dur !== key) {
        if (box) box.remove();
        ch.segments = computeSegments(ch.chapters, dur);
        box = document.createElement('div');
        box.className = 'ylk-ch-segs';
        box.dataset.dur = key;
        for (const seg of ch.segments) {
          const w = ((seg.endSec - seg.startSec) / dur) * 100;
          if (w <= 0) continue;
          const el = document.createElement('div');
          el.className = 'ylk-ch-seg';
          el.style.left = `${(seg.startSec / dur) * 100}%`;
          el.style.width = `${w}%`;
          box.append(el);
        }
        pb.prepend(box);
      }
      // 控制列顯示目前章節名稱
      const td = document.querySelector('.ytp-chrome-bottom .ytp-time-display');
      if (!td || !ch.segments) return;
      const t = v.currentTime;
      const cur = ch.segments.find((s) => t >= s.startSec && t < s.endSec);
      let el = document.getElementById('ylk-chapter');
      if (!cur) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement('span'); el.id = 'ylk-chapter'; td.append(el); }
      if (el.textContent !== cur.title) el.textContent = cur.title;
    }

    function toggleChapters() {
      chaptersOn = !chaptersOn;
      sset(CH_KEY, chaptersOn);
      tickChapters();
      alert('章節顯示：' + (chaptersOn ? '開' : '關'));
    }

    function toggle() {
      enabled = !enabled;
      sset(LOCK_KEY, enabled);
      apply();
    }

    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('切換直向鎖定', toggle);
      GM_registerMenuCommand('切換章節顯示', toggleChapters);
      GM_registerMenuCommand('切換聊天室放大（自動／不放大）', () => {
        const d = sget(DATA_KEY, {}) || {};
        d.settings = { ...(d.settings || {}) };
        d.settings.uiScale = Number(d.settings.uiScale) > 0 ? 0 : 1;
        sset(DATA_KEY, d);
        alert('聊天室放大：' + (d.settings.uiScale > 0 ? '不放大' : '自動'));
      });
      GM_registerMenuCommand('章節狀態', () => alert(`章節：${chaptersOn ? '開' : '關'}\n狀態：${ch.status}\n${ch.note || ''}`));
    }
    document.addEventListener('fullscreenchange', apply);
    document.addEventListener('yt-navigate-finish', apply);
    window.addEventListener('resize', () => { if (root.classList.contains('ylk')) window.scrollTo(0, 0); });
    setInterval(apply, 800);
    setInterval(tickClock, 500);
    setInterval(tickChapters, 1000);
    apply();
  }

  // =====================================================================
  // 聊天室 frame：打call快速組合面板
  // =====================================================================
  function chatMain() {
    if (window.__ycComboLoaded) return;
    window.__ycComboLoaded = true;

    // ---------------- 選擇器（YouTube 改版時優先檢查這裡）----------------
    const SEL = {
      input: [
        'yt-live-chat-text-input-field-renderer div#input[contenteditable]',
        'yt-live-chat-text-input-field-renderer #input',
        '#input[contenteditable]',
      ],
      inputPanel: ['#input-panel', 'yt-live-chat-message-input-renderer'],
      picker: ['yt-emoji-picker-renderer'],
    };
    const q = (list) => { for (const s of list) { const el = document.querySelector(s); if (el) return el; } return null; };

    // ---------------- 資料 ----------------
    const DEFAULT_SETTINGS = { panelWidth: 280, panelHeight: 240, defaultOpen: false, autoCollapse: true, uiScale: 0 };
    const GENERAL_EMOJI_OWNERS = ['UCkszU2WH9gy1mb0dV-11UJg'];

    const clamp = (n, lo, hi, d) => { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
    const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ');
    const safeSrc = (s) => (typeof s === 'string' && /^https:\/\//.test(s) ? s : '');
    const isChannelId = (s) => /^UC[\w-]{22}$/.test(s);

    function load() {
      const d = sget(DATA_KEY, {}) || {};
      return {
        global: Array.isArray(d.global) ? d.global : [],
        channels: d.channels && typeof d.channels === 'object' ? d.channels : {},
        channelOrder: Array.isArray(d.channelOrder) ? d.channelOrder : [],
        settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) },
      };
    }
    const save = (d) => sset(DATA_KEY, d);

    function orderedChannelIds(d) {
      const ids = [];
      for (const id of d.channelOrder || []) if (d.channels[id] && !ids.includes(id)) ids.push(id);
      for (const id of Object.keys(d.channels)) if (!ids.includes(id)) ids.push(id);
      return ids;
    }

    function partsKey(parts) {
      const out = [];
      for (const p of parts || []) {
        if (p && p.type === 'emote') out.push('e:' + (p.emojiId || p.alt || p.src || ''));
        else {
          const v = p && typeof p.value === 'string' ? p.value : '';
          if (out.length && out[out.length - 1].startsWith('t:')) out[out.length - 1] += v;
          else out.push('t:' + v);
        }
      }
      return out.filter((k) => k !== 't:').join('\u0001');
    }
    const plain = (parts) => parts.map((p) => (p.type === 'emote' ? p.alt || '' : p.value || '')).join('');

    function h(tag, props, ...kids) {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (k === 'class') e.className = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'value') e[k] = k === 'value' ? v : !!v;
        else e.setAttribute(k, v);
      }
      for (const k of kids.flat(Infinity)) {
        if (k === null || k === undefined || k === false) continue;
        e.append(k.nodeType ? k : document.createTextNode(String(k)));
      }
      return e;
    }

    const preview = (parts) => parts.map((p) =>
      p.type === 'emote'
        ? safeSrc(p.src) ? h('img', { src: p.src, alt: p.alt || '', draggable: 'false' }) : h('span', null, p.alt || '')
        : h('span', null, p.value || ''));

    function cleanParts(parts) {
      return (Array.isArray(parts) ? parts : []).map((p) => {
        if (p && p.type === 'emote' && safeSrc(p.src)) {
          return { type: 'emote', alt: String(p.alt || ''), src: p.src, emojiId: String(p.emojiId || ''), tooltip: String(p.tooltip || p.alt || ''), general: !!p.general };
        }
        if (p && p.type === 'text' && typeof p.value === 'string') return { type: 'text', value: oneLine(p.value) };
        return null;
      }).filter(Boolean);
    }
    const cleanCombos = (arr) => (Array.isArray(arr) ? arr : [])
      .map((c) => ({ id: uid(), name: String((c && c.name) || ''), parts: cleanParts(c && c.parts) }))
      .filter((c) => c.parts.length);

    // 匯入（相容 yt-chat-combo 的 kind:'all' / kind:'channel' 匯出檔）：合併、略過內容相同的組合
    function mergeImport(d, obj) {
      if (!obj || typeof obj !== 'object') throw new Error('格式錯誤');
      let added = 0;
      const addInto = (list, combos) => {
        const keys = new Set(list.map((c) => partsKey(c.parts)));
        for (const c of cleanCombos(combos)) {
          const k = partsKey(c.parts);
          if (keys.has(k)) continue;
          keys.add(k); list.push(c); added++;
        }
      };
      const chan = (id, name) => (d.channels[id] = d.channels[id] || { name: name || '', combos: [] });
      if (obj.kind === 'channel' && obj.channel) {
        const c = obj.channel;
        if (c.id === 'global') addInto(d.global, c.combos);
        else if (isChannelId(c.id)) { const ch = chan(c.id, c.name); if (!ch.name && c.name) ch.name = String(c.name); addInto(ch.combos, c.combos); }
        else throw new Error('找不到頻道 ID');
      } else if (obj.global || obj.channels) {
        addInto(d.global, obj.global);
        for (const [id, c] of Object.entries(obj.channels || {})) {
          if (!isChannelId(id)) continue;
          const ch = chan(id, c && c.name);
          if (!ch.name && c && c.name) ch.name = String(c.name);
          addInto(ch.combos, c && c.combos);
        }
        if (Array.isArray(obj.channelOrder)) {
          for (const id of obj.channelOrder) if (d.channels[id] && !d.channelOrder.includes(id)) d.channelOrder.push(id);
        }
      } else throw new Error('不是 yt-chat-combo 的匯出檔');
      return added;
    }

    // ---------------- 樣式 ----------------
    const CSS = `
      :host { all: initial; }
      .wrap {
        position: fixed; right: 0; bottom: 70px; display: flex; align-items: flex-end;
        pointer-events: auto; z-index: 2147483000;
        font: 14px/1.4 Roboto, Arial, "Noto Sans TC", "Microsoft JhengHei", "Noto Sans JP", sans-serif;
        transition: transform .18s ease, bottom .15s ease;
        --bg:#fff; --fg:#0f0f0f; --sub:#606060; --line:#d0d0d0; --btn:#f2f2f2; --btn-h:#e2e2e2; --acc:#065fd4;
      }
      .wrap.dark { --bg:#212121; --fg:#f1f1f1; --sub:#aaa; --line:#444; --btn:#303030; --btn-h:#3f3f3f; --acc:#3ea6ff; }
      .wrap:not(.open) { transform: translateX(var(--w)); }
      .tab { width: 28px; height: 92px; margin-bottom: 8px; padding: 0; cursor: pointer;
        writing-mode: vertical-rl; letter-spacing: 2px; font-size: 13px;
        border: 1px solid var(--line); border-right: none; border-radius: 8px 0 0 8px; background: var(--bg); color: var(--fg); }
      .body { position: relative; box-sizing: border-box; width: var(--w); height: var(--h); display: flex; flex-direction: column;
        background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-right: none;
        border-radius: 8px 0 0 0; box-shadow: -2px 0 8px rgba(0,0,0,.25); }
      .head { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
      .title { flex: 1; min-width: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .title small { font-weight: 400; color: var(--sub); margin-left: 6px; }
      .icon { width: 32px; height: 32px; padding: 0; cursor: pointer; border: none; border-radius: 4px; background: var(--btn); color: var(--fg); font-size: 15px; }
      .auto { flex-shrink: 0; width: 18px; height: 18px; margin: 0 4px; cursor: pointer; accent-color: var(--acc); }
      .list, .manage { flex: 1; overflow-y: auto; padding: 6px 8px 10px; touch-action: pan-y; }
      .manage[hidden], .list[hidden] { display: none; }
      .sec { margin: 8px 0 4px; font-size: 12px; color: var(--sub); }
      .sec:first-child { margin-top: 0; }
      .grid { display: flex; flex-wrap: wrap; gap: 6px; }
      .combo { max-width: 100%; box-sizing: border-box; padding: 6px 10px; cursor: pointer; text-align: left;
        border: 1px solid var(--line); border-radius: 16px; background: var(--btn); color: var(--fg); font: inherit; white-space: pre-wrap; word-break: break-all; }
      .combo .name { display: block; font-size: 10px; color: var(--sub); line-height: 1.2; }
      .combo img, .pv img, .mrow img { height: 22px; width: auto; vertical-align: middle; }
      .empty { color: var(--sub); padding: 12px 4px; }
      .form { padding: 8px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
      .form[hidden] { display: none; }
      .form input, .form select, .manage input, .manage select, .manage textarea { box-sizing: border-box; width: 100%; padding: 6px; font: inherit;
        border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--fg); }
      .pv { padding: 4px 6px; border: 1px dashed var(--line); border-radius: 4px; white-space: pre-wrap; word-break: break-all; max-height: 56px; overflow: auto; }
      .hint { color: #d93025; font-size: 11px; }
      .hint:empty { display: none; }
      .row { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
      .row button, .manage button.t { padding: 6px 12px; cursor: pointer; border: 1px solid var(--line); border-radius: 4px; background: var(--btn); color: var(--fg); font: inherit; }
      .row button.ok { background: var(--acc); color: #fff; border-color: var(--acc); }
      .mrow { display: flex; align-items: center; gap: 4px; padding: 4px 0; border-bottom: 1px solid var(--line); }
      .mrow .mt { flex: 1; min-width: 0; word-break: break-all; white-space: pre-wrap; }
      .mrow .mt small { display: block; color: var(--sub); font-size: 10px; }
      .mrow button { width: 30px; height: 30px; padding: 0; border: none; border-radius: 4px; background: var(--btn); color: var(--fg); cursor: pointer; }
      .mh { margin: 12px 0 4px; font-weight: 600; }
      .field { display: flex; align-items: center; gap: 8px; margin: 4px 0; font-size: 13px; }
      .field input[type=number] { width: 80px; }
      .field input[type=checkbox] { width: 18px; height: 18px; }
      .manage textarea { min-height: 70px; }
      .toast { position: absolute; left: 8px; right: 8px; bottom: 8px; padding: 6px 10px; border-radius: 6px;
        background: rgba(0,0,0,.85); color: #fff; font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .2s; }
      .toast.show { opacity: 1; }
    `;

    // ---------------- 狀態 ----------------
    let data = null;
    let channel = { id: null, name: '' };
    let ui = {};
    let isOpen = false;
    let manageOpen = false;
    let lastVideoId = null;
    let failCount = 0;
    let busy = false;
    let pendingParts = [];
    let autoCollapse = true;
    let toastTimer;
    // 版面鎖定時，聊天室 frame 內也禁止雙指縮放（頁面層級的 touch-action 不會套用到 iframe 內部）
    // 放大聊天室字體改由上層頁面縮放 iframe 元素，frame 內部不再有任何縮放。
    const embedded = window.parent !== window;
    let lockStyle = null;
    function applyTouchLock() {
      let locked = false;
      if (embedded) { try { locked = window.parent.document.documentElement.classList.contains('ylk'); } catch (e) { /* ignore */ } }
      if (locked && !lockStyle) {
        lockStyle = document.createElement('style');
        lockStyle.textContent = 'html { touch-action: pan-y !important; }';
        document.documentElement.append(lockStyle);
      } else if (!locked && lockStyle) { lockStyle.remove(); lockStyle = null; }
    }

    // ---------------- 頻道偵測 ----------------
    function getVideoId() {
      const fromUrl = (u) => {
        try {
          const x = new URL(u);
          return x.searchParams.get('v') || (x.pathname.match(/^\/live\/([\w-]{11})/) || [])[1] || null;
        } catch (e) { return null; }
      };
      let id = fromUrl(location.href);
      if (!id) { try { id = fromUrl(window.parent.location.href); } catch (e) { /* ignore */ } }
      return id;
    }

    async function detectChannel(videoId) {
      try {
        const res = await fetch('/watch?v=' + encodeURIComponent(videoId), { credentials: 'same-origin' });
        const html = await res.text();
        const m = html.match(/"videoDetails":\{[^}]*?"channelId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/);
        if (m) {
          let name = '';
          const n = html.match(/"videoDetails":\{[\s\S]*?"author":"((?:[^"\\]|\\.)*)"/);
          if (n) { try { name = JSON.parse('"' + n[1] + '"'); } catch (e) { /* ignore */ } }
          return { id: m[1], name };
        }
      } catch (e) { /* 往下試備援 */ }
      try {
        const meta = window.parent.document.querySelector('meta[itemprop="channelId"]');
        if (meta && isChannelId(meta.content)) return { id: meta.content, name: '' };
      } catch (e) { /* ignore */ }
      return null;
    }

    async function refreshChannel() {
      if (busy) return;
      const vid = getVideoId();
      if (!vid) return;
      if (vid === lastVideoId && (channel.id || failCount >= 3)) return;
      busy = true;
      try {
        if (vid !== lastVideoId) { lastVideoId = vid; failCount = 0; channel = { id: null, name: '' }; }
        const c = await detectChannel(vid);
        if (c) channel = c; else failCount++;
        render();
      } finally { busy = false; }
    }

    // ---------------- 輸入框：讀取 / 插入 ----------------
    const getInput = () => q(SEL.input);

    function readInputParts() {
      const input = getInput();
      const parts = [];
      if (!input) return parts;
      const pushText = (t) => {
        t = oneLine(t);
        if (!t) return;
        const last = parts[parts.length - 1];
        if (last && last.type === 'text') last.value += t; else parts.push({ type: 'text', value: t });
      };
      const walk = (node) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) pushText(n.nodeValue);
          else if (n.nodeName === 'IMG') {
            const emojiId = n.getAttribute('data-emoji-id') || '';
            const alt = n.getAttribute('alt') || '';
            const src = safeSrc(n.src);
            if (emojiId.includes('/') && src) {
              const owner = emojiId.split('/')[0];
              const general = channel.id ? owner !== channel.id : GENERAL_EMOJI_OWNERS.includes(owner);
              parts.push({ type: 'emote', alt, src, emojiId, tooltip: n.getAttribute('shared-tooltip-text') || alt, general });
            } else pushText(alt);
          } else if (n.nodeName === 'BR') { /* 單行，忽略換行 */ } else walk(n);
        }
      };
      walk(input);
      return parts;
    }

    function buildNodes(parts) {
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        if (p.type === 'emote' && safeSrc(p.src)) {
          const img = document.createElement('img');
          img.className = 'emoji yt-formatted-string style-scope yt-live-chat-text-input-field-renderer';
          img.src = p.src;
          img.alt = p.alt || '';
          if (p.emojiId) img.setAttribute('data-emoji-id', p.emojiId);
          img.setAttribute('shared-tooltip-text', p.tooltip || p.alt || '');
          img.setAttribute('aria-label', p.tooltip || p.alt || '');
          frag.append(img);
        } else frag.append(document.createTextNode(p.type === 'emote' ? p.alt || '' : p.value || ''));
      }
      return frag;
    }

    function insertParts(parts) {
      const input = getInput();
      if (!input) { toast('找不到聊天輸入框'); return false; }
      input.focus();
      const sel = window.getSelection();
      let range;
      if (sel.rangeCount && input.contains(sel.getRangeAt(0).commonAncestorContainer)) range = sel.getRangeAt(0);
      else { range = document.createRange(); range.selectNodeContents(input); range.collapse(false); }
      range.deleteContents();
      const frag = buildNodes(parts);
      const last = frag.lastChild;
      range.insertNode(frag);
      if (last) { range.setStartAfter(last); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); }
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
      return true;
    }

    // ---------------- UI 基礎 ----------------
    function toast(msg, ms = 2400) {
      if (!ui.toast) return;
      ui.toast.textContent = msg;
      ui.toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
    }

    function setOpen(v) {
      isOpen = v;
      ui.wrap.classList.toggle('open', v);
      if (v) reposition(); else { ui.form.hidden = true; setManage(false); }
    }

    function setManage(v) {
      manageOpen = v;
      ui.manage.hidden = !v;
      ui.list.hidden = v;
      if (v) { ui.form.hidden = true; renderManage(); }
    }

    function reposition() {
      const ip = q(SEL.inputPanel);
      let bottom = 70;
      let height = Number(data.settings.panelHeight) || 240;
      if (ip) {
        bottom = Math.max(0, window.innerHeight - ip.getBoundingClientRect().top);
        const input = getInput();
        const picker = q(SEL.picker);
        if (input) {
          const below = window.innerHeight - input.getBoundingClientRect().bottom;
          const pickerOpen = below > 100 || (picker && picker.getBoundingClientRect().height > 60);
          if (pickerOpen && below - 8 >= 120) { bottom = 0; height = Math.min(height, below - 8); }
        }
      }
      height = Math.max(100, Math.min(height, window.innerHeight - bottom - 40));
      const width = Math.max(100, Math.min(Number(data.settings.panelWidth) || 280, window.innerWidth - 28 - 4));
      ui.wrap.style.setProperty('--w', width + 'px');
      ui.wrap.style.bottom = bottom + 'px';
      ui.wrap.style.setProperty('--h', height + 'px');
    }

    function renderCombo(c) {
      return h('button',
        { class: 'combo', title: plain(c.parts), onclick: () => { if (insertParts(c.parts) && autoCollapse) setOpen(false); } },
        c.name ? h('span', { class: 'name' }, c.name) : null,
        preview(c.parts));
    }

    function render() {
      if (!ui.wrap) return;
      ui.wrap.classList.toggle('dark', document.documentElement.hasAttribute('dark'));
      ui.title.replaceChildren('打call', h('small', null, channel.id ? channel.name || channel.id : '未偵測到頻道'));
      ui.list.replaceChildren();
      const local = channel.id && data.channels[channel.id] ? data.channels[channel.id].combos || [] : [];
      const sections = [];
      if (local.length) sections.push([channel.name ? '「' + channel.name + '」專用' : '本頻道', local]);
      if (data.global.length) sections.push(['通用', data.global]);
      if (!sections.length) ui.list.append(h('div', { class: 'empty' }, '還沒有組合。在聊天輸入框輸入文字或貼圖，再按上方「＋」儲存。'));
      for (const [label, combos] of sections) {
        ui.list.append(h('div', { class: 'sec' }, label), h('div', { class: 'grid' }, combos.map(renderCombo)));
      }
      if (manageOpen) renderManage();
    }

    // ---------------- 「＋」存組合 ----------------
    function updateHint() {
      const hasEmote = pendingParts.some((p) => p.type === 'emote' && !p.general);
      ui.fHint.textContent = hasEmote && ui.fScope.value === 'global' ? '含頻道專屬貼圖：存成「通用」時，在其他頻道可能無法使用' : '';
    }

    function findDuplicate(d, parts) {
      const key = partsKey(parts);
      const local = channel.id && d.channels[channel.id] ? d.channels[channel.id].combos || [] : [];
      for (const [where, list] of [['本頻道', local], ['通用', d.global]]) {
        const hit = list.find((c) => partsKey(c.parts) === key);
        if (hit) return { where, name: hit.name };
      }
      return null;
    }
    const dupMessage = (dup) => `「${dup.where}」已有相同組合${dup.name ? '（' + dup.name + '）' : ''}，不重複儲存`;

    function openSaveForm() {
      setManage(false);
      const parts = readInputParts();
      if (!parts.length) { toast('輸入框是空的：先輸入文字或貼圖'); return; }
      const dup = findDuplicate(data, parts);
      if (dup) { toast(dupMessage(dup), 3600); return; }
      pendingParts = parts;
      ui.fName.value = '';
      ui.fScope.replaceChildren();
      if (channel.id) ui.fScope.append(h('option', { value: 'channel' }, channel.name ? '「' + channel.name + '」專用' : '本頻道'));
      ui.fScope.append(h('option', { value: 'global' }, '通用'));
      ui.fScope.value = channel.id ? 'channel' : 'global';
      ui.fPv.replaceChildren(...preview(parts));
      updateHint();
      ui.form.hidden = false;
    }

    function confirmSave() {
      const d = load();
      const dup = findDuplicate(d, pendingParts);
      if (dup) { ui.form.hidden = true; toast(dupMessage(dup), 3600); return; }
      const combo = { id: uid(), name: ui.fName.value.trim(), parts: pendingParts };
      if (ui.fScope.value === 'channel' && channel.id) {
        const ch = (d.channels[channel.id] = d.channels[channel.id] || { name: channel.name, combos: [] });
        if (!ch.name && channel.name) ch.name = channel.name;
        ch.combos.push(combo);
      } else d.global.push(combo);
      save(d);
      data = d;
      ui.form.hidden = true;
      render();
      toast('已儲存');
    }

    // ---------------- 管理畫面（取代原本的設定頁）----------------
    function scopeList(d, scope) {
      if (scope === 'global') return d.global;
      return d.channels[scope] ? d.channels[scope].combos : null;
    }

    function renderManage() {
      const d = data;
      const scopes = [['global', '通用']];
      for (const id of orderedChannelIds(d)) scopes.push([id, d.channels[id].name || id]);
      if (channel.id && !d.channels[channel.id]) scopes.push([channel.id, (channel.name || channel.id) + '（尚無組合）']);
      let cur = ui.mScopeVal;
      if (!cur || !scopes.some((s) => s[0] === cur)) cur = channel.id && d.channels[channel.id] ? channel.id : 'global';
      ui.mScopeVal = cur;

      const sel = h('select', { onchange: (e) => { ui.mScopeVal = e.target.value; renderManage(); } },
        scopes.map(([v, n]) => h('option', { value: v }, n)));
      sel.value = cur;

      const list = scopeList(d, cur) || [];
      const rows = list.map((c, i) => h('div', { class: 'mrow' },
        h('div', { class: 'mt' }, c.name ? h('small', null, c.name) : null, preview(c.parts)),
        h('button', { title: '上移', onclick: () => mutate(cur, (l) => { if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]]; }) }, '↑'),
        h('button', { title: '下移', onclick: () => mutate(cur, (l) => { if (i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]]; }) }, '↓'),
        h('button', { title: '改名', onclick: () => { const n = prompt('組合名稱（可留空）', c.name || ''); if (n !== null) mutate(cur, (l) => { l[i].name = n.trim(); }); } }, '✎'),
        h('button', { title: cur === 'global' ? '移到目前頻道' : '移到通用', onclick: () => moveCombo(cur, i) }, '⇄'),
        h('button', { title: '刪除', onclick: () => { if (confirm('刪除這個組合？')) mutate(cur, (l) => { l.splice(i, 1); }); } }, '🗑')));

      const sNum = (key, lo, hi, label) => h('label', { class: 'field' }, label,
        h('input', { type: 'number', value: String(data.settings[key]), onchange: (e) => setSetting(key, clamp(e.target.value, lo, hi, DEFAULT_SETTINGS[key])) }));
      const sChk = (key, label) => h('label', { class: 'field' },
        h('input', { type: 'checkbox', checked: !!data.settings[key], onchange: (e) => setSetting(key, e.target.checked) }), label);

      ui.io = h('textarea', { placeholder: '匯入：貼上 yt-chat-combo 的匯出 JSON，再按「匯入」', spellcheck: 'false' });

      ui.manage.replaceChildren(
        h('div', { class: 'mh' }, '組合'), sel,
        rows.length ? rows : h('div', { class: 'empty' }, '這個範圍沒有組合'),
        h('div', { class: 'mh' }, '面板設定'),
        sNum('panelWidth', 200, 480, '寬度'), sNum('panelHeight', 120, 600, '高度'),
        h('label', { class: 'field' }, '介面倍率（0＝自動）',
          h('input', { type: 'number', step: '0.1', value: String(data.settings.uiScale), onchange: (e) => setSetting('uiScale', clamp(e.target.value, 0, 4, 0)) })),
        sChk('autoCollapse', '點組合後自動收合'), sChk('defaultOpen', '進入聊天室時預設展開'),
        h('div', { class: 'mh' }, '匯出 / 匯入'),
        ui.io,
        h('div', { class: 'row', style: 'margin-top:6px' },
          h('button', { class: 't', onclick: doExport }, '匯出全部'),
          h('button', { class: 't', onclick: doImport }, '匯入')));
    }

    function mutate(scope, fn) {
      const d = load();
      const l = scopeList(d, scope);
      if (!l) return;
      fn(l);
      save(d); data = d; render();
    }

    function moveCombo(scope, i) {
      const d = load();
      const from = scopeList(d, scope);
      if (!from || !from[i]) return;
      let dest;
      if (scope === 'global') {
        if (!channel.id) { toast('未偵測到目前頻道，無法移動'); return; }
        const ch = (d.channels[channel.id] = d.channels[channel.id] || { name: channel.name, combos: [] });
        dest = ch.combos;
      } else dest = d.global;
      const [c] = from.splice(i, 1);
      if (!dest.some((x) => partsKey(x.parts) === partsKey(c.parts))) dest.push(c);
      save(d); data = d; render();
      toast('已移動');
    }

    function setSetting(key, v) {
      const d = load();
      d.settings[key] = v;
      save(d); data = d;
      if (key === 'autoCollapse') { autoCollapse = v !== false; ui.auto.checked = autoCollapse; }
      reposition();
    }

    function doExport() {
      const d = load();
      const out = JSON.stringify({ kind: 'all', version: 1, exportedAt: new Date().toISOString(), global: d.global, channels: d.channels, channelOrder: orderedChannelIds(d), settings: d.settings }, null, 2);
      ui.io.value = out;
      // 在「YT 直播」App 裡：直接開啟系統的儲存檔案視窗
      if (window.YtBridge && typeof window.YtBridge.save === 'function') {
        try { window.YtBridge.save('yt-combo-backup.json', out); toast('請選擇儲存位置', 3200); return; } catch (e) { /* 退回複製 */ }
      }
      ui.io.focus(); ui.io.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      toast(ok ? '已複製到剪貼簿' : '請長按文字框全選後複製', 3200);
    }

    function doImport() {
      const text = ui.io.value.trim();
      if (!text) { toast('請先貼上 JSON'); return; }
      try {
        const d = load();
        const added = mergeImport(d, JSON.parse(text));
        save(d); data = d; render();
        toast(`匯入完成，新增 ${added} 個組合`, 3200);
      } catch (e) { toast('匯入失敗：' + (e.message || e), 3600); }
    }

    // ---------------- 建立面板 ----------------
    function buildUI() {
      const host = document.createElement('div');
      host.id = 'yt-combo-host';
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
      const root = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];

      ui.title = h('div', { class: 'title' });
      ui.auto = h('input', { type: 'checkbox', class: 'auto', checked: autoCollapse, title: '點組合後自動收合面板', onchange: (e) => { autoCollapse = e.target.checked; } });
      ui.fName = h('input', { type: 'text', placeholder: '名稱（可留空）', onkeydown: (e) => { if (e.key === 'Enter') confirmSave(); } });
      ui.fScope = h('select', { onchange: updateHint });
      ui.fPv = h('div', { class: 'pv' });
      ui.fHint = h('div', { class: 'hint' });
      ui.form = h('div', { class: 'form', hidden: true },
        ui.fPv, ui.fName, ui.fScope, ui.fHint,
        h('div', { class: 'row' },
          h('button', { onclick: () => (ui.form.hidden = true) }, '取消'),
          h('button', { class: 'ok', onclick: confirmSave }, '儲存')));
      ui.list = h('div', { class: 'list' });
      ui.manage = h('div', { class: 'manage', hidden: true });
      ui.toast = h('div', { class: 'toast' });

      ui.wrap = h('div', { class: 'wrap' },
        h('button', { class: 'tab', onclick: () => setOpen(!isOpen) }, '打call'),
        h('div', { class: 'body' },
          h('div', { class: 'head' }, ui.title, ui.auto,
            h('button', { class: 'icon', title: '把輸入框目前內容存成組合', onclick: openSaveForm }, '＋'),
            h('button', { class: 'icon', title: '管理 / 設定 / 匯入匯出', onclick: () => setManage(!manageOpen) }, '⚙'),
            h('button', { class: 'icon', title: '收合', onclick: () => setOpen(false) }, '›')),
          ui.form, ui.list, ui.manage, ui.toast));

      // 點面板按鈕時不要搶走聊天輸入框的焦點 / 游標位置（觸控與滑鼠都處理）
      const keepFocus = (e) => { if (!e.target.closest('input:not([type=checkbox]),select,textarea')) e.preventDefault(); };
      ui.wrap.addEventListener('mousedown', keepFocus);
      ui.wrap.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') keepFocus(e); });
      root.append(ui.wrap);
      document.body.append(host);
    }

    // ---------------- 啟動 ----------------
    function init() {
      data = load();
      autoCollapse = data.settings.autoCollapse !== false;
      applyTouchLock();
      buildUI();
      reposition();
      render();
      setOpen(!!data.settings.defaultOpen);
      refreshChannel();

      // 另一個視窗（例如彈出式聊天室）改了資料時同步
      if (typeof GM_addValueChangeListener === 'function') {
        try {
          GM_addValueChangeListener(DATA_KEY, (n, o, v, remote) => { if (remote) { data = load(); reposition(); render(); } });
        } catch (e) { /* ignore */ }
      }

      const ro = new ResizeObserver(() => reposition());
      const watched = new WeakSet();
      const watch = () => {
        for (const list of [SEL.inputPanel, SEL.picker]) {
          const el = q(list);
          if (el && !watched.has(el)) { watched.add(el); ro.observe(el); }
        }
      };
      setInterval(() => {
        applyTouchLock();
        watch();
        reposition();
        refreshChannel();
        ui.wrap.classList.toggle('dark', document.documentElement.hasAttribute('dark'));
      }, 1500);
      window.addEventListener('resize', reposition);
    }

    if (document.body) init(); else window.addEventListener('DOMContentLoaded', init);
  }
})();
