// 素材の生成：高さ・色・鏡面反射・発光をノイズから作り、3枚のマップに焼き込む。
//   alb : RGB=アルベド（素の色）, A=被覆率
//   nrm : RG=法線XY, B=高さ(0..1 = 0..HMAX 論理px), A=被覆率
//   mat : R=鏡面反射の強さ, G=光沢, B=発光, A=被覆率
// 陰影は renderer.js が実際の光源位置から毎フレーム計算する。
window.BallMat = (() => {
  'use strict';
  const HMAX = 16;

  // ---------- ノイズ ----------
  function hash(ix, iy, seed) {
    let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
    const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, seed, oct) {
    let amp = 0.5, f = 1, t = 0, n = 0;
    for (let i = 0; i < oct; i++) { t += amp * vnoise(x * f, y * f, seed + i * 131); n += amp; amp *= 0.5; f *= 2.03; }
    return t / n;
  }
  function ridged(x, y, seed, oct) {
    let amp = 0.5, f = 1, t = 0, n = 0;
    for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(vnoise(x * f, y * f, seed + i * 71) * 2 - 1); t += amp * v * v; n += amp; amp *= 0.5; f *= 2.1; }
    return t / n;
  }
  // セルノイズ：F1, F2 と最寄りセルのID
  const wr = [0, 0, 0];
  function worley(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const px = cx + hash(cx, cy, seed), py = cy + hash(cx, cy, seed + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = hash(cx, cy, seed + 2); } else if (d < f2) f2 = d;
    }
    wr[0] = f1; wr[1] = f2; wr[2] = id;
    return wr;
  }
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ---------- 焼き込み ----------
  // sampler(u, v, o): o.h(論理px), o.r/g/b(0..255), o.a, o.spec, o.gloss(0..1), o.emis(0..1)
  function bake(wL, hL, ps, sampler, opts = {}) {
    const wp = Math.max(1, Math.round(wL * ps)), hp = Math.max(1, Math.round(hL * ps));
    const n = wp * hp;
    const Hh = new Float32Array(n), C = new Float32Array(n * 3), AL = new Float32Array(n), SP = new Float32Array(n), GL = new Float32Array(n), EM = new Float32Array(n);
    const o = { h: 0, r: 0, g: 0, b: 0, a: 1, spec: 0, gloss: 0.2, emis: 0 };
    for (let y = 0; y < hp; y++) for (let x = 0; x < wp; x++) {
      o.h = 0; o.a = 1; o.spec = 0.04; o.gloss = 0.2; o.emis = 0;
      sampler((x + 0.5) / ps, (y + 0.5) / ps, o);
      const i = y * wp + x;
      Hh[i] = o.h; AL[i] = o.a; SP[i] = o.spec; GL[i] = o.gloss; EM[i] = o.emis;
      C[i * 3] = o.r; C[i * 3 + 1] = o.g; C[i * 3 + 2] = o.b;
    }
    // 窪みほど暗くする（アンビエントオクルージョン）
    const blur = boxBlur(boxBlur(Hh, wp, hp, Math.max(1, Math.round(1.6 * ps))), wp, hp, Math.max(1, Math.round(1.6 * ps)));
    const aoK = opts.ao ?? 0.35;
    const base = opts.base ?? 0;
    const bump = (opts.bump ?? 1) * ps / 2;
    const mk = () => { const c = document.createElement('canvas'); c.width = wp; c.height = hp; return c; };
    const ca = mk(), cn = mk(), cm = mk();
    const ia = ca.getContext('2d').createImageData(wp, hp), inn = cn.getContext('2d').createImageData(wp, hp), im = cm.getContext('2d').createImageData(wp, hp);
    const da = ia.data, dn = inn.data, dm = im.data;
    for (let y = 0; y < hp; y++) {
      const y0 = y > 0 ? y - 1 : y, y1 = y < hp - 1 ? y + 1 : y;
      for (let x = 0; x < wp; x++) {
        const i = y * wp + x, p = i * 4;
        const x0 = x > 0 ? x - 1 : x, x1 = x < wp - 1 ? x + 1 : x;
        // 透明な縁では高さを0に落として面取りの法線にする
        const hx1 = Hh[y * wp + x1] * AL[y * wp + x1], hx0 = Hh[y * wp + x0] * AL[y * wp + x0];
        const hy1 = Hh[y1 * wp + x] * AL[y1 * wp + x], hy0 = Hh[y0 * wp + x] * AL[y0 * wp + x];
        const dx = (hx1 - hx0) * bump / Math.max(1, x1 - x0), dy = (hy1 - hy0) * bump / Math.max(1, y1 - y0);
        const m = Math.hypot(dx, dy, 1);
        const ao = Math.max(0.4, Math.min(1.05, 1 - (blur[i] - Hh[i]) * aoK));
        const a = clamp01(AL[i]);
        da[p] = clampB(C[i * 3] * ao); da[p + 1] = clampB(C[i * 3 + 1] * ao); da[p + 2] = clampB(C[i * 3 + 2] * ao); da[p + 3] = a * 255;
        dn[p] = (-dx / m * 0.5 + 0.5) * 255; dn[p + 1] = (-dy / m * 0.5 + 0.5) * 255;
        dn[p + 2] = clamp01((base + Hh[i]) / HMAX) * 255; dn[p + 3] = a * 255;
        dm[p] = clamp01(SP[i] * ao / 2) * 255; dm[p + 1] = clamp01(GL[i]) * 255; dm[p + 2] = clamp01(EM[i]) * 255; dm[p + 3] = a * 255;
      }
    }
    ca.getContext('2d').putImageData(ia, 0, 0);
    cn.getContext('2d').putImageData(inn, 0, 0);
    cm.getContext('2d').putImageData(im, 0, 0);
    return { alb: ca, nrm: cn, mat: cm, w: wL, h: hL };
  }
  const clampB = (v) => v < 0 ? 0 : v > 255 ? 255 : v;
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      let s = 0, c = 0;
      for (let x = -r; x < w + r; x++) {
        if (x + r < w) { s += src[y * w + Math.min(w - 1, x + r)]; c++; }
        if (x - r - 1 >= 0) { s -= src[y * w + x - r - 1]; c--; }
        if (x >= 0 && x < w) tmp[y * w + x] = s / Math.max(1, c);
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let y = -r; y < h + r; y++) {
        if (y + r < h) { s += tmp[Math.min(h - 1, y + r) * w + x]; c++; }
        if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * w + x]; c--; }
        if (y >= 0 && y < h) out[y * w + x] = s / Math.max(1, c);
      }
    }
    return out;
  }

  // ---------- ひび割れ ----------
  function crackSegments(w, h, seed, level, style) {
    const R = rng(seed * 7 + 3);
    const segs = [];
    const walk = (x, y, ang, steps, width) => {
      for (let s = 0; s < steps; s++) {
        const len = 1.4 + R() * 2.4;
        const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
        segs.push([x, y, nx, ny, width]);
        x = nx; y = ny;
        if (x < -1 || x > w + 1 || y < -1 || y > h + 1) break;
        ang += (R() - 0.5) * (style === 'grain' ? 0.25 : style === 'glass' ? 0.15 : 1.0);
        if (R() < 0.22 && width > 0.4) walk(x, y, ang + (R() < 0.5 ? 1 : -1) * (0.5 + R() * 0.7), 2 + (R() * 4 | 0), width * 0.6);
      }
    };
    for (let k = 0; k < level; k++) {
      const cx = w * (0.2 + R() * 0.6), cy = h * (0.25 + R() * 0.5);
      if (style === 'glass') {
        // ガラスは衝撃点から放射状に割れる
        const n = 5 + (R() * 4 | 0);
        for (let i = 0; i < n; i++) walk(cx, cy, i / n * Math.PI * 2 + R() * 0.4, 6 + (R() * 6 | 0), 0.7);
      } else if (style === 'grain') {
        walk(cx, cy, (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.2, 6 + (R() * 6 | 0), 1);
      } else {
        const base = R() * Math.PI * 2;
        walk(cx, cy, base, 5 + (R() * 5 | 0), 1);
        walk(cx, cy, base + Math.PI + (R() - 0.5), 4 + (R() * 5 | 0), 0.9);
      }
    }
    return segs;
  }
  function crackAt(segs, u, v) {
    let best = 99;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const vx = s[2] - s[0], vy = s[3] - s[1];
      const t = clamp01(((u - s[0]) * vx + (v - s[1]) * vy) / (vx * vx + vy * vy || 1));
      const dx = u - s[0] - vx * t, dy = v - s[1] - vy * t;
      const d = Math.sqrt(dx * dx + dy * dy) / s[4];
      if (d < best) best = d;
    }
    return best;
  }

  // 面取りされた輪郭。chip で縁の欠けを加える
  function shape(u, v, w, h, seed, chip, round) {
    let d = Math.min(u, w - u, v, h - v);
    if (round) {
      const cx = Math.max(round, Math.min(w - round, u)), cy = Math.max(round, Math.min(h - round, v));
      d = Math.min(d, round - Math.hypot(u - cx, v - cy));
    }
    if (chip) d += (fbm(u * 0.3, v * 0.3, seed + 5, 3) - 0.5) * chip;
    return d;
  }

  // ---------- 素材 ----------
  // 各関数は (u, v, w, h, seed, k, o) を受け取る。k = {cr: ひびの芯, ce: ひびの縁}
  const M = {};

  M.dirt = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 3.4);
    o.a = smooth(0.1, 0.9, d);
    const lump = worley(u * 0.28, v * 0.28, s);
    const clump = 1 - lump[0];
    const g = fbm(u * 0.4, v * 0.4, s + 1, 5);
    const pebble = worley(u * 0.55 + 7, v * 0.55, s + 9);
    const peb = smooth(0.3, 0.16, pebble[0]) * (pebble[2] > 0.7 ? 1 : 0);
    o.h = smooth(0, 3, d) * 1.4 + clump * 1.2 + g * 1.2 + peb * 1.1;
    const t = fbm(u * 0.07, v * 0.07, s + 3, 2);
    let r = mix(92, 70, t), gg = mix(66, 52, t), b = mix(44, 36, t);
    const br = 0.7 + g * 0.6 + clump * 0.15;
    r *= br; gg *= br; b *= br;
    if (peb > 0) { const pc = 0.9 + pebble[2] * 0.6; r = mix(r, 96 * pc, peb); gg = mix(gg, 88 * pc, peb); b = mix(b, 78 * pc, peb); o.spec = 0.08 * peb; o.gloss = 0.35; }
    // 細い根
    const root = ridged(u * 0.09, v * 0.2, s + 13, 2);
    if (root > 0.93) { const tt = (root - 0.93) * 14; r = mix(r, 58, tt); gg = mix(gg, 40, tt); b = mix(b, 26, tt); o.h += tt * 0.4; }
    o.r = r; o.g = gg; o.b = b;
    o.h -= k.cr * 2;
    o.spec = Math.max(o.spec, 0.03); o.gloss = Math.max(o.gloss, 0.12);
  };

  M.rock = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 2.8);
    o.a = smooth(0.15, 0.8, d);
    const f = worley(u * 0.16, v * 0.16, s + 17);
    const facet = (f[1] - f[0]);
    const grain = fbm(u * 0.24, v * 0.24, s, 6);
    const fine = vnoise(u * 2.2, v * 2.2, s + 9);
    o.h = smooth(0, 2.6, d) * 1.6 + smooth(0, 0.5, facet) * 1.4 + grain * 1.6 + fine * 0.18;
    const t = fbm(u * 0.06 + s, v * 0.06, s + 2, 2);
    const br = 0.62 + grain * 0.55 + f[2] * 0.12;
    let r = (104 + (t - 0.5) * 30) * br, g = (99 + (t - 0.5) * 20) * br, b = (94 - t * 10) * br;
    const fl = vnoise(u * 3.1, v * 3.1, s + 21);
    if (fl > 0.84) { const q = 1 + (fl - 0.84) * 5; r *= q; g *= q; b *= q; o.spec = 0.5; o.gloss = 0.6; }
    else if (fl < 0.12) { r *= 0.55; g *= 0.55; b *= 0.58; }
    else { o.spec = 0.05; o.gloss = 0.18; }
    o.r = r; o.g = g; o.b = b;
    o.h -= k.cr * 2;
  };

  M.brick = (u, v, w, h, s, k, o) => {
    const bh = 7.5, bw = 15.5, mortar = 1.1;
    const row = Math.floor(v / bh);
    const off = (row % 2) * bw / 2 + hash(row, 0, s) * 3;
    const col = Math.floor((u + off) / bw);
    const lu = (u + off) - col * bw, lv = v - row * bh;
    const id = hash(col, row, s + 3);
    const ed = Math.min(lu, bw - lu, lv, bh - lv) + (fbm(u * 0.5, v * 0.5, s + col * 7, 3) - 0.5) * 1.4;
    const d = shape(u, v, w, h, s, 1.2);
    o.a = smooth(0.1, 0.6, d);
    const inBrick = smooth(mortar * 0.5, mortar + 0.5, ed);
    const pore = vnoise(u * 2.6, v * 2.6, s + 11);
    const g = fbm(u * 0.35, v * 0.35, s + col, 5);
    o.h = smooth(0, 1.5, d) * 1.2 + inBrick * (1.6 + g * 0.8) - (pore < 0.12 ? 0.35 : 0);
    const tone = 0.78 + id * 0.35;
    const burnt = smooth(0.62, 0.8, fbm(u * 0.2, v * 0.2, s + 31, 3));
    let r = 150 * tone * (0.8 + g * 0.4), gg = 70 * tone * (0.8 + g * 0.35), b = 48 * tone * (0.8 + g * 0.3);
    r = mix(r, 70, burnt * 0.6); gg = mix(gg, 40, burnt * 0.6); b = mix(b, 32, burnt * 0.6);
    if (pore < 0.12) { r *= 0.6; gg *= 0.6; b *= 0.6; }
    // 目地は砂っぽい灰色
    const ms = 0.75 + vnoise(u * 3, v * 3, s + 41) * 0.5;
    o.r = mix(132 * ms, r, inBrick); o.g = mix(124 * ms, gg, inBrick); o.b = mix(112 * ms, b, inBrick);
    o.spec = 0.05; o.gloss = 0.15;
    o.h -= k.cr * 1.8;
  };

  M.wood = (u, v, w, h, s, k, o) => {
    const ph = 5.4;
    const plank = Math.floor(v / ph), lv = v - plank * ph;
    const pid = hash(plank, 1, s);
    const d = shape(u, v, w, h, s, 0.6);
    o.a = smooth(0.1, 0.6, d);
    const gap = smooth(0, 0.7, Math.min(lv, ph - lv));
    const warp = fbm(u * 0.04, v * 0.5, s + plank * 3, 3) * 5;
    const ring = Math.sin((v * 2.2 + warp + pid * 20) * 2.4) * 0.5 + 0.5;
    const fiber = vnoise(u * 0.12, v * 6, s + 5) * 0.6 + vnoise(u * 0.4, v * 14, s + 6) * 0.4;
    // 節
    const kx = (pid * 0.7 + 0.15) * w, ky = plank * ph + ph / 2;
    const kd = Math.hypot((u - kx) * 0.6, (v - ky) * 1.4);
    const knot = smooth(2.4, 0.6, kd);
    o.h = smooth(0, 1.2, d) * 1 + gap * (1.6 + ring * 0.25 + fiber * 0.2) - knot * 0.3;
    const tone = 0.75 + pid * 0.35;
    const k2 = (0.65 + ring * 0.25 + fiber * 0.25) * tone;
    let r = 150 * k2, g = 104 * k2, b = 62 * k2;
    if (knot > 0) { const kr = Math.sin(kd * 5) * 0.5 + 0.5; r = mix(r, 70 + kr * 30, knot); g = mix(g, 44 + kr * 20, knot); b = mix(b, 24 + kr * 12, knot); }
    const gr = 1 - gap * 0;
    r *= gr;
    // 板の両端の釘
    for (const nx of [2.6, w - 2.6]) {
      const nd = Math.hypot(u - nx, v - (plank * ph + ph / 2));
      if (nd < 0.9) { o.h += (0.9 - nd) * 0.8; r = 70; g = 66; b = 64; o.spec = 0.7; o.gloss = 0.6; }
    }
    // 汚れ
    const dirt = smooth(0.55, 0.85, fbm(u * 0.15, v * 0.15, s + 9, 4));
    o.r = mix(r, 60, dirt * 0.5); o.g = mix(g, 46, dirt * 0.5); o.b = mix(b, 34, dirt * 0.5);
    if (o.spec < 0.5) { o.spec = 0.08 + fiber * 0.05; o.gloss = 0.3; }
    if (gap < 1) { o.r *= 0.35 + gap * 0.65; o.g *= 0.35 + gap * 0.65; o.b *= 0.35 + gap * 0.65; }
    o.h -= k.cr * 1.8;
  };

  M.glass = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 0, 1.2);
    const edge = smooth(0, 1.8, d);
    o.a = smooth(0, 0.3, d) * (0.4 + (1 - edge) * 0.45 + k.cr * 0.5);
    const ripple = fbm(u * 0.08, v * 0.08, s, 3);
    o.h = edge * 1.4 + ripple * 0.25;
    const bub = worley(u * 0.9, v * 0.9, s + 7);
    if (bub[0] < 0.12 && bub[2] > 0.8) { o.h += 0.3; o.a += 0.15; }
    o.r = 70; o.g = 96; o.b = 100;
    if (k.cr > 0) { o.r = 235; o.g = 245; o.b = 250; o.a = Math.max(o.a, k.cr * 0.9); o.h -= k.cr * 0.4; }
    o.spec = 1.6; o.gloss = 0.95;
  };

  M.ice = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 1.6, 2);
    const edge = smooth(0, 2.2, d);
    const frost = fbm(u * 0.3, v * 0.3, s + 3, 5);
    const plane = ridged(u * 0.08, v * 0.08, s + 5, 3);
    o.a = smooth(0, 0.5, d) * (0.62 + frost * 0.3 + (1 - edge) * 0.2);
    o.h = edge * 2 + frost * 0.6 + plane * 0.6;
    const wht = smooth(0.45, 0.8, frost);
    o.r = mix(150, 235, wht); o.g = mix(200, 245, wht); o.b = mix(232, 252, wht);
    if (plane > 0.85) { o.r += 20; o.g += 20; o.b += 15; }
    o.spec = 1.1 - wht * 0.5; o.gloss = 0.85 - wht * 0.3;
    if (k.cr > 0) { o.r = mix(o.r, 255, k.cr); o.g = mix(o.g, 255, k.cr); o.b = mix(o.b, 255, k.cr); o.h -= k.cr * 0.6; }
  };

  M.marble = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 0.4);
    o.a = smooth(0.1, 0.5, d);
    const wx = u + fbm(u * 0.05, v * 0.05, s, 4) * 18, wy = v + fbm(u * 0.05 + 9, v * 0.05, s + 1, 4) * 18;
    const vein = ridged(wx * 0.06, wy * 0.06, s + 3, 5);
    const cloud = fbm(u * 0.1, v * 0.1, s + 7, 5);
    o.h = smooth(0, 1.6, d) * 2 + cloud * 0.1;
    const base = 222 + cloud * 25;
    const vv = smooth(0.78, 0.97, vein);
    o.r = mix(base, 92, vv); o.g = mix(base - 4, 94, vv); o.b = mix(base - 10, 100, vv);
    const gold = smooth(0.95, 0.99, ridged(wx * 0.03, wy * 0.03, s + 9, 3));
    o.r = mix(o.r, 200, gold); o.g = mix(o.g, 160, gold); o.b = mix(o.b, 90, gold);
    o.spec = 0.9; o.gloss = 0.82;
    if (k.cr > 0) { o.r *= 1 - k.cr * 0.6; o.g *= 1 - k.cr * 0.6; o.b *= 1 - k.cr * 0.6; o.h -= k.cr * 1.4; o.spec *= 1 - k.cr; }
  };

  M.steel = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 0.2);
    o.a = smooth(0.05, 0.5, d);
    const brushed = vnoise(u * 0.1, v * 4.5, s + 3) * 0.6 + vnoise(u * 0.3, v * 10, s + 4) * 0.4;
    const dent = fbm(u * 0.3, v * 0.3, s + 9, 3);
    let hh = smooth(0, 1.6, d) * 1.8 + brushed * 0.06 + dent * 0.25;
    // リベット（四隅）
    for (const [rx, ry] of [[2.8, 2.8], [w - 2.8, 2.8], [2.8, h - 2.8], [w - 2.8, h - 2.8]]) {
      const rd = Math.hypot(u - rx, v - ry);
      if (rd < 1.4) hh += Math.sqrt(1 - (rd / 1.4) ** 2) * 1.0;
    }
    // 引っかき傷
    const sc = ridged(u * 0.05 + v * 0.11, v * 0.02 - u * 0.03, s + 15, 2);
    const scratch = smooth(0.965, 0.995, sc);
    const rust = smooth(0.58, 0.75, fbm(u * 0.14, v * 0.14, s + 11, 5) + (1 - smooth(0, 3, d)) * 0.12);
    const grime = fbm(u * 0.5, v * 0.5, s + 13, 3);
    const tone = 0.75 + brushed * 0.35 - grime * 0.12 + scratch * 0.4;
    let r = 96 * tone, g = 102 * tone, b = 112 * tone;
    const rv = fbm(u * 0.8, v * 0.8, s + 17, 3);
    r = mix(r, 112 + rv * 40, rust); g = mix(g, 52 + rv * 20, rust); b = mix(b, 26 + rv * 10, rust);
    o.r = r; o.g = g; o.b = b;
    o.spec = (0.95 + scratch * 0.5) * (1 - rust * 0.9); o.gloss = 0.62 - rust * 0.45;
    o.h = hh + rust * 0.15 - k.cr * 1.2;
    if (k.cr > 0) { o.r *= 1 - k.cr * 0.7; o.g *= 1 - k.cr * 0.7; o.b *= 1 - k.cr * 0.7; }
  };

  M.obsidian = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 2.2);
    o.a = smooth(0.1, 0.6, d);
    const f = worley(u * 0.14, v * 0.14, s);
    const conch = Math.sin(f[0] * 22) * 0.5 + 0.5; // 貝殻状の割れ口
    o.h = smooth(0, 2, d) * 2 + (f[1] - f[0]) * 2.2 + conch * 0.25;
    const t = 14 + f[2] * 12;
    o.r = t + 6; o.g = t; o.b = t + 14;
    o.spec = 1.5; o.gloss = 0.93;
    if (k.cr > 0) { o.r = mix(o.r, 90, k.ce); o.g = mix(o.g, 80, k.ce); o.b = mix(o.b, 110, k.ce); o.h -= k.cr * 1.5; }
  };

  M.crystal = (u, v, w, h, s, k, o) => {
    M.rock(u, v, w, h, s, k, o);
    o.r *= 0.45; o.g *= 0.45; o.b *= 0.5;
    // 六角柱の結晶を数本
    const R = rng(s + 101);
    const n = Math.max(2, Math.round(w * h / 140));
    let best = 0, bestH = 0;
    for (let i = 0; i < n; i++) {
      const cx = (0.12 + R() * 0.76) * w, cy = (0.2 + R() * 0.6) * h;
      const ang = -Math.PI / 2 + (R() - 0.5) * 1.6, len = 4 + R() * 7, rad = 1.6 + R() * 1.6;
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const du = u - cx, dv = v - cy;
      const t = du * ax + dv * ay, q = Math.abs(-du * ay + dv * ax);
      if (t > -rad && t < len && q < rad) {
        const tip = t > len - rad * 1.4 ? (len - t) / (rad * 1.4) : 1;
        if (q < rad * tip) {
          const facet = q / (rad * tip);
          const hh = 3.5 + (1 - facet) * 1.8 + t * 0.15;
          if (hh > bestH) { bestH = hh; best = facet + (t > len - rad * 1.4 ? 2 : 0); }
        }
      }
    }
    if (bestH > 0) {
      o.h = Math.max(o.h, bestH);
      const tip = best >= 2, f = best % 2;
      const glow = 0.55 + (1 - f) * 0.45;
      const hue = hash(s, 3, 7);
      const c = hue < 0.5 ? [90, 220, 255] : [190, 120, 255];
      o.r = c[0] * glow; o.g = c[1] * glow; o.b = c[2] * glow;
      if (tip) { o.r = Math.min(255, o.r * 1.2); o.g = Math.min(255, o.g * 1.2); o.b = Math.min(255, o.b * 1.2); }
      o.spec = 1.5; o.gloss = 0.92; o.emis = 0.35 + (1 - f) * 0.35 - k.cr * 0.3;
      o.a = 1;
    }
  };

  M.coal = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 3);
    o.a = smooth(0.15, 0.8, d);
    const f = worley(u * 0.22, v * 0.22, s + 4);
    const g = fbm(u * 0.35, v * 0.35, s, 5);
    o.h = smooth(0, 2.4, d) * 1.6 + (f[1] - f[0]) * 1.6 + g * 1.2;
    const t = 22 + g * 22 + f[2] * 10;
    o.r = t; o.g = t * 0.96; o.b = t * 0.94;
    const sp = vnoise(u * 4, v * 4, s + 8);
    o.spec = sp > 0.8 ? 1.4 : 0.15; o.gloss = sp > 0.8 ? 0.85 : 0.3;
    o.h -= k.cr * 2;
    if (k.cr > 0) { o.r = mix(o.r, 255, k.cr * 0.7); o.g = mix(o.g, 90, k.cr * 0.7); o.b = mix(o.b, 20, k.cr * 0.7); o.emis = k.cr * 0.6; } // 割れ目の熾火
  };

  M.copper = (u, v, w, h, s, k, o) => {
    M.rock(u, v, w, h, s, k, o);
    const mal = fbm(u * 0.3, v * 0.3, s + 51, 4);
    const band = Math.sin(mal * 30) * 0.5 + 0.5;
    const m = smooth(0.58, 0.66, mal);
    if (m > 0) { o.r = mix(o.r, 40 + band * 50, m); o.g = mix(o.g, 130 + band * 60, m); o.b = mix(o.b, 90 + band * 40, m); o.h += m * 0.5; o.spec = 0.4; o.gloss = 0.5; }
    const nug = worley(u * 0.35, v * 0.35, s + 53);
    const cu = smooth(0.32, 0.18, nug[0]) * (nug[2] > 0.6 ? 1 : 0);
    if (cu > 0) { o.r = mix(o.r, 205, cu); o.g = mix(o.g, 110, cu); o.b = mix(o.b, 60, cu); o.h += cu * 1; o.spec = 1.3; o.gloss = 0.7; }
  };

  M.gold = (u, v, w, h, s, k, o) => {
    M.rock(u, v, w, h, s, k, o);
    o.r *= 0.9; o.g *= 0.8; o.b *= 0.72;
    const g = fbm(u * 0.45, v * 0.45, s + 7, 4);
    const vein = ridged(u * 0.1, v * 0.1, s + 8, 3);
    const gold = Math.max(smooth(0.66, 0.72, g), smooth(0.9, 0.95, vein) * 0.9) * smooth(0, 1.5, o.h);
    if (gold > 0) {
      const gs = 0.8 + vnoise(u * 2, v * 2, s) * 0.4;
      o.h += gold * 0.9;
      o.r = mix(o.r, 240 * gs, gold); o.g = mix(o.g, 180 * gs, gold); o.b = mix(o.b, 70 * gs, gold);
      o.spec = mix(o.spec, 1.6, gold); o.gloss = mix(o.gloss, 0.8, gold);
    }
    // 中央の宝石
    const du = Math.abs(u - w / 2), dv = Math.abs(v - h / 2);
    const gem = 1 - (du / 5 + dv / 4);
    if (gem > 0) {
      o.h = Math.max(o.h, 3 + gem * 2.5);
      const facet = Math.floor(Math.atan2(v - h / 2, u - w / 2) / (Math.PI / 4) + 8) % 2;
      const c = hash(s, 9, 1) < 0.5 ? [170, 18, 40] : [24, 120, 170];
      const kk = 0.7 + facet * 0.45;
      o.r = c[0] * kk; o.g = c[1] * kk; o.b = c[2] * kk;
      o.spec = 2; o.gloss = 0.95; o.emis = 0.18; o.a = 1;
    }
    if (k.cr > 0) { o.r = mix(o.r, 255, k.cr); o.g = mix(o.g, 200, k.cr); o.b = mix(o.b, 90, k.cr); o.emis = Math.max(o.emis, k.cr * 0.9); }
  };

  M.chest = (u, v, w, h, s, k, o) => {
    M.wood(u, v, w, h, s, k, o);
    o.r *= 0.85; o.g *= 0.78; o.b *= 0.7;
    // 鉄の帯と錠前
    const bands = [w * 0.18, w * 0.82];
    let iron = 0;
    for (const bx of bands) if (Math.abs(u - bx) < 2) iron = 1;
    if (Math.abs(v - h * 0.42) < 1) iron = 1;
    if (iron) {
      const t = 0.7 + vnoise(u, v, s) * 0.4;
      o.r = 60 * t; o.g = 58 * t; o.b = 56 * t; o.h += 0.8; o.spec = 0.9; o.gloss = 0.55;
      const rv = vnoise(u * 2, v * 2, s + 3);
      if (rv > 0.7) { o.r = 110; o.g = 60; o.b = 30; o.spec = 0.2; }
    }
    const lx = Math.abs(u - w / 2), ly = Math.abs(v - h * 0.48);
    if (lx < 3 && ly < 3.2) {
      o.h = 3.6 - Math.max(lx, ly) * 0.3;
      o.r = 200; o.g = 150; o.b = 60; o.spec = 1.6; o.gloss = 0.8;
      if (Math.hypot(lx, (v - h * 0.5)) < 0.8) { o.r = 20; o.g = 15; o.b = 10; o.h -= 0.8; }
    }
    if (k.cr > 0) o.emis = Math.max(o.emis, k.cr * 0.6);
  };

  M.tnt = (u, v, w, h, s, k, o) => {
    const d = shape(u, v, w, h, s, 0.3, 3);
    o.a = smooth(0.05, 0.5, d);
    // 樽：縦板＋鉄のたが
    const stave = (u / w) * 6;
    const si = Math.floor(stave), sf = stave - si;
    const curve = Math.sin(Math.PI * u / w);
    const seam = smooth(0, 0.08, Math.min(sf, 1 - sf));
    o.h = curve * 3 + seam * 0.3;
    const paint = 0.75 + vnoise(u * 0.5, v * 2, s + si) * 0.3;
    const worn = smooth(0.6, 0.75, fbm(u * 0.3, v * 0.3, s + 3, 4));
    o.r = mix(170 * paint, 120, worn); o.g = mix(34 * paint, 84, worn); o.b = mix(28 * paint, 52, worn);
    o.r *= 0.6 + seam * 0.4; o.g *= 0.6 + seam * 0.4; o.b *= 0.6 + seam * 0.4;
    o.spec = 0.25; o.gloss = 0.45;
    for (const hy of [h * 0.18, h * 0.82]) {
      if (Math.abs(v - hy) < 1.3) { o.h += 0.6; o.r = 55; o.g = 52; o.b = 50; o.spec = 0.9; o.gloss = 0.5; }
    }
    // 危険マーク（黄色い菱形）
    const dx = Math.abs(u - w / 2), dy = Math.abs(v - h / 2);
    if (dx / 4.2 + dy / 3.6 < 1 && dx / 4.2 + dy / 3.6 > 0.62) { o.r = 230; o.g = 190; o.b = 40; }
    if (k.cr > 0) { o.r = mix(o.r, 255, k.cr); o.g = mix(o.g, 140, k.cr); o.emis = k.cr; }
  };

  const CRACK_STYLE = { glass: 'glass', ice: 'glass', wood: 'grain', chest: 'grain', tnt: 'grain' };
  const BUMP = { glass: 0.8, ice: 1, marble: 0.8, steel: 0.9, obsidian: 1.2, wood: 1.1, brick: 1.3 };
  const BASE_H = { tnt: 4.5, chest: 4.5 };

  // ブロック1枚を焼く。dmg = ひびの段階
  function block(mat, w, h, ps, seed, dmg) {
    const segs = dmg > 0 ? crackSegments(w, h, seed, dmg, CRACK_STYLE[mat]) : null;
    const k = { cr: 0, ce: 0 };
    const f = M[mat];
    return bake(w, h, ps, (u, v, o) => {
      k.cr = 0; k.ce = 0;
      if (segs) {
        const cd = crackAt(segs, u, v);
        k.cr = 1 - smooth(0.15, 0.55, cd);
        k.ce = smooth(0.45, 0.75, cd) * (1 - smooth(0.75, 1.25, cd));
      }
      f(u, v, w, h, seed, k, o);
      // 割れ目の縁は新しい破断面で少し明るい
      if (k.ce > 0 && mat !== 'glass' && mat !== 'ice') { o.r += 26 * k.ce; o.g += 24 * k.ce; o.b += 22 * k.ce; }
    }, { base: BASE_H[mat] ?? 5, bump: BUMP[mat] ?? 1.4, ao: 0.4 });
  }

  // ---------- 背景：坑道の岩壁・木の支柱・松明の台・吊りランタン ----------
  function cave(w, h, ps, fieldTop, wall, fixtures, seed = 7) {
    return bake(w, h, ps, (u, v, o) => {
      const isSide = u < wall || u > w - wall;
      const isBeam = v >= fieldTop - 2 && v < fieldTop + wall;
      if (isSide || isBeam) {
        const along = isSide ? v : u;
        const across = isSide ? (u < wall ? u : w - u) : v - (fieldTop - 2);
        const thick = isSide ? wall : wall + 2;
        const warp = fbm(along * 0.03, across * 0.4, seed + 40, 3) * 6;
        const ring = Math.sin((across * 1.9 + warp) * 2.1) * 0.5 + 0.5;
        const fiber = vnoise(along * 0.08, across * 3, seed + 41);
        const edge = Math.min(across, thick - across);
        o.h = smooth(0, 1.6, edge) * 2.2 + ring * 0.2 + fiber * 0.25 + 1.2;
        const kk = 0.55 + ring * 0.25 + fiber * 0.3;
        o.r = 120 * kk; o.g = 82 * kk; o.b = 50 * kk;
        o.spec = 0.08; o.gloss = 0.3;
        const nail = Math.hypot(across - thick / 2, (along % 90) - 45);
        if (nail < 1.1) { o.h += 0.7; o.r = o.g = o.b = 64; o.spec = 0.8; o.gloss = 0.6; }
        return;
      }
      const big = ridged(u * 0.011, v * 0.011, seed, 6);
      const f = worley(u * 0.022, v * 0.022, seed + 2);
      const mid = fbm(u * 0.04, v * 0.04, seed + 3, 6);
      const fine = vnoise(u * 0.7, v * 0.7, seed + 5);
      const strata = fbm(u * 0.01, v * 0.06, seed + 8, 3);
      o.h = big * 7 + smooth(0, 0.6, f[1] - f[0]) * 1.2 + mid * 2.6 + strata * 1.5 + fine * 0.15;
      const low = fbm(u * 0.006, v * 0.006, seed + 9, 2);
      const kk = 0.42 + mid * 0.55 + big * 0.3 + f[2] * 0.08;
      o.r = (68 + low * 14) * kk; o.g = (63 + low * 8) * kk; o.b = (60 + low * 3) * kk;
      o.spec = 0.06; o.gloss = 0.25;
      // 湿った筋（水が伝った跡）
      const wet = smooth(0.8, 0.92, ridged(u * 0.05, v * 0.004, seed + 30, 2)) * smooth(0.3, 0.6, fbm(u * 0.02, v * 0.02, seed + 31, 2));
      if (wet > 0) { o.r *= 1 - wet * 0.3; o.g *= 1 - wet * 0.28; o.b *= 1 - wet * 0.25; o.spec = 0.06 + 0.3 * wet; o.gloss = 0.25 + 0.4 * wet; }
      const vein = ridged(u * 0.02 + 3, v * 0.02, seed + 12, 3);
      if (vein > 0.9) { const t = (vein - 0.9) * 10; o.r += 40 * t; o.g += 26 * t; o.b += 8 * t; o.spec = Math.max(o.spec, 0.4 * t); o.gloss = 0.5; }
      // 松明の金具とランタン
      for (const fx of fixtures) {
        const du = u - fx.x, dv = v - fx.y;
        if (fx.kind === 'torch') {
          if (Math.abs(du) < 2.2 && dv > -2 && dv < 12) { o.h = 4 - Math.abs(du) * 0.5; o.r = 70; o.g = 50; o.b = 32; o.spec = 0.15; o.gloss = 0.3; }
          if (Math.abs(du) < 3.6 && Math.abs(dv - 8) < 1.6) { o.h = 4.4; o.r = o.g = o.b = 52; o.spec = 0.9; o.gloss = 0.55; }
        } else if (fx.kind === 'lantern') {
          if (Math.abs(du) < 0.6 && dv < -6 && v > fieldTop + wall - 1) { o.h = 3; o.r = o.g = o.b = 48; o.spec = 0.8; o.gloss = 0.5; }
          const bx = Math.abs(du), by = Math.abs(dv);
          if (bx < 5 && by < 6.5) {
            const frame = bx > 3.8 || by > 5.3 || Math.abs(dv + 5.8) < 0.7;
            o.h = 6 - bx * 0.2;
            if (frame) { o.r = 58; o.g = 50; o.b = 40; o.spec = 0.9; o.gloss = 0.5; }
            else { o.r = 255; o.g = 210; o.b = 140; o.emis = 1; o.spec = 0.5; o.gloss = 0.9; }
          }
        }
      }
    }, { bump: 1.2, ao: 0.3 });
  }

  // ---------- スプライト ----------
  function paddle(w, h, ps) {
    const r = h / 2;
    return bake(w, h, ps, (u, v, o) => {
      const cx = Math.max(r, Math.min(w - r, u));
      const dist = Math.hypot(u - cx, v - r);
      o.a = smooth(r, r - 0.6, dist);
      const t = Math.min(1, dist / r);
      o.h = Math.sqrt(Math.max(0, 1 - t * t)) * 3.2;
      const band = Math.abs(u - w / 2) < 11;
      if (band) {
        const wrap = Math.sin((u + v * 0.9) * 1.6) * 0.5 + 0.5;
        o.h += wrap * 0.45;
        const kk = 0.7 + wrap * 0.3 + vnoise(u * 2, v * 2, 3) * 0.15;
        o.r = 96 * kk; o.g = 58 * kk; o.b = 36 * kk; o.spec = 0.25; o.gloss = 0.4;
      } else {
        const brushed = vnoise(u * 0.08, v * 5, 11) * 0.5 + vnoise(u * 0.3, v * 12, 12) * 0.5;
        const s = 0.8 + brushed * 0.3;
        o.r = 150 * s; o.g = 156 * s; o.b = 166 * s; o.spec = 1.4; o.gloss = 0.7;
        if (Math.abs(Math.abs(u - w / 2) - 12.5) < 1.2) { o.h += 0.5; o.r = 190; o.g = 145; o.b = 70; o.spec = 1.6; o.gloss = 0.8; }
      }
    }, { base: 6, bump: 1, ao: 0.2 });
  }
  function ball(r, ps) {
    const s = r * 2 + 1;
    return bake(s, s, ps, (u, v, o) => {
      const dx = (u - s / 2) / r, dy = (v - s / 2) / r, q = dx * dx + dy * dy;
      o.a = smooth(1.06, 0.92, q);
      o.h = Math.sqrt(Math.max(0, 1 - q)) * r;
      o.r = 170; o.g = 172; o.b = 178; o.spec = 2.2; o.gloss = 0.97;
    }, { base: 8, bump: 1, ao: 0 });
  }
  function coin(ps) {
    return bake(8, 8, ps, (u, v, o) => {
      const d = Math.hypot(u - 4, v - 4);
      o.a = smooth(3.6, 3.2, d);
      o.h = d > 2.8 ? 1.4 : 1 + vnoise(u * 2, v * 2, 3) * 0.3;
      const t = 0.8 + vnoise(u * 3, v * 3, 5) * 0.4;
      o.r = 240 * t; o.g = 185 * t; o.b = 70 * t; o.spec = 1.8; o.gloss = 0.85;
    }, { base: 9, bump: 1.4, ao: 0.2 });
  }
  function gem(ps, hue) {
    return bake(9, 9, ps, (u, v, o) => {
      const dx = Math.abs(u - 4.5), dy = Math.abs(v - 4.5);
      const d = dx / 4 + dy / 4.2;
      o.a = smooth(1, 0.9, d);
      o.h = (1 - d) * 3;
      const facet = Math.floor(Math.atan2(v - 4.5, u - 4.5) / (Math.PI / 4) + 8) % 2;
      const c = hue === 'red' ? [200, 20, 50] : hue === 'blue' ? [30, 110, 230] : [40, 200, 110];
      const k = 0.7 + facet * 0.4;
      o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.spec = 2.2; o.gloss = 0.97; o.emis = 0.25;
    }, { base: 9, bump: 1, ao: 0 });
  }
  function relic(ps) {
    // 装備品：鉄で縁取られた小箱
    return bake(12, 10, ps, (u, v, o) => {
      const d = shape(u, v, 12, 10, 3, 0, 1.5);
      o.a = smooth(0, 0.5, d);
      o.h = smooth(0, 1.2, d) * 2;
      const edge = d < 1.4;
      if (edge) { o.r = 200; o.g = 160; o.b = 80; o.spec = 1.6; o.gloss = 0.8; }
      else { const t = 0.7 + vnoise(u * 2, v * 4, 9) * 0.4; o.r = 40 * t; o.g = 90 * t; o.b = 140 * t; o.spec = 0.6; o.gloss = 0.6; o.emis = 0.25; }
      if (Math.hypot(u - 6, v - 5) < 1.6) { o.h += 1; o.r = 255; o.g = 230; o.b = 160; o.emis = 0.9; }
    }, { base: 9, bump: 1, ao: 0.2 });
  }

  // 粒子用の2Dスプライト
  function dust(ps) {
    const s = Math.ceil(32 * ps);
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c2 = cv.getContext('2d'), img = c2.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = (x / s) * 2 - 1, v = (y / s) * 2 - 1;
      const n = fbm(x / s * 5, y / s * 5, 77, 4);
      const a = clamp01((1 - Math.hypot(u, v)) * 1.4) * (0.35 + n * 0.9);
      const p = (y * s + x) * 4;
      d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = clamp01(a) * 150;
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }
  function glint(ps) {
    const s = Math.ceil(24 * ps);
    const cv = document.createElement('canvas'); cv.width = cv.height = s;
    const c2 = cv.getContext('2d'), img = c2.createImageData(s, s), d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = Math.abs((x + 0.5) / s * 2 - 1), v = Math.abs((y + 0.5) / s * 2 - 1);
      const a = clamp01(Math.exp(-u * 40) * Math.exp(-v * 2.5) + Math.exp(-v * 40) * Math.exp(-u * 2.5) + Math.exp(-(u * u + v * v) * 30));
      const p = (y * s + x) * 4;
      d[p] = 255; d[p + 1] = 236; d[p + 2] = 190; d[p + 3] = a * 255;
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }
  function flame(ps) {
    const w = Math.ceil(16 * ps), h = Math.ceil(28 * ps);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d'), img = c2.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h;
      const width = Math.sin(Math.PI * Math.pow(v, 0.7)) * (0.3 + v * 0.7);
      const a = clamp01(1 - Math.abs(u) / Math.max(0.01, width)) * clamp01((v - 0.02) * 4);
      const core = clamp01(1 - Math.abs(u) / Math.max(0.01, width * 0.5)) * clamp01((v - 0.45) * 3);
      const p = (y * w + x) * 4;
      d[p] = 255; d[p + 1] = 120 + core * 120 + v * 20; d[p + 2] = 30 + core * 150; d[p + 3] = a * 230;
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }

  return { HMAX, block, cave, paddle, ball, coin, gem, relic, dust, glint, flame, hash, rng, MATERIALS: Object.keys(M) };
})();
