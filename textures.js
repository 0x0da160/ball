// 写実寄りの質感をブラウザ内で生成する。
// 高さマップ＋アルベド＋鏡面反射を計算し、法線からライティングして画像に焼き込む。
// 外部画像を使わないのでライセンスや読み込み待ちが発生しない。
window.BallTex = (() => {
  'use strict';

  // ---------- ノイズ ----------
  function hash(ix, iy, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 982451653);
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
    for (let i = 0; i < oct; i++) {
      t += amp * vnoise(x * f, y * f, seed + i * 131);
      n += amp; amp *= 0.5; f *= 2.03;
    }
    return t / n;
  }
  function ridged(x, y, seed, oct) {
    let amp = 0.5, f = 1, t = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      const v = 1 - Math.abs(vnoise(x * f, y * f, seed + i * 71) * 2 - 1);
      t += amp * v * v;
      n += amp; amp *= 0.5; f *= 2.1;
    }
    return t / n;
  }
  const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // ---------- ライティング ----------
  const L = norm3(-0.45, -0.7, 0.58);           // 左上の灯り
  const HV = norm3(L[0], L[1], L[2] + 1);       // 視線 (0,0,1) とのハーフベクトル
  function norm3(x, y, z) { const m = Math.hypot(x, y, z) || 1; return [x / m, y / m, z / m]; }

  // sampler(u, v, out) は論理座標 (u,v) で out に h, r,g,b, a, spec, shin, sr,sg,sb(鏡面色), er,eg,eb(発光) を書く
  function bake(wL, hL, ps, sampler, opts = {}) {
    const wp = Math.max(1, Math.round(wL * ps)), hp = Math.max(1, Math.round(hL * ps));
    const n = wp * hp;
    const H = new Float32Array(n), A = new Float32Array(n * 3), AL = new Float32Array(n);
    const SP = new Float32Array(n), SH = new Float32Array(n), SC = new Float32Array(n * 3), EM = new Float32Array(n * 3);
    const o = { h: 0, r: 0, g: 0, b: 0, a: 1, spec: 0, shin: 16, sr: 1, sg: 1, sb: 1, er: 0, eg: 0, eb: 0 };
    for (let y = 0; y < hp; y++) {
      for (let x = 0; x < wp; x++) {
        o.h = 0; o.a = 1; o.spec = 0; o.shin = 16; o.sr = o.sg = o.sb = 1; o.er = o.eg = o.eb = 0;
        sampler((x + 0.5) / ps, (y + 0.5) / ps, o);
        const i = y * wp + x;
        H[i] = o.h; AL[i] = o.a; SP[i] = o.spec; SH[i] = o.shin;
        A[i * 3] = o.r; A[i * 3 + 1] = o.g; A[i * 3 + 2] = o.b;
        SC[i * 3] = o.sr; SC[i * 3 + 1] = o.sg; SC[i * 3 + 2] = o.sb;
        EM[i * 3] = o.er; EM[i * 3 + 1] = o.eg; EM[i * 3 + 2] = o.eb;
      }
    }
    const bump = (opts.bump ?? 1.4) * ps / 2; // 高さは論理px単位
    const amb = opts.ambient ?? 0.26, lightI = opts.light ?? 1.0;
    const falloff = opts.falloff; // (u,v) => 明るさ係数
    const cv = document.createElement('canvas');
    cv.width = wp; cv.height = hp;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(wp, hp);
    const d = img.data;
    for (let y = 0; y < hp; y++) {
      const y0 = y > 0 ? y - 1 : y, y1 = y < hp - 1 ? y + 1 : y;
      for (let x = 0; x < wp; x++) {
        const i = y * wp + x;
        const x0 = x > 0 ? x - 1 : x, x1 = x < wp - 1 ? x + 1 : x;
        const dx = (H[y * wp + x1] - H[y * wp + x0]) * bump / Math.max(1, x1 - x0);
        const dy = (H[y1 * wp + x] - H[y0 * wp + x]) * bump / Math.max(1, y1 - y0);
        const nm = Math.hypot(dx, dy, 1);
        const nx = -dx / nm, ny = -dy / nm, nz = 1 / nm;
        const ndl = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const ndh = Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]);
        // 上向きの面ほど環境光を受ける（半球ライティング）
        const hemi = amb * (0.75 - ny * 0.35);
        let lf = lightI;
        if (falloff) lf *= falloff((x + 0.5) / ps, (y + 0.5) / ps);
        const spec = SP[i] * Math.pow(ndh, SH[i]) * lf;
        const k = (hemi + ndl * 0.95) * lf;
        const r = A[i * 3] * k + spec * SC[i * 3] * 255 + EM[i * 3];
        const g = A[i * 3 + 1] * k + spec * SC[i * 3 + 1] * 255 + EM[i * 3 + 1];
        const b = A[i * 3 + 2] * k + spec * SC[i * 3 + 2] * 255 + EM[i * 3 + 2];
        const p = i * 4;
        d[p] = tone(r); d[p + 1] = tone(g); d[p + 2] = tone(b);
        d[p + 3] = Math.round(clamp01(AL[i]) * 255);
      }
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }
  // 白飛びを柔らかくするトーンカーブ
  function tone(v) {
    if (v <= 200) return v < 0 ? 0 : v;
    return 200 + 55 * (1 - Math.exp(-(v - 200) / 70));
  }

  // ---------- ひび割れ ----------
  function crackSegments(w, h, seed, level) {
    const R = rng(seed * 7 + 3);
    const segs = [];
    const walk = (x, y, ang, steps, depth) => {
      for (let s = 0; s < steps; s++) {
        const len = 1.6 + R() * 2.2;
        const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
        segs.push([x, y, nx, ny, depth]);
        x = nx; y = ny;
        if (x < -1 || x > w + 1 || y < -1 || y > h + 1) break;
        ang += (R() - 0.5) * 1.1;
        if (R() < 0.22 && depth > 0.4) walk(x, y, ang + (R() < 0.5 ? 1 : -1) * (0.6 + R() * 0.6), 2 + (R() * 4 | 0), depth * 0.6);
      }
    };
    for (let k = 0; k < level; k++) {
      // 中心付近の着弾点から左右へ走るひび
      const cx = w * (0.3 + R() * 0.4), cy = h * (0.3 + R() * 0.4);
      const base = R() * Math.PI * 2;
      walk(cx, cy, base, 5 + (R() * 5 | 0), 1);
      walk(cx, cy, base + Math.PI + (R() - 0.5), 4 + (R() * 5 | 0), 0.9);
    }
    return segs;
  }
  function crackDist(segs, u, v) {
    let best = 99, bd = 0;
    for (const s of segs) {
      const ax = s[0], ay = s[1], bx = s[2], by = s[3];
      const vx = bx - ax, vy = by - ay;
      const t = clamp01(((u - ax) * vx + (v - ay) * vy) / (vx * vx + vy * vy || 1));
      const dx = u - ax - vx * t, dy = v - ay - vy * t;
      const dd = Math.sqrt(dx * dx + dy * dy) / s[4];
      if (dd < best) { best = dd; bd = s[4]; }
    }
    return [best, bd];
  }

  // ---------- ブロック素材 ----------
  // type: N 岩 / H 金属 / T 宝入り岩
  function block(type, w, h, ps, seed, damage) {
    const segs = damage > 0 ? crackSegments(w, h, seed, damage) : null;
    const hue = hash(seed, 1, 5);
    return bake(w, h, ps, (u, v, o) => {
      const d = Math.min(u, w - u, v, h - v);
      let crack = 0, crackEdge = 0;
      if (segs) {
        const [cd] = crackDist(segs, u, v);
        crack = 1 - smooth(0.15, 0.6, cd);
        crackEdge = smooth(0.5, 0.8, cd) * (1 - smooth(0.8, 1.3, cd));
      }
      if (type === 'H') {
        const dn = d + (vnoise(u * 0.9, v * 0.9, seed) - 0.5) * 0.3;
        o.a = smooth(0.1, 0.6, dn);
        const bevel = smooth(0, 1.8, dn);
        const brushed = vnoise(u * 0.1, v * 4.2, seed + 3) * 0.6 + vnoise(u * 0.3, v * 9, seed + 4) * 0.4;
        const dent = fbm(u * 0.35, v * 0.35, seed + 9, 3);
        let hh = bevel * 0.9 + brushed * 0.05 + dent * 0.12;
        // リベット
        for (const [rx, ry] of [[3.2, h / 2], [w - 3.2, h / 2]]) {
          const rd = Math.hypot(u - rx, v - ry);
          if (rd < 1.6) hh += Math.sqrt(1 - (rd / 1.6) ** 2) * 0.9;
        }
        // 継ぎ目
        const seam = Math.abs(u - w * (0.48 + hue * 0.04));
        if (seam < 0.35) hh -= 0.35;
        const rust = smooth(0.58, 0.74, fbm(u * 0.16, v * 0.16, seed + 11, 4) + (1 - bevel) * 0.1);
        const grime = fbm(u * 0.5, v * 0.5, seed + 13, 3);
        const s = 0.78 + brushed * 0.32 - grime * 0.12;
        o.r = 88 * s; o.g = 94 * s; o.b = 104 * s;
        o.r += (118 - o.r) * rust; o.g += (60 - o.g) * rust; o.b += (32 - o.b) * rust;
        o.spec = 0.85 * (1 - rust * 0.85) * (0.7 + brushed * 0.5);
        o.shin = 38;
        o.sr = 0.9; o.sg = 0.93; o.sb = 1.0;
        hh -= crack * 0.9;
        if (crack > 0) { o.r *= 1 - crack * 0.75; o.g *= 1 - crack * 0.75; o.b *= 1 - crack * 0.75; o.spec *= 1 - crack; }
        o.r += crackEdge * 40; o.g += crackEdge * 40; o.b += crackEdge * 44;
        o.h = hh;
        return;
      }
      // 岩（通常・宝入り）
      const chip = (fbm(u * 0.32, v * 0.32, seed + 5, 3) - 0.5) * 2.6;
      const dn = d + chip;
      o.a = smooth(0.2, 0.75, dn);
      const bevel = smooth(0, 2.6, dn);
      const grain = fbm(u * 0.22, v * 0.22, seed, 5);
      const fine = vnoise(u * 1.7, v * 1.7, seed + 9);
      const fleck = vnoise(u * 2.6, v * 2.6, seed + 21);
      const facets = ridged(u * 0.14, v * 0.14, seed + 17, 3);
      let hh = bevel * 0.85 + grain * 1.1 + facets * 0.9 + fine * 0.14;
      const low = fbm(u * 0.07 + seed, v * 0.07, seed + 2, 2);
      const strata = Math.sin(v * 0.8 + grain * 5 + hue * 6) * 0.06;
      let br = 0.68 + grain * 0.5 + facets * 0.2 + strata;
      if (type === 'T') {
        // 赤茶けた母岩
        o.r = (96 + low * 20) * br; o.g = (74 + low * 10) * br; o.b = (58) * br;
      } else {
        o.r = (100 + (low - 0.5) * 30 + hue * 10) * br; o.g = (95 + (low - 0.5) * 20) * br; o.b = (90 - hue * 8) * br;
      }
      if (fleck > 0.86) { const k = 1 + (fleck - 0.86) * 5; o.r *= k; o.g *= k; o.b *= k; o.spec = 0.35; o.shin = 30; }
      else if (fleck < 0.1) { o.r *= 0.6; o.g *= 0.6; o.b *= 0.62; }
      else { o.spec = 0.06; o.shin = 10; }
      if (type === 'T') {
        // 金の鉱脈と中央の宝石
        const g = fbm(u * 0.5, v * 0.5, seed + 7, 3);
        const vein = ridged(u * 0.12, v * 0.12, seed + 8, 3);
        const gold = Math.max(smooth(0.66, 0.72, g), smooth(0.9, 0.95, vein) * 0.9) * bevel;
        if (gold > 0) {
          hh += gold * 0.7;
          const gs = 0.75 + fine * 0.5;
          o.r += (232 * gs - o.r) * gold; o.g += (172 * gs - o.g) * gold; o.b += (58 * gs - o.b) * gold;
          o.spec = o.spec + (1.3 - o.spec) * gold; o.shin = 55;
          o.sr = 1; o.sg = 0.8; o.sb = 0.45;
        }
        const du = Math.abs(u - w / 2), dv = Math.abs(v - h / 2);
        const gem = 1 - (du / 5.2 + dv / 4.2);
        if (gem > 0) {
          const facet = Math.floor(Math.atan2(v - h / 2, u - w / 2) / (Math.PI / 4) + 8) % 2;
          hh = Math.max(hh, 1.0 + gem * 2.2);
          const gc = hue < 0.5 ? [150, 16, 38] : [20, 110, 150];
          const k = 0.7 + facet * 0.4;
          o.r = gc[0] * k; o.g = gc[1] * k; o.b = gc[2] * k;
          o.spec = 1.8; o.shin = 90; o.sr = o.sg = o.sb = 1;
          o.er = gc[0] * 0.25 * gem; o.eg = gc[1] * 0.25 * gem; o.eb = gc[2] * 0.25 * gem;
        }
      }
      hh -= crack * 1.2;
      if (crack > 0) {
        const k = 1 - crack * 0.8;
        o.r *= k; o.g *= k; o.b *= k;
        if (type === 'T') { o.er += crack * 230; o.eg += crack * 150; o.eb += crack * 40; } // 割れ目から金色の光
      }
      o.r += crackEdge * 30; o.g += crackEdge * 28; o.b += crackEdge * 25;
      o.h = hh;
    }, { bump: type === 'H' ? 1.2 : 2.2 });
  }

  // ---------- 背景：坑道の岩壁と木の支柱 ----------
  function cave(w, h, ps, fieldTop, wall, seed = 7) {
    const cx = w / 2, cy = fieldTop + (h - fieldTop) * 0.25;
    const rMax = Math.hypot(w, h);
    return bake(w, h, ps, (u, v, o) => {
      // 左右の支柱と天井の梁は木材
      const beamTop = v >= fieldTop - 1 && v < fieldTop + wall;
      if (u < wall || u > w - wall || beamTop) {
        const along = beamTop && !(u < wall || u > w - wall) ? u : v;
        const across = beamTop && !(u < wall || u > w - wall) ? v - fieldTop : (u < wall ? u : w - u);
        const warp = fbm(along * 0.03, across * 0.4, seed + 40, 3) * 6;
        const ring = Math.sin((across * 1.9 + warp) * 2.1) * 0.5 + 0.5;
        const grainN = vnoise(along * 0.08, across * 3, seed + 41);
        const edge = Math.min(across, wall - across);
        o.h = smooth(0, 1.4, edge) * 0.8 + ring * 0.15 + grainN * 0.2;
        const k = 0.6 + ring * 0.25 + grainN * 0.3;
        o.r = 130 * k; o.g = 88 * k; o.b = 52 * k;
        // 釘
        const nail = Math.hypot(across - wall / 2, (along % 90) - 45);
        if (nail < 1.1) { o.h += 0.6; o.r = o.g = o.b = 70; o.spec = 0.6; o.shin = 30; }
        o.spec = Math.max(o.spec, 0.05); o.shin = Math.max(o.shin, 8);
        return;
      }
      const big = ridged(u * 0.011, v * 0.011, seed, 5);
      const mid = fbm(u * 0.045, v * 0.045, seed + 3, 4);
      const fine = vnoise(u * 0.6, v * 0.6, seed + 5);
      o.h = big * 5 + mid * 2.2 + fine * 0.25;
      const low = fbm(u * 0.006, v * 0.006, seed + 9, 2);
      const k = 0.55 + mid * 0.5 + big * 0.2;
      o.r = (62 + low * 18) * k; o.g = (55 + low * 10) * k; o.b = (50) * k;
      const vein = ridged(u * 0.02 + 3, v * 0.02, seed + 12, 3);
      if (vein > 0.9) { const t = (vein - 0.9) * 10; o.r += 40 * t; o.g += 26 * t; o.b += 8 * t; o.spec = 0.25 * t; o.shin = 30; }
      if (fine > 0.9) { o.spec = 0.4; o.shin = 40; }
      o.spec = Math.max(o.spec, 0.04); o.shin = Math.max(o.shin, 8);
    }, {
      bump: 1.7, ambient: 0.24,
      // 暗い坑道：中心から離れるほど光が落ちる
      falloff: (u, v) => {
        const dd = Math.hypot(u - cx, (v - cy) * 0.8) / rMax;
        return 0.2 + 0.62 * Math.exp(-dd * dd * 9);
      },
    });
  }

  // ---------- パドル：鋼の棒と革の握り ----------
  function paddle(w, h, ps) {
    const r = h / 2;
    return bake(w, h, ps, (u, v, o) => {
      const cxL = Math.max(r, Math.min(w - r, u));
      const dist = Math.hypot(u - cxL, v - r);
      o.a = smooth(r, r - 0.6, dist);
      const t = Math.min(1, dist / r);
      o.h = Math.sqrt(Math.max(0, 1 - t * t)) * 2.2;
      const band = Math.abs(u - w / 2) < 11;
      if (band) {
        const wrap = Math.sin((u + v * 0.9) * 1.6) * 0.5 + 0.5;
        o.h += wrap * 0.35;
        const k = 0.7 + wrap * 0.3 + vnoise(u * 2, v * 2, 3) * 0.15;
        o.r = 88 * k; o.g = 54 * k; o.b = 34 * k;
        o.spec = 0.18; o.shin = 14;
      } else {
        const brushed = vnoise(u * 0.08, v * 5, 11) * 0.5 + vnoise(u * 0.3, v * 12, 12) * 0.5;
        const s = 0.8 + brushed * 0.3;
        o.r = 120 * s; o.g = 128 * s; o.b = 138 * s;
        o.spec = 1.1; o.shin = 45; o.sr = 0.95; o.sg = 0.98; o.sb = 1;
        // 握りの縁の金具
        if (Math.abs(Math.abs(u - w / 2) - 12.5) < 1.2) { o.h += 0.4; o.r = 150; o.g = 118; o.b = 60; o.spec = 1.3; o.sr = 1; o.sg = 0.8; o.sb = 0.5; }
      }
    }, { bump: 1.0, ambient: 0.3 });
  }

  // ---------- ボール：磨いた鋼球（環境反射） ----------
  function ball(r, ps) {
    const size = Math.ceil((r * 2 + 2) * ps);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(size, size);
    const d = img.data;
    const c = size / 2, R = r * ps;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - c) / R, ny = (y + 0.5 - c) / R;
        const q = nx * nx + ny * ny;
        const p = (y * size + x) * 4;
        if (q > 1.08) { d[p + 3] = 0; continue; }
        const nz = Math.sqrt(Math.max(0, 1 - q));
        // 反射ベクトル R = 2(n·v)n - v, v=(0,0,1)
        const rx = 2 * nz * nx, ry = 2 * nz * ny, rz = 2 * nz * nz - 1;
        // 環境：上は暗い岩天井、水平付近に暖色の灯り、下は暗い床
        let er, eg, eb;
        if (ry < -0.15) { const t = Math.min(1, (-ry - 0.15) * 1.6); er = 150 - 90 * t; eg = 142 - 86 * t; eb = 140 - 80 * t; }
        else if (ry < 0.25) { const t = 1 - Math.abs(ry - 0.05) / 0.2; er = 150 + 100 * t; eg = 142 + 70 * t; eb = 140 + 20 * t; }
        else { er = 70; eg = 64; eb = 60; }
        if (rz < 0) { er *= 0.7; eg *= 0.7; eb *= 0.75; }
        const fres = 0.6 + 0.4 * Math.pow(1 - nz, 3);
        const ndh = Math.max(0, nx * HV[0] + ny * HV[1] + nz * HV[2]);
        const spec = Math.pow(ndh, 140) * 320 + Math.pow(ndh, 20) * 40;
        const base = 0.25 * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]) * 130;
        d[p] = tone(er * fres + spec + base);
        d[p + 1] = tone(eg * fres + spec + base);
        d[p + 2] = tone(eb * fres + spec * 0.95 + base * 1.05);
        d[p + 3] = Math.round(smooth(1.08, 0.92, q) * 255);
      }
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }

  // ---------- 粒子用スプライト ----------
  function dust(ps) {
    const s = Math.ceil(32 * ps);
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = (x / s) * 2 - 1, v = (y / s) * 2 - 1;
      const r = Math.hypot(u, v);
      const n = fbm(x / s * 5, y / s * 5, 77, 4);
      const a = clamp01((1 - r) * 1.4) * (0.35 + n * 0.9);
      const p = (y * s + x) * 4;
      d[p] = 132; d[p + 1] = 122; d[p + 2] = 110; d[p + 3] = Math.round(clamp01(a) * 150);
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }
  function glint(ps) {
    const s = Math.ceil(24 * ps);
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c2 = cv.getContext('2d');
    const img = c2.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const u = Math.abs((x + 0.5) / s * 2 - 1), v = Math.abs((y + 0.5) / s * 2 - 1);
      const star = Math.exp(-u * 40) * Math.exp(-v * 2.5) + Math.exp(-v * 40) * Math.exp(-u * 2.5);
      const core = Math.exp(-(u * u + v * v) * 30);
      const a = clamp01(star * 0.9 + core);
      const p = (y * s + x) * 4;
      d[p] = 255; d[p + 1] = 236; d[p + 2] = 190; d[p + 3] = Math.round(a * 255);
    }
    c2.putImageData(img, 0, 0);
    return cv;
  }

  return { block, cave, paddle, ball, dust, glint, hash, rng };
})();
