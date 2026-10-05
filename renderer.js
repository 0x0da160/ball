// WebGL の照明：素材マップ（色・法線・高さ・鏡面）と実際の光源の位置から毎フレーム陰影を計算する。
// 固定光源（ランタン・松明）の影は高さマップを光源へ向かって辿るソフトシャドウで、ブロックが変わった時だけ焼き直す。
// 球とパドルの影は毎フレーム解析的に落とす。
window.BallGL = (() => {
  'use strict';
  const MAXL = 8, MAXO = 20;

  const VS = `
attribute vec2 aPos; attribute vec2 aUV;
uniform vec4 uXf; // 論理座標 → クリップ座標 (sx, sy, tx, ty)
varying vec2 vUV; varying vec2 vW;
void main(){ vUV = aUV; vW = aPos; gl_Position = vec4(aPos.x*uXf.x+uXf.z, aPos.y*uXf.y+uXf.w, 0.0, 1.0); }`;

  const LIGHTING = `
uniform vec3 uLP[${MAXL}]; uniform vec3 uLC[${MAXL}]; uniform float uLR[${MAXL}]; uniform int uNL;
uniform vec4 uOcc[${MAXO}]; uniform int uNO;
uniform vec3 uAmb; uniform float uHmax;
float occShadow(vec3 P, vec3 l, float d){
  float s = 1.0;
  for (int j=0;j<${MAXO};j++){ if (j>=uNO) break;
    vec3 C = uOcc[j].xyz - P; float t = dot(C,l);
    if (t>0.0 && t<d){ float dist = length(C - l*t); float r = uOcc[j].w; s *= mix(0.25, 1.0, smoothstep(r*0.4, r + t*0.08 + 1.5, dist)); }
  }
  return s;
}
vec3 shade(vec3 P, vec3 N, vec3 alb, vec4 m, vec3 sh, bool useShadow, float env){
  float spec = m.r*2.0, gloss = m.g, emis = m.b;
  float shin = exp2(gloss*10.0+1.0);
  vec3 specTint = mix(vec3(1.0), alb/max(max(alb.r,alb.g),max(alb.b,0.04)), 0.55);
  vec3 col = alb*uAmb*(0.55+0.45*(0.5-N.y*0.5));
  for (int i=0;i<${MAXL};i++){ if (i>=uNL) break;
    vec3 L = uLP[i]-P; float d = length(L); vec3 l = L/d;
    float att = 1.0/(1.0 + d*d/(uLR[i]*uLR[i]));
    float ndl = max(dot(N,l),0.0);
    float s = 1.0;
    if (i<3){ if (useShadow) s = i==0 ? sh.r : (i==1 ? sh.g : sh.b); s *= occShadow(P,l,d); }
    vec3 Hv = normalize(l+vec3(0.0,0.0,1.0));
    float sp = spec*pow(max(dot(N,Hv),0.0),shin)*(shin+6.0)/30.0;
    col += (alb*ndl + specTint*sp)*uLC[i]*att*s;
  }
  if (env>0.0){
    vec3 R = reflect(vec3(0.0,0.0,-1.0), N);
    float hz = smoothstep(0.35,0.0,abs(R.y+0.05));
    vec3 e = mix(vec3(0.05,0.045,0.04), vec3(0.9,0.62,0.32), hz) + vec3(0.12)*smoothstep(-0.2,-0.9,R.y);
    col += e*env*specTint*(0.35+0.65*pow(1.0-N.z,2.0));
  }
  col += alb*emis*4.0;
  col = (col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  return sqrt(clamp(col,0.0,1.0));
}`;

  const FS_SCENE = `
precision highp float;
uniform sampler2D uAlb, uNrm, uMat, uShd; uniform vec2 uSize;
varying vec2 vUV; varying vec2 vW;
${LIGHTING}
void main(){
  vec4 a = texture2D(uAlb, vUV), n4 = texture2D(uNrm, vUV), m = texture2D(uMat, vUV);
  vec3 N; N.xy = n4.xy*2.0-1.0; N.z = sqrt(max(0.0,1.0-dot(N.xy,N.xy)));
  vec3 P = vec3(vW, n4.z*uHmax);
  gl_FragColor = vec4(shade(P, N, a.rgb*a.rgb, m, texture2D(uShd, vUV).rgb, true, 0.0), 1.0);
}`;

  const FS_SPRITE = `
precision highp float;
uniform sampler2D uAlb, uNrm, uMat; uniform vec2 uRot; uniform float uEnv, uAlpha, uLift; uniform vec3 uTint;
varying vec2 vUV; varying vec2 vW;
${LIGHTING}
void main(){
  vec4 a = texture2D(uAlb, vUV); if (a.a < 0.01) discard;
  vec4 n4 = texture2D(uNrm, vUV), m = texture2D(uMat, vUV);
  vec2 n = n4.xy*2.0-1.0;
  vec3 N = vec3(n.x*uRot.x - n.y*uRot.y, n.x*uRot.y + n.y*uRot.x, 0.0); N.z = sqrt(max(0.0,1.0-dot(N.xy,N.xy)));
  vec3 P = vec3(vW, n4.z*uHmax + uLift);
  vec3 c = shade(P, N, a.rgb*a.rgb*uTint, m, vec3(1.0), false, uEnv);
  float al = a.a*uAlpha;
  gl_FragColor = vec4(c*al, al);
}`;

  const FS_SHADOW = `
precision highp float;
uniform sampler2D uNrm; uniform vec2 uSize; uniform vec3 uFL[3]; uniform float uHmax;
varying vec2 vUV; varying vec2 vW;
float march(vec3 P, vec3 LP){
  vec2 dv = LP.xy - P.xy; float dist = length(dv); vec2 dir = dv/dist;
  float maxT = min(dist, 110.0); float res = 1.0; float t = 1.2;
  for (int k=0;k<28;k++){
    if (t>maxT) break;
    vec2 q = P.xy + dir*t;
    float hs = texture2D(uNrm, q/uSize).b*uHmax;
    float rh = P.z + (LP.z-P.z)*t/dist;
    if (rh > uHmax) break;
    res = min(res, 5.0*(rh-hs)/t + 0.15);
    t += 0.8 + t*0.12;
  }
  return clamp(res, 0.0, 1.0);
}
void main(){
  float h = texture2D(uNrm, vUV).b*uHmax;
  vec3 P = vec3(vW, h);
  gl_FragColor = vec4(march(P,uFL[0]), march(P,uFL[1]), march(P,uFL[2]), 1.0);
}`;

  function create(canvas) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) return null;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = (fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aUV');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    };
    const P_SCENE = program(FS_SCENE), P_SPRITE = program(FS_SPRITE), P_SHADOW = program(FS_SHADOW);
    const vbo = gl.createBuffer();
    const verts = new Float32Array(16);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const tex = (src) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      return t;
    };

    const st = { W: 360, H: 640, vw: 1, vh: 1, scale: 1, offX: 0, offY: 0, scene: null, shadow: null, fbo: null, sw: 1, sh: 1, fixed: null };
    const lp = new Float32Array(MAXL * 3), lc = new Float32Array(MAXL * 3), lr = new Float32Array(MAXL), oc = new Float32Array(MAXO * 4);

    function quad(x, y, w, h, rot = 0) {
      const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hh = h / 2;
      const pts = [[-hw, -hh, 0, 0], [hw, -hh, 1, 0], [-hw, hh, 0, 1], [hw, hh, 1, 1]];
      for (let i = 0; i < 4; i++) {
        const [px, py, u, v] = pts[i];
        verts[i * 4] = x + px * c - py * s; verts[i * 4 + 1] = y + px * s + py * c;
        verts[i * 4 + 2] = u; verts[i * 4 + 3] = v;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function setXf(prog, sx = 0, sy = 0) {
      // 論理 → ピクセル → クリップ
      const kx = st.scale / st.vw * 2, ky = -st.scale / st.vh * 2;
      gl.uniform4f(prog.u.uXf, kx, ky, (st.offX + sx * st.scale) / st.vw * 2 - 1, 1 - (st.offY + sy * st.scale) / st.vh * 2);
    }

    function setLights(prog, lights, occ, amb) {
      const n = Math.min(MAXL, lights.length);
      for (let i = 0; i < n; i++) {
        const L = lights[i];
        lp[i * 3] = L.x; lp[i * 3 + 1] = L.y; lp[i * 3 + 2] = L.z;
        lc[i * 3] = L.r * L.i; lc[i * 3 + 1] = L.g * L.i; lc[i * 3 + 2] = L.b * L.i;
        lr[i] = L.rad;
      }
      gl.uniform3fv(prog.u.uLP, lp); gl.uniform3fv(prog.u.uLC, lc); gl.uniform1fv(prog.u.uLR, lr);
      gl.uniform1i(prog.u.uNL, n);
      const no = Math.min(MAXO, occ.length);
      for (let i = 0; i < no; i++) { oc[i * 4] = occ[i][0]; oc[i * 4 + 1] = occ[i][1]; oc[i * 4 + 2] = occ[i][2]; oc[i * 4 + 3] = occ[i][3]; }
      gl.uniform4fv(prog.u.uOcc, oc); gl.uniform1i(prog.u.uNO, no);
      gl.uniform3f(prog.u.uAmb, amb[0], amb[1], amb[2]);
      gl.uniform1f(prog.u.uHmax, window.BallMat.HMAX);
    }

    return {
      ok: true,
      resize(vw, vh, W, H, scale, offX, offY) {
        canvas.width = vw; canvas.height = vh;
        Object.assign(st, { vw, vh, W, H, scale, offX, offY });
      },
      // 背景＋ブロックの合成済みマップ
      setScene(alb, nrm, mat) {
        if (st.scene) for (const k in st.scene) gl.deleteTexture(st.scene[k]);
        st.scene = { alb: tex(alb), nrm: tex(nrm), mat: tex(mat) };
        st.sw = Math.max(1, Math.round(alb.width / 2)); st.sh = Math.max(1, Math.round(alb.height / 2));
        if (st.shadow) gl.deleteTexture(st.shadow);
        st.shadow = tex(null);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, st.sw, st.sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        if (!st.fbo) st.fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.shadow, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
      // 一部だけ差し替え（ブロックが割れた・壊れた時）
      updateScene(px, py, alb, nrm, mat) {
        for (const [t, src] of [[st.scene.alb, alb], [st.scene.nrm, nrm], [st.scene.mat, mat]]) {
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, px, py, gl.RGBA, gl.UNSIGNED_BYTE, src);
        }
      },
      // 固定光源の影を焼き直す
      bakeShadows(fixed) {
        st.fixed = fixed;
        const p = P_SHADOW;
        gl.bindFramebuffer(gl.FRAMEBUFFER, st.fbo);
        gl.viewport(0, 0, st.sw, st.sh);
        gl.disable(gl.BLEND);
        gl.useProgram(p.p);
        gl.uniform4f(p.u.uXf, 2 / st.W, 2 / st.H, -1, -1); // FBO はテクスチャ座標と同じ向き
        gl.uniform2f(p.u.uSize, st.W, st.H);
        const f = new Float32Array(9);
        for (let i = 0; i < 3; i++) { const L = fixed[i] || { x: -1e4, y: -1e4, z: 1e4 }; f[i * 3] = L.x; f[i * 3 + 1] = L.y; f[i * 3 + 2] = L.z; }
        gl.uniform3fv(p.u.uFL, f);
        gl.uniform1f(p.u.uHmax, window.BallMat.HMAX);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st.scene.nrm); gl.uniform1i(p.u.uNrm, 0);
        verts.set([0, 0, 0, 0, st.W, 0, 1, 0, 0, st.H, 0, 1, st.W, st.H, 1, 1]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
      sprite(maps) { return { alb: tex(maps.alb), nrm: tex(maps.nrm), mat: tex(maps.mat), w: maps.w, h: maps.h }; },
      freeSprite(s) { if (s) { gl.deleteTexture(s.alb); gl.deleteTexture(s.nrm); gl.deleteTexture(s.mat); } },
      // 1フレーム描画
      frame(f) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, st.vw, st.vh);
        gl.clearColor(0.02, 0.02, 0.025, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        if (!st.scene) return;
        let p = P_SCENE;
        gl.disable(gl.BLEND);
        gl.useProgram(p.p);
        setXf(p, f.sx, f.sy);
        gl.uniform2f(p.u.uSize, st.W, st.H);
        setLights(p, f.lights, f.occluders, f.ambient);
        const bind = (unit, t, name, prog) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u[name], unit); };
        bind(0, st.scene.alb, 'uAlb', p); bind(1, st.scene.nrm, 'uNrm', p); bind(2, st.scene.mat, 'uMat', p); bind(3, st.shadow, 'uShd', p);
        verts.set([0, 0, 0, 0, st.W, 0, 1, 0, 0, st.H, 0, 1, st.W, st.H, 1, 1]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        p = P_SPRITE;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(p.p);
        setXf(p, f.sx, f.sy);
        setLights(p, f.lights, [], f.ambient);
        for (const s of f.sprites) {
          bind(0, s.tex.alb, 'uAlb', p); bind(1, s.tex.nrm, 'uNrm', p); bind(2, s.tex.mat, 'uMat', p);
          const rot = s.rot || 0;
          gl.uniform2f(p.u.uRot, Math.cos(rot), Math.sin(rot));
          gl.uniform1f(p.u.uEnv, s.env || 0);
          gl.uniform1f(p.u.uAlpha, s.alpha ?? 1);
          gl.uniform1f(p.u.uLift, s.lift || 0);
          const t = s.tint || [1, 1, 1];
          gl.uniform3f(p.u.uTint, t[0], t[1], t[2]);
          quad(s.x, s.y, s.w, s.h, rot);
        }
      },
    };
  }
  return { create };
})();
