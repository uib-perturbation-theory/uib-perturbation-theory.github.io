/* =====================================================================
   Black hole lab — six animations
   Shared conventions:
   - Every demo registers {start, stop, tick}; an IntersectionObserver
     runs only the demos that are on screen.
   - prefers-reduced-motion: a single static frame is drawn instead.
   - Real Schwarzschild l=2 fundamental mode ratio used throughout:
     omega_R / omega_I = 0.37367 / 0.08896 ~ 4.2  (Q ~ 2.1)
   ===================================================================== */
(function () {
'use strict';

const RATIO = 0.37367 / 0.08896;            // ~4.2
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const ACCENT = '#f2762e', BLUE = '#7aafde';

/* ---------- helpers ---------- */
function makeCanvas(holder, h) {
  const c = document.createElement('canvas');
  holder.appendChild(c);
  function resize() {
    const w = holder.clientWidth;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = w + 'px'; c.style.height = h + 'px';
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener('resize', resize);
  return c;
}
function makeLoop(tick) {
  let id = null, acc = 0, last = 0;
  function frame(now) {
    if (!last) last = now;
    acc += Math.min((now - last) / 1000, .05);
    last = now;
    tick(acc);
    id = requestAnimationFrame(frame);
  }
  return {
    start() { if (id || REDUCED) return; last = 0; id = requestAnimationFrame(frame); },
    stop()  { if (id) cancelAnimationFrame(id); id = null; last = 0; },
    tick
  };
}
const demos = new Map();
const io = new IntersectionObserver(es => es.forEach(e => {
  const d = demos.get(e.target);
  if (d) e.isIntersecting ? d.start() : d.stop();
}), { threshold: .05 });
function register(id, factory) {
  const el = document.getElementById(id);
  if (!el) return;
  const d = factory(el);
  demos.set(el, d);
  io.observe(el);
  if (REDUCED) d.tick(0.62);          // one representative static frame
}
function shadow(ctx, x, y, R, ex, ey, ang) {
  // glow + photon ring + deformed shadow
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang || 0);
  const g = ctx.createRadialGradient(0, 0, R * .6, 0, 0, R * 2.6);
  g.addColorStop(0, 'rgba(242,118,46,.26)');
  g.addColorStop(.5, 'rgba(242,118,46,.07)');
  g.addColorStop(1, 'rgba(242,118,46,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, R * 2.6, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 0, R * 1.12 * ex, R * 1.12 * ey, 0, 0, 7);
  ctx.strokeStyle = 'rgba(255,196,130,.85)'; ctx.lineWidth = 1.6;
  ctx.shadowColor = ACCENT; ctx.shadowBlur = 14; ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath(); ctx.ellipse(0, 0, R * ex, R * ey, 0, 0, 7);
  ctx.fillStyle = '#04060c'; ctx.fill();
  ctx.restore();
}

/* =====================================================================
   1) QNM ringdown: quadrupolar deformation decaying as exp(-t/tau),
      with the true Schwarzschild frequency/damping ratio.
   ===================================================================== */
function qnmDemo(holder) {
  const c = makeCanvas(holder, 300), ctx = c.getContext('2d');
  const wR = 2 * Math.PI / 1.15, wI = wR / RATIO, CYCLE = 6;
  function tick(t) {
    const w = c.clientWidth, h = 300, tc = t % CYCLE;
    ctx.clearRect(0, 0, w, h);
    const R = 58, eps = .2 * Math.exp(-wI * tc) * Math.cos(wR * tc);
    // GW ripples launched every half period while the hole still rings
    for (let k = 0; k < 8; k++) {
      const tk = k * (Math.PI / wR), dt = tc - tk;
      if (dt < 0) continue;
      const amp = Math.exp(-wI * tk), r = R * 1.2 + dt * 130;
      const a = amp * Math.max(0, 1 - dt / 2.2) * .5;
      if (a < .01 || r > w * .7) continue;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, 7);
      ctx.strokeStyle = `rgba(122,175,222,${a})`; ctx.lineWidth = 1.5; ctx.stroke();
    }
    shadow(ctx, w / 2, h / 2, R, 1 + eps, 1 - eps, 0);
    if (tc < .25) {                    // the perturbation that excites it
      ctx.beginPath(); ctx.arc(w / 2, h / 2, R * 1.2 + tc * 90, 0, 7);
      ctx.strokeStyle = `rgba(255,255,255,${.8 * (1 - tc / .25)})`;
      ctx.lineWidth = 2.5; ctx.stroke();
    }
  }
  return makeLoop(tick);
}
register('demo-qnm', qnmDemo);
register('hero-demo-qnm', qnmDemo);

/* =====================================================================
   2) Accretion disk with relativistic beaming: a rotating, inclined disk
      brighter on the approaching side and fainter on the receding side.
   ===================================================================== */
register('demo-disk', holder => {
  const H = 320, c = makeCanvas(holder, H), ctx = c.getContext('2d');
  function tick(t) {
    const w = c.clientWidth, cx = w / 2, cy = H / 2 + 4;
    ctx.fillStyle = '#070d1a'; ctx.fillRect(0, 0, w, H);

    // faint background grid / distant radiation haze
    const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, H) * .55);
    bg.addColorStop(0, 'rgba(242,118,46,.08)');
    bg.addColorStop(1, 'rgba(242,118,46,0)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, H);

    const a0 = Math.min(w * .33, 150), b0 = a0 * .34;
    drawDisk(false);                       // far side: behind the shadow
    shadow(ctx, cx, cy, 54, 1, 1, 0);
    drawDisk(true);                        // near side: in front of the shadow

    // small polar axis cue
    ctx.beginPath(); ctx.moveTo(cx, cy - 105); ctx.lineTo(cx, cy + 105);
    ctx.strokeStyle = 'rgba(228,225,218,.08)'; ctx.setLineDash([4, 10]);
    ctx.stroke(); ctx.setLineDash([]);

    function drawDisk(near) {
      const rings = [0.78, 0.96, 1.14];
      for (const rr of rings) {
        const a = a0 * rr, b = b0 * rr;
        const segs = 190;
        for (let i = 0; i < segs; i++) {
          const th1 = (i / segs) * Math.PI * 2 + t * .78;
          const th2 = ((i + 1) / segs) * Math.PI * 2 + t * .78;
          const mid = (th1 + th2) * .5;
          const isNear = Math.sin(mid) > 0;
          if (isNear !== near) continue;

          // Doppler-like beaming: strongest where material moves toward us.
          const beam = Math.max(0, Math.cos(mid - .35));
          const alpha = .16 + .74 * Math.pow(beam, 1.7);
          const hot = 190 + 60 * beam;
          const x1 = cx + a * Math.cos(th1), y1 = cy + b * Math.sin(th1);
          const x2 = cx + a * Math.cos(th2), y2 = cy + b * Math.sin(th2);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
          ctx.strokeStyle = `rgba(${hot},${118 + 85 * beam},${46 + 40 * beam},${alpha})`;
          ctx.lineWidth = near ? 4.2 : 2.7;
          ctx.stroke();
        }
      }

      // unresolved turbulent clumps riding the disk
      for (let j = 0; j < 28; j++) {
        const rr = .78 + (j % 7) * .065;
        const th = t * (1.15 + .035 * j) + j * 2.399;
        const isNear = Math.sin(th) > 0;
        if (isNear !== near) continue;
        const beam = Math.max(0, Math.cos(th - .35));
        const x = cx + a0 * rr * Math.cos(th), y = cy + b0 * rr * Math.sin(th);
        ctx.beginPath(); ctx.arc(x, y, 1.3 + beam * 1.8, 0, 7);
        ctx.fillStyle = `rgba(255,${170 + 50 * beam},${90 + 60 * beam},${.22 + .55 * beam})`;
        ctx.fill();
      }
    }
  }
  return makeLoop(tick);
});

/* =====================================================================
   3) Gravitational lensing of a drifting starfield (point lens):
      primary + secondary images, tangential stretching, Einstein ring.
   ===================================================================== */
register('demo-lens', holder => {
  const c = makeCanvas(holder, 340), ctx = c.getContext('2d');
  const N = 170, stars = [];
  for (let i = 0; i < N; i++) stars.push({
    x: Math.random(), y: Math.random(),
    v: .006 + Math.random() * .02, m: .35 + Math.random() * .65
  });
  function tick(t) {
    const w = c.clientWidth, h = 340, cx = w / 2, cy = h / 2, tE = 58;
    ctx.fillStyle = '#070d1a'; ctx.fillRect(0, 0, w, h);
    for (const s of stars) {
      const x = ((s.x + s.v * t) % 1) * w, y = s.y * h;
      const dx = x - cx, dy = y - cy, b = Math.hypot(dx, dy) || .001;
      const sq = Math.sqrt(b * b + 4 * tE * tE);
      const rp = (b + sq) / 2, rm = (b - sq) / 2;
      const muT = rp / b, muR = (1 + b / sq) / 2;           // tangential / radial mag.
      const ux = dx / b, uy = dy / b, tang = Math.atan2(dy, dx) + Math.PI / 2;
      drawImg(cx + ux * rp, cy + uy * rp, tang,
              Math.min(muT, 6), muR, s.m * Math.min(muT * muR, 2.2));
      const a2 = s.m * Math.abs(rm / b) * .8;               // faint inner image
      if (Math.abs(rm) > tE * .55 && a2 > .05)
        drawImg(cx - ux * Math.abs(rm), cy - uy * Math.abs(rm), tang, 1.4, 1, a2);
    }
    function drawImg(x, y, ang, st, sr, a) {
      if (Math.hypot(x - cx, y - cy) < tE * .55) return;    // swallowed
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.ellipse(0, 0, 1.1 * st, 1.1 * sr, 0, 0, 7);
      ctx.fillStyle = `rgba(225,235,255,${Math.min(a, 1)})`; ctx.fill();
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(cx, cy, tE, 0, 7);             // Einstein radius (hint)
    ctx.strokeStyle = 'rgba(122,175,222,.10)'; ctx.setLineDash([4, 7]);
    ctx.stroke(); ctx.setLineDash([]);
    shadow(ctx, cx, cy, tE * .5, 1, 1, 0);
  }
  return makeLoop(tick);
});

/* =====================================================================
   4) WebGL lens: a fragment shader bends "the page itself"
      (a texture with the site's hero text). Mouse moves the hole.
   ===================================================================== */
register('demo-shader', holder => {
  const H = 340;
  const cv = makeCanvas(holder, H);
  const gl = cv.getContext('webgl');
  let bh = [.5, .5], target = [.5, .5];
  if (!gl) {
    holder.innerHTML = '<p class="lab-fallback">Your browser does not support WebGL.</p>';
    return { start() {}, stop() {}, tick() {} };
  }
  const vs = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;v.y=1.-v.y;gl_Position=vec4(p,0.,1.);}';
  const fs = `precision mediump float;varying vec2 v;uniform sampler2D t;
    uniform vec2 bh;uniform float asp;
    void main(){
      vec2 d=v-bh; d.x*=asp; float r=length(d); vec2 u=d/max(r,1e-4);
      float rs=.045, rph=.075;
      float defl=rs*rs*2.6/max(r,.02);
      vec2 sp=v-vec2(u.x/asp,u.y)*defl;
      sp=abs(fract(sp*.5+.5)*2.-1.);              // mirror-wrap
      vec3 col=texture2D(t,sp).rgb;
      float ring=smoothstep(.028,.0,abs(r-rph));
      col+=vec3(1.,.62,.3)*ring*.9;
      col*=smoothstep(rph*.92,rph,r);             // shadow
      gl_FragColor=vec4(col,1.);
    }`;
  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s;
  }
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr); gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  // --- texture: a fake page with the group's hero text ---
  const tc = document.createElement('canvas'); tc.width = 1024; tc.height = 512;
  const x = tc.getContext('2d');
  const grad = x.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#16233e'); grad.addColorStop(1, '#0b1220');
  x.fillStyle = grad; x.fillRect(0, 0, 1024, 512);
  x.strokeStyle = 'rgba(122,175,222,.10)';
  for (let i = 0; i < 1024; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke(); }
  for (let i = 0; i < 512;  i += 64) { x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke(); }
  x.fillStyle = '#f2762e'; x.font = '600 22px monospace';
  x.fillText('UNIVERSITAT DE LES ILLES BALEARS', 60, 120);
  x.fillStyle = '#fff'; x.font = '700 84px sans-serif';
  x.fillText('We listen to the', 60, 230);
  x.fillText('ringing of spacetime.', 60, 330);
  x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '28px sans-serif';
  x.fillText('Black holes · gravitational waves · strong-field gravity', 60, 410);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, tc);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const uBh = gl.getUniformLocation(pr, 'bh'), uAsp = gl.getUniformLocation(pr, 'asp');
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect();
    target = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  });
  function tick(t) {
    if (Math.hypot(target[0]-.5, target[1]-.5) < 1e-6 && t > 0)
      target = [.5 + .22 * Math.cos(t * .4), .5 + .18 * Math.sin(t * .6)];
    bh[0] += (target[0] - bh[0]) * .06;
    bh[1] += (target[1] - bh[1]) * .06;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uBh, bh[0], bh[1]);
    gl.uniform1f(uAsp, cv.width / cv.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  let drift = true;
  cv.addEventListener('pointermove', () => drift = false, { once: true });
  const base = makeLoop(t => { if (drift) target = [.5 + .22*Math.cos(t*.4), .5 + .18*Math.sin(t*.6)]; tick(t); });
  return { start: base.start, stop: base.stop, tick };
});

