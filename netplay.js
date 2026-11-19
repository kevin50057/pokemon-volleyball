// netplay.js — 寶可夢排球 連線對戰（主機權威）
// 依賴：characters.js、abilities.js（_pvAbilities.net）、juice.js（_pvJuiceNet），必須在它們之後載入。
//
// 架構：
//  - 房主（左 1P）跑完整遊戲：物理、技能、得分都只在房主算。
//  - 客人（右 2P）不跑物理，只送按鍵、收房主每幀的快照來畫。
//  - 傳輸用 artifact 的 room capability：只用 presence（每個人一個物件，最新的覆蓋舊的），
//    所以掉包不會累積錯誤；音效、擊球、技能特效都用「累計計數器／事件編號」傳，掉一兩幀也不會漏。
//  - 體感：客人用「還沒被房主確認的輸入」預測自己的左右位置；快照沒到時球外推最多 2 幀；
//    兩邊都顯示來回延遲；斷線時暫停並等待重連，太久就回單人模式。
(function () {
  'use strict';

  var CH = window.PV_CHARS;
  var VALID = Object.create(null);   // 不能用 {}：'constructor'、'__proto__' 會被當成合法角色
  (CH ? CH.ids : []).forEach(function (id) { VALID[id] = true; });
  var A = function () { return window._pvAbilities && window._pvAbilities.net; };
  var J = function () { return window._pvJuiceNet; };

  var LANG = (document.documentElement.lang || 'zh').slice(0, 2);
  var T = LANG === 'zh' ? {
    btn: '連線對戰', title: '連線對戰', host: '開房間', join: '加入', codePh: '房間代碼',
    myChar: '你的角色', change: '換角色', leave: '離開房間', start: '開始對戰', again: '再來一局',
    waitOpp: '等待對手加入…把代碼傳給朋友。', oppIn: '對手已加入', waitHost: '已加入，等待房主開始…',
    noHost: '房間裡還沒有房主。確認代碼正確，或請朋友先開房。', dup: '代碼撞到別人的房間了，請離開後重開。',
    noRoom: '這個環境無法連線。連線對戰需要登入，而且必須是這個作品所屬組織的成員或受邀者；用公開連結開啟的人無法連線。',
    connecting: '連線中…', you: '房主（左）', guest: '客人（右）', spec: '觀戰中', ping: '延遲',
    lostOpp: '對手斷線，等待重新連線…', lostHost: '連線中斷，重新連線中…', ended: '連線已結束，回到單人模式。',
    youWin: '你贏了！', youLose: '你輸了', hostWin: '房主獲勝', guestWin: '客人獲勝',
    note: '房主當左邊 1P、客人當右邊 2P。鍵盤兩組按鍵、手機觸控都能操作。房主的分頁要保持在前景，切到背景遊戲會停。',
    badCode: '代碼是 4 個英數字', full: '已有其他人在對戰，你會以觀戰身分加入。',
    selfDown: '你的網路中斷，重新連線中…', reconnecting: '重新連線中…', youLag: '你的連線不穩，房主正在等你…',
    hostHidden: '房主切到背景了，遊戲暫停中…', oppHidden: '對手切到背景了，等待中…', resume: '繼續',
    noRelay: '連線元件載入失敗，請檢查網路後重試。', hostLost: '房主連線中斷，等待中…', paused: '暫停中…', back: '回到房間', revoked: '你的連線權限被收回了，回到單人模式。', gaveUp: '一直連不上，先回到單人模式。'
  } : {
    btn: 'Online', title: 'Online match', host: 'Create room', join: 'Join', codePh: 'Room code',
    myChar: 'Your character', change: 'Change', leave: 'Leave room', start: 'Start match', again: 'Rematch',
    waitOpp: 'Waiting for an opponent… share the code.', oppIn: 'Opponent joined', waitHost: 'Joined. Waiting for the host to start…',
    noHost: 'No host in this room yet. Check the code, or ask your friend to create the room first.', dup: 'This code is taken by another room. Leave and create a new one.',
    noRoom: 'Online play is not available here. You must be signed in and be a member of (or invited to) the organization that owns this artifact; public-link viewers cannot connect.',
    connecting: 'Connecting…', you: 'Host (left)', guest: 'Guest (right)', spec: 'Spectating', ping: 'Ping',
    lostOpp: 'Opponent disconnected, waiting…', lostHost: 'Connection lost, reconnecting…', ended: 'Online session ended. Back to single player.',
    youWin: 'You win!', youLose: 'You lose', hostWin: 'Host wins', guestWin: 'Guest wins',
    note: 'Host plays left (1P), guest plays right (2P). Either key set or touch controls work. Keep the host tab in the foreground.',
    badCode: 'Code is 4 letters/digits', full: 'A match is already running; you will spectate.',
    selfDown: 'Your connection dropped, reconnecting…', reconnecting: 'Reconnecting…', youLag: 'Your connection is unstable; the host is waiting…',
    hostHidden: 'Host switched away; game paused…', oppHidden: 'Opponent switched away; waiting…', resume: 'Resume',
    noRelay: 'Could not load the network module. Check your connection and retry.', hostLost: 'Lost the host, waiting…', paused: 'Paused…', back: 'Back to room', revoked: 'Your access was revoked. Back to single player.', gaveUp: 'Could not reconnect. Back to single player.'
  };

  // ============================================================
  // 小工具
  // ============================================================
  function now() { return performance.now(); }
  function r1(v) { return Math.round((+v || 0) * 10) / 10; }
  function num(v) { v = +v; return isFinite(v) ? v : 0; }
  function ctrlOf() { return window._pv && window._pv.ctrl; }
  // 遊戲本體要等第一個畫面的「開始」被按下才會載入。玩家可能沒按就直接進房間，
  // 這樣開局時沒有遊戲可以進入（客人卡在等待、房主以為對手斷線），所以幫他按。
  function ensureGame() {
    if (ctrlOf()) return;
    var box = document.getElementById('about-box'), btn = document.getElementById('close-about-btn');
    if (box && btn && !box.classList.contains('hidden')) btn.click();   // 已經隱藏＝載入中，不用再按
  }
  function validCh(c) { return typeof c === 'string' && VALID[c] === true ? c : 'pikachu'; }
  function selectedChar(n) {
    if (!CH) return 'pikachu';
    if (window.PV_CharSelect && window.PV_CharSelect.current) return validCh(window.PV_CharSelect.current(n));   // 遊戲還沒載入時也讀得到剛選的角色
    for (var i = 0; i < CH.ids.length; i++) {
      var b = document.getElementById('p' + n + '-' + CH.ids[i] + '-btn');
      if (b && b.classList.contains('selected')) return CH.ids[i];
    }
    return n === 1 ? 'bird' : 'pikachu';
  }
  function charName(id) { var c = CH && CH.byId[id]; return c ? c.name : id; }
  var CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
  function newCode() { var s = ''; for (var i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }

  // ============================================================
  // 連線層：artifact room capability；本機測試時（網址帶 ?fakeroom）改用 BroadcastChannel 模擬
  // ============================================================
  var roomP = null;
  function getRoom() {
    if (roomP) return roomP;
    var p;
    if (/[?&]fakeroom/.test(location.search)) p = Promise.resolve(fakeRoom());
    else if (window.claude && typeof window.claude.use === 'function' && !/[?&]selfroom/.test(location.search)) {
      p = Promise.resolve(window.claude.use('room')).catch(function () { return null; });
    } else {
      // 自架版（不在 claude.ai 裡）：用自己的連線層（點對點直連＋多個中繼伺服器備援）
      selfMode = true;
      p = loadScript('../vendor/mqtt.min.js').then(function () { return loadScript('../selfroom.js'); })
        .then(function () { if (!window.PV_SelfRoom) roomWhy = 'self-load'; return window.PV_SelfRoom || null; })
        .catch(function () { roomWhy = 'self-load'; return null; });
    }
    roomP = p;
    // 拿不到就不要記住失敗結果：下次按按鈕再問一次平台（可能只是還沒準備好）
    p.then(function (r) { if (!r) { if (!roomWhy) roomWhy = 'use-null'; if (roomP === p) roomP = null; } else roomWhy = ''; });
    return p;
  }
  var roomWhy = '', selfMode = false;
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = rej; document.head.appendChild(el);
    });
  }

  function fakeRoom() {
    // 本機測試用：模擬 room.join。每個分頁一個 peer，presence 合併後廣播（約 30 次/秒）。
    // 網址參數：lag=單程延遲ms  jitter=抖動ms  loss=掉包率
    // 故障注入：window.__fake.down(ms) 斷線一段時間；.endRoom(code) 讓具名房間結束；
    //           .failJoins(n) 接下來 n 次 join 失敗；.terminal(code) 永久性錯誤
    var q = new URLSearchParams(location.search);
    var lag = +q.get('lag') || 0, jitter = +q.get('jitter') || 0, loss = +q.get('loss') || 0;
    var me = 'p' + Math.random().toString(36).slice(2, 10);
    var bc = new BroadcastChannel('pv-fakeroom');
    var rooms = {}, online = true, failJoins = 0, lobbyConnFns = [];
    function deliver(fn) { if (Math.random() < loss) return; setTimeout(fn, lag + Math.random() * jitter); }
    function post(m) { if (online) bc.postMessage(m); }
    bc.onmessage = function (e) {
      var m = e.data, R = rooms[m.name];
      if (!online || !R || R.dead || m.peer === me) return;
      deliver(function () {
        if (!online || R.dead) return;
        if (m.t === 'hello') R.send();
        if (m.t === 'bye') { delete R.others[m.peer]; R.notify(); return; }
        if (m.t === 'p') { R.others[m.peer] = Object.freeze({ peer: m.peer, presence: m.presence, updatedAt: Date.now(), isMe: false, sameTab: false, kind: 'viewer', guest: false, by: null }); R.notify(); }
      });
    };
    window.addEventListener('pagehide', function () { Object.keys(rooms).forEach(function (n) { post({ t: 'bye', name: n, peer: me }); }); });
    function err(code) { return { code: code, message: code }; }
    window.__fake = {
      down: function (ms) {
        online = false;
        Object.keys(rooms).forEach(function (n) { rooms[n].conn(false); });
        setTimeout(function () {
          online = true;
          Object.keys(rooms).forEach(function (n) { var R = rooms[n]; R.conn(true); R.send(); post({ t: 'hello', name: n, peer: me }); });
        }, ms);
      },
      endRoom: function (code) {
        Object.keys(rooms).forEach(function (n) { var R = rooms[n]; R.dead = code || 'upstream_error'; R.errs.forEach(function (f) { f(err(R.dead)); }); post({ t: 'bye', name: n, peer: me }); delete rooms[n]; });
      },
      failJoins: function (n) { failJoins = n; },
      terminal: function (code) {
        lobbyConnFns.forEach(function (f) { f(err(code)); });
        Object.keys(rooms).forEach(function (n) { var R = rooms[n]; R.dead = code; R.errs.forEach(function (f) { f(err(code)); }); });
      },
      me: me
    };
    return {
      onConnection: function (fn, onErr) { setTimeout(function () { fn(online); }, 0); if (onErr) lobbyConnFns.push(onErr); return function () {}; },
      connected: function () { return online; },
      join: function (name) {
        if (failJoins > 0) { failJoins--; return new Promise(function (_, rej) { setTimeout(function () { rej(err('upstream_error')); }, 200); }); }
        if (rooms[name]) return Promise.resolve(rooms[name]);
        var R = {
          name: name, mine: {}, others: {}, fns: [], cfns: [], errs: [], pending: false, lastSend: 0, timer: 0, dead: null,
          peers: function () {
            var list = [{ peer: me, presence: R.mine, updatedAt: Date.now(), isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null }];
            Object.keys(R.others).forEach(function (k) { list.push(R.others[k]); });
            return list;
          },
          notify: function () {
            if (R.pending) return;
            R.pending = true;
            requestAnimationFrame(function () { R.pending = false; if (R.dead) return; var p = R.peers(); R.fns.forEach(function (f) { f({ peers: p, joined: [], left: [], updated: p }); }); });
          },
          send: function () { post({ t: 'p', name: name, peer: me, presence: R.mine }); R.lastSend = now(); },
          conn: function (ok) { R.cfns.forEach(function (f) { f(ok); }); },
          presence: function (patch) {
            if (R.dead) return Promise.reject(err(R.dead));
            var next = Object.assign({}, R.mine);
            for (var k in patch) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
            if (JSON.stringify(next).length > 4096) return Promise.reject(err('invalid_argument'));
            R.mine = next;
            var wait = Math.max(0, 33 - (now() - R.lastSend));
            if (!R.timer) R.timer = setTimeout(function () { R.timer = 0; R.send(); }, wait);
            return Promise.resolve();
          },
          onPeers: function (fn, onErr) { R.fns.push(fn); if (onErr) R.errs.push(onErr); setTimeout(R.notify, 0); return function () { R.fns = R.fns.filter(function (f) { return f !== fn; }); R.errs = R.errs.filter(function (f) { return f !== onErr; }); }; },
          onConnection: function (fn, onErr) { R.cfns.push(fn); if (onErr) R.errs.push(onErr); setTimeout(function () { fn(online); }, 0); return function () { R.cfns = R.cfns.filter(function (f) { return f !== fn; }); R.errs = R.errs.filter(function (f) { return f !== onErr; }); }; },
          connected: function () { return online && !R.dead; },
          leave: function () { post({ t: 'bye', name: name, peer: me }); if (rooms[name] === R) delete rooms[name]; R.fns = []; R.cfns = []; R.errs = []; return Promise.resolve(); }
        };
        rooms[name] = R;
        post({ t: 'hello', name: name, peer: me });
        return Promise.resolve(R);
      }
    };
  }

  // ============================================================
  // 狀態
  // ============================================================
  var net = {
    room: null,            // 加入的具名房間
    code: '',
    role: null,            // 'host' | 'guest'
    phase: 'off',          // off | lobby | play | end
    myCh: 'pikachu',
    unsub: [],
    // 房主
    opp: null,             // 對手的 peer 標籤
    oppCh: 'pikachu',
    oppIn: null, oppSeen: 0, usedPc: 0, usedDc: 0, ackSeq: 0, ackT: 0,
    f: 0, ticked: false, hit: [0, 0], prevHit: [false, false],
    snd: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ev: [], evId: 0,
    paused: false, lostAt: 0, savedChars: null, lastSendT: 0,
    // 客人
    hostPeer: null, hostSeenT: 0, hostTs: 0, hostRole: null,
    render: false, queue: [], lastF: -1, last: null, extrap: 0,
    gHit: null, gSnd: null, gEv: 0, gScores: '', gState: '',
    seq: 0, pc: 0, dc: 0, dd: 0, hist: [], predX: null, joinedAt: 0,
    // 共用
    rtt: 0, msg: ''
  };

  // ============================================================
  // 介面
  // ============================================================
  var css = [
    '#pv-net{position:fixed;inset:0;z-index:20001;display:none;align-items:center;justify-content:center;background:rgba(10,12,24,.82);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#fff}',
    '#pv-net.open{display:flex}',
    '#pv-net .box{width:min(440px,94vw);max-height:92vh;max-height:calc(100dvh - 24px);overflow:auto;background:#1b1e33;border:2px solid #3a3f66;border-radius:14px;padding:16px 18px;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '#pv-net h2{margin:0 0 10px;font-size:18px;display:flex;justify-content:space-between;align-items:center}',
    '#pv-net .x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;opacity:.7}',
    '#pv-net .row{display:flex;gap:8px;align-items:center;margin:10px 0}',
    '#pv-net button.b{flex:1;padding:11px 10px;border-radius:10px;border:0;background:#3f51b5;color:#fff;font-size:15px;font-weight:700;cursor:pointer}',
    '#pv-net button.b.alt{background:#2e3358}',
    '#pv-net button.b.go{background:#e53935}',
    '#pv-net button.b:disabled{opacity:.45;cursor:default}',
    '#pv-net input{flex:1;min-width:0;padding:10px;border-radius:10px;border:2px solid #3a3f66;background:#11132a;color:#fff;font-size:18px;letter-spacing:4px;text-transform:uppercase;text-align:center}',
    '#pv-net .code{font-size:42px;font-weight:900;letter-spacing:10px;text-align:center;margin:6px 0;color:#FFE14D}',
    '#pv-net .st{font-size:14px;line-height:1.6;opacity:.9;min-height:22px;white-space:pre-line}',
    '#pv-net .st.err{color:#ff8a80}',
    '#pv-net .ch{display:flex;align-items:center;gap:8px;font-size:14px;background:#262a47;border-radius:10px;padding:8px 10px}',
    '#pv-net .ch b{flex:1}',
    '#pv-net .ch button{background:#3a3f66;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}',
    '#pv-net .note{font-size:12px;opacity:.55;margin-top:10px;line-height:1.5}',
    '#pv-net-hud{position:fixed;top:52px;right:10px;z-index:19000;display:none;gap:8px;align-items:center;font:600 12px/1 "Noto Sans TC",sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:5px 10px;border-radius:999px;pointer-events:auto}',
    '#pv-net-hud.on{display:flex}',
    '#pv-net-hud .dot{width:8px;height:8px;border-radius:50%;background:#66BB6A}',
    '#pv-net-hud .dot.mid{background:#FFCA28}#pv-net-hud .dot.bad{background:#EF5350}',
    '#pv-net-hud button{background:#555;color:#fff;border:0;border-radius:999px;padding:3px 8px;font-size:11px;cursor:pointer}',
    '#pv-net-ov{position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);z-index:19001;display:none;background:rgba(0,0,0,.75);color:#fff;padding:12px 18px;border-radius:12px;font:700 15px "Noto Sans TC",sans-serif;text-align:center}',
    '#pv-net-ov.on{display:block}'
  ].join('\n');

  var ui = {};
  function el(tag, attrs, html) { var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

  function buildUI() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    ui.root = el('div', { id: 'pv-net' });
    ui.root.innerHTML = '<div class="box" role="dialog"><h2><span>' + T.title + '</span><button class="x" type="button">✕</button></h2>' +
      '<div class="ch"><span>' + T.myChar + '</span><b class="mych"></b><button type="button" class="chg">' + T.change + '</button></div>' +
      '<div class="home"><div class="row back-row" style="display:none"><button class="b go back" type="button"></button></div>' +
      '<div class="row"><button class="b mk" type="button">' + T.host + '</button></div>' +
      '<div class="row"><input class="code-in" maxlength="4" placeholder="' + T.codePh + '" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="b alt jn" type="button">' + T.join + '</button></div></div>' +
      '<div class="inroom" style="display:none"><div class="code"></div><div class="row act"></div><div class="row"><button class="b alt lv" type="button">' + T.leave + '</button></div></div>' +
      '<div class="st"></div><div class="dbg" style="font-size:11px;opacity:.4;margin-top:4px"></div><div class="note">' + T.note + '</div></div>';
    document.body.appendChild(ui.root);
    var q = function (s) { return ui.root.querySelector(s); };
    ui.mych = q('.mych'); ui.home = q('.home'); ui.inroom = q('.inroom'); ui.code = q('.code');
    ui.act = q('.act'); ui.st = q('.st'); ui.dbg = q('.dbg'); ui.codeIn = q('.code-in');
    q('.x').onclick = closePanel;
    ui.root.addEventListener('click', function (e) { if (e.target === ui.root) closePanel(); });
    q('.chg').onclick = function () { if (window.PV_CharSelect) window.PV_CharSelect.open(1, true); };
    q('.mk').onclick = function () { if (net.phase === 'off' && !conn.joining) start('host', newCode()); };
    ui.backRow = q('.back-row'); ui.back = q('.back');
    ui.back.onclick = function () { var l = lastRoom(); if (l) start(l.role, l.code); };
    q('.jn').onclick = function () {
      var c = (ui.codeIn.value || '').trim().toLowerCase();
      if (!/^[a-z0-9]{4}$/.test(c)) { status(T.badCode, true); return; }
      start('guest', c);
    };
    ui.codeIn.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') ui.root.querySelector('.jn').click(); });
    ui.codeIn.addEventListener('keyup', function (e) { e.stopPropagation(); });
    q('.lv').onclick = function () { stop(); };

    ui.hud = el('div', { id: 'pv-net-hud' }, '<span class="dot"></span><span class="who"></span><span class="pg"></span><button type="button">' + T.leave + '</button>');
    ui.hud.querySelector('button').onclick = function () { stop(); };
    document.body.appendChild(ui.hud);
    ui.ov = el('div', { id: 'pv-net-ov' });
    document.body.appendChild(ui.ov);

    // 選單列加一顆「連線對戰」
    var left = document.querySelector('#menu-bar .btn-container.left');
    if (left) {
      var wrap = el('div', { class: 'relative-container' });
      var b = el('button', { type: 'button', id: 'pv-net-btn', class: 'btn' }, T.btn);
      b.onclick = function (e) { e.stopPropagation(); ensureGame(); openPanel(); };   // 趁玩家還在選角色、輸入代碼時先把遊戲載好
      wrap.appendChild(b);
      left.insertBefore(wrap, left.querySelector('.color-scheme-toggle-switch-container'));
    }
    setInterval(refreshChar, 700);
  }

  function refreshChar() {
    var c = selectedChar(1);
    if (c !== net.myCh) net.myCh = c;
    if (ui.mych) ui.mych.textContent = charName(net.myCh);
  }
  function status(t, err) { if (!ui.st) return; ui.st.textContent = t || ''; ui.st.className = 'st' + (err ? ' err' : ''); }
  function openPanel() { refreshChar(); renderPanel(); ui.root.style.zIndex = (window._pvZ = Math.max(window._pvZ || 20010, 20010) + 1); ui.root.classList.add('open'); var c = ctrlOf(); if (c && net.phase === 'off') { /* 不暫停：讓背景照跑 */ } }
  function closePanel() { ui.root.classList.remove('open'); }
  function overlay(t) { if (!ui.ov) return; ui.ov.textContent = t || ''; ui.ov.classList.toggle('on', !!t); }

  function resultText() {
    var c = ctrlOf();
    if (!c || net.phase !== 'end') return '';
    var p1w = c.physics.player1.isWinner, p2w = c.physics.player2.isWinner;
    if (!p1w && !p2w) return '';
    var mine = net.role === 'host' ? p1w : (net.hostRole === 'player' ? p2w : null);
    var head = mine === null ? (p1w ? T.hostWin : T.guestWin) : (mine ? T.youWin : T.youLose);
    return head + '  ' + c.scores[0] + ' : ' + c.scores[1] + '\n';
  }

  var lobby = null;
  function diag() {
    var t = '';
    try { t += ' conn:' + (net.room && net.room.connected ? (net.room.connected() ? 'Y' : 'N') : '?'); } catch (e) { t += ' conn:err'; }
    try { if (lobby) t += ' lobby:' + lobby.peers().length + (lobby.connected() ? 'Y' : 'N'); } catch (e) {}
    try { if (net.room && net.room.info) t += ' · ' + net.room.info(); } catch (e) {}
    if (net.lastErr) t += ' err:' + net.lastErr;
    return t;
  }

  function lastRoom() {
    try { var l = JSON.parse(sessionStorage.getItem('pv-net-last') || 'null'); return l && /^[a-z0-9]{4}$/.test(l.code) && (l.role === 'host' || l.role === 'guest') ? l : null; } catch (e) { return null; }
  }

  function renderPanel() {
    var inRoom = net.phase !== 'off';
    var l = !inRoom && lastRoom();
    if (ui.backRow) { ui.backRow.style.display = l ? '' : 'none'; if (l) ui.back.textContent = T.back + ' ' + l.code.toUpperCase() + '（' + (l.role === 'host' ? T.you : T.guest) + '）'; }
    if (ui.dbg) ui.dbg.textContent = inRoom ? (LANG === 'zh' ? '房間內 ' : 'In room: ') + (net.peerCount || 0) + (LANG === 'zh' ? ' 人' : '') + '  [' + (net.peerDbg || '') + ']' + diag() : '';
    ui.home.style.display = inRoom ? 'none' : '';
    ui.inroom.style.display = inRoom ? '' : 'none';
    ui.code.textContent = net.code.toUpperCase();
    ui.act.innerHTML = '';
    if (!inRoom) return;
    if (net.role === 'host') {
      var go = el('button', { type: 'button', class: 'b go' }, net.phase === 'end' ? T.again : T.start);
      go.disabled = !net.opp || net.phase === 'play';
      go.onclick = function () { hostStart(); };
      ui.act.appendChild(go);
      if (net.phase === 'lobby' || net.phase === 'end') {
        if (!net.room) status(conn.lostSince ? T.reconnecting : T.connecting, !!conn.lostSince);
        else if (net.msg === 'dup') status(T.dup, true);
        else status(resultText() + (net.opp ? T.oppIn + '：' + charName(net.oppCh) : T.waitOpp));
      }
    } else {
      if (!net.room) status(conn.lostSince ? T.reconnecting : T.connecting, !!conn.lostSince);
      else if (!net.hostPeer && now() - net.joinedAt > 6000) status(T.noHost, true);
      else if (!net.hostPeer) status(T.connecting);
      else if (net.render && net.hostRole === 'spec') status(T.spec);
      else status(resultText() + T.waitHost);
    }
  }

  function hud() {
    var on = net.phase === 'play' || net.phase === 'end';
    ui.hud.classList.toggle('on', on);
    if (!on) return;
    var who = net.role === 'host' ? T.you : (net.hostRole === 'spec' ? T.spec : T.guest);
    ui.hud.querySelector('.who').textContent = who;
    var ms = Math.round(net.rtt);
    ui.hud.querySelector('.pg').textContent = net.rtt ? T.ping + ' ' + ms + 'ms' : '';
    ui.hud.querySelector('.dot').className = 'dot' + (ms > 180 ? ' bad' : ms > 90 ? ' mid' : '');
  }

  // ============================================================
  // 進出房間
  // ============================================================
  // ------------------------------------------------------------
  // 連線管理：平台會自己處理 socket 的短暫重連；這裡處理平台處理不了的：
  //  - 具名房間「結束」（upstream_error / limit_reached）→ 指數退避後重新 join（peer 標籤不變，對局接得回來）
  //  - 永久性錯誤（revoked / not_granted / capability_*）→ 直接結束，不重試
  //  - connected() 掉下去持續 2 秒才算斷線（平台會定期刷新連線，短暫掉一下是正常的）
  //  - 斷線太久仍沒恢復 → 主動重 join；總共 60 秒都救不回來才放棄
  // ------------------------------------------------------------
  var TERMINAL = { revoked: 1, not_granted: 1, capability_disabled: 1, capability_removed: 1, transform_error: 1 };
  var conn = { up: false, downSince: 0, attempt: 0, timer: 0, gen: 0, joining: 0, failSends: 0, firstFail: 0, lostSince: 0, token: 0, leaving: null, leaveTimer: 0 };

  function errCode(e) { return (e && e.code) || 'upstream_error'; }

  function start(role, code) {
    if (net.phase !== 'off') stop();
    ensureGame();
    var token = ++conn.token;   // 每次開始一個新的 token；舊的 join 結果回來就丟掉
    status(T.connecting);
    getRoom().then(function (room) {
      if (token !== conn.token) return;
      if (!room) { status((selfMode ? T.noRelay : T.noRoom) + '  [' + roomWhy + ']', true); return; }
      lobby = room;
      net.code = code; net.role = role; net.phase = 'lobby'; net.msg = '';
      net.joinedAt = now();
      net.sid = Math.random().toString(36).slice(2, 8);
      conn.attempt = 0; conn.lostSince = 0;
      if (lobby.onConnection && !lobby.__pvWatched) {
        try { lobby.__pvWatched = true; } catch (e) {}
        lobby.onConnection(function () {}, function (e) { if (TERMINAL[errCode(e)] && net.phase !== 'off') fatal(errCode(e)); });
      }
      joinRoom();
      renderPanel();
    }).catch(function (e) { status(errCode(e), true); });
  }

  function joinRoom() {
    if (net.phase === 'off' || !lobby) return;
    var token = conn.token;
    if (conn.joining === token) return;
    conn.joining = token;
    var name = 'pv-' + net.code;
    // 剛按過「離開」又馬上進同一個房間：平台會回傳同一個房間物件，所以取消那個延遲的 leave，免得把新的連線踢掉
    if (conn.leaving) { clearTimeout(conn.leaveTimer); conn.leaving = null; }
    lobby.join(name).then(function (nr) {
      if (conn.joining === token) conn.joining = 0;
      if (token !== conn.token || net.phase === 'off') {
        if (net.room !== nr) { try { nr.leave(); } catch (e) {} }
        // 這段時間內又開始了新的一次：如果新的那次被擋住了，補一次 join
        if (net.phase !== 'off' && !net.room && !conn.timer) joinRoom();
        return;
      }
      conn.attempt = 0;
      attach(nr);
      // 記在這個分頁裡：不小心重新整理後可以一鍵回到同一個房間
      try { sessionStorage.setItem('pv-net-last', JSON.stringify({ role: net.role, code: net.code })); } catch (e) {}
    }, function (e) {
      if (conn.joining === token) conn.joining = 0;
      if (token !== conn.token) { if (net.phase !== 'off' && !net.room && !conn.timer) joinRoom(); return; }
      var code = errCode(e);
      net.lastErr = code;
      if (TERMINAL[code] || code === 'not_permitted') { fatal(code); return; }
      if (code === 'invalid_argument') { stop(code); return; }
      if (!conn.lostSince) conn.lostSince = now();   // 一開始就一直加入失敗，也要算進 60 秒放棄
      if (!conn.downSince) conn.downSince = now();
      scheduleRejoin();
    });
  }

  function attach(nr) {
    detach(false);
    var gen = ++conn.gen;
    net.room = nr;
    var lost = function (e) { if (gen === conn.gen) roomLost(e); };
    net.unsub.push(nr.onPeers(function (ch) { if (gen === conn.gen) onPeers(ch); }, lost));
    if (nr.onConnection) net.unsub.push(nr.onConnection(function (ok) { if (gen === conn.gen) connChanged(ok); }, lost));
    connChanged(nr.connected ? nr.connected() : true);
  }

  function detach(leave) {
    net.unsub.forEach(function (u) { try { u(); } catch (e) {} });
    net.unsub = [];
    conn.gen++;
    var r = net.room;
    net.room = null;
    if (r && leave) { try { r.leave(); } catch (e) {} }
  }

  function connChanged(ok) {
    if (ok) {
      // 從「真的斷線」恢復：給對方的資料一點緩衝時間，並倒數後才繼續，免得一恢復就被判對手斷線或直接開打
      if (conn.downSince && now() - conn.downSince > 2000 && (net.phase === 'play' || net.phase === 'end')) {
        if (net.role === 'host') { net.resumeAt = now() + 1500; net.oppSeen = now(); }
        else net.hostSeenT = now();
      }
      conn.up = true; conn.downSince = 0; conn.lostSince = 0; conn.failSends = 0;
      resendNow();
    } else if (conn.up || !conn.downSince) {
      conn.up = false; conn.downSince = now();
      if (!conn.lostSince) conn.lostSince = now();
    }
  }

  function roomLost(e) {
    var code = errCode(e);
    net.lastErr = code;
    if (TERMINAL[code] || code === 'not_permitted') { fatal(code); return; }
    conn.up = false;
    if (!conn.downSince) conn.downSince = now();
    if (!conn.lostSince) conn.lostSince = now();
    detach(true);
    scheduleRejoin();
  }

  function scheduleRejoin() {
    if (conn.timer || net.phase === 'off') return;
    // 0.5s → 1s → 2s → 4s → 8s（上限），加 ±25% 抖動，避免兩邊同時重試撞在一起
    var base = Math.min(8000, 500 * Math.pow(2, conn.attempt));
    var delay = base * (0.75 + Math.random() * 0.5);
    conn.attempt++;
    conn.timer = setTimeout(function () { conn.timer = 0; joinRoom(); }, delay);
  }

  function fatal(code) {
    stop(code === 'revoked' ? T.revoked : T.noRoom);
  }

  function selfDown() { return !conn.up && conn.downSince && now() - conn.downSince > 2000; }

  // presence 送出的共同入口：送失敗累積太多次就當房間壞了，重新 join
  function send(p) {
    var r = net.room;
    if (!r) return;
    r.presence(p).then(function () { conn.failSends = 0; conn.firstFail = 0; }, function (e) {
      var code = errCode(e);
      net.lastErr = code;
      if (code === 'invalid_argument') { if (window.console) console.warn('[netplay] presence rejected', e && e.message); return; }
      if (TERMINAL[code]) { fatal(code); return; }
      if (!conn.firstFail) conn.firstFail = now();
      // 平台重連期間送失敗是正常的：連續失敗而且超過 3 秒才當成房間壞了
      if (++conn.failSends > 25 && now() - conn.firstFail > 3000 && r === net.room) roomLost(e);
    });
  }

  function resendNow() {
    if (!net.room) return;
    if (net.role === 'host') { if (net.phase === 'play' || net.phase === 'end') hostSend(true); else sendLobby(); }
    else guestSend();
  }

  function stop(msg) {
    var c = ctrlOf();
    var wasPlaying = net.phase === 'play' || net.phase === 'end';
    if (conn.timer) { clearTimeout(conn.timer); conn.timer = 0; }
    var r = net.room;
    detach(false);
    conn.token++; conn.joining = 0;
    if (r) {
      // 先告訴對方「我走了」，對方就不用等斷線倒數；稍後再真的離開（讓這則 presence 送得出去）
      try { r.presence({ ph: 'bye', s: null }).catch(function () {}); } catch (e) {}
      if (conn.leaving) clearTimeout(conn.leaveTimer);
      conn.leaving = r;
      conn.leaveTimer = setTimeout(function () { if (conn.leaving === r) { conn.leaving = null; try { r.leave(); } catch (e) {} } }, 400);
    }
    if (c) {
      if (net.render) guestExit(c);
      else if (net.role === 'host' && wasPlaying) hostExit(c);
    }
    Object.assign(net, {
      code: '', role: null, phase: 'off', opp: null, oppIn: null, oppBase: null, paused: false, lostAt: 0, resumeAt: 0,
      hostPeer: null, render: false, queue: [], last: null, lastF: -1, rtt: 0, msg: '', hostRole: null, gSid: null
    });
    conn.up = false; conn.downSince = 0; conn.lostSince = 0; conn.attempt = 0; conn.failSends = 0; conn.firstFail = 0;
    try { sessionStorage.removeItem('pv-net-last'); } catch (e) {}
    overlay('');
    hud();
    renderPanel();
    status(msg || '');
    if (ui.codeIn) ui.codeIn.value = '';
  }

  function sendLobby() {
    if (!net.room) return;
    var p = { role: net.role, ch: net.myCh, ph: net.phase, ts: Math.round(now()), hid: document.hidden ? 1 : 0 };
    if (net.role === 'host') { p.opp = net.opp; }
    send(p);
  }
  setInterval(function () {
    if (net.phase === 'off') return;
    // 斷線 15 秒平台還沒救回來：主動重新 join；總共 60 秒都不行就放棄
    if (conn.lostSince && !conn.timer && !conn.joining && now() - conn.lostSince > 15000 && now() - (conn.lastForce || 0) > 15000) {
      conn.lastForce = now(); detach(true); scheduleRejoin();
    }
    if (conn.lostSince && now() - conn.lostSince > 60000) { stop(T.gaveUp); return; }
    checkTimeouts();
    if (ui.root.classList.contains('open')) renderPanel();
    hud();
    if (!net.room) return;
    if (net.role === 'host' && net.phase === 'lobby') sendLobby();
    if (net.role === 'host' && net.phase === 'play' && now() - net.lastSendT > 400) hostSend(true);   // 暫停或慢動作時的心跳
    if (net.role === 'guest' && !net.render) guestSend();
  }, 250);
  document.addEventListener('visibilitychange', function () { if (net.room) resendNow(); });

  // ============================================================
  // 收到房間裡其他人的 presence
  // ============================================================
  var peerErrs = 0;
  function onPeers(ch) {
    try { onPeersInner(ch); }
    catch (e) { if (peerErrs++ < 5 && window.console) console.warn('[netplay] bad presence ignored', e); }
  }
  function onPeersInner(ch) {
    var peers = Array.isArray(ch && ch.peers) ? ch.peers : [];
    net.peerCount = peers.length;
    net.peerDbg = peers.map(function (p) { return (p.sameTab ? '*' : '') + (p.kind || '?') + ':' + (p.presence && p.presence.role || '-'); }).join(' ');
    if (net.role === 'host') hostPeers(peers);
    else guestPeers(peers);
  }

  function hostPeers(peers) {
    var others = peers.filter(function (p) { return !p.sameTab && p.kind !== 'agent'; });
    // 同代碼撞房：peer 標籤比較小的那個當房主
    var me = peers.filter(function (p) { return p.sameTab; })[0];
    var rival = others.filter(function (p) { return p.presence && p.presence.role === 'host'; })[0];
    net.msg = rival && me && rival.peer < me.peer ? 'dup' : '';
    var guests = others.filter(function (p) {
      // 正在跟別的房主比賽的客人不搶（同代碼開了第二個房間時）
      return p.presence && p.presence.role === 'guest' && p.presence.ph !== 'bye' && (!p.presence.hp || (me && p.presence.hp === me.peer));
    });
    if (net.opp && (net.phase === 'play' || net.phase === 'end')) {
      var gone = others.filter(function (p) { return p.peer === net.opp && p.presence && p.presence.ph === 'bye'; })[0];
      if (gone) { hostBackToLobby(); return; }
    }
    var opp = guests.filter(function (p) { return p.peer === net.opp; })[0];
    net.oppGone = !!net.opp && !opp;
    if (!opp && (net.phase === 'lobby' || net.phase === 'end' || net.paused)) {
      opp = guests[0];
      if (opp) { net.opp = opp.peer; sendLobby(); }
    }
    if (!opp) return;
    var pr = opp.presence;
    if (pr.ch) net.oppCh = validCh(pr.ch);
    if (opp.peer !== net.oppBase) {
      // 換了一個對手（或客人重新整理）：他的按鍵計數器從頭算，重新對齊，免得送出一堆舊的殺球
      net.oppBase = opp.peer;
      var g0 = parseIn(pr.in);
      net.usedPc = g0.pc; net.usedDc = g0.dc; net.oppTraw = undefined;
    }
    if (pr.in !== undefined) net.oppIn = pr.in;
    net.oppHidden = !!pr.hid;
    if (pr.t !== net.oppTraw && (net.phase !== 'play' || Array.isArray(pr.in))) {
      // 客人的 presence 有更新（比賽中還要有按鍵資料）＝還連著
      net.oppTraw = pr.t; net.oppT = num(pr.t); net.oppTArr = now(); net.oppSeen = now();
      if (net.paused && !net.oppHidden) { net.paused = false; net.lostAt = 0; net.resumeAt = now() + 1500; }
    }
    if (typeof pr.ht === 'number' && pr.ht !== net.lastHt) {
      // ht 已經扣掉客人那邊的停留時間，所以這就是網路來回
      net.lastHt = pr.ht; var rtt = now() - pr.ht;
      if (rtt >= 0 && rtt < 5000) net.rtt = net.rtt ? net.rtt * 0.8 + rtt * 0.2 : rtt;
    }
  }

  function guestPeers(peers) {
    var hosts = peers.filter(function (p) { return !p.sameTab && p.kind !== 'agent' && p.presence && p.presence.role === 'host' && p.presence.ph !== 'bye'; });
    var me = peers.filter(function (p) { return p.sameTab; })[0];
    // 選房主的順序：把我當對手的那個 > 原本跟著的那個 > peer 標籤最小的。
    // 這樣就算有人用同一個代碼開了第二個房間（或故意冒充），也搶不走正在進行的比賽。
    function rank(h) {
      var mine = me && h.presence.opp === me.peer;
      var live = h.presence.ph === 'play' || h.presence.ph === 'end';
      if (h.peer === net.hostPeer && mine) return 0;   // 正在跟我打的那個房主
      if (mine && live) return 1;
      if (h.peer === net.hostPeer) return 2;
      if (mine) return 3;
      return 4;
    }
    hosts.sort(function (a, b) { return rank(a) - rank(b) || (a.peer < b.peer ? -1 : 1); });
    var h = hosts[0];
    var bye = !h && net.hostPeer && peers.filter(function (p) { return p.peer === net.hostPeer && p.presence && p.presence.ph === 'bye'; })[0];
    if (bye) { if (net.render || net.phase !== 'lobby') stop(T.ended); else net.hostPeer = null; return; }
    if (!h) { net.hostPeer = null; return; }
    net.hostPeer = h.peer;
    var pr = h.presence;
    if (pr.ts !== net.hostTs) { net.hostTs = pr.ts; net.hostSeenT = now(); if (net.lostAt) { net.lostAt = 0; } }
    net.hostHidden = !!pr.hid;
    net.hostCh = validCh(pr.ch);
    var mine = me && pr.opp === me.peer;
    net.hostRole = mine ? 'player' : 'spec';
    if (pr.ack && mine) {
      var aseq = num(pr.ack[0]), at = num(pr.ack[1]);
      if (at && at !== net.lastAckT) { net.lastAckT = at; var rtt = now() - at; if (rtt >= 0 && rtt < 5000) net.rtt = net.rtt ? net.rtt * 0.8 + rtt * 0.2 : rtt; }
      net.ackSeq = aseq;
    }
    if (pr.ph === 'play' && net.prevPh === 'end') closePanel();
    if ((pr.ph === 'play' || pr.ph === 'end') && pr.s) {
      var c = ctrlOf();
      if (!c) { ensureGame(); return; }   // 還在載入：載好後下一包快照就會進場
      if (!net.render) guestEnter(c);
      net.phase = pr.ph;
      var s = pr.s;
      if (s.sid !== net.gSid) {
        // 房主開了新的一局或重新整理：幀號、計數器全部重新對齊
        net.gSid = s.sid; net.lastF = -1; net.queue = [];
        net.gHit = null; net.gSnd = null; net.evBase = true; net.gEv = 0; net.gScores = ''; net.gState = '';
      }
      net.hz = num(s.hz);
      if (typeof s.f === 'number' && s.f > net.lastF) {
        net.lastF = s.f;
        net.queue.push({ s: s, ack: net.ackSeq });   // 不改動收到的 presence 物件（平台給的是凍結的）
        if (net.queue.length > 6) net.queue.shift();
      }
      if (pr.ph === 'end' && !ui.root.classList.contains('open') && net.prevPh !== 'end') { openPanel(); }
    } else if (pr.ph === 'lobby' && net.render) {
      // 房主回到大廳（例如按了重來）
      guestExit(c || ctrlOf()); net.phase = 'lobby';
    }
    net.prevPh = pr.ph;
  }

  function checkTimeouts() {
    var t = now();
    if (net.phase !== 'play' && net.phase !== 'end') {
      overlay('');
      if (net.phase === 'lobby' && (selfDown() || !net.room) && ui.root.classList.contains('open')) status(T.reconnecting, true);
      return;
    }
    var msg = '';
    if (selfDown()) msg = T.selfDown;
    if (net.role === 'host') {
      if (net.phase === 'play' && net.opp) {
        var stale = t - net.oppSeen > 2500;
        if ((stale || net.oppHidden) && !selfDown()) {
          if (!net.paused) { net.paused = true; net.lostAt = t; }
          var lim = net.oppGone ? 10 : net.oppHidden ? 120 : 30;   // 對方已經不在房間就不用等那麼久；切背景就多等
          msg = (net.oppHidden ? T.oppHidden : T.lostOpp) + ' ' + Math.max(0, Math.ceil(lim - (t - net.lostAt) / 1000));
          if (t - net.lostAt > lim * 1000) { hostBackToLobby(); return; }
        }
        if (!msg && net.resumeAt > t) msg = T.resume + ' ' + Math.ceil((net.resumeAt - t) / 500);
      }
    } else if (net.render) {
      if (!msg && t - net.hostSeenT > 2500) {
        if (!net.lostAt) net.lostAt = t;
        msg = T.hostLost + ' ' + Math.max(0, Math.ceil(30 - (t - net.lostAt) / 1000));
        if (t - net.lostAt > 30000) { stop(T.ended); return; }
      } else if (!msg && net.hostHidden) msg = T.hostHidden;
      else if (!msg && net.hz === 1 && net.hostRole === 'player') msg = T.youLag;
      else if (!msg && net.hz === 3) msg = net.hostRole === 'player' ? T.paused : T.oppHidden;
      else if (!msg && net.hz === 2) msg = T.resume;
    }
    overlay(msg);
  }

  // ============================================================
  // 房主
  // ============================================================
  var STATES = ['intro', 'menu', 'afterMenuSelection', 'beforeStartOfNewGame', 'startOfNewGame', 'round', 'afterEndOfRound', 'beforeStartOfNextRound'];
  function stateName(c) {
    for (var i = 0; i < STATES.length; i++) if (c.state === c[STATES[i]]) return STATES[i];
    return c.state === hostWait ? 'wait' : 'other';
  }
  function hostWait() { this.view.game.drawCloudsAndWave(); }

  function hostStart() {
    var c = ctrlOf();
    if (!c) ensureGame();
    if (!c || !net.opp) return;
    if (!net.savedChars) net.savedChars = [c.physics.player1.character, c.physics.player2.character, c.physics.player1.isComputer, c.physics.player2.isComputer];
    c.physics.player1.character = net.myCh;
    c.physics.player2.character = net.oppCh;
    c.physics.player1.isComputer = false;
    c.physics.player2.isComputer = false;
    if (c.isPracticeMode) c.isPracticeMode = false;
    c.paused = false;
    c.slowMotionFramesLeft = 0;
    c.view.intro.visible = false;
    c.view.menu.visible = false;
    c.frameCounter = 0;
    c.noInputFrameCounter = 0;
    // 開新的一局不會經過標題畫面，所以上一局留下的東西要自己清：
    // 畫面關掉再開會把訊息（Game Set）全部收起來；背景音樂先停，不然 startOfNewGame 再播一次就疊兩層
    c.view.game.visible = false;
    try { c.audio.sounds.bgm.stop(); } catch (e) {}
    c.state = c.startOfNewGame;
    var g = parseIn(net.oppIn);
    net.usedPc = g.pc; net.usedDc = g.dc;
    net.phase = 'play';
    net.sid = Math.random().toString(36).slice(2, 8);
    net.paused = false; net.lostAt = 0; net.resumeAt = 0; net.oppSeen = now();
    closePanel(); overlay('');
    hostSend(true);
  }

  // 對手離開或斷線太久：房主留在房間裡，回到大廳等下一個人
  function hostBackToLobby() {
    var c = ctrlOf();
    if (c) hostExit(c);
    net.phase = 'lobby'; net.opp = null; net.paused = false; net.lostAt = 0;
    overlay(''); sendLobby(); openPanel(); status(T.ended);
  }

  function hostExit(c) {
    if (net.savedChars) {
      c.physics.player1.character = net.savedChars[0];
      c.physics.player2.character = net.savedChars[1];
      net.savedChars = null;
    }
    c.restart();
  }

  function parseIn(a) {
    a = Array.isArray(a) ? a : [];
    var x = num(a[0]), y = num(a[1]);
    return { x: x > 0 ? 1 : x < 0 ? -1 : 0, y: y > 0 ? 1 : y < 0 ? -1 : 0, pc: num(a[2]), dc: num(a[3]), dd: Math.max(-2, Math.min(2, Math.round(num(a[4])))), seq: num(a[5]) };   // ±1 連點兩下的衝刺，±2 觸控技能鍵
  }

  function hostInject(c) {
    var kb = c.keyboardArray, k0 = kb[0], k1 = kb[1];
    // 房主兩組鍵都能控制左邊
    if (!k0.xDirection) k0.xDirection = k1.xDirection;
    if (!k0.yDirection) k0.yDirection = k1.yDirection;
    if (k1.powerHit === 1) k0.powerHit = 1;
    if (!k0.dashRequest && k1.dashRequest) k0.dashRequest = k1.dashRequest;
    // 右邊用客人的輸入
    var g = parseIn(net.oppIn);
    k1.xDirection = g.x; k1.yDirection = g.y;
    k1.powerHit = 0; k1.dashRequest = 0;
    if (g.pc > net.usedPc) { k1.powerHit = 1; net.usedPc = g.pc; }
    if (g.dc > net.usedDc) { k1.dashRequest = g.dd; net.usedDc = g.dc; }
    if (g.pc < net.usedPc - 50 || g.dc < net.usedDc - 50) { net.usedPc = g.pc; net.usedDc = g.dc; }   // 客人重新整理過
    net.ackSeq = g.seq;
  }

  function hostAfterLoop(c) {
    if (net.role !== 'host' || (net.phase !== 'play' && net.phase !== 'end')) return;
    if (net.phase === 'play' && (c.state === c.intro || c.state === c.menu)) {
      // 比賽結束：不要回標題畫面，停在結算畫面等「再來一局」
      c.state = hostWait;
      c.view.intro.visible = false; c.view.menu.visible = false;
      c.view.game.visible = true;
      c.view.game.messages.gameEnd.visible = true;
      net.phase = 'end';
      openPanel();
    }
    var ph = c.physics;
    [ph.player1, ph.player2].forEach(function (p, i) {
      var h = !!(p.isCollisionWithBallHappened || p.pvHit);   // pvHit：大蔥鴨用大蔥打到
      if (h && !net.prevHit[i]) net.hit[i]++;
      net.prevHit[i] = h;
    });
    if (net.ticked) {
      net.ticked = false;
      // 暫停中或結算畫面每幀都一樣，降到 5 次/秒，省下平台的訊息額度
      var idle = net.phase === 'end' || net.paused || selfDown() || net.resumeAt > now();
      if (!idle || now() - net.lastSendT > 200) hostSend(false);
    }
  }

  function hostCountSounds(c) {
    var ph = c.physics;
    [ph.player1, ph.player2].forEach(function (p, i) {
      var s = p.sound || {};
      if (s.pipikachu) net.snd[i * 4]++;
      if (s.pika) net.snd[i * 4 + 1]++;
      if (s.chu) net.snd[i * 4 + 2]++;
      if (s.flap) net.snd[i * 4 + 3]++;
    });
    var bs = ph.ball.sound || {};
    if (bs.powerHit) net.snd[8]++;
    if (bs.ballTouchesGround) net.snd[9]++;
  }

  function plArr(p, i) {
    var a = [r1(p.x), r1(p.y), p.state | 0, p.frameNumber | 0, p.divingDirection | 0, net.hit[i], validCh(p.character), p.isDashing ? 1 : 0, r1(p.yVelocity)];
    if (p.isDashing && p.dashTrailX && p.dashTrailX.length) a.push([r1(p.dashTrailX[0]), r1(p.dashTrailY[0]), r1(p.dashTrailX[1]), r1(p.dashTrailY[1])]);
    return a;
  }

  function buildSnap(c) {
    var ph = c.physics, b = ph.ball, g = c.view.game, m = g.messages;
    var name = stateName(c);
    var s = {
      f: net.f,
      st: name,
      fc: c.frameCounter | 0,
      fa: Math.round(c.view.fadeInOut.black.alpha * 100) / 100,
      gv: g.visible ? 1 : 0,
      ms: (m.gameStart.visible ? 1 : 0) | (m.ready.visible ? 2 : 0) | (m.gameEnd.visible ? 4 : 0),
      sc: [c.scores[0], c.scores[1]],
      sm: c.slowMotionFramesLeft > 0 ? 1 : 0,
      p: [plArr(ph.player1, 0), plArr(ph.player2, 1)],
      b: [r1(b.x), r1(b.y), b.rotation | 0, r1(b.punchEffectX), r1(b.punchEffectY), b.punchEffectRadius | 0, b.isPowerHit ? 1 : 0,
          r1(b.previousX), r1(b.previousY), r1(b.previousPreviousX), r1(b.previousPreviousY), r1(b.xVelocity), r1(b.yVelocity)],
      so: net.snd.slice(),
      w: ph.player1.isWinner ? 1 : ph.player2.isWinner ? 2 : 0,
      sid: net.sid,
      hz: net.paused ? (net.oppHidden ? 3 : 1) : (net.resumeAt > now() ? 2 : 0)
    };
    var an = A();
    if (an) s.ab = an.get();
    if (net.ev.length) s.ev = net.ev;
    return s;
  }

  function hostSend(force) {
    var c = ctrlOf();
    if (!c || !net.room) return;
    var p = { role: 'host', ch: net.myCh, ph: net.phase, opp: net.opp, ts: Math.round(now()), hid: document.hidden ? 1 : 0, ack: [net.ackSeq, net.oppT ? Math.round(net.oppT + now() - net.oppTArr) : 0], s: buildSnap(c) };
    var txt = JSON.stringify(p);
    if (txt.length > 4000) {   // 太大時先丟掉技能特效的細節
      delete p.s.ab; delete p.s.ev;
      if (window.console) console.warn('[netplay] snapshot too large', txt.length);
    }
    net.lastSendT = now();
    send(p);
  }

  // 技能事件（abilities.js 呼叫 _pvFxEvent）：房主記下來傳給客人重播
  var EV_TYPES = { zipStart: 1, zipEnd: 1, skill: 1 };
  function wrapFx() {
    var orig = window._pvFxEvent;
    window._pvFxEvent = function (type, d) {
      if (net.role === 'host' && net.phase === 'play' && EV_TYPES[type]) {
        var o = {};
        for (var k in d) {
          var v = d[k];
          if (k === 'player') o.pl = v && v.isPlayer2 ? 1 : 0;
          else if (typeof v === 'number') o[k] = r1(v);
          else if (typeof v === 'boolean' || typeof v === 'string') o[k] = v;
        }
        net.ev.push([++net.evId, type, o]);
        if (net.ev.length > 8) net.ev.shift();
      }
      return orig ? orig(type, d) : undefined;
    };
  }

  // ============================================================
  // 客人
  // ============================================================
  function guestState() {}

  function guestEnter(c) {
    net.render = true;
    net.savedChars = [c.physics.player1.character, c.physics.player2.character];
    c.view.intro.visible = false; c.view.menu.visible = false;
    if (c.isPracticeMode) c.isPracticeMode = false;
    c.slowMotionFramesLeft = 0;
    c.state = guestState;
    net.queue = []; net.last = null; net.extrap = 0;
    net.gHit = null; net.gSnd = null; net.gScores = ''; net.gState = '';
    net.gEv = 0; net.evBase = true;
    net.hostSeenT = now(); net.lostAt = 0;
    closePanel();
  }

  function guestExit(c) {
    net.render = false;
    if (c) {
      try { c.audio.sounds.bgm.stop(); } catch (e) {}
      if (net.savedChars) { c.physics.player1.character = net.savedChars[0]; c.physics.player2.character = net.savedChars[1]; }
      var an = A(); if (an) an.clear(c);
      c.restart();
    }
    net.savedChars = null;
  }

  function guestSend() {
    if (!net.room) return;
    var c = ctrlOf();
    var p = { role: 'guest', ch: net.myCh, ph: 'lobby', hp: net.render ? net.hostPeer : null, hid: document.hidden ? 1 : 0, ht: net.hostTs ? Math.round(net.hostTs + now() - net.hostSeenT) : 0, t: Math.round(now()) };
    if (net.render && c) p.in = [net.curX || 0, net.curY || 0, net.pc, net.dc, net.dd, net.seq];
    send(p);
  }

  function guestReadInput(c) {
    var kb = c.keyboardArray, k0 = kb[0], k1 = kb[1];
    var x = k0.xDirection || k1.xDirection, y = k0.yDirection || k1.yDirection;
    if (k0.powerHit === 1 || k1.powerHit === 1) net.pc++;
    var d = k0.dashRequest || k1.dashRequest;
    if (d) { net.dc++; net.dd = d; }
    net.curX = x; net.curY = y;
    net.seq++;
    net.hist.push([net.seq, x]);
    if (net.hist.length > 40) net.hist.shift();
  }

  function setPl(p, a) {
    if (!Array.isArray(a)) return;
    p.x = num(a[0]); p.y = num(a[1]); p.state = num(a[2]); p.frameNumber = num(a[3]); p.divingDirection = num(a[4]);
    p.character = validCh(a[6]);
    p.isDashing = !!a[7]; p.yVelocity = num(a[8]);
    var tr = a[9];
    if (Array.isArray(tr)) { p.dashTrailX = [num(tr[0]), num(tr[2])]; p.dashTrailY = [num(tr[1]), num(tr[3])]; }
    else { p.dashTrailX = []; p.dashTrailY = []; }
  }

  function moveSpeed(ch) {
    var tu = window._pvAbilities && window._pvAbilities.tuning || {};
    return 6 + (ch === 'jolteon' ? (tu.joltSpeed || 0) : ch === 'mewtwo' ? (tu.mewtwoSpeed || 0) : 0);
  }

  function applySnap(c, s, fresh) {
    var ph = c.physics, b = ph.ball, g = c.view.game;
    setPl(ph.player1, s.p && s.p[0]);
    setPl(ph.player2, s.p && s.p[1]);
    // 擊球：用累計次數判斷，就算中間掉幀也不會漏掉擊球特效
    var hits = [num(s.p && s.p[0] && s.p[0][5]), num(s.p && s.p[1] && s.p[1][5])];
    if (!net.gHit) net.gHit = hits.slice();
    ph.player1.isCollisionWithBallHappened = fresh && hits[0] > net.gHit[0];
    ph.player2.isCollisionWithBallHappened = fresh && hits[1] > net.gHit[1];
    if (fresh) net.gHit = hits;

    var a = s.b || [];
    b.x = num(a[0]); b.y = num(a[1]); b.rotation = num(a[2]) | 0;
    b.punchEffectX = num(a[3]); b.punchEffectY = num(a[4]);
    b.punchEffectRadius = fresh ? num(a[5]) + (num(a[5]) > 0 ? 2 : 0) : b.punchEffectRadius;
    b.isPowerHit = !!a[6];
    b.previousX = num(a[7]); b.previousY = num(a[8]); b.previousPreviousX = num(a[9]); b.previousPreviousY = num(a[10]);
    b.xVelocity = num(a[11]); b.yVelocity = num(a[12]);
    ph.player1.isWinner = s.w === 1; ph.player2.isWinner = s.w === 2;

    if (Array.isArray(s.sc)) { c.scores[0] = num(s.sc[0]); c.scores[1] = num(s.sc[1]); }
    var scKey = c.scores[0] + ':' + c.scores[1];
    if (scKey !== net.gScores) { net.gScores = scKey; g.drawScoresToScoreBoards(c.scores); }

    // 畫面狀態
    if (s.st === 'startOfNewGame' && net.gState !== 'startOfNewGame') {
      try { c.audio.sounds.bgm.stop(); c.audio.sounds.bgm.play(); } catch (e) {}   // 先停再播：再來一局、或進場前本機在跑示範賽時才不會疊兩層
      var an0 = A(); if (an0) an0.set(null);
    }
    net.gState = s.st;
    var gv = !!s.gv;
    if (g.visible !== gv) g.visible = gv;
    var ms = num(s.ms);
    if (ms & 1) g.drawGameStartMessage(Math.max(1, num(s.fc)), c.frameTotal.startOfNewGame + 100);
    if (ms & 4) g.drawGameEndMessage(s.st === 'round' ? num(s.fc) : 60);
    g.messages.gameStart.visible = !!(ms & 1);
    g.messages.ready.visible = !!(ms & 2);
    g.messages.gameEnd.visible = !!(ms & 4);
    c.view.fadeInOut.setBlackAlphaTo(Math.max(0, Math.min(1, num(s.fa))));

    // 音效：計數器增加就播
    if (fresh && Array.isArray(s.so)) {
      if (!net.gSnd) net.gSnd = s.so.slice();
      var keys = ['pipikachu', 'pika', 'chu', 'flap'];
      for (var i = 0; i < 2; i++) for (var k = 0; k < 4; k++) {
        if (num(s.so[i * 4 + k]) > num(net.gSnd[i * 4 + k])) (i ? ph.player2 : ph.player1).sound[keys[k]] = true;
      }
      if (num(s.so[8]) > num(net.gSnd[8])) b.sound.powerHit = true;
      if (num(s.so[9]) > num(net.gSnd[9])) b.sound.ballTouchesGround = true;
      net.gSnd = s.so.slice();
      c.playSoundEffect();
    }

    // 技能狀態與事件
    var an = A();
    if (an && s.ab) an.set(s.ab);
    if (fresh && Array.isArray(s.ev)) {
      var maxId = 0;
      s.ev.forEach(function (e) {
        if (!Array.isArray(e)) return;
        var id = num(e[0]); maxId = Math.max(maxId, id);
        if (net.evBase || id <= net.gEv || !EV_TYPES[e[1]]) return;
        var o = e[2];
        if (!o || typeof o !== 'object' || Array.isArray(o)) return;
        var d = {};
        Object.keys(o).forEach(function (key) {
          if (key === 'pl' || key === '__proto__' || key === 'constructor') return;
          var v = o[key];
          d[key] = typeof v === 'string' && /^[A-Za-z]{1,8}$/.test(v) ? v : typeof v === 'boolean' ? v : num(v);
        });
        if ('pl' in o) d.player = o.pl ? ph.player2 : ph.player1;
        if (typeof o.red === 'boolean') d.red = o.red;
        if (window._pvFxEvent) window._pvFxEvent(e[1], d);
      });
      net.gEv = Math.max(net.gEv, maxId);
    }
    if (fresh) net.evBase = false;
  }

  function predictSelf(c, s) {
    // 只預測左右移動；被定身、被減速、撲救中就不預測，直接用房主的位置
    if (net.hostRole !== 'player' || !s.p || !s.p[1]) return;
    var p = c.physics.player2, st = s.p[1][2];
    var ab = s.ab && s.ab.s && s.ab.s.p2 || {};
    if (st > 2 || ab.stunTimer > 0 || ab.slowTimer > 0 || ab.reverseTimer > 0 || ab.zipT > 0) return;
    var ack = net.lastAck || 0, sum = 0, n = 0;
    for (var i = net.hist.length - 1; i >= 0 && n < 8; i--) {
      if (net.hist[i][0] <= ack) break;
      sum += net.hist[i][1]; n++;
    }
    if (!n) return;
    var x = p.x + sum * moveSpeed(p.character);
    if (x < 248) x = 248; if (x > 400) x = 400;
    if (Math.abs(x - p.x) < 60) p.x = x;
  }

  var guestErrs = 0;
  function guestFrame(c) {
    try { guestFrameInner(c); }
    catch (e) {
      // 收到壞資料也不能讓遊戲迴圈死掉：丟掉這一幀，繼續下一幀
      if (guestErrs++ < 5 && window.console) console.warn('[netplay] bad snapshot ignored', e);
      net.last = null;
    }
  }
  function guestFrameInner(c) {
    guestReadInput(c);
    guestSend();
    var jn = J(); if (jn) jn.guestTick(c);
    var s = null, fresh = false;
    if (net.queue.length) {
      while (net.queue.length > 2) net.queue.shift();   // 落後太多就追上，最多緩衝 2 幀
      var qi = net.queue.shift(); s = qi.s; net.lastAck = qi.ack; fresh = true; net.extrap = 0; net.last = s;
    } else s = net.last;
    if (!s || typeof s !== 'object') return;
    applySnap(c, s, fresh);
    var b = c.physics.ball;
    if (!fresh && s.st === 'round' && !s.sm && !s.hz && net.extrap < 2) {
      // 快照遲到：球照物理往前推一點，避免畫面卡住
      net.extrap++;
      for (var k = 0; k < net.extrap; k++) {
        b.x += b.xVelocity; b.y += b.yVelocity; b.yVelocity += 1;
        if (b.y > 252) b.y = 252;
      }
    }
    predictSelf(c, s);
    var g = c.view.game;
    if (g.visible) {
      g.drawPlayersAndBall(c.physics);
      g.drawCloudsAndWave();
      var an = A(); if (an) { try { an.draw(c); } catch (e) { an.set({}); } }
    }
  }

  // ============================================================
  // 掛勾
  // ============================================================
  var innerTick = window._pvTick;
  window._pvTick = function (c) {
    if (net.render) { guestFrame(c); return false; }
    if (net.role === 'host' && net.phase === 'play') {
      // 對手斷線、自己斷線、或剛恢復的倒數中：物理停住，等大家都在再繼續
      if (net.paused || selfDown()) { net.ticked = true; return false; }
      if (net.resumeAt > now()) { net.ticked = true; return false; }
      hostInject(c);
      net.f++; net.ticked = true;
    } else if (net.role === 'host' && net.phase === 'end') {
      net.f++; net.ticked = true;
    }
    return innerTick ? innerTick(c) : undefined;
  };

  var hooked = false;
  function hookCtrl() {
    var c = ctrlOf();
    if (!c || hooked) return !!hooked;
    hooked = true;
    var loop = c.gameLoop;
    c.gameLoop = function () {
      loop.call(this);
      hostAfterLoop(this);
    };
    var pse = c.playSoundEffect;
    c.playSoundEffect = function () {
      if (net.role === 'host' && net.phase === 'play') hostCountSounds(this);
      return pse.call(this);
    };
    return true;
  }

  function init() {
    buildUI();
    wrapFx();
    var iv = setInterval(function () { if (hookCtrl()) clearInterval(iv); }, 300);
    window.addEventListener('pagehide', function () { if (net.room) try { net.room.leave(); } catch (e) {} });
    // 重新整理前在房間裡：直接把面板打開，讓玩家一鍵回去
    if (lastRoom()) setTimeout(openPanel, 800);
  }

  window.PV_Net = { state: net, open: openPanel, start: start, stop: stop, hostStart: hostStart };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
