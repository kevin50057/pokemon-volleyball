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
    // 火伊布：灼傷幾幀（50 = 2 秒）、灼傷時殺球剩幾成力、引火持續幾幀、大字爆的最大球速、大字爆的灼傷幾幀
    burnFrames: 50, burnWeak: 0.7, flashFireFrames: 75, fireBlastVx: 26, fireBlastBurn: 90,
    // 大蔥鴨：大蔥揮擊打得到多遠（一般角色的判定是 32）、居合斬的最大球速
    leekReachX: 54, leekReachY: 44, iaiVx: 28, leekAI: 0.5,
    shadowBall: 1.0, shadowDown: 3,
    // 超夢
    psychicDrop: 15, psychicReverse: 1.0, psychicAim: 0.65, psychicCooldown: 150, mewtwoSpeed: 2,  // 超夢是 Boss，目標勝率約 65%～70%
    // 卡比獸
    bellyBounce: 22, bellyPush: 0,
    // 果然翁
    wobbuffetSpike: 1.0, counterPower: 2, wobbuffetAISpike: 0, counterLaunch: 18, counterMaxVx: 28,
    // 魔牆人偶
    barrierFrames: 35, barrierCooldown: 100, barrierSoftVx: 5, barrierPierce: 0.55,
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
    // 閃電鳥的圖是 96px（其他角色 64px），場上縮成這個倍數，腳底位置不變（juice.js 套用）
    birdScale: 0.82,
    // 胖丁：空中按下的快速落地加速、唱歌顛倒幾幀（100 幀 = 4 秒）
    jigglyFastFall: 3, singFrames: 100,
    // 鯉魚王
    magikarpEvolveChance: 0.07, magikarpSlow: 2, magikarpReceiveEvolve: 0.15,
    gyaradosVx: 24,
    // 紅色暴鯉龍：每次進化有幾 % 是紅色的、撐幾幀（150 = 6 秒）、球速上限、威嚇（對手定身幾幀）
    redGyaradosChance: 0.1, redGyaradosFrames: 150, redGyaradosVx: 30, redGyaradosStun: 10,
    // 夢幻
    mewShieldCD: 500, mewTeleport: 110, mewTeleportCD: 150, mewTeleportAI: 0.005, mewLift: 15, mewChargeFrames: 45, mewBlastVx: 28,
    // 關都御三家（一階，以皮卡丘為 1）
    // 小火龍：走路倍率、撲救距離倍率、「網前」的範圍（離網幾 px 以內，半場寬 216 的 1/3）、網前殺球的球速倍率
    charmanderMove: 1.03, charmanderDive: 1.10, charmanderNetZone: 72, charmanderNetSpike: 1.08,
    // 妙蛙種子：走路、跳躍高度倍率、擊球判定左右加寬幾 px、飛葉過網時水平速度減多少、過網後每幾幀多加 1 重力
    bulbasaurMove: 0.95, bulbasaurJump: 0.95, bulbasaurReach: 5, leafDrag: 1, leafGravEvery: 3,
    // 傑尼龜：走路、跳躍高度、殺球球速、撲救距離倍率、倒地少躺幾幀、硬殼（1 開 0 關）
    squirtleMove: 1.05, squirtleJump: 0.92, squirtleSpike: 0.95, squirtleDive: 1.15, squirtleGetup: 2, squirtleShell: 1,
    // 月伊布：同步反彈的比例、月環掛幾幀（25 幀 ≈ 1 秒）、被月環套住時下一顆殺球剩幾成
    umbreonSyncShare: 0.5, umbreonMarkFrames: 38, umbreonMarkSpike: 0.9,
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
  // 這一幀開始時，「對手殺過來、還沒被碰過的球」是衝著誰來的（大蔥鴨的居合斬用）
  var incoming = { p1: false, p2: false };
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
  // 觸控的技能鍵：dashRequest 是 ±2（鍵盤連點兩下產生的是 ±1，那個容易誤觸，所以不算）
  function skillKey(input) {
    return input.dashRequest === 2 ? 1 : input.dashRequest === -2 ? -1 : 0;
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
      p.pvReachX = 0;
      p.pvMoveMult = p.pvDiveMult = undefined;
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
    // 變身不會經過「換角色」重設，御三家的判定寬度、速度倍率要在這裡清掉
    player.pvReachX = 0;
    player.pvMoveMult = player.pvDiveMult = undefined;
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
    p1.pvHit = p2.pvHit = false;   // 「沒碰到身體但算擊球」的記號（大蔥揮擊），給 juice.js 和 netplay.js 看
    if (p1.isCollisionWithBallHappened) lastHitter = p1;
    else if (p2.isCollisionWithBallHappened) lastHitter = p2;

    if (!inMenu) {
      incoming.p1 = ballMem.prevPower && ballMem.lastPowerSide === 'p2';
      incoming.p2 = ballMem.prevPower && ballMem.lastPowerSide === 'p1';
      // 大蔥揮擊要在所有技能之前算：它等於「這一幀碰到球了」，後面的判斷才會一致
      leekReach(p1, ball, ctrl.keyboardArray[0]);
      leekReach(p2, ball, ctrl.keyboardArray[1]);
      [p1, p2].forEach(function (p) {
        if (p.isCollisionWithBallHappened && ball.isPowerHit) ballMem.lastPowerSide = pk(p);
      });
      var shell1 = shellMark(p1), shell2 = shellMark(p2);
      processAbility(p1, p2, ball, ctrl.keyboardArray[0], 'p1', ctrl);
      processAbility(p2, p1, ball, ctrl.keyboardArray[1], 'p2', ctrl);
      // 御三家：傑尼龜的硬殼先還原被推開的位置，再算走路／撲救／跳躍的倍率
      shellRestore(p1, shell1, state.p1);
      shellRestore(p2, shell2, state.p2);
      starterMotion(p1);
      starterMotion(p2);
      processBurn(p1, ball, 'p1');
      processBurn(p2, ball, 'p2');
      processMoonMark(p1, ball, 'p1');
      processMoonMark(p2, ball, 'p2');
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

  // 大蔥鴨「大蔥揮擊」：殺球姿勢中，球不用碰到身體，在大蔥構得到的範圍內就打得到。
  // 做的事跟遊戲本體的殺球一樣（方向鍵決定球路），之後再交給 leekBoomerang 加上平快與回飄
  function leekReach(player, ball, input) {
    if (player.character !== 'farfetchd') return;
    var s = state[pk(player)];
    if (player.state !== 2) { s.leekSwung = false; return; }
    if (player.isCollisionWithBallHappened) { s.leekSwung = true; return; }   // 身體已經打到了
    if (s.leekSwung) return;                                                  // 一次揮擊只打一球
    if (Math.abs(ball.x - player.x) > TUNING.leekReachX || Math.abs(ball.y - player.y) > TUNING.leekReachY) return;
    var mine = player.isPlayer2 ? ball.x >= NET_X : ball.x < NET_X;           // 不能伸過網去打
    if (!mine || ball.y >= GROUND_BALL_Y - 2) return;
    s.leekSwung = true;
    ball.xVelocity = (player.isPlayer2 ? -1 : 1) * (Math.abs(input.xDirection) + 1) * 10;
    ball.yVelocity = Math.max(15, Math.abs(ball.yVelocity)) * input.yDirection * 2;
    ball.sound.powerHit = true;
    ball.isPowerHit = true;
    ball.punchEffectRadius = 20; ball.punchEffectX = ball.x; ball.punchEffectY = ball.y;
    player.isCollisionWithBallHappened = true;   // 這一幀的技能判斷用；物理算完就會被清掉，所以另外留 pvHit
    player.pvHit = true;
    lastHitter = player;      // 球的屬性光跟著換成大蔥鴨的
    s.slash = { x: player.x, y: player.y, bx: ball.x, by: ball.y, t: 5 };
  }

  // 灼傷（火伊布造成）：時間內的第一次殺球會變弱，打完灼傷就解除
  function processBurn(player, ball, key) {
    var s = state[key];
    if (!(s.burnTimer > 0)) { s.burnHit = false; return; }
    s.burnTimer--;
    if (edge(s, 'burnHit', player.isCollisionWithBallHappened && player.state === 2) && ball.isPowerHit) {
      ball.xVelocity = Math.round(ball.xVelocity * TUNING.burnWeak);
      ball.yVelocity = Math.round(ball.yVelocity * TUNING.burnWeak);
      ball.isPowerHit = false;
      s.burnTimer = 0;
      pushBurst(ball.x, ball.y, '#9E9E9E', 45);
    }
  }

  // 月伊布的月環：被套住的對手，下一顆殺球變弱（只算一次）。對手是誰都會跑（每幀兩邊都呼叫）
  function processMoonMark(player, ball, key) {
    var s = state[key];
    // 沒有月環時什麼都不寫（不在每一邊的狀態上多出欄位：沒有月伊布的比賽、連線傳的資料都跟原本一模一樣）
    if (!(s.moonMark > 0)) { if (s.moonHit) s.moonHit = false; return; }
    s.moonMark--;
    if (edge(s, 'moonHit', player.isCollisionWithBallHappened && player.state === 2) && ball.isPowerHit) {
      scaleBall(ball, TUNING.umbreonMarkSpike);
      s.moonMark = 0;
      pushBurst(ball.x, ball.y, '#B39DDB', 40);
    }
  }

  function processAbility(player, opp, ball, input, key, ctrl) {
    var s = state[key];
    var oppS = state[key === 'p1' ? 'p2' : 'p1'];
    if (s.char !== player.character) {
      state[key] = s = newSide();
      s.char = player.character;
      player.pvNoClamp = false;
      player.pvReachX = 0;
      player.pvMoveMult = player.pvDiveMult = undefined;
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
    // 夢幻：落點離自己很遠就瞬間移動過去
    mew: function (p, ball, opp, input, s) {
      if (s.tpCD > 0) return;
      var target = ball.expectedLandingPointX, mySide = p.isPlayer2 ? target > NET_X : target < NET_X;
      if (p.state === 0 && mySide && Math.abs(target - p.x) > 90 && Math.random() < TUNING.mewTeleportAI) s.zipRequest = target > p.x ? 1 : -1;
    },
    // 大蔥鴨：在空中、球進到大蔥構得到的範圍就揮（不用等球貼到身上）
    farfetchd: function (p, ball, opp, input, s) {
      if (p.state !== 1 || s.leekSwung) return;
      var mine = p.isPlayer2 ? ball.x >= NET_X : ball.x < NET_X;
      if (mine && Math.abs(ball.x - p.x) < TUNING.leekReachX - 6 && Math.abs(ball.y - p.y) < TUNING.leekReachY - 6 &&
          Math.random() < TUNING.leekAI) input.powerHit = 1;
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
  // 關都御三家（一階）：小火龍、妙蛙種子、傑尼龜
  // ============================================================
  // 設計上只比皮卡丘差 5%～15%，重點是手感不同；大招留給進化後。
  // 數值都在 TUNING（charmander… / bulbasaur… / squirtle…），以皮卡丘為 1。
  // 走路、撲救的倍率由 main.bundle.js 套用（player.pvMoveMult／pvDiveMult），
  // 因為要用這一幀真正的方向；在這裡（物理之前）算會用到上一幀的按鍵，電腦會走過頭。
  var JUMP_VY = 15;     // 起跳那一幀算完後的上升速度（本體給 -16，重力加 1）

  // 走路、撲救的倍率（netplay.js 客機預測位置也用這個）
  function starterMove(ch) {
    return ch === 'charmander' ? TUNING.charmanderMove
      : ch === 'bulbasaur' ? TUNING.bulbasaurMove
        : ch === 'squirtle' ? TUNING.squirtleMove : 1;
  }
  function diveMult(ch) {
    return ch === 'charmander' ? TUNING.charmanderDive : ch === 'squirtle' ? TUNING.squirtleDive : 1;
  }
  function jumpMult(ch) {
    return ch === 'bulbasaur' ? TUNING.bulbasaurJump : ch === 'squirtle' ? TUNING.squirtleJump : 1;
  }
  // 跳躍高度的倍率換成起跳速度。本體的跳躍：第一幀上升 16，之後 15、14、…每幀少 1，
  // 總高度 ≈ 16 + v(v+1)/2（v = 15 時是 136）。解 16 + v'(v'+1)/2 = 136 × 倍率。
  function jumpVelocity(mult) {
    var h = (16 + JUMP_VY * (JUMP_VY + 1) / 2) * mult - 16;
    return (-1 + Math.sqrt(1 + 8 * h)) / 2;
  }
  // 走路、撲救、跳躍的倍率（每幀設定；換角色時 processAbility 會清掉）
  function starterMotion(player) {
    var ch = player.character;
    if (ch !== 'charmander' && ch !== 'bulbasaur' && ch !== 'squirtle') return;
    player.pvMoveMult = starterMove(ch);
    player.pvDiveMult = diveMult(ch);
    // 跳躍高度：只改從地上起跳的那一下（本體剛起跳的下一幀一定是 y = 地面 - 16、速度 -15）
    var jm = jumpMult(ch);
    if (jm !== 1 && player.state === 1 && player.yVelocity === -JUMP_VY && player.y === GROUND_Y - 16) {
      player.yVelocity = -jumpVelocity(jm);
    }
  }
  // 傑尼龜的硬殼：記下技能跑之前的位置，跑完之後把對手技能造成的推開、震飛還原
  function shellMark(player) {
    if (player.character !== 'squirtle' || !TUNING.squirtleShell) return null;
    return { x: player.x, yVelocity: player.yVelocity };
  }
  function shellRestore(player, mark, s) {
    if (!mark || player.character !== 'squirtle') return;
    var blocked = false;
    if (player.x !== mark.x) {
      player.x = mark.x;
      if (s.stunTimer > 0) s.stunX = player.x;   // 被炸到的定身照算，只是不會被炸開
      blocked = true;
    }
    if (player.yVelocity < mark.yVelocity) {   // 被震飛（卡比獸落地）
      player.yVelocity = mark.yVelocity;
      blocked = true;
    }
    if (blocked) pushBurst(player.x, player.y, '#9CD8FF', 28);
  }
  function scaleBall(ball, k) {
    var sx = ball.xVelocity < 0 ? -1 : 1, sy = ball.yVelocity < 0 ? -1 : 1;
    ball.xVelocity = sx * Math.min(30, Math.round(Math.abs(ball.xVelocity) * k));
    ball.yVelocity = sy * Math.min(30, Math.round(Math.abs(ball.yVelocity) * k));
  }
  // 粗略模擬球路（照遊戲本體的球：每幀先移動、重力 +1；撞牆反彈、碰網柱彈開）。
  // 回傳「會乾淨地過網、在撞到對面底牆之前落在對面場內」。
  function landsClean(x, y, vx, vy, fromP2) {
    for (var f = 0; f < 120; f++) {
      if (x + vx < 20 || x + vx > 432) return false;                       // 撞牆會彈回來
      if (Math.abs(x - NET_X) < 25 && y > 176) return false;               // 碰到網柱
      if (y + vy > GROUND_BALL_Y) return fromP2 ? x < NET_X : x > NET_X;   // 落地
      y += vy; x += vx; vy += 1;
    }
    return false;
  }
  // 殺球加速：先試「水平、垂直都乘 k」，不行再試「落點不變、早一點落地」。
  // 只有原本的球路就會乾淨落在對面、加速後也一樣時才改，免得加速反而掛網或撞牆彈回來。
  function boostSafely(ball, fromP2, k) {
    if (!landsClean(ball.x, ball.y, ball.xVelocity, ball.yVelocity, fromP2)) return false;
    var vx0 = ball.xVelocity, vy0 = ball.yVelocity;
    scaleBall(ball, k);
    if ((ball.xVelocity !== vx0 || ball.yVelocity !== vy0) && landsClean(ball.x, ball.y, ball.xVelocity, ball.yVelocity, fromP2)) return true;
    ball.xVelocity = vx0; ball.yVelocity = vy0;
    hastenBall(ball, k);
    if ((ball.xVelocity !== vx0 || ball.yVelocity !== vy0) && landsClean(ball.x, ball.y, ball.xVelocity, ball.yVelocity, fromP2)) return true;
    ball.xVelocity = vx0; ball.yVelocity = vy0;
    return false;
  }
  // 球速變快、落點不變：水平速度乘 k，再改垂直速度讓球早 1/k 的時間落在同一個地方。
  // （直接把球速乘上去，球會飛太遠撞到後面的牆彈回來，模擬起來反而變弱。）
  function hastenBall(ball, k) {
    var drop = GROUND_BALL_Y - ball.y;
    if (!(drop > 0)) return;
    var vy = ball.yVelocity;
    var t = -vy + Math.sqrt(vy * vy + 2 * drop);   // 解 y + vy·t + t²/2 = 地面
    var tk = t / k;
    if (!(tk > 1)) return;
    ball.xVelocity = Math.max(-30, Math.min(30, Math.round(ball.xVelocity * k)));
    ball.yVelocity = Math.max(-30, Math.min(30, Math.round((drop - tk * tk / 2) / tk)));
  }

  // ============================================================
  // 月伊布：被動「同步」＋殺球「月環」
  // ============================================================
  // 同步：月伊布中了對手的異常狀態（定身、變慢、顛倒、灼傷），對手也會中同樣的狀態，
  //       時間是一半；對手頭上掛著月環的時候是全額。
  // 月環：月伊布的殺球帶月環。對手用身體接到（不是殺回來），頭上掛月環 1.5 秒；
  //       這段時間內對手的下一顆殺球變弱（球速 ×0.9，只算一次，見 processMoonMark），而且同步反彈全額。
  // 數值都在 TUNING（umbreon…）。
  var UMB_KEYS = ['stunTimer', 'slowTimer', 'reverseTimer', 'burnTimer'];
  // 記下這一幀結束時各個狀態的剩餘時間；下一幀變大了就是「剛中了新的」
  function umbSnapshot(s) {
    return { stunTimer: s.stunTimer || 0, slowTimer: s.slowTimer || 0, reverseTimer: s.reverseTimer || 0, burnTimer: s.burnTimer || 0 };
  }

  // ============================================================
  // 技能
  // ============================================================
  var ABILITIES = {
    // 月伊布「同步＋月環」
    synchronize: function (player, opp, ball, input, s, oppS) {
      // ---- 同步 ----
      var prev = s.umbPrev;
      if (prev) {
        var full = oppS.moonMark > 0;
        UMB_KEYS.forEach(function (k) {
          var now = s[k] || 0;
          if (now > prev[k]) {
            var add = Math.max(1, Math.round(now * (full ? 1 : TUNING.umbreonSyncShare)));
            oppS[k] = Math.max(oppS[k] || 0, add);
            if (k === 'stunTimer') oppS.stunX = opp.x;
            // 對手也是月伊布：別讓它再反彈回來
            if (oppS.umbPrev) oppS.umbPrev[k] = oppS[k];
            pushBurst(opp.x, opp.y, '#7E57C2', 50);
          }
        });
      }
      // ---- 月環 ----
      if (powerHitEdge(player, s, 'hit') && ball.isPowerHit) s.moonBall = 1;
      if (s.moonBall) {
        if (edge(s, 'oppTouch', opp.isCollisionWithBallHappened)) {
          if (opp.state !== 2) {
            oppS.moonMark = TUNING.umbreonMarkFrames;
            pushBurst(opp.x, opp.y, '#FFD54F', 45);
          }
          s.moonBall = 0;
        } else if (ball.y >= GROUND_BALL_Y - 2 || (player.isCollisionWithBallHappened && player.state !== 2)) s.moonBall = 0;
      }
      s.umbPrev = umbSnapshot(s);
    },

    // 小火龍「小火苗」：靠網 1/3 的地方殺球，球速 +8%（底線殺球沒有）
    smallFlame: function (player, opp, ball, input, s) {
      if (!powerHitEdge(player, s, 'hit') || !ball.isPowerHit) return;
      var fromNet = player.isPlayer2 ? player.x - NET_X : NET_X - player.x;
      if (fromNet > TUNING.charmanderNetZone) return;
      if (!boostSafely(ball, player.isPlayer2, TUNING.charmanderNetSpike)) return;
      pushBurst(ball.x, ball.y, '#FF8A3D', 38);   // 常常會發動，只放小火花、不算技能級特效
    },

    // 妙蛙種子「短藤鞭」：判定左右加寬；「飛葉」：不按方向鍵殺球，過網後變慢、早一點落地
    vineWhip: function (player, opp, ball, input, s) {
      player.pvReachX = TUNING.bulbasaurReach;
      // 不按方向鍵的殺球，本體給的球速一定是水平 ±10、垂直 0
      if (powerHitEdge(player, s, 'hit') && ball.isPowerHit && Math.abs(ball.xVelocity) === 10 && ball.yVelocity === 0) {
        s.leaf = 1; s.leafT = 0; s.leafCrossed = false;
        return;
      }
      if (!s.leaf) return;
      var crossed = player.isPlayer2 ? ball.x < NET_X : ball.x > NET_X;
      if (opp.isCollisionWithBallHappened || ball.y >= GROUND_BALL_Y - 2 || (s.leafCrossed && !crossed)) { s.leaf = 0; return; }
      if (!crossed) return;
      if (!s.leafCrossed) {
        s.leafCrossed = true;
        var sx = ball.xVelocity < 0 ? -1 : 1;
        ball.xVelocity = sx * Math.max(1, Math.abs(ball.xVelocity) - TUNING.leafDrag);
        pushBurst(ball.x, ball.y, '#5FD35F', 30);
      }
      s.leafT = (s.leafT || 0) + 1;
      if (s.leafT % TUNING.leafGravEvery === 0) ball.yVelocity += 1;
    },

    // 傑尼龜：殺球稍弱；撲救後起身快（滑行距離在 starterMotion，硬殼在 shellRestore）
    shellSlide: function (player, opp, ball, input, s) {
      if (powerHitEdge(player, s, 'hit') && ball.isPowerHit) scaleBall(ball, TUNING.squirtleSpike);
      // 撲救落地那一幀本體把倒地時間設成 3，這裡少躺幾幀
      if (player.state === 4 && player.lyingDownDurationLeft === 3) player.lyingDownDurationLeft -= TUNING.squirtleGetup;
    },

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

    // 火伊布「烈焰重擊＋引火」
    //  - 殺出去的球是火球：對手用身體接到就灼傷（下一次殺球變弱）；直接把火球殺回來的話不會灼傷
    //  - 引火：自己用身體接起對手的殺球，就火力全開一小段時間，這時殺球是「大字爆」：一定落在對面場內、灼傷更久
    fireSmash: function (player, opp, ball, input, s, oppS) {
      if (edge(s, 'absorb', receivedSpike(player))) {
        s.flashFire = TUNING.flashFireFrames;
        pushBurst(player.x, player.y, '#FF5A1F', 70);
      }
      if (s.flashFire > 0) s.flashFire--;
      if (powerHitEdge(player, s, 'hit') && ball.isPowerHit) {
        var blast = s.flashFire > 0;
        if (blast) aimAtCourt(ball, player.isPlayer2, TUNING.fireBlastVx);   // 大字爆：單純再往下砸會掛網，所以改成瞄準對面
        else {
          ball.xVelocity = clampV(Math.round(ball.xVelocity * TUNING.fireSmash));
          if (TUNING.fireDown) ball.yVelocity = clampV(ball.yVelocity + TUNING.fireDown);
        }
        ball.punchEffectRadius = Math.min(ball.punchEffectRadius + (blast ? 18 : 10), 40);
        s.fireBall = blast ? 2 : 1;
        if (blast) {
          s.flashFire = 0;
          pushBurst(ball.x, ball.y, '#FF5A1F', 85);
          pushFlash('#FF5A1F', 0.25, 6);
          tier(player, 3, ball.x, ball.y);
        }
      }
      if (s.fireBall) {
        if (edge(s, 'oppTouch', opp.isCollisionWithBallHappened)) {
          if (opp.state !== 2) {
            oppS.burnTimer = s.fireBall === 2 ? TUNING.fireBlastBurn : TUNING.burnFrames;
            pushBurst(opp.x, opp.y, '#FF5A1F', 55);
          }
          s.fireBall = 0;
        } else if (ball.y >= GROUND_BALL_Y - 2 || (player.isCollisionWithBallHappened && player.state !== 2)) s.fireBall = 0;
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
      var req = (player.isComputer ? 0 : tap || skillKey(input)) || s.zipRequest || 0;
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
      // 屏障不再是「原速反彈」：擋一球就碎；擋下的球只是軟軟掉回對面；對手的殺球會打穿，只被減速。碎掉或消失後要冷卻
      if (s.barrierCD > 0) s.barrierCD--;
      if (powerHitEdge(player, s, 'hit') && !(s.barrierCD > 0) && !(s.barrierTimer > 0)) s.barrierTimer = TUNING.barrierFrames;
      if (s.barrierTimer > 0) {
        s.barrierTimer--;
        if (s.barrierTimer === 0) s.barrierCD = TUNING.barrierCooldown;
        // 只擋「往自己這邊飛」的球；自己打出去的球直接通過
        var incoming = player.isPlayer2 ? ball.xVelocity > 0 : ball.xVelocity < 0;
        if (incoming && Math.abs(ball.x - NET_X) < 35 && ball.y > 30 && ball.y < 176) {
          var dir = player.isPlayer2 ? -1 : 1;   // 往對手那邊的方向
          if (ball.isPowerHit) {
            ball.xVelocity = clampV(ball.xVelocity * TUNING.barrierPierce);   // 殺球：打穿牆，但變慢
            ball.isPowerHit = false;
          } else {
            ball.xVelocity = dir * TUNING.barrierSoftVx;                      // 一般球：軟軟彈回去
            ball.yVelocity = Math.min(ball.yVelocity, -6);
            ball.x = NET_X + dir * 40;
          }
          pushBurst(ball.x, ball.y, '#FF69B4', 30);
          s.barrierTimer = 0; s.barrierCD = TUNING.barrierCooldown;           // 擋一次就碎
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

    // 大蔥鴨「大蔥揮擊＋居合斬＋迴力大蔥」
    //  - 大蔥揮擊：殺球打得到比別人遠的球（leekReach，在每幀最前面處理）
    //  - 居合斬：直接把對手的殺球殺回去，變成又快又準、一定落在對面的一刀
    //  - 迴力大蔥：一般殺球又平又快，過網後還會往回飄
    leekBoomerang: function (player, opp, ball, input, s) {
      if (powerHitEdge(player, s, 'hit') && ball.isPowerHit) {
        if (incoming[pk(player)]) {
          aimAtCourt(ball, player.isPlayer2, TUNING.iaiVx);
          ball.punchEffectRadius = 35;
          s.boomerangTimer = 0;
          if (!s.slash) s.slash = { x: player.x, y: player.y, bx: ball.x, by: ball.y, t: 5 };
          s.slash.iai = 1; s.slash.t = 7;
          pushBurst(ball.x, ball.y, '#E8F5E9', 80);
          pushFlash('#FFFFFF', 0.3, 5);
          tier(player, 3, ball.x, ball.y);
        } else {
          ball.yVelocity = Math.round(ball.yVelocity * 0.3);
          ball.xVelocity = clampV(Math.round(ball.xVelocity * 1.5));
          s.boomerangTimer = 20;
        }
      }
      if (s.boomerangTimer > 0 && --s.boomerangTimer === 0) {
        var crossed = player.isPlayer2 ? ball.x < NET_X : ball.x > NET_X;
        if (crossed) ball.xVelocity = clampV(Math.round(-ball.xVelocity * 0.6));
      }
      if (s.slash && --s.slash.t <= 0) s.slash = null;
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
      // 夢幻（神獸）：念力護盾不靠運氣——冷卻好就一定救起快落地的球（身邊有粉紅光環＝準備好）。
      // 救起來的球會被念力托在空中一小段時間；這時殺球就是「念力彈」：又快又準，一定落在對面場內。
      moveBonus(player, input, 1);
      if (s.mewCD > 0) s.mewCD--;
      // 瞬間移動：連按兩下方向鍵。球會落在自己場上時直接出現在落點；否則往那個方向瞬移一段距離
      if (s.tpCD > 0) s.tpCD--;
      s.fc = (s.fc || 0) + 1;
      var dirNow = input.xDirection, tap = 0;
      if (dirNow !== 0 && dirNow !== (s.prevDir || 0)) {
        if (s.tapDir === dirNow && s.fc - s.tapAt <= 6 && s.tapHeld <= 3) tap = dirNow;
        s.tapDir = dirNow; s.tapAt = s.fc; s.tapHeld = 0;
      } else if (dirNow !== 0 && dirNow === s.tapDir) s.tapHeld++;
      s.prevDir = dirNow;
      var req = (player.isComputer ? 0 : tap || skillKey(input)) || s.zipRequest || 0;
      s.zipRequest = 0;
      if (req && !(s.tpCD > 0) && player.state < 3) {
        var x0 = player.x, land = ball.expectedLandingPointX;
        var landMine = player.isPlayer2 ? land > NET_X : land < NET_X;
        var toBall = landMine && (land - x0) * req > 0;       // 落點在自己場上、而且在按的那個方向
        // 最遠只能移動 mewTeleport 這麼遠：落點在範圍內就剛好到落點，太遠就只能靠近
        player.x = toBall ? x0 + req * Math.min(Math.abs(land - x0), TUNING.mewTeleport) : x0 + req * TUNING.mewTeleport;
        clampPlayer(player);
        s.tpCD = TUNING.mewTeleportCD;
        pushBurst(x0, player.y, '#FF80AB', 40);
        pushBurst(player.x, player.y, '#FFB6C1', 55);
        if (window._pvFxEvent) {
          window._pvFxEvent('zipStart', { player: player, dir: req });
          window._pvFxEvent('zipEnd', { player: player, x0: x0, x1: player.x, y: player.y });
        }
      }
      var mySide = player.isPlayer2 ? ball.x >= NET_X : ball.x < NET_X;
      if (!(s.mewCD > 0) && mySide && ball.yVelocity > 0 && ball.y + ball.yVelocity + 1 >= 250) {   // 下一幀就要落地：在落地前托住
        ball.yVelocity = -TUNING.mewLift;
        ball.xVelocity = clampV(ball.xVelocity * 0.3);
        ball.y = Math.min(ball.y, 240);
        ball.isPowerHit = false;
        s.mewCD = TUNING.mewShieldCD;
        s.auraTimer = TUNING.mewChargeFrames;
        pushBurst(ball.x, ball.y, '#FFB6C1', 55);
      }
      if (s.auraTimer > 0) {
        s.auraTimer--;
        if (powerHitEdge(player, s, 'hit')) {
          aimAtCourt(ball, player.isPlayer2, TUNING.mewBlastVx);
          makePowerHit(ball, 35);
          s.auraTimer = 0;
          pushBurst(ball.x, ball.y, '#FF4FB8', 70);
          tier(player, 3, ball.x, ball.y);
        }
      } else powerHitEdge(player, s, 'hit');
    },

    // 快龍：殺球後暴走
    // 快龍「逆鱗」：殺球後暴走，那一球就是第一層。暴走中每次殺球再疊一層（最多 3 層），一層比一層砸得更重更快；
    // 暴走結束後會混亂（左右顛倒）一下，跟原作的逆鱗一樣有代價
    outrage: function (player, opp, ball, input, s) {
      moveBonus(player, input, 1);
      if (powerHitEdge(player, s, 'hit')) {
        if (!(s.outrageTimer > 0)) {
          pushBurst(player.x, player.y, '#FF6D00', 90);
          s.rageStacks = 0;
        }
        if (ball.isPowerHit) {
          // 開啟暴走的那一球就算第一層：殺 3 球就到滿層（原本要 4 球）
          s.rageStacks = Math.min(3, (s.rageStacks || 0) + 1);
          ball.yVelocity = clampV(ball.yVelocity + TUNING.outrageDown * s.rageStacks);
          ball.xVelocity = clampV(Math.round(ball.xVelocity * (1 + 0.08 * s.rageStacks)));
          ball.punchEffectRadius = Math.min(ball.punchEffectRadius + 6 * s.rageStacks, 40);
          if (s.rageStacks >= 2) {
            pushBurst(ball.x, ball.y, '#FF6D00', 40 + 15 * s.rageStacks);
            tier(player, s.rageStacks >= 3 ? 4 : 3, ball.x, ball.y, { k: 'rage' });   // 三層逆鱗＝必殺
          }
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
    if (s.fireBall) fireTrail(g, ball, s.fireBall === 2);
    if (s.slash) slashArc(g, s.slash);
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
    if (s.char === 'mew' && !s.mewCD) ring(g, x, player.y, 28 + Math.sin(tick / 3) * 2, '#FF80AB', 0.7);   // 夢幻：護盾準備好了
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
    if (s.flashFire > 0) {             // 火伊布引火：火力全開，身邊冒火
      var blink = s.flashFire < 20 && s.flashFire % 4 < 2;
      if (!blink) {
        ring(g, x, player.y, 32 + Math.sin(tick / 2) * 2, '#FF5A1F', 0.75);
        for (var em = 0; em < 4; em++) {
          var ph = (tick * 3 + em * 11) % 30;
          flame(g, x - 21 + em * 14, player.y + 24 - ph, true, 0.55 + (30 - ph) / 60);
        }
      }
    }
    if (s.burnTimer > 0) {             // 灼傷：身上竄火、頭上一朵火（快結束時閃爍）
      for (var bf = 0; bf < 2; bf++) {
        var bp = (tick * 2 + bf * 9) % 18;
        flame(g, x - 10 + bf * 20 + Math.sin(tick + bf) * 2, player.y + 10 - bp, true, 0.6);
      }
      if (!(s.burnTimer < 15 && s.burnTimer % 4 < 2)) flame(g, x, top - 2, true, 1.1);
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
    if (s.moonMark > 0 && !(s.moonMark < 10 && s.moonMark % 4 < 2)) {   // 月伊布的月環：頭上一圈黃色的環
      g.globalAlpha = 0.9; g.strokeStyle = '#000'; g.lineWidth = 4;
      g.beginPath(); g.ellipse(x, top - 3, 11, 4, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#FFD54F'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, top - 3, 11, 4, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
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
  function flame(g, x, y, on, k) {
    k = k || 1;
    g.beginPath();
    g.moveTo(x, y - 7 * k); g.quadraticCurveTo(x + 6 * k, y, x + 3 * k, y + 5 * k); g.lineTo(x - 3 * k, y + 5 * k); g.quadraticCurveTo(x - 6 * k, y, x, y - 7 * k);
    g.closePath();
    g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke();
    g.fillStyle = on ? '#FF3D00' : 'rgba(255,255,255,0.25)'; g.fill();
    if (on) { g.fillStyle = '#FFD54F'; g.beginPath(); g.arc(x, y + 2 * k, 2 * k, 0, Math.PI * 2); g.fill(); }
  }

  // 火球：球後面拖著一串火（大字爆比較大）
  function fireTrail(g, ball, big) {
    var vx = ball.xVelocity, vy = ball.yVelocity, len = Math.sqrt(vx * vx + vy * vy) || 1;
    var ux = -vx / len, uy = -vy / len, n = big ? 5 : 3;
    for (var i = 0; i < n; i++) {
      var d = 14 + i * 9, j = (Math.random() - 0.5) * 8;
      g.globalAlpha = 0.95 - i * 0.15;
      flame(g, ball.x + ux * d + j, ball.y + uy * d + j, true, (big ? 1.5 : 1.1) - i * 0.15);
    }
    g.globalAlpha = 1;
    if (big) ring(g, ball.x, ball.y, 24 + Math.random() * 3, '#FF5A1F', 0.85);
  }

  // 大蔥揮擊：從大蔥鴨劃向球的一道弧光（居合斬是更粗的白光）
  function slashArc(g, sl) {
    var k = Math.max(0, sl.t) / (sl.iai ? 7 : 5);
    var mx = (sl.x + sl.bx) / 2, my = (sl.y + sl.by) / 2, dx = sl.bx - sl.x, dy = sl.by - sl.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len, bow = sl.iai ? 26 : 18;
    g.lineCap = 'round';
    [[sl.iai ? 9 : 6, sl.iai ? '#FFFFFF' : '#C5E1A5', 0.55], [sl.iai ? 4 : 2.5, '#FFFFFF', 0.95]].forEach(function (w) {
      g.globalAlpha = w[2] * k; g.strokeStyle = w[1]; g.lineWidth = w[0];
      g.beginPath();
      g.moveTo(sl.x - dx * 0.15 + nx * 6, sl.y - dy * 0.15 + ny * 6);
      g.quadraticCurveTo(mx - nx * bow, my - ny * bow, sl.bx + dx * 0.35, sl.by + dy * 0.35);
      g.stroke();
    });
    g.globalAlpha = 1; g.lineCap = 'butt';
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
  // 紅白寶貝球 → 整顆金色的黃金球（闖關模式喵喵關）
  function toGold(r, g, b) {
    if (r > 200 && g < 60 && b < 60) return [255, 196, 30];      // 紅
    if (r > 100 && r < 160 && g < 40) return [176, 112, 0];      // 暗紅
    if (r > 230 && g > 230 && b > 230) return [255, 238, 150];   // 白
    if (r > 140 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) return [236, 178, 40]; // 灰
    if (b > 200 && r < 60 && g < 60) return [255, 214, 80];      // 原殘影的藍
    return null;
  }

  function initGfx(view) {
    var ballTex = view.ball.textures;
    gfx = {
      origBall: ballTex.slice(),
      purpleBall: ballTex.map(function (t) { return recolor(t, toPurple) || t; }),
      goldBall: ballTex.map(function (t) { return recolor(t, toGold) || t; }),
      origPunch: view.punch.texture,
      punchByType: {},
      punchPurple: null,
      origTrail: view.ballTrail.texture,
      whiteTrail: recolor(view.ballTrail.texture, toWhite),
      origHyper: view.ballHyper.texture,
      purpleHyper: recolor(view.ballHyper.texture, toPurple),
      goldHyper: recolor(view.ballHyper.texture, toGold),
      purple: false, look: 'orig',
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
    // 黃金球：闖關模式設 window._pvGoldBall（念力球優先）
    var look = purple ? 'purple' : window._pvGoldBall ? 'gold' : 'orig';
    if (look !== gfx.look) {
      gfx.look = look; gfx.purple = purple;
      view.ball.textures = look === 'purple' ? gfx.purpleBall : look === 'gold' ? gfx.goldBall : gfx.origBall;
      view.ballHyper.texture = (look === 'purple' && gfx.purpleHyper) || (look === 'gold' && gfx.goldHyper) || gfx.origHyper;
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
