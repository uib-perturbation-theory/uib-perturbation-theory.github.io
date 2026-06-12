/* =====================================================================
   Fullscreen binary-black-hole merger hero — WebGL, no dependencies.

   Inspired by the SXS/LIGO numerical-relativity visualisations:
   a 3D spacetime sheet displaced by the l=m=2 gravitational wave,
   computed in the vertex shader from a physically motivated model:

     - Inspiral:  Newtonian-quadrupole chirp
                    orbital phase  Phi(t) = -C (tc - t)^{5/8}
                    separation     a(t)  ~ (tc - t)^{1/4}
                    amplitude      A(t)  ~ (tc - t)^{-1/4}
     - Ringdown:  damped sinusoid with the Schwarzschild l=2 ratio
                    omega_R / omega_I = 0.37367/0.08896 ~ 4.2 (Q ~ 2.1)
     - Field:     h(r, phi, t) = A(t_ret)/r^p · cos(2 phi - Phi(t_ret)),
                  with retarded time t_ret = t - (r - r_in)/v.
                  The retarded time is what produces the two-armed
                  spiral pattern propagating outward — and lets the
                  wave train keep travelling after the source has
                  rung down, as in the real phenomenon.

   No strain chart is drawn. Camera: slow drift, drag to orbit.
   API kept from the previous version:
     window.HomeBBHMergerHero = { start, stop, resize, drawStatic }
   ===================================================================== */
