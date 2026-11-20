// campaign.js — 闖關模式「冠軍之路」
// 依賴：characters.js、abilities.js、netplay.js（要在它們之後載入）、char-select.js（頭像）
// 做法跟連線對戰的房主一樣：直接設定兩邊角色後把遊戲本體切到 startOfNewGame，
// 比賽結束時攔下來不回標題畫面，改顯示闖關面板。進度存在 localStorage。
(function () {
  'use strict';
  if (!window.PV_CHARS) return;
  var CH = window.PV_CHARS;
  var KEY = 'pv-campaign-v1';
  var W = 432, H = 304, NET_X = 216, FLOOR_Y = 270;

  // ============================================================
  // 可調整的數值（關卡、強度、魔王）都集中在這裡
  // ============================================================
  var CFG = {
    hearts: 3,
    // 分出勝負後停幾幀再跳出結果（讓獲勝／落敗動作播一下）
    endHold: 55,
    zones: [
      { name: '新手草原', tint: 0xFFFFFF, score: 5, fixed: ['magikarp', 'psyduck', 'snorlax'] },
      { name: '道館連戰', tint: 0xFFC79E, score: 5, pool: ['dugtrio', 'jigglypuff', 'wobbuffet', 'mrmime', 'meowth'], draw: 3 },
      { name: '強敵之塔', tint: 0x7F8EDC, score: 7, pool: ['farfetchd', 'jolteon', 'gengar', 'flareon', 'electrode'], draw: 2, last: 'dragonite' },
      { name: '最終戰', boss: true }
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

  // ============================================================
  // 存檔
  // ============================================================
  var save = { run: null, medals: {} };
  function validRun(r) {
    if (!r || typeof r !== 'object' || !CH.byId[r.char] || !Array.isArray(r.order) || r.order.length !== STAGES) return false;
    for (var i = 0; i < r.order.length; i++) if (!CH.byId[r.order[i]]) return false;
    return r.idx >= 0 && r.idx < STAGES && r.hearts >= 1 && r.hearts <= CFG.hearts;
  }
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && typeof o === 'object') {
        if (o.medals && typeof o.medals === 'object') {
          CH.ids.forEach(function (id) {
            var m = o.medals[id];
            if (m && m.n > 0) save.medals[id] = { n: Math.floor(+m.n) || 1, frames: +m.frames || 0, lost: +m.lost || 0 };
          });
        }
        if (validRun(o.run)) {
          save.run = { char: o.run.char, order: o.run.order.slice(), idx: Math.floor(o.run.idx), hearts: Math.floor(o.run.hearts),
            bossPhase: Math.min(3, Math.max(1, Math.floor(+o.run.bossPhase) || 1)), frames: +o.run.frames || 0, lost: +o.run.lost || 0 };
        }
      }
    } catch (e) {}
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function buildOrder(char) {
    var order = [];
    CFG.zones.forEach(function (z) {
      if (z.boss) { order.push('mewtwo'); return; }
      if (z.fixed) order = order.concat(z.fixed);
      if (z.pool) order = order.concat(shuffle(z.pool.filter(function (id) { return id !== char; })).slice(0, z.draw));   // 不抽到跟自己一樣的
      if (z.last) order.push(z.last);
    });
    return order;
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
    waiting: false,     // 兩關之間：畫面停在結算，等玩家按下一步
    wantStart: false,   // 遊戲本體還沒載好，載好就開打
    opp: '', diff: null, proxy: null, ai1: newAi(), ai2: newAi(),
    endT: 0, prevState: null, saved: null, tuneOrig: null,
    boss: null, tut: 0, speedEvery: 0, spd: 0, tick: 0,
    view: 'home', banner: null, pick: null, lastRun: null, onFinish: null
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
  function setBgmSpeed(c, v) {
    try { var b = c.audio.sounds.bgm; [b.center, b.left, b.right].forEach(function (s) { if (s) s.speed = v; }); } catch (e) {}
  }
  function scoreBoards(c, on) { try { c.view.game.scoreBoards[0].visible = on; c.view.game.scoreBoards[1].visible = on; } catch (e) {} }
  function waitState() { this.view.game.drawCloudsAndWave(); }

  // ============================================================
  // 開打／結束／離開
  // ============================================================
  function startMatch() {
    var run = save.run;
    if (!run) return;
    if (netBusy()) { camp.banner = { kind: 'lose', title: '連線房間開著', text: '先離開連線房間，才能闖關。' }; show('stage'); return; }
    var c = ctrlOf();
    if (!c) { ensureGame(); camp.wantStart = true; render(); return; }
    camp.wantStart = false;
    var ph = c.physics, p1 = ph.player1, p2 = ph.player2, idx = run.idx, z = zoneOf(idx);
    if (!camp.saved) camp.saved = { c1: p1.character, c2: p2.character, k1: p1.isComputer, k2: p2.isComputer, win: c.winningScore, practice: !!c.isPracticeMode };
    camp.opp = run.order[idx];
    p1.character = run.char; p2.character = camp.opp;
    p1.isComputer = !!camp.proxy; p2.isComputer = true;
    if (c.isPracticeMode) c.isPracticeMode = false;
    c.winningScore = z.boss ? CFG.boss.hp : z.score;
    c.paused = false;
    c.slowMotionFramesLeft = 0;
    c.view.intro.visible = false;
    c.view.menu.visible = false;
    c.frameCounter = 0;
    c.noInputFrameCounter = 0;
    c.view.game.visible = false;                     // 關掉再開，上一場的 Game Set 訊息才會收起來
    try { c.audio.sounds.bgm.stop(); } catch (e) {}
    c.state = c.startOfNewGame;

    camp.playing = true; camp.waiting = false; camp.endT = 0; camp.prevState = null;
    camp.diff = CFG.diff[idx]; camp.ai1 = newAi(); camp.ai2 = newAi();
    camp.boss = null; camp.tut = 0; camp.speedEvery = 0; camp.spd = 0;
    restoreTuning();
    setBgmSpeed(c, 1);
    if (z.boss) {
      camp.boss = { phase: run.bossPhase || 1, init: true, pending: 0, cut: 0, next: 0 };
      applyPhase(c, camp.boss.phase, false);
      scoreBoards(c, false);
    } else {
      setTint(c, z.tint);
      scoreBoards(c, true);
    }
    // 第一關是教學：鯉魚王不會隨機進化，玩家拿到 3 分時固定進化一次給他看
    if (idx === 0 && camp.opp === 'magikarp' && run.char !== 'magikarp') {
      camp.tut = 1;
      setTuning({ magikarpEvolveChance: 0, magikarpReceiveEvolve: 0 });
    }
    hide();
  }

  function finish(c) {
    var run = save.run, win = !!c.physics.player1.isWinner, boss = !!camp.boss;
    camp.waiting = true;
    c.state = waitState;
    restoreTuning(); camp.speedEvery = 0; camp.tut = 0; setBgmSpeed(c, 1);
    var view = 'stage';
    if (win) {
      if (run.idx >= STAGES - 1) {
        var m = save.medals[run.char] || { n: 0, frames: 0, lost: 0 };
        m.n++;
        if (!m.frames || run.frames < m.frames) m.frames = run.frames;
        if (m.n === 1 || run.lost < m.lost) m.lost = run.lost;
        save.medals[run.char] = m;
        camp.lastRun = run;
        save.run = null;
        view = 'clear';
      } else {
        run.idx++;
        run.bossPhase = 1;
        var nz = zoneIdx(run.idx);
        camp.banner = { kind: 'win', title: '過關！', text: nz !== zoneIdx(run.idx - 1) ? '進入「' + CFG.zones[nz].name + '」。' : '' };
      }
    } else {
      run.lost++;
      run.hearts--;
      if (run.hearts <= 0) {
        run.hearts = CFG.hearts;
        if (boss) {
          run.bossPhase = 1;
          camp.banner = { kind: 'lose', title: '心用完了', text: '補滿 ' + CFG.hearts + ' 顆心，從超夢的第一階段重新挑戰。' };
        } else {
          run.idx = ZONE_START[zoneIdx(run.idx)];
          camp.banner = { kind: 'lose', title: '心用完了', text: '補滿 ' + CFG.hearts + ' 顆心，回到「' + zoneOf(run.idx).name + '」第一關。' };
        }
      } else {
        camp.banner = { kind: 'lose', title: '輸了…', text: boss && run.bossPhase > 1 ? '扣一顆心，從第 ' + run.bossPhase + ' 階段再打。' : '扣一顆心，這一關再打一次。' };
      }
    }
    persist();
    if (camp.onFinish) { try { camp.onFinish(win); } catch (e) {} }
    if (!window._pvSim) show(view);
  }

  // 離開闖關模式：把角色、分數設定、場地都還原。restart：順便把遊戲本體送回標題畫面
  function suspend(c, restart) {
    if (!camp.playing) return;
    camp.playing = false; camp.waiting = false; camp.boss = null; camp.tut = 0; camp.speedEvery = 0; camp.wantStart = false;
    restoreTuning();
    if (c) {
      setTint(c, 0xFFFFFF);
      setBgmSpeed(c, 1);
      var s = camp.saved;
      if (s) {
        c.physics.player1.character = s.c1; c.physics.player2.character = s.c2;
        c.physics.player1.isComputer = s.k1; c.physics.player2.isComputer = s.k2;
        c.winningScore = s.win;
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
    var ph = c.physics, p1 = ph.player1, p2 = ph.player2;
    // 比賽中從角色面板換角色不算數（百變怪自己會變身，不管它）
    if (run.char !== 'ditto' && p1.character !== run.char) p1.character = run.char;
    if (p2.character !== camp.opp) p2.character = camp.opp;
    p1.isComputer = !!camp.proxy; p2.isComputer = true;
    if (!camp.proxy) {
      // 兩組按鍵（和兩邊的觸控）都能控制自己
      var k0 = c.keyboardArray[0], k1 = c.keyboardArray[1];
      if (!k0.xDirection) k0.xDirection = k1.xDirection;
      if (!k0.yDirection) k0.yDirection = k1.yDirection;
      if (k1.powerHit === 1) k0.powerHit = 1;
      if (!k0.dashRequest && k1.dashRequest) k0.dashRequest = k1.dashRequest;
    }
    if (c.state === c.round && !c.gameEnded) run.frames++;
    // 開新一場的頭一幀，分數和 gameEnded 還是上一場留下來的，所以下面這些只在對打中才看
    var live = c.state === c.round;
    if (camp.tut && live) tutorial(c);
    if (camp.boss && bossTick(c, live) === false) { drawHud(c); return false; }
    if (live && c.gameEnded && ++camp.endT >= CFG.endHold) finish(c);
    camp.prevState = c.state;
    drawHud(c);
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
    if (b.init && c.state === c.startOfNewGame && c.frameCounter >= 1) { c.scores[0] = (b.phase - 1) * B.perPhase; b.init = false; }
    if (b.cut > 0) {
      b.cut--;
      if (b.cut === B.cutMid) applyPhase(c, b.next, true);
      return false;                              // 演出中整個遊戲停住
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
    };
    return true;
  }

  // ============================================================
  // 場上的抬頭顯示（心、關卡、超夢血條）
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
  function label(g, text, x, y, size, color, align) {
    g.font = '900 ' + size + 'px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';
    g.textAlign = align || 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = Math.max(2, size / 4); g.strokeStyle = '#000';
    g.strokeText(text, x, y);
    g.fillStyle = color || '#fff'; g.fillText(text, x, y);
  }
  function bar(g, x, y, w, h, n, left, color, fromRight) {
    var gap = 2, sw = (w - gap * (n - 1)) / n;
    g.fillStyle = '#000'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
    for (var i = 0; i < n; i++) {
      var on = fromRight ? i >= n - left : i < left;
      g.fillStyle = on ? color : 'rgba(255,255,255,0.16)';
      g.fillRect(x + i * (sw + gap), y, sw, h);
      if (on) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + i * (sw + gap), y, sw, h * 0.35); }
    }
  }
  function charName(id) { var c = CH.byId[id]; return c ? c.name : id; }

  function drawHud(c) {
    if (!syncHud()) return;
    var g = hctx, run = save.run || camp.lastRun, t = camp.tick;
    g.clearRect(0, 0, W, H);
    if (!run || !c.view.game.visible) return;
    var b = camp.boss, lite = window._pvFxLite && window._pvFxLite();
    if (b) {
      var B = CFG.boss, phase = b.phase;
      // 場地氣氛：往上飄的念力光點、偶爾的閃電
      if (phase >= 2) {
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
          for (var k = 1; k <= 6; k++) g.lineTo(lx + ((k * 37 + Math.floor(t / 110) * 13) % 31) - 15, k * 30);
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
      // 血條：左邊自己、右邊超夢
      var myHp = Math.max(0, B.playerHp - c.scores[1]), bossHp = Math.max(0, B.hp - c.scores[0]);
      label(g, charName(run.char), 16, 11, 10, '#fff', 'left');
      bar(g, 16, 19, 150, 9, B.playerHp, myHp, myHp <= 1 ? '#FF5252' : '#69F0AE', false);
      label(g, '超夢', 416, 11, 10, '#E1BEE7', 'right');
      bar(g, 266, 19, 150, 9, B.hp, bossHp, phase === 3 ? '#FF4081' : '#B048FF', true);
      for (var q = 1; q < 3; q++) { g.fillStyle = '#000'; g.fillRect(266 + 150 * q / 3 - 1.5, 15, 3, 17); }
      label(g, ['第一階段', '第二階段', '第三階段'][phase - 1], NET_X, 12, 9, phase === 3 ? '#FF80AB' : '#E1BEE7');
      for (var h1 = 0; h1 < CFG.hearts; h1++) heart(g, NET_X - 14 + h1 * 14, 27, 5, h1 < run.hearts);
      // 換階段的演出
      if (b.cut > 0) {
        var k2 = 1 - b.cut / B.cutFrames;
        g.globalAlpha = 0.55 * Math.sin(Math.PI * Math.min(1, k2 * 1.2)); g.fillStyle = '#14002A'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
        var sz = 30 + 14 * Math.max(0, 1 - k2 * 4);
        label(g, b.next === 3 ? '第三階段' : '第二階段', NET_X, 118, sz, b.next === 3 ? '#FF80AB' : '#D7A8FF');
        label(g, b.next === 3 ? '全場加速，念力更頻繁' : '念力增強', NET_X, 150, 12, '#fff');
      }
      if (b.flash > 0) { if (!lite) { g.globalAlpha = 0.5 * b.flash / 6; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; } b.flash--; }
    } else if (run === save.run) {
      for (var h2 = 0; h2 < CFG.hearts; h2++) heart(g, NET_X - 14 + h2 * 14, 14, 5.5, h2 < run.hearts);
      label(g, zoneOf(run.idx).name + '  ' + (run.idx + 1) + '/' + STAGES, NET_X, 30, 9, '#fff');
    }
  }

  // ============================================================
  // 面板
  // ============================================================
  var css = [
    '#pv-camp{position:fixed;inset:0;z-index:20002;display:none;align-items:center;justify-content:center;background:rgba(10,12,24,.82);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#fff}',
    '#pv-camp.open{display:flex}',
    '#pv-camp .box{width:min(680px,96vw);max-height:94vh;max-height:calc(100dvh - 16px);overflow:auto;background:#1b1e33;border:2px solid #3a3f66;border-radius:14px;padding:14px 16px 16px;box-shadow:0 12px 40px rgba(0,0,0,.5);box-sizing:border-box}',
    '#pv-camp h2{margin:0 0 8px;font-size:19px;display:flex;justify-content:space-between;align-items:center}',
    '#pv-camp h2 small{font-size:12px;font-weight:500;opacity:.6;margin-left:8px}',
    '#pv-camp .x{background:none;border:0;color:#fff;font-size:24px;cursor:pointer;opacity:.7;padding:0 6px}',
    '#pv-camp .row{display:flex;gap:8px;align-items:center;margin:10px 0 0}',
    '#pv-camp button.b{flex:1;padding:11px 10px;border-radius:10px;border:0;background:#3f51b5;color:#fff;font-size:15px;font-weight:700;cursor:pointer}',
    '#pv-camp button.b.alt{background:#2e3358;flex:0 0 auto;padding:11px 14px}',
    '#pv-camp button.b.go{background:#e53935}',
    '#pv-camp button.b:disabled{opacity:.45;cursor:default}',
    '#pv-camp .map{display:flex;gap:3px;align-items:flex-end;margin:6px 0 4px}',
    '#pv-camp .zone{flex:1 1 0;min-width:0}',
    '#pv-camp .zone.boss{flex:0.42 1 0}',
    '#pv-camp .zone .zn{font-size:11px;opacity:.6;text-align:center;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#pv-camp .zone .ns{display:flex;gap:3px}',
    '#pv-camp .node{flex:1 1 0;min-width:0;aspect-ratio:1;border-radius:9px;background:#262a47;border:2px solid #333863;display:flex;align-items:center;justify-content:center;position:relative;font-weight:900;color:#6b72b8;font-size:16px}',
    '#pv-camp .node canvas{width:88%;height:88%;image-rendering:auto}',
    '#pv-camp .node.done{border-color:#2e7d32;background:#1d3a25}#pv-camp .node.done canvas{opacity:.45}',
    '#pv-camp .node.done::after{content:"✓";position:absolute;right:2px;bottom:-1px;font-size:13px;color:#69F0AE}',
    '#pv-camp .node.cur{border-color:#FFE14D;background:#4a4320;box-shadow:0 0 10px rgba(255,225,77,.5)}',
    '#pv-camp .node.bossn{border-color:#7b3fc4;background:#2c1b47}',
    '#pv-camp .cont{display:flex;align-items:center;gap:10px;background:#262a47;border-radius:10px;padding:8px 10px;margin-top:8px}',
    '#pv-camp .cont canvas{width:44px;height:44px}',
    '#pv-camp .cont .inf{flex:1;min-width:0;font-size:14px;line-height:1.5}',
    '#pv-camp .cont .inf b{font-size:15px}',
    '#pv-camp .hearts{color:#FF3B5C;letter-spacing:2px;font-size:16px}#pv-camp .hearts i{color:#555a80;font-style:normal}',
    '#pv-camp .sub{font-size:13px;opacity:.75;margin:12px 0 6px;display:flex;justify-content:space-between}',
    '#pv-camp .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:6px}',
    '#pv-camp .card{position:relative;background:#262a47;border:2px solid #333863;border-radius:10px;padding:4px 2px 5px;text-align:center;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}',
    '#pv-camp .card canvas{width:46px;height:46px;display:block;margin:0 auto;filter:grayscale(.85) brightness(.75)}',
    '#pv-camp .card.won canvas{filter:none}',
    '#pv-camp .card.won{background:#3a3320;border-color:#8a7526}',
    '#pv-camp .card.sel{border-color:#42A5F5;background:#1f3550}#pv-camp .card.sel canvas{filter:none}',
    '#pv-camp .card .nm{font-size:12px;font-weight:700}',
    '#pv-camp .card .md{position:absolute;top:1px;right:3px;font-size:12px;color:#FFD54F;font-weight:900}',
    '#pv-camp .vs{display:flex;align-items:center;justify-content:center;gap:14px;margin:8px 0}',
    '#pv-camp .vs .side{text-align:center;font-size:14px;font-weight:700}',
    '#pv-camp .vs canvas{width:84px;height:84px;display:block;margin:0 auto 2px}',
    '#pv-camp .vs .r canvas{transform:scaleX(-1)}',
    '#pv-camp .vs .mid{font-size:26px;font-weight:900;color:#FFE14D}',
    '#pv-camp .ban{border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:14px;line-height:1.5}',
    '#pv-camp .ban b{font-size:18px;margin-right:8px}',
    '#pv-camp .ban.win{background:#1d3a25;border:1px solid #2e7d32}#pv-camp .ban.lose{background:#40202a;border:1px solid #a33}',
    '#pv-camp .desc{padding:8px 12px;border-radius:10px;background:#141729;font-size:13px;line-height:1.6}',
    '#pv-camp .desc b{margin-right:6px}',
    '#pv-camp .rule{font-size:13px;opacity:.85;margin-top:8px;line-height:1.6}',
    '#pv-camp .big{text-align:center;font-size:26px;font-weight:900;color:#FFD54F;margin:6px 0}',
    '#pv-camp .stat{text-align:center;font-size:14px;line-height:1.9}',
    '#pv-camp .note{font-size:12px;opacity:.55;margin-top:10px;line-height:1.55}',
    '@media (max-height:480px){#pv-camp .box{padding:8px 12px 10px}#pv-camp h2{font-size:16px;margin-bottom:4px}#pv-camp .card canvas{width:34px;height:34px}#pv-camp .grid{grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:4px}#pv-camp .vs canvas{width:56px;height:56px}#pv-camp .vs{margin:4px 0}#pv-camp .zone .zn{display:none}#pv-camp .node{border-radius:6px}#pv-camp .map{max-width:420px;margin:4px auto}#pv-camp .note{display:none}#pv-camp button.b{padding:8px 10px}#pv-camp .row{margin-top:6px}#pv-camp .desc{font-size:12px;line-height:1.45;padding:6px 10px}#pv-camp .rule{margin-top:4px;font-size:12px}#pv-camp .sub{margin:6px 0 4px}}'
  ].join('\n');

  var root = null, box = null, confirmReset = false;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function portrait(id, size) {
    var cs = window.PV_CharSelect;
    if (cs && cs.portrait) return cs.portrait(id, size || 64);
    var c = document.createElement('canvas'); c.width = c.height = size || 64; return c;
  }
  function slot(parent, sel, id, size) { var e = parent.querySelector(sel); if (e) e.appendChild(portrait(id, size)); }
  function heartsHtml(n) { var s = ''; for (var i = 0; i < CFG.hearts; i++) s += i < n ? '♥' : '<i>♥</i>'; return '<span class="hearts">' + s + '</span>'; }
  function fmtTime(frames) { var s = Math.round(frames / 25); return Math.floor(s / 60) + ' 分 ' + ('0' + (s % 60)).slice(-2) + ' 秒'; }
  function medalCount() { return Object.keys(save.medals).length; }

  function mapHtml(run) {
    var h = '<div class="map">';
    CFG.zones.forEach(function (z, zi) {
      var from = ZONE_START[zi], to = zi + 1 < ZONE_START.length ? ZONE_START[zi + 1] : STAGES;
      h += '<div class="zone' + (z.boss ? ' boss' : '') + '"><div class="zn">' + esc(z.name) + '</div><div class="ns">';
      for (var i = from; i < to; i++) {
        var cls = 'node' + (z.boss ? ' bossn' : ''), known = z.boss || (run && i <= run.idx) || !!z.fixed;
        if (run && i < run.idx) cls += ' done'; else if (run && i === run.idx) cls += ' cur';
        h += '<div class="' + cls + '" data-node="' + (known ? (run ? run.order[i] : (z.boss ? 'mewtwo' : z.fixed[i - from])) : '') + '">' + (known ? '' : '?') + '</div>';
      }
      h += '</div></div>';
    });
    return h + '</div>';
  }
  function fillMap() {
    box.querySelectorAll('.node[data-node]').forEach(function (n) { var id = n.getAttribute('data-node'); if (id) n.appendChild(portrait(id, 64)); });
  }

  function render() {
    if (!root) return;
    var run = save.run, v = camp.view, h = '';
    if (v === 'stage' && !run) v = camp.view = 'home';
    if (v === 'clear' && !camp.lastRun) v = camp.view = 'home';

    if (v === 'home') {
      var pick = camp.pick && CH.byId[camp.pick] ? camp.pick : null;
      h += '<h2><span>冠軍之路<small>獎章 ' + medalCount() + ' / ' + CH.ids.length + '</small></span><button class="x" data-a="close" type="button" title="關閉">✕</button></h2>';
      h += mapHtml(run);
      if (run) {
        h += '<div class="cont"><span data-p="run"></span><div class="inf"><b>' + esc(charName(run.char)) + '</b>　' + heartsHtml(run.hearts) +
          '<br>進行到第 ' + (run.idx + 1) + ' 關：' + esc(charName(run.order[run.idx])) + '</div></div>' +
          '<div class="row"><button class="b go" data-a="continue" type="button">繼續闖關</button>' +
          '<button class="b alt" data-a="reset" type="button">' + (confirmReset ? '再按一次確定放棄' : '放棄這一輪') + '</button></div>';
      }
      h += '<div class="sub"><span>' + (run ? '或選一隻角色重新開始（會放棄目前這一輪）' : '選一隻角色，打完 9 關後挑戰超夢') + '</span><span>亮起來的＝已通關</span></div><div class="grid">';
      CH.list.forEach(function (c) {
        var m = save.medals[c.id];
        h += '<div class="card' + (m ? ' won' : '') + (pick === c.id ? ' sel' : '') + '" data-pick="' + c.id + '"><span data-p="' + c.id + '"></span><div class="nm">' + esc(c.name) + '</div>' +
          (m ? '<span class="md">★' + (m.n > 1 ? m.n : '') + '</span>' : '') + '</div>';
      });
      h += '</div>';
      if (pick) {
        var pm = save.medals[pick], pc = CH.byId[pick];
        h += '<div class="desc" style="margin-top:8px"><b style="color:' + pc.color + '">' + esc(pc.name) + '・' + esc(pc.skill) + '</b>' + esc(pc.desc) +
          (pm ? '<br>最佳紀錄：' + fmtTime(pm.frames) + '，輸 ' + pm.lost + ' 場' : '') + '</div>';
      }
      h += '<div class="row"><button class="b' + (run ? '' : ' go') + '" data-a="new" type="button"' + (pick ? '' : ' disabled') + '>' +
        (pick ? '用' + esc(charName(pick)) + '開始新的一輪' : '先點一隻角色') + '</button></div>';
      h += '<div class="note">整輪 ' + CFG.hearts + ' 顆心：輸一場扣一顆並重打；心用完會補滿、退回該區第一關。每隻角色通關都會點亮一面獎章。</div>';
    } else if (v === 'stage') {
      var idx = run.idx, z = zoneOf(idx), opp = CH.byId[run.order[idx]], B = CFG.boss;
      h += '<h2><span>' + (z.boss ? '最終戰' : '第 ' + (idx + 1) + ' 關') + '<small>' + esc(z.name) + '　' + (idx + 1) + ' / ' + STAGES + '</small></span><button class="x" data-a="close" type="button" title="離開">✕</button></h2>';
      if (camp.banner) h += '<div class="ban ' + camp.banner.kind + '"><b>' + esc(camp.banner.title) + '</b>' + esc(camp.banner.text) + '</div>';
      h += mapHtml(run);
      h += '<div class="vs"><div class="side l"><span data-p="' + run.char + '" data-s="96"></span>' + esc(charName(run.char)) + '</div><div class="mid">VS</div>' +
        '<div class="side r"><span data-p="' + opp.id + '" data-s="96"></span>' + esc(opp.name) + '</div></div>';
      h += '<div class="desc"><b style="color:' + opp.color + '">' + esc(opp.name) + '・' + esc(opp.skill) + '</b>' + esc(opp.desc) + '</div>';
      if (z.boss) {
        h += '<div class="rule">超夢有 ' + B.hp + ' 格血、分三個階段；你有 ' + B.playerHp + ' 格。得一分就打掉對方一格。' +
          (run.bossPhase > 1 ? '<b>這次從第 ' + run.bossPhase + ' 階段開始。</b>' : '打到第二階段場地會變。') + '　' + heartsHtml(run.hearts) + '</div>';
      } else {
        h += '<div class="rule">先得 ' + z.score + ' 分過關。' + (idx === 0 ? '左右移動、跳起來再按殺球鍵把球砸過去。' : '') + '　' + heartsHtml(run.hearts) + '</div>';
      }
      h += '<div class="row"><button class="b go" data-a="fight" type="button"' + (camp.wantStart ? ' disabled' : '') + '>' +
        (camp.wantStart ? '遊戲載入中…' : camp.banner && camp.banner.kind === 'lose' ? '再打一次' : '開打') + '</button>' +
        '<button class="b alt" data-a="home" type="button">總覽</button></div>';
    } else if (v === 'clear') {
      var lr = camp.lastRun, md = save.medals[lr.char] || { n: 1 };
      h += '<h2><span>冠軍之路</span><button class="x" data-a="close" type="button" title="關閉">✕</button></h2>';
      h += '<div class="big">通關！打倒超夢了</div>';
      h += '<div class="vs"><div class="side"><span data-p="' + lr.char + '" data-s="96"></span>' + esc(charName(lr.char)) + '　★</div></div>';
      h += '<div class="stat">用時 ' + fmtTime(lr.frames) + '　輸了 ' + lr.lost + ' 場<br>' + esc(charName(lr.char)) + '的獎章已點亮（第 ' + md.n + ' 次通關）　獎章 ' + medalCount() + ' / ' + CH.ids.length + '</div>';
      h += '<div class="row"><button class="b go" data-a="home" type="button">換一隻角色再挑戰</button></div>';
    } else if (v === 'pause') {
      h += '<h2><span>闖關中<small>已暫停</small></span><button class="x" data-a="resume" type="button" title="回到比賽">✕</button></h2>';
      if (run) h += mapHtml(run) + '<div class="rule">' + esc(charName(run.char)) + ' 對 ' + esc(charName(run.order[run.idx])) + '　' + heartsHtml(run.hearts) + '</div>';
      h += '<div class="row"><button class="b go" data-a="resume" type="button">回到比賽</button><button class="b alt" data-a="quit" type="button">離開闖關</button></div>';
      h += '<div class="note">離開不會扣心，進度會留著，下次從這一關重新打。</div>';
    }
    box.innerHTML = h;
    box.querySelectorAll('[data-p]').forEach(function (e) {
      var id = e.getAttribute('data-p');
      if (id === 'run') id = run ? run.char : '';
      if (id) e.appendChild(portrait(id, +e.getAttribute('data-s') || 64));
    });
    fillMap();
  }

  function show(view) {
    if (!root) return;
    if (view) camp.view = view;
    confirmReset = false;
    render();
    root.style.zIndex = (window._pvZ = Math.max(window._pvZ || 20010, 20010) + 1);
    root.classList.add('open');
    document.querySelectorAll('.dropdown.show,.submenu.show').forEach(function (d) { d.classList.remove('show'); });
    document.querySelectorAll('.dropdown-btn.open,.submenu-btn.open').forEach(function (d) { d.classList.remove('open'); });
  }
  function hide() { if (root) root.classList.remove('open'); }
  function isOpen() { return !!(root && root.classList.contains('open')); }

  function act(a, el) {
    var c = ctrlOf();
    if (a === 'close') {
      hide();
      if (camp.waiting) suspend(c, true);        // 兩關之間關掉面板＝先不玩了，回標題
      camp.wantStart = false;
    } else if (a === 'home') { camp.banner = null; show('home'); }
    else if (a === 'continue') { camp.banner = null; show('stage'); }
    else if (a === 'reset') {
      if (!confirmReset) { confirmReset = true; render(); return; }
      save.run = null; persist(); confirmReset = false;
      if (camp.waiting) suspend(c, true);
      render();
    } else if (a === 'new') {
      if (!camp.pick) return;
      if (save.run && !confirmReset) { confirmReset = true; el.textContent = '會放棄目前這一輪，再按一次確定'; return; }
      newRun(camp.pick);
      camp.banner = null;
      show('stage');
    } else if (a === 'fight') { camp.banner = null; startMatch(); }
    else if (a === 'resume') { if (c) c.paused = false; hide(); }
    else if (a === 'quit') { if (c) c.paused = false; suspend(c, true); camp.banner = null; show('home'); }
  }

  function openFromMenu() {
    if (netBusy()) return;
    ensureGame();
    var c = ctrlOf();
    if (camp.playing && !camp.waiting && c) { c.paused = true; show('pause'); return; }
    if (camp.waiting) { show(camp.view === 'clear' ? 'clear' : 'stage'); return; }
    camp.pick = camp.pick || (save.run ? null : (window.PV_CharSelect && window.PV_CharSelect.current ? window.PV_CharSelect.current(1) : null));
    show('home');
  }

  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    root = document.createElement('div'); root.id = 'pv-camp';
    root.innerHTML = '<div class="box" role="dialog" aria-label="闖關模式"></div>';
    box = root.querySelector('.box');
    document.body.appendChild(root);
    box.addEventListener('click', function (e) {
      var t = e.target, b = t.closest ? t.closest('[data-a]') : null, card = t.closest ? t.closest('[data-pick]') : null;
      if (b && !b.disabled) { act(b.getAttribute('data-a'), b); return; }
      if (card) { camp.pick = card.getAttribute('data-pick'); confirmReset = false; render(); }
    });
    ['keydown', 'keyup'].forEach(function (ev) {
      root.addEventListener(ev, function (e) { if (e.code === 'Escape' && ev === 'keydown' && isOpen()) { act(camp.view === 'pause' ? 'resume' : 'close'); e.stopPropagation(); } });
    });
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && isOpen()) { act(camp.view === 'pause' ? 'resume' : 'close'); e.stopImmediatePropagation(); }
    }, true);

    var left = document.querySelector('#menu-bar .btn-container.left');
    if (left) {
      var wrap = document.createElement('div'); wrap.className = 'relative-container';
      var btn = document.createElement('button'); btn.type = 'button'; btn.id = 'pv-camp-btn'; btn.className = 'btn'; btn.textContent = '闖關';
      btn.onclick = function (e) { e.stopPropagation(); openFromMenu(); };
      wrap.appendChild(btn);
      var netBtn = document.getElementById('pv-net-btn');
      left.insertBefore(wrap, netBtn && netBtn.parentNode && netBtn.parentNode.parentNode === left ? netBtn.parentNode : left.querySelector('.color-scheme-toggle-switch-container'));
    }
  }

  function init() {
    load();
    build();
    setInterval(function () {
      hookCtrl();
      if (camp.wantStart && ctrlOf()) startMatch();
    }, 300);
  }

  window.PV_Campaign = {
    cfg: CFG, state: camp, open: openFromMenu,
    playing: function () { return camp.playing && !camp.waiting; },
    save: function () { return save; },
    // 測試用：直接從某一關開打（proxy：讓電腦代替玩家，格式同 CFG.diff 的一格）
    _test: { newRun: newRun, start: startMatch, suspend: function () { suspend(ctrlOf(), true); }, hook: hookCtrl, persist: persist }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
