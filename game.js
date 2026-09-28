// B.A.L.L. — 試作：操作と破壊＋多球・レベルアップ・装備
// 依存なしの Canvas 2D 実装。論理座標は幅 360 固定、高さは画面の縦横比から決める。
(() => {
  'use strict';
  const T = window.BallTex, A = window.BallAudio;

  // ---------- 調整用パラメータ（試作値。実機で詰める） ----------
  const TUNE = {
    lives: 3,
    ballRadius: 5,
    ballSpeedStart: 390,     // 論理px/秒
    ballSpeedFloor: 15,      // 階層ごとの初速上昇
    ballSpeedStep: 4,        // ブロック命中ごとの加速
    ballSpeedMax: 640,
    maxBalls: 16,
    fanDeg: 9,               // 複数発射時の球どうしの角度差
    maxBounceDeg: 62,        // パドル端で返る最大角（垂直からの角度）
    minVerticalDeg: 20,      // 水平往復を防ぐ最小角（水平からの角度）
    paddleWidth: 74,
    paddleHeight: 10,
    gain: 2.4,               // 指の移動量の拡大率（操作A）
    xpBase: 12, xpStep: 10,  // レベルnに必要な経験値 = xpBase + xpStep*(n-1)
    equipDropRate: 0.6,      // 宝入りブロックから装備が出る確率
  };

  const BLOCK = {
    N: { hp: 1, score: 10, xp: 1, dust: '#8a8178', chip: ['#7d756c', '#5f5953', '#9b928a'] },  // 岩
    H: { hp: 3, score: 50, xp: 3, dust: '#6f6a66', chip: ['#5c626c', '#7d8591', '#8a4c2a'] },  // 鉄板
    T: { hp: 2, score: 500, xp: 5, dust: '#8a6f55', chip: ['#6d5140', '#e0a83c', '#8a6a4a'] }, // 宝入り岩
  };

  const STAGES = [
    ['HNNNNNNH', 'NNNTTNNN', 'NHNNNNHN', 'NNHNNHNN', 'NTNHHNTN', 'NNNNNNNN', 'HNN..NNH'],
    ['NNHNNHNN', 'NTNNNNTN', 'HHNHHNHH', 'NNNTTNNN', 'NHNNNNHN', 'NNNHHNNN', 'T.NNNN.T'],
    ['HHHNNHHH', 'NTNNNNTN', 'NNHTTHNN', 'HNNNNNNH', 'NNHNNHNN', 'NTNHHNTN', 'NNNNNNNN', 'H.N..N.H'],
  ];

  // 装備（階層突破・帰還で確保、ゲームオーバーで今回の未確保品は失う）
  const ITEMS = {
    twin:    { slot: 'ball',    name: '双子の鉄球', desc: 'ボール +1', balls: 1 },
    heavy:   { slot: 'ball',    name: '重鉄球',     desc: '威力 +1',   power: 1 },
    haft:    { slot: 'paddle',  name: '鉱夫の長柄', desc: 'パドル幅 +12%', width: 0.12 },
    bulwark: { slot: 'paddle',  name: '防壁の板',   desc: '残機 +1',   lives: 1 },
    charm:   { slot: 'support', name: '分裂の護符', desc: 'ボール +1', balls: 1 },
    lantern: { slot: 'support', name: '鉱夫のランタン', desc: '財宝の得点 +50%', gold: 0.5 },
  };
  const SLOT_NAME = { ball: 'ボール', paddle: 'パドル', support: '補助' };

  // レベルアップの3択（今回の探索のみ有効）
  const PERKS = {
    ball:  { name: 'ボール +1', desc: '発射できる球が1つ増える' },
    width: { name: 'パドル拡張', desc: 'パドル幅 +10%' },
    power: { name: '威力 +1', desc: '硬いブロックを少ない命中で砕く' },
    life:  { name: '残機 +1', desc: '落球に1回耐える' },
    calm:  { name: '球速 −8%', desc: '球が読みやすくなる' },
  };

  const W = 360;
  const WALL = 7;                 // 左右の木の支柱の幅（＝壁）
  const COLS = 8, BLOCK_H = 17, GAP = 4, MARGIN = 14;
  const BLOCK_W = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;

  // ---------- 画面・レイアウト ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovText = document.getElementById('ov-text');
  const ovButtons = document.getElementById('ov-buttons');

  let H = 640, scale = 1, offX = 0, offY = 0, dpr = 1, PS = 1;
  const L = {};
  const art = { bg: null, paddle: null, paddleW: 0, ball: null, dust: null, glint: null, layer: null, layerDirty: true };

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
    PS = Math.min(3.5, scale * dpr);
    const [st, sb] = readSafeArea();
    const safeTop = Math.max(0, st / scale - offY / scale);
    const safeBottom = Math.max(0, sb / scale - offY / scale);

    L.hudTop = safeTop + 4;
    L.hudH = 50;
    L.fieldTop = L.hudTop + L.hudH + 2;
    L.ceil = L.fieldTop + WALL;
    L.fieldBottom = H - safeBottom;
    L.blocksTop = L.ceil + 30;
    // 親指で隠れないよう、パドルは画面下端から少し上に置く
    L.paddleY = L.fieldBottom - Math.max(70, (L.fieldBottom - L.fieldTop) * 0.13);
    L.btnSound = { x: W - 48, y: L.hudTop + 2, w: 40, h: 24 };
    for (const b of blocks) placeBlock(b);
    paddle.y = L.paddleY;
    bakeArt();
  }

  function bakeArt() {
    art.bg = T.cave(W, H, Math.min(PS, 1.6), L.fieldTop, WALL);
    art.ball = T.ball(TUNE.ballRadius, PS);
    art.dust = T.dust(PS);
    art.glint = T.glint(PS);
    art.paddle = null;
    art.layer = document.createElement('canvas');
    art.layer.width = Math.round(W * PS);
    art.layer.height = Math.round(H * PS);
    for (const b of blocks) b.tex = null;
    art.layerDirty = true;
  }

  function placeBlock(b) {
    b.x = MARGIN + b.col * (BLOCK_W + GAP);
    b.y = L.blocksTop + b.row * (BLOCK_H + GAP);
    b.w = BLOCK_W;
    b.h = BLOCK_H;
  }

  // ---------- 保存（端末ごと） ----------
  function load(key, def) {
    try { const v = localStorage.getItem('ball.' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function save(key, v) {
    try { localStorage.setItem('ball.' + key, JSON.stringify(v)); } catch (e) { /* 保存不可でも動く */ }
  }

  // ---------- ゲーム状態 ----------
  let state = 'title';            // title / play / choice / clear / over
  let secured = load('equip', {}); // slot -> {id, lv}（確保済み）
  let run = null;                 // 今回の探索
  let blocks = [];
  const balls = [];
  const paddle = { x: W / 2, y: 560, w: TUNE.paddleWidth, h: TUNE.paddleHeight, vx: 0, flash: 0 };
  const particles = [], sparks = [], flashes = [], floaters = [];
  const queue = [];               // レベルアップ・装備入れ替えの選択待ち
  let shakeT = 0, shakeMag = 0, hintT = 0, floorCleared = false;
  A.enabled = load('sound', true);

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function equipTotal(key, equip = run ? run.equip : secured) {
    let t = 0;
    for (const s in equip) { const e = equip[s]; if (e && ITEMS[e.id] && ITEMS[e.id][key]) t += ITEMS[e.id][key] * e.lv; }
    return t;
  }
  const ballCount = () => Math.min(TUNE.maxBalls, 1 + run.perk.ball + equipTotal('balls'));
  const power = () => run.perk.power + equipTotal('power');
  const paddleWidth = () => TUNE.paddleWidth * (1 + run.perk.width * 0.1 + equipTotal('width'));
  const xpNeed = (lv) => TUNE.xpBase + TUNE.xpStep * (lv - 1);

  function buildStage(floor) {
    blocks = [];
    const layout = STAGES[(floor - 1) % STAGES.length];
    layout.forEach((line, row) => {
      [...line].forEach((ch, col) => {
        // 深い階層ほど通常ブロックの一部が鉄板になる
        if (ch === 'N' && floor > STAGES.length && T.hash(row, col, floor) < 0.12 * (floor - STAGES.length)) ch = 'H';
        const def = BLOCK[ch];
        if (!def) return;
        const b = { type: ch, hp: def.hp, maxHp: def.hp, row, col, alive: true, seed: (T.hash(row, col, floor * 97) * 1e6) | 0, tex: null, texDmg: -1 };
        placeBlock(b);
        blocks.push(b);
      });
    });
    art.layerDirty = true;
  }

  function newRun() {
    run = {
      floor: 1, score: 0, treasures: 0, lv: 1, xp: 0, bestCombo: 0,
      perk: { ball: 0, width: 0, power: 0, calm: 0 },
      equip: clone(secured), found: [],
      lives: TUNE.lives + equipTotal('lives', secured),
    };
    particles.length = sparks.length = flashes.length = floaters.length = queue.length = 0;
    startFloor();
  }

  function startFloor() {
    floorCleared = false;
    buildStage(run.floor);
    paddle.x = W / 2;
    updatePaddleWidth();
    serve();
    state = 'play';
    hideOverlay();
    addFloater(W / 2, L.blocksTop - 14, `第${run.floor}層`, '#e8dcc4', 1.4, true);
  }

  function updatePaddleWidth() {
    paddle.w = paddleWidth();
    movePaddleTo(paddle.x);
  }

  function baseSpeed() {
    return (TUNE.ballSpeedStart + TUNE.ballSpeedFloor * (run.floor - 1)) * Math.pow(0.92, run.perk.calm);
  }

  // 発射待ちの球をパドルに並べる
  function serve() {
    balls.length = 0;
    const n = ballCount();
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5; // -0.5..0.5
      balls.push({ x: 0, y: 0, vx: 0, vy: 0, speed: baseSpeed(), stuck: true, slot: k, trail: [], combo: 0 });
    }
    hintT = 0;
    stickBalls();
  }

  function stickBalls() {
    const n = balls.length;
    for (const b of balls) {
      if (!b.stuck) continue;
      const spread = Math.min(paddle.w * 0.7, n * TUNE.ballRadius * 2.2);
      b.x = paddle.x + b.slot * spread;
      b.y = paddle.y - paddle.h / 2 - TUNE.ballRadius - 1;
    }
  }

  function launch() {
    if (state !== 'play') return;
    const stuck = balls.filter((b) => b.stuck);
    if (!stuck.length) return;
    // パドルの動きに少しだけ引っ張られる発射角。複数なら扇状に広げる
    const tilt = Math.max(-1, Math.min(1, paddle.vx / 900)) * 0.35 + (Math.random() - 0.5) * 0.15;
    const n = stuck.length;
    const step = Math.min(TUNE.fanDeg, 70 / Math.max(1, n - 1)) * Math.PI / 180;
    stuck.forEach((b, i) => {
      const a = tilt + (i - (n - 1) / 2) * step;
      b.stuck = false;
      b.vx = Math.sin(a) * b.speed;
      b.vy = -Math.cos(a) * b.speed;
    });
    A.play('paddle', { vol: 0.8, pan: panOf(paddle.x) });
  }

  // 強化・装備で球が増えた時、プレイ中なら即座にパドルから放つ
  function addBalls(n) {
    if (balls.some((b) => b.stuck)) { serve(); return; }
    for (let i = 0; i < n; i++) {
      if (balls.length >= TUNE.maxBalls) return;
      const a = (Math.random() - 0.5) * 0.9;
      const s = baseSpeed();
      balls.push({ x: paddle.x, y: paddle.y - paddle.h / 2 - TUNE.ballRadius - 1, vx: Math.sin(a) * s, vy: -Math.cos(a) * s, speed: s, stuck: false, slot: 0, trail: [], combo: 0 });
    }
  }

  // ---------- 入力（操作A：指の移動量を拡大） ----------
  const input = { id: null, lastX: 0, active: false };
  const keys = { left: false, right: false };
  let mouseX = null;

  function toLogical(e) { return [(e.clientX - offX) / scale, (e.clientY - offY) / scale]; }
  function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    A.unlock();
    const [x, y] = toLogical(e);
    if (inRect(x, y, L.btnSound)) { A.enabled = !A.enabled; save('sound', A.enabled); return; }
    if (input.active) return; // 最初の1本の指だけを使う
    input.active = true;
    input.id = e.pointerId;
    input.lastX = x;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 未対応でも動く */ }
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const [x] = toLogical(e);
    if (e.pointerType === 'mouse') { mouseX = x; return; }
    if (!input.active || e.pointerId !== input.id) return;
    e.preventDefault();
    const dx = x - input.lastX;
    input.lastX = x;
    if (state === 'play') movePaddleTo(paddle.x + dx * TUNE.gain);
  }, { passive: false });

  function endPointer(e) {
    if (!input.active || e.pointerId !== input.id) return;
    input.active = false;
    input.id = null;
    launch(); // 指を離すと発射（位置を決めてから撃てる）
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    else if (e.key === 'ArrowRight') keys.right = true;
    else if (e.key === ' ') { A.unlock(); launch(); }
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keys.left = false;
    if (e.key === 'ArrowRight') keys.right = false;
  });

  // iOS のダブルタップ拡大・スクロールを防ぐ（オーバーレイ内のスクロールは許可）
  document.addEventListener('touchmove', (e) => { if (!(e.target.closest && e.target.closest('#overlay'))) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  function movePaddleTo(x) {
    const half = paddle.w / 2;
    paddle.x = Math.max(WALL + half, Math.min(W - WALL - half, x));
  }

  // ---------- 演出 ----------
  function debris(x, y, colors, n, speed, sizeMul = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.25 + Math.random() * 0.75);
      const r = (0.7 + Math.random() * 1.6) * sizeMul;
      const pts = [];
      const k = 3 + (Math.random() * 3 | 0);
      for (let j = 0; j < k; j++) { const t = j / k * Math.PI * 2 + Math.random() * 0.8; pts.push([Math.cos(t) * r * (0.6 + Math.random() * 0.6), Math.sin(t) * r * (0.6 + Math.random() * 0.6)]); }
      particles.push({ kind: 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: 0.9 + Math.random() * 0.5, max: 1.4, color: colors[i % colors.length], pts, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 18, grav: 900 });
    }
  }
  function dust(x, y, n, color = '#8a8178', size = 1) {
    for (let i = 0; i < n; i++) {
      particles.push({ kind: 'dust', x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 40, vy: -10 - Math.random() * 25, life: 0.7 + Math.random() * 0.6, max: 1.3, r0: 5 * size, r1: (14 + Math.random() * 12) * size, grav: -8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 1.5 });
    }
  }
  function sparkBurst(x, y, n, speed = 320) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.9);
      sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.18 + Math.random() * 0.3, max: 0.48 });
    }
  }
  function glints(x, y, n, spread = 16) {
    for (let i = 0; i < n; i++) {
      particles.push({ kind: 'glint', x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.6, vx: (Math.random() - 0.5) * 80, vy: -30 - Math.random() * 90, life: 0.5 + Math.random() * 0.6, max: 1.1, size: 7 + Math.random() * 7, grav: 120, rot: 0, vr: 0 });
    }
  }
  function flash(x, y, r, color, life = 0.12) { flashes.push({ x, y, r, color, life, max: life }); }
  function addFloater(x, y, text, color, life = 0.9, big = false) { floaters.push({ x, y, text, color, life, max: life, big }); }
  function shake(mag, t) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, t); }
  function panOf(x) { return (x / W) * 1.6 - 0.8; }

  // ---------- 物理 ----------
  function update(dt) {
    const prevX = paddle.x;
    if (state === 'play') {
      if (mouseX !== null) movePaddleTo(mouseX);
      if (keys.left) movePaddleTo(paddle.x - 520 * dt);
      if (keys.right) movePaddleTo(paddle.x + 520 * dt);
    }
    paddle.vx = paddle.vx * 0.6 + ((paddle.x - prevX) / dt) * 0.4;
    paddle.flash = Math.max(0, paddle.flash - dt);

    if (state === 'play') {
      stickBalls();
      if (balls.some((b) => b.stuck)) hintT += dt;
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.stuck) continue;
        if (stepBall(b, dt)) balls.splice(i, 1);
      }
      if (!balls.length && !floorCleared) loseLife();
      processQueue();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      if (p.kind === 'dust') { p.vx *= 0.97; p.vy *= 0.97; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.px = s.x; s.py = s.y;
      s.vy += 700 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt; if (flashes[i].life <= 0) flashes.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt; f.y -= 24 * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    shakeT = Math.max(0, shakeT - dt);
    if (shakeT === 0) shakeMag = 0;
  }

  // 戻り値 true = 球が落ちた
  function stepBall(b, dt) {
    const dist = b.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / (TUNE.ballRadius * 0.6)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (collideWalls(b)) continue;
      if (collidePaddle(b)) continue;
      collideBlocks(b);
      if (b.y - TUNE.ballRadius > L.fieldBottom + 10) return true;
    }
    b.trail.push(b.x, b.y);
    if (b.trail.length > 12) b.trail.splice(0, 2);
    return false;
  }

  function collideWalls(b) {
    const r = TUNE.ballRadius;
    let hit = false;
    if (b.x - r < WALL) { b.x = WALL + r; b.vx = Math.abs(b.vx); hit = true; }
    else if (b.x + r > W - WALL) { b.x = W - WALL - r; b.vx = -Math.abs(b.vx); hit = true; }
    if (b.y - r < L.ceil) { b.y = L.ceil + r; b.vy = Math.abs(b.vy); hit = true; }
    if (hit) {
      enforceAngle(b);
      A.play('wood', { vol: 0.45, pan: panOf(b.x), gap: 0.04 });
      dust(b.x, b.y, 1, '#6b5a48', 0.5);
    }
    return hit;
  }

  function collidePaddle(b) {
    if (b.vy <= 0) return false;
    const r = TUNE.ballRadius;
    const top = paddle.y - paddle.h / 2;
    const half = paddle.w / 2;
    if (b.y + r < top || b.y - r > paddle.y + paddle.h / 2) return false;
    if (b.x < paddle.x - half - r || b.x > paddle.x + half + r) return false;
    // 当てた位置で反射角を決める：中心ほど真上、端ほど斜め
    const offset = Math.max(-1, Math.min(1, (b.x - paddle.x) / half));
    const ang = offset * TUNE.maxBounceDeg * Math.PI / 180;
    b.vx = Math.sin(ang) * b.speed;
    b.vy = -Math.cos(ang) * b.speed;
    b.y = top - r - 0.5;
    b.combo = 0;
    paddle.flash = 0.1;
    A.play('paddle', { vol: 0.75, pan: panOf(b.x), rate: 1 + Math.abs(offset) * 0.06, gap: 0.035 });
    sparkBurst(b.x, top, 3, 160);
    flash(b.x, top, 22, 'rgba(255,230,190,0.5)', 0.08);
    return true;
  }

  function collideBlocks(ball) {
    const r = TUNE.ballRadius;
    for (const b of blocks) {
      if (!b.alive) continue;
      const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
      const dx = ball.x - cx, dy = ball.y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      // どの面に当たったかをめり込み量から判定して反射
      const penL = ball.x + r - b.x, penR = b.x + b.w - (ball.x - r);
      const penT = ball.y + r - b.y, penB = b.y + b.h - (ball.y - r);
      if (Math.min(penL, penR) < Math.min(penT, penB)) {
        if (penL < penR) { ball.x = b.x - r; ball.vx = -Math.abs(ball.vx); }
        else { ball.x = b.x + b.w + r; ball.vx = Math.abs(ball.vx); }
      } else {
        if (penT < penB) { ball.y = b.y - r; ball.vy = -Math.abs(ball.vy); }
        else { ball.y = b.y + b.h + r; ball.vy = Math.abs(ball.vy); }
      }
      hitBlock(b, ball, cx, cy);
      enforceAngle(ball);
      return true;
    }
    return false;
  }

  function hitBlock(b, ball, hx, hy) {
    const def = BLOCK[b.type];
    b.hp -= 1 + power();
    ball.combo++;
    run.bestCombo = Math.max(run.bestCombo, ball.combo);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const pan = panOf(cx);
    ball.speed = Math.min(TUNE.ballSpeedMax, ball.speed + TUNE.ballSpeedStep);
    rescale(ball);

    if (b.hp > 0) {
      art.layerDirty = true; // ひびを描き直す
      if (b.type === 'H') {
        A.play('metalHit', { vol: 0.8, pan });
        sparkBurst(hx, hy, 10, 360);
        flash(hx, hy, 30, 'rgba(255,210,150,0.7)');
        run.score += 5;
      } else {
        A.play('treasureCrack', { vol: 0.8, pan });
        glints(cx, cy, 3);
        flash(cx, cy, 26, 'rgba(255,200,90,0.5)');
      }
      debris(hx, hy, def.chip, 3, 120, 0.7);
      return;
    }

    b.alive = false;
    art.layerDirty = true;
    run.score += def.score;
    gainXp(def.xp);
    if (b.type === 'N') {
      A.play('rockBreak', { vol: 0.9, pan, gap: 0.025 });
      debris(cx, cy, def.chip, 14, 190);
      dust(cx, cy, 4, def.dust);
      flash(hx, hy, 18, 'rgba(255,240,220,0.35)', 0.07);
    } else if (b.type === 'H') {
      A.play('metalBreak', { vol: 1, pan });
      debris(cx, cy, def.chip, 16, 240, 1.2);
      dust(cx, cy, 5, def.dust, 1.2);
      sparkBurst(cx, cy, 22, 420);
      flash(cx, cy, 50, 'rgba(255,200,140,0.8)', 0.16);
      shake(4, 0.12);
    } else {
      run.treasures++;
      const bonus = Math.round(def.score * equipTotal('gold'));
      run.score += bonus;
      A.play('coins', { vol: 1, pan, wet: 0.45 });
      debris(cx, cy, def.chip, 12, 180);
      dust(cx, cy, 4, def.dust);
      glints(cx, cy, 14, 26);
      flash(cx, cy, 60, 'rgba(255,200,90,0.8)', 0.25);
      addFloater(cx, cy - 6, '財宝 +' + (def.score + bonus), '#ffd36b', 1.1, true);
      shake(5, 0.15);
      if (Math.random() < TUNE.equipDropRate) findItem(cx, cy);
    }
    if (ball.combo >= 4) addFloater(cx, cy + 10, ball.combo + ' 連続', '#d9d2c5', 0.6);
    if (blocks.every((x) => !x.alive)) floorCleared = true;
  }

  function rescale(b) {
    const m = Math.hypot(b.vx, b.vy) || 1;
    b.vx = b.vx / m * b.speed;
    b.vy = b.vy / m * b.speed;
  }

  // 長く続く水平往復を避けるため、水平からの角度に下限を設ける
  function enforceAngle(b) {
    const minA = TUNE.minVerticalDeg * Math.PI / 180;
    const a = Math.atan2(Math.abs(b.vy), Math.abs(b.vx));
    if (a < minA) {
      const sx = Math.sign(b.vx) || 1, sy = Math.sign(b.vy) || 1;
      b.vx = Math.cos(minA) * b.speed * sx;
      b.vy = Math.sin(minA) * b.speed * sy;
    }
  }

  // ---------- 成長 ----------
  function gainXp(n) {
    run.xp += n;
    while (run.xp >= xpNeed(run.lv)) {
      run.xp -= xpNeed(run.lv);
      run.lv++;
      queue.push({ type: 'level' });
    }
  }

  function findItem(x, y) {
    const ids = Object.keys(ITEMS);
    // 球を増やす装備は少し出やすい
    const weights = ids.map((id) => (ITEMS[id].balls ? 1.6 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), id = ids[0];
    for (let i = 0; i < ids.length; i++) { r -= weights[i]; if (r <= 0) { id = ids[i]; break; } }
    const it = ITEMS[id];
    const cur = run.equip[it.slot];
    if (!cur) {
      equipItem(id, 1);
      addFloater(x, y + 14, `装備発見：${it.name}`, '#9fe0ff', 1.6, true);
    } else if (cur.id === id) {
      equipItem(id, cur.lv + 1);
      addFloater(x, y + 14, `重ね強化：${it.name} Lv${cur.lv + 1}`, '#9fe0ff', 1.6, true);
    } else {
      queue.push({ type: 'swap', id });
    }
  }

  function equipItem(id, lv) {
    const it = ITEMS[id];
    const before = { balls: equipTotal('balls'), lives: equipTotal('lives') };
    run.equip[it.slot] = { id, lv };
    if (!run.found.includes(it.slot)) run.found.push(it.slot);
    A.play('equip', { vol: 0.6, wet: 0.5 });
    const dBalls = equipTotal('balls') - before.balls;
    const dLives = equipTotal('lives') - before.lives;
    if (dLives > 0) run.lives += dLives;
    updatePaddleWidth();
    if (dBalls > 0) addBalls(dBalls);
  }

  function applyPerk(key) {
    if (key === 'life') { run.lives++; return; }
    run.perk[key]++;
    if (key === 'ball') addBalls(1);
    if (key === 'width') updatePaddleWidth();
    if (key === 'calm') for (const b of balls) { b.speed *= 0.92; rescale(b); }
  }

  function processQueue() {
    if (state !== 'play') return;
    if (queue.length) {
      const ev = queue.shift();
      state = 'choice';
      if (ev.type === 'level') showLevelChoice();
      else showSwapChoice(ev.id);
      return;
    }
    if (floorCleared) floorClear();
  }

  function resume() {
    hideOverlay();
    state = 'play';
    processQueue();
  }

  function showLevelChoice() {
    A.play('levelUp', { vol: 0.7, wet: 0.6 });
    const pool = Object.keys(PERKS).filter((k) => k !== 'ball');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    // 「ボール +1」は出やすくする
    const picks = Math.random() < 0.7 && ballCount() < TUNE.maxBalls ? ['ball', ...pool.slice(0, 2)] : pool.slice(0, 3);
    showOverlay(`レベル ${run.lv}`, '今回の探索だけ有効な強化を1つ選ぶ', picks.map((k) => ({
      label: PERKS[k].name, sub: PERKS[k].desc, onClick: () => { applyPerk(k); resume(); },
    })));
  }

  function showSwapChoice(id) {
    const it = ITEMS[id];
    const cur = run.equip[it.slot];
    const ci = ITEMS[cur.id];
    A.play('equip', { vol: 0.6, wet: 0.5 });
    showOverlay('装備を発見', `${SLOT_NAME[it.slot]}枠：<b>${it.name}</b>（${it.desc}）<br>いまの装備：${ci.name} Lv${cur.lv}（${ci.desc}）`, [
      { label: `${it.name} に付け替える`, sub: it.desc, onClick: () => { equipItem(id, 1); resume(); } },
      { label: `${ci.name} のまま`, sub: '見つけた品は換金して +300点', onClick: () => { run.score += 300; resume(); } },
    ]);
  }

  function loseLife() {
    run.lives--;
    A.play('fall', { vol: 0.9, wet: 0.7 });
    shake(8, 0.25);
    if (run.lives <= 0) {
      state = 'over';
      const lost = run.found.map((s) => run.equip[s]).filter(Boolean).map((e) => ITEMS[e.id].name);
      setTimeout(() => {
        A.play('over', { vol: 0.9, wet: 0.6 });
        showOverlay('GAME OVER',
          `第${run.floor}層まで到達　スコア ${run.score}　財宝 ${run.treasures}<br>` +
          (lost.length ? `未確保の装備を失った：${lost.join('、')}` : '失った装備はない'),
          [{ label: 'もう一度潜る', onClick: newRun }, { label: '装備を見る', onClick: showTitle, quiet: true }]);
      }, 700);
    } else {
      serve();
    }
  }

  function floorClear() {
    state = 'clear';
    for (const b of balls) b.trail.length = 0;
    A.play('collapse', { vol: 0.9, wet: 0.6 });
    shake(6, 0.5);
    for (let i = 0; i < 6; i++) setTimeout(() => dust(30 + Math.random() * (W - 60), L.blocksTop + Math.random() * 140, 4, '#8a8178', 1.6), i * 90);
    // 階層突破で今回の装備を確保
    secured = clone(run.equip);
    save('equip', secured);
    const got = run.found.map((s) => run.equip[s]).filter(Boolean).map((e) => `${ITEMS[e.id].name} Lv${e.lv}`);
    run.found = [];
    setTimeout(() => showOverlay(`第${run.floor}層 突破`,
      `スコア ${run.score}　財宝 ${run.treasures}　Lv${run.lv}　残機 ${run.lives}<br>` +
      (got.length ? `装備を確保：${got.join('、')}` : '新しい装備はなし') +
      '<br>次の層は球が速く、硬い岩が増える',
      [{ label: '次の層へ', onClick: () => { run.floor++; startFloor(); } },
       { label: '帰還する', sub: '戦利品を持ち帰って終了', onClick: showTitle, quiet: true }]), 1100);
  }

  // ---------- 描画 ----------
  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050506';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let sx = 0, sy = 0;
    if (shakeT > 0) { sx = (Math.random() - 0.5) * 2 * shakeMag; sy = (Math.random() - 0.5) * 2 * shakeMag; }
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx * scale) * dpr, (offY + sy * scale) * dpr);

    ctx.drawImage(art.bg, 0, 0, W, H);
    drawBlocks();
    drawTreasureGlints(now);
    drawDust();
    drawPaddle();
    if (state !== 'title') drawBalls();
    drawChips();
    drawLight();
    drawFloaters();
    drawHint(now);
    drawHud();
  }

  function drawBlocks() {
    if (art.layerDirty) {
      const lc = art.layer.getContext('2d');
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.clearRect(0, 0, art.layer.width, art.layer.height);
      lc.setTransform(PS, 0, 0, PS, 0, 0);
      lc.shadowColor = 'rgba(0,0,0,0.75)';
      lc.shadowBlur = 5 * PS;
      lc.shadowOffsetX = 1.5 * PS;
      lc.shadowOffsetY = 3 * PS;
      for (const b of blocks) {
        if (!b.alive) continue;
        const dmg = Math.min(b.maxHp - 1, b.maxHp - b.hp);
        if (!b.tex || b.texDmg !== dmg) { b.tex = T.block(b.type, b.w, b.h, PS, b.seed, dmg); b.texDmg = dmg; }
        lc.drawImage(b.tex, b.x, b.y, b.w, b.h);
      }
      art.layerDirty = false;
    }
    ctx.drawImage(art.layer, 0, 0, W, H);
  }

  // 宝入りブロックがときどき光る
  function drawTreasureGlints(now) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blocks) {
      if (!b.alive || b.type !== 'T') continue;
      const ph = (now * 0.6 + (b.seed % 1000) / 1000) % 1;
      if (ph > 0.18) continue;
      const a = Math.sin(ph / 0.18 * Math.PI);
      const s = 12 * a;
      const gx = b.x + 6 + ((b.seed >> 3) % 26), gy = b.y + 4 + ((b.seed >> 5) % 9);
      ctx.globalAlpha = a;
      ctx.drawImage(art.glint, gx - s / 2, gy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawPaddle() {
    const w = Math.round(paddle.w);
    if (!art.paddle || art.paddleW !== w) { art.paddle = T.paddle(w, paddle.h, PS); art.paddleW = w; }
    const x = paddle.x - paddle.w / 2, y = paddle.y - paddle.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(paddle.x + 2, paddle.y + 7, paddle.w / 2, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(art.paddle, x, y, paddle.w, paddle.h);
  }

  function drawBalls() {
    const r = TUNE.ballRadius;
    for (const b of balls) {
      // 高速時のモーションブラー
      const t = b.trail;
      for (let i = 0; i < t.length; i += 2) {
        const a = (i + 2) / t.length;
        ctx.globalAlpha = a * 0.18;
        ctx.drawImage(art.ball, t[i] - r * a, t[i + 1] - r * a, r * 2 * a, r * 2 * a);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(b.x + 2.5, b.y + 4, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      const s = r * 2 + 2;
      ctx.drawImage(art.ball, b.x - s / 2, b.y - s / 2, s, s);
    }
  }

  function drawDust() {
    for (const p of particles) {
      if (p.kind !== 'dust') continue;
      const t = 1 - p.life / p.max;
      const rr = p.r0 + (p.r1 - p.r0) * Math.sqrt(Math.max(0, t));
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.8;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.drawImage(art.dust, -rr, -rr, rr * 2, rr * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawChips() {
    for (const p of particles) {
      if (p.kind !== 'chip') continue;
      ctx.globalAlpha = Math.min(1, p.life / 0.3);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      ctx.closePath();
      ctx.fill();
      // 光の当たる面だけ明るく（立体感）
      ctx.fillStyle = 'rgba(255,245,230,0.25)';
      ctx.beginPath();
      ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      ctx.lineTo(p.pts[1][0], p.pts[1][1]);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawLight() {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flashes) {
      const a = f.life / f.max;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, f.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    for (const s of sparks) {
      const a = s.life / s.max;
      ctx.strokeStyle = `rgba(255,${150 + a * 90 | 0},${60 + a * 110 | 0},${Math.min(1, a * 1.6)})`;
      ctx.lineWidth = 0.6 + a * 0.9;
      ctx.beginPath();
      ctx.moveTo(s.px - (s.x - s.px) * 1.5, s.py - (s.y - s.py) * 1.5);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    for (const p of particles) {
      if (p.kind !== 'glint') continue;
      const a = Math.sin(Math.min(1, p.life / p.max) * Math.PI);
      ctx.globalAlpha = a;
      ctx.drawImage(art.glint, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
      ctx.font = `${f.big ? 700 : 600} ${f.big ? 14 : 12}px -apple-system, "Hiragino Sans", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(f.text, f.x + 1, f.y + 1.2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawHint(now) {
    if (state !== 'play' || !balls.some((b) => b.stuck) || hintT < 0.4) return;
    ctx.globalAlpha = 0.55 + Math.sin(now * 4) * 0.25;
    ctx.fillStyle = '#d9d2c5';
    ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    const n = balls.length;
    ctx.fillText((input.active ? '指を離して発射' : 'ドラッグで移動・離して発射') + (n > 1 ? `（${n}球）` : ''), W / 2, paddle.y - 70);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const g = ctx.createLinearGradient(0, 0, 0, L.fieldTop);
    g.addColorStop(0, '#07070a');
    g.addColorStop(1, '#141210');
    ctx.fillStyle = g;
    ctx.fillRect(0, -40, W, L.fieldTop + 40);
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
    const y1 = L.hudTop + 14, y2 = L.hudTop + 38;
    const lives = run ? run.lives : TUNE.lives + equipTotal('lives', secured);
    // 残機（鋼球）
    const shown = Math.min(lives, 6);
    for (let i = 0; i < shown; i++) ctx.drawImage(art.ball, 10 + i * 13, y1 - 6, 12, 12);
    if (lives > 6) { ctx.fillStyle = '#d9d2c5'; ctx.textAlign = 'left'; ctx.fillText('+' + (lives - 6), 10 + 6 * 13 + 2, y1 + 1); }
    ctx.fillStyle = '#c9b89a';
    ctx.textAlign = 'center';
    ctx.fillText(run ? `第${run.floor}層` : '', W / 2 - 20, y1 + 1);
    ctx.fillStyle = '#e8e2d6';
    ctx.textAlign = 'right';
    ctx.fillText(String(run ? run.score : 0), L.btnSound.x - 10, y1 + 1);
    drawButton(L.btnSound, A.enabled ? '音' : '無音', A.enabled ? '#c9c1b2' : '#5e5750');

    if (!run) return;
    // レベルと経験値
    ctx.fillStyle = '#9fe0ff';
    ctx.textAlign = 'left';
    ctx.fillText(`Lv${run.lv}`, 10, y2 + 1);
    const bx = 44, bw = 110;
    ctx.fillStyle = '#1d1c1a';
    ctx.fillRect(bx, y2 - 3, bw, 6);
    ctx.fillStyle = '#6fb8d8';
    ctx.fillRect(bx, y2 - 3, bw * Math.min(1, run.xp / xpNeed(run.lv)), 6);
    // 球数と財宝
    ctx.drawImage(art.ball, 172, y2 - 6, 12, 12);
    ctx.fillStyle = '#e8e2d6';
    ctx.fillText('×' + ballCount(), 187, y2 + 1);
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath();
    const tx = 232;
    ctx.moveTo(tx, y2 - 6); ctx.lineTo(tx + 5, y2); ctx.lineTo(tx, y2 + 6); ctx.lineTo(tx - 5, y2);
    ctx.closePath(); ctx.fill();
    ctx.fillText(String(run.treasures), tx + 9, y2 + 1);
    // 装備数（未確保があれば表示）
    ctx.textAlign = 'right';
    ctx.font = '600 11px -apple-system, "Hiragino Sans", sans-serif';
    const eq = ['ball', 'paddle', 'support'].filter((s) => run.equip[s]).length;
    ctx.fillStyle = run.found.length ? '#ffb070' : '#9a9184';
    ctx.fillText(`装備${eq}` + (run.found.length ? `（未確保${run.found.length}）` : ''), W - 8, y2 + 1);
  }

  function drawButton(r, label, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
  }

  // ---------- オーバーレイ ----------
  function showOverlay(title, html, buttons) {
    ovTitle.textContent = title;
    ovText.innerHTML = html;
    ovButtons.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      if (b.quiet) el.className = 'quiet';
      el.innerHTML = `<span>${b.label}</span>` + (b.sub ? `<small>${b.sub}</small>` : '');
      el.addEventListener('click', () => { A.unlock(); b.onClick(); });
      ovButtons.appendChild(el);
    }
    overlay.classList.add('show');
  }
  function hideOverlay() { overlay.classList.remove('show'); }

  function equipList(equip) {
    return ['ball', 'paddle', 'support'].map((s) => {
      const e = equip[s];
      return `${SLOT_NAME[s]}：` + (e ? `${ITEMS[e.id].name} Lv${e.lv}（${ITEMS[e.id].desc}${e.lv > 1 ? ' ×' + e.lv : ''}）` : '—');
    }).join('<br>');
  }

  function showTitle() {
    state = 'title';
    run = null;
    balls.length = 0;
    buildStage(1);
    paddle.w = TUNE.paddleWidth;
    paddle.x = W / 2;
    const n = 1 + equipTotal('balls', secured);
    showOverlay('B.A.L.L.',
      '全ブロックを砕けば次の層へ。親指でドラッグしてパドルを動かし、指を離して発射。' +
      `<span class="eq">${equipList(secured)}</span>` +
      `発射できる球：${n}（レベルアップと装備で増える）`,
      [{ label: '探索開始', onClick: newRun },
       ...(Object.keys(secured).length ? [{ label: '装備をリセット', quiet: true, onClick: () => { secured = {}; save('equip', secured); showTitle(); } }] : [])]);
  }

  // ---------- ループ ----------
  let now = 0, last = performance.now(), acc = 0;
  const STEP = 1 / 120;
  function frame(t) {
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.1) dt = 0.1; // タブ復帰時の暴走防止
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; now += STEP; }
    draw(now);
    requestAnimationFrame(frame);
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  resize();
  showTitle();

  // 自動テスト・デバッグ用の窓口
  window.__ball = {
    get state() { return state; }, get balls() { return balls; }, get paddle() { return paddle; }, get blocks() { return blocks; },
    get run() { return run; }, get queue() { return queue; }, newRun, launch, TUNE, ITEMS, findItem, gainXp, ballCount,
  };

  requestAnimationFrame(frame);
})();
