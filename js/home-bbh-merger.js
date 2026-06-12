/* =====================================================================
   Fullscreen binary-black-hole merger hero for index.html
   Canvas 2D only: pseudo-3D inspiral, merger, ringdown and GW emission.
   No WebGL, no external dependencies.
   ===================================================================== */
(function () {
  'use strict';

  const canvas = document.getElementById('home-bbh-canvas');
  const hero = document.getElementById('home-hero') || document.querySelector('.hero-fullscreen');
  if (!canvas || !hero) return;

  const ctx = canvas.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR_MAX = 2;

  let W = 1, H = 1, dpr = 1;
  let raf = null, last = 0, time = 0;
  let strain = [];

  const stars = Array.from({ length: 180 }, (_, i) => ({
    x: fract(Math.sin(i * 12.9898) * 43758.5453),
    y: fract(Math.sin(i * 78.233) * 24634.6345),
    r: 0.45 + fract(Math.sin(i * 39.425) * 9999.1) * 1.35,
    a: 0.16 + fract(Math.sin(i * 91.17) * 3311.7) * 0.55
  }));

  function fract(x) { return x - Math.floor(x); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function easeInCubic(x) { return x * x * x; }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }

  function resize() {
    const rect = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    strain = [];
    draw(time || 0, 0);
  }

  function project(p, cx, cy, f) {
    const s = f / (f + p.z);
    return {
      x: cx + p.x * s,
      y: cy + p.y * s,
      z: p.z,
      s
    };
  }

  function rotateOrbit(x, y, z, inc, prec) {
    // Rotate orbital plane by inclination and a slow precession angle.
    const y1 = y * Math.cos(inc) - z * Math.sin(inc);
    const z1 = y * Math.sin(inc) + z * Math.cos(inc);
    const x2 = x * Math.cos(prec) - y1 * Math.sin(prec);
    const y2 = x * Math.sin(prec) + y1 * Math.cos(prec);
    return { x: x2, y: y2, z: z1 };
  }

  function drawBackground(t) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#111d34');
    bg.addColorStop(0.52, '#0b1220');
    bg.addColorStop(1, '#05080f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Faint star field.
    for (const s of stars) {
      const x = s.x * W;
      const y = (s.y * H + t * 3 * (0.25 + s.a)) % H;
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,236,255,${s.a})`;
      ctx.fill();
    }
  }

  function drawWaveShells(t, cx, cy, strength, merger) {
    // Expanding GW shells, shown as tilted ellipses in projection.
    const baseFreq = 0.45 + 1.3 * strength;
    const maxR = Math.max(W, H) * 0.92;
    const tilt = -0.25;

    for (let k = 0; k < 11; k++) {
      const phase = fract(t * baseFreq - k / 11);
      const r = phase * maxR;
      const fade = Math.pow(1 - phase, 1.45);
      const a = (0.04 + 0.14 * strength + 0.20 * merger) * fade;
      if (a < 0.006) continue;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(122,175,222,${a})`;
      ctx.lineWidth = 1.0 + 1.8 * merger;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRadiationPattern(t, cx, cy, phase, strength, merger) {
    // A stylised quadrupolar wave pattern, inspired by NR visualisations.
    const rings = 22;
    const thetaN = 180;
    const maxR = Math.max(W, H) * 0.75;
    const minR = Math.min(W, H) * 0.06;
    const amp = 0.16 + 0.36 * strength + 0.34 * merger;

    for (let j = 0; j < rings; j++) {
      const r = minR + (j / (rings - 1)) * maxR;
      const travel = t * (1.1 + 1.9 * strength) - r * 0.018;
      const envelope = Math.pow(1 - j / rings, 1.2);
      let lastColor = null;
      let drawing = false;

      for (let i = 0; i <= thetaN; i++) {
        const th = (i / thetaN) * Math.PI * 2;
        const quadrupole = Math.sin(2 * (th - phase) - travel * 4.0);
        const colorSign = quadrupole > 0 ? 'orange' : 'blue';
        const rr = r + quadrupole * amp * 13 * envelope;
        const x = cx + Math.cos(th) * rr;
        const y = cy + Math.sin(th) * rr * 0.58;

        if (colorSign !== lastColor || i === 0) {
          if (drawing) ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(x, y);
          lastColor = colorSign;
          drawing = true;
          const a = (0.018 + 0.055 * strength + 0.09 * merger) * envelope;
          ctx.strokeStyle = colorSign === 'orange'
            ? `rgba(242,118,46,${a})`
            : `rgba(122,175,222,${a})`;
          ctx.lineWidth = 0.8;
        } else {
          ctx.lineTo(x, y);
        }
      }
      if (drawing) ctx.stroke();
    }
  }

  function drawOrbitalPlane(cx, cy, phase, sep, inc, prec, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(228,225,218,.10)';
    ctx.lineWidth = 1;

    // Nested ellipses roughly representing the numerical grid / orbital plane.
    for (let k = 1; k <= 5; k++) {
      const R = sep * (0.55 + k * 0.35);
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const th = (i / 160) * Math.PI * 2;
        const p = rotateOrbit(R * Math.cos(th), R * Math.sin(th), 0, inc, prec);
        const q = project(p, cx, cy, 720);
        if (i) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    }

    // Two radial grid lines.
    for (let a = 0; a < Math.PI; a += Math.PI / 4) {
      ctx.beginPath();
      for (let r = 0; r <= sep * 2.2; r += 8) {
        const p = rotateOrbit(r * Math.cos(a), r * Math.sin(a), 0, inc, prec);
        const q = project(p, cx, cy, 720);
        if (r) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTrail(cx, cy, inc, prec, phase, sep, q, t) {
    // Short orbital tracks behind the horizons.
    const steps = 70;
    const m1 = q, m2 = 1, mt = m1 + m2;
    const r1 = sep * (m2 / mt);
    const r2 = sep * (m1 / mt);

    for (let body = 0; body < 2; body++) {
      ctx.beginPath();
      for (let i = 0; i < steps; i++) {
        const s = i / (steps - 1);
        const ph = phase - s * (1.8 + 2.2 * smoothstep(0, 1, 1 - sep / 260));
        const sign = body === 0 ? -1 : 1;
        const r = body === 0 ? r1 : r2;
        const p = rotateOrbit(sign * r * Math.cos(ph), sign * r * Math.sin(ph), 0, inc, prec);
        const P = project(p, cx, cy, 720);
        if (i) ctx.lineTo(P.x, P.y);
        else ctx.moveTo(P.x, P.y);
      }
      ctx.strokeStyle = body === 0 ? 'rgba(242,118,46,.28)' : 'rgba(122,175,222,.24)';
      ctx.lineWidth = body === 0 ? 1.4 : 1.0;
      ctx.stroke();
    }
  }

  function drawHorizon(obj, R, spinAngle, label) {
    const x = obj.x, y = obj.y;
    const radius = R * obj.s;

    const halo = ctx.createRadialGradient(x, y, radius * 0.7, x, y, radius * 3.2);
    halo.addColorStop(0, 'rgba(242,118,46,.18)');
    halo.addColorStop(0.5, 'rgba(122,175,222,.08)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radius * 1.17, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,196,130,.72)';
    ctx.lineWidth = Math.max(1, radius * 0.055);
    ctx.shadowColor = '#f2762e';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const g = ctx.createRadialGradient(
      x - radius * 0.32, y - radius * 0.38, radius * 0.05,
      x, y, radius
    );
    g.addColorStop(0, '#111a2e');
    g.addColorStop(0.54, '#03050b');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Horizon deformation / Ricci-scalar-like shading, decorative.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spinAngle);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(a) * radius * 0.17,
        Math.sin(a) * radius * 0.17,
        radius * 0.45,
        radius * 0.12,
        a,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = `rgba(122,175,222,${0.08 + 0.04 * k})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Small spin arrow.
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = Math.max(1, radius * 0.04);
    ctx.beginPath();
    ctx.moveTo(-radius * 0.18, radius * 0.05);
    ctx.lineTo(radius * 0.25, -radius * 0.18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(radius * 0.25, -radius * 0.18);
    ctx.lineTo(radius * 0.08, -radius * 0.20);
    ctx.lineTo(radius * 0.18, -radius * 0.04);
    ctx.stroke();
    ctx.restore();

    if (label) {
      ctx.font = '11px IBM Plex Mono, monospace';
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.fillText(label, x + radius * 1.35, y - radius * 1.1);
    }
  }

  function drawMergedRemnant(cx, cy, tr, phase) {
    const wR = 2 * Math.PI / 0.72;
    const wI = wR / 4.2;
    const eps = 0.16 * Math.exp(-wI * tr) * Math.cos(wR * tr);
    const R = Math.min(W, H) * 0.055;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(phase * 0.3);

    const halo = ctx.createRadialGradient(0, 0, R, 0, 0, R * 5.0);
    halo.addColorStop(0, 'rgba(242,118,46,.30)');
    halo.addColorStop(0.46, 'rgba(122,175,222,.10)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R * 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.25 * (1 + eps), R * 1.25 * (1 - eps), 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,196,130,.86)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#f2762e';
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.ellipse(0, 0, R * (1 + eps), R * (1 - eps), 0, 0, Math.PI * 2);
    ctx.fillStyle = '#010309';
    ctx.fill();
    ctx.restore();
  }

  function drawWaveform(t, hNow) {
    const y0 = H - 58;
    const maxN = Math.floor(W / 1.55);
    strain.push(hNow);
    if (strain.length > maxN) strain.shift();

    ctx.save();
    const left = Math.max(24, W * 0.05);
    const width = Math.min(W * 0.72, 680);

    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = 'rgba(228,225,218,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y0);
    ctx.lineTo(left + width, y0);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < strain.length; i++) {
      const x = left + (i / Math.max(1, maxN - 1)) * width;
      const y = y0 - strain[i] * 24;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = 'rgba(242,118,46,.82)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.font = '11px IBM Plex Mono, monospace';
    ctx.fillStyle = 'rgba(228,225,218,.55)';
    ctx.fillText('h(t)', left, y0 - 34);
    ctx.restore();
  }

  function drawReadabilityOverlay() {
    const left = ctx.createLinearGradient(0, 0, W * 0.76, 0);
    left.addColorStop(0, 'rgba(7,11,20,.90)');
    left.addColorStop(0.50, 'rgba(7,11,20,.62)');
    left.addColorStop(1, 'rgba(7,11,20,0)');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, W, H);

    const bottom = ctx.createLinearGradient(0, H * 0.58, 0, H);
    bottom.addColorStop(0, 'rgba(7,11,20,0)');
    bottom.addColorStop(1, 'rgba(7,11,20,.92)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 0, W, H);
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, W, H);
    drawBackground(t);

    const cx = W * 0.66;
    const cy = H * 0.47;
    const cycle = 22;
    const tc = t % cycle;
    const tin = 14.2;
    const tmerger = 1.6;
    const q = 3.0; // asymmetric mass ratio for visual clarity

    let phase, sep, strength, mergerBoost, hNow;

    if (tc < tin) {
      const u = tc / tin;
      const uChirp = easeInCubic(u);
      phase = 1.1 + 9.0 * u + 42.0 * uChirp;
      sep = (0.29 * Math.min(W, H)) * (1 - 0.86 * easeOutCubic(u));
      strength = smoothstep(0.05, 0.92, u);
      mergerBoost = 0;
      hNow = (0.10 + 1.1 * strength) * Math.cos(2 * phase);
    } else if (tc < tin + tmerger) {
      const u = (tc - tin) / tmerger;
      phase = 52.1 + 8.0 * u;
      sep = Math.max(5, 0.04 * Math.min(W, H) * (1 - u));
      strength = 1;
      mergerBoost = Math.sin(Math.PI * u);
      hNow = (1.25 + 0.9 * mergerBoost) * Math.cos(phase * 2.4) * (1 - 0.25 * u);
    } else {
      const tr = tc - tin - tmerger;
      phase = 60.1 + tr * 1.2;
      sep = 0;
      strength = Math.exp(-0.55 * tr);
      mergerBoost = 0;
      hNow = 1.5 * Math.exp(-0.9 * tr) * Math.cos(2 * Math.PI * tr / 0.72);
    }

    const inc = 0.92 + 0.12 * Math.sin(t * 0.22);
    const prec = 0.28 * Math.sin(t * 0.18);

    drawWaveShells(t, cx, cy, strength, mergerBoost);
    drawRadiationPattern(t, cx, cy, phase, strength, mergerBoost);

    if (tc < tin + tmerger * 0.72) {
      drawOrbitalPlane(cx, cy, phase, sep, inc, prec, 0.9);
      drawTrail(cx, cy, inc, prec, phase, Math.max(sep, 16), q, t);

      const m1 = q, m2 = 1, mt = m1 + m2;
      const r1 = sep * (m2 / mt);
      const r2 = sep * (m1 / mt);
      const p1 = rotateOrbit(-r1 * Math.cos(phase), -r1 * Math.sin(phase), 0, inc, prec);
      const p2 = rotateOrbit( r2 * Math.cos(phase),  r2 * Math.sin(phase), 0, inc, prec);
      const P1 = project(p1, cx, cy, 720);
      const P2 = project(p2, cx, cy, 720);

      // Draw far horizon first, near horizon second.
      const objects = [
        { P: P1, R: Math.min(W, H) * 0.040, label: 'm1', spin: phase * 0.5 },
        { P: P2, R: Math.min(W, H) * 0.024, label: 'm2', spin: -phase * 0.8 }
      ].sort((a, b) => a.P.z - b.P.z);

      for (const o of objects) drawHorizon(o.P, o.R, o.spin, o.label);
    } else {
      const tr = Math.max(0, tc - tin - tmerger);
      drawMergedRemnant(cx, cy, tr, phase);
    }

    drawWaveform(t, hNow);
    drawReadabilityOverlay();
  }

  function frame(now) {
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;
    draw(time, dt);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (REDUCED) {
      draw(10.5, 0);
      return;
    }
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    last = 0;
  }

  window.HomeBBHMergerHero = { start, stop, resize, drawStatic: () => draw(10.5, 0) };

  addEventListener('resize', resize, { passive: true });
  resize();

  // Auto-start only if the canvas is already the active visualisation.
  if (!canvas.hidden && !canvas.classList.contains('is-hidden')) start();
})();
