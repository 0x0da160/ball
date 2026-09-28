// B.A.L.L. — 第1段階：操作と破壊
// 依存なしの Canvas 2D 実装。論理座標は幅 360 固定、高さは画面の縦横比から決める。
(() => {
  'use strict';

  // ---------- 調整用パラメータ（試作値。実機で詰める） ----------
  const TUNE = {
    lives: 3,
    ballRadius: 5,
    ballSpeedStart: 390,     // 論理px/秒
    ballSpeedStep: 5,        // ブロック命中ごとの加速
    ballSpeedMax: 640,
    maxBounceDeg: 62,        // パドル端で返る最大角（垂直からの角度）
    minVerticalDeg: 20,      // 水平往復を防ぐ最小角（水平からの角度）
    paddleWidth: 74,
    paddleHeight: 10,
    gainA: 2.4,              // 方式A：指の移動量の拡大率
    deadzoneB: 5,            // 方式B：基準位置からの不感帯（論理px）
    rangeB: 48,              // 方式B：このずれで最高速
    maxSpeedB: 1100,         // 方式B：パドル最高速（論理px/秒）
  };

  const BLOCK = {
    N: { hp: 1, score: 10, color: '#6f7d8f', edge: '#9aa8ba' },   // 通常（岩）
    H: { hp: 3, score: 50, color: '#3d4452', edge: '#8b95a8' },   // 硬質（金属）
    T: { hp: 2, score: 500, color: '#7a5a1c', edge: '#ffd36b' },  // 宝入り
  };

  // 1面のレイアウト。. は空き
  const STAGE = [
    'HNNNNNNH',
    'NNNTTNNN',
    'NHNNNNHN',
    'NNHNNHNN',
    'NTNHHNTN',
    'NNNNNNNN',
    'HNN..NNH',
  ];

  const W = 360;
  const COLS = 8, BLOCK_H = 17, GAP = 4, MARGIN = 12;
  const BLOCK_W = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;

  // ---------- 画面・レイアウト ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovText = document.getElementById('ov-text');
  const ovBtn = document.getElementById('ov-btn');

  let H = 640, scale = 1, offX = 0, offY = 0, dpr = 1;
  let safeTop = 0, safeBottom = 0;
  const L = {}; // レイアウト値

  function readSafeArea() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const t = parseFloat(cs.paddingTop) || 0, b = parseFloat(cs.paddingBottom) || 0;
    probe.remove();
    return [t, b];
  }

  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    H = Math.max(560, Math.min(820, (vh / vw) * W));
    scale = Math.min(vw / W, vh / H);
    offX = (vw - W * scale) / 2;
    offY = (vh - H * scale) / 2;
    const [st, sb] = readSafeArea();
    safeTop = Math.max(0, st / scale - offY / scale);
    safeBottom = Math.max(0, sb / scale - offY / scale);

    L.hudTop = safeTop + 6;
    L.hudH = 34;
    L.fieldTop = L.hudTop + L.hudH + 6;
    L.fieldBottom = H - safeBottom;
    L.blocksTop = L.fieldTop + 34;
    // 親指で隠れないよう、パドルは画面下端から少し上に置く
    L.paddleY = L.fieldBottom - Math.max(70, (L.fieldBottom - L.fieldTop) * 0.13);
    L.btnMode = { x: W - 118, y: L.hudTop + 3, w: 64, h: 28 };
    L.btnSound = { x: W - 48, y: L.hudTop + 3, w: 40, h: 28 };
    for (const b of blocks) placeBlock(b);
    paddle.y = L.paddleY;
    if (ball.stuck) stickBall();
  }

  function placeBlock(b) {
    b.x = MARGIN + b.col * (BLOCK_W + GAP);
    b.y = L.blocksTop + b.row * (BLOCK_H + GAP);
    b.w = BLOCK_W;
    b.h = BLOCK_H;
  }

  // ---------- 保存（端末ごとの設定のみ） ----------
  function load(key, def) {
    try { const v = localStorage.getItem('ball.' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function save(key, v) {
    try { localStorage.setItem('ball.' + key, JSON.stringify(v)); } catch (e) { /* 保存不可でも動く */ }
  }

  // ---------- サウンド（WebAudio 合成） ----------
  const Sound = {
    ctx: null, master: null, on: load('sound', true),
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, dur, type = 'square', vol = 0.2, slideTo = 0, delay = 0) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    },
    noise(dur, filterFreq, vol = 0.25, q = 1) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      s.buffer = buf;
      f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = q;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t);
    },
    paddle(offset) { this.tone(420 + offset * 60, 0.07, 'square', 0.12, 640 + offset * 90); },
    wall() { this.tone(1300, 0.03, 'sine', 0.06); },
    hitNormal(pitch) { this.noise(0.09, 1400 * pitch, 0.3, 0.8); this.tone(260 * pitch, 0.08, 'triangle', 0.18, 130 * pitch); },
    hitHard(pitch) { this.tone(1250 * pitch, 0.09, 'square', 0.07); this.tone(1720 * pitch, 0.12, 'square', 0.05); this.noise(0.04, 4000, 0.12, 3); },
    breakHard(pitch) { this.noise(0.22, 700 * pitch, 0.4, 0.6); this.tone(180 * pitch, 0.18, 'sawtooth', 0.14, 70); this.tone(1500, 0.1, 'square', 0.04); },
    crackTreasure() { this.tone(980, 0.06, 'triangle', 0.14); this.noise(0.06, 2500, 0.15, 2); },
    treasure() { [880, 1175, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, 0, i * 0.055)); this.noise(0.12, 1800, 0.2, 1); },
    lose() { this.tone(330, 0.45, 'sawtooth', 0.15, 70); },
    clear() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.22, 'square', 0.1, 0, i * 0.09)); },
    over() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.16, 0, i * 0.16)); },
  };

  // ---------- ゲーム状態 ----------
  let mode = load('mode', 'A');   // 'A' 移動量拡大 / 'B' 基準位置方式
  let state = 'title';            // title / play / clear / over
  let lives, score, treasures, combo, bestCombo;
  let blocks = [];
  const paddle = { x: W / 2, y: 560, w: TUNE.paddleWidth, h: TUNE.paddleHeight, vx: 0, flash: 0 };
  const ball = { x: 0, y: 0, vx: 0, vy: 0, speed: TUNE.ballSpeedStart, r: TUNE.ballRadius, stuck: true, trail: [] };
  const particles = [];
  const floaters = [];
  let shakeT = 0, shakeMag = 0;
  let hintT = 0;

  function buildStage() {
    blocks = [];
    STAGE.forEach((line, row) => {
      [...line].forEach((ch, col) => {
        const def = BLOCK[ch];
        if (!def) return;
        const b = { type: ch, hp: def.hp, maxHp: def.hp, row, col, flash: 0, alive: true, seed: Math.random() * 1000 };
        placeBlock(b);
        blocks.push(b);
      });
    });
  }

  function newGame() {
    lives = TUNE.lives; score = 0; treasures = 0; combo = 0; bestCombo = 0;
    particles.length = 0; floaters.length = 0;
    buildStage();
    paddle.x = W / 2;
    resetBall();
    state = 'play';
    hideOverlay();
  }

  function resetBall() {
    ball.speed = TUNE.ballSpeedStart;
    ball.stuck = true;
    ball.trail.length = 0;
    combo = 0;
    hintT = 0;
    stickBall();
  }

  function stickBall() {
    ball.x = paddle.x;
    ball.y = paddle.y - paddle.h / 2 - ball.r - 1;
  }

  function launch() {
    if (!ball.stuck || state !== 'play') return;
    ball.stuck = false;
    // パドルの動きに少しだけ引っ張られる発射角
    const tilt = Math.max(-1, Math.min(1, paddle.vx / 900)) * 0.35 + (Math.random() - 0.5) * 0.2;
    ball.vx = Math.sin(tilt) * ball.speed;
    ball.vy = -Math.cos(tilt) * ball.speed;
    Sound.paddle(0);
  }

  // ---------- 入力 ----------
  const input = { id: null, type: '', lastX: 0, anchorX: 0, curX: 0, curY: 0, anchorY: 0, active: false, moved: 0 };
  const keys = { left: false, right: false };

  function toLogical(e) {
    return [(e.clientX - offX) / scale, (e.clientY - offY) / scale];
  }
  function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    Sound.unlock();
    const [x, y] = toLogical(e);
    if (inRect(x, y, L.btnMode)) { setMode(mode === 'A' ? 'B' : 'A'); return; }
    if (inRect(x, y, L.btnSound)) { Sound.on = !Sound.on; save('sound', Sound.on); if (Sound.on) Sound.wall(); return; }
    if (input.active) return; // 最初の1本の指だけを使う
    input.active = true;
    input.id = e.pointerId;
    input.type = e.pointerType;
    input.lastX = input.anchorX = input.curX = x;
    input.anchorY = input.curY = y;
    input.moved = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 未対応でも動く */ }
    if (e.pointerType === 'mouse') paddle.targetX = x;
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toLogical(e);
    if (e.pointerType === 'mouse' && !input.active) { mouseX = x; return; }
    if (!input.active || e.pointerId !== input.id) return;
    e.preventDefault();
    const dx = x - input.lastX;
    input.moved += Math.abs(dx);
    input.lastX = x; input.curX = x; input.curY = y;
    if (e.pointerType === 'mouse') { mouseX = x; return; }
    if (mode === 'A') movePaddleTo(paddle.x + dx * TUNE.gainA);
  }, { passive: false });

  function endPointer(e) {
    if (!input.active || e.pointerId !== input.id) return;
    input.active = false;
    input.id = null;
    // 指を離すと発射（位置を決めてから撃てる）
    if (ball.stuck && state === 'play') launch();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  let mouseX = null;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    else if (e.key === 'ArrowRight') keys.right = true;
    else if (e.key === ' ' || e.key === 'Enter') {
      Sound.unlock();
      if (state === 'play') launch(); else ovBtn.click();
    } else if (e.key === 'm' || e.key === 'M') setMode(mode === 'A' ? 'B' : 'A');
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  });

  // iOS のダブルタップ拡大・スクロールを防ぐ
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  function setMode(m) {
    mode = m;
    save('mode', m);
    addFloater(W / 2, L.fieldTop + 14, m === 'A' ? '操作A：移動量拡大' : '操作B：基準位置方式', '#8fd3ff', 1.2);
  }

  function movePaddleTo(x) {
    const half = paddle.w / 2;
    paddle.x = Math.max(half + 2, Math.min(W - half - 2, x));
  }

  // ---------- 演出 ----------
  function burst(x, y, color, n, speed, life, grav = 600, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, size: size * (0.5 + Math.random()), grav, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20 });
    }
  }
  function sparkle(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7, color: i % 3 ? '#ffd36b' : '#fff6d0', size: 2 + Math.random() * 2, grav: 80, rot: 0, vr: 0, glow: true });
    }
  }
  function addFloater(x, y, text, color, life = 0.9, big = false) {
    floaters.push({ x, y, text, color, life, max: life, big });
  }
  function shake(mag, t) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, t); }

  // ---------- 物理 ----------
  function update(dt) {
    // パドル移動
    const prevX = paddle.x;
    if (state === 'play') {
      if (input.active && input.type !== 'mouse' && mode === 'B') {
        const d = input.curX - input.anchorX;
        const mag = Math.max(0, Math.abs(d) - TUNE.deadzoneB);
        const f = Math.min(1, mag / TUNE.rangeB);
        movePaddleTo(paddle.x + Math.sign(d) * f * f * TUNE.maxSpeedB * dt);
      }
      if (mouseX !== null) movePaddleTo(mouseX);
      if (keys.left) movePaddleTo(paddle.x - 520 * dt);
      if (keys.right) movePaddleTo(paddle.x + 520 * dt);
    }
    paddle.vx = paddle.vx * 0.6 + ((paddle.x - prevX) / dt) * 0.4;
    paddle.flash = Math.max(0, paddle.flash - dt);

    if (state === 'play') {
      if (ball.stuck) {
        stickBall();
        hintT += dt;
      } else {
        stepBall(dt);
      }
    }

    for (const b of blocks) b.flash = Math.max(0, b.flash - dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt; f.y -= 28 * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    shakeT = Math.max(0, shakeT - dt);
    if (shakeT === 0) shakeMag = 0;
  }

  function stepBall(dt) {
    const dist = ball.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / (ball.r * 0.6)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      ball.x += ball.vx * h;
      ball.y += ball.vy * h;
      if (collideWalls()) continue;
      if (collidePaddle()) continue;
      collideBlocks();
      if (ball.y - ball.r > L.fieldBottom + 10) { loseBall(); return; }
      if (state !== 'play') return;
    }
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 10) ball.trail.shift();
  }

  function collideWalls() {
    let hit = false;
    if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); hit = true; }
    else if (ball.x + ball.r > W) { ball.x = W - ball.r; ball.vx = -Math.abs(ball.vx); hit = true; }
    if (ball.y - ball.r < L.fieldTop) { ball.y = L.fieldTop + ball.r; ball.vy = Math.abs(ball.vy); hit = true; }
    if (hit) { enforceAngle(); Sound.wall(); burst(ball.x, ball.y, '#5b6574', 2, 60, 0.2, 0, 1.5); }
    return hit;
  }

  function collidePaddle() {
    if (ball.vy <= 0) return false;
    const top = paddle.y - paddle.h / 2;
    const half = paddle.w / 2;
    if (ball.y + ball.r < top || ball.y - ball.r > paddle.y + paddle.h / 2) return false;
    if (ball.x < paddle.x - half - ball.r || ball.x > paddle.x + half + ball.r) return false;
    // 当てた位置で反射角を決める：中心ほど真上、端ほど斜め
    const offset = Math.max(-1, Math.min(1, (ball.x - paddle.x) / half));
    const ang = offset * TUNE.maxBounceDeg * Math.PI / 180;
    ball.vx = Math.sin(ang) * ball.speed;
    ball.vy = -Math.cos(ang) * ball.speed;
    ball.y = top - ball.r - 0.5;
    paddle.flash = 0.12;
    combo = 0;
    Sound.paddle(Math.abs(offset));
    burst(ball.x, top, '#8fd3ff', 5, 110, 0.25, 200, 1.6);
    return true;
  }

  function collideBlocks() {
    for (const b of blocks) {
      if (!b.alive) continue;
      const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
      const dx = ball.x - cx, dy = ball.y - cy;
      if (dx * dx + dy * dy > ball.r * ball.r) continue;
      // どの面に当たったかをめり込み量から判定して反射
      const penL = ball.x + ball.r - b.x, penR = b.x + b.w - (ball.x - ball.r);
      const penT = ball.y + ball.r - b.y, penB = b.y + b.h - (ball.y - ball.r);
      const minX = Math.min(penL, penR), minY = Math.min(penT, penB);
      if (minX < minY) {
        if (penL < penR) { ball.x = b.x - ball.r; ball.vx = -Math.abs(ball.vx); }
        else { ball.x = b.x + b.w + ball.r; ball.vx = Math.abs(ball.vx); }
      } else {
        if (penT < penB) { ball.y = b.y - ball.r; ball.vy = -Math.abs(ball.vy); }
        else { ball.y = b.y + b.h + ball.r; ball.vy = Math.abs(ball.vy); }
      }
      hitBlock(b);
      enforceAngle();
      return true;
    }
    return false;
  }

  function hitBlock(b) {
    const def = BLOCK[b.type];
    b.hp--;
    b.flash = 0.12;
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    const pitch = 1 + Math.min(combo - 1, 12) * 0.045;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    ball.speed = Math.min(TUNE.ballSpeedMax, ball.speed + TUNE.ballSpeedStep);
    rescaleBall();

    if (b.hp > 0) {
      if (b.type === 'H') { Sound.hitHard(pitch); burst(ball.x, ball.y, '#ffe9b0', 6, 220, 0.18, 0, 1.4); score += 5; }
      else { Sound.crackTreasure(); sparkle(cx, cy, 6); }
      return;
    }

    b.alive = false;
    score += def.score;
    if (b.type === 'N') {
      Sound.hitNormal(pitch);
      burst(cx, cy, def.color, 12, 170, 0.6, 700, 3);
      burst(cx, cy, def.edge, 4, 120, 0.4, 500, 2);
    } else if (b.type === 'H') {
      Sound.breakHard(pitch);
      burst(cx, cy, def.edge, 16, 230, 0.7, 800, 3.5);
      burst(cx, cy, '#ffe9b0', 8, 300, 0.25, 0, 1.4);
      shake(4, 0.12);
    } else {
      treasures++;
      Sound.treasure();
      sparkle(cx, cy, 26);
      burst(cx, cy, def.color, 10, 160, 0.6, 700, 3);
      addFloater(cx, cy - 6, '財宝 +' + def.score, '#ffd36b', 1.1, true);
      shake(5, 0.15);
    }
    if (combo >= 4) addFloater(cx, cy + 10, combo + ' 連続', '#c9d4e3', 0.6);

    if (blocks.every((x) => !x.alive)) stageClear();
  }

  function rescaleBall() {
    const m = Math.hypot(ball.vx, ball.vy) || 1;
    ball.vx = ball.vx / m * ball.speed;
    ball.vy = ball.vy / m * ball.speed;
  }

  // 長く続く水平往復を避けるため、水平からの角度に下限を設ける
  function enforceAngle() {
    const minA = TUNE.minVerticalDeg * Math.PI / 180;
    const a = Math.atan2(Math.abs(ball.vy), Math.abs(ball.vx));
    if (a < minA) {
      const sx = Math.sign(ball.vx) || 1, sy = Math.sign(ball.vy) || 1;
      ball.vx = Math.cos(minA) * ball.speed * sx;
      ball.vy = Math.sin(minA) * ball.speed * sy;
    }
  }

  function loseBall() {
    lives--;
    Sound.lose();
    shake(8, 0.25);
    burst(ball.x, L.fieldBottom - 4, '#ff6b5b', 14, 200, 0.5, 400, 2.5);
    if (lives <= 0) {
      state = 'over';
      ball.stuck = true;
      setTimeout(() => { Sound.over(); showOverlay('GAME OVER', `スコア ${score}　財宝 ${treasures}<br>最大連続 ${bestCombo}`, 'リスタート'); }, 450);
    } else {
      resetBall();
    }
  }

  function stageClear() {
    state = 'clear';
    ball.trail.length = 0;
    Sound.clear();
    for (let i = 0; i < 5; i++) setTimeout(() => sparkle(40 + Math.random() * (W - 80), L.blocksTop + Math.random() * 140, 20), i * 120);
    setTimeout(() => showOverlay('全破壊！', `スコア ${score}　財宝 ${treasures}<br>残機 ${lives}　最大連続 ${bestCombo}`, 'もう一度'), 900);
  }

  // ---------- 描画 ----------
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let sx = 0, sy = 0;
    if (shakeT > 0) { sx = (Math.random() - 0.5) * 2 * shakeMag; sy = (Math.random() - 0.5) * 2 * shakeMag; }
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx * scale) * dpr, (offY + sy * scale) * dpr);

    drawBackground();
    for (const b of blocks) if (b.alive) drawBlock(b);
    drawParticles();
    drawPaddle();
    if (state === 'play' || state === 'clear') drawBall();
    drawFloaters();
    drawTouchGuide();
    drawHud();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, L.fieldTop, 0, L.fieldBottom);
    g.addColorStop(0, '#11141a');
    g.addColorStop(1, '#090a0d');
    ctx.fillStyle = g;
    ctx.fillRect(0, L.fieldTop, W, L.fieldBottom - L.fieldTop);
    // 岩盤っぽい薄い筋
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const y = L.fieldTop + 40 + i * 58;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(W * 0.3, y + 14, W * 0.6, y - 12, W, y + 6);
      ctx.stroke();
    }
    // 天井
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(0, L.fieldTop - 3, W, 3);
    // 落下ライン
    ctx.fillStyle = 'rgba(255,107,91,0.10)';
    ctx.fillRect(0, L.fieldBottom - 2, W, 2);
  }

  function drawBlock(b) {
    const def = BLOCK[b.type];
    const x = b.x, y = b.y, w = b.w, h = b.h;
    if (b.type === 'T') {
      ctx.save();
      ctx.shadowColor = 'rgba(255,211,107,0.55)';
      ctx.shadowBlur = 10 + Math.sin(now * 4 + b.seed) * 4;
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, w, h);
    }
    // 上面ハイライトと下面の影で立体感
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.strokeStyle = def.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    if (b.type === 'H') {
      // 金属のリベット
      ctx.fillStyle = '#a7b0c2';
      ctx.fillRect(x + 3, y + h / 2 - 1, 2, 2);
      ctx.fillRect(x + w - 5, y + h / 2 - 1, 2, 2);
    }
    if (b.type === 'T') {
      // 中の宝石
      const cx = x + w / 2, cy = y + h / 2;
      ctx.fillStyle = b.hp < b.maxHp ? '#fff1b8' : '#ffd36b';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy);
      ctx.closePath(); ctx.fill();
    }
    // ひび割れ（残り耐久が減るほど増える）
    const dmg = b.maxHp - b.hp;
    if (dmg > 0) {
      ctx.strokeStyle = b.type === 'T' ? 'rgba(255,240,190,0.9)' : 'rgba(10,12,16,0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const r = (n) => ((Math.sin(b.seed + n * 12.9898) * 43758.5453) % 1 + 1) % 1;
      for (let k = 0; k < dmg * 2; k++) {
        let px = x + w * (0.2 + r(k) * 0.6), py = y + 2;
        ctx.moveTo(px, py);
        for (let s = 0; s < 3; s++) {
          px += (r(k * 7 + s) - 0.5) * 10;
          py += h / 3;
          ctx.lineTo(px, Math.min(py, y + h - 1));
        }
      }
      ctx.stroke();
    }
    if (b.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(b.flash / 0.12) * 0.7})`;
      ctx.fillRect(x, y, w, h);
    }
  }

  function drawPaddle() {
    const x = paddle.x - paddle.w / 2, y = paddle.y - paddle.h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(143,211,255,0.5)';
    ctx.shadowBlur = 8 + paddle.flash * 120;
    ctx.fillStyle = paddle.flash > 0 ? '#e6f6ff' : '#8fd3ff';
    roundRect(x, y, paddle.w, paddle.h, 4);
    ctx.fill();
    ctx.restore();
    // 中心と端の目印（狙いの手がかり）
    ctx.fillStyle = 'rgba(7,8,11,0.55)';
    ctx.fillRect(paddle.x - 1, y + 2, 2, paddle.h - 4);
  }

  function drawBall() {
    for (let i = 0; i < ball.trail.length; i++) {
      const t = ball.trail[i], a = (i + 1) / ball.trail.length;
      ctx.fillStyle = `rgba(255,236,190,${a * 0.28})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, ball.r * (0.4 + a * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = 'rgba(255,240,200,0.9)';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.glow) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
      ctx.font = `${f.big ? 700 : 600} ${f.big ? 15 : 12}px -apple-system, "Hiragino Sans", sans-serif`;
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawTouchGuide() {
    if (state !== 'play') return;
    if (input.active && input.type !== 'mouse' && mode === 'B') {
      // 基準位置と現在のずれを表示
      const d = Math.max(-TUNE.rangeB - 10, Math.min(TUNE.rangeB + 10, input.curX - input.anchorX));
      ctx.strokeStyle = 'rgba(143,211,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(input.anchorX, input.anchorY, TUNE.rangeB, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(143,211,255,0.2)';
      ctx.beginPath(); ctx.arc(input.anchorX, input.anchorY, TUNE.deadzoneB, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(143,211,255,0.5)';
      ctx.beginPath(); ctx.arc(input.anchorX + d, input.anchorY, 9, 0, Math.PI * 2); ctx.fill();
    }
    if (ball.stuck && hintT > 0.4) {
      ctx.globalAlpha = 0.55 + Math.sin(now * 4) * 0.25;
      ctx.fillStyle = '#c9d4e3';
      ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(input.active ? '指を離して発射' : 'ドラッグで移動・離して発射', W / 2, paddle.y - 70);
      ctx.globalAlpha = 1;
    }
  }

  function drawHud() {
    const y = L.hudTop + L.hudH / 2;
    ctx.textBaseline = 'middle';
    // 残機
    for (let i = 0; i < TUNE.lives; i++) {
      ctx.fillStyle = i < (lives ?? TUNE.lives) ? '#fffaf0' : '#2a2f38';
      ctx.beginPath(); ctx.arc(16 + i * 16, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    // 財宝
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath();
    const tx = 72;
    ctx.moveTo(tx, y - 6); ctx.lineTo(tx + 6, y); ctx.lineTo(tx, y + 6); ctx.lineTo(tx - 6, y);
    ctx.closePath(); ctx.fill();
    ctx.font = '600 14px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(treasures ?? 0), tx + 10, y + 1);
    // スコア
    ctx.fillStyle = '#d8dde6';
    ctx.textAlign = 'right';
    ctx.fillText(String(score ?? 0), L.btnMode.x - 12, y + 1);
    // ボタン
    drawButton(L.btnMode, '操作 ' + mode, '#8fd3ff');
    drawButton(L.btnSound, Sound.on ? '音' : '無音', Sound.on ? '#c9d4e3' : '#5b6574');
  }

  function drawButton(r, label, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 6);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- オーバーレイ ----------
  function showOverlay(title, html, btn) {
    ovTitle.textContent = title;
    ovText.innerHTML = html;
    ovBtn.textContent = btn;
    overlay.classList.add('show');
  }
  function hideOverlay() { overlay.classList.remove('show'); }
  ovBtn.addEventListener('click', () => { Sound.unlock(); newGame(); });

  // ---------- ループ ----------
  let now = 0, last = performance.now(), acc = 0;
  const STEP = 1 / 120;
  function frame(t) {
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.1) dt = 0.1; // タブ復帰時の暴走防止
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; now += STEP; }
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  buildStage();
  resize();
  stickBall();
  showOverlay('B.A.L.L.',
    '全ブロックを砕けばクリア。<br>画面のどこでも親指でパドルを動かし、指を離して発射。<br>' +
    '右上の「操作」で方式を切替：<br><b>A</b> 指の移動を拡大／<b>B</b> 置いた位置からのずれで移動',
    'スタート');

  // 自動テスト・デバッグ用の窓口
  window.__ball = { get state() { return state; }, get ball() { return ball; }, get paddle() { return paddle; }, get blocks() { return blocks; }, get lives() { return lives; }, get score() { return score; }, newGame, launch, setMode, TUNE };

  requestAnimationFrame(frame);
})();
