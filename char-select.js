// char-select.js — 角色選擇面板（桌機與手機共用）
// 依賴：characters.js。實際切換角色是點擊頁面中隱藏的 #p1-xxx-btn / #p2-xxx-btn，
// 讓 main.bundle.js 原本的邏輯（含記住上次選擇）繼續運作。
(function () {
  'use strict';
  if (!window.PV_CHARS) return;
  var CH = window.PV_CHARS;
  var IMG = '../resources/assets/images/';

  var css = [
    '#pv-cs{position:fixed;inset:0;z-index:20000;display:none;align-items:center;justify-content:center;background:rgba(10,12,24,.82);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#fff}',
    '#pv-cs.open{display:flex}',
    '#pv-cs .box{width:min(760px,96vw);max-height:94vh;overflow:auto;background:#1b1e33;border:2px solid #3a3f66;border-radius:14px;padding:14px 16px 16px;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '#pv-cs .top{display:flex;gap:10px;align-items:stretch;margin-bottom:10px}',
    '#pv-cs .slot{flex:1;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:2px solid transparent;background:#262a47;cursor:pointer;user-select:none}',
    '#pv-cs .slot.active.p1{border-color:#42A5F5;background:#1f3550}',
    '#pv-cs .slot.active.p2{border-color:#FF7043;background:#4a2a26}',
    '#pv-cs .slot .who{font-weight:800;font-size:13px;opacity:.85;min-width:42px}',
    '#pv-cs .slot.p1 .who{color:#90CAF9}#pv-cs .slot.p2 .who{color:#FFAB91}',
    '#pv-cs .slot canvas{width:44px;height:44px;image-rendering:pixelated}',
    '#pv-cs .slot.p2 canvas{transform:scaleX(-1)}',
    '#pv-cs .slot .nm{font-size:15px;font-weight:700}',
    '#pv-cs .slot .sk{font-size:12px;opacity:.7}',
    '#pv-cs .x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;opacity:.7;padding:0 4px}',
    '#pv-cs .x:hover{opacity:1}',
    '#pv-cs .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:8px}',
    '#pv-cs .card{position:relative;background:#262a47;border:2px solid #333863;border-radius:10px;padding:6px 4px 7px;text-align:center;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;transition:transform .08s,border-color .08s}',
    '#pv-cs .card:hover{transform:translateY(-2px);border-color:#6b72b8}',
    '#pv-cs .card canvas{width:56px;height:56px;image-rendering:pixelated;display:block;margin:0 auto}',
    '#pv-cs .card .nm{font-size:13px;font-weight:700;margin-top:2px}',
    '#pv-cs .card .sk{font-size:11px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#pv-cs .card .ty{position:absolute;top:4px;left:5px;font-size:10px;font-weight:800;padding:0 5px;border-radius:6px;color:#111}',
    '#pv-cs .card .mk{position:absolute;top:3px;right:4px;font-size:10px;font-weight:800;padding:0 4px;border-radius:5px}',
    '#pv-cs .card .mk.p1{background:#42A5F5}#pv-cs .card .mk.p2{background:#FF7043;top:18px}',
    '#pv-cs .card.sel-p1{border-color:#42A5F5}#pv-cs .card.sel-p2{border-color:#FF7043}#pv-cs .card.sel-p1.sel-p2{border-color:#ce93d8}',
    '#pv-cs .desc{margin-top:10px;min-height:42px;padding:8px 12px;border-radius:10px;background:#141729;font-size:13px;line-height:1.55}',
    '#pv-cs .desc b{margin-right:6px}',
    '#pv-cs .hint{margin-top:6px;font-size:11px;opacity:.5;text-align:center}',
    // 直式手機（窄）：上方兩格字別被擠成直排
    '@media (max-width:520px){#pv-cs .box{padding:10px}#pv-cs .top{gap:6px}#pv-cs .slot{min-width:0;gap:6px;padding:6px 8px;flex-wrap:wrap}#pv-cs .slot>*{min-width:0}#pv-cs .slot .who{min-width:0;font-size:11px;flex:0 0 100%}#pv-cs .slot canvas{width:36px;height:36px;flex:0 0 auto}#pv-cs .slot .nm{font-size:14px;white-space:nowrap}#pv-cs .slot .sk{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}#pv-cs .grid{grid-template-columns:repeat(3,1fr);gap:6px}#pv-cs .card canvas{width:48px;height:48px}}',
    '#pv-cs.net .slot.p2{display:none}#pv-cs.net .card .mk.p2{display:none}#pv-cs.net .card.sel-p2:not(.sel-p1){border-color:#333863}',
    // 手機：整個面板固定在可視範圍內（dvh），上方選擇列和下方說明固定，中間角色格自己捲
    '@media (hover:none) and (pointer:coarse){#pv-cs{padding:8px;box-sizing:border-box;align-items:stretch}#pv-cs .box{display:flex;flex-direction:column;width:100%;max-width:760px;margin:0 auto;max-height:calc(100dvh - 16px);overflow:hidden;box-sizing:border-box}#pv-cs .top{flex:0 0 auto}#pv-cs .grid{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;min-height:0;padding-bottom:4px}#pv-cs .desc{flex:0 0 auto}#pv-cs .hint{display:none}#pv-cs .x{font-size:28px;padding:4px 10px}}',
    '@media (max-height:480px){#pv-cs .box{padding:8px 10px}#pv-cs .card canvas{width:40px;height:40px}#pv-cs .grid{grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:5px}#pv-cs .desc{margin-top:6px;min-height:0}#pv-cs .hint{display:none}}',
    // 舊的 40 顆按鈕子選單：保留按鈕給遊戲本體用，但不再顯示
    '#character-submenu{display:none!important}'
  ].join('\n');

  // ---------- 從 sprite sheet 切出每個角色的第一格當頭像 ----------
  var portraits = {};   // id -> {img, frame}
  var waiting = [];

  function sheetFor(id) { return id === 'pikachu' ? 'sprite_sheet' : id + '_sheet'; }
  function loadPortraits() {
    var sheets = {};
    CH.ids.forEach(function (id) { sheets[sheetFor(id)] = true; });
    Object.keys(sheets).forEach(function (name) {
      fetch(IMG + name + '.json').then(function (r) { return r.json(); }).then(function (json) {
        var img = new Image();
        img.onload = function () {
          CH.ids.forEach(function (id) {
            if (sheetFor(id) !== name) return;
            var f = json.frames[id + '/' + id + '_0_0.png'];
            if (f) portraits[id] = { img: img, frame: f.frame };
          });
          waiting.slice().forEach(function (fn) { fn(); });
        };
        img.src = IMG + json.meta.image;
      }).catch(function () {});
    });
  }
  function paint(canvas, id) {
    var p = portraits[id];
    var g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!p) return false;
    var f = p.frame, s = Math.min(canvas.width / f.w, canvas.height / f.h);
    g.imageSmoothingEnabled = s < 1;   // 高解析貼圖（閃電鳥 96px）縮小時要平滑，像素圖放大時保持銳利
    g.drawImage(p.img, f.x, f.y, f.w, f.h,
      (canvas.width - f.w * s) / 2, (canvas.height - f.h * s) / 2, f.w * s, f.h * s);
    return true;
  }
  function portrait(id, size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    c.dataset.id = id;
    if (!paint(c, id)) waiting.push(function () { paint(c, c.dataset.id); });
    return c;
  }

  // ---------- 目前選擇（讀遊戲本體標記的 .selected） ----------
  function current(n) {
    for (var i = 0; i < CH.ids.length; i++) {
      var b = document.getElementById('p' + n + '-' + CH.ids[i] + '-btn');
      if (b && b.classList.contains('selected')) return CH.ids[i];
    }
    return n === 1 ? 'bird' : 'pikachu';
  }

  // ---------- 建立面板 ----------
  var root, slots = {}, cards = {}, descEl, activeP = 1, netMode = false;

  function build() {
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    root = document.createElement('div');
    root.id = 'pv-cs';
    root.innerHTML = '<div class="box" role="dialog" aria-label="選擇角色"><div class="top"></div><div class="grid"></div><div class="desc"></div><div class="hint">先點上方 1P 或 2P，再點角色。按 C 或 Esc 關閉。</div></div>';
    var top = root.querySelector('.top'), grid = root.querySelector('.grid');
    descEl = root.querySelector('.desc');

    [1, 2].forEach(function (n) {
      var el = document.createElement('div');
      el.className = 'slot p' + n;
      el.innerHTML = '<span class="who">' + n + 'P ' + (n === 1 ? '左' : '右') + '</span>';
      var cv = portrait('pikachu', 64);
      el.appendChild(cv);
      var info = document.createElement('div');
      info.innerHTML = '<div class="nm"></div><div class="sk"></div>';
      el.appendChild(info);
      el.addEventListener('click', function () { activeP = n; refresh(); });
      top.appendChild(el);
      slots[n] = { el: el, cv: cv, nm: info.querySelector('.nm'), sk: info.querySelector('.sk') };
    });
    var x = document.createElement('button');
    x.className = 'x'; x.type = 'button'; x.textContent = '✕'; x.title = '關閉';
    x.addEventListener('click', close);
    top.appendChild(x);

    CH.list.forEach(function (c) {
      var card = document.createElement('div');
      card.className = 'card';
      card.appendChild(portrait(c.id, 64));
      card.insertAdjacentHTML('beforeend',
        '<div class="nm">' + c.name + '</div><div class="sk">' + c.skill + '</div>' +
        '<span class="ty" style="background:' + c.color + '">' + c.type + '</span>');
      card.addEventListener('click', function () { pick(c.id); });
      card.addEventListener('mouseenter', function () { showDesc(c.id); });
      card.addEventListener('mouseleave', function () { showDesc(current(activeP)); });
      grid.appendChild(card);
      cards[c.id] = card;
    });

    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    document.body.appendChild(root);
  }

  function showDesc(id) {
    var c = CH.byId[id];
    if (!c) return;
    descEl.innerHTML = '<b style="color:' + c.color + '">' + c.name + '・' + c.skill + '</b>' + c.desc;
  }

  function refresh() {
    var sel = { 1: current(1), 2: current(2) };
    [1, 2].forEach(function (n) {
      var c = CH.byId[sel[n]], sl = slots[n];
      sl.el.classList.toggle('active', activeP === n);
      sl.cv.dataset.id = sel[n];
      paint(sl.cv, sel[n]);
      sl.nm.textContent = c ? c.name : sel[n];
      sl.sk.textContent = c ? c.skill : '';
    });
    CH.ids.forEach(function (id) {
      var card = cards[id];
      card.classList.toggle('sel-p1', sel[1] === id);
      card.classList.toggle('sel-p2', sel[2] === id);
      card.querySelectorAll('.mk').forEach(function (m) { m.remove(); });
      if (sel[1] === id) card.insertAdjacentHTML('beforeend', '<span class="mk p1">1P</span>');
      if (sel[2] === id) card.insertAdjacentHTML('beforeend', '<span class="mk p2">2P</span>');
    });
    showDesc(sel[activeP]);
  }

  function pick(id) {
    var b = document.getElementById('p' + activeP + '-' + id + '-btn');
    if (b) b.click();
    if (netMode) { refresh(); close(); var np = document.getElementById('pv-net'); if (np && np.classList.contains('open') && window.PV_Net) window.PV_Net.open(); return; }
    if (activeP === 1) activeP = 2;   // 選完 1P 自動換 2P
    refresh();
  }

  function open(n) {
    if (!root) return;
    if (n) activeP = n;
    // 連線房間裡只選自己的角色：只留一格，選完直接關掉回到連線面板
    netMode = !!(window.PV_Net && window.PV_Net.state.phase !== 'off') || (document.getElementById('pv-net') || {}).className === 'open';
    if (netMode) activeP = 1;
    root.classList.toggle('net', netMode);
    refresh();
    root.style.zIndex = (window._pvZ = Math.max(window._pvZ || 20010, 20010) + 1);   // 最後打開的面板永遠在最上面
    root.classList.add('open');
    document.querySelectorAll('.dropdown.show,.submenu.show').forEach(function (d) { d.classList.remove('show'); });
    document.querySelectorAll('.dropdown-btn.open,.submenu-btn.open').forEach(function (d) { d.classList.remove('open'); });
  }
  function close() { if (root) root.classList.remove('open'); }
  function isOpen() { return root && root.classList.contains('open'); }

  function init() {
    build();
    loadPortraits();
    // 選單「角色」改成打開面板
    var menuBtn = document.getElementById('character-submenu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) { e.stopImmediatePropagation(); e.preventDefault(); open(); }, true);
    }
    window.addEventListener('keydown', function (e) {
      if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        isOpen() ? close() : open();
      } else if (e.code === 'Escape' && isOpen()) {
        close();
        e.stopImmediatePropagation();
      }
    }, true);
  }

  window.PV_CharSelect = { open: open, close: close, toggle: function () { isOpen() ? close() : open(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
