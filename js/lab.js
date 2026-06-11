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
   4) Page lens, Canvas 2D only:
      a black hole bends a fake page/grid. No WebGL dependency at all.
      Mouse/touch moves the lens; otherwise it drifts slowly.
   ===================================================================== */
register('demo-shader', holder => {
  const H = 340;
  const c = makeCanvas(holder, H);
  const ctx = c.getContext('2d');

  let bh = [.5, .5];
  let target = [.5, .5];
  let drift = true;

  c.addEventListener('pointermove', e => {
    const r = c.getBoundingClientRect();
    target = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    drift = false;
  }, { passive: true });

  c.addEventListener('pointerleave', () => { drift = true; }, { passive: true });

  function drawBentLine(points, px, py) {
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const dx = x - px;
      const dy = y - py;
      const r2 = dx * dx + dy * dy + 650;
      const bend = Math.min(0.22, 2100 / r2);
      const xx = x + dx * bend * 3.7;
      const yy = y + dy * bend * 3.7;
      i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
    });
    ctx.stroke();
  }

  function drawBentText(text, x, y, px, py, font, color, maxWidth) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';

    let cursor = x;
    for (const ch of text) {
      const m = ctx.measureText(ch);
      if (maxWidth && cursor - x > maxWidth) break;

      const gx = cursor + m.width * 0.5;
      const gy = y - 8;
      const dx = gx - px;
      const dy = gy - py;
      const r = Math.hypot(dx, dy) + 1;
      const r2 = r * r + 800;
      const bend = Math.min(0.24, 2600 / r2);
      const xx = cursor + dx * bend * 3.2;
      const yy = y + dy * bend * 3.2;
      const rot = Math.max(-0.18, Math.min(0.18, dx * dy / (r2 * 18)));

      ctx.save();
      ctx.translate(xx, yy);
      ctx.rotate(rot);
      ctx.fillText(ch, 0, 0);
      ctx.restore();

      cursor += m.width;
    }
    ctx.restore();
  }

  function tick(t) {
    if (drift) {
      target = [.5 + .23 * Math.cos(t * .42), .5 + .17 * Math.sin(t * .58)];
    }

    bh[0] += (target[0] - bh[0]) * .055;
    bh[1] += (target[1] - bh[1]) * .055;

    const w = c.clientWidth;
    const h = H;
    const px = bh[0] * w;
    const py = bh[1] * h;

    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#16233e');
    bg.addColorStop(1, '#0b1220');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Bent page grid.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(122,175,222,.13)';
    for (let x = -60; x <= w + 60; x += 44) {
      const pts = [];
      for (let y = -20; y <= h + 20; y += 8) pts.push([x, y]);
      drawBentLine(pts, px, py);
    }
    for (let y = 22; y <= h + 40; y += 44) {
      const pts = [];
      for (let x = -20; x <= w + 20; x += 8) pts.push([x, y]);
      drawBentLine(pts, px, py);
    }

    // Soft fake stars / page points.
    for (let i = 0; i < 75; i++) {
      const sx = (i * 83 + 37) % Math.max(w, 1);
      const sy = (i * 47 + 19) % h;
      const dx = sx - px;
      const dy = sy - py;
      const r2 = dx * dx + dy * dy + 700;
      const bend = Math.min(0.18, 1900 / r2);
      const bx = sx + dx * bend * 3.1;
      const by = sy + dy * bend * 3.1;
      const stretch = Math.min(5.0, 1.0 + 7000 / r2);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.0 * stretch, .9, 0, 0, 7);
      ctx.fillStyle = 'rgba(225,235,255,.38)';
      ctx.fill();
      ctx.restore();
    }

    // Distorted page text.
    const titleSize = Math.max(28, Math.min(54, w * .06));
    drawBentText('UNIVERSITAT DE LES ILLES BALEARS', 34, 76, px, py,
      '600 13px IBM Plex Mono, monospace', '#f2762e', w - 68);
    drawBentText('We listen to the', 34, 145, px, py,
      `700 ${titleSize}px Space Grotesk, sans-serif`, '#ffffff', w - 68);
    drawBentText('ringing of spacetime.', 34, 205, px, py,
      `700 ${titleSize}px Space Grotesk, sans-serif`, '#ffffff', w - 68);
    drawBentText('Black holes · gravitational waves · strong-field gravity', 34, 256, px, py,
      '18px Source Sans 3, sans-serif', 'rgba(255,255,255,.62)', w - 68);

    // Einstein-ring hint and shadow.
    const R = Math.min(w, h) * .075;
    const halo = ctx.createRadialGradient(px, py, R * .7, px, py, R * 4.5);
    halo.addColorStop(0, 'rgba(242,118,46,.42)');
    halo.addColorStop(.45, 'rgba(242,118,46,.12)');
    halo.addColorStop(1, 'rgba(242,118,46,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(px, py, R * 4.5, 0, 7);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, R * 1.72, 0, 7);
    ctx.strokeStyle = 'rgba(122,175,222,.25)';
    ctx.lineWidth = 1.1;
    ctx.setLineDash([5, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(px, py, R * 1.42, 0, 7);
    ctx.strokeStyle = 'rgba(255,196,130,.95)';
    ctx.lineWidth = 2;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(px, py, R * 1.05, 0, 7);
    ctx.fillStyle = '#03050a';
    ctx.fill();
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
