(function() {
  'use strict';
  if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;

  var P1_KEYS = { up:'KeyR', down:'KeyV', left:'KeyD', right:'KeyG', action:'KeyZ' };
  var P2_KEYS = { up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', action:'Enter' };
  var pressed = {};
  // 給 keybind.js 用：自訂按鍵後，觸控要送出新的按鍵代碼（直接改這兩個物件的內容）
  window.PV_TouchKeys = { 1: P1_KEYS, 2: P2_KEYS };

  function simKey(code, type) {
    window.dispatchEvent(new KeyboardEvent(type, { code:code, key:code, bubbles:true, cancelable:true }));
  }
  // 遊戲每 40ms 才讀一次按鍵。手指很快點一下（比 40ms 短）的話，按下和放開都落在兩次讀取之間，
  // 遊戲就完全沒看到，所以每次按鍵至少維持 MIN_HOLD 毫秒
  var MIN_HOLD = 90, downAt = {}, upTimer = {};
  function pressKey(code) {
    if (upTimer[code]) { clearTimeout(upTimer[code]); upTimer[code] = null; simKey(code,'keyup'); pressed[code] = false; }
    if (!pressed[code]) { pressed[code]=true; downAt[code]=Date.now(); simKey(code,'keydown'); }
  }
  function releaseKey(code) {
    if (!pressed[code] || upTimer[code]) return;
    var wait = MIN_HOLD - (Date.now() - downAt[code]);
    if (wait <= 0) { pressed[code]=false; simKey(code,'keyup'); return; }
    upTimer[code] = setTimeout(function () { upTimer[code] = null; pressed[code] = false; simKey(code,'keyup'); }, wait);
  }

  // 診斷：手指還按著，但系統／瀏覽器把觸控搶走（例如邊緣滑動手勢、縮放）時會收到 touchcancel，
  // 按鍵會被迫放開。發生時在畫面上方中間顯示一個紅色數字，方便回報
  var cancelCount = 0, cancelBadge = null;
  function noteCancel() {
    cancelCount++;
    if (!cancelBadge) {
      cancelBadge = document.createElement('div');
      cancelBadge.style.cssText = 'position:fixed;top:36px;left:50%;transform:translateX(-50%);z-index:10002;background:#d32f2f;color:#fff;font:bold 11px sans-serif;padding:1px 6px;border-radius:8px;pointer-events:none;opacity:.85';
      document.body.appendChild(cancelBadge);
    }
    cancelBadge.textContent = '觸控被系統中斷 ×' + cancelCount;
  }
  // 擋掉瀏覽器自己的雙指縮放／捲動手勢，避免它們搶走觸控
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, {passive:false});
  });

  // ========== 觸控輔助：修正遊戲每一幀讀到的輸入 ==========
  var KEYSETS = [P1_KEYS, P2_KEYS];
  var joyX = [0, 0];            // 搖桿目前的左右方向（技能鍵用它決定往哪邊）
  var skillReq = [0, 0];        // 技能鍵按下後，下一幀要送出的衝刺／瞬移請求
  var aimLock = [false, false];
  // 需要主動施放的技能才有技能鍵。dash：送出衝刺請求（水伊布用遊戲本體的 ±1，其他用 ±2，見 abilities.js 的 skillKey）；
  // hold：按住等於按住那個方向鍵
  var SKILLS = {
    vaporeon:   { label: '衝', dash: 1 },
    jolteon:    { label: '閃', dash: 2 },
    mew:        { label: '瞬', dash: 2 },
    jigglypuff: { label: '降', hold: 'down' }
  };

  function netState() { return window.PV_Net && window.PV_Net.state; }
  // 這組按鍵現在控制的是哪一隻：連線對戰時房主一定是左邊、客人一定是右邊
  function myPlayer(c, i) {
    var n = netState();
    if (n && n.render) return c.physics.player2;
    if (window.PV_Campaign && window.PV_Campaign.playing()) return c.physics.player1;   // 闖關：兩組按鍵都控制左邊的自己
    if (n && n.role === 'host' && (n.phase === 'play' || n.phase === 'end')) return c.physics.player1;
    return i === 0 ? c.physics.player1 : c.physics.player2;
  }
  // 球在接下來 3 幀內會不會碰到這隻角色（碰撞範圍是上下左右各 32，多留一點）
  function ballSoon(c, me) {
    var b = c.physics.ball, bx = b.x, by = b.y, bvy = b.yVelocity, py = me.y, pvy = me.yVelocity;
    var leek = me.character === 'farfetchd', rx = leek ? 52 : 40, ry = leek ? 44 : 40;   // 大蔥鴨拿大蔥，構得到比較遠
    for (var k = 1; k <= 3; k++) {
      bx += b.xVelocity; by += bvy; bvy += 1;
      py = Math.min(244, py + pvy); pvy += 1;
      if (Math.abs(bx - me.x) <= rx && Math.abs(by - py) <= ry) return true;
    }
    return false;
  }
  // 沒推搖桿時技能往哪邊：往球會落下的地方（客人端沒有落點資料，用球現在的位置）
  function towardBall(c, me) {
    var b = c.physics.ball, n = netState(), land = n && n.render ? NaN : b.expectedLandingPointX;
    var mine = me.isPlayer2 ? land > 216 : land < 216;
    var d = (mine ? land : b.x) - me.x;
    return d > 4 ? 1 : d < -4 ? -1 : (me.isPlayer2 ? -1 : 1);
  }
  function assist(c, kb, i) {
    var keys = KEYSETS[i], me = myPlayer(c, i), n = netState();
    var hit = !!pressed[keys.action], up = !!pressed[keys.up];
    var playing = c.state === c.round || !!(n && n.render);
    // 按住「殺」不放：球快碰到的那一刻自動出手。
    // 殺球姿勢只維持 0.4 秒，手指又不像鍵盤能精準點在那一瞬間，太早按就會落空
    if (playing && hit && me.state === 1 && kb.powerHit !== 1 && !me.isCollisionWithBallHappened && ballSoon(c, me)) kb.powerHit = 1;
    // 「跳」和「殺」同時壓著（拇指橫跨兩顆、或從跳滑到殺）：跳其實是「上」鍵，會讓殺球變成往上挑的高球。
    // 人在空中又按著殺時，不把它當成往上瞄準；要往下砸一樣把搖桿往下推
    if (hit && up && (me.state === 1 || me.state === 2)) aimLock[i] = true;
    if (!up) aimLock[i] = false;
    if (aimLock[i]) kb.yDirection = kb.downKey && kb.downKey.isDown ? 1 : 0;
    if (skillReq[i]) { kb.dashRequest = skillReq[i]; skillReq[i] = 0; }
  }
  // 遊戲載入後，接在它讀按鍵的函式後面
  var hookTimer = setInterval(function () {
    var c = window._pv && window._pv.ctrl;
    if (!c || !c.keyboardArray) return;
    clearInterval(hookTimer);
    c.keyboardArray.forEach(function (kb, i) {
      var orig = kb.getInput;
      kb.getInput = function () { orig.call(kb); assist(c, kb, i); };
    });
  }, 200);

  // ========== JOYSTICK ==========
  function createJoystick(keys, side) {
    var zone = document.createElement('div');
    zone.className = 'joystick-zone';
    zone.id = side + '-joystick-zone';

    var base = document.createElement('div');
    base.className = 'joystick-base';
    var knob = document.createElement('div');
    knob.className = 'joystick-knob';
    base.appendChild(knob);
    zone.appendChild(base);

    var active = false, touchId = null;
    var baseRect, cx, cy, maxR = 50;
    var curDirs = { left:false, right:false, up:false, down:false };

    function updateKeys(dx, dy) {
      var dist = Math.sqrt(dx*dx + dy*dy);
      var deadzone = 12;
      var newDirs = { left:false, right:false, up:false, down:false };
      if (dist > deadzone) {
        // 搖桿只管左右（和往下）；跳躍改用右邊的按鈕，才不會推搖桿時誤跳
        if (dx < -10) newDirs.left = true;
        if (dx > 10) newDirs.right = true;
        if (dy > 22 && dy > Math.abs(dx) * 0.8) newDirs.down = true;
      }
      for (var d in newDirs) {
        if (newDirs[d] && !curDirs[d]) pressKey(keys[d]);
        if (!newDirs[d] && curDirs[d]) releaseKey(keys[d]);
      }
      curDirs = newDirs;
      joyX[side === 'p1' ? 0 : 1] = newDirs.left ? -1 : newDirs.right ? 1 : 0;
    }

    function moveKnob(dx, dy) {
      var dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > maxR) { dx = dx/dist*maxR; dy = dy/dist*maxR; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      updateKeys(dx, dy);
    }

    function resetKnob() {
      knob.style.transform = 'translate(0,0)';
      for (var d in curDirs) { if (curDirs[d]) releaseKey(keys[d]); }
      curDirs = { left:false, right:false, up:false, down:false };
      joyX[side === 'p1' ? 0 : 1] = 0;
    }

    zone.addEventListener('touchstart', function(e) {
      e.preventDefault();
      if (active) return;
      var t = null;
      for (var i = 0; i < e.changedTouches.length; i++) if (zone.contains(e.changedTouches[i].target)) { t = e.changedTouches[i]; break; }
      if (!t) return;
      touchId = t.identifier;
      active = true;
      baseRect = base.getBoundingClientRect();
      maxR = Math.max(40, baseRect.width * 0.4);   // 搖桿大小會隨螢幕變（直式比較大），推動範圍跟著變
      cx = baseRect.left + baseRect.width/2;
      cy = baseRect.top + baseRect.height/2;
      moveKnob(t.clientX - cx, t.clientY - cy);
      base.classList.add('active');
    }, {passive:false});

    zone.addEventListener('touchmove', function(e) {
      e.preventDefault();
      if (!active) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          moveKnob(e.changedTouches[i].clientX - cx, e.changedTouches[i].clientY - cy);
          break;
        }
      }
    }, {passive:false});

    function endTouch(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          active = false; touchId = null;
          resetKnob();
          base.classList.remove('active');
          break;
        }
      }
    }
    zone.addEventListener('touchend', endTouch, {passive:false});
    zone.addEventListener('touchcancel', function (e) { noteCancel(); endTouch(e); }, {passive:false});
    zone.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    return zone;
  }

  // ========== 按鈕區：跳躍＋殺球 ==========
  // 兩顆按鈕緊貼在一起，由同一個觸控區判定：拇指按住「跳」之後直接滑到「殺」就能跳殺，不用抬手；
  // 按在兩顆中間會同時按下兩顆
  function createPad(keys, side) {
    var pad = document.createElement('div');
    pad.className = 'touch-pad';
    pad.id = side + '-pad';
    var jump = document.createElement('div'), hit = document.createElement('div');
    jump.className = 'touch-btn pad-btn pad-jump'; jump.textContent = '跳';
    hit.className = 'touch-btn pad-btn pad-hit'; hit.textContent = '殺';
    pad.appendChild(jump); pad.appendChild(hit);
    var btns = [{ el: jump, key: keys.up }, { el: hit, key: keys.action }];
    var touches = {};   // identifier -> [在跳上, 在殺上]

    function which(t) {
      var d = btns.map(function (b) {
        var r = b.el.getBoundingClientRect();
        return Math.hypot(t.clientX - (r.left + r.width / 2), t.clientY - (r.top + r.height / 2)) / (r.width / 2);
      });
      var on = [d[0] < 1.15, d[1] < 1.15];
      if (!on[0] && !on[1]) on[d[0] < d[1] ? 0 : 1] = true;   // 按在外圍：算最近的那顆
      return on;
    }
    function refresh() {
      btns.forEach(function (b, i) {
        var down = false;
        for (var id in touches) if (touches[id][i]) down = true;
        if (down) pressKey(b.key); else releaseKey(b.key);
        b.el.classList.toggle('active', down);
      });
    }
    // 多點觸控：瀏覽器在任何一根手指移動時，會把所有移動中的手指都通知給每個按鈕區，
    // 所以只處理「在這個按鈕區上按下去」的手指，不然搖桿那根手指會被當成按「跳」
    function onStart(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (pad.contains(t.target)) touches[t.identifier] = which(t);
      }
      refresh();
    }
    function onMove(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touches[t.identifier]) touches[t.identifier] = which(t);
      }
      refresh();
    }
    function onEnd(e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) delete touches[e.changedTouches[i].identifier];
      refresh();
    }
    pad.addEventListener('touchstart', onStart, {passive:false});
    pad.addEventListener('touchmove', onMove, {passive:false});
    pad.addEventListener('touchend', onEnd, {passive:false});
    pad.addEventListener('touchcancel', function (e) { noteCancel(); onEnd(e); }, {passive:false});
    pad.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    // 技能鍵：只有目前角色有主動技能時才顯示（見下面的更新迴圈）。
    // 自己處理觸控、不往上傳，不然按鈕區會把它當成最近的「跳」
    var skill = document.createElement('div');
    skill.className = 'touch-btn pad-skill';
    pad.appendChild(skill);
    var idx = side === 'p1' ? 0 : 1, held = null;
    skill.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation();
      var c = window._pv && window._pv.ctrl, me = c && myPlayer(c, idx), sk = me && SKILLS[me.character];
      if (!sk) return;
      skill.classList.add('active');
      if (sk.hold) { held = keys[sk.hold]; pressKey(held); }
      else skillReq[idx] = (joyX[idx] || towardBall(c, me)) * sk.dash;
    }, {passive:false});
    function skillEnd(e) {
      e.preventDefault(); e.stopPropagation();
      skill.classList.remove('active');
      if (held) { releaseKey(held); held = null; }
    }
    skill.addEventListener('touchmove', function (e) { e.preventDefault(); e.stopPropagation(); }, {passive:false});
    skill.addEventListener('touchend', skillEnd, {passive:false});
    skill.addEventListener('touchcancel', skillEnd, {passive:false});
    pad.skillBtn = skill;
    return pad;
  }

  // ========== BUILD CONTROLS ==========
  var p1Joystick = createJoystick(P1_KEYS, 'p1');
  var p1Action = createPad(P1_KEYS, 'p1');
  var p2Joystick = createJoystick(P2_KEYS, 'p2');
  var p2Action = createPad(P2_KEYS, 'p2');
  p2Joystick.style.display = 'none';
  p2Action.style.display = 'none';

  document.body.appendChild(p1Joystick);
  document.body.appendChild(p1Action);
  document.body.appendChild(p2Joystick);
  document.body.appendChild(p2Action);

  // 技能鍵跟著角色出現／消失（百變怪會中途換角色），冷卻中變淡
  setInterval(function () {
    var c = window._pv && window._pv.ctrl;
    if (!c || !c.physics) return;
    var st = window._pvAbilities && window._pvAbilities.state && window._pvAbilities.state();
    [p1Action, p2Action].forEach(function (pad, i) {
      var me = myPlayer(c, i), sk = SKILLS[me.character], b = pad.skillBtn;
      b.classList.toggle('show', !!sk);
      if (!sk) return;
      if (b.textContent !== sk.label) b.textContent = sk.label;
      var s = (st && st[me.isPlayer2 ? 'p2' : 'p1']) || {};
      b.classList.toggle('cd', s.qaCooldown > 0 || s.tpCD > 0 || me.dashCooldown > 0 || !!me.isDashing);
    });
  }, 150);

  // 2P toggle
  var toggle2P = document.createElement('div');
  toggle2P.id = 'toggle-2p-btn';
  toggle2P.textContent = '2P';
  var show2P = false;
  toggle2P.addEventListener('click', function() {
    show2P = !show2P;
    p2Joystick.style.display = show2P ? 'block' : 'none';
    p2Action.style.display = show2P ? 'block' : 'none';
    toggle2P.style.background = show2P ? 'rgba(100,255,100,0.5)' : 'rgba(100,100,255,0.4)';
    document.body.classList.toggle('pv-2p-on', show2P);
  });
  document.body.appendChild(toggle2P);

  // ========== CHARACTER SELECT OVERLAY ==========
  var charSelectBtn = document.createElement('div');
  charSelectBtn.id = 'char-select-btn';
  charSelectBtn.textContent = '🎭';
  charSelectBtn.style.cssText = 'position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:10001;width:36px;height:28px;border-radius:6px;background:rgba(0,0,0,0.6);border:2px solid rgba(255,255,255,0.4);color:white;font-size:16px;display:flex;justify-content:center;align-items:center;touch-action:manipulation;user-select:none;-webkit-touch-callout:none;cursor:pointer;';
  document.body.appendChild(charSelectBtn);
  // 角色選擇改用 char-select.js 的共用面板
  function openCharSelect(e){if(e)e.preventDefault();if(window.PV_CharSelect)window.PV_CharSelect.toggle();}
  charSelectBtn.addEventListener('touchend',openCharSelect,{passive:false});
  charSelectBtn.addEventListener('click',function(){openCharSelect(null);});

  // ========== MENU DROPDOWN HANDLING ==========
  function checkDropdowns(){
    var open=document.querySelector('.dropdown.show,.submenu.show');
    if(open){
      p1Joystick.style.opacity='0';p1Action.style.opacity='0';
      p2Joystick.style.opacity='0';p2Action.style.opacity='0';
      toggle2P.style.display='none';charSelectBtn.style.display='none';
    } else {
      p1Joystick.style.opacity='1';p1Action.style.opacity='1';
      p2Joystick.style.opacity='1';p2Action.style.opacity='1';
      toggle2P.style.display='flex';charSelectBtn.style.display='flex';
    }
  }
  var observer=new MutationObserver(checkDropdowns);
  var menuBar=document.getElementById('menu-bar');
  if(menuBar){
    observer.observe(menuBar,{attributes:true,attributeFilter:['class'],subtree:true});
    menuBar.addEventListener('touchend',function(e){
      var btn=e.target.closest('.submenu-btn');
      if(!btn)return;
      e.stopPropagation();
      var sub=btn.parentElement.querySelector('.submenu');
      if(sub){
        var shown=sub.classList.contains('show');
        document.querySelectorAll('.submenu.show').forEach(function(s){s.classList.remove('show');});
        document.querySelectorAll('.submenu-btn.open').forEach(function(s){s.classList.remove('open');});
        if(!shown){sub.classList.add('show');btn.classList.add('open');}
      }
    },{passive:false});
  }
  document.addEventListener('click',function(){setTimeout(checkDropdowns,50);},true);
  document.addEventListener('touchend',function(){setTimeout(checkDropdowns,50);},true);

  // ========== 直式：雙方角色與技能資訊條 ==========
  var info = document.createElement('div');
  info.id = 'pv-portrait-info';
  document.body.appendChild(info);
  var lastInfo = '';
  setInterval(function () {
    var C = window.PV_CHARS, c = window._pv && window._pv.ctrl;
    if (!C || !c || !c.physics) return;
    var rows = [['左 1P', c.physics.player1.character], ['右 2P', c.physics.player2.character]];
    var key = rows.map(function (r) { return r[1]; }).join('|');
    if (key === lastInfo) return;
    lastInfo = key;
    info.innerHTML = '';
    rows.forEach(function (r) {
      var ch = C.byId[r[1]]; if (!ch) return;
      var row = document.createElement('div'); row.className = 'row';
      var dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = (C.typeColors && C.typeColors[ch.type]) || '#999';
      var side = document.createElement('span'); side.className = 'side'; side.textContent = r[0];
      var name = document.createElement('b'); name.textContent = ch.name;
      var ab = document.createElement('span'); ab.className = 'ab'; ab.textContent = ch.skill || '';
      row.appendChild(dot); row.appendChild(side); row.appendChild(name); row.appendChild(ab);
      info.appendChild(row);
    });
  }, 500);

  // Prevent zoom
  document.addEventListener('touchstart',function(e){if(e.touches.length>1)e.preventDefault();},{passive:false});
  var lastTE=0;
  document.addEventListener('touchend',function(e){var n=Date.now();if(n-lastTE<=300)e.preventDefault();lastTE=n;},{passive:false});

  console.log('Joystick controls loaded');
})();