/* =====================================================================
   5) Inspiral -> merger -> ringdown, with the live chirping waveform.
   ===================================================================== */
register('demo-imr', holder => {
  const H = 380, c = makeCanvas(holder, H), ctx = c.getContext('2d');
  const T1 = 7.5, TRING = 3, TPAUSE = 1.2, CYCLE = T1 + TRING + TPAUSE;
  const wR2 = 2 * Math.PI / .55, wI2 = wR2 / RATIO;
  let phi = 0, lastT = 0, wave = [], trail = [];
  function tick(t) {
    const w = c.clientWidth, oy = 150, wy = H - 70;
    const tc = t % CYCLE;
    if (tc < lastT) { phi = 0; wave = []; trail = []; }
    const dt = Math.max(tc - lastT, 0); lastT = tc;
    ctx.fillStyle = '#070d1a'; ctx.fillRect(0, 0, w, H);
    let h = 0;
    if (tc < T1) {                                   // -------- inspiral
      const r = 16 + 88 * Math.pow(1 - tc / T1, .25);
      phi += 230 / Math.pow(r, 1.5) * dt * 60;
      const m1 = .58, m2 = .42;
      const x1 = w/2 + Math.cos(phi) * r * m2, y1 = oy + Math.sin(phi) * r * m2 * .96;
      const x2 = w/2 - Math.cos(phi) * r * m1, y2 = oy - Math.sin(phi) * r * m1 * .96;
      trail.push([x1, y1, x2, y2]); if (trail.length > 90) trail.shift();
      trail.forEach((p, i) => {
        const a = i / trail.length * .35;
        ctx.fillStyle = `rgba(242,118,46,${a})`; ctx.fillRect(p[0], p[1], 1.6, 1.6);
        ctx.fillStyle = `rgba(122,175,222,${a})`; ctx.fillRect(p[2], p[3], 1.6, 1.6);
      });
      bhDot(x1, y1, 13); bhDot(x2, y2, 10);
      h = (26 / r) * Math.cos(2 * phi);
    } else if (tc < T1 + TRING) {                    // -------- ringdown
      const tr = tc - T1;
      const eps = .22 * Math.exp(-wI2 * tr) * Math.cos(wR2 * tr);
      shadow(ctx, w/2, oy, 30, 1 + eps, 1 - eps, phi);
      if (tr < .3) {                                 // merger flash
        ctx.beginPath(); ctx.arc(w/2, oy, 36 + tr * 280, 0, 7);
        ctx.strokeStyle = `rgba(255,255,255,${.9 * (1 - tr / .3)})`;
        ctx.lineWidth = 3; ctx.stroke();
      }
      h = 1.55 * Math.exp(-wI2 * tr) * Math.cos(wR2 * tr + 2 * phi);
    } else {                                         // -------- pause
      shadow(ctx, w/2, oy, 30, 1, 1, 0);
    }
    function bhDot(x, y, R) {
      ctx.beginPath(); ctx.arc(x, y, R * 1.15, 0, 7);
      ctx.strokeStyle = 'rgba(255,196,130,.7)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fillStyle = '#04060c'; ctx.fill();
    }
    // -------- strain strip --------
    wave.push(h); const MAXW = Math.floor(w / 1.25);
    if (wave.length > MAXW) wave.shift();
    ctx.strokeStyle = 'rgba(228,225,218,.25)';
    ctx.beginPath(); ctx.moveTo(0, wy); ctx.lineTo(w, wy); ctx.stroke();
    ctx.beginPath();
    wave.forEach((v, i) => {
      const X = i * 1.25, Y = wy - v * 28;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    });
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = 'rgba(228,225,218,.5)'; ctx.font = '11px monospace';
    ctx.fillText('h(t)', 8, wy - 38);
  }
  return makeLoop(tick);
});

