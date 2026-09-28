// 実音に近い効果音をその場で合成する（物理モデル寄りのモーダル合成＋ノイズ＋坑道の残響）。
// 起動時に波形を一度だけ生成して AudioBuffer にしておき、再生時はピッチと定位を少し揺らす。
window.BallAudio = (() => {
  'use strict';

  let ctx = null, out = null, wetIn = null, sr = 44100;
  let enabled = true;
  const bank = {};            // name -> AudioBuffer[]（バリエーション）
  const lastPlay = {};
  let voices = 0;
  let ambience = null;

  // ---------- DSP 補助 ----------
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const white = () => rnd() * 2 - 1;

  // RBJ biquad をバッファに適用
  function biquad(buf, type, f, q = 0.707, from = 0, to = buf.length) {
    const w0 = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // bandpass (peak gain = Q)
    a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = from; i < to; i++) {
      const x = buf[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      buf[i] = y;
    }
    return buf;
  }
  const len = (sec) => Math.max(1, Math.floor(sec * sr));

  // 減衰ノイズ（打撃の瞬間やこすれ）
  function burst(dur, decay, type, f, q, amp = 1) {
    const b = new Float32Array(len(dur));
    for (let i = 0; i < b.length; i++) b[i] = white() * Math.exp(-i / sr / decay);
    if (type) biquad(b, type, f, q);
    if (type === 'bp') for (let i = 0; i < b.length; i++) b[i] /= Math.max(1, q * 0.7);
    for (let i = 0; i < b.length; i++) b[i] *= amp;
    return b;
  }
  // モーダル合成：固有振動の和（金属・木・コイン）
  function modal(dur, f0, ratios, amps, decays, detune = 0.015) {
    const b = new Float32Array(len(dur));
    for (let k = 0; k < ratios.length; k++) {
      const f = f0 * ratios[k] * (1 + (rnd() - 0.5) * detune);
      if (f > sr * 0.45) continue;
      const w = 2 * Math.PI * f / sr, ph = rnd() * 6.28, dc = decays[k];
      for (let i = 0; i < b.length; i++) {
        const t = i / sr;
        b[i] += amps[k] * Math.sin(w * i + ph) * Math.exp(-t / dc) * Math.min(1, i / (sr * 0.0006));
      }
    }
    return b;
  }
  function mixInto(dst, src, at = 0, gain = 1) {
    const o = Math.floor(at * sr);
    for (let i = 0; i < src.length && o + i < dst.length; i++) dst[o + i] += src[i] * gain;
    return dst;
  }
  function thump(dur, f0, f1, decay, amp) {
    const b = new Float32Array(len(dur));
    let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.6));
      ph += 2 * Math.PI * f / sr;
      b[i] = Math.sin(ph) * Math.exp(-t / decay) * amp;
    }
    return b;
  }
  function normalize(b, peak = 0.9) {
    let m = 0;
    for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
    if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
    // 末尾のクリックを消す
    const f = Math.min(b.length, len(0.01));
    for (let i = 0; i < f; i++) b[b.length - 1 - i] *= i / f;
    return b;
  }

  // ---------- 音の設計 ----------
  // 岩が砕ける：打撃の破裂音＋岩の胴鳴り＋低い衝撃＋破片がこぼれる細かな音
  function rock(size) {
    const d = 0.35 + size * 0.35;
    const b = new Float32Array(len(d));
    mixInto(b, burst(0.03, 0.004, 'bp', 2600 + rnd() * 1200, 0.8, 1.0));
    mixInto(b, burst(0.12, 0.03 * size, 'bp', 650 / Math.sqrt(size) + rnd() * 200, 2.2, 1.6));
    mixInto(b, burst(0.2, 0.05 * size, 'lp', 400, 0.7, 0.5));
    mixInto(b, thump(0.15, 180, 70, 0.04 * size, 0.55 * size));
    const n = Math.floor(5 + rnd() * 8 + size * 10);
    for (let i = 0; i < n; i++) {
      const t = 0.015 + Math.pow(rnd(), 1.7) * (0.18 + size * 0.22);
      const a = (0.12 + rnd() * 0.35) * (1 - t / d);
      mixInto(b, burst(0.012, 0.0015 + rnd() * 0.002, 'bp', 1400 + rnd() * 3500, 1.4, a), t);
    }
    return normalize(b, 0.9);
  }
  // 石に硬い球が当たって欠けるだけの音
  function rockChip() {
    const b = new Float32Array(len(0.2));
    mixInto(b, burst(0.02, 0.003, 'bp', 3200 + rnd() * 1500, 1.0, 1));
    mixInto(b, burst(0.06, 0.012, 'bp', 900 + rnd() * 300, 2.5, 1.2));
    for (let i = 0; i < 4; i++) mixInto(b, burst(0.01, 0.0015, 'bp', 2500 + rnd() * 3000, 1.4, 0.2 + rnd() * 0.2), 0.02 + rnd() * 0.1);
    return normalize(b, 0.8);
  }
  // 鉄板を叩く：非調和な固有振動
  function metal(f0, decayMul, amp = 1) {
    const b = new Float32Array(len(1.2 * decayMul));
    mixInto(b, modal(1.2 * decayMul, f0,
      [1, 1.506, 2.27, 2.94, 3.84, 5.1, 6.23, 7.4],
      [1, 0.75, 0.55, 0.5, 0.35, 0.25, 0.18, 0.12],
      [0.42, 0.33, 0.24, 0.2, 0.14, 0.1, 0.07, 0.05].map((x) => x * decayMul), 0.02));
    mixInto(b, burst(0.01, 0.0015, 'hp', 3000, 0.7, 2.2));
    mixInto(b, thump(0.08, 260, 120, 0.02, 0.8));
    for (let i = 0; i < b.length; i++) b[i] *= amp;
    return normalize(b, 0.85);
  }
  function metalBreak() {
    const b = new Float32Array(len(1.4));
    mixInto(b, metal(520 + rnd() * 120, 1.1), 0, 0.9);
    mixInto(b, metal(1100 + rnd() * 300, 0.6), 0.03 + rnd() * 0.03, 0.4);
    mixInto(b, rock(1.6), 0, 0.8);
    // 転がり落ちる金属片
    for (let i = 0; i < 5; i++) mixInto(b, modal(0.12, 2600 + rnd() * 2400, [1, 2.2, 3.7], [1, 0.5, 0.3], [0.05, 0.03, 0.02]), 0.12 + rnd() * 0.5, 0.12 + rnd() * 0.12);
    return normalize(b, 0.95);
  }
  // 鋼球と鋼のパドル：短く高い「キン」＋手応えの低音
  function paddle() {
    const b = new Float32Array(len(0.35));
    mixInto(b, modal(0.35, 2300 + rnd() * 300, [1, 2.76, 5.4, 8.93], [1, 0.5, 0.25, 0.12], [0.11, 0.06, 0.035, 0.02]), 0, 0.7);
    mixInto(b, burst(0.008, 0.001, 'hp', 4000, 0.7, 1.2));
    mixInto(b, thump(0.06, 220, 110, 0.012, 1.0));
    return normalize(b, 0.8);
  }
  // 木の支柱に当たる「コツ」
  function wood() {
    const b = new Float32Array(len(0.2));
    mixInto(b, modal(0.2, 360 + rnd() * 80, [1, 2.62, 4.2, 6.1], [1, 0.6, 0.35, 0.2], [0.035, 0.022, 0.014, 0.01], 0.04));
    mixInto(b, burst(0.02, 0.003, 'bp', 1800, 1.2, 1.4));
    return normalize(b, 0.6);
  }
  // 金貨が散らばる音
  function coins() {
    const b = new Float32Array(len(1.2));
    mixInto(b, rock(0.8), 0, 0.6);
    const n = 9 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) {
      const t = 0.03 + Math.pow(rnd(), 1.4) * 0.55;
      const f = 3000 + rnd() * 2600;
      mixInto(b, modal(0.4, f, [1, 1.62, 2.51, 3.6, 4.8], [1, 0.7, 0.5, 0.3, 0.2],
        [0.28, 0.2, 0.13, 0.09, 0.06].map((x) => x * (0.4 + rnd() * 0.7))), t, (0.25 + rnd() * 0.35) * (1 - t * 0.9));
    }
    return normalize(b, 0.9);
  }
  // 鐘（レベルアップ）
  function bell(f0, dur = 2.2) {
    const b = new Float32Array(len(dur));
    mixInto(b, modal(dur, f0, [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011, 4.166],
      [0.6, 1, 0.7, 0.5, 0.55, 0.3, 0.25, 0.2, 0.12],
      [1.6, 1.1, 0.8, 0.6, 0.5, 0.35, 0.3, 0.25, 0.15].map((x) => x * dur / 2.2), 0.004));
    mixInto(b, burst(0.01, 0.001, 'hp', 3000, 0.7, 0.6));
    return normalize(b, 0.8);
  }
  // 球が坑道の奥へ落ちる：風切り＋遠くの着地音
  function fall() {
    const b = new Float32Array(len(1.6));
    const w = new Float32Array(len(0.7));
    for (let i = 0; i < w.length; i++) w[i] = white() * Math.sin(Math.PI * i / w.length);
    for (let s = 0; s < w.length; s += 256) {
      const t = s / w.length;
      biquad(w, 'bp', 1600 - 1300 * t, 3, s, Math.min(w.length, s + 256));
    }
    mixInto(b, w, 0, 0.5);
    mixInto(b, thump(0.5, 90, 45, 0.12, 1.0), 0.75);
    mixInto(b, burst(0.4, 0.1, 'lp', 300, 0.7, 0.8), 0.75);
    return normalize(b, 0.85);
  }
  // 大崩落（全破壊）
  function collapse() {
    const b = new Float32Array(len(2.5));
    const r = new Float32Array(len(2.2));
    let y = 0;
    for (let i = 0; i < r.length; i++) { y = y * 0.995 + white() * 0.05; r[i] = y * Math.min(1, i / (sr * 0.05)) * Math.exp(-i / sr / 0.7); }
    biquad(r, 'lp', 220);
    mixInto(b, r, 0, 3);
    for (let i = 0; i < 6; i++) mixInto(b, rock(1.4 + rnd()), rnd() * 0.9, 0.35);
    return normalize(b, 0.95);
  }
  // 坑道の環境音：低い空気のうなり＋遠くの水滴（ループ）
  function ambient() {
    const dur = 9, b = new Float32Array(len(dur));
    let y = 0;
    for (let i = 0; i < b.length; i++) { y = y * 0.998 + white() * 0.02; b[i] = y; }
    biquad(b, 'lp', 160);
    const wind = new Float32Array(b.length);
    for (let i = 0; i < b.length; i++) wind[i] = white() * (0.5 + 0.5 * Math.sin(2 * Math.PI * i / b.length * 2)) * 0.05;
    biquad(wind, 'bp', 380, 1.5);
    mixInto(b, wind);
    for (let k = 0; k < 4; k++) {
      const t = 0.5 + rnd() * (dur - 1.5);
      const d = new Float32Array(len(0.15));
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const tt = i / sr;
        ph += 2 * Math.PI * (900 + 1500 * Math.min(1, tt / 0.012)) / sr;
        d[i] = Math.sin(ph) * Math.exp(-tt / 0.035);
      }
      mixInto(b, d, t, 0.05 + rnd() * 0.05);
    }
    // 継ぎ目なくループさせるため末尾を先頭へクロスフェード
    const xf = len(0.5);
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      b[i] = b[i] * a + b[b.length - xf + i] * (1 - a);
    }
    return b.slice(0, b.length - xf);
  }
  // 坑道の残響（初期反射＋こもっていく減衰）
  function impulse() {
    const n = len(2.4);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const a = 0.85 - 0.75 * Math.min(1, t / 1.6);
        y += a * (white() - y);
        d[i] = y * Math.exp(-t / 0.55);
      }
      for (const [t, g] of [[0.011, 0.5], [0.023, 0.35], [0.037, 0.3], [0.052, 0.22], [0.071, 0.18]]) d[Math.floor((t + ch * 0.003) * sr)] += g;
    }
    return buf;
  }

  function toBuffer(arr) {
    const b = ctx.createBuffer(1, arr.length, sr);
    b.getChannelData(0).set(arr);
    return b;
  }
  // 生成に時間がかかるので、よく使う音から少しずつ作る（タップ直後に固まらないように）
  function build() {
    const jobs = [
      ['paddle', paddle, 4], ['rockBreak', () => rock(1), 4], ['wood', wood, 3], ['rockChip', rockChip, 3],
      ['metalHit', () => metal(700 + rnd() * 250, 0.8), 3],
      ['treasureCrack', () => { const b = rockChip(); return mixInto(b, modal(0.2, 4200, [1, 1.6, 2.5], [1, 0.6, 0.3], [0.12, 0.08, 0.05]), 0.01, 0.4); }, 2],
      ['coins', coins, 2], ['metalBreak', metalBreak, 2], ['fall', fall, 1], ['levelUp', () => bell(523), 1],
      ['equip', () => bell(784, 1.4), 1], ['collapse', collapse, 1],
      ['over', () => { const b = new Float32Array(len(3)); mixInto(b, bell(196, 2.8), 0, 0.8); mixInto(b, collapse(), 0, 0.6); return normalize(b, 0.9); }, 1],
      ['ambient', ambient, 1],
    ];
    const step = () => {
      const job = jobs.shift();
      if (!job) return;
      const [name, fn, n] = job;
      bank[name] = Array.from({ length: n }, () => toBuffer(fn()));
      if (name === 'ambient') startAmbience();
      setTimeout(step, 0);
    };
    step();
  }

  function init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    sr = ctx.sampleRate;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    out = ctx.createGain();
    out.gain.value = 0.85;
    out.connect(comp); comp.connect(ctx.destination);
    const conv = ctx.createConvolver();
    conv.buffer = impulse();
    const wetOut = ctx.createGain();
    wetOut.gain.value = 0.5;
    wetIn = ctx.createGain();
    wetIn.connect(conv); conv.connect(wetOut); wetOut.connect(out);
    build();
    return true;
  }

  function play(name, opt = {}) {
    if (!enabled || !ctx || !bank[name]) return;
    const now = ctx.currentTime;
    // 多球時に同じ音が重なりすぎないよう間引く
    if (lastPlay[name] && now - lastPlay[name] < (opt.gap ?? 0.03)) return;
    if (voices > 20) return;
    lastPlay[name] = now;
    const list = bank[name];
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = (opt.rate ?? 1) * (1 + (Math.random() - 0.5) * (opt.vary ?? 0.08));
    const g = ctx.createGain();
    g.gain.value = opt.vol ?? 1;
    let node = g;
    if (ctx.createStereoPanner && opt.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opt.pan));
      g.connect(p); node = p;
    }
    src.connect(g);
    node.connect(out);
    const send = ctx.createGain();
    send.gain.value = opt.wet ?? 0.35;
    node.connect(send); send.connect(wetIn);
    voices++;
    src.onended = () => { voices--; };
    src.start(now + (opt.delay ?? 0));
  }

  function startAmbience() {
    if (!ctx || ambience || !bank.ambient) return;
    const src = ctx.createBufferSource();
    src.buffer = bank.ambient[0];
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.55;
    src.connect(g); g.connect(out);
    const send = ctx.createGain(); send.gain.value = 0.4; g.connect(send); send.connect(wetIn);
    src.start();
    ambience = { src, g };
  }

  return {
    unlock() {
      if (!ctx && !init()) return;
      if (ctx.state === 'suspended') ctx.resume();
      startAmbience();
    },
    play,
    get enabled() { return enabled; },
    set enabled(v) {
      enabled = v;
      if (ambience) ambience.g.gain.value = v ? 0.55 : 0;
    },
  };
})();
