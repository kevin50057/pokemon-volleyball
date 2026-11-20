// edition.js — 經典版與遠征版之間的入口
// 經典版（zh/en/ko）：全部角色開放、沒有闖關；選單列多一顆「遠征版」。
// 遠征版（adventure/）：鎖角色、有闖關；關於頁裡放回經典版的連結。
// 兩版在同一個網域，存檔（闖關進度、角色選擇）是共用的。
(function () {
  'use strict';
  var ADV = window.PV_EDITION === 'adventure';
  var LANG = (document.documentElement.lang || 'zh').slice(0, 2);
  var T = {
    zh: { btn: '遠征版', moved: '闖關模式搬到「遠征版」了，之前的進度都還在。', go: '前往遠征版', ok: '知道了', back: '想用全部 20 隻角色隨手對戰？', backLink: '回到經典版' },
    en: { btn: 'Adventure', moved: 'Campaign mode now lives in the Adventure edition. Your progress is still there.', go: 'Open Adventure', ok: 'OK', back: '', backLink: '' },
    ko: { btn: '모험판', moved: '캠페인 모드는 모험판으로 옮겨졌습니다. 진행 상황은 그대로입니다.', go: '모험판 열기', ok: '확인', back: '', backLink: '' }
  }[LANG] || null;
  if (!T) return;
  var ADV_URL = 'https://kevin50057.github.io/pokemon-volleyball-adventure/', CLASSIC_URL = '../zh/', NOTICE_KEY = 'pv-ed-notice-1';

  var css = [
    '#pv-ed-btn{background:linear-gradient(#ffd75e,#f39c12)!important;color:#3a2400!important;font-weight:900!important;border-color:#fff3c4!important}',
    '#pv-ed-note{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:20005;display:flex;align-items:center;gap:10px;max-width:94vw;background:rgba(20,22,44,.95);color:#fff;border:2px solid #FFD54F;border-radius:14px;padding:10px 14px;font:600 14px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5)}',
    '#pv-ed-note a,#pv-ed-note button{flex:0 0 auto;border:0;border-radius:999px;padding:7px 14px;font:800 13px inherit;cursor:pointer;text-decoration:none;white-space:nowrap}',
    '#pv-ed-note a{background:#FFD54F;color:#3a2400}#pv-ed-note button{background:#3a3f66;color:#fff}'
  ].join('\n');

  function init() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    if (ADV) {
      // 關於頁：回經典版的連結
      var head = document.getElementById('about-box-head');
      if (head && T.back) {
        var p = document.createElement('p');
        p.innerHTML = T.back + ' <a href="' + CLASSIC_URL + '">' + T.backLink + '</a>';
        var lang = head.querySelector('.languages');
        head.insertBefore(p, lang || null);
      }
      return;
    }
    // 經典版：選單列放一顆「遠征版」，位置在「連線對戰」前面
    var left = document.querySelector('#menu-bar .btn-container.left');
    if (left) {
      var wrap = document.createElement('div'); wrap.className = 'relative-container';
      var a = document.createElement('button'); a.type = 'button'; a.id = 'pv-ed-btn'; a.className = 'btn'; a.textContent = T.btn;
      a.onclick = function (e) { e.stopPropagation(); location.href = ADV_URL; };
      wrap.appendChild(a);
      var netBtn = document.getElementById('pv-net-btn');
      left.insertBefore(wrap, netBtn && netBtn.parentNode && netBtn.parentNode.parentNode === left ? netBtn.parentNode : left.querySelector('.color-scheme-toggle-switch-container'));
    }
    // 之前在這個網址玩過闖關的人：說一次闖關搬家了
    var played = false, seen = false;
    try { played = !!localStorage.getItem('pv-campaign-v1'); seen = !!localStorage.getItem(NOTICE_KEY); } catch (e) {}
    if (played && !seen) {
      var n = document.createElement('div'); n.id = 'pv-ed-note';
      n.innerHTML = '<span>' + T.moved + '</span><a href="' + ADV_URL + '">' + T.go + '</a><button type="button">' + T.ok + '</button>';
      var done = function () { try { localStorage.setItem(NOTICE_KEY, '1'); } catch (e) {} n.remove(); };
      n.querySelector('a').addEventListener('click', done);
      n.querySelector('button').addEventListener('click', done);
      document.body.appendChild(n);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
