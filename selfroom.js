// selfroom.js — 自架版的連線層（不依賴 claude.ai）
// 對 netplay.js 提供跟平台 room 一樣的介面：join(name) → { presence, peers, onPeers, onConnection, connected, leave }
//
// 三層防護：
//  1. WebRTC 資料通道（點對點直連，延遲最低）。不可靠模式：掉包不重傳，下一包直接蓋過去，不會卡。
//  2. 中繼：同時連上多個公開 MQTT 伺服器（WebSocket）。直連打不通（行動網路、公司防火牆）或斷掉時，
//     資料自動改走中繼；任何一個中繼伺服器掛了，立刻換下一個。配對（交換直連資訊）也是走這一層。
//  3. 自我修復：每一層各自自動重連（退避重試）；直連 4 秒沒收到資料就判定失效、退回中繼並在背景重建。
//     兩條路同時送心跳，接收端用序號去重，所以切換時不會漏也不會重複。
(function () {
  'use strict';
  if (!window.mqtt) return;

  var q = new URLSearchParams(location.search);
  var BROKERS = (q.get('brokers') || '').split(',').filter(Boolean);
  if (!BROKERS.length) BROKERS = (window.PV_BROKERS || [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ]);
  var NO_RTC = q.has('nortc') || !window.RTCPeerConnection;
  var ICE = window.PV_ICE || [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ];
  var PREFIX = 'pvu9x7';
  var me = Math.random().toString(36).slice(2, 12);
  function now() { return performance.now(); }

  // ------------------------------------------------------------
  // 中繼層：多個 MQTT 伺服器同時連線
  // ------------------------------------------------------------
  var clients = [], started = false, lobbyFns = [];
  var rooms = {};

  function anyBroker() { return clients.some(function (c) { return c.up; }); }
  function notifyConn() {
    lobbyFns.forEach(function (f) { try { f(lobby.connected()); } catch (e) {} });
    Object.keys(rooms).forEach(function (n) { rooms[n].connChanged(); });
  }

  function startBrokers() {
    if (started) return;
    started = true;
    BROKERS.forEach(function (url, i) {
      var c = { url: url, up: false, cl: null, idx: i };
      clients.push(c);
      try {
        c.cl = window.mqtt.connect(url, {
          clientId: 'pv_' + me + '_' + i, keepalive: 15, reconnectPeriod: 1500 + i * 400, connectTimeout: 8000,
          clean: true, resubscribe: true
        });
      } catch (e) { return; }
      c.cl.on('connect', function () {
        c.up = true;
        Object.keys(rooms).forEach(function (n) { rooms[n].subscribe(c); rooms[n].flush(true); });
        notifyConn();
      });
      var down = function () { if (c.up) { c.up = false; notifyConn(); } };
      c.cl.on('close', down); c.cl.on('offline', down);
      c.cl.on('error', function () {});
      c.cl.on('message', function (topic, payload) {
        var parts = topic.split('/');   // PREFIX / room / p|s / id
        if (parts[0] !== PREFIX) return;
        var R = rooms[parts[1]];
        if (!R) return;
        var msg;
        try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        if (!msg || typeof msg !== 'object') return;
        if (parts[2] === 'p' && parts[3] !== me) R.onPresence(parts[3], msg, 'relay');
        else if (parts[2] === 's' && parts[3] === me) R.onSignal(msg);
      });
    });
  }

  // 每個中繼都送：兩邊連得上的中繼不一定相同，只送一個的話對方可能完全收不到
  function pubRaw(topic, s) {
    clients.forEach(function (c) { if (c.up) { try { c.cl.publish(topic, s, { qos: 0 }); } catch (e) {} } });
  }
  function pubAll(topic, obj) { pubRaw(topic, JSON.stringify(obj)); }

  // ------------------------------------------------------------
  // 房間
  // ------------------------------------------------------------
  function makeRoom(name) {
    var R = {
      name: name, mine: {}, seq: 0, peers: {}, fns: [], cfns: [], dead: false,
      dirty: false, timer: 0, lastRelay: 0, pendingNotify: false, lastConn: null, iv: 0
    };
    var tp = PREFIX + '/' + name + '/p/', ts = PREFIX + '/' + name + '/s/';

    R.subscribe = function (c) { try { c.cl.subscribe([tp + '+', ts + me], { qos: 0 }); } catch (e) {} };

    function peerList() {
      var list = [Object.freeze({ peer: me, presence: R.mine, updatedAt: Date.now(), isMe: true, sameTab: true, kind: 'viewer', guest: false, by: null })];
      Object.keys(R.peers).forEach(function (k) { var p = R.peers[k]; if (p.pub) list.push(p.pub); });
      return list;
    }
    function notify() {
      if (R.pendingNotify || R.dead) return;
      R.pendingNotify = true;
      requestAnimationFrame(function () {
        R.pendingNotify = false;
        if (R.dead) return;
        var l = peerList();
        R.fns.forEach(function (f) { try { f({ peers: l, joined: [], left: [], updated: l }); } catch (e) {} });
      });
    }

    function getPeer(id) {
      var p = R.peers[id];
      if (!p) {
        p = R.peers[id] = { id: id, seq: -1, pub: null, seen: now(), pc: null, dc: null, dcOpen: false, dcSeen: 0, retryAt: 0, tries: 0, via: 'relay' };
        if (!NO_RTC && me < id) connectRtc(p);   // id 比較小的那一方負責發起直連
      }
      return p;
    }

    R.onPresence = function (id, msg, via) {
      if (R.dead || typeof id !== 'string' || id.length > 24) return;
      if (msg.bye) { dropPeer(id); notify(); return; }
      var p = getPeer(id);
      p.seen = now();
      if (via === 'dc') p.dcSeen = now();
      var n = +msg.n;
      if (!(n > p.seq) || !msg.p || typeof msg.p !== 'object') return;   // 兩條路都會收到：用序號去重，只收最新的
      p.seq = n; p.via = via;
      p.pub = Object.freeze({ peer: id, presence: Object.freeze(msg.p), updatedAt: Date.now(), isMe: false, sameTab: false, kind: 'viewer', guest: false, by: null });
      notify();
    };

    function dropPeer(id) {
      var p = R.peers[id];
      if (!p) return;
      closeRtc(p);
      delete R.peers[id];
    }

    // ---------- 直連（WebRTC） ----------
    function sig(to, d) { pubAll(ts + to, { from: me, d: d }); }

    function closeRtc(p) {
      p.dcOpen = false;
      try { if (p.dc) p.dc.close(); } catch (e) {}
      try { if (p.pc) p.pc.close(); } catch (e) {}
      p.dc = null; p.pc = null;
    }

    function wireDc(p, dc, pc) {
      p.dc = dc;
      dc.onopen = function () { if (p.pc === pc) { p.dcOpen = true; p.dcSeen = now(); p.tries = 0; R.flush(true); R.connChanged(); } };
      dc.onclose = function () { if (p.pc === pc) { p.dcOpen = false; scheduleRetry(p); R.connChanged(); } };
      dc.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m && typeof m === 'object') R.onPresence(p.id, m, 'dc');
      };
    }

    function newPc(p) {
      closeRtc(p);
      var pc = new RTCPeerConnection({ iceServers: ICE });
      p.pc = pc;
      pc.onicecandidate = function (e) { if (e.candidate && p.pc === pc) sig(p.id, { c: e.candidate }); };
      pc.onconnectionstatechange = function () {
        if (p.pc !== pc) return;
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { closeRtc(p); scheduleRetry(p); R.connChanged(); }
      };
      pc.ondatachannel = function (e) { if (p.pc === pc) wireDc(p, e.channel, pc); };
      return pc;
    }

    function connectRtc(p) {
      if (NO_RTC || R.dead || !anyBroker()) { scheduleRetry(p); return; }
      var pc = newPc(p);
      wireDc(p, pc.createDataChannel('g', { ordered: false, maxRetransmits: 0 }), pc);
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
        if (p.pc === pc) sig(p.id, { sdp: pc.localDescription });
      }).catch(function () { scheduleRetry(p); });
      // 12 秒內沒打通就放棄這一次，稍後再試（期間資料走中繼）
      setTimeout(function () { if (p.pc === pc && !p.dcOpen) { closeRtc(p); scheduleRetry(p); } }, 12000);
    }

    function scheduleRetry(p) {
      if (NO_RTC || !(me < p.id) || p.retryAt) return;
      p.tries++;
      p.retryAt = now() + Math.min(20000, 1000 * Math.pow(2, Math.min(p.tries, 5))) * (0.75 + Math.random() * 0.5);
    }

    R.onSignal = function (msg) {
      if (NO_RTC || R.dead || !msg.d || typeof msg.from !== 'string') return;
      var p = getPeer(msg.from), d = msg.d;
      p.seen = now();
      try {
        if (d.sdp && d.sdp.type === 'offer') {
          var pc = newPc(p);
          pc.setRemoteDescription(d.sdp).then(function () { return pc.createAnswer(); })
            .then(function (a) { return pc.setLocalDescription(a); })
            .then(function () { if (p.pc === pc) sig(p.id, { sdp: pc.localDescription }); }).catch(function () {});
        } else if (d.sdp && d.sdp.type === 'answer' && p.pc) {
          p.pc.setRemoteDescription(d.sdp).catch(function () {});
        } else if (d.c && p.pc) {
          p.pc.addIceCandidate(d.c).catch(function () {});
        }
      } catch (e) {}
    };

    // ---------- 送出 ----------
    R.flush = function (force) {
      if (R.dead) return;
      R.dirty = false;
      var s = JSON.stringify({ n: ++R.seq, p: R.mine });
      var ids = Object.keys(R.peers), needRelay = ids.length === 0;
      ids.forEach(function (id) {
        var p = R.peers[id];
        if (p.dcOpen && p.dc && p.dc.readyState === 'open') { try { p.dc.send(s); } catch (e) { needRelay = true; } }
        else needRelay = true;
      });
      // 沒有直連的對象走中繼；就算全部都直連，也每秒經中繼送一次（讓新加入的人看得到、直連斷掉時無縫接手）
      var t = now();
      if (needRelay || force || t - R.lastRelay > 1000) {
        R.lastRelay = t;
        pubRaw(tp + me, s);
      }
    };

    R.presence = function (patch) {
      if (R.dead) return Promise.reject({ code: 'invalid_argument', message: 'left' });
      var next = Object.assign({}, R.mine);
      for (var k in patch) { if (patch[k] === null) delete next[k]; else next[k] = patch[k]; }
      R.mine = next;
      R.dirty = true;
      if (!R.timer) R.timer = setTimeout(function () { R.timer = 0; if (R.dirty) R.flush(false); }, 30);
      return Promise.resolve();
    };

    // ---------- 維護：逾時、直連看門狗、重試 ----------
    R.iv = setInterval(function () {
      var t = now(), changed = false;
      Object.keys(R.peers).forEach(function (id) {
        var p = R.peers[id];
        if (t - p.seen > 8000) { dropPeer(id); changed = true; return; }
        if (p.dcOpen && t - p.dcSeen > 4000) { closeRtc(p); scheduleRetry(p); R.connChanged(); }   // 直連通道還開著但沒資料：當它壞了
        if (p.retryAt && t > p.retryAt && !p.pc) { p.retryAt = 0; connectRtc(p); }
      });
      if (changed) notify();
      if (t - R.lastRelay > 1000) R.flush(false);   // 心跳
    }, 500);

    R.connected = function () {
      if (R.dead) return false;
      if (anyBroker()) return true;
      return Object.keys(R.peers).some(function (id) { return R.peers[id].dcOpen; });
    };
    R.connChanged = function () {
      var c = R.connected();
      if (c === R.lastConn) return;
      R.lastConn = c;
      R.cfns.forEach(function (f) { try { f(c); } catch (e) {} });
    };
    R.info = function () {
      var ids = Object.keys(R.peers), direct = ids.filter(function (id) { return R.peers[id].dcOpen; }).length;
      var up = clients.filter(function (c) { return c.up; }).length;
      return (ids.length ? (direct === ids.length ? '直連' : direct ? '直連+中繼' : '中繼') : '等待') + ' · 中繼伺服器 ' + up + '/' + clients.length;
    };

    var api = {
      name: name,
      presence: R.presence,
      peers: peerList,
      onPeers: function (fn) { R.fns.push(fn); setTimeout(notify, 0); return function () { R.fns = R.fns.filter(function (f) { return f !== fn; }); }; },
      onConnection: function (fn) { R.cfns.push(fn); setTimeout(function () { try { fn(R.connected()); } catch (e) {} }, 0); return function () { R.cfns = R.cfns.filter(function (f) { return f !== fn; }); }; },
      connected: R.connected,
      info: R.info,
      leave: function () {
        if (R.dead) return Promise.resolve();
        pubAll(tp + me, { bye: 1 });
        R.dead = true;
        clearInterval(R.iv); clearTimeout(R.timer);
        Object.keys(R.peers).forEach(dropPeer);
        clients.forEach(function (c) { if (c.up) { try { c.cl.unsubscribe([tp + '+', ts + me]); } catch (e) {} } });
        if (rooms[name] === R) delete rooms[name];
        R.fns = []; R.cfns = [];
        return Promise.resolve();
      }
    };
    R.api = api;
    clients.forEach(function (c) { if (c.up) R.subscribe(c); });
    return R;
  }

  var lobby = {
    self: true,
    connected: function () { return anyBroker(); },
    onConnection: function (fn) { lobbyFns.push(fn); setTimeout(function () { try { fn(anyBroker()); } catch (e) {} }, 0); return function () {}; },
    join: function (name) {
      startBrokers();
      if (rooms[name]) return Promise.resolve(rooms[name].api);
      var R = rooms[name] = makeRoom(name);
      // 等任何一個中繼伺服器連上（最多 10 秒）
      return new Promise(function (res, rej) {
        var t0 = now();
        (function wait() {
          if (R.dead) return rej({ code: 'upstream_error', message: 'left' });
          if (anyBroker()) return res(R.api);
          if (now() - t0 > 10000) { R.api.leave(); return rej({ code: 'upstream_error', message: 'no relay reachable' }); }
          setTimeout(wait, 150);
        })();
      });
    }
  };

  window.addEventListener('pagehide', function () { Object.keys(rooms).forEach(function (n) { try { rooms[n].api.leave(); } catch (e) {} }); });
  // 測試用：故障注入
  window.__self = {
    me: me, clients: clients, rooms: rooms,
    killRtc: function () { Object.keys(rooms).forEach(function (n) { var R = rooms[n]; Object.keys(R.peers).forEach(function (id) { var p = R.peers[id]; try { p.pc && p.pc.close(); } catch (e) {} p.dcOpen = false; p.pc = null; p.dc = null; p.retryAt = now() + 3000; }); }); }
  };
  window.PV_SelfRoom = lobby;
})();
