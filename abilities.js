// abilities.js — 寶可夢排球 角色技能、變化球與場上特效
// 依賴：characters.js（window.PV_CHARS）
// 掛勾：main.bundle.js 每幀呼叫 window._pvTick(ctrl)（在物理運算之前），
//       得分時呼叫 window._pvScore(ctrl, scorerIndex) 取得這一球的分數。
// 角色音效已改由 main.bundle.js 的音效系統播放（會跟著音效開關與立體聲設定）。
(function () {
  'use strict';

  var CHARS = window.PV_CHARS ? window.PV_CHARS.byId : {};
  var IDS = window.PV_CHARS ? window.PV_CHARS.ids : [];

  // ---------- 場地常數（遊戲座標 432 x 304） ----------
  var W = 432, H = 304;
  var NET_X = 216;
  var GROUND_Y = 244;        // 角色站地時的 y
  var GROUND_BALL_Y = 252;   // 球落地時的 y
  var FLOOR_Y = 270;         // 畫地面標記用
  var P1_MIN_X = 32, P1_MAX_X = 184, P2_MIN_X = 248, P2_MAX_X = 400;

  // ---------- 可調整的數值 ----------
  // 平衡數值都集中在這裡。目前的值是用電腦對電腦模擬（20 隻角色兩兩對打）調出來的，
  // 每隻對一般對手的勝率大約落在 40%～60%。改數值後建議重跑模擬確認。
  var TUNING = {
    // 喵喵
    meowthDoubleChance: 0.15,   // 得分算 2 分的機率
    meowthMaxCoins: 2,          // 場上最多幾枚金幣
    coinRadius: 26,             // 金幣的判定範圍
    coinSlow: 25,               // 踩到金幣後移動速度減半幾幀（25 幀 ≈ 1 秒）
    coinStun: 10,               // coinSlow 設 0 時改成定身幾幀
    // 水伊布
    puddleMax: 3, puddleLife: 50,
    vaporeonAIDash: 110,        // 電腦離落點多遠才考慮衝刺
    vaporeonAIDashChance: 0.05, // 每幀衝刺的機率（太常衝刺會強到不平衡）
    // 火伊布／耿鬼：在這個引擎裡「球更快」反而容易出界，所以改成「往下砸」
    fireSmash: 1.0, fireDown: 4,
    shadowBall: 1.0, shadowDown: 3,
    // 超夢
    psychicDrop: 15, psychicReverse: 1.0, psychicAim: 0.65, psychicCooldown: 150, mewtwoSpeed: 2,  // 超夢是 Boss，目標勝率約 65%～70%
    // 卡比獸
    bellyBounce: 22, bellyPush: 0,
    // 果然翁
    wobbuffetSpike: 1.0, counterPower: 2, wobbuffetAISpike: 0, counterLaunch: 18, counterMaxVx: 28,
    // 魔牆人偶
    barrierFrames: 35,
    // 胖丁
    jigglyJump: 0, jigglyFloat: 0.4,
    // 快龍
    outrageFrames: 75, outrageSpeed: 1, outrageDown: 4, outrageDrift: 0, outragePower: 1, outrageConfuse: 25,
    // 皮卡丘
    staticChance: 0.55, staticStun: 20,  // 麻痺機率、麻痺幾幀（20 幀 = 0.8 秒）
    // 雷伊布：電光一閃（距離、花幾幀閃完、冷卻、閃完後幾幀內殺球會強化、強化殺球的最大球速）
    joltSpeed: 1, qaDistance: 72, qaFrames: 2, qaCooldown: 60, qaWindow: 10, qaSpikeVx: 28, qaAI: 1,
    // 可達鴨：頭痛爆發（幾層觸發、讓對手頭暈幾幀、走路跌倒機率）
    headacheMaxVx: 30, headacheNeed: 3, headacheStun: 7, psyTrip: 0.1,
    // 閃電鳥：同一跳拍翅幾次後殺球變成雷擊俯衝
    birdChargeFlaps: 3, birdMaxVx: 26,
    // 胖丁：空中按下的快速落地加速、唱歌顛倒幾幀（100 幀 = 4 秒）
    jigglyFastFall: 3, singFrames: 100,
    // 鯉魚王
    magikarpEvolveChance: 0.07, magikarpSlow: 2, magikarpReceiveEvolve: 0.15,
    gyaradosVx: 24,
    // 紅色暴鯉龍：每次進化有幾 % 是紅色的、撐幾幀（150 = 6 秒）、球速上限、威嚇（對手定身幾幀）
    redGyaradosChance: 0.1, redGyaradosFrames: 150, redGyaradosVx: 30, redGyaradosStun: 10,
    // 夢幻
    mewAuraChance: 0.3,
    // 電腦防卡死：球在自己場上超過幾幀就強制起跳殺球
    antiStall: 100
  };

  // ---------- 狀態 ----------
  function newSide() { return { char: '' }; }
  var state = { p1: newSide(), p2: newSide() };
  // 百變怪：記住「原本選的角色」，變身後仍會持續變身
  var meta = { p1: { origin: '', transformedTo: null }, p2: { origin: '', transformedTo: null } };
  var lastScoreSum = 0;
  var psyBall = null;
  // 「接到對手的殺球」判斷：遊戲本體在球被碰到的那一幀就把 isPowerHit 清掉，
  // 所以要記住上一幀球是不是殺球、是誰殺的
  var ballMem = { prevPower: false, prevVx: 0, lastPowerSide: null };
  function receivedSpike(player) {
    return player.isCollisionWithBallHappened && player.state !== 2 &&
      ballMem.prevPower && ballMem.lastPowerSide !== pk(player);
  }   // 超夢殺球後的紫色念力球
  var fx = { bursts: [], flashes: [] };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clampV(v) { return clamp(v, -30, 30); }
  function clampPlayer(p) {
    if (p.pvNoClamp) { p.x = clamp(p.x, P1_MIN_X, P2_MAX_X); return; }
    p.x = p.isPlayer2 ? clamp(p.x, P2_MIN_X, P2_MAX_X) : clamp(p.x, P1_MIN_X, P1_MAX_X);
  }
  function pk(player) { return player.isPlayer2 ? 'p2' : 'p1'; }
  function moveBonus(player, input, dx) {
    if (player.state < 3 && input.xDirection !== 0) {
      player.x += dx * input.xDirection;
      clampPlayer(player);
    }
  }
  // 「這一幀剛碰到球」的上升緣判斷
  function edge(s, key, cond) {
    if (cond && !s[key]) { s[key] = true; return true; }
    if (!cond) s[key] = false;
    return false;
  }
  function powerHitEdge(player, s, key) {
    return edge(s, key, player.isCollisionWithBallHappened && player.state === 2);
  }
  function touchEdge(player, s, key) {
    return edge(s, key, player.isCollisionWithBallHappened);
  }
  // 算一條「一定過網、落在對面場內」的最低、最快球路（球的重力每幀 +1）
  function aimAtCourt(ball, fromP2, maxVx) {
    var target = fromP2 ? 70 + Math.random() * 60 : 300 + Math.random() * 60;
    for (var vy = 8; vy >= -16; vy -= 2) {
      // 解 y + vy·t + t²/2 = 252
      var t = -vy + Math.sqrt(vy * vy + 2 * (GROUND_BALL_Y - ball.y));
      if (!(t > 0)) continue;
      var vx = (target - ball.x) / t;
      if (Math.abs(vx) > maxVx) continue;
      var tn = (NET_X - ball.x) / vx;            // 過網的時間點
      var yn = ball.y + vy * tn + tn * tn / 2;
      if (tn > 0 && yn < 150) { ball.xVelocity = Math.round(vx); ball.yVelocity = vy; return; }
    }
    ball.xVelocity = fromP2 ? -maxVx : maxVx; ball.yVelocity = -14;
  }

  function makePowerHit(ball, radius) {
    // 如果這一下本來就是殺球，遊戲已經播過殺球音效了，不要再播一次
    if (!ball.isPowerHit) ball.sound.powerHit = true;
    ball.isPowerHit = true;
    ball.punchEffectRadius = radius;
    ball.punchEffectX = ball.x;
    ball.punchEffectY = ball.y;
  }

  function resetAll(ctrl) {
    state = { p1: newSide(), p2: newSide() };
    psyBall = null;
    fx = { bursts: [], flashes: [] };
    ['player1', 'player2'].forEach(function (k) {
      var p = ctrl.physics[k];
      p.pvNoClamp = false;
      var m = meta[pk(p)];
      if (m.origin === 'ditto') { p.character = 'ditto'; m.transformedTo = null; }
    });
  }

  // ============================================================
  // 得分
  // ============================================================
  window._pvScore = function (ctrl, scorerIdx) {
    var scorer = scorerIdx === 1 ? ctrl.physics.player2 : ctrl.physics.player1;
    var loser = scorerIdx === 1 ? ctrl.physics.player1 : ctrl.physics.player2;
    var sState = state[pk(scorer)], lState = state[pk(loser)];
    var points = 1;

    if (scorer.character === 'meowth' && Math.random() < TUNING.meowthDoubleChance) {
      points = 2;
      pushBurst(scorer.x, scorer.y - 10, '#FFC107', 70);
    }
    if (loser.character === 'psyduck') {
      lState.headacheCharge = (lState.headacheCharge || 0) + 1;
    }
    [scorer, loser].forEach(transformIfDitto);
    return points;
  };

  function transformIfDitto(player) {
    var m = meta[pk(player)];
    if (m.origin !== 'ditto') return;
    var pool = IDS.filter(function (id) { return id !== 'ditto' && id !== player.character; });
    var next = pool[Math.floor(Math.random() * pool.length)];
    player.character = next;
    player.pvNoClamp = false;
    m.transformedTo = next;
    state[pk(player)] = newSide();
    state[pk(player)].char = next;
    pushBurst(player.x, player.y, '#FF69B4', 70);
  }

  // ============================================================
  // 每幀
  // ============================================================
  window._pvTick = function (ctrl) {
    var p1 = ctrl.physics.player1, p2 = ctrl.physics.player2, ball = ctrl.physics.ball;
    var inMenu = ctrl.state === ctrl.intro || ctrl.state === ctrl.menu;

    var sum = (ctrl.scores ? ctrl.scores[0] + ctrl.scores[1] : 0);
    if (sum < lastScoreSum) resetAll(ctrl);
    lastScoreSum = sum;

    trackOrigin(p1); trackOrigin(p2);
    if (p1.isCollisionWithBallHappened) lastHitter = p1;
    else if (p2.isCollisionWithBallHappened) lastHitter = p2;

    if (!inMenu) {
      [p1, p2].forEach(function (p) {
        if (p.isCollisionWithBallHappened && ball.isPowerHit) ballMem.lastPowerSide = pk(p);
      });
      processAbility(p1, p2, ball, ctrl.keyboardArray[0], 'p1', ctrl);
      processAbility(p2, p1, ball, ctrl.keyboardArray[1], 'p2', ctrl);
      processDebuffs(p1, ctrl.keyboardArray[0], 'p1');
      processDebuffs(p2, ctrl.keyboardArray[1], 'p2');
      ballMem.prevPower = !!ball.isPowerHit;
      ballMem.prevVx = ball.xVelocity;
    }
    draw(ctrl, inMenu);
  };

  function trackOrigin(player) {
    var m = meta[pk(player)];
    if (player.character !== m.transformedTo) {
      m.origin = player.character;   // 玩家從選單換了角色
      m.transformedTo = null;
    }
  }

  function processAbility(player, opp, ball, input, key, ctrl) {
    var s = state[key];
    var oppS = state[key === 'p1' ? 'p2' : 'p1'];
    if (s.char !== player.character) {
      state[key] = s = newSide();
      s.char = player.character;
      player.pvNoClamp = false;
    }
    var def = CHARS[player.character];
    if (!def || !def.ability) return;
    var fn = ABILITIES[def.ability];
    if (fn) fn(player, opp, ball, input, s, oppS, ctrl);
  }


  // ============================================================
  // 電腦 AI：遊戲本體的 AI 只會打皮卡丘，這裡依角色修正它的輸入
  // main.bundle.js 在 AI 決定好按鍵之後呼叫 window._pvAI(player, ball, opponent, input)
  // ============================================================
  var AI = {
    // 水伊布：球落點離很遠時用衝刺趕過去
    vaporeon: function (p, ball, opp, input) {
      var target = ball.expectedLandingPointX;
      var mySide = p.isPlayer2 ? target > NET_X : target < NET_X;
      if (p.state === 0 && mySide && Math.abs(target - p.x) > TUNING.vaporeonAIDash && Math.random() < TUNING.vaporeonAIDashChance && !p.isDashing && p.dashCooldown === 0) {
        input.dashRequest = target > p.x ? 1 : -1;
      }
    },
    // 閃電鳥：在空中、球在頭上方時拍翅追球（拍翅需要每次重新按「上」）
    bird: function (p, ball, opp, input) {
      if ((p.state === 1 || p.state === 2) && p.flapsLeft > 0 &&
          ball.y < p.y - 16 && Math.abs(ball.x - p.x) < 60 && p.yVelocity > -4) {
        input.yDirection = p.prevYDirection === -1 ? 0 : -1;
      }
    },
    // 胖丁：球在對面、自己還在空中時快速落地回防
    jigglypuff: function (p, ball, opp, input) {
      var away = p.isPlayer2 ? ball.x < NET_X : ball.x > NET_X;
      if ((p.state === 1 || p.state === 2) && away && p.yVelocity > 0) input.yDirection = 1;
    },
    // 雷伊布：球的落點很遠就電光一閃過去；在空中球就在旁邊但構不到時，閃過去打
    jolteon: function (p, ball, opp, input, s) {
      if (s.qaCooldown || !TUNING.qaAI) return;
      var target = ball.expectedLandingPointX, mySide = p.isPlayer2 ? target > NET_X : target < NET_X;
      if (p.state === 0 && mySide && Math.abs(target - p.x) > 90 && Math.random() < 0.15) s.zipRequest = target > p.x ? 1 : -1;
      else if ((p.state === 1 || p.state === 2) && Math.abs(ball.y - p.y) < 45) {
        var dx = ball.x - p.x;
        if (Math.abs(dx) > 35 && Math.abs(dx) < 90) s.zipRequest = dx > 0 ? 1 : -1;
      }
    },
    // 卡比獸：跳不高，球還在高處時不要起跳，等球掉下來用肚子接
    snorlax: function (p, ball, opp, input) {
      if (p.state === 0 && input.yDirection === -1 && ball.y < 150) input.yDirection = 0;
    },
    // 可達鴨：頭痛滿 3 層時，在空中一碰到球就殺
    psyduck: function (p, ball, opp, input, s) {
      if ((s.headacheCharge || 0) >= 3 && (p.state === 1 || p.state === 2) &&
          Math.abs(ball.x - p.x) < 40 && Math.abs(ball.y - p.y) < 40) input.powerHit = 1;
    },
  };

  window._pvAI = function (player, ball, opp, input) {
    if (!player.isComputer) return;
    var s = state[pk(player)] || {};
    var fn = AI[player.character];
    if (fn) fn(player, ball, opp, input, s);

    // 防卡死：原版 AI 有時會在自己場上一直用頭頂球、永遠不殺球
    var mine = player.isPlayer2 ? ball.x >= NET_X : ball.x < NET_X;
    s.ownSide = mine ? (s.ownSide || 0) + 1 : 0;
    if (TUNING.antiStall && s.ownSide > TUNING.antiStall) {
      if (player.state === 0 && Math.abs(ball.x - player.x) < 30 && ball.yVelocity > 0 && ball.y > 40 && ball.y < 150) input.yDirection = -1;
      if ((player.state === 1 || player.state === 2) && Math.abs(ball.x - player.x) < 40 && Math.abs(ball.y - player.y) < 40) {
        input.powerHit = 1;
        input.xDirection = player.isPlayer2 ? -1 : 1;
      }
    }
  };

  // ============================================================
  // 技能
  // ============================================================
  var ABILITIES = {
    // 閃電鳥「雷擊俯衝」：同一次跳躍拍翅 3 次以上後殺球，球速加快、往下砸，而且帶電（對手接到會麻痺）
    flying: function (player, opp, ball, input, s, oppS) {
      var flaps = 6 - (player.flapsLeft || 0);
      s.thunderReady = player.state !== 0 && player.y < GROUND_Y && flaps >= TUNING.birdChargeFlaps;
      if (powerHitEdge(player, s, 'hit') && s.thunderReady) {
        aimAtCourt(ball, player.isPlayer2, TUNING.birdMaxVx);
        ball.punchEffectRadius = 35;
        pushBurst(ball.x, ball.y, '#FFE14D', 80);
        pushFlash('#FFE14D', 0.25, 6);
        tier(player, 3, ball.x, ball.y);
        s.charged = true;
      }
      if (s.charged) {
        if (edge(s, 'oppTouch', opp.isCollisionWithBallHappened)) {
          s.charged = false;
          if (Math.random() < TUNING.staticChance) {
            oppS.stunTimer = TUNING.staticStun; oppS.stunX = opp.x;
            pushBurst(opp.x, opp.y, '#FFE14D', 60);
          }
        } else if (ball.y >= GROUND_BALL_Y - 2) s.charged = false;
      }
    },

    // 水伊布：撲救留下水窪，球落在水窪會彈起
    acidArmor: function (player, opp, ball, input, s) {
      s.puddles = s.puddles || [];
      if (edge(s, 'diving', player.state === 3)) {
        s.puddles.push({ x: player.x, timer: TUNING.puddleLife, max: TUNING.puddleLife });
        if (s.puddles.length > TUNING.puddleMax) s.puddles.shift();
      }
      for (var i = s.puddles.length - 1; i >= 0; i--) {
        var pd = s.puddles[i];
        if (--pd.timer <= 0) { s.puddles.splice(i, 1); continue; }
        if (Math.abs(ball.x - pd.x) < 20 && ball.y >= GROUND_BALL_Y - 3 && ball.yVelocity > 0) {
          ball.yVelocity = -15;
          ball.y = GROUND_BALL_Y - 5;
          s.puddles.splice(i, 1);
          pushBurst(ball.x, FLOOR_Y, '#00BFFF', 40);
          break;
        }
      }
    },

    // 火伊布：殺球 1.4 倍
    fireSmash: function (player, opp, ball, input, s) {
      if (powerHitEdge(player, s, 'hit') && ball.isPowerHit) {
        ball.xVelocity = clampV(Math.round(ball.xVelocity * TUNING.fireSmash));
        if (TUNING.fireDown) ball.yVelocity = clampV(ball.yVelocity + TUNING.fireDown);
        ball.punchEffectRadius = Math.min(ball.punchEffectRadius + 10, 35);
      }
    },

    // 雷伊布：移動加速
    // 雷伊布「電光一閃」：連按兩下方向鍵，瞬間往那個方向閃過去（地上、空中都可以），
    // 閃完 0.6 秒內殺球會變成又快又準的電光殺球
    emWave: function (player, opp, ball, input, s) {
      moveBonus(player, input, TUNING.joltSpeed);
      if (s.qaCooldown > 0) s.qaCooldown--;
      // 自己判斷「連點兩下」：第一下必須是短促的點按（按住不超過 3 幀），第二下在 6 幀內。
      // 只看兩次按下的間隔的話，左右微調走位時很容易誤觸
      s.fc = (s.fc || 0) + 1;
      var dirNow = input.xDirection, tap = 0;
      if (dirNow !== 0 && dirNow !== (s.prevDir || 0)) {
        if (s.tapDir === dirNow && s.fc - s.tapAt <= 6 && s.tapHeld <= 3) tap = dirNow;
        s.tapDir = dirNow; s.tapAt = s.fc; s.tapHeld = 0;
      } else if (dirNow !== 0 && dirNow === s.tapDir) s.tapHeld++;
      s.prevDir = dirNow;
      var req = (player.isComputer ? 0 : tap) || s.zipRequest || 0;
      s.zipRequest = 0;
      if (req && !s.qaCooldown && player.state < 3) {
        s.zipFrames = TUNING.qaFrames;
        s.zipDir = req;
        s.qaCooldown = TUNING.qaCooldown;
        s.zipTrail = { x0: player.x, y: player.y, t: 8 };
        if (window._pvFxEvent) window._pvFxEvent('zipStart', { player: player, dir: req });
      }
      if (s.zipFrames > 0) {
        s.zipFrames--;
        player.x += s.zipDir * TUNING.qaDistance / TUNING.qaFrames;
        clampPlayer(player);
        s.zipTrail.x1 = player.x;
        s.zipTrail.y = player.y;
        if (s.zipFrames === 0) {
          s.qaWindow = TUNING.qaWindow;
          if (window._pvFxEvent) window._pvFxEvent('zipEnd', { player: player, x0: s.zipTrail.x0, x1: player.x, y: player.y });
        }
      }
      if (s.zipTrail && s.zipTrail.t > 0) s.zipTrail.t--;
      if (s.qaWindow > 0) {
        s.qaWindow--;
        if (powerHitEdge(player, s, 'qaHit')) {
          aimAtCourt(ball, player.isPlayer2, TUNING.qaSpikeVx);
          makePowerHit(ball, 35);
          pushBurst(ball.x, ball.y, '#FFE14D', 70);
          tier(player, 3, ball.x, ball.y);
          s.qaWindow = 0;
        }
      } else {
        s.qaHit = player.isCollisionWithBallHappened && player.state === 2;   // 讓邊緣偵測保持同步
      }
    },

    // 耿鬼：殺球後可穿網，推開對手；暗影球加速
    ghostPhase: function (player, opp, ball, input, s) {
      if (powerHitEdge(player, s, 'hit')) {
        s.ghostTimer = 37;
        player.pvNoClamp = true;
        ball.xVelocity = clampV(Math.round(ball.xVelocity * TUNING.shadowBall));
        if (TUNING.shadowDown) ball.yVelocity = clampV(ball.yVelocity + TUNING.shadowDown);
        pushFlash('#8B00FF', 0.25, 6);
      }
      if (s.ghostTimer > 0) {
        s.ghostTimer--;
        if (Math.abs(player.x - opp.x) < 40) {
          opp.x += (player.x < opp.x ? 1 : -1) * 4;
          clampPlayer(opp);
        }
        if (s.ghostTimer === 0) player.pvNoClamp = false;
      }
    },

    // 卡比獸：慢、跳低、肚皮彈球、落地震波
    bellyBounce: function (player, opp, ball, input, s) {
      moveBonus(player, input, -2);
      if (player.state === 1 && player.yVelocity < -10) player.yVelocity = -10;
      if (edge(s, 'body', player.isCollisionWithBallHappened && player.state !== 2)) {
        ball.yVelocity = -TUNING.bellyBounce;
        // 往對面推一點，避免球在肚子上無限直上直下
        if (TUNING.bellyPush) ball.xVelocity = clampV(ball.xVelocity + (player.isPlayer2 ? -1 : 1) * TUNING.bellyPush);
      }
      if (s.wasInAir && player.y >= GROUND_Y) {
        s.wasInAir = false;
        s.quake = 8;   // 每次落地都會有，所以只畫地震圈、不震畫面
        if (opp.y >= GROUND_Y - 4) opp.yVelocity = -8;
      }
      if (player.y < GROUND_Y) s.wasInAir = true;
      if (s.quake > 0) s.quake--;
    },

    // 喵喵：殺球撒金幣，對手踩到定身
    payday: function (player, opp, ball, input, s, oppS) {
      s.coins = s.coins || [];
      if (powerHitEdge(player, s, 'hit') && s.coins.length < TUNING.meowthMaxCoins) {
        var lo = player.isPlayer2 ? P1_MIN_X : P2_MIN_X;
        var hi = player.isPlayer2 ? P1_MAX_X : P2_MAX_X;
        s.coins.push({ x: lo + Math.random() * (hi - lo), timer: 100, max: 100 });
      }
      for (var i = s.coins.length - 1; i >= 0; i--) {
        var c = s.coins[i];
        if (--c.timer <= 0) { s.coins.splice(i, 1); continue; }
        if (Math.abs(opp.x - c.x) < TUNING.coinRadius && opp.y >= GROUND_Y - 4) {
          if (TUNING.coinSlow) oppS.slowTimer = TUNING.coinSlow;
          else { oppS.stunTimer = TUNING.coinStun; oppS.stunX = opp.x; }
          s.coins.splice(i, 1);
          pushBurst(c.x, FLOOR_Y, '#FFD700', 30);
          break;
        }
      }
    },

    // 超夢：移動快；殺球後球急墜、折返、猛砸
    // 超夢（Boss）：殺球後球會急墜；念力導向冷卻好的話，球一過網就被轉往對手場上「離對手最遠的那一邊」
    psychic: function (player, opp, ball, input, s) {
      moveBonus(player, input, TUNING.mewtwoSpeed);
      if (s.psyCooldown > 0) s.psyCooldown--;
      if (powerHitEdge(player, s, 'hit')) {
        s.psychicTimer = 40;
        s.psychicFrame = 0;
        s.redirected = false;
        psyBall = { owner: pk(player) };   // 球變紫色＋殘影，直到對手碰到球或球落地
      }
      if (s.psychicTimer > 0) {
        s.psychicTimer--;
        s.psychicFrame++;
        if (opp.isCollisionWithBallHappened || ball.y >= GROUND_BALL_Y - 2) { s.psychicTimer = 0; return; }
        var onOppSide = player.isPlayer2 ? ball.x < NET_X : ball.x > NET_X;
        if (s.psychicFrame === 8) ball.yVelocity = clampV(ball.yVelocity + TUNING.psychicDrop);
        if (!s.redirected && !s.psyCooldown && TUNING.psychicReverse && onOppSide && ball.y < GROUND_BALL_Y - 40) {
          s.redirected = true;
          s.psyCooldown = TUNING.psychicCooldown;   // 冷卻好時超夢身邊有紫色光環
          var lo = player.isPlayer2 ? P1_MIN_X + 8 : P2_MIN_X + 8, hi = player.isPlayer2 ? P1_MAX_X - 8 : P2_MAX_X - 8;
          var far = Math.abs(opp.x - lo) > Math.abs(opp.x - hi) ? lo : hi;
          var target = opp.x + (far - opp.x) * TUNING.psychicAim;   // psychicAim：0 = 打向對手、1 = 打到最遠的角落
          var vy0 = ball.yVelocity, tt = -vy0 + Math.sqrt(vy0 * vy0 + 2 * Math.max(0, GROUND_BALL_Y - ball.y));
          if (tt > 0) ball.xVelocity = clampV(Math.round((target - ball.x) / tt));
          pushBurst(ball.x, ball.y, '#B048FF', 70);
          tier(player, 3, ball.x, ball.y, { k: 'psy' });
        }
      }
    },

    // 頑皮雷彈：球路突變後爆炸
    fakeBall: function (player, opp, ball, input, s, oppS) {
      if (powerHitEdge(player, s, 'hit')) { s.bombTimer = 25; s.bombFrame = 0; }
      if (s.bombTimer > 0) {
        s.bombTimer--;
        s.bombFrame++;
        if (s.bombFrame === 10) {
          ball.xVelocity = clampV(ball.xVelocity + (Math.random() - 0.5) * 12);
          ball.yVelocity = clampV(ball.yVelocity + (Math.random() - 0.5) * 8);
        }
        if (s.bombFrame === 25) {
          pushBurst(ball.x, ball.y, '#FF4444', 70);
          pushFlash('#FF4444', 0.2, 5);   // 每次殺球都會爆，不算技能級
          if (Math.abs(opp.x - ball.x) < 50) {
            opp.x += (opp.x < ball.x ? -1 : 1) * 30;
            clampPlayer(opp);
            oppS.stunTimer = 10;
            oppS.stunX = opp.x;
          }
        }
      }
    },

    // 果然翁：自己殺球弱，身體接殺球 2.5 倍反彈
    counter: function (player, opp, ball, input, s) {
      moveBonus(player, input, -1);
      if (edge(s, 'weak', player.isCollisionWithBallHappened && player.state === 2)) {
        ball.xVelocity = Math.round(ball.xVelocity * TUNING.wobbuffetSpike);
      }
      if (edge(s, 'counter', receivedSpike(player))) {
        // 先把球高高彈起（蓄力），到最高點再自動往對面猛砸
        ball.xVelocity = player.isPlayer2 ? -2 : 2;
        ball.yVelocity = -TUNING.counterLaunch;
        s.counterPending = true;
        makePowerHit(ball, 30);
        pushFlash('#4FC3F7', 0.3, 7);
        pushBurst(ball.x, ball.y, '#4FC3F7', 60);
      }
      if (s.counterPending) {
        if (opp.isCollisionWithBallHappened || ball.y >= GROUND_BALL_Y - 2) s.counterPending = false;
        else if (ball.yVelocity >= 0) {
          s.counterPending = false;
          aimAtCourt(ball, player.isPlayer2, TUNING.counterMaxVx);
          makePowerHit(ball, 35);
          pushFlash('#4FC3F7', 0.3, 6);
          pushBurst(ball.x, ball.y, '#4FC3F7', 80);
          tier(player, 3, ball.x, ball.y);
        }
      }
    },

    // （果然翁的反擊在 counterApex 處理）

    // 百變怪：變身在得分時處理
    transform: null,

    // 魔牆人偶：網上方彈珠牆
    barrier: function (player, opp, ball, input, s) {
      if (powerHitEdge(player, s, 'hit')) s.barrierTimer = TUNING.barrierFrames;
      if (s.barrierTimer > 0) {
        s.barrierTimer--;
        // 只擋「往自己這邊飛」的球，彈回對面；自己打出去的球直接通過
        var incoming = player.isPlayer2 ? ball.xVelocity > 0 : ball.xVelocity < 0;
        if (incoming && Math.abs(ball.x - NET_X) < 35 && ball.y > 30 && ball.y < 176) {
          ball.xVelocity = clampV(-ball.xVelocity + (Math.random() - 0.5) * 5);
          ball.yVelocity = clampV(ball.yVelocity + (Math.random() - 0.5) * 10);
          ball.x += ball.xVelocity > 0 ? 5 : -5;
          pushBurst(ball.x, ball.y, '#FF69B4', 25);
        }
      }
    },

    // 三地鼠：起跳留沙丘
    dig: function (player, opp, ball, input, s) {
      moveBonus(player, input, 2);
      s.mounds = s.mounds || [];
      if (edge(s, 'air', player.y < GROUND_Y) && s.mounds.length < 3) {
        s.mounds.push({ x: player.x, timer: 150, max: 150 });
      }
      for (var i = s.mounds.length - 1; i >= 0; i--) {
        var m = s.mounds[i];
        if (--m.timer <= 0) { s.mounds.splice(i, 1); continue; }
        if (Math.abs(ball.x - m.x) < 25 && ball.y >= GROUND_BALL_Y - 5 && ball.yVelocity > 0) {
          ball.yVelocity = -(10 + Math.random() * 10);
          ball.xVelocity = clampV(ball.xVelocity + (Math.random() - 0.5) * 15);
          ball.y = GROUND_BALL_Y - 6;
          s.mounds.splice(i, 1);
          pushBurst(ball.x, FLOOR_Y, '#D2B48C', 40);
          break;
        }
      }
    },

    // 大蔥鴨：平快殺球，過網後回飄
    leekBoomerang: function (player, opp, ball, input, s) {
      if (powerHitEdge(player, s, 'hit')) {
        if (ball.isPowerHit) {
          ball.yVelocity = Math.round(ball.yVelocity * 0.3);
          ball.xVelocity = clampV(Math.round(ball.xVelocity * 1.5));
        }
        s.boomerangTimer = 20;
      }
      if (s.boomerangTimer > 0 && --s.boomerangTimer === 0) {
        var crossed = player.isPlayer2 ? ball.x < NET_X : ball.x > NET_X;
        if (crossed) ball.xVelocity = clampV(Math.round(-ball.xVelocity * 0.6));
      }
    },

    // 可達鴨：偶爾跌倒；累積頭痛後爆發
    headache: function (player, opp, ball, input, s, oppS, ctrl) {
      s.tripCounter = s.tripCounter || 0;
      if (player.state === 0 && input.xDirection !== 0) {
        if (++s.tripCounter >= 50) {
          s.tripCounter = 0;
          if (Math.random() < TUNING.psyTrip) { s.stunTimer = 5; s.stunX = player.x; }
        }
      } else {
        s.tripCounter = 0;
      }
      if (edge(s, 'charge', receivedSpike(player))) {        // 接起對手的殺球也會疊一層
        s.headacheCharge = (s.headacheCharge || 0) + 1;
      }
      if (edge(s, 'release', player.isCollisionWithBallHappened && player.state === 2) && (s.headacheCharge || 0) >= TUNING.headacheNeed) {
        // 頭痛大爆發：超快、往下砸的念力殺球
        aimAtCourt(ball, player.isPlayer2, TUNING.headacheMaxVx);
        if (TUNING.headacheStun) { oppS.stunTimer = TUNING.headacheStun; oppS.stunX = opp.x; }   // 念力讓對手頭暈一下
        makePowerHit(ball, 40);
        ctrl.slowMotionFramesLeft = 6;
        s.headacheCharge = 0;
        pushBurst(player.x, player.y - 30, '#FFD54F', 80);
        tier(player, 4, ball.x, ball.y);
      }
    },

    // 鯉魚王：弱，起跳有機率進化暴鯉龍
    splash: function (player, opp, ball, input, s, oppS) {
      if (!s.isGyarados) {
        moveBonus(player, input, -TUNING.magikarpSlow);
        var recv = edge(s, 'recv', receivedSpike(player)) && Math.random() < TUNING.magikarpReceiveEvolve;
        if ((edge(s, 'jump', player.state === 1) && Math.random() < TUNING.magikarpEvolveChance) || recv) {
          s.isGyarados = true;
          // 極少數會進化成紅色暴鯉龍：撐更久、打得更狠，還會威嚇對手
          s.isRed = Math.random() < TUNING.redGyaradosChance;
          s.gyaradosTimer = s.isRed ? TUNING.redGyaradosFrames : 100;
          pushBurst(player.x, player.y, s.isRed ? '#FF1744' : '#29B6F6', s.isRed ? 120 : 80);
          s.gyaFirst = true;   // 進化後的第一下殺球是必殺
          // 紅色暴鯉龍出現＝必殺；一般進化＝技能級（每分鐘會進化好幾次，每次都必殺會看膩）
          tier(player, s.isRed ? 4 : 3, player.x, player.y - 20, { k: s.isRed ? 'evoR' : 'evo' });
        }
        return;
      }
      moveBonus(player, input, 3);
      if (touchEdge(player, s, 'gyaHit')) {
        // 暴鯉龍的每一下都是保證打進對面的重擊（之前單純加速，常常出界）
        aimAtCourt(ball, player.isPlayer2, s.isRed ? TUNING.redGyaradosVx : TUNING.gyaradosVx);
        makePowerHit(ball, 35);
        // 紅色暴鯉龍進化後第一下＝必殺；一般暴鯉龍每一下都是技能級
        tier(player, s.gyaFirst && s.isRed ? 4 : 3, ball.x, ball.y, s.isRed ? { k: 'red' } : null);
        s.gyaFirst = false;
        if (s.isRed && TUNING.redGyaradosStun) { oppS.stunTimer = TUNING.redGyaradosStun; oppS.stunX = opp.x; }
      }
      if (--s.gyaradosTimer <= 0) { s.isGyarados = false; s.isRed = false; }
    },

    // 胖丁：高跳慢落，殺球讓對手左右顛倒
    sing: function (player, opp, ball, input, s, oppS) {
      if (player.state === 1 && !s.jumpBoosted && player.yVelocity <= -14 && player.yVelocity >= -18) {
        s.jumpBoosted = true;
        if (TUNING.jigglyJump) player.yVelocity = -TUNING.jigglyJump;
      }
      if (player.state === 0) s.jumpBoosted = false;
      var fastFall = (player.state === 1 || player.state === 2) && input.yDirection === 1 && player.y < GROUND_Y;
      if (fastFall) {
        // 空中按「下」：取消漂浮、快速落地
        player.yVelocity = Math.max(player.yVelocity, 2) + TUNING.jigglyFastFall;
        s.fastFalling = true;
      } else if (player.y < GROUND_Y && player.yVelocity > 0) {
        player.yVelocity = Math.max(player.yVelocity - TUNING.jigglyFloat, 0.3);
      }
      if (player.y >= GROUND_Y) s.fastFalling = false;
      if (powerHitEdge(player, s, 'hit')) oppS.reverseTimer = TUNING.singFrames;
    },

    // 夢幻：碰球機率替球加護盾
    psychicShield: function (player, opp, ball, input, s) {
      moveBonus(player, input, 1);
      if (touchEdge(player, s, 'touch') && Math.random() < TUNING.mewAuraChance) {
        s.auraTimer = 50;
      }
      if (s.auraTimer > 0) {
        s.auraTimer--;
        var mySide = player.isPlayer2 ? ball.x >= NET_X : ball.x < NET_X;
        if (mySide && ball.y >= 250 && ball.yVelocity > 0) {
          ball.yVelocity = -12;
          ball.y = 249;
          s.auraTimer = 0;
          pushBurst(ball.x, ball.y, '#FFB6C1', 45);
        }
      }
    },

    // 快龍：殺球後暴走
    // 快龍「逆鱗」：殺球後暴走。暴走中每次殺球疊一層（最多 3 層），一層比一層砸得更重更快；
    // 暴走結束後會混亂（左右顛倒）一下，跟原作的逆鱗一樣有代價
    outrage: function (player, opp, ball, input, s) {
      moveBonus(player, input, 1);
      if (powerHitEdge(player, s, 'hit')) {
        if (!(s.outrageTimer > 0)) {
          pushBurst(player.x, player.y, '#FF6D00', 90);
          s.rageStacks = 0;
        } else if (ball.isPowerHit) {
          s.rageStacks = Math.min(3, (s.rageStacks || 0) + 1);
          ball.yVelocity = clampV(ball.yVelocity + TUNING.outrageDown * s.rageStacks);
          ball.xVelocity = clampV(Math.round(ball.xVelocity * (1 + 0.08 * s.rageStacks)));
          ball.punchEffectRadius = Math.min(ball.punchEffectRadius + 6 * s.rageStacks, 40);
          pushBurst(ball.x, ball.y, '#FF6D00', 40 + 15 * s.rageStacks);
          tier(player, s.rageStacks >= 3 ? 4 : 3, ball.x, ball.y, { k: 'rage' });   // 三層逆鱗＝必殺
        }
        s.outrageTimer = TUNING.outrageFrames;
      }
      if (s.outrageTimer > 0) {
        s.outrageTimer--;
        moveBonus(player, input, TUNING.outrageSpeed);
        if (s.outrageTimer === 0) {
          s.rageStacks = 0;
          s.reverseTimer = TUNING.outrageConfuse;
        }
      }
    },

    // 皮卡丘「靜電」：殺出去的球帶電，對手接到時有機率被麻痺
    static: function (player, opp, ball, input, s, oppS) {
      if (powerHitEdge(player, s, 'hit')) s.charged = true;
      if (s.charged) {
        if (edge(s, 'oppTouch', opp.isCollisionWithBallHappened)) {
          s.charged = false;
          if (Math.random() < TUNING.staticChance) {
            oppS.stunTimer = TUNING.staticStun;
            oppS.stunX = opp.x;
            pushBurst(opp.x, opp.y, '#FFE14D', 60);
          }
        } else if (ball.y >= GROUND_BALL_Y - 2 || player.isCollisionWithBallHappened && player.state !== 2) {
          s.charged = false;
        }
      }
    }
  };

  // 所有角色共用的負面狀態（定身、顛倒），不論被誰施放都會生效
  function processDebuffs(player, input, key) {
    var s = state[key];
    if (s.stunTimer > 0) {
      s.stunTimer--;
      if (s.stunX != null) player.x = s.stunX;
    }
    if (s.slowTimer > 0) {             // 踩到金幣滑一跤：移動速度減半
      s.slowTimer--;
      if (player.state < 3 && input.xDirection !== 0) { player.x -= input.xDirection * 3; clampPlayer(player); }
    }
    if (s.reverseTimer > 0) {
      s.reverseTimer--;
      // 遊戲本體每幀移動 6 * 方向；先反推 10，淨效果是反方向 4
      if (player.state < 3 && input.xDirection !== 0) {
        player.x -= input.xDirection * 10;
        clampPlayer(player);
      }
    }
  }

  // ============================================================
  // 特效（一張疊在遊戲畫面上的透明 canvas）
  // ============================================================
  var overlay = null, octx = null, lastRect = '';

  function ensureOverlay() {
    if (overlay) return true;
    if (!document.body) return false;
    overlay = document.createElement('canvas');
    overlay.id = 'pv-fx-overlay';
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:45;';
    document.body.appendChild(overlay);
    octx = overlay.getContext('2d');
    return true;
  }

  function syncOverlay() {
    var gc = document.getElementById('game-canvas');
    if (!gc) return false;
    // 用「沒有震動／鏡頭衝擊時」的位置，震動由 juice.js 用 CSS transform 套上去
    var r = window._pvBaseRect ? window._pvBaseRect(gc) : gc.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var dpr = window.devicePixelRatio || 1;
    var key = [r.left, r.top, r.width, r.height, dpr].join(',');
    if (key !== lastRect) {
      lastRect = key;
      overlay.style.left = r.left + 'px';
      overlay.style.top = r.top + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
      overlay.width = Math.round(r.width * dpr);
      overlay.height = Math.round(r.height * dpr);
    }
    octx.setTransform(overlay.width / W, 0, 0, overlay.height / H, 0, 0);
    return true;
  }

  function pushBurst(x, y, color, size) { fx.bursts.push({ x: x, y: y, color: color, size: size, t: 0, max: 8 }); }
  // 全畫面閃色：在 25 FPS 下太強會像畫面壞掉，所以統一減半、最多 3 幀
  // 特效分級：技能真正發動的那一刻告訴 juice.js 這一球是幾級（3 = 技能、4 = 必殺）
  function tier(player, lvl, x, y, extra) {
    if (!window._pvFxEvent) return;
    var d = { player: player, lvl: lvl, x: x, y: y };
    if (extra) for (var k in extra) d[k] = extra[k];
    window._pvFxEvent('skill', d);
  }
  function pushFlash(color, alpha, frames) { fx.flashes.push({ color: color, alpha: alpha * 0.5, t: 0, max: Math.min(3, frames) }); }



  var drawTick = 0;
  function draw(ctrl, inMenu) {
    if (window._pvSim) return;
    drawTick++;
    if (!ensureOverlay() || !syncOverlay()) return;
    var g = octx;
    g.clearRect(0, 0, W, H);
    if (inMenu) return;
    var ball = ctrl.physics.ball;

    ['p1', 'p2'].forEach(function (key) {
      var s = state[key];
      var player = ctrl.physics[key === 'p1' ? 'player1' : 'player2'];
      drawFieldMarks(g, s, ball);
      drawStatus(g, s, player, drawTick);
    });

    fx.bursts = fx.bursts.filter(function (b) {
      var k = b.t / b.max, r = 4 + b.size / 2 * k;
      g.globalAlpha = 1 - k;
      g.strokeStyle = b.color; g.lineWidth = 3;
      g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.stroke();
      g.fillStyle = b.color; g.globalAlpha = (1 - k) * 0.25;
      g.beginPath(); g.arc(b.x, b.y, r, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      return ++b.t < b.max;
    });
    var liteFx = window._pvFxLite && window._pvFxLite();
    if (liteFx) fx.flashes = [];   // 精簡特效：不閃全畫面
    fx.flashes = fx.flashes.filter(function (f) {
      g.globalAlpha = f.alpha * (1 - f.t / f.max);
      g.fillStyle = f.color; g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      return ++f.t < f.max;
    });
  }

  function drawFieldMarks(g, s, ball) {
    (s.puddles || []).forEach(function (p) {
      g.globalAlpha = 0.35 + 0.5 * Math.min(1, p.timer / 15);
      g.fillStyle = '#29B6F6';
      g.beginPath(); g.ellipse(p.x, FLOOR_Y, 20, 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#B3E5FC';
      g.beginPath(); g.ellipse(p.x - 5, FLOOR_Y - 1, 7, 1.5, 0, 0, Math.PI * 2); g.fill();
    });
    (s.coins || []).forEach(function (c) {
      g.globalAlpha = c.timer < 20 && c.timer % 4 < 2 ? 0.4 : 1;
      g.fillStyle = '#FFC107'; g.strokeStyle = '#8D6E00'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(c.x, FLOOR_Y, 9, 5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    });
    (s.mounds || []).forEach(function (m) {
      g.globalAlpha = 0.5 + 0.5 * Math.min(1, m.timer / 20);
      g.fillStyle = '#C8A26B'; g.strokeStyle = '#7B5B2E'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(m.x, FLOOR_Y + 2, 24, 9, 0, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
    });
    g.globalAlpha = 1;
    if (s.barrierTimer > 0) {
      g.globalAlpha = 0.15 + 0.15 * Math.abs(Math.sin(s.barrierTimer / 3));
      g.fillStyle = '#FF80AB';
      g.fillRect(NET_X - 35, 30, 70, 146);
      g.globalAlpha = 0.7;
      g.strokeStyle = '#FF4081'; g.lineWidth = 1.5;
      g.strokeRect(NET_X - 35, 30, 70, 146);
      g.globalAlpha = 1;
    }
    if (s.auraTimer > 0) ring(g, ball.x, ball.y, 26, '#FF80AB', 0.8);
    if (s.charged) zap(g, ball.x, ball.y);
    if (s.bombTimer > 0 && s.bombTimer % 4 < 2) ring(g, ball.x, ball.y, 22, '#FF1744', 0.9);
  }

  // 角色狀態一律用圖示表示，不寫字
  function drawStatus(g, s, player, tick) {
    var x = player.x, top = player.y - 40;
    if (s.isGyarados) {
      var pulse = 34 + Math.sin(tick / 2) * 3, gc = s.isRed ? '#FF1744' : '#29B6F6';
      ring(g, x, player.y, pulse, gc, 0.7);
      ring(g, x, player.y, pulse - 5, s.isRed ? '#FFD54F' : '#B3E5FC', 0.5);
      if (s.isRed) for (var sk = 0; sk < 3; sk++) {           // 紅色暴鯉龍：身邊閃金光
        var sa = tick / 5 + sk * 2.1;
        starIcon(g, x + Math.cos(sa) * 30, player.y + Math.sin(sa) * 26, 3, '#FFD54F');
      }
    }
    if (s.ghostTimer > 0) ring(g, x, player.y, 34, '#7C4DFF', 0.6);
    if (s.qaWindow > 0) zap(g, x, player.y);
    if (s.char === 'mewtwo' && !s.psyCooldown) ring(g, x, player.y, 30 + Math.sin(tick / 3) * 2, '#B048FF', 0.7);   // 超夢：念力球準備好了
    if (s.fastFalling && player.y < GROUND_Y) {          // 胖丁快速落地：頭上的速度線
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.globalAlpha = 0.85;
      for (var ff = -1; ff <= 1; ff++) { g.beginPath(); g.moveTo(x + ff * 9, player.y - 30 - (tick % 3) * 3); g.lineTo(x + ff * 9, player.y - 48 - (tick % 3) * 3); g.stroke(); }
      g.globalAlpha = 1;
    }            // 雷伊布：電光殺球準備好了
    if (s.thunderReady) zap(g, x, player.y);          // 閃電鳥：雷擊俯衝準備好了
    if (s.outrageTimer > 0) {
      var st = s.rageStacks || 0;
      g.globalAlpha = 0.5 + 0.15 * st; g.strokeStyle = st >= 3 ? '#FF1744' : '#FF6D00'; g.lineWidth = 2 + st * 1.5;
      g.beginPath(); g.arc(x, player.y, 34 + (tick % 4), 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      for (var rs = 0; rs < 3; rs++) flame(g, x - 12 + rs * 12, top - 4, rs < st);
    }
    if (s.reverseTimer > 0) {           // 繞著頭轉的音符
      for (var i = 0; i < 2; i++) {
        var a = tick / 4 + i * Math.PI;
        note(g, x + Math.cos(a) * 14, top + Math.sin(a) * 4, '#FF80C0');
      }
    }
    if (s.stunTimer > 0) {              // 頭上轉圈的星星
      for (var k = 0; k < 3; k++) {
        var b = tick / 3 + k * Math.PI * 2 / 3;
        starIcon(g, x + Math.cos(b) * 13, top + Math.sin(b) * 4, 4, '#FFEB3B');
      }
    }
    if (s.slowTimer > 0) {             // 踩到金幣：頭上一枚轉動的金幣
      var sw = Math.abs(Math.cos(tick / 3)) * 4 + 1;
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(x, top, sw + 1, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFC107'; g.beginPath(); g.ellipse(x, top, sw, 4, 0, 0, Math.PI * 2); g.fill();
    }
    if (s.headacheCharge > 0) {         // 頭痛層數：三顆點
      var n = Math.min(3, s.headacheCharge);
      for (var m = 0; m < 3; m++) dot(g, x - 8 + m * 8, top, 3, m < n ? '#FFD54F' : 'rgba(255,255,255,0.35)');
    }
    if (s.quake > 0) {
      g.globalAlpha = s.quake / 8 * 0.6;
      g.strokeStyle = '#6D4C41'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, FLOOR_Y + 2, 30 + (8 - s.quake) * 6, 4, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
  }

  // 帶電球：繞著球閃的鋸齒電弧
  function zap(g, x, y) {
    g.lineWidth = 2; g.strokeStyle = '#FFE14D'; g.globalAlpha = 0.9;
    for (var k = 0; k < 3; k++) {
      var a = Math.random() * Math.PI * 2;
      g.beginPath();
      for (var j = 0; j < 4; j++) {
        var r = 22 + j * 4, aa = a + (Math.random() - 0.5) * 0.6;
        var px = x + Math.cos(aa) * r, py = y + Math.sin(aa) * r;
        j ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // 逆鱗層數：亮的火焰＝已疊的層，暗的＝還沒疊
  function flame(g, x, y, on) {
    g.beginPath();
    g.moveTo(x, y - 7); g.quadraticCurveTo(x + 6, y, x + 3, y + 5); g.lineTo(x - 3, y + 5); g.quadraticCurveTo(x - 6, y, x, y - 7);
    g.closePath();
    g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    g.fillStyle = on ? '#FF3D00' : 'rgba(255,255,255,0.25)'; g.fill();
    if (on) { g.fillStyle = '#FFD54F'; g.beginPath(); g.arc(x, y + 2, 2, 0, Math.PI * 2); g.fill(); }
  }

  function dot(g, x, y, r, color) {
    g.fillStyle = '#000'; g.beginPath(); g.arc(x, y, r + 1, 0, Math.PI * 2); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  function starIcon(g, x, y, r, color) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    g.fillStyle = color; g.fill();
  }
  function note(g, x, y, color) {
    g.lineWidth = 2; g.strokeStyle = '#000'; g.fillStyle = color;
    g.beginPath(); g.ellipse(x - 2, y + 4, 3, 2.2, -0.4, 0, Math.PI * 2); g.stroke(); g.fill();
    g.fillRect(x, y - 5, 1.6, 9);
    g.beginPath(); g.moveTo(x + 1.6, y - 5); g.quadraticCurveTo(x + 6, y - 3, x + 4, y + 1); g.stroke();
  }

  function ring(g, x, y, r, color, alpha) {
    g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
  // ============================================================
  // 球的光效（直接改遊戲本體的 PIXI 圖層，main.bundle.js 每次畫完球後呼叫）
  //  - 殺球閃光與殘影依「擊球者的屬性」上色（原本一律是黃色閃光＋藍色殘影）
  //  - 超夢殺球後：寶貝球變紫色，後面拖著念力殘影
  // ============================================================
  var gfx = null;          // 重新上色後的貼圖
  var lastHitter = null;   // 最後碰到球的角色
  var trailHist = [];      // 球最近幾幀的位置，給紫色殘影用
  var GHOSTS = 5;

  function hexToNum(hex) { return parseInt(hex.slice(1), 16); }

  function recolor(tex, map) {
    var Texture = tex.constructor;
    var src = tex.baseTexture.resource && tex.baseTexture.resource.source;
    if (!src || !Texture.from) return null;
    var f = tex.frame, c = document.createElement('canvas');
    c.width = f.width; c.height = f.height;
    var g = c.getContext('2d');
    g.drawImage(src, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
    var d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      var out = map(px[i], px[i + 1], px[i + 2]);
      if (out) { px[i] = out[0]; px[i + 1] = out[1]; px[i + 2] = out[2]; }
    }
    g.putImageData(d, 0, 0);
    var t = Texture.from(c);
    if (tex.baseTexture.scaleMode != null) t.baseTexture.scaleMode = tex.baseTexture.scaleMode;
    return t;
  }

  // 黑色描邊保留，其餘變白，之後用 tint 染成任何顏色
  function toWhite(r, g, b) { return (r + g + b < 60) ? null : [255, 255, 255]; }
  // 紅白寶貝球 → 紫色念力球
  function toPurple(r, g, b) {
    if (r > 200 && g < 60 && b < 60) return [176, 72, 255];     // 紅
    if (r > 100 && r < 160 && g < 40) return [92, 28, 160];      // 暗紅
    if (r > 140 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && r < 230) return [222, 196, 255]; // 灰
    if (b > 200 && r < 60 && g < 60) return [200, 120, 255];     // 原殘影的藍
    return null;
  }

  function initGfx(view) {
    var ballTex = view.ball.textures;
    gfx = {
      origBall: ballTex.slice(),
      purpleBall: ballTex.map(function (t) { return recolor(t, toPurple) || t; }),
      origPunch: view.punch.texture,
      punchByType: {},
      punchPurple: null,
      origTrail: view.ballTrail.texture,
      whiteTrail: recolor(view.ballTrail.texture, toWhite),
      origHyper: view.ballHyper.texture,
      purpleHyper: recolor(view.ballHyper.texture, toPurple),
      purple: false,
      ghosts: []
    };
    // 每種屬性一張專屬形狀的殺球特效（punch-shapes.js）
    var Tex = view.punch.texture.constructor;
    if (window.PV_PunchShapes && Tex.from) {
      var tc = window.PV_CHARS.typeColors;
      var mode = view.punch.texture.baseTexture.scaleMode;
      var mk = function (t, col) { var x = Tex.from(window.PV_PunchShapes.make(t, col)); if (mode != null) x.baseTexture.scaleMode = mode; return x; };
      Object.keys(tc).forEach(function (t) { gfx.punchByType[t] = mk(t, tc[t]); });
      gfx.punchPurple = mk('超', '#B048FF');
    }
    // 紫色殘影：放在球的後面
    var Sprite = view.ballHyper.constructor, parent = view.ball.parent;
    for (var i = 0; i < GHOSTS; i++) {
      var sp = new Sprite(gfx.purpleBall[0]);
      sp.anchor.set(0.5, 0.5);
      sp.visible = false;
      parent.addChildAt(sp, Math.max(0, parent.getChildIndex(view.ball)));
      gfx.ghosts.push(sp);
    }
  }

  window._pvDrawBall = function (view, physics) {
    if (window._pvSim) return;
    if (!gfx) {
      try { initGfx(view); } catch (e) { gfx = { failed: true }; }
    }
    if (gfx.failed) return;
    var ball = physics.ball, p1 = physics.player1, p2 = physics.player2;

    if (p1.isCollisionWithBallHappened) lastHitter = p1;
    else if (p2.isCollisionWithBallHappened) lastHitter = p2;

    // 紫色念力球：對手碰到球、球落地就結束
    if (psyBall) {
      var other = psyBall.owner === 'p1' ? p2 : p1;
      if (other.isCollisionWithBallHappened || ball.y >= GROUND_BALL_Y) psyBall = null;
    }
    var purple = !!psyBall;

    // 屬性光
    var c = lastHitter && CHARS[lastHitter.character];
    var tint = purple ? 0xB048FF : hexToNum(c ? c.color : '#FFFFFF');
    var shape = purple ? gfx.punchPurple : (c && gfx.punchByType[c.type]);
    view.punch.texture = shape || gfx.origPunch;
    view.punch.tint = 0xFFFFFF;
    if (gfx.whiteTrail) { view.ballTrail.texture = gfx.whiteTrail; view.ballTrail.tint = tint; }

    // 寶貝球本身
    if (purple !== gfx.purple) {
      gfx.purple = purple;
      view.ball.textures = purple ? gfx.purpleBall : gfx.origBall;
      view.ballHyper.texture = purple && gfx.purpleHyper ? gfx.purpleHyper : gfx.origHyper;
      trailHist = [];
    }
    view.ball.gotoAndStop(ball.rotation);

    trailHist.unshift({ x: ball.x, y: ball.y, r: ball.rotation });
    if (trailHist.length > GHOSTS * 2 + 1) trailHist.pop();
    for (var i = 0; i < GHOSTS; i++) {
      var sp = gfx.ghosts[i], h = trailHist[(i + 1) * 2];
      if (!purple || !h) { sp.visible = false; continue; }
      sp.visible = true;
      sp.texture = gfx.purpleBall[h.r] || gfx.purpleBall[0];
      sp.x = h.x; sp.y = h.y;
      sp.alpha = 0.55 - i * 0.1;
      sp.scale.set(1 + i * 0.06);
    }
    if (purple) {
      // 念力殘影一路顯示，不只在殺球那一下
      view.ballHyper.x = ball.previousX; view.ballHyper.y = ball.previousY;
      view.ballHyper.visible = true;
    }
  };

  window.addEventListener('resize', function () { lastRect = ''; });
  // 連線對戰：主機把技能狀態傳給客機，客機只負責畫
  function rnd(v) { return typeof v === 'number' ? Math.round(v * 10) / 10 : v; }
  function slim(o, depth) {
    if (o === null || typeof o !== 'object') return rnd(o);
    if (depth > 4) return null;
    if (Array.isArray(o)) return o.map(function (v) { return slim(v, depth + 1); });
    var r = {};
    for (var k in o) {
      var v = o[k];
      if (typeof v === 'function' || v === undefined || v === false || v === 0 || v === '') continue;
      if (v && typeof v === 'object' && (v.isPlayer2 !== undefined || v.sprite)) continue;   // 不傳物件參照
      r[k] = slim(v, depth + 1);
    }
    return r;
  }
  function clean(v, depth) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length <= 40 ? v : '';
    if (!v || typeof v !== 'object' || depth > 4) return undefined;
    if (Array.isArray(v)) {
      var arr = [];
      for (var i = 0; i < v.length && i < 32; i++) {
        var x = clean(v[i], depth + 1);
        if (typeof x === 'number' || (x && typeof x === 'object' && !Array.isArray(x))) arr.push(x);
      }
      return arr;
    }
    var r = Object.create(null);
    Object.keys(v).forEach(function (k) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      var x = clean(v[k], depth + 1);
      if (x !== undefined) r[k] = x;
    });
    var out = {};
    Object.keys(r).forEach(function (k) { out[k] = r[k]; });
    return out;
  }
  function mergeSide(o) {
    var d = newSide();
    if (!o || typeof o !== 'object' || Array.isArray(o)) return d;
    Object.keys(o).forEach(function (k) {
      // 型別要跟本機預設一致（預設是陣列就只收陣列…），預設沒有的鍵照收
      if (k in d && d[k] !== null && typeof d[k] === 'object' && Array.isArray(d[k]) !== Array.isArray(o[k])) return;
      if (k in d && typeof d[k] === 'number' && typeof o[k] !== 'number') return;
      d[k] = o[k];
    });
    return d;
  }
  function objList(v) {
    var a = clean(v, 1);
    if (!Array.isArray(a)) return [];
    return a.filter(function (x) { return x && typeof x === 'object' && typeof x.x === 'number' || x && typeof x === 'object' && typeof x.alpha === 'number' || x && typeof x === 'object' && typeof x.t === 'number'; });
  }
  var net = {
    get: function () {
      return { s: slim(state, 0), pb: psyBall ? psyBall.owner : 0, b: slim(fx.bursts, 0), f: slim(fx.flashes, 0) };
    },
    set: function (o) {
      // 資料來自另一台電腦（不可信）：只留數字、布林、短字串、陣列、物件，陣列裡只留物件或數字，
      // 而且一律接在全新的空物件上，避免 __proto__ 之類的鍵污染或形狀不對讓 draw 當掉
      if (!o || typeof o !== 'object') return;
      var ss = o.s && typeof o.s === 'object' ? o.s : {};
      state = { p1: mergeSide(clean(ss.p1, 0)), p2: mergeSide(clean(ss.p2, 0)) };
      psyBall = o.pb === 'p1' || o.pb === 'p2' ? { owner: o.pb } : null;
      fx.bursts = objList(o.b); fx.flashes = objList(o.f);
    },
    draw: function (ctrl) { draw(ctrl, false); },
    clear: function (ctrl) { draw(ctrl, true); }
  };
  window._pvAbilities = { tuning: TUNING, ai: AI, state: function () { return state; }, net: net };
})();
