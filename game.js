// B.A.L.L. — 試作：操作と破壊＋多球・レベルアップ・装備・落下アイテム
// 照明は WebGL（renderer.js）、破片やUIは上に重ねた Canvas 2D で描く。論理座標は幅 360 固定。
(() => {
  'use strict';
  const MT = window.BallMat, A = window.BallAudio;

  // ---------- 調整用パラメータ（試作値。実機で詰める） ----------
  const TUNE = {
    lives: 3,
    ballRadius: 5,
    ballSpeedStart: 330,     // 論理px/秒
    ballSpeedFloor: 12,      // 階層ごとの初速上昇
    bounceAccel: 1.022,      // 反射のたびに速度をこの割合で上げる
    ballSpeedMax: 720,
    maxBalls: 16,
    launchInterval: 0.32,    // 時間差発射の間隔（秒）
    autoLaunchAfter: 2.5,    // 発射待ちのまま放置した時に自動で撃ち始めるまで
    maxBounceDeg: 62,
    minVerticalDeg: 20,
    paddleWidth: 74,
    paddleHeight: 10,
    padRadius: 44,           // 仮想パッドの可動半径（論理px）
    padMaxSpeed: 780,        // パドル最高速
    padAccel: 11,            // パドルが目標速度へ追いつく速さ
    dragGain: 2.4,           // ドラッグ操作の移動量拡大率
    tiltLean: 0.16,          // 移動速度による傾き（ラジアン）
    tiltSpring: 140, tiltDamp: 13, tiltKick: 2.6,
    strikeEarly: 0.16,       // ジャスト判定：当たる何秒前までのタップを有効にするか
    strikeLate: 0.10,        // 当たった後何秒以内のタップを有効にするか
    powerSpeed: 1.35, powerPierce: 3,
    gravity: 380,            // 落下アイテム
    xpBase: 14, xpStep: 12,
  };

  // 素材ごとの性質
  const MATS = {
    dirt:     { name: '土',     hp: 1, score: 5,   xp: 1, snd: 'dirt',      chip: ['#5e4229', '#4a3420', '#7a5a3a'], dust: '#7a5c40' },
    rock:     { name: '岩',     hp: 1, score: 10,  xp: 1, snd: 'rockBreak', chip: ['#7d756c', '#5f5953', '#9b928a'], dust: '#8a8178' },
    brick:    { name: 'レンガ', hp: 2, score: 20,  xp: 2, snd: 'brick',     hit: 'rockChip', chip: ['#8a3a24', '#6d2c1c', '#a5583c'], dust: '#9a6a58' },
    wood:     { name: '木材',   hp: 2, score: 15,  xp: 2, snd: 'woodBreak', hit: 'wood', chip: ['#8a6038', '#6a4626', '#a87a4a'], dust: '#806a50', splinter: true },
    glass:    { name: 'ガラス', hp: 1, score: 15,  xp: 1, snd: 'glass',     shards: '#cfe8ee' },
    ice:      { name: '氷',     hp: 2, score: 20,  xp: 2, snd: 'ice',       hit: 'glassTick', shards: '#e2f4ff', dust: '#dfefff' },
    marble:   { name: '大理石', hp: 3, score: 40,  xp: 3, snd: 'marble',    hit: 'marble', chip: ['#e6e2da', '#cfcac2', '#a8a49e'], dust: '#e0dcd4' },
    steel:    { name: '鉄板',   hp: 3, score: 50,  xp: 3, snd: 'metalBreak', hit: 'metalHit', chip: ['#5c626c', '#7d8591', '#8a4c2a'], dust: '#6f6a66', sparks: true },
    obsidian: { name: '黒曜石', hp: 5, score: 80,  xp: 5, snd: 'obsidian',  hit: 'obsidian', shards: '#2a2433', chip: ['#141018', '#2a2433', '#3c3448'] },
    crystal:  { name: '水晶',   hp: 2, score: 60,  xp: 6, snd: 'crystal',   hit: 'glassTick', shards: '#9fe8ff', light: true },
    coal:     { name: '石炭',   hp: 1, score: 10,  xp: 1, snd: 'dirt',      chip: ['#1c1c1c', '#2c2a28', '#0e0e0e'], dust: '#3a3836', embers: true },
    copper:   { name: '銅鉱',   hp: 2, score: 30,  xp: 2, snd: 'rockBreak', hit: 'rockChip', chip: ['#6d655c', '#3e8a64', '#c06a3a'], dust: '#7a7068', drop: { coin: [1, 2] } },
    gold:     { name: '金鉱',   hp: 2, score: 100, xp: 4, snd: 'coins',     hit: 'treasureCrack', chip: ['#6d5140', '#e0a83c', '#8a6a4a'], dust: '#8a6f55', drop: { coin: [3, 5], gem: 0.6, relic: 0.25 } },
    chest:    { name: '宝箱',   hp: 3, score: 150, xp: 5, snd: 'woodBreak', hit: 'wood', chip: ['#7a5230', '#4a4440', '#c89a40'], dust: '#806a50', splinter: true, drop: { coin: [4, 6], gem: 0.5, relic: 1 } },
    tnt:      { name: '爆薬樽', hp: 1, score: 20,  xp: 2, snd: 'boom',      chip: ['#8a2a1c', '#3c3836', '#c84a2a'], dust: '#5a504a', explode: 48 },
  };
  const LEGEND = { d: 'dirt', r: 'rock', b: 'brick', w: 'wood', g: 'glass', i: 'ice', m: 'marble', s: 'steel', o: 'obsidian', c: 'crystal', k: 'coal', p: 'copper', t: 'gold', x: 'chest', e: 'tnt' };

  // 面：10列。大文字は同じ文字の矩形をまとめて大きなブロックにする（最大3×3）
  // light: 環境光、ランタン、松明、追加の光源
  const STAGES = [
    { name: '坑道の入口', desc: '柔らかい土と岩。石炭の層に気をつけて',
      light: { amb: [0.07, 0.065, 0.06], lantern: [1, 0.78, 0.5, 1.9], torch: [1, 0.55, 0.25, 1.3] },
      map: ['dddddddddd', 'dRRddkdRRd', 'dRRdtpdRRd', 'kddddddddk', 'rrrrDDrrrr', 'rprr..rrpr', 'r.rk..kr.r'] },
    { name: '煉瓦の地下水路', desc: '古いレンガのアーチ。ガラスの採光窓の奥に財宝',
      light: { amb: [0.05, 0.07, 0.07], lantern: [0.8, 0.9, 1, 1.4], torch: [1, 0.6, 0.3, 1.2] },
      map: ['BBbbbbbbBB', 'BBbbBBbbBB', 'bb..BB..bb', 'b...bb...b', 'b.gggggg.b', 'bpbbttbbpb', 'BB......BB', 'BB......BB'] },
    { name: '崩れた倉庫', desc: '木箱の山と爆薬樽。誘爆させれば一気に崩れる',
      light: { amb: [0.06, 0.055, 0.05], lantern: [1, 0.75, 0.45, 1.8], torch: [1, 0.5, 0.2, 1.2] },
      map: ['WWwwWWwwWW', 'WWwwWWwwWW', 'wweewwweew', 'wwXXwwXXww', '.WW.ee.WW.', '.WW.ww.WW.', 'wwwwwwwwww'] },
    { name: '氷の洞', desc: '凍りついた空洞。氷とガラスの奥に宝が眠る',
      light: { amb: [0.06, 0.08, 0.11], lantern: [0.7, 0.85, 1, 1.6], torch: [0.6, 0.8, 1, 1.0] },
      map: ['iiIIiiIIii', 'igIIggIIgi', 'iggtiitggi', 'IIiiggiiII', 'IIggggggII', 'i.i.ii.i.i', 'gggg..gggg'] },
    { name: '大理石の神殿', desc: '柱の奥の祭壇。柱を崩して宝箱へ道を通す',
      light: { amb: [0.08, 0.075, 0.07], lantern: [1, 0.85, 0.6, 2.0], torch: [1, 0.65, 0.3, 1.3] },
      map: ['mmmmmmmmmm', 'MMMMMMMMMM', '.M.MttM.M.', '.M.M..M.M.', '.M.MXXM.M.', 'mmmmmmmmmm'] },
    { name: '水晶の鉱脈', desc: '光る水晶が唯一の明かり。黒曜石は硬い',
      light: { amb: [0.03, 0.03, 0.045], lantern: [0.5, 0.6, 1, 0.6], torch: [0.4, 0.5, 1, 0.4] },
      map: ['rrrrrrrrrr', 'rcrroorrcr', 'roocrrcoor', 'rrcoOOocrr', 'orroOOorro', 'rcrrttrrcr', 'oo.rrrr.oo'] },
    { name: '溶岩の縁', desc: '足元の溶岩が赤く照らす。石炭と黒曜石の地層',
      light: { amb: [0.06, 0.03, 0.02], lantern: [1, 0.6, 0.35, 1.3], torch: [1, 0.45, 0.15, 1.3], extra: { y: 0.99, z: 46, c: [1, 0.35, 0.08], i: 4, rad: 340 } },
      map: ['kkkkkkkkkk', 'kOOkkkkOOk', 'kOOkttkOOk', 'kkookkookk', 'oKKKoKKKoo', 'okkkokkkoo', 'k.k.kk.k.k'] },
    { name: '金庫室', desc: '鉄の壁に守られた金。宝箱は奥の奥',
      light: { amb: [0.05, 0.06, 0.07], lantern: [0.9, 0.95, 1, 1.8], torch: [1, 0.7, 0.4, 1.0] },
      map: ['SSSsssSSSs', 'SSSsssSSSs', 'sttsXXstts', 'sttsXXstts', 'ssmmssmmss', 's.mm..mm.s', 'mmmmmmmmmm'] },
    { name: '爆破区画', desc: '爆薬樽が連なる。一発で連鎖させろ',
      light: { amb: [0.07, 0.06, 0.05], lantern: [1, 0.8, 0.5, 1.6], torch: [1, 0.5, 0.2, 1.4] },
      map: ['rrbbrrbbrr', 'reebeeberr', 'rbbebbebbr', 'BBrreerrBB', 'BBrprrprBB', 'rrrreerrrr', 'b.b.bb.b.b'] },
    { name: '宝物庫', desc: '黒曜石とガラスに守られた財宝の山',
      light: { amb: [0.07, 0.06, 0.045], lantern: [1, 0.82, 0.5, 2.2], torch: [1, 0.6, 0.25, 1.4] },
      map: ['oooooooooo', 'ogggggggoo', 'ogXXttXXgo', 'ogttXXttgo', 'oggggggggo', 'mmmmmmmmmm', 'MMM....MMM'] },
  ];

  const ITEMS = {
    twin:    { slot: 'ball',    name: '双子の鉄球', desc: 'ボール +1', balls: 1 },
    heavy:   { slot: 'ball',    name: '重鉄球',     desc: '威力 +1',   power: 1 },
    haft:    { slot: 'paddle',  name: '鉱夫の長柄', desc: 'パドル幅 +12%', width: 0.12 },
    bulwark: { slot: 'paddle',  name: '防壁の板',   desc: '残機 +1',   lives: 1 },
    charm:   { slot: 'support', name: '分裂の護符', desc: 'ボール +1', balls: 1 },
    lantern: { slot: 'support', name: '鉱夫のランタン', desc: '財宝の得点 +50%', gold: 0.5 },
    magnet:  { slot: 'support', name: '磁石の籠手', desc: '落下物を引き寄せる', magnet: 1 },
  };
  const SLOT_NAME = { ball: 'ボール', paddle: 'パドル', support: '補助' };
  const PERKS = {
    ball:   { name: 'ボール +1', desc: '発射できる球が1つ増える' },
    width:  { name: 'パドル拡張', desc: 'パドル幅 +10%' },
    power:  { name: '威力 +1', desc: '硬いブロックを少ない命中で砕く' },
    life:   { name: '残機 +1', desc: '全球を落としても1回耐える' },
    pierce: { name: '貫通 +1', desc: 'ジャスト打ち返しの貫通数 +1' },
    calm:   { name: '球速 −8%', desc: '球が読みやすくなる' },
  };

  const W = 360, WALL = 7;
  const COLS = 10, GAP = 2, MARGIN = 12, CH = 15;
  const CW = (W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const BALL_Z = 10, PADDLE_Z = 8;

  // ---------- 画面 ----------
  const glCanvas = document.getElementById('gl');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const ovTitle = document.getElementById('ov-title');
  const ovText = document.getElementById('ov-text');
  const ovButtons = document.getElementById('ov-buttons');

  let R = null;
  try { R = window.BallGL.create(glCanvas); } catch (e) { console.error(e); }

  let H = 640, scale = 1, offX = 0, offY = 0, dpr = 1, PS = 1, SPS = 1;
  const L = {};
  const art = { bg: null, scene: null, sprites: {}, dust: null, glint: null, flame: null, dirty: [], shadowDirty: true, lastShadow: 0, paddleW: 0 };

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
    SPS = Math.min(2.6, PS);             // 照明計算用の解像度（重さとのバランス）
    const glDpr = Math.min(dpr, 2.2);
    if (R) R.resize(Math.round(vw * glDpr), Math.round(vh * glDpr), W, H, scale * glDpr, offX * glDpr, offY * glDpr);
    const [st, sb] = readSafeArea();
    const safeTop = Math.max(0, st / scale - offY / scale);
    const safeBottom = Math.max(0, sb / scale - offY / scale);

    L.hudTop = safeTop + 4;
    L.hudH = 50;
    L.fieldTop = L.hudTop + L.hudH + 2;
    L.ceil = L.fieldTop + WALL;
    L.fieldBottom = H - safeBottom;
    L.blocksTop = L.ceil + 44;
    L.paddleY = L.fieldBottom - Math.max(84, (L.fieldBottom - L.fieldTop) * 0.15);
    L.btnSound = { x: W - 44, y: L.hudTop + 2, w: 38, h: 24 };
    L.btnCtrl = { x: W - 120, y: L.hudTop + 2, w: 70, h: 24 };
    L.lantern = { x: W / 2, y: L.ceil + 16 };
    L.torches = [{ x: WALL + 8, y: L.fieldTop + (L.fieldBottom - L.fieldTop) * 0.46 }, { x: W - WALL - 8, y: L.fieldTop + (L.fieldBottom - L.fieldTop) * 0.64 }];
    for (const b of blocks) placeBlock(b);
    paddle.y = L.paddleY;
    bakeArt();
  }

  function bakeArt() {
    const fixtures = [{ kind: 'lantern', x: L.lantern.x, y: L.lantern.y }, ...L.torches.map((t) => ({ kind: 'torch', x: t.x, y: t.y + 4 }))];
    art.bg = MT.cave(W, H, Math.min(SPS, 1.5), L.fieldTop, WALL, fixtures);
    art.scene = {};
    for (const k of ['alb', 'nrm', 'mat']) {
      const c = document.createElement('canvas');
      c.width = Math.round(W * SPS); c.height = Math.round(H * SPS);
      art.scene[k] = c;
    }
    for (const b of blocks) b.maps = null;
    composeAll();
    if (R) {
      for (const k in art.sprites) R.freeSprite(art.sprites[k]);
      art.sprites = {
        ball: R.sprite(MT.ball(TUNE.ballRadius, PS)),
        coin: R.sprite(MT.coin(PS)),
        gemR: R.sprite(MT.gem(PS, 'red')), gemB: R.sprite(MT.gem(PS, 'blue')), gemG: R.sprite(MT.gem(PS, 'green')),
        relic: R.sprite(MT.relic(PS)),
      };
      art.paddleW = 0;
    }
    art.dust = MT.dust(PS);
    art.glint = MT.glint(PS);
    art.flame = MT.flame(PS);
  }

  // 背景とブロックを1枚のマップに合成して GPU へ送る
  function composeRegion(x, y, w, h) {
    const px = Math.max(0, Math.floor(x * SPS)), py = Math.max(0, Math.floor(y * SPS));
    const pw = Math.min(art.scene.alb.width - px, Math.ceil((x + w) * SPS) - px), ph = Math.min(art.scene.alb.height - py, Math.ceil((y + h) * SPS) - py);
    if (pw <= 0 || ph <= 0) return null;
    for (const k of ['alb', 'nrm', 'mat']) {
      const c2 = art.scene[k].getContext('2d');
      c2.save();
      c2.beginPath(); c2.rect(px, py, pw, ph); c2.clip();
      c2.drawImage(art.bg[k], 0, 0, art.scene[k].width, art.scene[k].height);
      for (const b of blocks) {
        if (!b.alive || b.x > x + w || b.x + b.w < x || b.y > y + h || b.y + b.h < y) continue;
        ensureMaps(b);
        c2.drawImage(b.maps[k], b.x * SPS, b.y * SPS, b.w * SPS, b.h * SPS);
      }
      c2.restore();
    }
    return [px, py, pw, ph];
  }
  function composeAll() {
    composeRegion(0, 0, W, H);
    if (R) { R.setScene(art.scene.alb, art.scene.nrm, art.scene.mat); art.shadowDirty = true; }
  }
  const sliceCv = { alb: document.createElement('canvas'), nrm: document.createElement('canvas'), mat: document.createElement('canvas') };
  function flushDirty() {
    if (!art.dirty.length) return;
    // 近い矩形はまとめる
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of art.dirty) { x0 = Math.min(x0, d[0]); y0 = Math.min(y0, d[1]); x1 = Math.max(x1, d[0] + d[2]); y1 = Math.max(y1, d[1] + d[3]); }
    art.dirty.length = 0;
    const r = composeRegion(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    if (!r || !R) return;
    const [px, py, pw, ph] = r;
    for (const k of ['alb', 'nrm', 'mat']) {
      const c = sliceCv[k];
      c.width = pw; c.height = ph;
      c.getContext('2d').drawImage(art.scene[k], px, py, pw, ph, 0, 0, pw, ph);
    }
    R.updateScene(px, py, sliceCv.alb, sliceCv.nrm, sliceCv.mat);
    art.shadowDirty = true;
  }
  function markDirty(b) { art.dirty.push([b.x, b.y, b.w, b.h]); }

  function ensureMaps(b) {
    const lvl = damageLevel(b);
    if (!b.maps || b.mapLvl !== lvl) { b.maps = MT.block(b.mat, b.w, b.h, SPS, b.seed, lvl); b.mapLvl = lvl; }
  }
  const damageLevel = (b) => b.maxHp <= 1 ? 0 : Math.min(3, Math.ceil((1 - b.hp / b.maxHp) * 3));

  function placeBlock(b) {
    b.x = MARGIN + b.col * (CW + GAP);
    b.y = L.blocksTop + b.row * (CH + GAP);
    b.w = b.cw * CW + (b.cw - 1) * GAP;
    b.h = b.ch * CH + (b.ch - 1) * GAP;
  }

  // ---------- 保存 ----------
  function load(key, def) { try { const v = localStorage.getItem('ball.' + key); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
  function save(key, v) { try { localStorage.setItem('ball.' + key, JSON.stringify(v)); } catch (e) { /* 保存不可でも動く */ } }

  // ---------- 状態 ----------
  let state = 'title';            // title / play / choice / clear / over
  let secured = load('equip', {});
  let ctrlMode = load('ctrl', 'pad'); // pad / drag
  let run = null;
  let blocks = [];
  const balls = [], drops = [];
  const paddle = { x: W / 2, y: 560, w: TUNE.paddleWidth, h: TUNE.paddleHeight, vx: 0, tilt: 0, tiltV: 0, targetX: null };
  const particles = [], sparks = [], flashes = [], floaters = [], rings = [];
  const queue = [];
  let shakeT = 0, shakeMag = 0, floorCleared = false, now = 0;
  let launchTimer = 0, serveT = 0, lastStrike = -9;
  A.enabled = load('sound', true);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const stageDef = () => STAGES[(run ? run.floor - 1 : 0) % STAGES.length];

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
    const def = STAGES[(floor - 1) % STAGES.length];
    const cycle = Math.floor((floor - 1) / STAGES.length);
    const grid = def.map.map((r) => [...r.padEnd(COLS, '.')]);
    const used = grid.map((r) => r.map(() => false));
    let id = 0;
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < COLS; c++) {
      const ch = grid[r][c];
      if (used[r][c] || ch === '.') continue;
      const mat = LEGEND[ch.toLowerCase()];
      if (!mat) continue;
      let cw = 1, chh = 1;
      if (ch !== ch.toLowerCase()) {
        while (c + cw < COLS && cw < 3 && grid[r][c + cw] === ch && !used[r][c + cw]) cw++;
        while (r + chh < grid.length && chh < 3 && grid[r + chh].slice(c, c + cw).every((x, i) => x === ch && !used[r + chh][c + i])) chh++;
      }
      for (let y = r; y < r + chh; y++) for (let x = c; x < c + cw; x++) used[y][x] = true;
      const m = MATS[mat];
      const hp = m.hp + Math.floor((cw * chh - 1) / 2) + cycle;
      const b = { id: id++, mat, hp, maxHp: hp, row: r, col: c, cw, ch: chh, alive: true, seed: (MT.hash(r, c, floor * 97 + mat.length) * 1e6) | 0, maps: null, mapLvl: -1, hue: MT.hash(c, r, 5) };
      placeBlock(b);
      blocks.push(b);
    }
    if (art.scene) composeAll();
  }

  function newRun() {
    run = {
      floor: 1, score: 0, treasures: 0, lv: 1, xp: 0, bestCombo: 0,
      perk: { ball: 0, width: 0, power: 0, calm: 0, pierce: 0 },
      equip: clone(secured), found: [],
      lives: TUNE.lives + equipTotal('lives', secured),
    };
    particles.length = sparks.length = flashes.length = floaters.length = queue.length = drops.length = rings.length = 0;
    startFloor();
  }

  function startFloor() {
    floorCleared = false;
    drops.length = 0;
    buildStage(run.floor);
    paddle.x = W / 2; paddle.vx = 0; paddle.tilt = 0; paddle.tiltV = 0;
    updatePaddleWidth();
    serve();
    state = 'play';
    const def = stageDef();
    showOverlay(`第${run.floor}層　${def.name}`, def.desc, [{ label: '潜る', onClick: () => { hideOverlay(); } }]);
    state = 'play';
  }

  function updatePaddleWidth() { paddle.w = paddleWidth(); movePaddleTo(paddle.x); }
  const baseSpeed = () => (TUNE.ballSpeedStart + TUNE.ballSpeedFloor * (run.floor - 1)) * Math.pow(0.92, run.perk.calm);

  // 発射待ちの球をパドルの上に並べる（1球ずつ撃ち出す）
  function serve() {
    balls.length = 0;
    const n = ballCount();
    for (let i = 0; i < n; i++) balls.push(newBall(true));
    launchTimer = 0; serveT = 0;
  }
  function newBall(stuck) {
    return { x: paddle.x, y: paddle.y - 12, vx: 0, vy: 0, speed: baseSpeed(), stuck, queued: false, trail: [], combo: 0, power: false, pierce: 0, lastBlock: -1, lastPaddle: -9 };
  }
  function stickBalls() {
    const stuck = balls.filter((b) => b.stuck);
    const c = Math.cos(paddle.tilt), s = Math.sin(paddle.tilt);
    stuck.forEach((b, i) => {
      // 1球目はパドル中央、残りは右側に順番待ちで並ぶ
      const lx = i === 0 ? 0 : Math.min(paddle.w / 2 - 6, i * 9);
      const ly = -paddle.h / 2 - TUNE.ballRadius - 1 - (i === 0 ? 0 : 1);
      b.x = paddle.x + lx * c - ly * s; b.y = paddle.y + lx * s + ly * c;
    });
  }

  // 1球だけ発射する
  function launchOne() {
    if (state !== 'play') return false;
    const b = balls.find((x) => x.stuck);
    if (!b) return false;
    const a = paddle.tilt * 1.4 + Math.max(-1, Math.min(1, paddle.vx / TUNE.padMaxSpeed)) * 0.3 + (Math.random() - 0.5) * 0.12;
    b.stuck = false;
    b.x = paddle.x + Math.sin(paddle.tilt) * 0; b.y = paddle.y - paddle.h / 2 - TUNE.ballRadius - 1;
    setVel(b, a);
    A.play('launch', { vol: 0.7, pan: panOf(b.x), gap: 0.02 });
    flash(b.x, b.y, 24, 'rgba(255,230,190,0.5)', 0.1);
    launchTimer = TUNE.launchInterval;
    return true;
  }
  function setVel(b, ang) {
    const s = b.speed * (b.power ? TUNE.powerSpeed : 1);
    b.vx = Math.sin(ang) * s; b.vy = -Math.cos(ang) * s;
  }
  function addBalls(n) {
    for (let i = 0; i < n && balls.length < TUNE.maxBalls; i++) balls.push(newBall(true));
    launchTimer = Math.min(launchTimer, 0.15);
  }

  // ---------- 入力 ----------
  const input = { id: null, active: false, anchorX: 0, anchorY: 0, x: 0, y: 0, lastX: 0 };
  const keys = { left: false, right: false };
  let mouseX = null;
  function toLogical(e) { return [(e.clientX - offX) / scale, (e.clientY - offY) / scale]; }
  function inRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    A.unlock();
    const [x, y] = toLogical(e);
    if (inRect(x, y, L.btnSound)) { A.enabled = !A.enabled; save('sound', A.enabled); return; }
    if (inRect(x, y, L.btnCtrl)) { ctrlMode = ctrlMode === 'pad' ? 'drag' : 'pad'; save('ctrl', ctrlMode); addFloater(W / 2, L.fieldTop + 20, ctrlMode === 'pad' ? '操作：仮想パッド' : '操作：ドラッグ', '#9fe0ff', 1.2); return; }
    strike();                       // 指を置いた瞬間＝打ち返し・発射のタイミング
    if (input.active) return;
    input.active = true; input.id = e.pointerId;
    input.anchorX = input.x = input.lastX = x; input.anchorY = input.y = y;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 未対応でも動く */ }
  }, { passive: false });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toLogical(e);
    if (e.pointerType === 'mouse' && !input.active) { mouseX = x; return; }
    if (!input.active || e.pointerId !== input.id) return;
    e.preventDefault();
    if (ctrlMode === 'drag' && state === 'play') movePaddleTo(paddle.x + (x - input.lastX) * TUNE.dragGain);
    input.lastX = x; input.x = x; input.y = y;
  }, { passive: false });
  function endPointer(e) {
    if (!input.active || e.pointerId !== input.id) return;
    input.active = false; input.id = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keys.left = true;
    else if (e.key === 'ArrowRight') keys.right = true;
    else if (e.key === ' ') { A.unlock(); strike(); }
    else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') keys.left = false; if (e.key === 'ArrowRight') keys.right = false; });
  document.addEventListener('touchmove', (e) => { if (!(e.target.closest && e.target.closest('#overlay'))) e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());

  // タップ：発射待ちなら1球撃つ。直後に当たった球／これから当たる球はジャスト打ち返し
  function strike() {
    if (state !== 'play') return;
    lastStrike = now;
    if (launchOne()) return;
    for (const b of balls) if (!b.stuck && !b.power && now - b.lastPaddle <= TUNE.strikeLate) empower(b);
  }

  function movePaddleTo(x) {
    const half = paddle.w / 2;
    paddle.x = Math.max(WALL + half, Math.min(W - WALL - half, x));
  }

  // ---------- 演出 ----------
  function debris(x, y, colors, n, speed, sizeMul = 1, kind = 'chip') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.25 + Math.random() * 0.75);
      const r = (0.7 + Math.random() * 1.6) * sizeMul;
      const pts = [];
      const k = kind === 'shard' ? 3 : 3 + (Math.random() * 3 | 0);
      for (let j = 0; j < k; j++) { const t = j / k * Math.PI * 2 + Math.random() * 0.8; const rr = r * (kind === 'shard' ? (j === 0 ? 2.2 : 0.7) : 0.6 + Math.random() * 0.6); pts.push([Math.cos(t) * rr, Math.sin(t) * rr]); }
      if (kind === 'splinter') { pts.length = 0; const l = r * 2.5; pts.push([-l, -0.4], [l, -0.2], [l, 0.4], [-l, 0.3]); }
      particles.push({ kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: 0.9 + Math.random() * 0.6, max: 1.5, color: colors[i % colors.length], pts, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20, grav: 900 });
    }
  }
  function dust(x, y, n, color = '#8a8178', size = 1) {
    for (let i = 0; i < n; i++) particles.push({ kind: 'dust', x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 40, vy: -10 - Math.random() * 25, life: 0.7 + Math.random() * 0.6, max: 1.3, r0: 5 * size, r1: (14 + Math.random() * 12) * size, grav: -8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 1.5, color });
  }
  function sparkBurst(x, y, n, speed = 320, hot = false) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.9);
      sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: (hot ? 0.4 : 0.18) + Math.random() * 0.3, max: hot ? 0.7 : 0.48 });
    }
  }
  function glints(x, y, n, spread = 16) {
    for (let i = 0; i < n; i++) particles.push({ kind: 'glint', x: x + (Math.random() - 0.5) * spread, y: y + (Math.random() - 0.5) * spread * 0.6, vx: (Math.random() - 0.5) * 80, vy: -30 - Math.random() * 90, life: 0.5 + Math.random() * 0.6, max: 1.1, size: 7 + Math.random() * 7, grav: 120, rot: 0, vr: 0 });
  }
  // 2Dの光の滲み＋実際に周りを照らす点光源
  function flash(x, y, r, color, life = 0.12, light = null) {
    flashes.push({ x, y, r, color, life, max: life, light });
  }
  function addFloater(x, y, text, color, life = 0.9, big = false) { floaters.push({ x, y, text, color, life, max: life, big }); }
  function shake(mag, t) { shakeMag = Math.max(shakeMag, mag); shakeT = Math.max(shakeT, t); }
  function panOf(x) { return (x / W) * 1.6 - 0.8; }

  // ---------- 更新 ----------
  function update(dt) {
    now += dt;
    if (state === 'play') updatePaddle(dt);
    else { paddle.vx *= 0.9; }
    paddle.tiltV += ((paddle.vx / TUNE.padMaxSpeed) * TUNE.tiltLean - paddle.tilt) * TUNE.tiltSpring * dt - paddle.tiltV * TUNE.tiltDamp * dt;
    paddle.tilt = Math.max(-0.35, Math.min(0.35, paddle.tilt + paddle.tiltV * dt));

    if (state === 'play' && !overlay.classList.contains('show')) {
      stickBalls();
      const stuck = balls.some((b) => b.stuck);
      const flying = balls.some((b) => !b.stuck);
      if (stuck) {
        serveT += dt;
        // 1球目を撃った後は時間差で次々に、放置しても一定時間で自動発射
        if (flying || serveT > TUNE.autoLaunchAfter) { launchTimer -= dt; if (launchTimer <= 0) launchOne(); }
      }
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.stuck) continue;
        if (stepBall(b, dt)) { balls.splice(i, 1); dust(b.x, L.fieldBottom - 4, 2, '#555', 0.6); }
      }
      updateDrops(dt);
      if (!balls.length && !floorCleared) loseLife();
      processQueue();
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      if (p.kind === 'dust') { p.vx *= 0.97; p.vy *= 0.97; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.px = s.x; s.py = s.y; s.vy += 700 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
    }
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt; if (flashes[i].life <= 0) flashes.splice(i, 1); }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].life -= dt; if (rings[i].life <= 0) rings.splice(i, 1); }
    for (let i = floaters.length - 1; i >= 0; i--) { const f = floaters[i]; f.life -= dt; f.y -= 24 * dt; if (f.life <= 0) floaters.splice(i, 1); }
    shakeT = Math.max(0, shakeT - dt);
    if (shakeT === 0) shakeMag = 0;
  }

  function updatePaddle(dt) {
    const prevX = paddle.x;
    let target = 0;
    if (input.active && ctrlMode === 'pad') {
      const d = Math.max(-TUNE.padRadius, Math.min(TUNE.padRadius, input.x - input.anchorX));
      const f = d / TUNE.padRadius;
      target = Math.sign(f) * Math.pow(Math.abs(f), 1.25) * TUNE.padMaxSpeed;
    }
    if (keys.left) target = -TUNE.padMaxSpeed * 0.7;
    if (keys.right) target = TUNE.padMaxSpeed * 0.7;
    if (ctrlMode === 'pad' || keys.left || keys.right) {
      // 慣性：目標速度へ徐々に近づく
      paddle.vx += (target - paddle.vx) * Math.min(1, dt * TUNE.padAccel);
      movePaddleTo(paddle.x + paddle.vx * dt);
      if (paddle.x === prevX) paddle.vx *= 0.5; // 壁に当たったら止まる
    }
    if (mouseX !== null) movePaddleTo(mouseX);
    if (ctrlMode === 'drag' || mouseX !== null) paddle.vx = paddle.vx * 0.7 + ((paddle.x - prevX) / dt) * 0.3;
  }

  function stepBall(b, dt) {
    const sp = Math.hypot(b.vx, b.vy);
    const steps = Math.max(1, Math.ceil(sp * dt / (TUNE.ballRadius * 0.6)));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * h; b.y += b.vy * h;
      if (collideWalls(b)) continue;
      if (collidePaddle(b)) continue;
      collideBlocks(b);
      if (b.y - TUNE.ballRadius > L.fieldBottom + 10) return true;
    }
    b.trail.push(b.x, b.y);
    if (b.trail.length > (b.power ? 20 : 12)) b.trail.splice(0, 2);
    return false;
  }

  function accel(b) {
    b.speed = Math.min(TUNE.ballSpeedMax, b.speed * TUNE.bounceAccel);
    rescaleVel(b);
  }
  function rescaleVel(b) {
    const m = Math.hypot(b.vx, b.vy) || 1, s = b.speed * (b.power ? TUNE.powerSpeed : 1);
    b.vx = b.vx / m * s; b.vy = b.vy / m * s;
  }

  function collideWalls(b) {
    const r = TUNE.ballRadius;
    let hit = false;
    if (b.x - r < WALL) { b.x = WALL + r; b.vx = Math.abs(b.vx); hit = true; }
    else if (b.x + r > W - WALL) { b.x = W - WALL - r; b.vx = -Math.abs(b.vx); hit = true; }
    if (b.y - r < L.ceil) { b.y = L.ceil + r; b.vy = Math.abs(b.vy); hit = true; }
    if (hit) {
      enforceAngle(b); accel(b);
      A.play('wood', { vol: 0.4, pan: panOf(b.x), gap: 0.04 });
      dust(b.x, b.y, 1, '#6b5a48', 0.5);
    }
    return hit;
  }

  function collidePaddle(b) {
    if (b.vy <= 0) return false;
    const r = TUNE.ballRadius;
    // パドルの傾きに合わせた座標で判定
    const c = Math.cos(-paddle.tilt), s = Math.sin(-paddle.tilt);
    const dx = b.x - paddle.x, dy = b.y - paddle.y;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    const half = paddle.w / 2;
    if (ly + r < -paddle.h / 2 || ly - r > paddle.h / 2) return false;
    if (lx < -half - r || lx > half + r) return false;
    const offset = Math.max(-1, Math.min(1, lx / half));
    // 当てた位置＋パドルの傾きで反射角が決まる
    const ang = Math.max(-1.25, Math.min(1.25, offset * TUNE.maxBounceDeg * Math.PI / 180 + paddle.tilt * 1.2));
    b.power = false; b.pierce = 0;
    b.lastPaddle = now;
    b.combo = 0;
    b.lastBlock = -1;
    accel(b);
    // ジャスト判定（当たる直前にタップしていた）
    if (now - lastStrike <= TUNE.strikeEarly) { b.power = true; empowerFx(b); }
    setVel(b, ang);
    const ty = -paddle.h / 2 - r - 0.5;
    b.x = paddle.x + lx * Math.cos(paddle.tilt) - ty * Math.sin(paddle.tilt);
    b.y = paddle.y + lx * Math.sin(paddle.tilt) + ty * Math.cos(paddle.tilt);
    paddle.tiltV += offset * TUNE.tiltKick;     // 当たった側が沈む
    if (!b.power) {
      A.play('paddle', { vol: 0.75, pan: panOf(b.x), rate: 1 + Math.abs(offset) * 0.06, gap: 0.035 });
      sparkBurst(b.x, b.y + r, 3, 160);
      flash(b.x, b.y + r, 22, 'rgba(255,230,190,0.5)', 0.08);
    }
    return true;
  }

  function empower(b) {
    b.power = true;
    rescaleVel(b);
    empowerFx(b);
  }
  function empowerFx(b) {
    b.pierce = TUNE.powerPierce + run.perk.pierce + power();
    A.play('power', { vol: 1, pan: panOf(b.x), wet: 0.5 });
    rings.push({ x: b.x, y: b.y, life: 0.45, max: 0.45, r: 60 });
    flash(b.x, b.y, 70, 'rgba(255,190,110,0.9)', 0.25, { r: 1, g: 0.7, b: 0.4, i: 3, rad: 120 });
    sparkBurst(b.x, b.y, 18, 420, true);
    shake(4, 0.12);
    addFloater(b.x, b.y - 18, 'ジャスト！', '#ffcf7a', 0.8, true);
  }

  function collideBlocks(ball) {
    const r = TUNE.ballRadius;
    for (const b of blocks) {
      if (!b.alive || b.id === ball.lastBlock && ball.power) continue;
      const cx = Math.max(b.x, Math.min(ball.x, b.x + b.w)), cy = Math.max(b.y, Math.min(ball.y, b.y + b.h));
      const dx = ball.x - cx, dy = ball.y - cy;
      if (dx * dx + dy * dy > r * r) continue;
      // 貫通中は壊せる限り止まらずに突き抜ける
      let hit = false;
      if (ball.power && ball.pierce > 0) {
        ball.lastBlock = b.id;
        damageBlock(b, 2 + power(), ball, cx, cy);
        if (!b.alive) { ball.pierce--; if (ball.pierce <= 0) { ball.power = false; rescaleVel(ball); } return true; }
        ball.pierce = 0; ball.power = false; hit = true;
      }
      const penL = ball.x + r - b.x, penR = b.x + b.w - (ball.x - r);
      const penT = ball.y + r - b.y, penB = b.y + b.h - (ball.y - r);
      if (Math.min(penL, penR) < Math.min(penT, penB)) {
        if (penL < penR) { ball.x = b.x - r; ball.vx = -Math.abs(ball.vx); } else { ball.x = b.x + b.w + r; ball.vx = Math.abs(ball.vx); }
      } else {
        if (penT < penB) { ball.y = b.y - r; ball.vy = -Math.abs(ball.vy); } else { ball.y = b.y + b.h + r; ball.vy = Math.abs(ball.vy); }
      }
      if (!hit) damageBlock(b, 1 + power(), ball, cx, cy);
      enforceAngle(ball);
      accel(ball);
      return true;
    }
    return false;
  }

  function damageBlock(b, dmg, ball, hx, hy) {
    const m = MATS[b.mat];
    const prevLvl = damageLevel(b);
    b.hp -= dmg;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, pan = panOf(cx);
    if (ball) { ball.combo++; run.bestCombo = Math.max(run.bestCombo, ball.combo); }
    if (b.hp > 0) {
      if (damageLevel(b) !== prevLvl) markDirty(b);
      A.play(m.hit || 'rockChip', { vol: 0.75, pan, gap: 0.03 });
      if (m.sparks) { sparkBurst(hx, hy, 10, 360); flash(hx, hy, 30, 'rgba(255,210,150,0.7)', 0.12, { r: 1, g: 0.75, b: 0.45, i: 1.6, rad: 60 }); }
      else if (m.shards) debris(hx, hy, [m.shards], 4, 140, 0.8, 'shard');
      else debris(hx, hy, m.chip, 3, 120, 0.7, m.splinter ? 'splinter' : 'chip');
      if (m.drop && m.drop.gem) glints(cx, cy, 2);
      return;
    }
    breakBlock(b, ball);
  }

  function breakBlock(b, ball) {
    if (!b.alive) return;
    const m = MATS[b.mat];
    b.alive = false;
    markDirty(b);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, pan = panOf(cx);
    const big = Math.sqrt(b.cw * b.ch);
    run.score += m.score * b.cw * b.ch;
    gainXp(m.xp * b.cw * b.ch);
    A.play(m.snd, { vol: Math.min(1, 0.8 + big * 0.1), pan, gap: 0.02, rate: 1 / Math.sqrt(big) });
    if (m.shards) {
      debris(cx, cy, [m.shards, '#ffffff'], Math.round(16 * big), 230, 1.1 * big, 'shard');
      glints(cx, cy, 4, b.w);
    } else {
      debris(cx, cy, m.chip, Math.round(14 * big), 200, big, m.splinter ? 'splinter' : 'chip');
      if (m.dust) dust(cx, cy, Math.round(4 * big), m.dust, big);
    }
    if (m.sparks) { sparkBurst(cx, cy, 22, 420); flash(cx, cy, 50, 'rgba(255,200,140,0.8)', 0.16, { r: 1, g: 0.7, b: 0.4, i: 2.2, rad: 90 }); shake(4, 0.12); }
    if (m.embers) sparkBurst(cx, cy, 12, 200, true);
    if (m.light) flash(cx, cy, 60, 'rgba(140,220,255,0.8)', 0.4, { r: 0.4, g: 0.85, b: 1, i: 2.5, rad: 110 });
    if (m.drop) spawnDrops(b, m.drop);
    else if (Math.random() < 0.04) spawnDrops(b, { coin: [1, 1] });
    if (ball && ball.combo >= 5) addFloater(cx, cy + 10, ball.combo + ' 連続', '#d9d2c5', 0.6);
    if (m.explode) explode(cx, cy, m.explode * (0.8 + big * 0.2));
    if (blocks.every((x) => !x.alive)) floorCleared = true;
  }

  // 爆薬：周囲のブロックに大ダメージ、連鎖する
  function explode(x, y, radius) {
    shake(10, 0.35);
    flash(x, y, radius * 2.2, 'rgba(255,170,80,0.95)', 0.35, { r: 1, g: 0.6, b: 0.25, i: 5, rad: radius * 3 });
    sparkBurst(x, y, 40, 520, true);
    dust(x, y, 10, '#4a4440', 2);
    rings.push({ x, y, life: 0.4, max: 0.4, r: radius * 1.4, boom: true });
    setTimeout(() => {
      for (const b of blocks) {
        if (!b.alive) continue;
        const cx = Math.max(b.x, Math.min(x, b.x + b.w)), cy = Math.max(b.y, Math.min(y, b.y + b.h));
        if (Math.hypot(cx - x, cy - y) < radius) damageBlock(b, 4, null, cx, cy);
      }
    }, 90);
  }

  // ---------- 落下アイテム ----------
  function spawnDrops(b, d) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const push = (kind, extra = {}) => drops.push(Object.assign({ kind, x: cx + (Math.random() - 0.5) * b.w * 0.6, y: cy, vx: (Math.random() - 0.5) * 70, vy: -80 - Math.random() * 90, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 6, t: 0 }, extra));
    if (d.coin) { const n = d.coin[0] + Math.floor(Math.random() * (d.coin[1] - d.coin[0] + 1)); for (let i = 0; i < n; i++) push('coin'); }
    if (d.gem && Math.random() < d.gem) push('gem', { hue: ['gemR', 'gemB', 'gemG'][Math.floor(Math.random() * 3)] });
    if (d.relic && Math.random() < d.relic) push('relic', { id: pickItem() });
  }
  function updateDrops(dt) {
    const magnet = equipTotal('magnet');
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      d.vy += TUNE.gravity * dt;
      d.vy = Math.min(d.vy, 260);
      d.vx *= 0.99;
      if (magnet && d.y > paddle.y - 160) d.vx += (paddle.x - d.x) * 6 * magnet * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      if (d.x < WALL + 4) { d.x = WALL + 4; d.vx = Math.abs(d.vx) * 0.5; }
      if (d.x > W - WALL - 4) { d.x = W - WALL - 4; d.vx = -Math.abs(d.vx) * 0.5; }
      // パドルで受け止める
      const c = Math.cos(-paddle.tilt), s = Math.sin(-paddle.tilt);
      const dx = d.x - paddle.x, dy = d.y - paddle.y;
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      if (d.vy > 0 && Math.abs(lx) < paddle.w / 2 + 5 && ly > -paddle.h / 2 - 7 && ly < paddle.h / 2 + 2) { catchDrop(d); drops.splice(i, 1); continue; }
      if (d.y > L.fieldBottom + 10) {
        drops.splice(i, 1);
        if (d.kind !== 'coin') { A.play('miss', { vol: 0.5, pan: panOf(d.x) }); addFloater(d.x, L.fieldBottom - 20, d.kind === 'relic' ? '装備を取り逃した' : '取り逃した', '#c07a6a', 0.9); }
      }
    }
  }
  function catchDrop(d) {
    const goldMul = 1 + equipTotal('gold');
    if (d.kind === 'coin') {
      const v = Math.round(25 * goldMul);
      run.score += v;
      A.play('coin', { vol: 0.55, pan: panOf(d.x), gap: 0.04 });
      glints(d.x, d.y, 2, 6);
      addFloater(d.x, d.y - 8, '+' + v, '#ffd36b', 0.6);
    } else if (d.kind === 'gem') {
      const v = Math.round(250 * goldMul);
      run.score += v; run.treasures++;
      A.play('coins', { vol: 0.9, pan: panOf(d.x), wet: 0.45 });
      glints(d.x, d.y, 8, 12);
      flash(d.x, d.y, 40, 'rgba(255,220,160,0.7)', 0.2);
      addFloater(d.x, d.y - 10, '宝石 +' + v, '#ffd36b', 1.0, true);
    } else {
      run.treasures++;
      glints(d.x, d.y, 10, 14);
      receiveItem(d.id, d.x, d.y);
    }
  }

  // ---------- 物理の補助 ----------
  function enforceAngle(b) {
    const minA = TUNE.minVerticalDeg * Math.PI / 180;
    const a = Math.atan2(Math.abs(b.vy), Math.abs(b.vx));
    if (a < minA) {
      const sp = Math.hypot(b.vx, b.vy), sx = Math.sign(b.vx) || 1, sy = Math.sign(b.vy) || 1;
      b.vx = Math.cos(minA) * sp * sx; b.vy = Math.sin(minA) * sp * sy;
    }
  }

  // ---------- 成長 ----------
  function gainXp(n) {
    run.xp += n;
    while (run.xp >= xpNeed(run.lv)) { run.xp -= xpNeed(run.lv); run.lv++; queue.push({ type: 'level' }); }
  }
  function pickItem() {
    const ids = Object.keys(ITEMS);
    const weights = ids.map((id) => (ITEMS[id].balls ? 1.6 : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ids.length; i++) { r -= weights[i]; if (r <= 0) return ids[i]; }
    return ids[0];
  }
  function receiveItem(id, x, y) {
    const it = ITEMS[id], cur = run.equip[it.slot];
    if (!cur) { equipItem(id, 1); addFloater(x, y - 14, `装備：${it.name}`, '#9fe0ff', 1.6, true); }
    else if (cur.id === id) { equipItem(id, cur.lv + 1); addFloater(x, y - 14, `重ね強化：${it.name} Lv${cur.lv + 1}`, '#9fe0ff', 1.6, true); }
    else queue.push({ type: 'swap', id });
  }
  function equipItem(id, lv) {
    const it = ITEMS[id];
    const before = { balls: equipTotal('balls'), lives: equipTotal('lives') };
    run.equip[it.slot] = { id, lv };
    if (!run.found.includes(it.slot)) run.found.push(it.slot);
    A.play('equip', { vol: 0.6, wet: 0.5 });
    const dB = equipTotal('balls') - before.balls, dL = equipTotal('lives') - before.lives;
    if (dL > 0) run.lives += dL;
    updatePaddleWidth();
    if (dB > 0) addBalls(dB);
  }
  function applyPerk(key) {
    if (key === 'life') { run.lives++; return; }
    run.perk[key]++;
    if (key === 'ball') addBalls(1);
    if (key === 'width') updatePaddleWidth();
    if (key === 'calm') for (const b of balls) { b.speed *= 0.92; rescaleVel(b); }
  }
  function processQueue() {
    if (state !== 'play' || overlay.classList.contains('show')) return;
    if (queue.length) {
      const ev = queue.shift();
      state = 'choice';
      if (ev.type === 'level') showLevelChoice(); else showSwapChoice(ev.id);
      return;
    }
    if (floorCleared) floorClear();
  }
  function resume() { hideOverlay(); state = 'play'; processQueue(); }
  function showLevelChoice() {
    A.play('levelUp', { vol: 0.7, wet: 0.6 });
    const pool = Object.keys(PERKS).filter((k) => k !== 'ball');
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const picks = Math.random() < 0.7 && ballCount() < TUNE.maxBalls ? ['ball', ...pool.slice(0, 2)] : pool.slice(0, 3);
    showOverlay(`レベル ${run.lv}`, '今回の探索だけ有効な強化を1つ選ぶ', picks.map((k) => ({ label: PERKS[k].name, sub: PERKS[k].desc, onClick: () => { applyPerk(k); resume(); } })));
  }
  function showSwapChoice(id) {
    const it = ITEMS[id], cur = run.equip[it.slot], ci = ITEMS[cur.id];
    A.play('equip', { vol: 0.6, wet: 0.5 });
    showOverlay('装備を拾った', `${SLOT_NAME[it.slot]}枠：<b>${it.name}</b>（${it.desc}）<br>いまの装備：${ci.name} Lv${cur.lv}（${ci.desc}）`, [
      { label: `${it.name} に付け替える`, sub: it.desc, onClick: () => { equipItem(id, 1); resume(); } },
      { label: `${ci.name} のまま`, sub: '拾った品は換金して +300点', onClick: () => { run.score += 300; resume(); } },
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
        showOverlay('GAME OVER', `第${run.floor}層まで到達　スコア ${run.score}　財宝 ${run.treasures}<br>` + (lost.length ? `未確保の装備を失った：${lost.join('、')}` : '失った装備はない'),
          [{ label: 'もう一度潜る', onClick: newRun }, { label: '装備を見る', onClick: showTitle, quiet: true }]);
      }, 700);
    } else serve();
  }

  function floorClear() {
    state = 'clear';
    A.play('collapse', { vol: 0.9, wet: 0.6 });
    shake(6, 0.5);
    for (let i = 0; i < 6; i++) setTimeout(() => dust(30 + Math.random() * (W - 60), L.blocksTop + Math.random() * 140, 4, '#8a8178', 1.6), i * 90);
    // 落下中の財宝はまとめて回収
    for (const d of drops) catchDrop(d);
    drops.length = 0;
    secured = clone(run.equip);
    save('equip', secured);
    const got = run.found.map((s) => run.equip[s]).filter(Boolean).map((e) => `${ITEMS[e.id].name} Lv${e.lv}`);
    run.found = [];
    const next = STAGES[run.floor % STAGES.length];
    setTimeout(() => showOverlay(`第${run.floor}層 突破`,
      `スコア ${run.score}　財宝 ${run.treasures}　Lv${run.lv}　残機 ${run.lives}<br>` + (got.length ? `装備を確保：${got.join('、')}` : '新しい装備はなし') + `<br>次は「${next.name}」`,
      [{ label: '次の層へ', onClick: () => { run.floor++; startFloor(); } }, { label: '帰還する', sub: '戦利品を持ち帰って終了', onClick: showTitle, quiet: true }]), 1100);
  }

  // ---------- 光源 ----------
  function flicker(t, k) { return 0.86 + 0.08 * Math.sin(t * 13 + k) + 0.06 * Math.sin(t * 29 + k * 3); }
  function fixedLights() {
    const lt = stageDef().light;
    const out = [{ x: L.lantern.x, y: L.lantern.y + 4, z: 60, r: lt.lantern[0], g: lt.lantern[1], b: lt.lantern[2], i: lt.lantern[3], rad: 240 }];
    L.torches.forEach((t, i) => out.push({ x: t.x + (i ? -4 : 4), y: t.y - 6, z: 26, r: lt.torch[0], g: lt.torch[1], b: lt.torch[2], i: lt.torch[3], rad: 120 }));
    return out;
  }
  function frameLights() {
    const lt = stageDef().light;
    const fx = fixedLights();
    fx[1].i *= flicker(now, 1); fx[2].i *= flicker(now, 7); fx[0].i *= 0.97 + 0.03 * Math.sin(now * 2.3);
    const dyn = [];
    if (lt.extra) dyn.push({ x: W / 2, y: H * lt.extra.y, z: lt.extra.z, r: lt.extra.c[0], g: lt.extra.c[1], b: lt.extra.c[2], i: lt.extra.i * flicker(now * 0.4, 3), rad: lt.extra.rad });
    for (const b of balls) if (b.power) dyn.push({ x: b.x, y: b.y, z: 14, r: 1, g: 0.6, b: 0.3, i: 1.6, rad: 70 });
    for (const f of flashes) if (f.light) { const a = f.life / f.max; dyn.push({ x: f.x, y: f.y, z: 16, r: f.light.r, g: f.light.g, b: f.light.b, i: f.light.i * a, rad: f.light.rad }); }
    // 生きている水晶は光源になる
    for (const b of blocks) if (b.alive && b.mat === 'crystal') { const c = b.hue < 0.5 ? [0.35, 0.85, 1] : [0.75, 0.45, 1]; dyn.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, z: 14, r: c[0], g: c[1], b: c[2], i: 1.1 * (0.9 + 0.1 * Math.sin(now * 3 + b.id)), rad: 75 }); }
    dyn.sort((a, b) => b.i - a.i);
    return [...fx, ...dyn.slice(0, 5)];
  }

  // ---------- 描画 ----------
  function draw() {
    let sx = 0, sy = 0;
    if (shakeT > 0) { sx = (Math.random() - 0.5) * 2 * shakeMag; sy = (Math.random() - 0.5) * 2 * shakeMag; }
    flushDirty();
    if (R && art.shadowDirty && now - art.lastShadow > 0.06) { R.bakeShadows(fixedLights()); art.shadowDirty = false; art.lastShadow = now; }
    if (R) {
      const w = Math.round(paddle.w);
      if (art.paddleW !== w) { R.freeSprite(art.sprites.paddle); art.sprites.paddle = R.sprite(MT.paddle(w, paddle.h, PS)); art.paddleW = w; }
      const sprites = [], occ = [];
      const pc = Math.cos(paddle.tilt), ps = Math.sin(paddle.tilt);
      for (const k of [-0.33, 0, 0.33]) occ.push([paddle.x + k * paddle.w * pc, paddle.y + k * paddle.w * ps, PADDLE_Z, 5]);
      sprites.push({ tex: art.sprites.paddle, x: paddle.x, y: paddle.y, w: paddle.w, h: paddle.h, rot: paddle.tilt, env: 0.6 });
      for (const d of drops) {
        const tex = d.kind === 'coin' ? art.sprites.coin : d.kind === 'gem' ? art.sprites[d.hue] : art.sprites.relic;
        const sz = d.kind === 'coin' ? 8 : d.kind === 'gem' ? 10 : 13;
        sprites.push({ tex, x: d.x, y: d.y, w: sz * (d.kind === 'coin' ? Math.abs(Math.cos(d.rot)) * 0.8 + 0.2 : 1), h: sz * (d.kind === 'relic' ? 0.85 : 1), rot: d.kind === 'coin' ? 0 : d.rot * 0.2, env: 0.4, lift: 4 });
      }
      if (state !== 'title') for (const b of balls) {
        sprites.push({ tex: art.sprites.ball, x: b.x, y: b.y, w: 11, h: 11, env: 1, tint: b.power ? [1.4, 0.95, 0.6] : null, lift: 2 });
        occ.push([b.x, b.y, BALL_Z, TUNE.ballRadius]);
      }
      R.frame({ sx, sy, ambient: stageDef().light.amb.map((v) => v * 1.35), lights: frameLights(), occluders: occ, sprites });
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, (offX + sx * scale) * dpr, (offY + sy * scale) * dpr);
    drawFlames();
    drawDust();
    drawTrails();
    drawChips();
    drawLight();
    drawRings();
    drawFloaters();
    drawPad();
    drawHint();
    drawHud();
  }

  function drawFlames() {
    ctx.globalCompositeOperation = 'lighter';
    for (const [i, t] of L.torches.entries()) {
      const f = flicker(now, i * 5 + 1);
      const w = 9 * f, h = 16 * (0.9 + 0.2 * Math.sin(now * 17 + i));
      ctx.globalAlpha = 0.95;
      ctx.drawImage(art.flame, t.x - w / 2 + (i ? -2 : 2), t.y - h + 2, w, h);
      const g = ctx.createRadialGradient(t.x, t.y - 6, 0, t.x, t.y - 6, 30);
      g.addColorStop(0, 'rgba(255,150,60,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g; ctx.globalAlpha = f; ctx.fillRect(t.x - 30, t.y - 36, 60, 60);
    }
    const g = ctx.createRadialGradient(L.lantern.x, L.lantern.y, 0, L.lantern.x, L.lantern.y, 26);
    const lc = stageDef().light.lantern;
    g.addColorStop(0, `rgba(${lc[0] * 255 | 0},${lc[1] * 220 | 0},${lc[2] * 180 | 0},${0.25 * Math.min(1, lc[3])})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.globalAlpha = 1; ctx.fillRect(L.lantern.x - 26, L.lantern.y - 26, 52, 52);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawTrails() {
    // 高速の球の残像。ジャスト中は炎のような軌跡
    ctx.globalCompositeOperation = 'lighter';
    for (const b of balls) {
      const t = b.trail;
      if (t.length < 4) continue;
      for (let i = 2; i < t.length; i += 2) {
        const a = i / t.length;
        ctx.strokeStyle = b.power ? `rgba(255,${140 + a * 80 | 0},60,${a * 0.6})` : `rgba(220,215,200,${a * 0.10})`;
        ctx.lineWidth = (b.power ? 7 : 5) * a;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(t[i - 2], t[i - 1]); ctx.lineTo(t[i], t[i + 1]); ctx.stroke();
      }
      if (b.power) {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 18);
        g.addColorStop(0, 'rgba(255,200,120,0.6)'); g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g; ctx.fillRect(b.x - 18, b.y - 18, 36, 36);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawDust() {
    for (const p of particles) {
      if (p.kind !== 'dust') continue;
      const t = 1 - p.life / p.max;
      const rr = p.r0 + (p.r1 - p.r0) * Math.sqrt(Math.max(0, t));
      ctx.globalAlpha = Math.max(0, 1 - t) * 0.5;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.drawImage(tintedDust(p.color), -rr, -rr, rr * 2, rr * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  const dustCache = {};
  function tintedDust(color) {
    if (dustCache[color] && dustCache[color].src === art.dust) return dustCache[color].cv;
    const cv = document.createElement('canvas');
    cv.width = art.dust.width; cv.height = art.dust.height;
    const c2 = cv.getContext('2d');
    c2.drawImage(art.dust, 0, 0);
    c2.globalCompositeOperation = 'source-in';
    c2.fillStyle = color; c2.fillRect(0, 0, cv.width, cv.height);
    dustCache[color] = { cv, src: art.dust };
    return cv;
  }

  function drawChips() {
    for (const p of particles) {
      if (p.kind !== 'chip' && p.kind !== 'shard' && p.kind !== 'splinter') continue;
      ctx.globalAlpha = Math.min(1, p.life / 0.3) * (p.kind === 'shard' ? 0.85 : 1);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      ctx.closePath(); ctx.fill();
      // 回転に合わせて光る面（破片がきらめく）
      const lit = Math.max(0, Math.sin(p.rot * 1.3));
      ctx.fillStyle = p.kind === 'shard' ? `rgba(255,255,255,${0.2 + lit * 0.7})` : `rgba(255,240,220,${0.08 + lit * 0.25})`;
      ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1]); ctx.lineTo(p.pts[1][0], p.pts[1][1]); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawLight() {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flashes) {
      const a = f.life / f.max;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, f.color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a * 0.7; ctx.fillStyle = g;
      ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
    }
    ctx.globalAlpha = 1; ctx.lineCap = 'round';
    for (const s of sparks) {
      const a = s.life / s.max;
      ctx.strokeStyle = `rgba(255,${150 + a * 90 | 0},${60 + a * 110 | 0},${Math.min(1, a * 1.6)})`;
      ctx.lineWidth = 0.6 + a * 0.9;
      ctx.beginPath(); ctx.moveTo(s.px - (s.x - s.px) * 1.5, s.py - (s.y - s.py) * 1.5); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
    for (const p of particles) {
      if (p.kind !== 'glint') continue;
      ctx.globalAlpha = Math.sin(Math.min(1, p.life / p.max) * Math.PI);
      ctx.drawImage(art.glint, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    // 落下中の宝石・装備がきらめく
    for (const d of drops) {
      if (d.kind === 'coin') continue;
      const s = 10 + 6 * Math.sin(d.t * 8);
      ctx.globalAlpha = 0.6; ctx.drawImage(art.glint, d.x - s / 2, d.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawRings() {
    for (const r of rings) {
      const t = 1 - r.life / r.max;
      ctx.strokeStyle = r.boom ? `rgba(255,190,120,${(1 - t) * 0.6})` : `rgba(255,210,140,${(1 - t) * 0.9})`;
      ctx.lineWidth = (r.boom ? 6 : 3) * (1 - t) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.2 + t * 0.8), 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawFloaters() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
      ctx.font = `${f.big ? 700 : 600} ${f.big ? 14 : 12}px -apple-system, "Hiragino Sans", sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillText(f.text, f.x + 1, f.y + 1.2);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawPad() {
    if (!input.active || ctrlMode !== 'pad' || state !== 'play') return;
    const R0 = TUNE.padRadius;
    const d = Math.max(-R0, Math.min(R0, input.x - input.anchorX));
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(input.anchorX - R0 - 14, input.anchorY - 14, R0 * 2 + 28, 28, 14) : ctx.rect(input.anchorX - R0 - 14, input.anchorY - 14, R0 * 2 + 28, 28); ctx.fill();
    ctx.strokeStyle = 'rgba(220,210,190,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(220,210,190,0.18)';
    ctx.fillRect(input.anchorX - 1, input.anchorY - 8, 2, 16);
    const g = ctx.createRadialGradient(input.anchorX + d - 3, input.anchorY - 4, 1, input.anchorX + d, input.anchorY, 13);
    g.addColorStop(0, 'rgba(255,245,225,0.85)'); g.addColorStop(1, 'rgba(150,140,125,0.6)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(input.anchorX + d, input.anchorY, 12, 0, Math.PI * 2); ctx.fill();
  }

  function drawHint() {
    if (state !== 'play' || overlay.classList.contains('show')) return;
    const n = balls.filter((b) => b.stuck).length;
    if (!n || balls.some((b) => !b.stuck)) return;
    ctx.globalAlpha = 0.6 + Math.sin(now * 4) * 0.25;
    ctx.fillStyle = '#e6dccb';
    ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`タップで発射（${n}球を時間差で）`, W / 2, paddle.y - 64);
    ctx.font = '500 11px -apple-system, "Hiragino Sans", sans-serif';
    ctx.fillText('球がパドルに当たる瞬間にタップでジャスト打ち返し', W / 2, paddle.y - 46);
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    const g = ctx.createLinearGradient(0, 0, 0, L.fieldTop);
    g.addColorStop(0, '#060607'); g.addColorStop(1, '#13110f');
    ctx.fillStyle = g; ctx.fillRect(0, -40, W, L.fieldTop + 40);
    ctx.textBaseline = 'middle';
    ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
    const y1 = L.hudTop + 14, y2 = L.hudTop + 38;
    const lives = run ? run.lives : TUNE.lives + equipTotal('lives', secured);
    for (let i = 0; i < Math.min(lives, 6); i++) drawMiniBall(14 + i * 13, y1);
    if (lives > 6) { ctx.fillStyle = '#d9d2c5'; ctx.textAlign = 'left'; ctx.fillText('+' + (lives - 6), 6 * 13 + 10, y1 + 1); }
    ctx.fillStyle = '#c9b89a'; ctx.textAlign = 'left';
    ctx.fillText(run ? `第${run.floor}層` : '', 96, y1 + 1);
    ctx.fillStyle = '#e8e2d6'; ctx.textAlign = 'right';
    ctx.fillText(String(run ? run.score : 0), L.btnCtrl.x - 8, y1 + 1);
    drawButton(L.btnCtrl, ctrlMode === 'pad' ? 'パッド' : 'ドラッグ', '#9fc8d8');
    drawButton(L.btnSound, A.enabled ? '音' : '無音', A.enabled ? '#c9c1b2' : '#5e5750');
    if (!run) return;
    ctx.fillStyle = '#9fe0ff'; ctx.textAlign = 'left';
    ctx.fillText(`Lv${run.lv}`, 8, y2 + 1);
    ctx.fillStyle = '#1d1c1a'; ctx.fillRect(42, y2 - 3, 100, 6);
    ctx.fillStyle = '#6fb8d8'; ctx.fillRect(42, y2 - 3, 100 * Math.min(1, run.xp / xpNeed(run.lv)), 6);
    drawMiniBall(160, y2);
    ctx.fillStyle = '#e8e2d6'; ctx.fillText('×' + ballCount(), 168, y2 + 1);
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath(); const tx = 212; ctx.moveTo(tx, y2 - 6); ctx.lineTo(tx + 5, y2); ctx.lineTo(tx, y2 + 6); ctx.lineTo(tx - 5, y2); ctx.closePath(); ctx.fill();
    ctx.fillText(String(run.treasures), tx + 9, y2 + 1);
    ctx.textAlign = 'right'; ctx.font = '600 11px -apple-system, "Hiragino Sans", sans-serif';
    const eq = ['ball', 'paddle', 'support'].filter((s) => run.equip[s]).length;
    ctx.fillStyle = run.found.length ? '#ffb070' : '#9a9184';
    ctx.fillText(`装備${eq}` + (run.found.length ? `（未確保${run.found.length}）` : ''), W - 8, y2 + 1);
  }
  function drawMiniBall(x, y) {
    const g = ctx.createRadialGradient(x - 1.5, y - 2, 0.5, x, y, 5.5);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#a9adb4'); g.addColorStop(1, '#3a3c40');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }
  function drawButton(r, label, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.font = '600 12px -apple-system, "Hiragino Sans", sans-serif';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.font = '600 13px -apple-system, "Hiragino Sans", sans-serif';
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
    return ['ball', 'paddle', 'support'].map((s) => { const e = equip[s]; return `${SLOT_NAME[s]}：` + (e ? `${ITEMS[e.id].name} Lv${e.lv}（${ITEMS[e.id].desc}${e.lv > 1 ? ' ×' + e.lv : ''}）` : '—'); }).join('<br>');
  }
  function showTitle() {
    state = 'title';
    run = null;
    balls.length = 0; drops.length = 0;
    buildStage(1);
    paddle.w = TUNE.paddleWidth; paddle.x = W / 2;
    const n = 1 + equipTotal('balls', secured);
    showOverlay('B.A.L.L.',
      '画面下で親指を置くと仮想パッド。左右にずらした量でパドルが動く。<br>タップで1球ずつ発射、当たる瞬間のタップでジャスト打ち返し。' +
      `<span class="eq">${equipList(secured)}</span>発射できる球：${n}`,
      [{ label: '探索開始', onClick: newRun },
       ...(Object.keys(secured).length ? [{ label: '装備をリセット', quiet: true, onClick: () => { secured = {}; save('equip', secured); showTitle(); } }] : [])]);
    if (!R) ovText.innerHTML += '<br><b>この端末では WebGL が使えないため、照明を表示できません。</b>';
  }

  // ---------- ループ ----------
  let last = performance.now(), acc = 0;
  const STEP = 1 / 120;
  function frame(t) {
    let dt = (t - last) / 1000;
    last = t;
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    requestAnimationFrame(frame); // 例外が出てもループは止めない
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    draw();
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 200); });
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  resize();
  showTitle();

  window.__ball = {
    get state() { return state; }, get balls() { return balls; }, get paddle() { return paddle; }, get blocks() { return blocks; },
    get drops() { return drops; }, get run() { return run; }, get queue() { return queue; }, get now() { return now; },
    newRun, strike, TUNE, ITEMS, STAGES, gainXp, ballCount, receiveItem, explode, input,
    goFloor(n) { run.floor = n; startFloor(); hideOverlay(); },
  };
  requestAnimationFrame(frame);
})();
