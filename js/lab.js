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
register('demo-qnm', holder => {
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
});

/* =====================================================================
   2) Accretion disk: inclined disk with a simple Doppler-beaming cue.
      This is a lightweight 2D illustration, not a ray-traced image.
   ===================================================================== */
register('demo-disk', holder => {
  const H = 340, c = makeCanvas(holder, H), ctx = c.getContext('2d');
  const rings = [0.78, 0.94, 1.10, 1.28, 1.48];
  const streams = [];

  // Deterministic pseudo-random streamlets, so the animation is stable.
  let seed = 17;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 360; i++) {
    streams.push({
      ring: rings[Math.floor(rnd() * rings.length)],
      th: rnd() * Math.PI * 2,
      len: 0.018 + rnd() * 0.030,
      size: 0.75 + rnd() * 1.8,
      heat: 0.55 + rnd() * 0.65,
      speed: 0.34 + rnd() * 0.20
    });
  }

  function drawBackground(w, h) {
    const bg = ctx.createRadialGradient(w * .55, h * .42, 20, w * .5, h * .5, Math.max(w, h) * .75);
    bg.addColorStop(0, '#111d34');
    bg.addColorStop(.46, '#0b1220');
    bg.addColorStop(1, '#050811');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Faint polar glow / numerical-relativity-lab mood.
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.18);
    const jet = ctx.createLinearGradient(0, -h * .52, 0, h * .52);
    jet.addColorStop(0, 'rgba(122,175,222,0)');
    jet.addColorStop(.5, 'rgba(122,175,222,.075)');
    jet.addColorStop(1, 'rgba(122,175,222,0)');
    ctx.fillStyle = jet;
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, h * .58, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }

  function diskPoint(cx, cy, a, b, th, warp) {
    const x = cx + a * Math.cos(th);
    const y = cy + b * Math.sin(th) + warp * Math.sin(2 * th);
    return [x, y];
  }

  function drawStream(cx, cy, a, b, obj, t, front) {
    const th = obj.th + t * obj.speed;
    const ySign = Math.sin(th);
    if (front ? ySign < -0.03 : ySign >= -0.03) return;

    const aa = a * obj.ring, bb = b * obj.ring;
    const warp = 5 * (obj.ring - 1);
    const p0 = diskPoint(cx, cy, aa, bb, th, warp);
    const p1 = diskPoint(cx, cy, aa, bb, th + obj.len, warp);

    // Simple Doppler cue: one side is approaching, therefore boosted.
    // Positive cos(th) is chosen as the approaching side for this illustration.
    const doppler = Math.max(0, Math.cos(th));
    const lensing = 1 + 0.35 * Math.exp(-Math.abs(Math.sin(th)) * 4.0);
    const innerHeat = 1.55 - 0.35 * obj.ring;
    let alpha = (0.10 + 0.62 * Math.pow(doppler, 1.7)) * obj.heat * innerHeat * lensing;
    if (!front) alpha *= 0.58;
    alpha = Math.max(0.035, Math.min(alpha, 0.95));

    const hueMix = Math.min(1, Math.max(0, 1.3 - obj.ring));
    const r = Math.round(255);
    const g = Math.round(118 + 88 * hueMix + 35 * doppler);
    const bl = Math.round(46 + 74 * hueMix + 40 * doppler);

    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha})`;
    ctx.lineWidth = obj.size * (front ? 1.15 : 0.85);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawDiskHalf(cx, cy, a, b, t, front) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Smooth base bands, so the disk reads as a continuous surface.
    for (let k = rings.length - 1; k >= 0; k--) {
      const rr = rings[k], aa = a * rr, bb = b * rr;
      const start = front ? 0 : Math.PI;
      const end = front ? Math.PI : Math.PI * 2;
      const grad = ctx.createLinearGradient(cx - aa, cy, cx + aa, cy);
      grad.addColorStop(0, front ? 'rgba(255,132,55,.18)' : 'rgba(255,132,55,.08)');
      grad.addColorStop(.52, front ? 'rgba(255,207,128,.10)' : 'rgba(255,207,128,.05)');
      grad.addColorStop(1, front ? 'rgba(122,175,222,.06)' : 'rgba(122,175,222,.035)');
      ctx.beginPath();
      ctx.ellipse(cx, cy, aa, bb, 0, start, end);
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(2.4, 7.0 - k * .9);
      ctx.stroke();
    }

    for (const s of streams) drawStream(cx, cy, a, b, s, t, front);
    ctx.restore();
  }

  function drawLabels(w, h, cx, cy, a, b) {
    ctx.save();
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(228,225,218,.55)';
    ctx.textAlign = 'left';
    ctx.fillText('approaching side: Doppler boosted', Math.max(18, cx + a * .42), cy - b * 2.1);
    ctx.textAlign = 'right';
    ctx.fillText('receding side: dimmer', Math.min(w - 18, cx - a * .42), cy + b * 2.25);
    ctx.restore();
  }

  function tick(t) {
    const w = c.clientWidth, h = H;
    const cx = w / 2, cy = h / 2 + 8;
    const a = Math.min(w * .36, 162), b = a * .30;

    drawBackground(w, h);

    // Distant outer disk halo.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, .30);
    const halo = ctx.createRadialGradient(0, 0, a * .28, 0, 0, a * 1.75);
    halo.addColorStop(0, 'rgba(255,196,130,.06)');
    halo.addColorStop(.45, 'rgba(242,118,46,.14)');
    halo.addColorStop(1, 'rgba(242,118,46,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, a * 1.75, 0, 7); ctx.fill();
    ctx.restore();

    // Back half, black-hole shadow, then front half: gives depth.
    drawDiskHalf(cx, cy, a, b, t, false);

    // Photon ring and shadow, slightly in front of the upper disk.
    shadow(ctx, cx, cy, 47, 1.03, 1.00, 0);

    // A thin lensed arc above the shadow, reminiscent of the far side image.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 3, a * .48, b * .70, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.strokeStyle = 'rgba(255,218,151,.50)';
    ctx.lineWidth = 2.1;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();

    drawDiskHalf(cx, cy, a, b, t, true);

    // Small beaming glint on the approaching side.
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    const glint = ctx.createRadialGradient(cx + a * .77, cy - b * .04, 0, cx + a * .77, cy - b * .04, a * .32);
    glint.addColorStop(0, `rgba(255,231,180,${0.22 + .12 * pulse})`);
    glint.addColorStop(.55, `rgba(242,118,46,${0.10 + .06 * pulse})`);
    glint.addColorStop(1, 'rgba(242,118,46,0)');
    ctx.fillStyle = glint;
    ctx.beginPath(); ctx.arc(cx + a * .77, cy - b * .04, a * .34, 0, 7); ctx.fill();

    drawLabels(w, h, cx, cy, a, b);
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
   4) Canvas page lens: a moving black-hole lens bends a fake page texture.
      It deliberately avoids WebGL so the demo works on GitHub Pages, phones
      and restrictive browsers.
   ===================================================================== */
register('demo-shader', holder => {
  const H = 340, c = makeCanvas(holder, H), ctx = c.getContext('2d');
  let target = null, lens = null, drift = true;

  // Off-screen "page" texture. The visible panel is sampled from this image
  // with a simple radial deflection, approximating gravitational lensing.
  const tex = document.createElement('canvas');
  tex.width = 900; tex.height = 440;
  const tx = tex.getContext('2d');

  function drawTexture() {
    const g = tx.createLinearGradient(0, 0, 0, tex.height);
    g.addColorStop(0, '#182742');
    g.addColorStop(1, '#09101d');
    tx.fillStyle = g; tx.fillRect(0, 0, tex.width, tex.height);

    tx.strokeStyle = 'rgba(122,175,222,.14)';
    tx.lineWidth = 1;
    for (let x = 0; x <= tex.width; x += 58) { tx.beginPath(); tx.moveTo(x, 0); tx.lineTo(x, tex.height); tx.stroke(); }
    for (let y = 0; y <= tex.height; y += 58) { tx.beginPath(); tx.moveTo(0, y); tx.lineTo(tex.width, y); tx.stroke(); }

    tx.fillStyle = '#f2762e'; tx.font = '600 20px monospace';
    tx.fillText('GRAVITY  ~  UIB', 55, 98);
    tx.fillStyle = '#fff'; tx.font = '700 58px sans-serif';
    tx.fillText('Black holes bend', 55, 195);
    tx.fillText('light and spacetime.', 55, 265);
    tx.fillStyle = 'rgba(255,255,255,.62)'; tx.font = '24px sans-serif';
    tx.fillText('Move the cursor: the lens follows the page.', 55, 340);

    // A few background stars to make the bending more obvious.
    let s = 9;
    function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (let i = 0; i < 80; i++) {
      const x = rnd() * tex.width, y = rnd() * tex.height, r = .7 + rnd() * 1.4;
      tx.beginPath(); tx.arc(x, y, r, 0, 7);
      tx.fillStyle = `rgba(235,242,255,${.15 + rnd() * .55})`; tx.fill();
    }
  }
  drawTexture();

  c.addEventListener('pointermove', ev => {
    const r = c.getBoundingClientRect();
    target = [ev.clientX - r.left, ev.clientY - r.top];
    drift = false;
  });
  c.addEventListener('pointerleave', () => { drift = true; });

  function sampleLens(w, h, cx, cy) {
    const step = Math.max(5, Math.floor(w / 120));
    const rs = Math.min(w, h) * .075;
    const texScaleX = tex.width / w, texScaleY = tex.height / h;

    ctx.fillStyle = '#07101e'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const dx = x - cx, dy = y - cy;
        const r2 = dx * dx + dy * dy;
        const r = Math.sqrt(r2) + .001;
        const bend = (rs * rs * 2.2) / Math.max(r, rs * .32);
        let sx = x - dx / r * bend;
        let sy = y - dy / r * bend;

        // soft mirror clamp to avoid blank edges
        sx = Math.max(0, Math.min(w - step, sx));
        sy = Math.max(0, Math.min(h - step, sy));
        ctx.drawImage(
          tex,
          sx * texScaleX, sy * texScaleY,
          step * texScaleX + 1, step * texScaleY + 1,
          x, y, step + 1, step + 1
        );
      }
    }
  }

  function tick(t) {
    const w = c.clientWidth, h = H;
    if (!lens) lens = [w / 2, h / 2];
    if (drift || !target) target = [w / 2 + Math.cos(t * .42) * w * .18, h / 2 + Math.sin(t * .63) * h * .18];
    lens[0] += (target[0] - lens[0]) * .08;
    lens[1] += (target[1] - lens[1]) * .08;

    sampleLens(w, h, lens[0], lens[1]);

    const R = Math.min(w, h) * .072;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(lens[0], lens[1], R * 1.55, 0, 7);
    ctx.strokeStyle = 'rgba(255,198,122,.88)';
    ctx.lineWidth = 1.7;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 15;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(lens[0], lens[1], R, 0, 7);
    ctx.fillStyle = '#03050a';
    ctx.fill();

    ctx.fillStyle = 'rgba(228,225,218,.55)'; ctx.font = '11px monospace';
    ctx.fillText('Canvas lens · no WebGL required', 14, h - 16);
  }

  return makeLoop(tick);
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
      ctx.fillText('mueve el cursor cerca · haz clic para perturbarlo', cx, H - 16);
      ctx.textAlign = 'left';
    }
  }
  return makeLoop(tick);
});

})();
