// campaign.js — 闖關模式「冠軍之路」
// 依賴：characters.js、abilities.js、netplay.js（要在它們之後載入）、char-select.js（角色圖）
// 做法跟連線對戰的房主一樣：直接設定兩邊角色後把遊戲本體切到 startOfNewGame，
// 比賽結束時攔下來不回標題畫面，改顯示闖關的畫面。進度存在 localStorage。
(function () {
  'use strict';
  if (!window.PV_CHARS) return;
  var CH = window.PV_CHARS;
  var KEY = 'pv-campaign-v1';
  var W = 432, H = 304, NET_X = 216, FLOOR_Y = 270;

  // ============================================================
  // 可調整的數值（關卡、強度、魔王、演出長度）都集中在這裡
  // ============================================================
  var CFG = {
    hearts: 3,
    starters: ['pikachu', 'vaporeon', 'flareon', 'jolteon'],
    zones: [
      { name: '新手草原', tint: 0xFFFFFF, score: 5, fixed: ['magikarp', 'psyduck', 'snorlax'], c1: '#49b36a', c2: '#2a7350' },
      { name: '道館連戰', tint: 0xFFC79E, score: 5, pool: ['dugtrio', 'jigglypuff', 'wobbuffet', 'mrmime', 'meowth'], draw: 3, c1: '#e6933f', c2: '#a8502c' },
      { name: '強敵之塔', tint: 0x7F8EDC, score: 7, pool: ['farfetchd', 'gengar', 'electrode', 'bird'], draw: 2, last: 'dragonite', c1: '#4a61c9', c2: '#272f78' },
      { name: '最終戰', boss: true, c1: '#8a47d6', c2: '#3d1766' }
    ],
    // 第 1～10 關電腦的強度。move：腳步（1 = 全速）、spike：起跳後會殺球的機率、lapse：球飛過來時慢半拍的機率
    diff: [
      { move: 0.50, spike: 0.20, lapse: 0.60 },
      { move: 0.60, spike: 0.35, lapse: 0.50 },
      { move: 0.70, spike: 0.45, lapse: 0.40 },
      { move: 0.78, spike: 0.55, lapse: 0.35 },
      { move: 0.84, spike: 0.65, lapse: 0.30 },
      { move: 0.90, spike: 0.72, lapse: 0.25 },
      { move: 0.94, spike: 0.80, lapse: 0.18 },
      { move: 0.97, spike: 0.88, lapse: 0.12 },
      { move: 1.00, spike: 0.95, lapse: 0.06 },
      { move: 1.00, spike: 1.00, lapse: 0.00 }
    ],
    lapseFrames: 10,
    autoVs: 5000,                    // 贏了接下一關：VS 畫面停幾毫秒後自動開打（點一下畫面可取消）
    startFrames: 45,                 // 闖關時每場開場的幀數（遊戲本體原本是 71；VS 畫面已經演過一次開場了）
    // 分出勝負那一球的演出（幀）：stop 停格、之後打飛對手；hold 到了就進結算；skipAfter 之後按殺球鍵可跳過
    ko: { stop: 8, winHold: 42, loseHold: 30, bossBoom: 34, bossHold: 84, skipAfter: 20, bossSkipAfter: 64 },
    fullAcquire: 2,                  // 前幾次收服播完整版，之後播短版（超夢、百變怪、夢幻一律完整版）
    boss: {
      hp: 9, playerHp: 5, perPhase: 3,
      cooldown: [150, 100, 70],      // 各階段念力導向的冷卻（幀）
      speedEvery: [0, 0, 7],         // 第三階段：每幾幀多跑一幀（7 ≈ 全場快 14%）
      bgm: [1, 1.1, 1.22],           // 背景音樂播放速度
      tint: [0xB9A4EA, 0x6B50AA, 0x8E3C70],
      cutFrames: 50, cutMid: 25
    }
  };
  var ZONE_START = [], STAGES = 0;
  CFG.zones.forEach(function (z) {
    ZONE_START.push(STAGES);
    STAGES += z.boss ? 1 : (z.fixed ? z.fixed.length : 0) + (z.draw || 0) + (z.last ? 1 : 0);
  });
  function zoneIdx(i) { var z = 0; for (var k = 0; k < ZONE_START.length; k++) if (i >= ZONE_START[k]) z = k; return z; }
  function zoneOf(i) { return CFG.zones[zoneIdx(i)]; }
  function charName(id) { var c = CH.byId[id]; return c ? c.name : id; }

  // ============================================================
  // 存檔：進行中的一輪、獎章、收服的夥伴
  // ============================================================
  var save = { run: null, medals: {}, owned: {}, acq: 0, tutDone: 0 };
  function validRun(r) {
    if (!r || typeof r !== 'object' || !CH.byId[r.char] || !Array.isArray(r.order) || r.order.length !== STAGES) return false;
    for (var i = 0; i < r.order.length; i++) if (!CH.byId[r.order[i]]) return false;
    return r.idx >= 0 && r.idx < STAGES && r.hearts >= 1 && r.hearts <= CFG.hearts;
  }
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!o || typeof o !== 'object') return;
      CH.ids.forEach(function (id) {
        var m = o.medals && o.medals[id];
        if (m && m.n > 0) { save.medals[id] = { n: Math.floor(+m.n) || 1, frames: +m.frames || 0, lost: Math.max(0, Math.floor(+m.lost) || 0) }; save.owned[id] = 1; }
        if (o.owned && o.owned[id]) save.owned[id] = 1;
      });
      save.acq = Math.max(0, Math.floor(+o.acq) || 0);
      save.tutDone = o.tutDone ? 1 : 0;
      if (validRun(o.run)) {
        save.run = { char: o.run.char, order: o.run.order.slice(), idx: Math.floor(o.run.idx), hearts: Math.floor(o.run.hearts),
          bossPhase: Math.min(3, Math.max(1, Math.floor(+o.run.bossPhase) || 1)), frames: +o.run.frames || 0, lost: +o.run.lost || 0, live: o.run.live ? 1 : 0 };
        save.owned[save.run.char] = 1;
        abandon();                                  // 上次打到一半就關掉或重新整理
      }
    } catch (e) {}
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }

  function owned(id) { return CFG.starters.indexOf(id) >= 0 || !!save.owned[id]; }
  function ownedCount() { return CH.ids.filter(owned).length; }
  function medalCount() { return Object.keys(save.medals).length; }
  // 獎章分三級：金＝一場都沒輸、銀＝只輸 1 場、銅＝通關
  function tierOf(lost) { return lost <= 0 ? 3 : lost <= 1 ? 2 : 1; }
  function medalTier(id) { var m = save.medals[id]; return m ? tierOf(m.lost) : 0; }
  var TIER = [null, { name: '銅', color: '#D08A4A' }, { name: '銀', color: '#D5DEE6' }, { name: '金', color: '#FFD54F' }];
  function unlock(id) { if (owned(id)) return false; save.owned[id] = 1; return true; }
  // 百變怪：累積 3 面獎章；夢幻：一面金獎章，或 3 面銀以上
  function checkSpecial() {
    var got = [], silver = 0, gold = 0;
    Object.keys(save.medals).forEach(function (id) { var t = medalTier(id); if (t >= 2) silver++; if (t >= 3) gold++; });
    if (medalCount() >= 3 && unlock('ditto')) got.push('ditto');
    if ((gold >= 1 || silver >= 3) && unlock('mew')) got.push('mew');
    return got;
  }
  function howToGet(id) {
    if (id === 'ditto') return '累積 3 面獎章';
    if (id === 'mew') return '拿到一面金獎章（一場都沒輸地通關），或 3 面銀獎章';
    if (id === 'mewtwo') return '在最終戰打倒牠';
    for (var i = 0; i < CFG.zones.length; i++) {
      var z = CFG.zones[i], all = (z.fixed || []).concat(z.pool || [], z.last ? [z.last] : []);
      if (all.indexOf(id) >= 0) return '在「' + z.name + '」打倒牠';
    }
    return '';
  }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildOrder(char) {
    var order = [];
    CFG.zones.forEach(function (z) {
      if (z.boss) { order.push('mewtwo'); return; }
      if (z.fixed) order = order.concat(z.fixed);
      if (z.pool) {
        // 不抽到跟自己一樣的；還沒收服的優先
        var pool = shuffle(z.pool.filter(function (id) { return id !== char; }));
        pool.sort(function (a, b) { return (owned(a) ? 1 : 0) - (owned(b) ? 1 : 0); });
        order = order.concat(shuffle(pool.slice(0, z.draw)));
      }
      if (z.last) order.push(z.last);
    });
    for (var i = 0; i < order.length - 1; i++) {
      if (order[i] !== char) continue;
      var free = function (id) { return id !== char && order.indexOf(id) < 0; };
      var spare = shuffle((zoneOf(i).pool || []).filter(free));
      if (!spare.length) spare = shuffle(CFG.starters.filter(free));
      spare.sort(function (a, b) { return (owned(a) ? 1 : 0) - (owned(b) ? 1 : 0); });
      if (spare.length) order[i] = spare[0];
    }
    return order;
  }
  // 輸一場：敗場 +1、扣一顆心；心用完就補滿並退回區首（超夢則回到第一階段）。回傳是不是心用完了
  function applyLoss(run) {
    var boss = !!zoneOf(run.idx).boss;
    run.lost++;
    run.hearts--;
    if (run.hearts > 0) return false;
    run.hearts = CFG.hearts;
    if (boss) run.bossPhase = 1; else run.idx = ZONE_START[zoneIdx(run.idx)];
    return true;
  }
  // 打到一半就離開（暫停離開、按重來、重新整理）：跟輸掉一樣算，不然落後就離開反而划算
  function abandon() {
    var run = save.run;
    if (!run || !run.live) return;
    run.live = 0;
    applyLoss(run);
    persist();
  }
  function newRun(char) {
    save.run = { char: char, order: buildOrder(char), idx: 0, hearts: CFG.hearts, bossPhase: 1, frames: 0, lost: 0 };
    persist();
  }

  // ============================================================
  // 狀態
  // ============================================================
  function newAi() { return { acc: 0, freeze: 0, mine: false, noSpike: false }; }
  var camp = {
    playing: false,     // 闖關模式接管遊戲中（比賽中或兩關之間）
    waiting: false,     // 兩關之間：場上停在結算，等玩家按下一步
    wantStart: false,   // 遊戲本體還沒載好，載好就開打
    opp: '', diff: null, proxy: null, ai1: newAi(), ai2: newAi(),
    prevState: null, saved: null, tuneOrig: null,
    boss: null, tut: 0, speedEvery: 0, spd: 0, tick: 0, ko: null,
    autoVs: false, view: '', pick: null, lastRun: null, lose: null, travelFrom: null, toast: '', onFinish: null
  };
  function ctrlOf() { return window._pv && window._pv.ctrl; }
  function AB() { return window._pvAbilities; }
  function netBusy() { var n = window.PV_Net && window.PV_Net.state; return !!(n && (n.phase !== 'off' || n.render)); }
  function ensureGame() {
    if (ctrlOf()) return;
    var box = document.getElementById('about-box'), btn = document.getElementById('close-about-btn');
    if (box && btn && !box.classList.contains('hidden')) btn.click();
  }

  function setTuning(o) {
    var a = AB(); if (!a) return;
    camp.tuneOrig = camp.tuneOrig || {};
    for (var k in o) { if (!(k in camp.tuneOrig)) camp.tuneOrig[k] = a.tuning[k]; a.tuning[k] = o[k]; }
  }
  function restoreTuning() {
    var a = AB(); if (!a || !camp.tuneOrig) { camp.tuneOrig = null; return; }
    for (var k in camp.tuneOrig) a.tuning[k] = camp.tuneOrig[k];
    camp.tuneOrig = null;
  }
  function setTint(c, hex) {
    try {
      var g = c.view.game;
      [g.bgContainer, g.cloudContainer, g.waveContainer].forEach(function (ct) {
        if (ct && ct.children) ct.children.forEach(function (sp) { sp.tint = hex; });
      });
    } catch (e) {}
  }
  function mix(a, b, k) {
    var r = Math.round(((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * k),
        g = Math.round(((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * k),
        bl = Math.round((a & 255) + ((b & 255) - (a & 255)) * k);
    return (r << 16) | (g << 8) | bl;
  }
  function setBgmSpeed(c, v) {
    try { var b = c.audio.sounds.bgm; [b.center, b.left, b.right].forEach(function (s) { if (s) s.speed = v; }); } catch (e) {}
  }
  function scoreBoards(c, on) { try { c.view.game.scoreBoards[0].visible = on; c.view.game.scoreBoards[1].visible = on; } catch (e) {} }
  // 打飛對手時動過的東西（旋轉、影子、染色）還原
  function resetSprites(c) {
    try {
      var g = c.view.game;
      g.player2.rotation = 0; g.player2.tint = 0xFFFFFF; g.player1.tint = 0xFFFFFF;
      g.shadows.forPlayer2.visible = true;
    } catch (e) {}
  }
  function waitState() { this.view.game.drawCloudsAndWave(); }

  // ============================================================
  // 合成音效（Web Audio）：只用在闖關的演出，跟著選單的音效開關
  // ============================================================
  var ac = null, master = null;
  function audio() {
    if (ac) return ac;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ac = new AC(); master = ac.createGain(); master.gain.value = 0.22; master.connect(ac.destination); } catch (e) { ac = null; }
    return ac;
  }
  function sfxOn() {
    if (window._pvSim || document.hidden) return false;
    var c = ctrlOf(), s = c && c.audio && c.audio.sounds && c.audio.sounds.pika;
    if (s && s.volume === 0) return false;
    var a = audio();
    if (a && a.state === 'suspended') { try { a.resume(); } catch (e) {} }
    return !!a && a.state === 'running';
  }
  function tone(type, f0, f1, at, dur, vol) {
    var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + 0.01 + at;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function notes(type, list, step, dur, vol, at) { list.forEach(function (f, i) { tone(type, f, f, (at || 0) + i * step, dur, vol); }); }
  function sfx(name) {
    if (!sfxOn()) return;
    try {
      if (name === 'ko') { tone('sine', 150, 40, 0, 0.35, 1); tone('square', 880, 220, 0, 0.12, 0.25); notes('square', [523, 659, 784, 1047], 0.07, 0.14, 0.3, 0.32); }
      else if (name === 'lose') notes('triangle', [392, 330, 262, 196], 0.14, 0.26, 0.5);
      else if (name === 'vs') { tone('sine', 110, 45, 0, 0.3, 1); tone('sawtooth', 300, 80, 0, 0.14, 0.25); }
      else if (name === 'step') notes('square', [660, 880], 0.07, 0.07, 0.2);
      else if (name === 'tick') tone('square', 990, 990, 0, 0.04, 0.15);
      else if (name === 'get') { notes('square', [659, 784, 988, 1319], 0.08, 0.16, 0.3); notes('triangle', [1319, 1568, 2093], 0.06, 0.2, 0.25, 0.36); }
      else if (name === 'stamp') { tone('sine', 180, 50, 0, 0.3, 1); tone('square', 1200, 300, 0, 0.08, 0.3); }
      else if (name === 'fanfare') { notes('square', [523, 523, 523, 659, 784, 659, 784, 1047], 0.13, 0.2, 0.3); notes('triangle', [262, 262, 330, 392, 523], 0.26, 0.4, 0.4); }
      else if (name === 'hit') { tone('square', 260, 90, 0, 0.14, 0.35); tone('sine', 120, 50, 0, 0.18, 0.8); }
      else if (name === 'hurt') tone('sawtooth', 180, 60, 0, 0.22, 0.4);
      else if (name === 'phase') { tone('sawtooth', 80, 320, 0, 0.6, 0.4); tone('sine', 60, 30, 0.55, 0.5, 1); }
    } catch (e) {}
  }
  function cry(id) {
    if (!sfxOn()) return;
    try {
      var s = ctrlOf().audio.sounds, snd = s['CHAR_' + id + '_call'] || (id === 'bird' ? s.birdShout : s.pipikachu);
      if (snd) snd.play(0);
    } catch (e) {}
  }

  // ============================================================
  // 開打／結束／離開
  // ============================================================
  function startMatch() {
    var run = save.run;
    if (!run) return;
    if (netBusy()) { camp.toast = '先離開連線房間，才能闖關。'; go('vs'); return; }
    var c = ctrlOf();
    if (!c) { ensureGame(); camp.wantStart = true; render(); return; }
    hookCtrl();
    camp.wantStart = false;
    var ph = c.physics, p1 = ph.player1, p2 = ph.player2, idx = run.idx, z = zoneOf(idx);
    if (!camp.saved) camp.saved = { c1: p1.character, c2: p2.character, k1: p1.isComputer, k2: p2.isComputer, win: c.winningScore, practice: !!c.isPracticeMode, startFrames: c.frameTotal.startOfNewGame };
    abandon();                                      // 保險：上一場沒打完的話先結算
    idx = run.idx; z = zoneOf(idx);
    run.live = 1; persist();
    camp.opp = run.order[idx];
    p1.character = run.char; p2.character = camp.opp;
    p1.isComputer = !!camp.proxy; p2.isComputer = true;
    if (c.isPracticeMode) c.isPracticeMode = false;
    c.winningScore = z.boss ? CFG.boss.hp : z.score;
    c.frameTotal.startOfNewGame = CFG.startFrames;
    c.paused = false;
    c.slowMotionFramesLeft = 0;
    c.view.intro.visible = false;
    c.view.menu.visible = false;
    c.frameCounter = 0;
    c.noInputFrameCounter = 0;
    c.view.game.visible = false;                     // 關掉再開，上一場的訊息才會收起來
    try { c.audio.sounds.bgm.stop(); } catch (e) {}
    c.state = c.startOfNewGame;

    camp.playing = true; camp.waiting = false; camp.ko = null; camp.prevState = null;
    camp.diff = CFG.diff[idx]; camp.ai1 = newAi(); camp.ai2 = newAi();
    camp.boss = null; camp.tut = 0; camp.speedEvery = 0; camp.spd = 0;
    restoreTuning();
    resetSprites(c);
    setBgmSpeed(c, 1);
    if (z.boss) {
      camp.boss = { phase: run.bossPhase || 1, init: true, pending: 0, cut: 0, next: 0, flash: 0, hit: 0, hurt: 0, s0: -1, s1: -1 };
      applyPhase(c, camp.boss.phase, false);
      scoreBoards(c, false);
    } else {
      setTint(c, z.tint);
      scoreBoards(c, true);
    }
    // 第一關是教學：鯉魚王不會隨機進化，玩家拿到 3 分時固定進化一次給他看
    if (idx === 0 && camp.opp === 'magikarp' && !save.tutDone) {
      camp.tut = 1;
      setTuning({ magikarpEvolveChance: 0, magikarpReceiveEvolve: 0 });
    }
    hide(true);
  }

  function finish(c) {
    var run = save.run, win = !!c.physics.player1.isWinner, boss = !!camp.boss, opp = camp.opp, sc = c.scores.slice();
    camp.waiting = true;
    run.live = 0;
    c.state = waitState;
    restoreTuning(); camp.speedEvery = 0; camp.tut = 0; setBgmSpeed(c, 1);
    var steps = [], after;
    if (win) {
      if (run.idx === 0) save.tutDone = 1;
      var got = unlock(opp), full = save.acq < CFG.fullAcquire || opp === 'mewtwo' || opp === 'dragonite';
      if (got) save.acq++;
      if (run.idx >= STAGES - 1) {
        var m = save.medals[run.char], rec = !!m && (run.lost < m.lost || (run.lost === m.lost && run.frames < m.frames));
        m = m || { n: 0, frames: 0, lost: 99 };
        m.n++;
        if (run.lost < m.lost || (run.lost === m.lost && (!m.frames || run.frames < m.frames))) { m.lost = run.lost; m.frames = run.frames; }
        save.medals[run.char] = m;
        camp.lastRun = run;
        save.run = null;
        var extra = checkSpecial();
        if (got) steps.push(function (next) { playAcquire(opp, true, next); });
        steps.push(function (next) { playClear(run, rec, next); });
        extra.forEach(function (id) { steps.push(function (next) { playAcquire(id, true, next); }); });
        after = function () {
          var fresh = CH.ids.filter(function (id) { return owned(id) && !save.medals[id]; });
          camp.pick = fresh.length ? fresh[0] : run.char;
          go('pick');
        };
      } else {
        run.idx++;
        run.bossPhase = 1;
        if (got) steps.push(function (next) { playAcquire(opp, full, next); });
        if (zoneIdx(run.idx) !== zoneIdx(run.idx - 1)) camp.toast = '進入「' + zoneOf(run.idx).name + '」';
        after = function () { camp.travelFrom = run.idx - 1; camp.autoVs = true; go('vs'); };
      }
    } else {
      var L = camp.lose = { opp: opp, sc: sc, boss: boss, out: false, from: run.idx, need: boss ? CFG.boss.hp : zoneOf(run.idx).score };
      L.out = applyLoss(run);
      after = function () { go('lose'); };
    }
    persist();
    if (camp.onFinish) { try { camp.onFinish(win); } catch (e) {} }
    if (window._pvSim) return;
    (function runSteps(i) { if (i < steps.length) steps[i](function () { runSteps(i + 1); }); else after(); })(0);
  }

  // 離開闖關模式：把角色、分數設定、場地都還原。restart：順便把遊戲本體送回標題畫面
  function suspend(c, restart) {
    if (!camp.playing) return;
    if (!camp.waiting && save.run && save.run.live) {
      if (camp.ko && camp.ko.win) { save.run.live = 0; persist(); } else abandon();
    }
    camp.playing = false; camp.waiting = false; camp.boss = null; camp.tut = 0; camp.speedEvery = 0; camp.wantStart = false; camp.ko = null;
    restoreTuning();
    if (c) {
      setTint(c, 0xFFFFFF);
      setBgmSpeed(c, 1);
      resetSprites(c);
      var s = camp.saved;
      if (s) {
        c.physics.player1.character = s.c1; c.physics.player2.character = s.c2;
        c.physics.player1.isComputer = s.k1; c.physics.player2.isComputer = s.k2;
        c.winningScore = s.win;
        c.frameTotal.startOfNewGame = s.startFrames;
        c.isPracticeMode = s.practice;       // setter 會順便把計分板顯示還原
      } else scoreBoards(c, true);
      if (restart) c.restart();
    }
    camp.saved = null;
    clearHud();
  }

  // ============================================================
  // 每幀（在所有其他掛勾之前）
  // ============================================================
  function pre(c) {
    var run = save.run;
    if (netBusy()) { suspend(c, false); hide(); return; }
    camp.tick++;
    if (camp.waiting || !run) { drawHud(c); return; }
    var ph = c.physics, p1 = ph.player1, p2 = ph.player2, k0 = c.keyboardArray[0], k1 = c.keyboardArray[1];
    // 比賽中從角色面板換角色不算數（百變怪自己會變身，不管它）
    if (run.char !== 'ditto' && p1.character !== run.char) p1.character = run.char;
    if (p2.character !== camp.opp) p2.character = camp.opp;
    p1.isComputer = !!camp.proxy; p2.isComputer = true;
    if (!camp.proxy) {
      // 兩組按鍵（和兩邊的觸控）都能控制自己
      if (!k0.xDirection) k0.xDirection = k1.xDirection;
      if (!k0.yDirection) k0.yDirection = k1.yDirection;
      if (k1.powerHit === 1) k0.powerHit = 1;
      if (!k0.dashRequest && k1.dashRequest) k0.dashRequest = k1.dashRequest;
    }
    // 開新一場的頭一幀，分數和 gameEnded 還是上一場留下來的，所以下面這些只在對打中才看
    var live = c.state === c.round;
    if (live && !c.gameEnded) run.frames++;
    if (camp.tut && live) tutorial(c);
    if (camp.boss && bossTick(c, live) === false) { drawHud(c); return false; }
    if (live && c.gameEnded) {
      var K = CFG.ko, k = camp.ko;
      if (!k) {
        var bw = !!p1.isWinner;
        k = camp.ko = { t: 0, win: bw, boss: !!camp.boss, x: c.physics.ball.punchEffectX || (bw ? 330 : 100), px: p2.x, py: p2.y, isNew: !owned(camp.opp), idx: run.idx, tint0: camp.boss ? CFG.boss.tint[camp.boss.phase - 1] : 0 };
        sfx(bw ? 'ko' : 'lose');
      }
      k.t++;
      if (k.win && k.t <= K.stop) { drawHud(c); return false; }      // 停格
      var hold = !k.win ? K.loseHold : k.boss ? K.bossHold : K.winHold;
      if (k.t >= hold || (k.t > (k.boss && k.win ? K.bossSkipAfter : K.skipAfter) && !camp.proxy && (k0.powerHit === 1 || k1.powerHit === 1))) finish(c);
    }
    camp.prevState = c.state;
    drawHud(c);
  }

  // 物理和遊戲本體畫完之後：把被打倒的對手打飛（直接動畫面上的那張圖）
  function post(c) {
    var g = c.view.game, k = camp.ko, b = camp.boss;
    if (b) {
      try { g.player2.tint = b.hit > 0 && b.hit % 4 < 2 ? 0xFF6060 : 0xFFFFFF; g.player1.tint = b.hurt > 0 && b.hurt % 4 < 2 ? 0xFF6060 : 0xFFFFFF; } catch (e) {}
    }
    if (!k) return;
    try {
      g.messages.gameEnd.visible = false;            // 「Game Set」換成自己的勝利／落敗字樣
      if (!k.win) return;
      var K = CFG.ko, t = k.t - K.stop - (k.boss ? K.bossBoom : 0), sp = g.player2;
      if (k.boss && t <= 0) { sp.x = k.px + (k.t % 2 ? 3 : -3); sp.y = k.py; return; }   // 超夢先原地連環爆炸
      if (t > 0) {
        sp.x = k.px + t * 7; sp.y = k.py - t * 12; sp.rotation = t * 0.7;
        g.shadows.forPlayer2.visible = false;
        if (k.boss) setTint(c, mix(k.tint0, 0xFFFFFF, Math.min(1, t / 20)));             // 天色放晴
      }
    } catch (e) {}
  }

  function tutorial(c) {
    var a = AB(); if (!a) return;
    var s2 = a.state().p2 || {};
    if (camp.tut === 1 && c.scores[0] >= 3) { a.tuning.magikarpEvolveChance = 1; camp.tut = 2; }
    else if (camp.tut === 2 && s2.isGyarados) { a.tuning.magikarpEvolveChance = 0; camp.tut = 3; }
  }

  // ---------- 超夢 ----------
  function applyPhase(c, phase, withFx) {
    var B = CFG.boss, b = camp.boss;
    b.phase = phase;
    setTuning({ psychicCooldown: B.cooldown[phase - 1] });
    camp.speedEvery = B.speedEvery[phase - 1]; camp.spd = 0;
    setTint(c, B.tint[phase - 1]);
    setBgmSpeed(c, B.bgm[phase - 1]);
    if (withFx) {
      b.flash = 6;
      var p2 = c.physics.player2;
      try { if (window._pvFxEvent) window._pvFxEvent('skill', { player: p2, lvl: 4, x: p2.x, y: p2.y, k: 'psy' }); } catch (e) {}
    }
  }
  function bossTick(c, live) {
    var B = CFG.boss, b = camp.boss, run = save.run, ph = c.physics;
    scoreBoards(c, false);
    // 從第 2、3 階段重打：超夢的血從那個階段開始算
    if (b.init && c.state === c.startOfNewGame && c.frameCounter >= 1) { c.scores[0] = (b.phase - 1) * B.perPhase; b.init = false; b.s0 = c.scores[0]; b.s1 = 0; }
    if (b.cut > 0) {
      b.cut--;
      if (b.cut === B.cutMid) applyPhase(c, b.next, true);
      return false;                              // 演出中整個遊戲停住
    }
    if (b.hit > 0) b.hit--;
    if (b.hurt > 0) b.hurt--;
    if (live && !b.init) {
      // 扣血的回饋
      if (c.scores[0] > b.s0) { b.hit = 12; b.hitFrom = b.s0; b.s0 = c.scores[0]; if (c.scores[0] < B.hp) sfx('hit'); }
      if (c.scores[1] > b.s1) { b.hurt = 12; b.s1 = c.scores[1]; if (c.scores[1] < B.playerHp) sfx('hurt'); }
    }
    if (live && !b.init && !c.gameEnded) {
      // 玩家的血打完：遊戲本體只會看 winningScore，所以自己判定結束
      if (c.scores[1] >= B.playerHp) {
        c.gameEnded = true;
        ph.player1.isWinner = false; ph.player2.isWinner = true;
        ph.player1.gameEnded = true; ph.player2.gameEnded = true;
        return;
      }
      var np = Math.min(3, Math.floor(c.scores[0] / B.perPhase) + 1);
      if (np > b.phase && !b.pending) b.pending = np;
      // 換階段的演出放在下一球發球前
      if (b.pending && camp.prevState === c.beforeStartOfNextRound) {
        b.next = b.pending; b.pending = 0; b.cut = B.cutFrames;
        run.bossPhase = b.next; persist();       // 超夢每個階段都是檢查點
        sfx('phase');
        return false;
      }
    }
  }

  // ---------- 電腦強度：在遊戲本體和角色 AI 決定好按鍵之後，再依關卡把它調弱 ----------
  var innerAI = window._pvAI;
  window._pvAI = function (player, ball, opp, input) {
    if (innerAI) innerAI(player, ball, opp, input);
    if (!camp.playing || camp.waiting || !player.isComputer) return;
    var d = player.isPlayer2 ? camp.diff : camp.proxy, m = player.isPlayer2 ? camp.ai2 : camp.ai1;
    if (!d) return;
    var mine = player.isPlayer2 ? ball.x >= NET_X : ball.x < NET_X;
    if (mine && !m.mine && Math.random() < d.lapse) m.freeze = CFG.lapseFrames;     // 球剛飛過來：慢半拍
    m.mine = mine;
    if (m.freeze > 0) { m.freeze--; input.xDirection = 0; input.yDirection = 0; input.powerHit = 0; return; }
    if (player.state === 0) {
      if (input.xDirection !== 0) { m.acc += d.move; if (m.acc >= 1) m.acc -= 1; else input.xDirection = 0; }   // 腳步變慢
      m.noSpike = Math.random() > d.spike;                                                                      // 這一跳殺不殺
    } else if (player.state === 1 && m.noSpike) input.powerHit = 0;
  };

  var innerTick = window._pvTick;
  window._pvTick = function (c) {
    if (camp.playing && pre(c) === false) return false;
    return innerTick ? innerTick(c) : undefined;
  };

  var hooked = false;
  function hookCtrl() {
    var c = ctrlOf();
    if (!c || hooked) return hooked;
    hooked = true;
    var loop = c.gameLoop;
    c.gameLoop = function () {
      loop.call(this);
      if (camp.playing && !camp.waiting) {
        // 超夢第三階段：每隔幾幀多跑一幀，全場變快
        if (camp.speedEvery && this.state === this.round && !this.paused && !this.gameEnded &&
            !(camp.boss && camp.boss.cut > 0) && ++camp.spd >= camp.speedEvery) { camp.spd = 0; loop.call(this); }
        // 玩家按了選單的「重來」之類：遊戲本體自己回到標題，闖關就先收起來（進度還在）
        if (camp.playing && !camp.waiting && (this.state === this.intro || this.state === this.menu)) suspend(this, false);
      }
      if (camp.playing) post(this);
    };
    return true;
  }

  // ============================================================
  // 場上的抬頭顯示（心、關卡、超夢血條）和打倒演出
  // ============================================================
  var hud = null, hctx = null, hudRect = '';
  function syncHud() {
    if (window._pvSim) return false;
    var gc = document.getElementById('game-canvas');
    if (!gc || !document.body) return false;
    if (!hud) {
      hud = document.createElement('canvas');
      hud.id = 'pv-camp-hud';
      hud.style.cssText = 'position:fixed;pointer-events:none;z-index:46;';
      document.body.appendChild(hud);
      hctx = hud.getContext('2d');
    }
    var r = window._pvBaseRect ? window._pvBaseRect(gc) : gc.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var dpr = window.devicePixelRatio || 1, key = [r.left, r.top, r.width, r.height, dpr].join(',');
    if (key !== hudRect) {
      hudRect = key;
      hud.style.left = r.left + 'px'; hud.style.top = r.top + 'px';
      hud.style.width = r.width + 'px'; hud.style.height = r.height + 'px';
      hud.width = Math.round(r.width * dpr); hud.height = Math.round(r.height * dpr);
    }
    hctx.setTransform(hud.width / W, 0, 0, hud.height / H, 0, 0);
    return true;
  }
  function clearHud() { if (hud && hctx) { hctx.setTransform(1, 0, 0, 1, 0, 0); hctx.clearRect(0, 0, hud.width, hud.height); } }
  window.addEventListener('resize', function () { hudRect = ''; });

  function heart(g, x, y, s, on) {
    g.beginPath();
    g.moveTo(x, y + s * 0.9);
    g.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.8, y - s * 1.1, x, y - s * 0.35);
    g.bezierCurveTo(x + s * 0.8, y - s * 1.1, x + s * 1.5, y - s * 0.1, x, y + s * 0.9);
    g.closePath();
    g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    g.fillStyle = on ? '#FF3B5C' : 'rgba(255,255,255,0.28)'; g.fill();
  }
  var FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
  function label(g, text, x, y, size, color, align) {
    g.font = '900 ' + size + 'px ' + FONT;
    g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(2, size / 4); g.strokeStyle = '#000';
    g.strokeText(text, x, y);
    g.fillStyle = color || '#fff'; g.fillText(text, x, y);
  }
  function bar(g, x, y, w, h, n, left, color, fromRight, flashFrom, flashK) {
    var gap = 2, sw = (w - gap * (n - 1)) / n;
    g.fillStyle = '#000'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
    for (var i = 0; i < n; i++) {
      var on = fromRight ? i >= n - left : i < left;
      g.fillStyle = on ? color : 'rgba(255,255,255,0.16)';
      g.fillRect(x + i * (sw + gap), y, sw, h);
      if (on) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + i * (sw + gap), y, sw, h * 0.35); }
      // 剛被打掉的那幾格：白閃後往下掉
      var was = fromRight ? i >= n - flashFrom : i < flashFrom;
      if (!on && was && flashK > 0) { g.globalAlpha = flashK; g.fillStyle = '#fff'; g.fillRect(x + i * (sw + gap), y + (1 - flashK) * 10, sw, h); g.globalAlpha = 1; }
    }
  }
  var CONF = ['#FFD54F', '#FF5A7A', '#4FC3F7', '#81C784', '#FFFFFF', '#BA68C8'];
  function confetti(g, t, n) {
    for (var i = 0; i < n; i++) {
      var x = (i * 53 + Math.sin((t + i * 7) / 9) * 12 + 600) % W, y = ((t * (2.4 + (i % 4) * 0.7) + i * 41) % (H + 30)) - 20;
      g.save(); g.translate(x, y); g.rotate((t + i * 13) / (5 + (i % 3)));
      g.fillStyle = CONF[i % CONF.length]; g.fillRect(-3, -1.5, 6, 3); g.restore();
    }
  }
  function star4(g, x, y, r, color) {
    g.fillStyle = color; g.beginPath();
    for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, rr = i % 2 ? r * 0.3 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }
  // 「砸下來」的大字：先放大再彈回原本大小
  function slam(g, text, x, y, size, color, age) {
    var k = age < 4 ? 1 + (4 - age) * 0.5 : 1 + Math.max(0, 7 - age) * 0.03;
    g.save(); g.translate(x + (age >= 4 && age < 9 ? (age % 2 ? 2 : -2) : 0), y); g.transform(1, 0, -0.14, 1, 0, 0);
    label(g, text, 0, 0, size * k, color); g.restore();
  }

  function drawKo(c, g, lite) {
    var k = camp.ko, K = CFG.ko, t = k.t;
    if (!k.win) {
      g.globalAlpha = Math.min(0.42, t / 20); g.fillStyle = '#1b2233'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
      if (t > 3) slam(g, '落敗…', NET_X, 112, 34, '#B0BEC5', t - 3);
      return;
    }
    if (t <= K.stop) {
      // 停格：白閃、落點衝擊波、放射線
      if (!lite) { g.globalAlpha = 0.7 * (1 - t / K.stop); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
      g.strokeStyle = '#fff'; g.lineWidth = 4; g.globalAlpha = 1 - t / (K.stop + 2);
      g.beginPath(); g.ellipse(k.x, FLOOR_Y, t * 16, t * 5, 0, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 2;
      for (var i = 0; i < 14; i++) { var a = i * Math.PI / 7 + 0.2, r0 = 30 + t * 6, r1 = r0 + 40 + (i % 3) * 22; g.beginPath(); g.moveTo(k.x + Math.cos(a) * r0, FLOOR_Y - 10 + Math.sin(a) * r0 * 0.7); g.lineTo(k.x + Math.cos(a) * r1, FLOOR_Y - 10 + Math.sin(a) * r1 * 0.7); g.stroke(); }
      g.globalAlpha = 1;
      return;
    }
    var u = t - K.stop;
    if (k.boss) {
      if (u <= K.bossBoom) {
        // 連環爆炸
        for (var e = 0; e < 5; e++) {
          var age = (u + e * 7) % 12, ex = k.px + Math.sin((Math.floor((u + e * 7) / 12) * 7 + e) * 2.3) * 34, ey = k.py + Math.cos((Math.floor((u + e * 7) / 12) * 5 + e) * 1.9) * 28;
          g.globalAlpha = 1 - age / 12; g.fillStyle = ['#fff', '#FFE082', '#E040FB'][e % 3];
          g.beginPath(); g.arc(ex, ey, 6 + age * 3, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        return;
      }
      u -= K.bossBoom;
      if (!lite && u < 20) { g.globalAlpha = 0.95 * (1 - u / 20); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    }
    // 對手飛出去之後天邊閃一下
    if (u > 20 && u < 34) { var tx = Math.min(W - 14, k.px + 20 * 7), q = 1 - Math.abs(u - 27) / 7; star4(g, tx, 14, 14 * q, '#fff'); star4(g, tx, 14, 7 * q, '#FFE082'); }
    confetti(g, u, k.boss ? 60 : 34);
    slam(g, k.boss ? '打倒超夢！' : '勝利！', NET_X, 104, k.boss ? 48 : 40, '#FFD54F', u);
    if (k.boss && u > 6) label(g, '冠軍之路　制霸', NET_X, 146, 15, '#fff');
    if (!k.boss && u > 6) {
      label(g, '打倒了' + charName(camp.opp) + (k.isNew ? '　✦ 新夥伴！' : ''), NET_X, 138, 12, k.isNew ? '#FFE082' : '#fff');
      // 進度：10 顆點，剛打完的這一顆彈一下
      for (var n = 0; n < STAGES; n++) {
        var dx = NET_X - (STAGES - 1) * 7 + n * 14, big = n === STAGES - 1, r = (big ? 5 : 3.5) + (n === k.idx ? Math.max(0, 14 - u) * 0.35 : 0);
        g.fillStyle = '#000'; g.beginPath(); g.arc(dx, 160, r + 1.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = n <= k.idx ? '#7be495' : big ? '#B048FF' : 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(dx, 160, r, 0, Math.PI * 2); g.fill();
      }
      label(g, '離超夢還有 ' + (STAGES - 2 - k.idx > 0 ? (STAGES - 2 - k.idx) + ' 關' : '0 關，下一場就是魔王'), NET_X, 176, 9, '#fff');
    }
  }

  function drawHud(c) {
    if (!syncHud()) return;
    var g = hctx, run = save.run || camp.lastRun, t = camp.tick;
    g.clearRect(0, 0, W, H);
    if (!run || !c.view.game.visible) return;
    var b = camp.boss, lite = window._pvFxLite && window._pvFxLite(), k = camp.ko;
    if (b) {
      var B = CFG.boss, phase = b.phase, calm = k && k.win;       // 打倒超夢後場地氣氛就收掉
      // 場地氣氛：往上飄的念力光點、偶爾的閃電
      if (phase >= 2 && !calm) {
        for (var i = 0; i < 16; i++) {
          var px = (i * 97 + Math.sin((t + i * 40) / 23) * 14 + 400) % W, py = H - ((t * (phase === 3 ? 2.2 : 1.3) + i * 53) % (H + 20));
          g.globalAlpha = 0.25 + 0.25 * Math.sin((t + i * 9) / 6);
          g.fillStyle = phase === 3 ? '#FF6FB5' : '#C58BFF';
          g.fillRect(px, py, 2, 2 + (i % 3));
        }
        g.globalAlpha = 1;
        var lt = t % (phase === 3 ? 70 : 110);
        if (!lite && lt < 3 && !camp.waiting) {
          var lx = 40 + ((Math.floor(t / 110) * 131) % 350);
          g.globalAlpha = 0.10; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
          g.globalAlpha = 0.9; g.strokeStyle = '#F3E5FF'; g.lineWidth = 2;
          g.beginPath(); g.moveTo(lx, 0);
          for (var j = 1; j <= 6; j++) g.lineTo(lx + ((j * 37 + Math.floor(t / 110) * 13) % 31) - 15, j * 30);
          g.stroke(); g.globalAlpha = 1;
        }
      }
      // 念力導向後的落點預告
      var a = AB(), s2 = a ? a.state().p2 || {} : {};
      if (s2.redirected && s2.psychicTimer > 0) {
        var bx = c.physics.ball.expectedLandingPointX;
        if (bx > 0 && bx < NET_X) {
          var pr = 12 + (t % 6);
          g.globalAlpha = 0.9; g.strokeStyle = '#E040FB'; g.lineWidth = 2;
          g.beginPath(); g.ellipse(bx, FLOOR_Y, pr, pr * 0.35, 0, 0, Math.PI * 2); g.stroke();
          g.beginPath(); g.moveTo(bx, FLOOR_Y - 16 - (t % 4)); g.lineTo(bx - 5, FLOOR_Y - 26 - (t % 4)); g.lineTo(bx + 5, FLOOR_Y - 26 - (t % 4)); g.closePath();
          g.fillStyle = '#E040FB'; g.fill(); g.globalAlpha = 1;
        }
      }
      // 自己被扣血：畫面邊緣閃紅
      if (b.hurt > 0 && !lite) {
        var vg = g.createRadialGradient(NET_X, H / 2, 90, NET_X, H / 2, 260);
        vg.addColorStop(0, 'rgba(255,0,40,0)'); vg.addColorStop(1, 'rgba(255,0,40,' + (0.55 * b.hurt / 12) + ')');
        g.fillStyle = vg; g.fillRect(0, 0, W, H);
      }
      // 血條：左邊自己、右邊超夢（被打到會震）
      var myHp = Math.max(0, B.playerHp - c.scores[1]), bossHp = Math.max(0, B.hp - c.scores[0]);
      var sh = b.hit > 0 ? Math.sin(b.hit * 2.6) * 3 : 0, sh2 = b.hurt > 0 ? Math.sin(b.hurt * 2.6) * 3 : 0;
      label(g, charName(run.char), 16, 11, 10, '#fff', 'left');
      bar(g, 16 + sh2, 19, 150, 9, B.playerHp, myHp, myHp <= 1 ? '#FF5252' : '#69F0AE', false, myHp + (b.hurt > 0 ? 1 : 0), b.hurt / 12);
      label(g, '超夢', 416, 11, 10, '#E1BEE7', 'right');
      bar(g, 266 + sh, 19 + Math.abs(sh) * 0.4, 150, 9, B.hp, bossHp, phase === 3 ? '#FF4081' : '#B048FF', true, B.hp - (b.hit > 0 ? b.hitFrom : c.scores[0]), b.hit / 12);
      for (var q = 1; q < 3; q++) { g.fillStyle = '#000'; g.fillRect(266 + sh + 150 * q / 3 - 1.5, 15, 3, 17); }
      label(g, ['第一階段', '第二階段', '第三階段'][phase - 1], NET_X, 12, 9, phase === 3 ? '#FF80AB' : '#E1BEE7');
      for (var h1 = 0; h1 < CFG.hearts; h1++) heart(g, NET_X - 14 + h1 * 14, 27, 5, h1 < run.hearts);
      label(g, '★', NET_X + 34, 27, 11, TIER[tierOf(run.lost)].color);
      // 換階段的演出
      if (b.cut > 0) {
        var k2 = 1 - b.cut / B.cutFrames;
        g.globalAlpha = 0.55 * Math.sin(Math.PI * Math.min(1, k2 * 1.2)); g.fillStyle = '#14002A'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
        slam(g, b.next === 3 ? '第三階段' : '第二階段', NET_X, 118, 32, b.next === 3 ? '#FF80AB' : '#D7A8FF', B.cutFrames - b.cut);
        label(g, b.next === 3 ? '全場加速，念力更頻繁' : '念力增強', NET_X, 150, 12, '#fff');
      }
      if (b.flash > 0) { if (!lite) { g.globalAlpha = 0.5 * b.flash / 6; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; } b.flash--; }
    } else if (run === save.run) {
      // 剛輸掉的那顆心閃一閃
      var lostNow = k && !k.win && !camp.waiting ? 1 : 0;
      for (var h2 = 0; h2 < CFG.hearts; h2++) heart(g, NET_X - 14 + h2 * 14, 14, 5.5, h2 < run.hearts - lostNow || (lostNow && h2 === run.hearts - 1 && k.t < 20 && k.t % 4 < 2));
      label(g, zoneOf(run.idx).name + '  ' + (run.idx + 1) + '/' + STAGES, NET_X, 30, 9, '#fff');
      label(g, '★', NET_X + 36, 14, 12, TIER[tierOf(run.lost)].color);
    }
    if (k && !camp.waiting) drawKo(c, g, lite);
    else if (k && camp.waiting && k.win) confetti(g, t, 20);
  }

  // ============================================================
  // 畫面：全螢幕的模式大廳。一個畫面只做一個決定
  // ============================================================
  var OUT = 'drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff) drop-shadow(3px 4px 0 rgba(0,0,0,.35))';
  var css = [
    '#pv-camp{position:fixed;inset:0;z-index:20002;display:none;color:#fff;font-family:' + FONT + ';overflow:hidden;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;transition:opacity .25s}',
    '#pv-camp.open{display:block}#pv-camp.fade{opacity:0;pointer-events:none}',
    '#pv-camp *{box-sizing:border-box}',
    '#pv-camp [data-sp]{display:contents}',
    '#pv-camp .scr{position:absolute;inset:0;display:flex;flex-direction:column;animation:pvc-scr .16s ease-out both;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}',
    '#pv-camp canvas.sp{image-rendering:pixelated;display:block;width:100%;height:100%;filter:' + OUT + '}',
    '#pv-camp canvas.sp.sil{filter:brightness(0) ' + OUT + ';opacity:.8}',
    '#pv-camp canvas.sp.flip{transform:scaleX(-1)}',
    // 天空背景：漸層、星點、兩層山
    '#pv-camp .sky{background:linear-gradient(180deg,#121845 0%,#2a3a92 40%,#7a4c9e 70%,#ea8a5c 100%)}',
    '#pv-camp .sky::before{content:"";position:absolute;inset:0 0 40% 0;opacity:.75;background-image:radial-gradient(1.6px 1.6px at 8% 22%,#fff 60%,transparent 61%),radial-gradient(1.2px 1.2px at 23% 61%,#fff 60%,transparent 61%),radial-gradient(1.8px 1.8px at 39% 14%,#fff 60%,transparent 61%),radial-gradient(1.2px 1.2px at 54% 47%,#fff 60%,transparent 61%),radial-gradient(1.6px 1.6px at 68% 19%,#fff 60%,transparent 61%),radial-gradient(1.2px 1.2px at 81% 55%,#fff 60%,transparent 61%),radial-gradient(1.8px 1.8px at 93% 28%,#fff 60%,transparent 61%)}',
    '#pv-camp .sky::after{content:"";position:absolute;left:0;right:0;bottom:0;height:30%;background:radial-gradient(55% 100% at 18% 100%,#1b2658 0 99.5%,transparent 100%),radial-gradient(60% 80% at 74% 100%,#141d4a 0 99.5%,transparent 100%);opacity:.85}',
    '#pv-camp .scr>*{position:relative;z-index:1}',
    // 上方列
    '#pv-camp .top{display:flex;align-items:center;gap:10px;padding:6px 12px;flex:0 0 auto;min-height:40px}',
    '#pv-camp .logo{font-weight:900;font-size:clamp(20px,6dvh,34px);letter-spacing:.08em;transform:skew(-8deg);color:#FFD54F;text-shadow:__STK2__,0 4px 0 #5a2d00,0 0 14px rgba(255,200,60,.6)}',
    '#pv-camp .ttl{font-weight:900;font-size:clamp(17px,5dvh,24px);transform:skew(-8deg);text-shadow:0 2px 0 rgba(0,0,0,.5)}',
    '#pv-camp .chips{margin-left:auto;display:flex;gap:6px}',
    '#pv-camp .chip{font-size:12px;font-weight:800;background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:3px 10px;white-space:nowrap}',
    '#pv-camp .chip b{color:#FFD54F}',
    '#pv-camp button{font-family:inherit;color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '#pv-camp .x,#pv-camp .bk{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.3);border-radius:999px;font-weight:800;font-size:14px;padding:6px 14px;min-height:40px;white-space:nowrap}',
    '#pv-camp .x{width:40px;height:40px;padding:0;font-size:17px}',
    '#pv-camp .cta{border:3px solid #fff;border-radius:999px;background:linear-gradient(#ff8a50,#e53935);box-shadow:0 5px 0 #8e1b16,0 9px 18px rgba(0,0,0,.4);font-weight:900;font-size:clamp(16px,5dvh,21px);padding:9px 28px;letter-spacing:.1em;white-space:nowrap;animation:pvc-pulse 1.4s ease-in-out infinite;text-shadow:0 2px 0 rgba(0,0,0,.35)}',
    '#pv-camp .cta:active{transform:translateY(4px);box-shadow:0 1px 0 #8e1b16}',
    '#pv-camp .cta:disabled{background:#555a7a;box-shadow:0 5px 0 #33364d;animation:none;opacity:.8;cursor:default}',
    '#pv-camp .gh{background:rgba(0,0,0,.35);border:2px solid rgba(255,255,255,.4);border-radius:999px;font-weight:800;font-size:14px;padding:8px 16px;min-height:40px;white-space:nowrap}',
    '#pv-camp .gh:active,#pv-camp .bk:active,#pv-camp .x:active,#pv-camp .q:active,#pv-camp .pc:active,#pv-camp .nd[data-node]:active{transform:scale(.93);filter:brightness(1.25)}',
    '#pv-camp button:focus-visible,#pv-camp .pc:focus-visible{outline:3px solid #FFD54F;outline-offset:2px}',
    '#pv-camp .nd[data-node]{cursor:pointer}',
    '#pv-camp .nd.pk{outline:3px solid #fff;outline-offset:3px}',
    '#pv-camp .ninfo{position:absolute!important;left:14px;bottom:100%;font-size:13px;line-height:1.45;pointer-events:none}',
    '#pv-camp .ninfo>div{background:rgba(8,10,30,.85);border:1px solid rgba(255,255,255,.3);border-radius:10px;padding:5px 12px;margin-bottom:4px}',
    '#pv-camp .hearts{color:#FF3B5C;letter-spacing:2px;font-size:18px;text-shadow:0 2px 0 rgba(0,0,0,.5);white-space:nowrap}#pv-camp .hearts i{color:rgba(255,255,255,.3);font-style:normal}',
    '@keyframes pvc-pulse{50%{filter:brightness(1.18)}}',
    '@keyframes pvc-bob{50%{transform:translateY(-12%)}}',
    '@keyframes pvc-slam{0%{transform:scale(3.2);opacity:0}60%{transform:scale(.92);opacity:1}80%{transform:scale(1.06)}100%{transform:scale(1)}}',
    '@keyframes pvc-shake{0%,100%{transform:translate(0)}20%{transform:translate(-5px,3px)}40%{transform:translate(5px,-3px)}60%{transform:translate(-4px,-2px)}80%{transform:translate(4px,2px)}}',
    '@keyframes pvc-inl{from{transform:translateX(-140%)}}@keyframes pvc-inr{from{transform:translateX(140%)}}',
    '@keyframes pvc-up{from{transform:translateY(30px);opacity:0}}',
    '@keyframes pvc-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}',
    '@keyframes pvc-flash{from{opacity:1}to{opacity:0}}',
    '@keyframes pvc-grey{to{color:rgba(255,255,255,.3)}}',
    '@keyframes pvc-scr{from{opacity:0;transform:translateY(10px)}}',
    '@keyframes pvc-fall{0%{transform:translateY(-12vh) rotate(0)}100%{transform:translateY(112vh) rotate(720deg)}}',
    '@keyframes pvc-stripe{from{transform:translateX(-56px)}to{transform:translateX(0)}}',
    '@keyframes pvc-pop{0%{transform:scale(0)}70%{transform:scale(1.25)}100%{transform:scale(1)}}',
    '@keyframes pvc-bar{from{transform:scaleX(1)}to{transform:scaleX(0)}}',
    // 路線圖
    '#pv-camp .mid{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 10px}',
    '#pv-camp .map{position:relative;width:min(100%,calc((100dvh - 130px) * 2.7));aspect-ratio:2.7/1;--n:8.2%}',
    '#pv-camp .map.strip{width:min(100%,560px);aspect-ratio:9/1;--n:5.4%;margin:clamp(14px,5dvh,26px) auto 0}',
    '#pv-camp .zb{position:absolute;top:6%;bottom:6%;border-radius:14px;border:2px solid rgba(255,255,255,.22);box-shadow:inset 0 0 0 2px rgba(0,0,0,.15)}',
    '#pv-camp .strip .zb{top:14%;bottom:14%;border-radius:8px;border-width:1px}',
    '#pv-camp .zb span{position:absolute;left:10px;top:5px;font-size:clamp(11px,3.4dvh,17px);font-weight:900;text-shadow:0 2px 0 rgba(0,0,0,.45);white-space:nowrap}',
    '#pv-camp .strip .zb span{display:none}',
    '#pv-camp .map svg{position:absolute;inset:0;width:100%;height:100%}',
    '#pv-camp .nd{position:absolute;width:var(--n);aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#20254a;border:3px solid #fff;box-shadow:0 3px 0 rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:clamp(11px,3dvh,18px);color:#8f97d8}',
    '#pv-camp .strip .nd{border-width:2px;font-size:10px}',
    '#pv-camp .nd canvas{width:84%;height:84%;image-rendering:pixelated}',
    '#pv-camp .nd canvas.sil{filter:brightness(0);opacity:.5}',
    '#pv-camp .nd.done{background:#1f4a2c;border-color:#7be495}#pv-camp .nd.done canvas{opacity:.5}',
    '#pv-camp .nd.done::after{content:"✓";position:absolute;right:-12%;bottom:-18%;font-size:.9em;color:#7be495;text-shadow:0 1px 0 #000}',
    '#pv-camp .nd.cur{border-color:#FFD54F;background:#5a4a12;box-shadow:0 0 0 3px rgba(255,213,79,.35),0 0 16px rgba(255,213,79,.8)}',
    '#pv-camp .nd.bs{width:calc(var(--n) * 1.45);border-color:#E1BEE7;background:#3b1a63;box-shadow:0 0 18px rgba(186,104,255,.9)}',
    '#pv-camp .nd .nw{position:absolute;right:-18%;top:-22%;font-size:.75em;color:#FFE082;animation:pvc-pulse .9s infinite;text-shadow:0 0 6px #ff9800}',
    '#pv-camp .nd .lb{position:absolute;top:108%;left:50%;transform:translateX(-50%);font-size:clamp(11px,3dvh,13px);font-weight:800;color:#fff;white-space:nowrap;text-shadow:0 1px 0 #000}',
    '#pv-camp .strip .nd .lb,#pv-camp .strip .nd .nw{display:none}',
    '#pv-camp .tok{position:absolute;width:calc(var(--n) * 1.25);aspect-ratio:1;transform:translate(-50%,-128%);z-index:3;transition:left .6s cubic-bezier(.45,0,.3,1),top .6s cubic-bezier(.45,0,.3,1);pointer-events:none}',
    '#pv-camp .tok>div{width:100%;height:100%;animation:pvc-bob .7s ease-in-out infinite}',
    '#pv-camp .strip .tok{width:calc(var(--n) * 1.1);transform:translate(-50%,-150%)}',
    // 大廳下方
    '#pv-camp .lnk{background:none;border:0;font-size:12px;opacity:.65;text-decoration:underline;padding:10px 6px;white-space:nowrap}',
    '#pv-camp .dock{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 14px;background:linear-gradient(transparent,rgba(8,10,30,.7) 35%)}',
    '#pv-camp .who{flex:1;min-width:0;display:flex;align-items:center;gap:10px;font-size:14px;line-height:1.45}',
    '#pv-camp .who .av{width:52px;height:52px;flex:0 0 auto}',
    '#pv-camp .who b{font-size:16px}#pv-camp .who small{opacity:.8}',
    // 選夥伴
    '#pv-camp .guide{flex:0 0 auto;margin:0 12px 6px;padding:5px 12px;border-radius:10px;background:rgba(0,0,0,.4);font-size:13px;font-weight:700;text-align:center}',
    '#pv-camp .body{flex:1 1 auto;min-height:0;display:flex;gap:12px;padding:0 12px 10px}',
    '#pv-camp .grid{flex:1 1 auto;min-width:0;max-width:calc((100dvh - 118px) * 1.25);margin:0 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:min-content;gap:7px;padding:4px;align-content:start}',
    '#pv-camp .pc{position:relative;aspect-ratio:1;border-radius:12px;background:rgba(12,14,40,.55);border:3px solid rgba(255,255,255,.22);padding:10%;cursor:pointer}',
    '#pv-camp .pc canvas{width:100%;height:100%;image-rendering:pixelated;display:block}',
    '#pv-camp .pc.lk canvas{filter:brightness(0) invert(.32);opacity:.9}',
    '#pv-camp .pc.lk::after{content:"🔒";position:absolute;right:3px;bottom:1px;font-size:13px}',
    '#pv-camp .pc.sel{border-color:#FFD54F;background:rgba(90,74,18,.75);box-shadow:0 0 12px rgba(255,213,79,.7)}',
    '#pv-camp .pc .md{position:absolute;left:3px;top:-1px;font-size:15px;text-shadow:0 1px 0 #000}',
    '#pv-camp .det{flex:0 0 min(42%,300px);display:flex;flex-direction:column;align-items:center;background:rgba(10,12,34,.6);border:2px solid rgba(255,255,255,.2);border-radius:16px;padding:8px 12px 10px;min-height:0;overflow:hidden}',
    '#pv-camp .det .big{width:clamp(72px,26dvh,128px);height:clamp(72px,26dvh,128px);flex:0 0 auto;position:relative}',
    '#pv-camp .det .big::before{content:"";position:absolute;left:50%;top:50%;width:170%;height:170%;transform:translate(-50%,-50%);border-radius:50%;background:repeating-conic-gradient(var(--tc,#fff) 0 12deg,transparent 12deg 24deg);opacity:.22;animation:pvc-spin 14s linear infinite;-webkit-mask:radial-gradient(closest-side,#000 30%,transparent 100%);mask:radial-gradient(closest-side,#000 30%,transparent 100%)}',
    '#pv-camp .det .nm{font-weight:900;font-size:clamp(16px,5dvh,22px);margin-top:2px;display:flex;align-items:center;gap:6px}',
    '#pv-camp .ty{font-size:11px;font-weight:900;color:#111;border-radius:6px;padding:0 6px}',
    '#pv-camp .det .sk{font-weight:800;font-size:13px;margin-top:1px}',
    '#pv-camp .det .ds{flex:0 1 auto;min-height:0;overflow-y:auto;font-size:13px;line-height:1.55;opacity:.92;margin:6px 0;text-align:left;align-self:stretch}',
    '#pv-camp .det .rec{font-size:12px;opacity:.9;margin-bottom:6px;text-align:center}',
    '#pv-camp .det .goal{margin-top:auto;font-size:12px;line-height:1.5;opacity:.85;text-align:center;border-top:1px solid rgba(255,255,255,.18);padding-top:6px;align-self:stretch}',
    '#pv-camp .det .rec{margin-top:auto}#pv-camp .det .goal+.rec,#pv-camp .det .rec+.goal{margin-top:6px}',
    '#pv-camp .det .cta,#pv-camp .det .gh{flex:0 0 auto;margin-top:6px}',
    '#pv-camp .det .cta{flex:0 0 auto;font-size:clamp(15px,4.6dvh,19px)}',
    // VS
    '#pv-camp .vs{background:#111}',
    '#pv-camp .hf{position:absolute!important;inset:0;z-index:0!important}',
    '#pv-camp .hf::after{content:"";position:absolute;inset:0 -56px 0 0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.07) 0 14px,transparent 14px 28px);background-size:56px 100%;animation:pvc-stripe 1.6s linear infinite}',
    '#pv-camp .hf.l{clip-path:polygon(0 0,57% 0,43% 100%,0 100%);background:linear-gradient(160deg,var(--c1),var(--c1d))}',
    '#pv-camp .hf.r{clip-path:polygon(57% 0,100% 0,100% 100%,43% 100%);background:linear-gradient(200deg,var(--c2),var(--c2d))}',
    '#pv-camp .vtop{display:flex;align-items:center;gap:10px;padding:6px 12px;flex:0 0 auto}',
    '#pv-camp .stg{font-weight:900;font-size:clamp(17px,5.4dvh,26px);transform:skew(-8deg);text-shadow:0 3px 0 rgba(0,0,0,.45);margin:0 auto}',
    '#pv-camp .stg small{font-size:.55em;opacity:.9;margin-left:8px;font-weight:800}',
    '#pv-camp .arena{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;gap:clamp(8px,5vw,60px)}',
    '#pv-camp .ft{display:flex;flex-direction:column;align-items:center;position:relative}',
    '#pv-camp .ft .im{width:clamp(84px,min(34dvh,30vw),192px);height:clamp(84px,min(34dvh,30vw),192px)}',
    '#pv-camp .ft.l{animation:pvc-inl .32s cubic-bezier(.2,.9,.3,1.15) both}#pv-camp .ft.r{animation:pvc-inr .32s cubic-bezier(.2,.9,.3,1.15) both}',
    '#pv-camp .ft .nm{font-weight:900;font-size:clamp(15px,4.6dvh,22px);text-shadow:__STK3__;margin-top:-4px}',
    '#pv-camp .ft .tg{position:absolute;top:auto;bottom:20%;right:auto;left:72%;background:#FFD54F;color:#3a2a00;font-weight:900;font-size:clamp(10px,3dvh,13px);border-radius:999px;padding:2px 10px;transform:rotate(6deg);box-shadow:0 2px 0 rgba(0,0,0,.4);animation:pvc-pop .3s .35s both;white-space:nowrap}',
    '#pv-camp .vsx{font-weight:900;font-size:clamp(34px,min(17dvh,16vw),84px);font-style:italic;color:#FFD54F;text-shadow:__STK5__,7px 9px 0 rgba(0,0,0,.5);animation:pvc-slam .28s .28s both}',
    '#pv-camp .vbot{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:6px 14px 8px;background:rgba(0,0,0,.5)}',
    '#pv-camp .tip{flex:1;min-width:0;font-size:clamp(12px,3.6dvh,14px);line-height:1.4}',
    '#pv-camp .tip .tx{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}',
    '#pv-camp .tip b{margin-right:6px}',
    '#pv-camp .tip .rl{opacity:.85;display:block}',
    '#pv-camp .q{flex:0 0 auto;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.5);font-weight:900;font-size:17px;padding:0}',
    '#pv-camp .vbot .cta{font-size:clamp(18px,6dvh,24px);padding:10px 34px}',
    '#pv-camp .cta small{display:inline-block;min-width:1.5em;margin-left:8px;padding:0 .3em;border-radius:999px;background:rgba(0,0,0,.35);font-size:.7em;letter-spacing:0}',
    '#pv-camp .auto{position:absolute!important;left:0;right:0;bottom:0;height:6px;z-index:4!important;background:#FFD54F;transform-origin:left;animation:pvc-bar linear both}',
    '#pv-camp .more{position:absolute!important;inset:0;z-index:5!important;background:rgba(8,10,28,.86);display:flex;align-items:center;justify-content:center;padding:16px}',
    '#pv-camp .more>div{max-width:520px;background:#1b1e33;border:2px solid #3a3f66;border-radius:14px;padding:14px 16px;font-size:14px;line-height:1.65}',
    '#pv-camp .toast{position:absolute!important;left:0;right:0;top:34%;z-index:6!important;background:linear-gradient(90deg,transparent,rgba(0,0,0,.85) 20%,rgba(0,0,0,.85) 80%,transparent);padding:8px 16px;font-size:clamp(18px,6dvh,28px);font-weight:900;text-align:center;letter-spacing:.1em;pointer-events:none;animation:pvc-toast 1.6s both}',
    '@keyframes pvc-toast{0%{opacity:0;transform:scaleX(1.4)}15%{opacity:1;transform:scaleX(1)}75%{opacity:1}100%{opacity:0}}',
    // 落敗／暫停：蓋在場上的小卡
    '#pv-camp .dim{background:rgba(8,10,24,.72);align-items:center;justify-content:center}',
    '#pv-camp .cd{width:min(440px,92vw);background:linear-gradient(#262b52,#1a1d38);border:3px solid rgba(255,255,255,.25);border-radius:18px;padding:14px 18px 16px;text-align:center;box-shadow:0 14px 40px rgba(0,0,0,.6);animation:pvc-up .25s both}',
    '#pv-camp .cd h3{margin:0 0 4px;font-size:clamp(22px,7dvh,30px);font-weight:900;transform:skew(-8deg)}',
    '#pv-camp .cd .hearts{font-size:30px;margin:2px 0}',
    '#pv-camp .cd .hearts .brk{display:inline-block;animation:pvc-shake .5s .2s both,pvc-grey .4s .7s both}',
    '#pv-camp .cd p{margin:6px 0;font-size:14px;line-height:1.55}',
    '#pv-camp .cd .keep{font-size:12px;opacity:.7}',
    '#pv-camp .cd .row{display:flex;gap:10px;justify-content:center;align-items:center;margin-top:10px}',
    // 收服動畫
    '#pv-camp .ov{position:absolute;inset:0;z-index:10;background:radial-gradient(circle at 50% 45%,#2a2f6a,#090b1e 75%);display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}',
    '#pv-camp .ov .rays{position:absolute;left:50%;top:45%;width:170vmax;height:170vmax;transform:translate(-50%,-50%);background:repeating-conic-gradient(var(--tc) 0 10deg,transparent 10deg 20deg);opacity:.0;animation:pvc-spin 16s linear infinite;transition:opacity .3s;-webkit-mask:radial-gradient(closest-side,#000,transparent 75%);mask:radial-gradient(closest-side,#000,transparent 75%)}',
    '#pv-camp .ov.lit .rays{opacity:.4}',
    '#pv-camp .ov .im{position:relative;width:clamp(128px,46dvh,256px);height:clamp(128px,46dvh,256px);animation:pvc-pop .35s both}',
    '#pv-camp .ov .cap{position:relative;font-weight:900;font-size:clamp(15px,4.6dvh,22px);color:#FFE082;opacity:0;transition:opacity .2s;text-shadow:0 2px 0 #000}',
    '#pv-camp .ov .nm{position:relative;font-weight:900;font-size:clamp(28px,10dvh,52px);transform:skew(-8deg) scale(0);text-shadow:__STK4__;color:var(--tc)}',
    '#pv-camp .ov.lit .nm{animation:pvc-slam .25s both}',
    '#pv-camp .ov .sk{position:relative;font-size:clamp(12px,3.6dvh,16px);opacity:0;transition:opacity .3s .2s;max-width:86vw;text-align:center}',
    '#pv-camp .ov.lit .cap,#pv-camp .ov.lit .sk{opacity:1}',
    '#pv-camp .ov .fl{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}',
    '#pv-camp .ov.lit .fl{animation:pvc-flash .35s both}',
    '#pv-camp .ov .tap{position:absolute;z-index:3;bottom:calc(14px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:rgba(0,0,0,.6);border-radius:999px;padding:4px 16px;font-size:14px;font-weight:700;opacity:0;transition:opacity .3s}',
    '#pv-camp .ov.can .tap{opacity:.95}',
    '#pv-camp .cf{position:absolute;top:0;width:9px;height:5px;animation:pvc-fall linear infinite;pointer-events:none}',
    // 通關
    '#pv-camp .ov.clr{background:linear-gradient(180deg,#3d7bdc 0%,#8fc7ff 55%,#ffe7a8 100%)}',
    '#pv-camp .clr .rays{opacity:.35;background:repeating-conic-gradient(#fff 0 9deg,transparent 9deg 18deg)}',
    '#pv-camp .clr h1{position:relative;margin:0;font-weight:900;font-size:clamp(34px,13dvh,72px);transform:skew(-8deg);color:#FFE066;text-shadow:__STK4__,0 7px 0 #6b3600,0 0 18px rgba(255,220,100,.8);animation:pvc-slam .3s both}',
    '#pv-camp .clr .hero{position:relative;display:flex;align-items:center;gap:clamp(8px,3vw,28px)}',
    '#pv-camp .clr .im{width:clamp(96px,36dvh,176px);height:clamp(96px,36dvh,176px);animation:pvc-pop .3s .3s both}',
    '#pv-camp .clr .mdl{width:clamp(64px,24dvh,112px);height:clamp(64px,24dvh,112px);border-radius:50%;border:5px solid #fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;color:#3a2a00;box-shadow:0 0 0 4px #12224a,0 6px 0 4px rgba(0,0,0,.35),inset 0 -8px 0 rgba(0,0,0,.15);transform:scale(0) rotate(-12deg)}',
    '#pv-camp .clr .mdl.on{animation:pvc-slam .3s both}',
    '#pv-camp .clr .mdl b{font-size:clamp(22px,9dvh,40px);line-height:1}#pv-camp .clr .mdl span{font-size:clamp(10px,3dvh,14px)}',
    '#pv-camp .clr .st{position:relative;font-weight:800;font-size:clamp(13px,4dvh,18px);color:#12224a;margin-top:2px;opacity:0;transition:opacity .3s}',
    '#pv-camp .clr .st.on{opacity:1}#pv-camp .clr .st em{font-style:normal;background:#e53935;color:#fff;border-radius:999px;padding:1px 9px;margin-left:8px;font-size:.8em}',
    '#pv-camp .clr .beat{position:relative;display:flex;gap:4px;margin-top:4px;opacity:0;transition:opacity .3s}',
    '#pv-camp .clr .beat.on{opacity:1}',
    '#pv-camp .clr .beat span{width:clamp(22px,7dvh,36px);height:clamp(22px,7dvh,36px);background:rgba(10,20,60,.35);border-radius:8px;padding:2px}',
    '#pv-camp .clr .beat canvas{width:100%;height:100%;image-rendering:pixelated}',
    '#pv-camp .clr .goal{position:relative;margin-top:5px;font-size:clamp(11px,3.4dvh,14px);font-weight:800;color:#12224a;background:rgba(255,255,255,.55);border-radius:999px;padding:2px 14px;opacity:0;transition:opacity .3s}#pv-camp .clr .goal.on{opacity:1}',
    '#pv-camp .clr .row{position:relative;display:flex;gap:10px;margin-top:8px;opacity:0;transition:opacity .3s;align-items:center;pointer-events:none}',
    '#pv-camp .clr .row.on{opacity:1;pointer-events:auto}',
    '#pv-camp .clr .mdl{position:relative}',
    '#pv-camp .clr .mdl::before,#pv-camp .clr .mdl::after{content:"";position:absolute;top:78%;width:34%;height:62%;background:#e53935;z-index:-1;clip-path:polygon(0 0,100% 0,100% 100%,50% 78%,0 100%)}',
    '#pv-camp .clr .mdl::before{left:10%;transform:rotate(14deg)}#pv-camp .clr .mdl::after{right:10%;transform:rotate(-14deg);background:#1e88e5}',
    '#pv-camp .cert{position:absolute;inset:0;z-index:6;background:rgba(6,10,30,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:14px}',
    '#pv-camp .cert img{max-width:92%;max-height:70%;border-radius:8px;box-shadow:0 8px 30px #000}',
    '#pv-camp .cert a{color:#fff;font-weight:800;text-decoration:none}',
    '#pv-camp .clr .gh{background:rgba(10,20,60,.5)}',
    '@media (max-height:400px){#pv-camp .top{padding:3px 10px;min-height:34px}#pv-camp .dock{padding-top:4px;padding-bottom:6px}#pv-camp .who .av{width:40px;height:40px}#pv-camp .body{padding-bottom:6px;gap:8px}#pv-camp .grid{gap:5px}#pv-camp .ft .nm{text-shadow:__STK2__}#pv-camp .det{padding:4px 10px 6px}#pv-camp .det .goal{display:none}#pv-camp .det .ds{margin:3px 0;font-size:12px;line-height:1.4}#pv-camp .cd{padding:10px 14px 12px}#pv-camp .cd p{margin:3px 0;font-size:13px}#pv-camp .cd .row{margin-top:6px}}',
    '@media (max-width:560px){#pv-camp .dock{flex-wrap:wrap}#pv-camp .who{flex:1 0 100%}#pv-camp .chips{display:none}#pv-camp .body{flex-direction:column}#pv-camp .det{flex:0 0 auto;max-height:48%}}',
    // 入口：選單列的金色按鈕、標題畫面上的橫幅
    '#pv-camp-btn{background:linear-gradient(#ffd75e,#f39c12)!important;color:#3a2400!important;font-weight:900!important;border-color:#fff3c4!important}',
    '#pv-camp-banner{position:fixed;z-index:44;display:none;transform:translate(-50%,-50%);align-items:center;gap:.6em;background:linear-gradient(#ffd75e,#f39c12);color:#3a2400;border:2px solid #fff;border-radius:999px;padding:.3em 1.1em;font:900 15px ' + FONT + ';box-shadow:0 3px 0 #8a5300,0 6px 14px rgba(0,0,0,.45);cursor:pointer;white-space:nowrap;animation:pvc-pulse 1.4s infinite}',
    '#pv-camp-banner.on{display:flex}',
    '#pv-camp-banner small{font-weight:800;opacity:.8;font-size:.8em}'
  ].join('\n').replace(/__STK(\d+)__/g, function (m, r) { return stroke(+r); })
   .replace(/(\d+(?:\.\d+)?)dvh/g, 'calc(var(--vh,1vh)*$1)');   // dvh 舊瀏覽器不認得：改用自己量的 --vh

  function stroke(r) {
    var a = [];
    for (var i = 0; i < 16; i++) { var t = i * Math.PI / 8; a.push((Math.cos(t) * r).toFixed(1) + 'px ' + (Math.sin(t) * r).toFixed(1) + 'px 0 #000'); }
    return a.join(',');
  }
  var root = null, scr = null, confirmReset = false, autoTimer = 0, anims = [];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function heartsHtml(n, broken) {
    var s = '';
    for (var i = 0; i < CFG.hearts; i++) s += i < n ? '♥\uFE0E' : (broken && i === n ? '<span class="brk">♥\uFE0E</span>' : '<i>♥\uFE0E</i>');
    return '<span class="hearts">' + s + '</span>';
  }
  function firstLine(desc) {
    var parts = desc.split('。'), s = '';
    for (var i = 0; i < parts.length && s.length < 10; i++) if (parts[i]) s += parts[i] + '。';
    return s;
  }
  function fmtTime(frames) { var s = Math.round(frames / 25); return Math.floor(s / 60) + ' 分 ' + ('0' + (s % 60)).slice(-2) + ' 秒'; }

  // ---------- 角色圖：用現成的動作圖在介面裡播動畫 ----------
  var SEQ = { 0: [0, 1, 2, 3, 4, 3, 2, 1], 5: [0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4], 6: [0, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4] };
  function paintSp(cv) {
    var a = cv._a, CS = window.PV_CharSelect, seq = SEQ[a.st] || [0];
    if (CS && CS.paintFrame) CS.paintFrame(cv, a.id, a.st, seq[a.i % seq.length]);
  }
  function sprite(id, st, cls) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64; cv.className = 'sp ' + (cls || '');
    cv._a = { id: id, st: st || 0, i: 0 };
    paintSp(cv); anims.push(cv);
    return cv;
  }
  function still(id) {
    var CS = window.PV_CharSelect;
    if (CS && CS.portrait) return CS.portrait(id, 64);
    return document.createElement('canvas');
  }
  // 把 <i data-sp="id"> 換成角色圖（data-st：動作，data-c：樣式；data-still：不播動畫）
  function fill(el) {
    el.querySelectorAll('[data-sp]').forEach(function (e) {
      var id = e.getAttribute('data-sp');
      if (!CH.byId[id]) return;
      var cv = e.hasAttribute('data-still') ? still(id) : sprite(id, +e.getAttribute('data-st') || 0, e.getAttribute('data-c') || '');
      if (e.hasAttribute('data-still') && e.getAttribute('data-c')) cv.className = e.getAttribute('data-c');
      e.appendChild(cv);
    });
  }

  // ---------- 路線圖（大廳的大圖和 VS 上緣的進度列共用） ----------
  function nodeXY(i, strip) { return { x: i >= STAGES - 1 ? 93 : 5.5 + i * 9.3, y: 52 + Math.sin(i * 1.3 + 0.5) * (strip ? 0 : 19) }; }
  function mapHtml(run, strip, tokenAt) {
    var h = '<div class="map' + (strip ? ' strip' : '') + '">', pts = [];
    CFG.zones.forEach(function (z, zi) {
      var from = ZONE_START[zi], to = zi + 1 < ZONE_START.length ? ZONE_START[zi + 1] : STAGES;
      var x0 = from === 0 ? 0.5 : (nodeXY(from - 1).x + nodeXY(from).x) / 2 + 0.4, x1 = to >= STAGES ? 99.5 : (nodeXY(to - 1).x + nodeXY(to).x) / 2 - 0.4;
      h += '<div class="zb" style="left:' + x0 + '%;width:' + (x1 - x0) + '%;background:linear-gradient(' + z.c1 + ',' + z.c2 + ')"><span>' + esc(z.name) + '</span></div>';
    });
    for (var i = 0; i < STAGES; i++) pts.push(nodeXY(i, strip));
    h += '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' ') +
      '" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
    for (i = 0; i < STAGES; i++) {
      var z = zoneOf(i), boss = !!z.boss, id = run ? run.order[i] : (boss ? 'mewtwo' : (z.fixed && z.fixed[i - ZONE_START[zoneIdx(i)]]) || '');
      var known = boss || (run && i <= run.idx) || (id && z.fixed && z.fixed.indexOf(id) >= 0);
      var cls = 'nd' + (boss ? ' bs' : '') + (run && i < run.idx ? ' done' : run && i === run.idx ? ' cur' : '');
      h += '<div class="' + cls + '"' + (strip ? '' : ' data-node="' + i + '"') + ' style="left:' + pts[i].x + '%;top:' + pts[i].y + '%">' + (id ? '<i data-sp="' + id + '" data-still' + (known ? '' : ' data-c="sil"') + '></i>' : '?') +
        (id && !owned(id) && !(run && i < run.idx) ? '<span class="nw">✦</span>' : '') +
        (run && i === run.idx ? '<span class="lb">' + (boss ? '魔王' : '下一關') + '</span>' : boss ? '<span class="lb">魔王</span>' : '') + '</div>';
    }
    if (run) {
      var at = pts[tokenAt == null ? run.idx : tokenAt];
      h += '<div class="tok" data-to="' + pts[run.idx].x + ',' + pts[run.idx].y + '" style="left:' + at.x + '%;top:' + at.y + '%"><div><i data-sp="' + run.char + '"></i></div></div>';
    }
    return h + '</div>';
  }
  function chips() { return '<div class="chips"><span class="chip">夥伴 <b>' + ownedCount() + '</b> / ' + CH.ids.length + '</span><span class="chip">獎章 <b>' + medalCount() + '</b> / ' + CH.ids.length + '</span></div>'; }

  // ---------- 各個畫面 ----------
  function hubHtml() {
    var run = save.run, h = '<div class="scr sky hub"><div class="top"><div class="logo">冠軍之路</div>' + chips() + '<button class="x" data-a="close" type="button" title="離開">✕</button></div>';
    h += '<div class="mid">' + mapHtml(run, false) + '</div><div class="dock"><div class="ninfo"></div>';
    if (run) {
      h += '<div class="who"><div class="av"><i data-sp="' + run.char + '"></i></div><div><b>' + esc(charName(run.char)) + '</b>　' + heartsHtml(run.hearts) +
        '<br><small>第 ' + (run.idx + 1) + ' 關　對　' + esc(charName(run.order[run.idx])) + '</small></div></div>' +
        '<button class="lnk" data-a="reset" type="button">' + (confirmReset ? '再按一次確定' : '放棄這一輪') + '</button>' +
        '<button class="gh" data-a="pick" type="button">夥伴</button>' +
        '<button class="cta" data-a="vs" data-primary type="button">' + (zoneOf(run.idx).boss ? '挑戰超夢' : '繼續第 ' + (run.idx + 1) + ' 關') + '</button>';
    } else {
      h += '<div class="who"><div>選一個夥伴，連過 9 關後挑戰超夢。<br><small>打倒誰，誰就會成為你的夥伴。</small></div></div>' +
        '<button class="cta" data-a="pick" data-primary type="button">開始冒險</button>';
    }
    return h + '</div></div>';
  }

  function pickHtml() {
    var run = save.run, sel = camp.pick && CH.byId[camp.pick] ? camp.pick : (run ? run.char : CFG.starters[0]);
    camp.pick = sel;
    var list = CH.list.slice().sort(function (a, b) { return (owned(a.id) ? 0 : 1) - (owned(b.id) ? 0 : 1); });   // 有的排前面
    var h = '<div class="scr sky pick"><div class="top"><button class="bk" data-a="hub" type="button">‹ 路線圖</button><div class="ttl">選擇夥伴</div>' + chips() +
      '<button class="x" data-a="close" type="button" title="離開">✕</button></div>' + (medalCount() || run ? '' : '<div class="guide">先選一隻出發。闖關時打倒誰，誰就會成為新夥伴。</div>') + '<div class="body"><div class="grid">';
    list.forEach(function (c) {
      var t = medalTier(c.id);
      h += '<div class="pc' + (owned(c.id) ? '' : ' lk') + (sel === c.id ? ' sel' : '') + '" data-pick="' + c.id + '"><i data-sp="' + c.id + '" data-still></i>' +
        (t ? '<span class="md" style="color:' + TIER[t].color + '">★</span>' : '') + '</div>';
    });
    var c = CH.byId[sel], has = owned(sel), m = save.medals[sel], t2 = medalTier(sel);
    h += '</div><div class="det" style="--tc:' + c.color + '"><div class="big"><i data-sp="' + sel + '" data-c="' + (has ? '' : 'sil') + '"></i></div>';
    if (has) {
      h += '<div class="nm">' + esc(c.name) + '<span class="ty" style="background:' + c.color + '">' + esc(c.type) + '</span></div><div class="sk" style="color:' + c.color + '">' + esc(c.skill) + '</div>' +
        '<div class="ds">' + esc(c.desc) + '</div>' +
        '<div class="rec">' + (m ? '<b style="color:' + TIER[t2].color + '">★ ' + TIER[t2].name + '獎章</b>　' + fmtTime(m.frames) + '・輸 ' + m.lost + ' 場' : '還沒挑戰過，用牠通關可以拿到獎章') + '</div>';
      var same = run && run.char === sel;
      h += goalHtml();
      if (run && !same) h += '<button class="gh" data-a="new" type="button">' + (confirmReset ? '再按一次確定' : '換牠重新開始（放棄目前這一輪）') + '</button>';
      else h += '<button class="cta" data-a="' + (same ? 'vs' : 'new') + '" data-primary type="button">' + (same ? '繼續冒險' : '出發！') + '</button>';
    } else {
      h += '<div class="nm">？？？</div><div class="sk">還沒成為夥伴</div><div class="ds" style="text-align:center">取得方式：' + esc(howToGet(sel)) + '</div>' +
        '<button class="cta" type="button" disabled>尚未收服</button>';
    }
    return h + '</div></div></div>';
  }

  function vsHtml() {
    var run = save.run, idx = run.idx, z = zoneOf(idx), me = CH.byId[run.char], opp = CH.byId[run.order[idx]], B = CFG.boss;
    var tip = firstLine(opp.desc);
    var rule = z.boss ? '超夢 ' + B.hp + ' 格血、你 ' + B.playerHp + ' 格，得一分打掉對方一格' + (run.bossPhase > 1 ? '（從第 ' + run.bossPhase + ' 階段開始）' : '')
      : '先得 ' + z.score + ' 分過關' + (idx === 0 ? '。左右移動，跳起來再按殺球鍵把球砸過去' : '');
    var h = '<div class="scr vs" style="--c1:' + shade(me.color, 0.85) + ';--c1d:' + shade(me.color, 0.4) + ';--c2:' + shade(opp.color, 0.85) + ';--c2d:' + shade(opp.color, 0.4) + '">' +
      '<div class="hf l"></div><div class="hf r"></div>' +
      '<div class="vtop"><button class="bk" data-a="hub" type="button">‹ 路線圖</button><div class="stg">' + (z.boss ? '最終戰' : '第 ' + (idx + 1) + ' 關') + '<small>' + esc(z.name) + '</small></div><span class="chip" title="照目前的敗場，通關可以拿到的獎章"><b style="color:' + TIER[tierOf(run.lost)].color + '">★</b> 目前可拿' + TIER[tierOf(run.lost)].name + '獎章</span>' + heartsHtml(run.hearts) + '</div>' +
      mapHtml(run, true, camp.travelFrom) +
      '<div class="arena"><div class="ft l"><div class="im"><i data-sp="' + me.id + '"></i></div><div class="nm">' + esc(me.name) + '</div></div>' +
      '<div class="vsx">VS</div>' +
      '<div class="ft r"><div class="im"><i data-sp="' + opp.id + '" data-c="flip"></i></div><div class="nm">' + esc(opp.name) + '</div>' + (owned(opp.id) ? '' : '<div class="tg">打倒就能收服！</div>') + '</div></div>' +
      '<div class="vbot"><div class="tip"><span class="tx"><b style="color:' + opp.color + '">' + esc(opp.skill) + '</b>' + esc(tip) + '</span><span class="rl">' + esc(rule) + '</span></div><button class="q" data-a="more" type="button" title="完整說明">？</button>' +
      '<button class="cta" data-a="fight" data-primary type="button"' + (camp.wantStart ? ' disabled' : '') + '>' + (camp.wantStart ? '載入中…' : '開打') + '</button></div>';
    if (camp.toast) h += '<div class="toast">' + esc(camp.toast) + '</div>';
    return h + '</div>';
  }

  function loseHtml() {
    var run = save.run, L = camp.lose || {}, h = '<div class="scr dim"><div class="cd"><h3>' + (L.out ? '心用完了' : '落敗…') + '</h3>';
    h += '<div>' + heartsHtml(L.out ? 0 : run.hearts, true) + '</div>' + (L.out ? '' : '<p style="margin:0;font-weight:800">還剩 ' + run.hearts + ' 顆心</p>');
    var left = L.need - (L.sc ? L.sc[0] : 0), msg;
    if (L.boss) msg = left <= 2 ? '就差一點！超夢只剩 ' + left + ' 格血。' : '超夢還剩 ' + left + ' 格血。';
    else msg = left <= 1 ? '就差一點！只差 1 分就打倒' + charName(L.opp) + '了。' : L.sc[0] * 2 >= L.need ? '已經拿下 ' + L.sc[0] + ' 分，再 ' + left + ' 分就能打倒' + charName(L.opp) + '。' : charName(L.opp) + '這場佔了上風。看一下牠的技能，換個打法再試一次。';
    h += '<p>' + esc(msg) + '</p>';
    if (L.out) h += '<p>補滿 ' + CFG.hearts + ' 顆心，' + (L.boss ? '從超夢的第一階段重新挑戰。' : '回到「' + esc(zoneOf(run.idx).name) + '」第一關。') + '</p>';
    else if (L.boss && run.bossPhase > 1) h += '<p>下一場從第 ' + run.bossPhase + ' 階段開始。</p>';
    h += '<p class="keep">已經收服的夥伴不會消失。</p>';
    h += '<div class="row"><button class="gh" data-a="hub" type="button">路線圖</button><button class="cta" data-a="' + (L.out && !L.boss ? 'back-vs' : 'fight') + '" data-primary type="button">' + (L.out && !L.boss ? '繼續' : '再打一次') + '</button></div>';
    return h + '</div></div>';
  }

  function pauseHtml() {
    var run = save.run;
    return '<div class="scr dim"><div class="cd"><h3>暫停</h3>' +
      (run ? '<p>' + esc(charName(run.char)) + '　對　' + esc(charName(run.order[run.idx])) + '　' + heartsHtml(run.hearts) + '</p>' : '') +
      '<p class="keep">現在離開，這一場會算輸：扣一顆心、敗場加一。</p>' +
      '<div class="row"><button class="gh" data-a="quit" type="button">離開闖關</button><button class="cta" data-a="resume" data-primary type="button">回到比賽</button></div></div></div>';
  }

  function render() {
    if (!root) return;
    clearTimeout(autoTimer);
    var v = camp.view;
    if ((v === 'vs' || v === 'lose') && !save.run) v = camp.view = 'pick';
    var again = camp.shown === v && isOpen();
    scr.innerHTML = v === 'hub' ? hubHtml() : v === 'pick' ? pickHtml() : v === 'vs' ? vsHtml() : v === 'lose' ? loseHtml() : v === 'pause' ? pauseHtml() : v === 'net' ? '<div class="scr dim"><div class="cd"><h3>連線房間開著</h3><p>先離開連線房間，才能進闖關模式。</p><div class="row"><button class="cta" data-a="close" data-primary type="button">知道了</button></div></div></div>' : '';
    if (again && scr.firstChild) scr.firstChild.style.animation = 'none';
    fill(scr);
    if (v === 'vs') {
      camp.toast = '';
      // 自己的角色從上一關走到這一關
      var tok = scr.querySelector('.tok');
      if (tok && camp.travelFrom != null) {
        var to = tok.getAttribute('data-to').split(',');
        requestAnimationFrame(function () { requestAnimationFrame(function () { tok.style.left = to[0] + '%'; tok.style.top = to[1] + '%'; }); });
        sfx('step');
      }
      camp.travelFrom = null;
      setTimeout(function () { if (camp.view === 'vs' && isOpen()) sfx('vs'); }, 300);
      var auto = camp.autoVs && save.run && save.run.idx > 0 && !zoneOf(save.run.idx).boss && !camp.wantStart;
      if (auto) {
        var btn = scr.querySelector('[data-a=fight]');
        scr.querySelector('.scr').insertAdjacentHTML('beforeend', '<div class="auto" style="animation-duration:' + CFG.autoVs + 'ms"></div>');
        var left = Math.round(CFG.autoVs / 1000), rl = scr.querySelector('.tip .rl');
        if (btn) btn.insertAdjacentHTML('beforeend', '<small>' + left + '</small>');
        if (rl) rl.insertAdjacentHTML('beforeend', '<span class="an">　｜　倒數完自動開打，點一下畫面取消</span>');
        var tickAuto = function () {
          if (camp.view !== 'vs' || !isOpen() || root.querySelector('.ov')) return;
          if (--left <= 0) { startMatch(); return; }
          var sm = scr.querySelector('[data-a=fight] small'); if (sm) sm.textContent = left;
          autoTimer = setTimeout(tickAuto, 1000);
        };
        autoTimer = setTimeout(tickAuto, 1000);
      }
    }
    camp.autoVs = false;
    if (camp.shown !== v) camp.openedAt = performance.now();
    camp.shown = v;
  }

  function cancelAuto() {
    clearTimeout(autoTimer); autoTimer = 0;
    var a = scr.querySelector('.auto'); if (a) a.remove();
    var s = scr.querySelector('[data-a=fight] small'); if (s) s.remove();
    var an = scr.querySelector('.tip .an'); if (an) an.remove();
  }
  function openRoot() {
    root.classList.remove('fade');
    root.style.zIndex = (window._pvZ = Math.max(window._pvZ || 20010, 20010) + 1);
    root.classList.add('open');
    document.querySelectorAll('.dropdown.show,.submenu.show').forEach(function (d) { d.classList.remove('show'); });
    document.querySelectorAll('.dropdown-btn.open,.submenu-btn.open').forEach(function (d) { d.classList.remove('open'); });
  }
  function go(view) { if (!root) return; camp.view = view; confirmReset = false; render(); openRoot(); }
  function hide(fade) {
    if (!root) return;
    clearTimeout(autoTimer);
    if (fade && isOpen()) { root.classList.add('fade'); setTimeout(function () { if (root.classList.contains('fade')) { root.classList.remove('open', 'fade'); scr.innerHTML = ''; } }, 260); }
    else { root.classList.remove('open', 'fade'); scr.innerHTML = ''; }
  }
  function isOpen() { return !!(root && root.classList.contains('open') && !root.classList.contains('fade')); }

  // ---------- 收服動畫 ----------
  function confettiHtml(n, colors) {
    var h = '';
    for (var i = 0; i < n; i++) h += '<i class="cf" style="left:' + (i * 97 % 100) + '%;background:' + colors[i % colors.length] + ';animation-duration:' + (1.6 + (i % 5) * 0.35) + 's;animation-delay:' + (-(i % 7) * 0.3) + 's"></i>';
    return h;
  }
  function overlay(cls, html) {
    var ov = document.createElement('div');
    ov.className = 'ov ' + cls; ov.innerHTML = html;
    root.appendChild(ov); fill(ov); openRoot();
    camp.openedAt = performance.now();
    return ov;
  }
  function playAcquire(id, full, done) {
    var c = CH.byId[id];
    scr.innerHTML = '';
    var ov = overlay('acq', '<div class="rays"></div><div class="cap">成為夥伴了！</div><div class="im"><i data-sp="' + id + '" data-st="5" data-c="sil"></i></div>' +
      '<div class="nm">' + esc(c.name) + '</div><div class="sk">技能　<b style="color:' + c.color + '">' + esc(c.skill) + '</b></div><div class="fl"></div><div class="tap">點一下繼續</div>');
    ov.style.setProperty('--tc', c.color);
    var closed = false, can = false;
    function close() { if (closed || !can) return; closed = true; ov.remove(); done(); }
    function reveal() {
      if (closed) return;
      ov.classList.add('lit');
      var cv = ov.querySelector('canvas.sp'); if (cv) { cv.classList.remove('sil'); cv._a.i = 0; }
      ov.insertAdjacentHTML('beforeend', confettiHtml(26, [c.color, '#FFD54F', '#fff']));
      sfx('get'); cry(id);
      setTimeout(function () { can = true; ov.classList.add('can'); }, 400);
      if (!full) setTimeout(close, 1300);
    }
    setTimeout(reveal, full ? 750 : 120);
    ov.addEventListener('click', close);
    ov._primary = close;
  }

  // ---------- 通關動畫 ----------
  function certificate(run, tier) {
    try {
      var cv = document.createElement('canvas'); cv.width = 960; cv.height = 540;
      var g = cv.getContext('2d'), c = CH.byId[run.char], gr = g.createLinearGradient(0, 0, 0, 540);
      gr.addColorStop(0, '#1b2a6b'); gr.addColorStop(0.6, '#4d6fd0'); gr.addColorStop(1, '#f2c26b');
      g.fillStyle = gr; g.fillRect(0, 0, 960, 540);
      g.strokeStyle = '#FFD54F'; g.lineWidth = 8; g.strokeRect(18, 18, 924, 504);
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.strokeRect(32, 32, 896, 476);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      function txt(s, x, y, size, col, sw) { g.font = '900 ' + size + 'px ' + FONT; g.lineWidth = sw || size / 5; g.strokeStyle = '#0a0f2e'; g.strokeText(s, x, y); g.fillStyle = col; g.fillText(s, x, y); }
      txt('冠軍之路　通關證書', 480, 84, 46, '#FFD54F');
      var tmp = document.createElement('canvas'); tmp.width = tmp.height = 64;
      if (window.PV_CharSelect && window.PV_CharSelect.paintFrame) window.PV_CharSelect.paintFrame(tmp, run.char, 5, 4);
      g.imageSmoothingEnabled = false; g.drawImage(tmp, 110, 150, 288, 288);
      txt(c.name, 650, 190, 64, '#fff');
      txt('★ ' + TIER[tier].name + '獎章', 650, 268, 40, TIER[tier].color);
      txt('用時 ' + fmtTime(run.frames) + '　' + STAGES + ' 勝 ' + run.lost + ' 敗', 650, 336, 30, '#fff');
      var d = new Date();
      txt(d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate() + '　打倒超夢', 650, 392, 24, '#E3F2FD');
      txt('寶可夢排球 Ultimate', 480, 478, 22, '#fff8d0');
      return { url: cv.toDataURL('image/png'), name: '冠軍之路-' + c.name + '.png' };
    } catch (e) { return null; }
  }
  // 通關後的下一個目標：讓人知道再打一輪能拿到什麼
  function nextGoal() {
    var g = [], silver = 0, left = CH.ids.length - ownedCount();
    Object.keys(save.medals).forEach(function (id) { if (medalTier(id) >= 2) silver++; });
    if (!owned('ditto')) g.push('再 ' + Math.max(1, 3 - medalCount()) + ' 面獎章 → 百變怪');
    if (!owned('mew')) g.push('一場不輸拿金獎章' + (silver ? '，或再 ' + Math.max(1, 3 - silver) + ' 面銀獎章' : '') + ' → 夢幻');
    if (!g.length) g.push(left > 0 ? '還有 ' + left + ' 隻夥伴等你收服' : '獎章 ' + medalCount() + ' / ' + CH.ids.length + '，換一隻夥伴再挑戰');
    return '<div class="goal">下一個目標：' + esc(g.join('　｜　')) + '</div>';
  }
  function goalHtml() { return nextGoal().replace('class="goal"', 'class="goal"').replace('下一個目標：', '下一個目標<br>').replace(/　｜　/g, '<br>'); }
  function playClear(run, isRecord, done) {
    var c = CH.byId[run.char], tier = tierOf(run.lost), T = TIER[tier];
    scr.innerHTML = '';
    var beat = '';
    run.order.forEach(function (id) { beat += '<span><i data-sp="' + id + '" data-still></i></span>'; });
    var ov = overlay('clr', '<div class="rays"></div>' + confettiHtml(40, CONF) + '<h1>冠軍！</h1>' +
      '<div class="hero"><div class="im"><i data-sp="' + run.char + '" data-st="5"></i></div>' +
      '<div class="mdl" style="background:radial-gradient(circle at 35% 30%,#fff,' + T.color + ' 55%)"><b>★</b><span>' + T.name + '獎章</span></div></div>' +
      '<div class="st">' + esc(c.name) + '　用時 ' + fmtTime(run.frames) + '　' + STAGES + ' 勝 ' + run.lost + ' 敗' + (isRecord ? '<em>新紀錄</em>' : '') + '</div>' +
      '<div class="beat">' + beat + '</div>' + nextGoal() +
      '<div class="row"><button class="gh" data-a="cert" type="button">存成圖片</button><button class="cta" data-a="next" type="button">繼續</button></div>');
    var timers = [], closed = false, rowAt = 0;
    function on(sel, ms, fn) { timers.push(setTimeout(function () { var e = ov.querySelector(sel); if (e) e.classList.add('on'); if (fn) fn(); }, ms)); }
    function all() { timers.forEach(clearTimeout); ['.mdl', '.st', '.beat', '.goal', '.row'].forEach(function (s) { var e = ov.querySelector(s); if (e) e.classList.add('on'); }); if (!rowAt) rowAt = performance.now(); }
    sfx('fanfare'); cry(run.char);
    on('.mdl', 900, function () { sfx('stamp'); ov.querySelector('.hero').style.animation = 'pvc-shake .2s'; });
    on('.st', 1400); on('.beat', 1800); on('.goal', 2000); on('.row', 2300, function () { rowAt = performance.now(); });
    function close() { if (closed) return; closed = true; ov.remove(); done(); }
    ov.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-a]') : null;
      if (b && b.getAttribute('data-a') === 'cert') {
        var im = certificate(run, tier);
        if (im) ov.insertAdjacentHTML('beforeend', '<div class="cert" data-a="cert-x"><img alt="通關證書" src="' + im.url + '"><div class="row on"><a class="gh" download="' + esc(im.name) + '" href="' + im.url + '">下載圖片</a><button class="gh" data-a="cert-x" type="button">關閉</button></div><small>手機可以長按圖片儲存</small></div>');
        return;
      }
      if (e.target.closest && e.target.closest('.cert')) { if (!(e.target.closest('a') || e.target.tagName === 'IMG')) { var ce = ov.querySelector('.cert'); if (ce) ce.remove(); } return; }
      if (b && b.getAttribute('data-a') === 'next') { close(); return; }
      all();                                      // 點其他地方：快轉到最後
    });
    ov._primary = function () {
      var ce = ov.querySelector('.cert');
      if (ce) { ce.remove(); return; }
      if (rowAt && performance.now() - rowAt > 600) close(); else all();
    };
  }

  // ---------- 操作 ----------
  function act(a, el) {
    var c = ctrlOf();
    if (a === 'close') {
      hide();
      camp.wantStart = false;
      if (camp.waiting) suspend(c, true);        // 兩關之間離開＝先不玩了，回標題
    } else if (a === 'hub') { go('hub'); }
    else if (a === 'pick') { go('pick'); }
    else if (a === 'vs' || a === 'back-vs') {
      if (a === 'back-vs' && camp.lose) camp.travelFrom = camp.lose.from;   // 退回區首：角色在進度列上走回去
      go('vs');
    } else if (a === 'reset') {
      if (!confirmReset) { confirmReset = true; el.textContent = '再按一次確定'; return; }
      save.run = null; persist(); confirmReset = false;
      if (camp.waiting) suspend(c, true);
      go('pick');
    } else if (a === 'new') {
      if (!camp.pick || !owned(camp.pick)) return;
      if (save.run && !confirmReset) { confirmReset = true; el.textContent = '再按一次確定'; return; }
      newRun(camp.pick);
      go('vs');
    } else if (a === 'fight') { startMatch(); }
    else if (a === 'more') {
      var run = save.run, opp = run && CH.byId[run.order[run.idx]];
      if (opp) scr.querySelector('.scr').insertAdjacentHTML('beforeend', '<div class="more" data-a="less"><div><b style="color:' + opp.color + '">' + esc(opp.name) + '・' + esc(opp.skill) + '</b><br>' + esc(opp.desc) + '<br><small style="opacity:.6">點一下關閉</small></div></div>');
    } else if (a === 'less') { var m = scr.querySelector('.more'); if (m) m.remove(); }
    else if (a === 'resume') { if (c) c.paused = false; hide(); }
    else if (a === 'quit') { if (c) c.paused = false; suspend(c, true); go('hub'); }
  }

  // 從入口進來：比賽中＝暫停；有進行中的一輪＝直接到下一關的 VS；都沒有＝選夥伴
  function openFromMenu(toHub) {
    if (netBusy()) { go('net'); return; }
    ensureGame();
    var c = ctrlOf();
    if (camp.playing && !camp.waiting && c) { if (camp.ko) return; c.paused = true; go('pause'); return; }
    if (root.querySelector('.ov')) { openRoot(); return; }
    if (camp.waiting && camp.view) { go(camp.view); return; }
    go(!save.run ? 'pick' : toHub ? 'hub' : 'vs');
  }

  var banner = null, menuBtn = null;
  function refreshEntry() {
    var c = ctrlOf(), gc = document.getElementById('game-canvas');
    if (menuBtn) menuBtn.textContent = camp.playing && !camp.waiting ? '暫停' : '闖關';
    if (!banner) return;
    var show = !!(c && gc && !camp.playing && !netBusy() && !isOpen() && c.state === c.menu && c.view.menu.visible);
    banner.classList.toggle('on', show);
    if (!show) return;
    var r = gc.getBoundingClientRect(), run = save.run;
    banner.style.left = (r.left + r.width / 2) + 'px';
    banner.style.top = (r.top + r.height * 0.835) + 'px';
    banner.style.fontSize = Math.max(10, Math.min(16, r.height * 0.036)) + 'px';
    banner.innerHTML = run ? '冠軍之路<small>繼續第 ' + (run.idx + 1) + ' 關　▶\uFE0E</small>' : '闖關模式　冠軍之路<small>▶\uFE0E</small>';
  }

  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'pv-camp';
    root.innerHTML = '<div class="scrs"></div>';
    scr = root.querySelector('.scrs');
    document.body.appendChild(root);
    var setVh = function () { root.style.setProperty('--vh', (window.innerHeight / 100) + 'px'); };
    setVh(); window.addEventListener('resize', setVh);
    scr.addEventListener('click', function (e) {
      cancelAuto();
      var t = e.target, b = t.closest ? t.closest('[data-a]') : null, card = t.closest ? t.closest('[data-pick]') : null;
      if (b && !b.disabled) { act(b.getAttribute('data-a'), b); return; }
      if (card) { camp.pick = card.getAttribute('data-pick'); confirmReset = false; sfx('tick'); render(); return; }
      var nd = t.closest ? t.closest('[data-node]') : null, who = scr.querySelector('.ninfo');
      scr.querySelectorAll('.nd.pk').forEach(function (x) { x.classList.remove('pk'); });
      if (who) who.innerHTML = '';
      if (nd && who) {
        nd.classList.add('pk');
        var ni = +nd.getAttribute('data-node'), nz = zoneOf(ni), run = save.run;
        var nid = run ? run.order[ni] : nz.boss ? 'mewtwo' : (nz.fixed && nz.fixed[ni - ZONE_START[zoneIdx(ni)]]) || '';
        var seen = nz.boss || (run && ni <= run.idx) || (nid && nz.fixed && nz.fixed.indexOf(nid) >= 0);
        sfx('tick');
        who.innerHTML = '<div><b>' + (nz.boss ? '最終戰' : '第 ' + (ni + 1) + ' 關') + '　' + esc(nz.name) + '</b><br><small>' +
          (seen && nid ? '對手：' + esc(charName(nid)) : '對手：到了才知道') + '　｜　' + (nz.boss ? '超夢 ' + CFG.boss.hp + ' 格血、分三階段' : '先得 ' + nz.score + ' 分') +
          (nid && !owned(nid) ? '　｜　✦ 打倒可收服' : seen && nid ? '　｜　已是夥伴' : '') + '</small></div>';
      }
    });
    // 鍵盤：Enter／空白／殺球鍵＝主要按鈕，Esc＝返回。攔在遊戲本體之前，免得同一下按鍵也被遊戲吃到
    window.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      var ov = root.querySelector('.ov');
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyZ' || e.code === 'NumpadEnter') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.repeat || performance.now() - (camp.openedAt || 0) < 350) return;
        var fe = document.activeElement;
        if (ov) {
          if (e.code !== 'KeyZ' && fe && ov.contains(fe) && (fe.tagName === 'BUTTON' || fe.tagName === 'A') && !ov.querySelector('.cert')) { fe.click(); return; }
          if (ov._primary) ov._primary();
          return;
        }
        var more = scr.querySelector('.more'); if (more) { more.remove(); return; }
        if (e.code !== 'KeyZ' && fe && fe.tagName === 'BUTTON' && scr.contains(fe) && !fe.disabled) { fe.click(); return; }
        var p = scr.querySelector('[data-primary]'); if (p && !p.disabled) p.click();
      } else if (camp.view === 'pick' && /^Arrow/.test(e.code) && !ov) {
        e.preventDefault(); e.stopImmediatePropagation();
        var cards = [].slice.call(scr.querySelectorAll('[data-pick]')), at = cards.indexOf(scr.querySelector('.pc.sel')), cols = 1;
        if (at < 0 || !cards.length) return;
        while (cols < cards.length && cards[cols].offsetTop === cards[0].offsetTop) cols++;
        var to = at + (e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : e.code === 'ArrowUp' ? -cols : cols);
        if (to >= 0 && to < cards.length) cards[to].click();
      } else if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        if (ov) { var ce0 = ov.querySelector('.cert'); if (ce0) ce0.remove(); return; }
        if (scr.querySelector('.more')) { act('less'); return; }
        act(camp.view === 'pause' ? 'resume' : (camp.view === 'vs' || camp.view === 'lose' || (camp.view === 'pick' && save.run)) ? 'hub' : 'close');
      }
    }, true);

    var left = document.querySelector('#menu-bar .btn-container.left');
    if (left) {
      var wrap = document.createElement('div'); wrap.className = 'relative-container';
      menuBtn = document.createElement('button'); menuBtn.type = 'button'; menuBtn.id = 'pv-camp-btn'; menuBtn.className = 'btn'; menuBtn.textContent = '闖關';
      menuBtn.onclick = function (e) { e.stopPropagation(); openFromMenu(true); };
      wrap.appendChild(menuBtn);
      var netBtn = document.getElementById('pv-net-btn');
      left.insertBefore(wrap, netBtn && netBtn.parentNode && netBtn.parentNode.parentNode === left ? netBtn.parentNode : left.querySelector('.color-scheme-toggle-switch-container'));
    }
    banner = document.createElement('div'); banner.id = 'pv-camp-banner';
    banner.addEventListener('click', function () { openFromMenu(false); });
    document.body.appendChild(banner);
  }

  function init() {
    load();
    build();
    setInterval(function () {
      hookCtrl();
      if (camp.wantStart && ctrlOf()) startMatch();
      refreshEntry();
    }, 300);
    setInterval(function () {
      if (!anims.length) return;
      anims = anims.filter(function (cv) { return cv.isConnected; });
      anims.forEach(function (cv) { cv._a.i++; paintSp(cv); });
    }, 115);
  }

  window.PV_Campaign = {
    cfg: CFG, state: camp, open: openFromMenu,
    playing: function () { return camp.playing && !camp.waiting; },
    save: function () { return save; },
    owned: owned, medalTier: medalTier, tiers: TIER,
    // 測試用
    _test: { newRun: newRun, start: startMatch, suspend: function () { suspend(ctrlOf(), true); }, hook: hookCtrl, persist: persist, go: go,
      acquire: playAcquire, clear: playClear, unlock: unlock }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