/* =====================================================================
   6) Interactive: the cursor is a passing star. Its tide deforms the
      hole; every kick excites a damped l=2 oscillation + GW ripples.
   ===================================================================== */
register('demo-poke', holder => {
  const H = 320, c = makeCanvas(holder, H), ctx = c.getContext('2d');
  const wR = 2 * Math.PI / 1.0, wI = wR / RATIO;
  let e = 0, v = 0, ang = 0, mouse = null, lastP = null, ripples = [], lastRip = 0;
  c.style.touchAction = 'none';
  c.addEventListener('pointermove', ev => {
    const r = c.getBoundingClientRect();
    const p = [ev.clientX - r.left, ev.clientY - r.top];
    if (lastP) {
      const cx = c.clientWidth / 2, cy = H / 2;
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      const sp = Math.hypot(p[0] - lastP[0], p[1] - lastP[1]);
      if (d < 170) {
        v += Math.min(sp, 24) * (1 - d / 170) * .12;
        ang = Math.atan2(p[1] - cy, p[0] - cx);
      }
    }
    lastP = p; mouse = p;
  });
  c.addEventListener('pointerdown', ev => {
    const r = c.getBoundingClientRect();
    const cx = c.clientWidth / 2, cy = H / 2;
    ang = Math.atan2(ev.clientY - r.top - cy, ev.clientX - r.left - cx);
    v += 2.6;
  });
  let prev = 0;
  function tick(t) {
    const dt = Math.min(t - prev, .05) || .016; prev = t;
    const w = c.clientWidth, cx = w / 2, cy = H / 2;
    // damped oscillator with the Schwarzschild Q
    const a = -wR * wR * e - 2 * wI * v;
    v += a * dt; e += v * dt;
    e = Math.max(-.35, Math.min(.35, e));
    if (Math.abs(e) > .02 && t - lastRip > .28) {
      ripples.push({ t0: t, a: Math.abs(e) }); lastRip = t;
    }
    ctx.fillStyle = '#070d1a'; ctx.fillRect(0, 0, w, H);
    ripples = ripples.filter(rp => t - rp.t0 < 2.4);
    for (const rp of ripples) {
      const dtr = t - rp.t0;
      ctx.beginPath(); ctx.arc(cx, cy, 70 + dtr * 150, 0, 7);
      ctx.strokeStyle = `rgba(122,175,222,${rp.a * (1 - dtr / 2.4)})`;
      ctx.lineWidth = 1.5; ctx.stroke();
    }
    shadow(ctx, cx, cy, 56, 1 + e, 1 - e, ang);
    if (mouse) {                                     // the "star"
      ctx.beginPath(); ctx.arc(mouse[0], mouse[1], 3, 0, 7);
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
      ctx.fill(); ctx.shadowBlur = 0;
    }
    if (Math.abs(e) < .005 && !mouse) {
      ctx.fillStyle = 'rgba(228,225,218,.45)'; ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('move the cursor nearby · click to perturb it', cx, H - 16);
      ctx.textAlign = 'left';
    }
  }
  return makeLoop(tick);
});

})();
