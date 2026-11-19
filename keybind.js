// keybind.js — 自訂按鍵（鍵盤 1P／2P）＋ 觸控按鈕大小與左右手
// 遊戲本體的鍵盤類別每次都拿 e.code 跟 this.value 比，所以只要改 keyboardArray[i].xxxKey.value 就能換鍵，
// 不用動打包好的程式。觸控按鈕送出的是模擬按鍵，所以也要跟著換（PV_TouchKeys）。
(function () {
  'use strict';

  var STORE = 'pv-keys-v1';
  var ACTIONS = ['left', 'right', 'up', 'down', 'hit'];
  var DEFAULTS = {
    1: { left: 'KeyD', right: 'KeyG', up: 'KeyR', down: 'KeyV', hit: 'KeyZ' },
    2: { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', hit: 'Enter' }
  };
  var FIELD = { left: 'leftKey', right: 'rightKey', up: 'upKey', down: 'downKey', hit: 'powerHitKey' };
  var TOUCH_FIELD = { left: 'left', right: 'right', up: 'up', down: 'down', hit: 'action' };
  var DOWN_RIGHT_1P = 'KeyF';   // 原作 1P 的「右下」鍵；被拿去綁別的動作時就停用

  var LANG = (document.documentElement.lang || 'zh').slice(0, 2);
  var T = LANG === 'zh' ? {
    menu: '按鍵設定…', title: '按鍵設定', p1: '1P（左）', p2: '2P（右）',
    left: '← 左', right: '→ 右', up: '↑ 跳', down: '↓ 下', hit: '殺球',
    press: '請按新按鍵…', esc: 'Esc 取消', reset: '恢復預設', done: '完成',
    hint: '點一個格子，再按鍵盤上的新按鍵。按到已經在用的鍵會自動對調。',
    swapped: '已和 {who} 的「{act}」對調', reserved: '「{key}」是保留鍵（{why}），換一個吧',
    whyEsc: '取消／顯示選單', whySpace: '遊戲功能鍵', whyC: '角色選擇', whyTab: '切換焦點', whyF: '瀏覽器功能鍵', whyMod: '系統鍵',
    saved: '已儲存', touch: '觸控按鈕', size: '大小', small: '小', normal: '標準', large: '大',
    hand: '搖桿位置', leftHand: '左邊（預設）', rightHand: '右邊（左撇子）', note2p: '直式時按鈕已依螢幕寬度放到最大，「大」主要影響橫式；放不下時會自動縮小。開啟本機 2P 時固定用預設位置。'
  } : {
    menu: 'Controls…', title: 'Controls', p1: '1P (left)', p2: '2P (right)',
    left: '← Left', right: '→ Right', up: '↑ Jump', down: '↓ Down', hit: 'Power hit',
    press: 'Press a key…', esc: 'Esc to cancel', reset: 'Reset', done: 'Done',
    hint: 'Tap a cell, then press the new key. Picking a key already in use swaps the two.',
    swapped: 'Swapped with {who} “{act}”', reserved: '“{key}” is reserved ({why}); pick another',
    whyEsc: 'cancel / menu', whySpace: 'game shortcut', whyC: 'character select', whyTab: 'focus', whyF: 'browser key', whyMod: 'system key',
    saved: 'Saved', touch: 'Touch buttons', size: 'Size', small: 'S', normal: 'M', large: 'L',
    hand: 'Joystick side', leftHand: 'Left (default)', rightHand: 'Right (left-handed)', note2p: 'In portrait the buttons already fill the width, so “L” mostly affects landscape; they shrink automatically if they would overlap. Local 2P always uses the default layout.'
  };

  // ------------------------------------------------------------------
  // 設定的讀寫
  // ------------------------------------------------------------------
  function validCode(c) { return typeof c === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(c); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function load() {
    var cfg = { 1: clone(DEFAULTS[1]), 2: clone(DEFAULTS[2]), touch: { size: 'm', lefty: false } };
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (raw && typeof raw === 'object') {
        [1, 2].forEach(function (n) {
          var m = raw[n] || {};
          ACTIONS.forEach(function (a) { if (validCode(m[a]) && !reservedWhy(m[a])) cfg[n][a] = m[a]; });
        });
        if (raw.touch && typeof raw.touch === 'object') {
          if (raw.touch.size === 's' || raw.touch.size === 'm' || raw.touch.size === 'l') cfg.touch.size = raw.touch.size;
          cfg.touch.lefty = raw.touch.lefty === true;
        }
      }
    } catch (e) {}
    // 壞掉的存檔（同一個鍵綁兩個動作）就整組回到預設
    var seen = {}, dup = false;
    [1, 2].forEach(function (n) { ACTIONS.forEach(function (a) { var c = cfg[n][a]; if (seen[c]) dup = true; seen[c] = true; }); });
    if (dup) { cfg[1] = clone(DEFAULTS[1]); cfg[2] = clone(DEFAULTS[2]); }
    return cfg;
  }
  var cfg = load();
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} }

  function reservedWhy(code) {
    if (code === 'Escape') return T.whyEsc;
    if (code === 'Space') return T.whySpace;
    if (code === 'KeyC') return T.whyC;
    if (code === 'Tab') return T.whyTab;
    if (/^F\d{1,2}$/.test(code)) return T.whyF;
    if (/^(Meta|OS|Alt|Control|ContextMenu|CapsLock|Fn)/.test(code)) return T.whyMod;
    return '';
  }

  function label(code) {
    if (!code) return '—';
    var m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return (LANG === 'zh' ? '數字鍵 ' : 'Num ') + m[1];
    var map = {
      ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', NumpadEnter: 'Num Enter',
      ShiftLeft: (LANG === 'zh' ? '左 Shift' : 'L Shift'), ShiftRight: (LANG === 'zh' ? '右 Shift' : 'R Shift'),
      Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
      Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Backspace: 'Backspace', Delete: 'Del',
      Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
      NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .'
    };
    return map[code] || code;
  }

  // ------------------------------------------------------------------
  // 套用到遊戲
  // ------------------------------------------------------------------
  function applyKeyboard() {
    var c = window._pv && window._pv.ctrl;
    if (!c || !c.keyboardArray) return false;
    [1, 2].forEach(function (n) {
      var kb = c.keyboardArray[n - 1];
      if (!kb) return;
      ACTIONS.forEach(function (a) {
        var k = kb[FIELD[a]];
        if (k && k.value !== cfg[n][a]) { k.value = cfg[n][a]; k.isDown = false; k.isUp = true; }
      });
      if (n === 1 && kb.downRightKey) {
        var used = usedBy(DOWN_RIGHT_1P);
        kb.downRightKey.value = used ? null : DOWN_RIGHT_1P;
        kb.downRightKey.isDown = false;
      }
    });
    return true;
  }
  function applyTouch() {
    var tk = window.PV_TouchKeys;
    if (tk) [1, 2].forEach(function (n) { ACTIONS.forEach(function (a) { tk[n][TOUCH_FIELD[a]] = cfg[n][a]; }); });
    var b = document.body;
    if (!b) return;
    b.classList.toggle('pv-lefty', !!cfg.touch.lefty);
    b.classList.remove('pv-touch-s', 'pv-touch-m', 'pv-touch-l');
    b.classList.add('pv-touch-' + cfg.touch.size);
    fitTouch();
  }
  function applyAll() { applyTouch(); return applyKeyboard(); }

  // 觸控按鈕縮放：選「大」但螢幕太窄放不下時，自動縮到剛好不重疊
  var SCALE = { s: 0.82, m: 1, l: 1.18 };
  function fitTouch() {
    var b = document.body;
    if (!b) return;
    var want = SCALE[cfg.touch.size] || 1;
    var j = document.getElementById('p1-joystick-zone'), p = document.getElementById('p1-pad');
    // 注意：position:fixed 的元素 offsetParent 永遠是 null，要用實際大小判斷有沒有顯示
    var vis = function (el) { return el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; };
    if (!vis(j) || !vis(p)) { b.style.setProperty('--pv-touch-scale', want); return; }
    var cur = parseFloat(getComputedStyle(b).getPropertyValue('--pv-touch-scale')) || 1;
    var jr = j.getBoundingClientRect(), pr = p.getBoundingClientRect();
    var jw = jr.width / cur, pw = pr.width / cur;       // 換算回未縮放前的寬
    var room = window.innerWidth - 16;
    var fit = Math.min(want, room / (jw + pw));
    var v = fit < want ? Math.max(0.7, Math.floor(fit * 100) / 100) : want;
    b.style.setProperty('--pv-touch-scale', v);
  }
  window.addEventListener('resize', function () { setTimeout(fitTouch, 50); });
  window.addEventListener('orientationchange', function () { setTimeout(fitTouch, 300); });

  function usedBy(code) {
    for (var n = 1; n <= 2; n++) for (var i = 0; i < ACTIONS.length; i++) if (cfg[n][ACTIONS[i]] === code) return { n: n, a: ACTIONS[i] };
    return null;
  }

  // ------------------------------------------------------------------
  // 介面
  // ------------------------------------------------------------------
  var css = [
    '#pv-keys{position:fixed;inset:0;z-index:20002;display:none;align-items:center;justify-content:center;background:rgba(10,12,24,.82);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#fff;padding:12px;box-sizing:border-box}',
    '#pv-keys.open{display:flex}',
    '#pv-keys .box{width:min(480px,100%);max-height:100%;overflow:auto;background:#1b1e33;border:2px solid #3a3f66;border-radius:14px;padding:14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.5);box-sizing:border-box}',
    '#pv-keys h2{margin:0 0 4px;font-size:18px;display:flex;justify-content:space-between;align-items:center}',
    '#pv-keys .x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;opacity:.7}',
    '#pv-keys .hint{font-size:12px;opacity:.6;margin:0 0 10px;line-height:1.5}',
    '#pv-keys table{width:100%;border-collapse:separate;border-spacing:6px 6px;margin:0 -6px}',
    '#pv-keys th{font-size:13px;font-weight:700;text-align:center;opacity:.85}',
    '#pv-keys th.p1{color:#90CAF9}#pv-keys th.p2{color:#FFAB91}',
    '#pv-keys td.act{font-size:14px;white-space:nowrap;opacity:.9;width:30%}',
    '#pv-keys button.k{width:100%;min-height:42px;border-radius:10px;border:2px solid #3a3f66;background:#262a47;color:#fff;font:700 16px/1.1 ui-monospace,Menlo,Consolas,monospace;cursor:pointer;padding:4px 6px}',
    '#pv-keys button.k:hover{border-color:#6b72b8}',
    '#pv-keys button.k.wait{border-color:#FFE14D;color:#FFE14D;font:600 13px/1.2 "Noto Sans TC",sans-serif;animation:pvk 1s infinite}',
    '#pv-keys button.k.flash{border-color:#66BB6A}',
    '@keyframes pvk{50%{background:#333a66}}',
    '#pv-keys .msg{min-height:20px;font-size:13px;margin:6px 0 2px;color:#FFE082}',
    '#pv-keys .msg.err{color:#ff8a80}',
    '#pv-keys .row{display:flex;gap:8px;margin-top:10px}',
    '#pv-keys .row button.b{flex:1;padding:11px 10px;border-radius:10px;border:0;background:#2e3358;color:#fff;font-size:15px;font-weight:700;cursor:pointer}',
    '#pv-keys .row button.b.go{background:#3f51b5}',
    '#pv-keys .touch{margin-top:12px;padding-top:10px;border-top:1px solid #3a3f66;display:none}',
    '#pv-keys.has-touch .touch{display:block}',
    '#pv-keys .touch h3{margin:0 0 8px;font-size:15px}',
    '#pv-keys .seg{display:flex;align-items:center;gap:8px;margin:6px 0}',
    '#pv-keys .seg span{font-size:13px;opacity:.85;min-width:64px}',
    '#pv-keys .seg button{flex:1;min-height:38px;border-radius:9px;border:2px solid #3a3f66;background:#262a47;color:#fff;font-size:14px;cursor:pointer}',
    '#pv-keys .seg button.on{border-color:#42A5F5;background:#1f3550}',
    '#pv-keys .note{font-size:11px;opacity:.5;margin-top:4px}',
    // 觸控：大小、左右手
    '.joystick-zone,.touch-pad{transform:scale(var(--pv-touch-scale,1))}',
    '#p1-joystick-zone{transform-origin:left bottom}#p1-pad{transform-origin:right bottom}',
    '#p2-joystick-zone{transform-origin:right bottom}#p2-pad{transform-origin:left bottom}',
    'body.pv-lefty:not(.pv-2p-on) #p1-joystick-zone{left:auto!important;right:calc(10px + env(safe-area-inset-right,0px))!important;transform-origin:right bottom}',
    'body.pv-lefty:not(.pv-2p-on) #p1-joystick-zone .joystick-base{left:auto;right:0}',
    'body.pv-lefty:not(.pv-2p-on) #p1-pad{right:auto!important;left:env(safe-area-inset-left,0px)!important;transform-origin:left bottom}',
    'body.pv-lefty:not(.pv-2p-on) #p1-pad .pad-jump{left:auto;right:var(--pad-margin)}',
    'body.pv-lefty:not(.pv-2p-on) #p1-pad .pad-hit{right:auto;left:calc(var(--pad-margin) * .5)}'
  ].join('\n');

  var ui = {}, capture = null;

  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var root = document.createElement('div');
    root.id = 'pv-keys';
    var rows = ACTIONS.map(function (a) {
      return '<tr><td class="act">' + T[a] + '</td>' +
        '<td><button type="button" class="k" data-n="1" data-a="' + a + '"></button></td>' +
        '<td><button type="button" class="k" data-n="2" data-a="' + a + '"></button></td></tr>';
    }).join('');
    root.innerHTML = '<div class="box" role="dialog" aria-label="' + T.title + '">' +
      '<h2><span>' + T.title + '</span><button type="button" class="x" aria-label="close">✕</button></h2>' +
      '<p class="hint">' + T.hint + '</p>' +
      '<table><thead><tr><th></th><th class="p1">' + T.p1 + '</th><th class="p2">' + T.p2 + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="msg"></div>' +
      '<div class="touch"><h3>' + T.touch + '</h3>' +
      '<div class="seg" data-k="size"><span>' + T.size + '</span><button type="button" data-v="s">' + T.small + '</button><button type="button" data-v="m">' + T.normal + '</button><button type="button" data-v="l">' + T.large + '</button></div>' +
      '<div class="seg" data-k="lefty"><span>' + T.hand + '</span><button type="button" data-v="0">' + T.leftHand + '</button><button type="button" data-v="1">' + T.rightHand + '</button></div>' +
      '<div class="note">' + T.note2p + '</div></div>' +
      '<div class="row"><button type="button" class="b rs">' + T.reset + '</button><button type="button" class="b go dn">' + T.done + '</button></div></div>';
    document.body.appendChild(root);
    ui.root = root; ui.msg = root.querySelector('.msg');
    if ('ontouchstart' in window || navigator.maxTouchPoints) root.classList.add('has-touch');
    root.querySelector('.x').onclick = close;
    root.querySelector('.dn').onclick = close;
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    root.querySelector('.rs').onclick = function () {
      cancelCapture();
      cfg[1] = clone(DEFAULTS[1]); cfg[2] = clone(DEFAULTS[2]); cfg.touch = { size: 'm', lefty: false };
      save(); applyAll(); render(); msg(T.saved);
    };
    Array.prototype.forEach.call(root.querySelectorAll('button.k'), function (b) {
      b.addEventListener('click', function () { startCapture(b); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('.seg'), function (seg) {
      seg.addEventListener('click', function (e) {
        var v = e.target && e.target.getAttribute('data-v');
        if (v == null) return;
        if (seg.getAttribute('data-k') === 'size') cfg.touch.size = v;
        else cfg.touch.lefty = v === '1';
        save(); applyTouch(); render();
      });
    });

    // 選項選單裡加一項
    var dd = document.getElementById('options-dropdown');
    if (dd) {
      var mb = document.createElement('button');
      mb.type = 'button'; mb.id = 'pv-keys-btn'; mb.className = 'btn'; mb.textContent = T.menu;
      mb.addEventListener('click', function (e) {
        e.stopPropagation();
        document.querySelectorAll('.dropdown.show,.submenu.show').forEach(function (d) { d.classList.remove('show'); });
        document.querySelectorAll('.dropdown-btn.open,.submenu-btn.open').forEach(function (d) { d.classList.remove('open'); });
        open();
      });
      var rst = document.getElementById('reset-to-default-btn');
      dd.insertBefore(mb, rst || null);
    }
  }

  function render() {
    Array.prototype.forEach.call(ui.root.querySelectorAll('button.k'), function (b) {
      if (b === (capture && capture.btn)) return;
      b.textContent = label(cfg[b.getAttribute('data-n')][b.getAttribute('data-a')]);
    });
    Array.prototype.forEach.call(ui.root.querySelectorAll('.seg'), function (seg) {
      var cur = seg.getAttribute('data-k') === 'size' ? cfg.touch.size : (cfg.touch.lefty ? '1' : '0');
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === cur); });
    });
  }
  function msg(t, err) { ui.msg.textContent = t || ''; ui.msg.className = 'msg' + (err ? ' err' : ''); }
  function open() { render(); msg(''); ui.root.style.zIndex = (window._pvZ = Math.max(window._pvZ || 20010, 20010) + 1); ui.root.classList.add('open'); }
  function close() { cancelCapture(); ui.root.classList.remove('open'); }
  function isOpen() { return ui.root && ui.root.classList.contains('open'); }

  function startCapture(btn) {
    cancelCapture();
    capture = { btn: btn, n: +btn.getAttribute('data-n'), a: btn.getAttribute('data-a') };
    btn.classList.add('wait');
    btn.innerHTML = T.press + '<br><small style="opacity:.6">' + T.esc + '</small>';
    msg('');
  }
  function cancelCapture() {
    if (!capture) return;
    capture.btn.classList.remove('wait');
    capture = null;
    render();
  }
  function finishCapture(code) {
    var c = capture;
    var why = reservedWhy(code);
    if (why) { msg(T.reserved.replace('{key}', label(code)).replace('{why}', why), true); return; }
    var old = cfg[c.n][c.a];
    var other = usedBy(code);
    var note = '';
    if (other && !(other.n === c.n && other.a === c.a)) {
      cfg[other.n][other.a] = old;   // 對調
      note = T.swapped.replace('{who}', other.n === 1 ? T.p1 : T.p2).replace('{act}', T[other.a]);
    }
    cfg[c.n][c.a] = code;
    capture.btn.classList.remove('wait');
    var btn = capture.btn;
    capture = null;
    save(); applyAll(); render();
    btn.classList.add('flash'); setTimeout(function () { btn.classList.remove('flash'); }, 500);
    msg(note || T.saved);
  }

  // 搶在遊戲之前收按鍵：視窗的捕獲階段最先執行，攔下來遊戲就收不到
  window.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (capture) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.code === 'Escape') { cancelCapture(); msg(''); return; }
      if (!e.code) return;
      finishCapture(e.code);
      return;
    }
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  window.addEventListener('keyup', function (e) { if (isOpen()) { e.stopImmediatePropagation(); } }, true);

  // ------------------------------------------------------------------
  function init() {
    build();
    applyTouch();
    var tries = 0;
    var iv = setInterval(function () { if (applyKeyboard() || ++tries > 200) clearInterval(iv); }, 200);
    // 觸控按鈕在選單畫面時是藏起來的，量不到大小；所以定期重算一次（很便宜）
    if ('ontouchstart' in window || navigator.maxTouchPoints) setInterval(fitTouch, 1000);
  }
  window.PV_Keys = { config: function () { return clone(cfg); }, open: open, close: close, label: label, apply: applyAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
