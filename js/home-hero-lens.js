/* =====================================================================
   Fullscreen black-hole lens hero for index.html
   Canvas 2D only: no WebGL dependency.
   ===================================================================== */
(function () {
  'use strict';

  const canvas = document.getElementById('home-lens-canvas');
  const hero = document.querySelector('.hero-lens');
  if (!canvas || !hero) return;

  const ctx = canvas.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DPR_MAX = 2;

  let W = 1, H = 1, dpr = 1;
  let target = [0.68, 0.52];
  let bh = [0.68, 0.52];
  let pointerActive = false;
  let raf = null, last = 0, time = 0;

  const stars = Array.from({ length: 150 }, (_, i) => ({
    x: fract(Math.sin(i * 12.9898) * 43758.5453),
    y: fract(Math.sin(i * 78.233) * 24634.6345),
    r: 0.5 + fract(Math.sin(i * 39.425) * 9999.1) * 1.4,
    a: 0.18 + fract(Math.sin(i * 91.17) * 3311.7) * 0.55,
    v: 0.004 + fract(Math.sin(i * 17.31) * 1111.3) * 0.018
  }));

  function fract(x) { return x - Math.floor(x); }

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
    draw(time || 0);
  }

  function bendPoint(x, y, px, py, strength) {
    const dx = x - px;
    const dy = y - py;
    const r2 = dx * dx + dy * dy + 900;
    const bend = Math.min(0.26, strength / r2);
    return [x + dx * bend * 4.2, y + dy * bend * 4.2];
  }

  function drawBentLine(points, px, py, strength) {
    ctx.beginPath();
    points.forEach(([x, y], i) => {
      const [xx, yy] = bendPoint(x, y, px, py, strength);
      if (i) ctx.lineTo(xx, yy);
      else ctx.moveTo(xx, yy);
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
      const r2 = dx * dx + dy * dy + 950;
      const bend = Math.min(0.25, 3000 / r2);
      const xx = cursor + dx * bend * 3.5;
      const yy = y + dy * bend * 3.5;
      const rot = Math.max(-0.12, Math.min(0.12, dx * dy / (r2 * 24)));

      ctx.save();
      ctx.translate(xx, yy);
      ctx.rotate(rot);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      cursor += m.width;
    }
    ctx.restore();
  }

  function drawPhotonRing(px, py, R, t) {
    const halo = ctx.createRadialGradient(px, py, R * .45, px, py, R * 5.2);
    halo.addColorStop(0, 'rgba(242,118,46,.36)');
    halo.addColorStop(.38, 'rgba(242,118,46,.12)');
    halo.addColorStop(1, 'rgba(242,118,46,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(px, py, R * 5.2, 0, Math.PI * 2);
    ctx.fill();

    // Subtle expanding wave rings.
    for (let k = 0; k < 4; k++) {
      const phase = fract(t * .14 + k * .25);
      const rr = R * (2.0 + phase * 6.6);
      const a = 0.16 * (1 - phase);
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(122,175,222,${a})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Photon ring / shadow.
    ctx.beginPath();
    ctx.arc(px, py, R * 1.48, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,196,130,.95)';
    ctx.lineWidth = 2.2;
    ctx.shadowColor = '#f2762e';
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(px, py, R * 1.08, 0, Math.PI * 2);
    ctx.fillStyle = '#02040a';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, R * 1.85, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(122,175,222,.20)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#101b31');
    bg.addColorStop(.48, '#0b1220');
    bg.addColorStop(1, '#070b14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (!pointerActive && !REDUCED) {
      target = [0.68 + 0.12 * Math.cos(t * .23), 0.54 + 0.16 * Math.sin(t * .31)];
    }
    bh[0] += (target[0] - bh[0]) * 0.045;
    bh[1] += (target[1] - bh[1]) * 0.045;

    const px = bh[0] * W;
    const py = bh[1] * H;
    const R = Math.max(34, Math.min(W, H) * 0.055);

    // Lensed grid, mostly on the right so the copy remains clean.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(122,175,222,.115)';
    for (let x = W * .35; x <= W + 70; x += 52) {
      const pts = [];
      for (let y = -40; y <= H + 40; y += 9) pts.push([x, y]);
      drawBentLine(pts, px, py, 2600);
    }
    for (let y = -20; y <= H + 60; y += 52) {
      const pts = [];
      for (let x = W * .32; x <= W + 70; x += 9) pts.push([x, y]);
      drawBentLine(pts, px, py, 2600);
    }

    // Star field with lens stretching.
    for (const s of stars) {
      let sx = (s.x + s.v * t) % 1;
      const x = sx * W;
      const y = s.y * H;
      const dx = x - px;
      const dy = y - py;
      const r2 = dx * dx + dy * dy + 1000;
      const bend = Math.min(0.21, 2300 / r2);
      const bx = x + dx * bend * 3.6;
      const by = y + dy * bend * 3.6;
      const stretch = Math.min(5.5, 1.0 + 8500 / r2);

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, s.r * stretch, s.r * .75, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(225,235,255,${s.a})`;
      ctx.fill();
      ctx.restore();
    }

    // Very faint lensed background copy: decorative, not the readable text.
    const titleSize = Math.max(30, Math.min(76, W * .052));
    drawBentText('BLACK HOLES', W * .45, H * .30, px, py,
      `700 ${titleSize}px Space Grotesk, sans-serif`, 'rgba(255,255,255,.060)', W * .48);
    drawBentText('RINGDOWN · QNMs · GRAVITATIONAL WAVES', W * .45, H * .39, px, py,
      '600 18px IBM Plex Mono, monospace', 'rgba(242,118,46,.18)', W * .48);
    drawBentText('PERTURBED SPACETIMES', W * .45, H * .66, px, py,
      `700 ${Math.max(24, titleSize * .65)}px Space Grotesk, sans-serif`, 'rgba(122,175,222,.085)', W * .48);

    drawPhotonRing(px, py, R, t);

    // Dark/readability overlays: left side for text, bottom for transition.
    const left = ctx.createLinearGradient(0, 0, W * .72, 0);
    left.addColorStop(0, 'rgba(7,11,20,.88)');
    left.addColorStop(.48, 'rgba(7,11,20,.62)');
    left.addColorStop(1, 'rgba(7,11,20,0)');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, W, H);

    const bottom = ctx.createLinearGradient(0, H * .62, 0, H);
    bottom.addColorStop(0, 'rgba(7,11,20,0)');
    bottom.addColorStop(1, 'rgba(7,11,20,.92)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 0, W, H);
  }

  function frame(now) {
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;
    draw(time);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (REDUCED) {
      draw(0.8);
      return;
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    target = [
      Math.max(0.05, Math.min(0.95, (e.clientX - r.left) / r.width)),
      Math.max(0.08, Math.min(0.92, (e.clientY - r.top) / r.height))
    ];
    pointerActive = true;
  }, { passive: true });

  hero.addEventListener('pointerleave', () => {
    pointerActive = false;
  }, { passive: true });

  addEventListener('resize', resize, { passive: true });
  resize();
  start();
})();
