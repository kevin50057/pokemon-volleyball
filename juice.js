// juice.js — 打擊感：頓幀、畫面震動與鏡頭衝擊、球與角色的壓扁伸展、火花與塵土、合成衝擊音
// 依賴：characters.js、abilities.js（包住 window._pvTick 與 window._pvDrawBall）
// 遊戲邏輯是 25 FPS；震動、粒子用 requestAnimationFrame 以螢幕更新率（通常 60 FPS）畫，看起來比較滑順。
(function () {
  'use strict';

  var CHARS = window.PV_CHARS ? window.PV_CHARS.byId : {};
  var W = 432, H = 304, GROUND_BALL_Y = 252, GROUND_Y = 244, FLOOR_Y = 270;

  // ---------- 可調整 ----------
  var JUICE = {
    hitStopBySpeed: [[24, 3], [18, 2], [0, 1]], // 殺球頓幀：球速 ≥24 停 3 幀、≥18 停 2 幀、其他 1 幀（1 幀 = 40ms）
    hitStopGround: 0,     // 球落地得分：遊戲本體得分後本來就有慢動作（每幀 200ms），再頓幀會變成凍結 1 秒
    hitStopFinal: 0,      // 決勝分
    stopCooldown: 500,    // 這段時間內已經頓過，下一次殺球只停 1 幀、落地只停 3 幀（毫秒）
    shakeSpike: 3,        // 重擊／技能殺球的震動強度（遊戲座標的像素）；一般殺球不震
    shakeGround: 3.5,     // 落地只上下震
    kickSpike: 1.5,       // 殺球時鏡頭往球飛的方向頓一下
    zoomSpike: 0.008,     // 鏡頭往前衝的比例
    zoomGround: 0.015,
    sparks: 16,           // 殺球火花數量
    shakeDown: 1.6,       // 往下砸的殺球：輕震（上下）
    shakeSkill: 1.5,      // 技能級（L3）
    shakeUlt: 4,          // 必殺（L4）
    kickUlt: 2.5,
    zoomUlt: 0.02,
    ultCooldown: 45000,   // 同一位玩家的必殺冷卻；冷卻中降成技能級（毫秒）
    ultGlobal: 20000,     // 兩位玩家合計：必殺之間至少隔這麼久
    skillShakeCD: 8000,   // 同一位玩家技能級的震動冷卻：冷卻中只有光環和音效、不震
    shakeBudget: 2.0,     // 10 秒內震動累計超過這個量，之後的震動減半
    sound: 1.0,           // 合成衝擊音的音量（0 = 關閉）
    powerHitSample: 0.5   // 原版殺球音效的音量倍率（1 = 原本大小）
  };

  // ---------- 特效：完整／精簡 ----------
  // 精簡：不震、不推鏡頭、不閃全畫面；頓幀、火花、衝擊環和音效照留。系統開了「減少動態效果」就預設精簡
  var LITE_KEY = 'pv-fx-lite';
  var liteMode = (function () {
    try { var v = localStorage.getItem(LITE_KEY); if (v === '1') return true; if (v === '0') return false; } catch (e) {}
    try { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  })();
  function lite() { return liteMode; }
  // 統計（給測試用）：實際震了幾次、各級觸發幾次
  var stats = window._pvFxStats = { shake: 0, spike1: 0, spike2: 0, down: 0, skill: 0, ult: 0, ultDowngraded: 0, ground: 0, fullFlash: 0 };
  window._pvFxLite = lite;

  // ---------- 狀態 ----------
  var hitStop = 0;
  var trauma = 0;            // 0~1，震動量（平方後使用，越大越劇烈）
  var traumaScale = 0;
  var traumaVertical = false;
  var kick = { x: 0, y: 0, t0: -1 };   // 有方向的鏡頭頓挫
  var groundLock = false, groundT = 0;
  var lastStopT = -1e9;            // 上一次頓幀的時間，避免近距離對殺連續凍結
  var ghosts = [];                 // 電光一閃的角色殘影（PIXI sprite）
  var viewRef = null;
  var latched = [0, 0];
  var scoreFx = [{ t0: -1 }, { t0: -1 }];
  var lastScores = [0, 0];
  var trailUntil = 0, pendingTrail = false;          // pendingTrail：false 或拖尾毫秒數
  var lastSpikeLvl = [0, 0], lastSpikeT = 0, rallyMaxLvl = 0;   // 這一球最後是幾級打過來的（得分特效用）
  var ultAt = [-1e9, -1e9], skillAt = [-1e9, -1e9];               // 頓幀期間按下的殺球鍵，頓幀結束後補上
  var zoom = 0;              // 鏡頭衝擊
  var particles = [];
  var rings = [];
  var flashes = [];
  var lines = [];            // 衝擊瞬間的放射速度線
  var ballFx = { t0: -1, ang: 0, power: 0, hold: false, ground: false };
  var playerFx = [{ t0: -1, kind: '' }, { t0: -1, kind: '' }];
  var prev = { ballY: 0, p: [{ y: GROUND_Y, state: 0, hit: false }, { y: GROUND_Y, state: 0, hit: false }] };
  var lastHitColor = '#FFFFFF', lastHitType = '電';

  function now() { return performance.now(); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function sim() { return !!window._pvSim; }

  // ============================================================
  // 事件偵測（每個遊戲幀，在物理之前；看到的是上一幀物理運算的結果）
  // ============================================================
  // 原版殺球音效又長又嘶，會蓋過「砰」的低頻；播放前把它壓到一般音效的一半音量
  var sampleDucked = false;
  function duckSample(ctrl) {
    var snd = ctrl.audio && ctrl.audio.sounds, o = snd && snd.powerHit;
    if (!o || sampleDucked) return;
    sampleDucked = true;
    var play = o.play.bind(o);
    o.play = function (e) { o.volume = snd.pika.center.volume * JUICE.powerHitSample; return play(e); };
  }

  var innerTick = window._pvTick;
  var ctrlRef = null;
  window._pvTick = function (ctrl) {
    ctrlRef = ctrl;
    duckSample(ctrl);
    if (sim()) return innerTick(ctrl);
    var view = ctrl.view && ctrl.view.game, kb = ctrl.keyboardArray;

    if (hitStop > 0) {
      hitStop--;
      // 頓幀期間按的殺球鍵先記住，不要吃掉
      for (var i = 0; i < 2; i++) if (kb[i].powerHit === 1) latched[i] = 1;
      if (hitStop === 0) releaseHold();
      if (view) applySprites(view, ctrl.physics);
      return false;          // 讓 main.bundle.js 跳過這一幀的物理
    }
    for (var k = 0; k < 2; k++) {
      if (latched[k]) { kb[k].powerHit = 1; latched[k] = 0; }
    }
    return innerTick(ctrl);
  };

  function releaseHold() {
    // 頓幀結束的瞬間才開始回彈，球被「彈射」出去
    if (ballFx.hold) { ballFx.hold = false; ballFx.t0 = now(); }
    if (pendingTrail) { trailUntil = now() + (pendingTrail === true ? 200 : pendingTrail); pendingTrail = false; }   // 拖尾從球真的飛出去才開始算
  }

  function detect(ctrl) {
    var ph = ctrl.physics, ball = ph.ball, players = [ph.player1, ph.player2];

    // 得分：計分板彈跳，失分方被震一下
    if (ctrl.scores) {
      for (var si = 0; si < 2; si++) {
        if (ctrl.scores[si] > lastScores[si]) {
          scoreFx[si] = { t0: now() };
          playerFx[1 - si] = { t0: now(), kind: 'hurt' };
        }
        lastScores[si] = ctrl.scores[si];
      }
    }

    // 殺球後 200ms 內在球後面補火花，像拖著尾巴
    if (now() < trailUntil) {
      for (var ti = 0; ti < 2; ti++) {
        particles.push({ kind: 'spark', x: ball.x + rand(-6, 6), y: ball.y + rand(-6, 6),
          vx: -ball.xVelocity * rand(0.05, 0.15), vy: -ball.yVelocity * rand(0.05, 0.15),
          g: 0.15, drag: 0.85, life: rand(160, 280), t0: now(), color: lastHitColor, size: 3 });
      }
    }

    for (var i = 0; i < 2; i++) {
      var p = players[i], pp = prev.p[i];
      var hit = !!(p.isCollisionWithBallHappened || p.pvHit);   // pvHit：大蔥鴨用大蔥打到（球沒碰到身體）
      if (hit && !pp.hit) onBallHit(ctrl, p, i, ball);
      pp.hit = hit;

      // 起跳、落地、撲救
      if (pp.state === 0 && p.state === 1) playerFx[i] = { t0: now(), kind: 'jump' };
      if (pp.y < GROUND_Y - 2 && p.y >= GROUND_Y) {
        playerFx[i] = { t0: now(), kind: 'land' };
        dust(p.x, FLOOR_Y, 5, 0.6);
      }
      if (pp.state !== 3 && p.state === 3) {
        dust(p.x, FLOOR_Y, 8, 1);
        playerFx[i] = { t0: now(), kind: 'dive' };
      }
      pp.y = p.y; pp.state = p.state;
    }

    // 球落地（得分）：每回合只觸發一次，下一球發球（球回到高處）才解鎖
    // 遊戲觸地時會把球放在剛好 252、並把速度反彈成向上；只用 y 判斷會在快落地的前一幀誤判
    if (!groundLock && ball.y === GROUND_BALL_Y && ball.yVelocity < 0) { groundLock = true; onGround(ctrl, ball); }
    if (ball.y < 120) { groundLock = false; groundT = 0; }
    prev.ballY = ball.y;
  }

  var log = window._pvJuiceLog = [];
  function onBallHit(ctrl, p, idx, ball) {
    log.push({ t: now(), e: ball.isPowerHit ? 'spike' : 'hit' }); if (log.length > 50) log.shift();
    var c = CHARS[p.character];
    lastHitColor = c ? c.color : '#FFFFFF';
    lastHitType = c ? c.type : '電';
    var speed = Math.hypot(ball.xVelocity, ball.yVelocity);
    var ang = Math.atan2(ball.yVelocity, ball.xVelocity);

    if (ball.isPowerHit) {
      // 殺球分兩級：直線殺（L1）、斜殺（L2，殺球時按了上或下，球速明顯快）。
      // 更重的「技能」（L3）和「必殺」（L4）由 abilities.js 在技能真正發動時送 'skill' 事件來加碼，這裡不猜。
      var diag = speed >= 24;
      var down = diag && ball.yVelocity > 0;
      hitStop = diag ? 2 : 1;
      if (now() - lastStopT < JUICE.stopCooldown) hitStop = 1;   // 剛頓過：只停 1 幀，節奏才不會卡
      lastStopT = now();
      ballFx = { t0: now(), ang: ang, power: 1, hold: true, ground: false };
      ballRot = ang;   // 頓幀開始時直接對準方向，壓扁軸第一幀就正確
      playerFx[idx] = { t0: now(), kind: 'spike' };
      sparks(ball.x, ball.y, ang, lastHitColor, diag ? 12 : 8, diag ? 8 : 7);
      rings.push({ x: ball.x, y: ball.y, r0: 28, r1: diag ? 52 : 40, t0: now(), dur: 260, color: lastHitColor, w: 3 });
      if (diag) {
        speedLines(ball.x, ball.y, lastHitColor, 6);
        flashes.push({ x: ball.x, y: ball.y, r: 16, t0: now(), dur: 50 });
        pendingTrail = 200;
      }
      if (down) shakeEvent(0.45, JUICE.shakeDown, true);   // 往下砸：輕輕上下震一下
      lastSpikeLvl[idx] = diag ? 2 : 1;
      stats[diag ? 'spike2' : 'spike1']++; if (down) stats.down++;
      lastSpikeT = now();
      sfxSpike(ctrl, lastHitType, diag, 0);
    } else {
      // 一般擊球：小小的壓扁＋一點火花，不頓幀也不震
      ballFx = { t0: now(), ang: ang, power: 0.5, hold: false, ground: false };
      sparks(ball.x, ball.y, ang, '#FFFFFF', 4, 5);
      rings.push({ x: ball.x, y: ball.y, r0: 14, r1: 22, t0: now(), dur: 120, color: '#FFFFFF', w: 2 });
      sfxBump(ctrl);
    }
  }

  function onGround(ctrl, ball) {
    log.push({ t: now(), e: 'ground' }); if (log.length > 50) log.shift();
    var scorer = ball.x < 216 ? 1 : 0, win = ctrl.winningScore || 15;
    var final = ctrl.scores && ctrl.scores[scorer] + 1 >= win;
    // 技能／必殺直接砸地才用原本的強度；一般得分降一半（每一分都有回饋，但不刺眼）
    var big = rallyMaxLvl >= 3 && now() - lastSpikeT < 2500;
    stats.ground++;
    rallyMaxLvl = 0;
    hitStop = final ? JUICE.hitStopFinal : JUICE.hitStopGround;
    if (!final && now() - lastStopT < JUICE.stopCooldown) hitStop = Math.min(hitStop, 3);
    lastStopT = now(); groundT = now();
    shakeEvent(1, big ? JUICE.shakeGround : JUICE.shakeGround * 0.57, true);
    if (!lite()) zoom = big ? JUICE.zoomGround : JUICE.zoomGround * 0.53;
    ballFx = { t0: now(), ang: Math.PI / 2, power: 1.1, hold: hitStop > 0, ground: true };
    dust(ball.x, FLOOR_Y, 22, 1.8);
    sparks(ball.x, GROUND_BALL_Y + 6, -Math.PI / 2, lastHitColor, 14, 8, Math.PI * 0.9);
    rings.push({ x: ball.x, y: FLOOR_Y, r0: 10, r1: 110, t0: now(), dur: 380, color: lastHitColor, w: 4, flat: true });
    rings.push({ x: ball.x, y: FLOOR_Y, r0: 6, r1: 70, t0: now(), dur: 260, color: '#FFFFFF', w: 2, flat: true });
    flashes.push({ x: ball.x, y: GROUND_BALL_Y, r: 22, t0: now(), dur: 60 });
    if (final) ultimate(ball.x, GROUND_BALL_Y, lastHitColor, false);   // 決勝分：一場只有一次，給完整必殺簽名
    else flashes.push({ full: true, color: lastHitColor, alpha: big ? 0.22 : 0.10, t0: now(), dur: 160 });
    sfxGround(ctrl);
  }

  // ------------------------------------------------------------
  // 技能（L3）與必殺（L4）：abilities.js 送來 'skill' 事件
  // ------------------------------------------------------------
  function colorOfPlayer(p) { var c = p && CHARS[p.character]; return c ? c.color : '#FFFFFF'; }
  function typeOfPlayer(p) { var c = p && CHARS[p.character]; return c ? c.type : '電'; }

  function onSkill(d) {
    var p = d.player, idx = p && p.isPlayer2 ? 1 : 0;
    var lvl = d.lvl >= 4 ? 4 : 3;
    var col = d.k === 'psy' ? '#B048FF' : d.k === 'evoR' || d.k === 'red' ? '#FF1744' : d.k === 'evo' ? '#29B6F6' : colorOfPlayer(p);
    var x = +d.x || 0, y = +d.y || 0, tn = now();
    var lastAnyUlt = Math.max(ultAt[0], ultAt[1]);
    if (lvl === 4 && (tn - ultAt[idx] < JUICE.ultCooldown || tn - lastAnyUlt < JUICE.ultGlobal)) { lvl = 3; stats.ultDowngraded++; }   // 必殺冷卻中：降成技能級
    rallyMaxLvl = Math.max(rallyMaxLvl, lvl);
    lastSpikeT = tn;
    if (lvl === 4) {
      ultAt[idx] = tn;
      stats.ult++;
      ultimate(x, y, col, true, typeOfPlayer(p), d.k);
      return;
    }
    stats.skill++;
    var canShake = tn - skillAt[idx] >= JUICE.skillShakeCD;
    hitStop = Math.max(hitStop, d.v ? 0 : 2);
    if (canShake) {
      skillAt[idx] = tn;
      shakeEvent(0.5, JUICE.shakeSkill, !!d.v);
      if (!d.v && !lite()) kick = { x: (idx ? -1 : 1), y: 0.5, t0: tn };
    }
    if (d.v) {
      rings.push({ x: x, y: y, r0: 14, r1: 90, t0: tn, dur: 340, color: col, w: 4, flat: true });
    } else {
      rings.push({ x: x, y: y, r0: 28, r1: 70, t0: tn, dur: 300, color: col, w: 4 });
      rings.push({ x: x, y: y, r0: 34, r1: 86, t0: tn + 50, dur: 260, color: '#FFFFFF', w: 2 });
      speedLines(x, y, col, 10);
      pendingTrail = 200;
    }
    if (ctrlRef) {
      if (d.k === 'psy') sfxPsy(ctrlRef);
      else if (d.k === 'evo') sfxEvolve(ctrlRef, false);
      else sfxSkill(ctrlRef, typeOfPlayer(p), 1);
    }
  }

  // 必殺的專屬簽名：先暗一下，再爆出屬性色全畫面閃光、三層大環、全畫面放射線、長拖尾、低頻轟聲。
  // 「壓暗」只有必殺和決勝分有，玩家一眼就知道這球不一樣。
  function ultimate(x, y, col, withStop, type, kind) {
    var tn = now();
    if (withStop) hitStop = Math.max(hitStop, 5);
    shakeEvent(1, JUICE.shakeUlt, false);
    if (!lite()) {
      kick = { x: (x < 216 ? 1 : -1) * JUICE.kickUlt, y: JUICE.kickUlt * 0.4, t0: tn };
      zoom = JUICE.zoomUlt;
    }
    flashes.push({ full: true, color: '#000000', alpha: 0.35, t0: tn, dur: 140 });
    flashes.push({ full: true, color: col, alpha: 0.3, t0: tn + 120, dur: 240 });
    rings.push({ x: x, y: y, r0: 28, r1: 110, t0: tn, dur: 360, color: col, w: 4 });
    rings.push({ x: x, y: y, r0: 34, r1: 140, t0: tn + 60, dur: 340, color: '#FFFFFF', w: 3 });
    rings.push({ x: x, y: y, r0: 40, r1: 160, t0: tn + 120, dur: 320, color: col, w: 2 });
    for (var i = 0; i < 16; i++) {
      var a = i / 16 * Math.PI * 2 + rand(-0.08, 0.08);
      lines.push({ x: x, y: y, a: a, r0: rand(30, 40), len: rand(120, 200), t0: tn + 100, dur: 260, color: i % 2 ? col : '#FFFFFF' });
    }
    sparks(x, y, -Math.PI / 2, col, 24, 9, Math.PI * 2);
    pendingTrail = 400;
    duckBgm(ctrlRef, 500);
    if (ctrlRef) {
      if (kind === 'evoR') sfxEvolve(ctrlRef, true);
      sfxUlt(ctrlRef, type || '電');
    }
  }

  // 必殺時背景音樂短暫壓低
  var bgmDuckTimer = 0, bgmVol = null;
  function duckBgm(ctrl, ms) {
    try {
      var b = ctrl && ctrl.audio && ctrl.audio.sounds.bgm;
      if (!b || !b.center) return;
      if (bgmVol === null) bgmVol = b.center.volume;
      b.volume = bgmVol * 0.35;
      clearTimeout(bgmDuckTimer);
      bgmDuckTimer = setTimeout(function () { try { b.volume = bgmVol; } catch (e) {} bgmVol = null; }, ms);
    } catch (e) {}
  }

  function addTrauma(v) { trauma = Math.min(1, trauma + v); }
  // 每次事件決定自己的震幅；正在震的話取比較大的那個
  var shakeHist = [];
  function shakeEvent(t, amp, vertical) {
    if (lite()) return;
    // 防疲勞：10 秒內震太多次，後面的都減半
    var tn = now();
    shakeHist = shakeHist.filter(function (h) { return tn - h.t < 10000; });
    var spent = shakeHist.reduce(function (a, h) { return a + h.v; }, 0);
    shakeHist.push({ t: tn, v: t });
    stats.shake++;
    if (spent > JUICE.shakeBudget) amp *= 0.5;
    var cur = trauma * trauma * traumaScale, next = t * t * amp;
    if (next >= cur) { traumaScale = amp; traumaVertical = vertical; }
    addTrauma(t);
  }

  // ============================================================
  // 粒子
  // ============================================================
  function sparks(x, y, ang, color, n, spd, spread) {
    spread = spread || Math.PI * 0.75;
    for (var i = 0; i < n; i++) {
      var a = ang + rand(-spread, spread) * (Math.random() < 0.25 ? 2.2 : 1);
      var v = rand(spd * 0.75, spd * 1.95);
      particles.push({
        kind: 'spark', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g: 0.25, drag: 0.88, life: rand(240, 440), t0: now(),
        color: color, size: Math.random() < 0.4 ? 4 : 3
      });
    }
  }
  function dust(x, y, n, power) {
    for (var i = 0; i < n; i++) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      particles.push({
        kind: 'dust', x: x + rand(-8, 8), y: y - rand(0, 4),
        vx: dir * rand(0.8, 3.2) * power, vy: -rand(0.3, 1.8) * power,
        g: 0.05, drag: 0.93, life: rand(300, 600), t0: now(),
        color: Math.random() < 0.55 ? '#FFFFFF' : '#6B4A2B', size: rand(3, 6) * Math.min(1.4, power)
      });
    }
  }
  function speedLines(x, y, color, n) {
    n = n || 10;
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2 + rand(-0.15, 0.15);
      lines.push({ x: x, y: y, a: a, r0: rand(14, 22), len: rand(18, 34), t0: now(), dur: 150, color: i % 2 ? color : '#FFFFFF' });
    }
  }

  // ============================================================
  // 精靈的壓扁伸展（每次遊戲畫面更新之後，以及頓幀期間）
  // ============================================================
  var innerDrawBall = window._pvDrawBall;
  window._pvDrawBall = function (view, physics) {
    if (innerDrawBall) innerDrawBall(view, physics);
    if (sim()) return;
    // 在物理算完、畫面畫出之前偵測，特效和合成音跟原本的擊球音效同一幀
    var c = ctrlRef;
    if (c && c.state !== c.intro && c.state !== c.menu) detect(c);
    applySprites(view, physics);
  };

  // 有彈性的回彈曲線：一開始壓扁，接著稍微反彈超過，最後回到 1
  var ballRot = 0;
  function spring(t, amt, k, w) { return 1 - amt * Math.exp(-k * t) * Math.cos(w * t); }

  function applySprites(view, physics) {
    var tn = now(), ball = physics.ball, b = view.ball;
    viewRef = view;
    if (!b || !b.scale) return;

    // 得分後落點的爆炸圖：原版會留在畫面上，這裡讓它 200ms 內淡掉
    if (view.punch) {
      var gt = tn - groundT;
      view.punch.alpha = groundT && gt > 120 ? Math.max(0, 1 - (gt - 120) / 200) : 1;
    }
    // 電光一閃的殘影淡出
    ghosts = ghosts.filter(function (gh) {
      var k = (tn - gh.t0) / 260;
      if (k >= 1) { if (gh.sp.parent) gh.sp.parent.removeChild(gh.sp); gh.sp.destroy(); return false; }
      gh.sp.alpha = gh.a0 * (1 - k);
      return true;
    });

    // 球：頓幀期間維持壓扁，頓幀結束才彈性回彈；高速飛行時往飛行方向拉長
    var along = 1, rotTarget = null, dt = (tn - ballFx.t0) / 1000;
    if (ballFx.hold) {
      along = 1 - 0.3 * ballFx.power; rotTarget = ballFx.ang;
    } else if (ballFx.t0 > 0 && dt < 0.35) {
      along = spring(dt, 0.3 * ballFx.power, 9, 26); rotTarget = ballFx.ang;
    } else {
      var speed = Math.hypot(ball.xVelocity, ball.yVelocity);
      if (speed > 14 && ball.y < GROUND_BALL_Y - 4) {
        along = 1 + Math.min(0.35, (speed - 14) / 30);
        rotTarget = Math.atan2(ball.yVelocity, ball.xVelocity);
      }
    }
    // 角度用平滑追上，避免寶貝球花紋瞬間跳動；不拉伸時角度看不出來，所以保持不動
    if (rotTarget !== null) {
      var d = Math.atan2(Math.sin(rotTarget - ballRot), Math.cos(rotTarget - ballRot));
      ballRot += d * 0.5;
    }
    b.rotation = ballRot;
    b.scale.x = along; b.scale.y = 1 / Math.sqrt(Math.max(0.5, along));
    // 落地壓扁時把球往下補，貼住地面不浮空
    b.y = ball.y + ((ballFx.ground && along < 1) ? (1 - along) * 20 : 0);

    swapGyarados(view, physics);

    // 角色
    var sprites = [view.player1, view.player2], ps = [physics.player1, physics.player2];
    for (var i = 0; i < 2; i++) {
      var sp = sprites[i], p = ps[i], fx = playerFx[i];
      if (!sp || !sp.scale) continue;
      var px = 1, py = 1;
      var t = (tn - fx.t0) / 1000;
      if (fx.t0 > 0 && t < 0.4) {
        if (fx.kind === 'land') { py = spring(t, 0.28, 10, 22); px = 2 - py; }
        else if (fx.kind === 'jump') { py = spring(t, -0.2, 10, 18); px = 2 - py; }
        else if (fx.kind === 'spike') { px = spring(t, -0.22, 11, 24); py = 2 - px; }
        else if (fx.kind === 'dive') { py = spring(t, 0.15, 10, 20); px = 2 - py; }
        else if (fx.kind === 'hurt' && t < 0.25) { py = 0.8 + 0.2 * (t / 0.25); px = 2 - py; }
      }
      var sign = sp.scale.x < 0 ? -1 : 1;
      // 閃電鳥的圖比較大，整體再縮一點（倍數在 abilities.js 的 TUNING.birdScale）
      var AB = window._pvAbilities, size = p.character === 'bird' && AB && AB.tuning.birdScale ? AB.tuning.birdScale : 1;
      sp.scale.x = sign * px * size;
      sp.scale.y = py * size;
      // 錨點在中間：壓扁時讓腳保持貼地。貼圖比 64px 大的角色（閃電鳥 96px＝1.5 倍）往上移，腳才會在同一條地平線
      var k = (sp.texture && sp.texture.height ? sp.texture.height / 64 : 1) * size;
      sp.y = p.y + 30 - 30 * py * k;
      if (k > 1) sp.y = Math.max(sp.y, 32 * k - 6);   // 飛到最高時不要整顆頭跑出畫面
      sp.x = p.x + ((fx.kind === 'hurt' && t < 0.15) ? Math.round(rand(-2, 2)) : 0);
    }

    // 計分板：得分數字從 1.6 倍彈回 1 倍（250ms）
    var boards = view.scoreBoards;
    if (boards) {
      for (var bi = 0; bi < 2; bi++) {
        var bd = boards[bi], st = (tn - scoreFx[bi].t0) / 250, sc = 1;
        if (!bd) continue;
        if (scoreFx[bi].t0 > 0 && st < 1) sc = 1 + 0.6 * Math.pow(1 - st, 2) * Math.cos(st * 3);
        var bx = bi === 0 ? 14 : 354;
        bd.scale.set(sc);
        bd.x = bx - (sc - 1) * 32; bd.y = 10 - (sc - 1) * 16;
      }
    }
  }

  // ============================================================
  // 鏡頭與粒子層（requestAnimationFrame）
  // ============================================================
  var layer = null, lctx = null, lastKey = '';
  var cam = { x: 0, y: 0, s: 1 };
  window._pvCam = cam;

  function ensureLayer() {
    if (layer) return true;
    if (!document.body) return false;
    layer = document.createElement('canvas');
    layer.id = 'pv-juice-overlay';
    layer.style.cssText = 'position:fixed;pointer-events:none;z-index:46;transform-origin:50% 50%;';
    document.body.appendChild(layer);
    lctx = layer.getContext('2d');
    return true;
  }

  // 取得「沒有鏡頭效果時」的畫布位置
  function baseRect(gc) {
    var r = gc.getBoundingClientRect();
    var w = r.width / cam.s, h = r.height / cam.s;
    var cx = r.left + r.width / 2 - cam.x, cy = r.top + r.height / 2 - cam.y;
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
  }
  window._pvBaseRect = baseRect;

  var lastT = now();
  function frame() {
    requestAnimationFrame(frame);
    var tn = now(), dt = Math.min(50, tn - lastT) / 16.67;
    lastT = tn;
    var gc = document.getElementById('game-canvas');
    if (!gc || !ensureLayer() || sim()) return;
    var r = baseRect(gc);
    if (!r.width) return;

    // 鏡頭：震動（trauma² 讓小震很輕、大震很猛）＋往前衝
    trauma = Math.max(0, trauma - 0.045 * dt);
    zoom = Math.max(0, zoom - 0.004 * dt);
    if (trauma === 0) traumaScale = 0;
    var px2 = r.width / W;
    var shake = trauma * trauma * traumaScale * px2;
    var kt = (tn - kick.t0) / 80, kk = kick.t0 > 0 && kt < 1 ? (1 - kt) : 0;
    cam.x = (traumaVertical ? 0 : shake * rand(-1, 1)) + kick.x * kk * px2;
    cam.y = shake * rand(-1, 1) + kick.y * kk * px2;
    // 放大到剛好蓋住位移，震動時不會露出畫面外的底色
    // 用震幅的包絡值（不是這一幀的隨機值），縮放才不會每幀亂跳；x 除以寬、y 除以高
    var envX = (traumaVertical ? 0 : shake) + Math.abs(kick.x * kk * px2);
    var envY = shake + Math.abs(kick.y * kk * px2);
    var need = Math.max(2 * envX / r.width, 2 * envY / r.height);
    cam.s = 1 + Math.max(zoom, need);
    var tf = (cam.x || cam.y || zoom) ? 'translate(' + cam.x.toFixed(2) + 'px,' + cam.y.toFixed(2) + 'px) scale(' + cam.s.toFixed(4) + ')' : '';
    gc.style.transformOrigin = '50% 50%';
    gc.style.transform = tf;
    var fxo = document.getElementById('pv-fx-overlay');
    if (fxo) { fxo.style.transformOrigin = '50% 50%'; fxo.style.transform = tf; }
    layer.style.transform = tf;

    var dpr = window.devicePixelRatio || 1;
    var key = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), dpr].join(',');
    if (key !== lastKey) {
      lastKey = key;
      layer.style.left = r.left + 'px'; layer.style.top = r.top + 'px';
      layer.style.width = r.width + 'px'; layer.style.height = r.height + 'px';
      layer.width = Math.round(r.width * dpr); layer.height = Math.round(r.height * dpr);
    }
    var g = lctx;
    g.setTransform(layer.width / W, 0, 0, layer.height / H, 0, 0);
    g.clearRect(0, 0, W, H);
    drawParticles(g, tn, dt);
  }

  function drawParticles(g, tn, dt) {
    // 全畫面閃光
    flashes = flashes.filter(function (f) {
      var k = (tn - f.t0) / f.dur;
      if (k < 0) return true;          // 延遲出現（必殺：先暗再閃）
      if (k >= 1) return false;
      if (f.full && lite()) return true;
      if (f.full) {
        g.globalAlpha = f.alpha * (1 - k);
        g.fillStyle = f.color; g.fillRect(0, 0, W, H);
      } else {
        g.globalAlpha = 1 - k;
        g.fillStyle = '#FFFFFF';
        g.beginPath(); g.arc(f.x, f.y, f.r * (0.6 + 0.4 * k), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      return true;
    });

    // 放射速度線
    lines = lines.filter(function (l) {
      var k = (tn - l.t0) / l.dur;
      if (k < 0) return true;
      if (k >= 1) return false;
      var r0 = l.r0 + k * 30, r1 = r0 + l.len * (1 - k);
      g.globalAlpha = 1 - k;
      g.strokeStyle = l.color; g.lineWidth = 2.5 * (1 - k) + 0.5;
      g.beginPath();
      g.moveTo(l.x + Math.cos(l.a) * r0, l.y + Math.sin(l.a) * r0);
      g.lineTo(l.x + Math.cos(l.a) * r1, l.y + Math.sin(l.a) * r1);
      g.stroke();
      g.globalAlpha = 1;
      return true;
    });

    // 衝擊波
    rings = rings.filter(function (o) {
      var k = (tn - o.t0) / o.dur;
      if (k < 0) return true;          // 延遲出現的環還沒開始
      if (k >= 1) return false;
      var e = 1 - Math.pow(1 - k, 3), r = o.r0 + (o.r1 - o.r0) * e;
      g.globalAlpha = (1 - k) * 0.95;
      g.beginPath();
      if (o.flat) g.ellipse(o.x, o.y, r, r * 0.22, 0, 0, Math.PI * 2);
      else g.arc(o.x, o.y, r, 0, Math.PI * 2);
      var lw = Math.min(o.w, 4) * (1 - k) + 1;   // 環的線寬上限 4：不要蓋住球和角色
      if (o.color !== '#FFFFFF') { g.strokeStyle = '#FFFFFF'; g.lineWidth = lw + 2; g.stroke(); }
      g.strokeStyle = o.color; g.lineWidth = lw; g.stroke();
      g.globalAlpha = 1;
      return true;
    });

    // 火花與塵土（頓幀期間也繼續飛，畫面才不會像當機）
    particles = particles.filter(function (p) {
      var age = tn - p.t0;
      if (age >= p.life) return false;
      p.vx *= Math.pow(p.drag, dt); p.vy = p.vy * Math.pow(p.drag, dt) + p.g * dt;
      var ox = p.x, oy = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'dust' && p.y > FLOOR_Y + 2) { p.y = FLOOR_Y + 2; p.vy *= -0.2; }
      var k = age / p.life;
      if (p.kind === 'spark') {
        // 像素方塊：黑框＋屬性色＋白芯，任何背景都看得到
        var sz = Math.max(2, Math.round(p.size * (1 - k * 0.5))), px = Math.round(p.x - sz / 2), py = Math.round(p.y - sz / 2);
        g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        g.fillStyle = '#000'; g.fillRect(px - 1, py - 1, sz + 2, sz + 2);
        g.fillStyle = p.color; g.fillRect(px, py, sz, sz);
        if (sz >= 3 && k < 0.5) { g.fillStyle = '#FFF'; g.fillRect(px + 1, py + 1, sz - 2, sz - 2); }
      } else {
        g.globalAlpha = (1 - k) * 0.85;
        g.fillStyle = p.color;
        var sz = p.size * (1 + k * 1.2);
        g.beginPath(); g.arc(p.x, p.y, sz, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      return true;
    });
  }

  // ============================================================
  // 合成衝擊音（Web Audio）：疊在遊戲原本的音效上，補足低頻的「碰」
  // ============================================================
  var ac = null, master = null;
  function audio() {
    if (ac) return ac;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.48;
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 8;
    master.connect(comp); comp.connect(ac.destination);
    return ac;
  }
  ['keydown', 'pointerdown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { var a = audio(); if (a && a.state === 'suspended') a.resume(); }, { passive: true, capture: true });
  });

  // 離線算音（試玩台用）：tAt 不是 null 時，聲音排在指定時間，畫到離線的 AudioContext
  var tAt = null;
  function T0() { return tAt != null ? tAt : ac.currentTime + 0.005; }
  var sfxLog = window._pvSfxLog = [];
  function logSfx(name, args) {
    if (tAt == null) { sfxLog.push({ t: performance.now(), name: name, args: args, pitch: pitchVar }); if (sfxLog.length > 400) sfxLog.shift(); }
  }

  function sfxOn(ctrl) {
    if (tAt != null) return true;
    if (!JUICE.sound || document.hidden) return false;
    var s = ctrl.audio && ctrl.audio.sounds && ctrl.audio.sounds.pika;
    if (s && s.volume === 0) return false;     // 選單裡關掉音效時不播
    var a = audio();
    return !!a && a.state === 'running';
  }
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  var pitchVar = 1;
  function osc(type, f0, f1, t, dur, peak, dest) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    f0 *= pitchVar; f1 *= pitchVar;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    env(g, t, 0.004, peak, dur);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var noiseBuf = null;
  function noise(t, dur, peak, filterType, f0, f1, q) {
    if (!noiseBuf) {
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf;
    f.type = filterType; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    env(g, t, 0.003, peak, dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
  }

  function sfxSpike(ctrl, type, big, level) {
    if (tAt == null && !ctrl) return;
    level = level || 0;
    if (tAt == null) pitchVar = rand(0.94, 1.06) * (1 - 0.08 * level);   // 每次音高隨機 ±6%；技能強化每級再低 8%
    logSfx('spike', [type, big, level]);   // 試玩台：瀏覽器還沒允許播音也照樣記錄
    if (!sfxOn(ctrl)) return;
    var t = T0(), v = JUICE.sound * (big ? 1 : 0.8) * Math.pow(10, 2 * level / 20);   // 每級 +2dB
    // 骨幹：中低頻的「砰」為主（手機喇叭也聽得到），高頻的嘶聲只當點綴
    osc('sine', 170, 42, t, 0.22, 0.9 * v);                  // 低頻（大喇叭、耳機）
    osc('triangle', 320, 110, t, 0.2, 1.3 * v);              // 主體：蓋過原版殺球音效的嘶聲
    osc('triangle', 640, 220, t, 0.08, 0.35 * v);            // 中頻的「啪」，手機喇叭聽得到
    noise(t, 0.002, 0.9 * v, 'highpass', 4000, 3000, 0.5);   // 2ms 的 click，打到的瞬間
    noise(t, 0.06, 0.25 * v, 'highpass', 2500, 1200, 0.7);
    // 依屬性的音色（比骨幹再大 6dB，才分得出來）
    var a = 2 * v;
    switch (type) {
      case '電': osc('square', 1400, 180, t, 0.12, 0.18 * a); osc('sawtooth', 2200, 400, t + 0.02, 0.08, 0.1 * a); break;
      case '水': noise(t, 0.22, 0.45 * a, 'bandpass', 1800, 400, 3); osc('sine', 900, 300, t + 0.03, 0.12, 0.15 * a); break;
      case '火': noise(t, 0.28, 0.5 * a, 'lowpass', 2500, 250, 0.8); break;
      case '鬼': osc('sine', 520, 140, t, 0.3, 0.25 * a); osc('sine', 530, 150, t, 0.3, 0.2 * a); break;
      case '超': osc('sine', 700, 1700, t, 0.22, 0.2 * a); osc('triangle', 1050, 2400, t + 0.03, 0.18, 0.12 * a); break;
      case '地': noise(t, 0.3, 0.55 * a, 'lowpass', 900, 120, 1); osc('triangle', 260, 90, t, 0.2, 0.2 * a); break;
      case '妖': osc('triangle', 1600, 1650, t, 0.18, 0.16 * a); osc('triangle', 2400, 2450, t + 0.04, 0.16, 0.12 * a); break;
      case '龍': osc('sawtooth', 240, 90, t, 0.26, 0.25 * a); osc('sawtooth', 120, 55, t, 0.24, 0.2 * a); break;
      case '草': noise(t, 0.16, 0.4 * a, 'bandpass', 3200, 1400, 2); osc('triangle', 820, 520, t, 0.1, 0.12 * a); break;
      default: noise(t, 0.12, 0.35 * a, 'lowpass', 1800, 300, 0.8);
    }
  }
  // 技能級：在殺球聲之後再補一層低頻＋屬性音色
  function sfxSkill(ctrl, type, lvl) {
    if (tAt == null && !ctrl) return;
    logSfx('skill', [type, lvl]);
    if (!sfxOn(ctrl)) return;
    var t = T0(), v = JUICE.sound * 0.9;
    osc('sine', 140, 45, t, 0.28, 0.9 * v);
    osc('triangle', 260, 90, t, 0.22, 0.6 * v);
    noise(t, 0.18, 0.3 * v, 'lowpass', 1600, 200, 0.8);
  }
  // 必殺：很低的轟聲＋往下掃的噪音＋高頻的裂響，跟一般殺球明顯不同
  function sfxUlt(ctrl, type) {
    if (tAt == null && !ctrl) return;
    logSfx('ult', [type]);
    if (!sfxOn(ctrl)) return;
    var t = T0(), v = JUICE.sound;
    osc('sine', 95, 28, t, 0.6, 1.2 * v);
    osc('sawtooth', 180, 50, t, 0.45, 0.35 * v);
    osc('triangle', 520, 140, t + 0.01, 0.3, 0.5 * v);
    noise(t, 0.003, 1.0 * v, 'highpass', 5000, 3000, 0.5);
    noise(t, 0.55, 0.45 * v, 'lowpass', 3000, 120, 0.9);
    sfxSpike(ctrl, type, true, 3);
  }
  function sfxBump(ctrl) {
    if (tAt == null && !ctrl) return;
    logSfx('bump', []);   // 試玩台：瀏覽器還沒允許播音也照樣記錄
    if (!sfxOn(ctrl)) return;
    var t = T0();
    // 普通擊球：放在手機喇叭聽得到的頻段（之前 220→90Hz 的 sine 在手機上幾乎聽不到）
    osc('triangle', 520, 260, t, 0.08, 0.5 * JUICE.sound);
    noise(t, 0.002, 0.5 * JUICE.sound, 'highpass', 4000, 3000, 0.5);
  }
  function sfxGround(ctrl) {
    if (tAt == null && !ctrl) return;
    logSfx('ground', []);   // 試玩台：瀏覽器還沒允許播音也照樣記錄
    if (!sfxOn(ctrl)) return;
    var t = T0(), v = JUICE.sound;
    osc('sine', 120, 32, t, 0.4, 0.9 * v);
    osc('triangle', 260, 80, t, 0.18, 0.7 * v);
    osc('triangle', 400, 180, t, 0.15, 0.6 * v);             // 給手機喇叭的中頻層
    noise(t, 0.002, 0.8 * v, 'highpass', 3500, 2500, 0.5);
    noise(t, 0.35, 0.55 * v, 'lowpass', 900, 90, 0.8);
    noise(t, 0.05, 0.4 * v, 'highpass', 3000, 1500, 0.7);
  }

  // ============================================================
  // 暴鯉龍／紅色暴鯉龍的角色圖：鯉魚王進化期間把它的動畫格換成暴鯉龍的
  // （兩張圖的格子位置跟鯉魚王完全一樣，所以直接用同樣的位置切）
  // ============================================================
  var GYA_IMG = '../resources/assets/images/';
  var gyaImg = { normal: null, red: null }, gyaTex = { normal: null, red: null };
  ['normal', 'red'].forEach(function (k) {
    var im = new Image();
    im.onload = function () { gyaImg[k] = im; };
    im.src = GYA_IMG + (k === 'red' ? 'redgyarados' : 'gyarados') + '_sheet.png';
  });
  function gyaTextures(view, kind) {
    if (gyaTex[kind]) return gyaTex[kind];
    var base = view.playerTextureArrays && view.playerTextureArrays.magikarp;
    if (!base || !gyaImg[kind]) return null;
    var T = base[0].constructor, R = base[0].frame.constructor;
    var bt = T.from(gyaImg[kind]).baseTexture;
    if (base[0].baseTexture.scaleMode != null) bt.scaleMode = base[0].baseTexture.scaleMode;
    gyaTex[kind] = base.map(function (t) { return new T(bt, new R(t.frame.x, t.frame.y, t.frame.width, t.frame.height)); });
    return gyaTex[kind];
  }
  function swapGyarados(view, physics) {
    var A = window._pvAbilities && window._pvAbilities.state();
    if (!A || !view.playerTextureArrays) return;
    [['player1', 'p1'], ['player2', 'p2']].forEach(function (k) {
      var sp = view[k[0]], p = physics[k[0]], st = A[k[1]] || {};
      if (!sp || p.character !== 'magikarp') return;
      var want = st.isGyarados ? gyaTextures(view, st.isRed ? 'red' : 'normal') : view.playerTextureArrays.magikarp;
      if (want && sp.textures !== want) {
        var f = sp.currentFrame;
        sp.textures = want;
        sp.gotoAndStop(Math.min(f, want.length - 1));
      }
    });
  }

  // ============================================================
  // 技能事件（abilities.js 呼叫）
  // ============================================================
  window._pvFxEvent = function (type, d) {
    if (sim()) return;
    if (type === 'zipStart') {
      var p = d.player;
      sparks(p.x, p.y, d.dir > 0 ? Math.PI : 0, '#FFE14D', 6, 5);
      if (ctrlRef) sfxZip(ctrlRef);   // 位移技能不頓幀，否則整個畫面會卡一下
    } else if (type === 'zipEnd') {
      sparks(d.x1, d.y, d.x1 > d.x0 ? 0 : Math.PI, '#FFE14D', 6, 5);
      makeGhosts(d.player, d.x0, d.x1, d.y);
    } else if (type === 'skill') {
      onSkill(d);
    }
  };

  // 選項選單：特效 完整／精簡
  function addLiteToggle() {
    var dd = document.getElementById('options-dropdown');
    if (!dd || document.getElementById('pv-fx-btn')) return;
    var zh = (document.documentElement.lang || 'zh').slice(0, 2) === 'zh';
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'pv-fx-btn'; b.className = 'btn';
    var paint = function () { b.textContent = zh ? ('特效：' + (liteMode ? '精簡' : '完整')) : ('Effects: ' + (liteMode ? 'Lite' : 'Full')); };
    paint();
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      liteMode = !liteMode;
      try { localStorage.setItem(LITE_KEY, liteMode ? '1' : '0'); } catch (err) {}
      if (liteMode) { trauma = 0; zoom = 0; }
      paint();
    });
    dd.insertBefore(b, document.getElementById('reset-to-default-btn'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addLiteToggle); else addLiteToggle();

  // 在角色身後放 4 個漸淡的殘影（用角色當下的貼圖）
  function makeGhosts(player, x0, x1, y) {
    if (!viewRef) return;
    var sp = player.isPlayer2 ? viewRef.player2 : viewRef.player1;
    if (!sp || !sp.parent) return;
    for (var i = 1; i <= 4; i++) {
      var g = new (Object.getPrototypeOf(viewRef.ballHyper).constructor)(sp.texture);
      g.anchor.set(sp.anchor.x, sp.anchor.y);
      g.scale.x = sp.scale.x; g.scale.y = sp.scale.y;
      g.x = x0 + (x1 - x0) * (i - 1) / 4; g.y = y;
      g.tint = 0xFFF176;
      g.a0 = 0.15 + i * 0.1;
      g.alpha = g.a0;
      sp.parent.addChildAt(g, sp.parent.getChildIndex(sp));
      ghosts.push({ sp: g, t0: now(), a0: g.a0 });
    }
  }

  function sfxEvolve(ctrl, red) {
    if (tAt == null && !ctrl) return;
    logSfx('evolve', [red]);
    if (!sfxOn(ctrl)) return;
    var t = T0(), v = JUICE.sound;
    osc('sawtooth', 110, 220, t, 0.35, 0.35 * v);          // 往上爬的吼聲
    osc('triangle', 330, 660, t, 0.3, 0.45 * v);
    noise(t, 0.3, 0.35 * v, 'lowpass', 600, 2400, 1);
    if (red) { osc('triangle', 990, 1480, t + 0.18, 0.25, 0.3 * v); osc('sine', 1320, 1980, t + 0.26, 0.25, 0.2 * v); }
  }
  function sfxPsy(ctrl) {
    if (tAt == null && !ctrl) return;
    logSfx('psy', []);
    if (!sfxOn(ctrl)) return;
    var t = T0(), v = JUICE.sound;
    osc('sine', 1200, 500, t, 0.18, 0.45 * v);
    osc('triangle', 600, 250, t, 0.2, 0.6 * v);
    osc('sine', 1800, 900, t + 0.03, 0.14, 0.2 * v);
  }
  function sfxZip(ctrl) {
    if (tAt == null && !ctrl) return;
    logSfx('zip', []);   // 試玩台：瀏覽器還沒允許播音也照樣記錄
    if (!sfxOn(ctrl)) return;
    var t = T0();
    noise(t, 0.12, 1.1 * JUICE.sound, 'bandpass', 1500, 6000, 2);   // 比之前大約 9dB
    osc('square', 600, 1800, t, 0.08, 0.34 * JUICE.sound);
  }

  // 試玩台：把一段時間內的遊戲音效＋合成音，照實際時間點混成一個 WAV（base64）
  window._pvRenderAudio = async function (windows, gameEvents, synthEvents, which) {
    var SR = 22050, GAP = 0.25, total = 0;
    windows.forEach(function (w) { total += w.ms / 1000 + GAP; });
    var off = new OfflineAudioContext(2, Math.ceil(SR * (total + 1)), SR);
    var buffers = {};
    var sounds = ctrlRef.audio.sounds;
    async function buf(name) {
      if (buffers[name] !== undefined) return buffers[name];
      var snd = sounds[name], url = snd && snd.center && snd.center.url;
      if (!url) return (buffers[name] = null);
      var ab = await (await fetch(url)).arrayBuffer();
      return (buffers[name] = await off.decodeAudioData(ab));
    }
    // 視窗時間 → 音檔時間
    function place(t) {
      var acc = 0;
      for (var i = 0; i < windows.length; i++) {
        var w = windows[i];
        if (t >= w.t0 && t <= w.t0 + w.ms + 300) return acc + (t - w.t0) / 1000;
        acc += w.ms / 1000 + GAP;
      }
      return null;
    }
    if (which !== 'synth') {
      for (var i = 0; i < gameEvents.length; i++) {
        var e = gameEvents[i], at = place(e.t);
        if (at == null || e.k === 'bgm') continue;
        var b = await buf(e.k); if (!b) continue;
        var src = off.createBufferSource(), g = off.createGain(), pan = off.createStereoPanner();
        src.buffer = b; g.gain.value = e.vol; pan.pan.value = e.pan === -1 ? -0.75 : e.pan === 1 ? 0.75 : 0;
        src.connect(g); g.connect(pan); pan.connect(off.destination); src.start(at);
      }
    }
    if (which !== 'game') {
      var saved = [ac, master, noiseBuf, pitchVar];
      ac = off; noiseBuf = null;
      master = off.createGain(); master.gain.value = 0.48;
      var comp = off.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 8;
      master.connect(comp); comp.connect(off.destination);
      synthEvents.forEach(function (ev) {
        var at = place(ev.t); if (at == null) return;
        tAt = at; pitchVar = ev.pitch || 1;
        if (ev.name === 'spike') sfxSpike(null, ev.args[0], ev.args[1], ev.args[2]);
        else if (ev.name === 'psy') sfxPsy(null);
        else if (ev.name === 'evolve') sfxEvolve(null, ev.args[0]);
        else if (ev.name === 'bump') sfxBump(null);
        else if (ev.name === 'ground') sfxGround(null);
        else if (ev.name === 'zip') sfxZip(null);
      });
      tAt = null; ac = saved[0]; master = saved[1]; noiseBuf = saved[2]; pitchVar = saved[3];
    }
    var out = await off.startRendering();
    var L = out.getChannelData(0), R = out.getChannelData(1), n = L.length;
    var wav = new DataView(new ArrayBuffer(44 + n * 4));
    function str(o, x) { for (var i = 0; i < x.length; i++) wav.setUint8(o + i, x.charCodeAt(i)); }
    str(0, 'RIFF'); wav.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 2, true);
    wav.setUint32(24, SR, true); wav.setUint32(28, SR * 4, true); wav.setUint16(32, 4, true); wav.setUint16(34, 16, true);
    str(36, 'data'); wav.setUint32(40, n * 4, true);
    for (var k = 0; k < n; k++) {
      wav.setInt16(44 + k * 4, Math.max(-1, Math.min(1, L[k])) * 32767, true);
      wav.setInt16(46 + k * 4, Math.max(-1, Math.min(1, R[k])) * 32767, true);
    }
    var bytes = new Uint8Array(wav.buffer), bin = '';
    for (var q = 0; q < bytes.length; q += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(q, q + 0x8000));
    return btoa(bin);
  };

  requestAnimationFrame(frame);
  window._pvJuice = JUICE;
  // 連線對戰的客機不跑物理，只靠這個讓頓幀倒數、殺球回彈照常進行
  window._pvJuiceNet = {
    guestTick: function (ctrl) {
      ctrlRef = ctrl; duckSample(ctrl);
      if (hitStop > 0) { hitStop--; if (hitStop === 0) releaseHold(); }
    }
  };
})();