(function () {
  'use strict';

  const canvas = document.getElementById('home-bbh-canvas');
  const hero = document.getElementById('home-hero') || document.querySelector('.hero-fullscreen');
  if (!canvas || !hero) return;

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) { canvas.style.background = '#0b1220'; return; }

  /* ---------------- physics constants (visual units) ---------------- */
  const RATIO = 0.37367 / 0.08896;        // Schwarzschild l=2: wR/wI
  const TC    = 16.0;                     // merger time within the cycle
  const C_PN  = 4.5;                      // chirp constant
  const XMIN  = 0.06;                     // PN cutoff -> merger
  const WQNM  = 1.4 * 1.25 * C_PN * Math.pow(XMIN, -0.375); // ringdown omega
  const TAU   = RATIO / WQNM;             // ringdown damping time
  const VW    = 2.1;                      // wave propagation speed
  const R_IN  = 0.55, R_OUT = 15.0;       // sheet annulus
  const A_M   = 0.21;                     // source amplitude at merger
  const SEP_M = 0.23;                     // separation at merger
  const FALL  = 0.85;                     // amplitude falloff r^-FALL
  const CYCLE = 26.0;                     // full loop length (s)
  const M1 = 1.45, M2 = 1.0, MT = M1 + M2;

  /* ---------------- tiny mat4 helpers ---------------- */
  function perspective(fov, asp, n, f) {
    const t = 1 / Math.tan(fov / 2), d = 1 / (n - f);
    return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (n + f) * d, -1, 0, 0, 2 * n * f * d, 0];
  }
  function lookAt(eye, at, up) {
    const z = norm3(sub3(eye, at)), x = norm3(cross3(up, z)), y = cross3(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
            -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1];
  }
  function mul4(a, b) {
    const o = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] +
                     a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    return o;
  }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  /* ---------------- shader sources ---------------- */
  const WAVE_GLSL = `
    uniform float uT, uTc, uC, uXmin, uAm, uWqnm, uTau, uV, uRin, uEnv;
    const float FALL = ${FALL.toFixed(3)};

    // GW phase and source amplitude at retarded time tr
    vec2 srcPA(float tr) {
      float x = uTc - tr;
      float phase, amp;
      if (x > uXmin) {                       // inspiral chirp
        phase = -2.0 * uC * pow(x, 0.625);
        amp   = uAm * pow(x / uXmin, -0.25);
      } else {                               // merger -> ringdown
        float dtm = uXmin - x;
        phase = -2.0 * uC * pow(uXmin, 0.625) + uWqnm * dtm;
        amp   = uAm * exp(-dtm / uTau);
      }
      amp *= smoothstep(0.0, 1.6, tr);       // gentle turn-on
      return vec2(phase, amp);
    }

    // h(r, phi, t): retarded time + falloff
    float wave(float r, float phi) {
      float tr = uT - (r - uRin) / uV;
      if (tr <= 0.0) return 0.0;
      vec2 pa = srcPA(tr);
      return uEnv * pa.y / pow(r, FALL) * cos(2.0 * phi - pa.x);
    }
  `;

  const SHEET_VS = WAVE_GLSL + `
    attribute vec2 aPolar;                 // (r, phi)
    uniform mat4 uMVP;
    varying float vH;
    varying vec2 vPolar;
    varying float vDiff;
    void main() {
      float r = aPolar.x, phi = aPolar.y;
      float h = wave(r, phi);
      float e = 0.06;
      float hr = wave(r + e, phi);
      float hp = wave(r, phi + e / max(r, 0.3));
      vec3 Tr = vec3(cos(phi), sin(phi), (hr - h) / e);
      vec3 Tp = vec3(-sin(phi), cos(phi), (hp - h) / e);
      vec3 N  = normalize(cross(Tr, Tp));
      vDiff = clamp(dot(N, normalize(vec3(0.35, -0.45, 0.82))), 0.0, 1.0);
      vH = h * pow(r, FALL) / uAm;
      vPolar = aPolar;
      gl_Position = uMVP * vec4(r * cos(phi), r * sin(phi), h, 1.0);
    }
  `;

  const SHEET_FS = `
    precision mediump float;
    varying float vH;
    varying vec2 vPolar;
    varying float vDiff;
    uniform float uRout;
    void main() {
      float c = clamp(vH * 0.85, -1.0, 1.0);
      vec3 trough = vec3(0.026, 0.066, 0.160);
      vec3 base   = vec3(0.058, 0.118, 0.235);
      vec3 crest  = vec3(0.74, 0.87, 1.00);
      vec3 col = c >= 0.0 ? mix(base, crest, pow(c, 1.05))
                          : mix(base, trough, -c);
      col = mix(col, col * vec3(1.25, 1.02, 0.78),
                smoothstep(3.0, 0.8, vPolar.x) * max(c, 0.0));
      col *= 0.42 + 0.58 * vDiff;
      float gr = abs(fract(log(vPolar.x) * 4.6) - 0.5);
      float gp = abs(fract(vPolar.y * 4.5836) - 0.5);
      float grid = smoothstep(0.46, 0.5, max(gr, gp));
      col += vec3(0.10, 0.16, 0.24) * grid * 0.45;
      float fade = 1.0 - smoothstep(uRout * 0.72, uRout, vPolar.x);
      gl_FragColor = vec4(col, fade);
    }
  `;

  const BG_VS = `
    attribute vec2 p; varying vec2 v;
    void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.9999, 1.0); }
  `;
  const BG_FS = `
    precision mediump float; varying vec2 v;
    float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 col = mix(vec3(0.020, 0.031, 0.059), vec3(0.067, 0.114, 0.204), pow(1.0 - v.y, 1.4));
      vec2 g = floor(v * vec2(160.0, 90.0));
      float h = hash(g);
      if (h > 0.992) {
        vec2 f = fract(v * vec2(160.0, 90.0)) - 0.5;
        float s = smoothstep(0.32, 0.0, length(f));
        col += vec3(0.85, 0.90, 1.0) * s * (0.25 + 0.6 * hash(g + 7.0));
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const BH_VS = `
    attribute vec2 p;
    uniform mat4 uMVP;
    uniform vec3 uC0;
    uniform vec2 uAxes;
    uniform float uAng;
    uniform vec3 uRight, uUp;
    varying vec2 vQ;
    void main(){
      vQ = p;
      float ca = cos(uAng), sa = sin(uAng);
      vec2 q = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
      q *= uAxes;
      vec2 q2 = vec2(q.x * ca + q.y * sa, -q.x * sa + q.y * ca);
      vec3 w = uC0 + uRight * q2.x + uUp * q2.y;
      gl_Position = uMVP * vec4(w, 1.0);
    }
  `;
  const BH_FS = `
    precision mediump float;
    varying vec2 vQ;
    uniform float uAlpha;
    void main(){
      float r = length(vQ);
      if (r > 1.0) discard;
      float disc = smoothstep(0.62, 0.58, r);
      float rim  = smoothstep(0.045, 0.0, abs(r - 0.66));
      float glow = smoothstep(1.0, 0.62, r) * 0.30;
      vec3 col = vec3(1.0, 0.72, 0.42) * rim * 0.95
               + vec3(1.0, 0.62, 0.30) * glow;
      float a = max(disc, max(rim, glow)) * uAlpha;
      gl_FragColor = vec4(col * (1.0 - disc), a);
    }
  `;

  const VEIL_FS = `
    precision mediump float; varying vec2 v;
    void main(){
      float d = distance(v, vec2(0.5, 0.46));
      float a = 0.16 + 0.30 * smoothstep(0.45, 0.95, d);
      gl_FragColor = vec4(0.012, 0.022, 0.047, a);
    }
  `;

  /* ---------------- GL plumbing ---------------- */
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      console.error(gl.getProgramInfoLog(p));
    return p;
  }
  const prSheet = program(SHEET_VS, SHEET_FS);
  const prBg    = program(BG_VS, BG_FS);
  const prBh    = program(BH_VS, BH_FS);
  const prVeil  = program(BG_VS, VEIL_FS);

  const bufTri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const bufQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  // sheet mesh: geometric ring spacing (denser near the source)
  const NR = 110, NP = 168;
  const verts = new Float32Array((NR + 1) * (NP + 1) * 2);
  let k = 0;
  for (let i = 0; i <= NR; i++) {
    const r = R_IN * Math.pow(R_OUT / R_IN, i / NR);
    for (let j = 0; j <= NP; j++) {
      verts[k++] = r;
      verts[k++] = j / NP * Math.PI * 2;
    }
  }
  const idx = new Uint32Array(NR * NP * 6);
  k = 0;
  for (let i = 0; i < NR; i++) for (let j = 0; j < NP; j++) {
    const a = i * (NP + 1) + j, b = a + NP + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = a + 1;
    idx[k++] = a + 1; idx[k++] = b; idx[k++] = b + 1;
  }
  const extIdx = gl.getExtension('OES_element_index_uint');
  const bufV = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufV);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const bufI = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufI);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,
    extIdx ? idx : Uint16Array.from(idx), gl.STATIC_DRAW);
  const IDX_TYPE = extIdx ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  const U = {};
  ['uT','uTc','uC','uXmin','uAm','uWqnm','uTau','uV','uRin','uEnv','uMVP','uRout']
    .forEach(n => U[n] = gl.getUniformLocation(prSheet, n));
  const UB = {};
  ['uMVP','uC0','uAxes','uAng','uRight','uUp','uAlpha']
    .forEach(n => UB[n] = gl.getUniformLocation(prBh, n));

  /* ---------------- camera + interaction ---------------- */
  let W = 1, H = 1;
  let azim = 0.55, elev = 0.40, autoDrift = true;
  let dragging = false, px = 0, py = 0;
  canvas.addEventListener('pointerdown', e => {
    dragging = true; autoDrift = false; px = e.clientX; py = e.clientY;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    azim -= (e.clientX - px) * 0.005;
    elev  = Math.min(1.25, Math.max(0.14, elev + (e.clientY - py) * 0.004));
    px = e.clientX; py = e.clientY;
  });
  canvas.addEventListener('pointerup', () => dragging = false);
  canvas.addEventListener('pointercancel', () => dragging = false);

  function camera() {
    const D = 7.1;
    const eye = [D * Math.cos(elev) * Math.cos(azim),
                 D * Math.cos(elev) * Math.sin(azim),
                 D * Math.sin(elev)];
    const view = lookAt(eye, [0, 0, 0.12], [0, 0, 1]);
    const proj = perspective(38 * Math.PI / 180, W / H, 0.1, 60);
    return {
      mvp: mul4(proj, view),
      right: [view[0], view[4], view[8]],
      up:    [view[1], view[5], view[9]]
    };
  }

  /* ---------------- source kinematics (JS mirror of the shader) ----- */
  function srcOrbPhase(t) {
    const x = Math.max(TC - t, XMIN);
    return -C_PN * Math.pow(x, 0.625);     // orbital phase (GW phase / 2)
  }
  function separation(t) {
    const x = Math.max(TC - t, XMIN);
    return SEP_M * Math.pow(x / XMIN, 0.25);
  }

  /* ---------------- render ---------------- */
  function resize() {
    const rect = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!raf) draw(time);
  }

  function drawBH(cam, c0, rx, ry, ang, alpha) {
    gl.uniformMatrix4fv(UB.uMVP, false, cam.mvp);
    gl.uniform3fv(UB.uC0, c0);
    gl.uniform2f(UB.uAxes, rx, ry);
    gl.uniform1f(UB.uAng, ang);
    gl.uniform3fv(UB.uRight, cam.right);
    gl.uniform3fv(UB.uUp, cam.up);
    gl.uniform1f(UB.uAlpha, alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function draw(t) {
    const tc = t % CYCLE;
    const env = smoothstep(0, 1.2, tc) * (1 - smoothstep(CYCLE - 1.4, CYCLE, tc));
    const cam = camera();

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(prBg);
    bindTri(prBg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- spacetime sheet ----
    gl.useProgram(prSheet);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufV);
    const aP = gl.getAttribLocation(prSheet, 'aPolar');
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufI);
    gl.uniform1f(U.uT, tc);
    gl.uniform1f(U.uTc, TC);
    gl.uniform1f(U.uC, C_PN);
    gl.uniform1f(U.uXmin, XMIN);
    gl.uniform1f(U.uAm, A_M);
    gl.uniform1f(U.uWqnm, WQNM);
    gl.uniform1f(U.uTau, TAU);
    gl.uniform1f(U.uV, VW);
    gl.uniform1f(U.uRin, R_IN);
    gl.uniform1f(U.uEnv, env);
    gl.uniform1f(U.uRout, R_OUT);
    gl.uniformMatrix4fv(U.uMVP, false, cam.mvp);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, idx.length, IDX_TYPE, 0);

    // ---- black holes (billboards above the sheet) ----
    gl.useProgram(prBh);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
    const aQ = gl.getAttribLocation(prBh, 'p');
    gl.enableVertexAttribArray(aQ);
    gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);

    if (tc < TC - XMIN) {
      const phi = srcOrbPhase(tc), a = separation(tc);
      const z = 0.10;
      const p1 = [ a * (M2 / MT) * Math.cos(phi),  a * (M2 / MT) * Math.sin(phi), z];
      const p2 = [-a * (M1 / MT) * Math.cos(phi), -a * (M1 / MT) * Math.sin(phi), z];
      drawBH(cam, p1, 0.155, 0.155, 0, env);
      drawBH(cam, p2, 0.115, 0.115, 0, env);
    } else {
      const dt = tc - (TC - XMIN);
      const eps = 0.32 * Math.exp(-dt / TAU) * Math.cos(WQNM * dt);
      const phiM = srcOrbPhase(TC);
      drawBH(cam, [0, 0, 0.10],
             0.185 * (1 + eps), 0.185 * (1 - eps), phiM, env);
    }

    // ---- readability veil for the hero text ----
    gl.useProgram(prVeil);
    bindTri(prVeil);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function bindTri(pr) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTri);
    const a = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  }
  function smoothstep(a, b, x) {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  }

  /* ---------------- lifecycle (same API as before) ---------------- */
  let raf = null, last = 0, time = 0;
  function frame(now) {
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;
    if (autoDrift && !dragging) azim += dt * 0.045;
    draw(time);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (REDUCED) { time = 12.2; draw(time); return; }
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null; last = 0;
  }

  window.HomeBBHMergerHero = { start, stop, resize, drawStatic: () => { time = 12.2; draw(time); } };

  addEventListener('resize', resize, { passive: true });
  resize();
  if (!canvas.hidden && !canvas.classList.contains('is-hidden')) start();
})();
