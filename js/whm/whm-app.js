// Talking through a wormhole: page logic (tabs, controls, charts, audio).
import * as W from './whm-core.js';

const root = document.querySelector('[data-whm]');
const $o = k => root.querySelector(`[data-o="${k}"]`);
const $c = k => root.querySelector(`[data-c="${k}"]`);
const $tip = k => root.querySelector(`[data-tip="${k}"]`);
const $busy = k => root.querySelector(`[data-busy="${k}"]`);
const COL = { ink: '#0b1220', text: '#1c2433', muted: '#5d6878', rule: '#e4e1da', sent: '#2a78d6', recv: '#d8611c', ref: '#a3abb8', bad: '#c0392b', band: 'rgba(42,120,214,.10)', fill: 'rgba(42,120,214,.16)' };
const FONT = '11px "IBM Plex Mono", ui-monospace, monospace';
const FS = 32000, TAIL = 3.0, MAXDUR = 12, IW = 96, IH = 96;

let TAB = null, GM = 4.925490947e-6;
const st = {
  tab: 'msg', field: 1, thr: '1e-06', mass: 1, norm: true,
  msg: { text: 'SOS', bits: 'smooth', nu: 0.2, noise: false, ebn0: 15, seed: 1 },
  sos: { mode: 'line', line: -1 },
  snd: { src: 'melody' },
  img: { src: 'test', nu: 0.5, tau: 8 },
};
const tab = () => TAB[`s${st.field}_d${st.thr}`];
const R = { msg: null, sos: null, snd: null, img: null };
const SRC = { melody: null, chirp: null, upload: null };
let IMG = null;

// ---------- formatting
const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 2) + ' kHz' : Math.round(f) + ' Hz';
const fmtS = s => s >= 1 ? s.toFixed(1) + ' s' : s >= 1e-3 ? Math.round(1e3 * s) + ' ms' : (1e6 * s).toFixed(0) + ' μs';
const pct = E => E >= 0.01 ? (100 * E).toFixed(1) + '%' : E >= 1e-4 ? (100 * E).toFixed(3) + '%' : (100 * E).toExponential(1) + '%';
const sup = n => String(n).replace(/[-0-9]/g, c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
const expo = v => { if (v <= 0) return '0'; if (v >= 0.01) return v.toFixed(2); const e = Math.floor(Math.log10(v)), m = v / 10 ** e; return (m >= 9.95 ? '10' + sup(e + 1) : m.toFixed(1) + '×10' + sup(e)); };

// ---------- canvas helpers
function setup(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W0 = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W0 * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W0 * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W0, H); c.font = FONT;
  return { c, W: W0, H };
}
const T2Y = [[1, '1'], [1e-2, '10⁻²'], [1e-4, '10⁻⁴'], [1e-6, '10⁻⁶'], [1e-8, '10⁻⁸'], [1e-10, '10⁻¹⁰']];
// |T|² on a log axis. marks: {vlines:[{v,label}], band:[lo,hi], carrier, fill:{x:Float64Array, y:Float64Array (0..1)}}
function drawT(cv, opt, hover) {
  const { xmin, xmax, logx, toMw, xTicks, xfmt, xlabel, marks = {} } = opt;
  const { c, W: Wd, H } = setup(cv), L = 46, Rr = 10, T = 8, B = 30, pw = Wd - L - Rr, ph = H - T - B;
  const X = logx ? v => L + Math.log(v / xmin) / Math.log(xmax / xmin) * pw : v => L + (v - xmin) / (xmax - xmin) * pw;
  const Xi = logx ? px => xmin * Math.pow(xmax / xmin, (px - L) / pw) : px => xmin + (px - L) / pw * (xmax - xmin);
  const Y = v => T + (1 - (Math.log10(Math.max(v, 1e-12)) + 10) / 10) * ph;
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
  if (marks.band) { const a = X(Math.max(marks.band[0], xmin)), b = X(Math.min(marks.band[1], xmax)); c.fillStyle = COL.band; c.fillRect(a, T, b - a, ph); }
  if (marks.fill) {
    c.fillStyle = COL.fill; c.beginPath(); c.moveTo(X(Math.max(xmin, marks.fill.x[0])), T + ph);
    for (let i = 0; i < marks.fill.x.length; i++) { const v = marks.fill.x[i]; if (v < xmin || v > xmax) continue; c.lineTo(X(v), T + ph - marks.fill.y[i] * ph * 0.92); }
    c.lineTo(X(Math.min(xmax, marks.fill.x[marks.fill.x.length - 1])), T + ph); c.closePath(); c.fill();
  }
  c.restore();
  c.strokeStyle = COL.rule; c.lineWidth = 1; c.fillStyle = COL.muted; c.textAlign = 'right';
  for (const [v, lab] of T2Y) { const y = Y(v); c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke(); c.fillText(lab, L - 6, y + 4); }
  c.textAlign = 'center'; for (const v of xTicks) c.fillText(xfmt(v), X(v), T + ph + 15);
  if (xlabel) { c.textAlign = 'right'; c.fillText(xlabel, L + pw, T + ph + 28); }
  // |T|² sampled every half pixel plus every table point in the window, so narrow lines reach their full height
  const t = tab(), pts = [];
  for (let px = 0; px <= pw * 2; px++) pts.push(Xi(L + px / 2));
  const lo = toMw(xmin), hi = toMw(xmax), k = (xmax - xmin) / (hi - lo);
  for (let i = 0; i < t.om.length; i++) { const m = t.om[i]; if (m > lo && m < hi) pts.push(logx ? m / lo * xmin : xmin + (m - lo) * k); }
  pts.sort((a, b) => a - b);
  const mw = Float64Array.from(pts, toMw), Tr = new Float64Array(pts.length), Ti = new Float64Array(pts.length);
  W.fillT(t, mw, Tr, Ti);
  c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip();
  c.strokeStyle = COL.ink; c.lineWidth = 1.3; c.beginPath();
  pts.forEach((v, i) => { const y = Y(Tr[i] * Tr[i] + Ti[i] * Ti[i]); i ? c.lineTo(X(v), y) : c.moveTo(X(v), y); }); c.stroke();
  c.setLineDash([4, 3]); c.strokeStyle = COL.sent; c.lineWidth = 1.2;
  for (const m of marks.vlines || []) { if (m.v < xmin || m.v > xmax) continue; c.beginPath(); c.moveTo(X(m.v), T); c.lineTo(X(m.v), T + ph); c.stroke(); }
  c.setLineDash([]); c.fillStyle = COL.text; c.textAlign = 'left';
  for (const m of marks.vlines || []) {
    if (m.v < xmin || m.v > xmax || !m.label) continue;
    const right = X(m.v) + 4 + c.measureText(m.label).width > L + pw;
    c.textAlign = right ? 'right' : 'left'; c.fillText(m.label, X(m.v) + (right ? -4 : 4), T + 12);
  }
  if (marks.carrier !== undefined && marks.carrier >= xmin && marks.carrier <= xmax) { c.strokeStyle = COL.recv; c.lineWidth = 2; c.beginPath(); c.moveTo(X(marks.carrier), T); c.lineTo(X(marks.carrier), T + ph); c.stroke(); }
  if (hover && hover.x !== null) { c.strokeStyle = COL.muted; c.lineWidth = 1; c.beginPath(); c.moveTo(hover.x, T); c.lineTo(hover.x, T + ph); c.stroke(); }
  c.restore();
  cv._map = { L, pw, Xi };
}
function bindHover(cv, tip, fmt, redraw) {
  const h = { x: null };
  cv.addEventListener('pointermove', e => {
    const m = cv._map; if (!m) return;
    const px = e.clientX - cv.getBoundingClientRect().left;
    if (px < m.L || px > m.L + m.pw) { h.x = null; tip.textContent = ''; } else { h.x = px; tip.textContent = fmt(m.Xi(px)); }
    redraw();
  });
  cv.addEventListener('pointerleave', () => { h.x = null; tip.textContent = ''; redraw(); });
  return h;
}
// min/max envelope of a long record in one lane
function lane(c, arr, x0, pw, y0, half, scale, col, n) {
  c.fillStyle = col; const cols = Math.floor(pw), N = n ?? arr.length;
  for (let px = 0; px < cols; px++) {
    const i0 = Math.floor(px / cols * N), i1 = Math.min(arr.length, Math.max(i0 + 1, Math.floor((px + 1) / cols * N)));
    let mn = 0, mx = 0;
    for (let i = i0; i < i1; i++) { const v = (arr[i] || 0) * scale; if (v < mn) mn = v; if (v > mx) mx = v; }
    const top = Math.max(-half, Math.min(half, mx)), bot = Math.max(-half, Math.min(half, mn));
    c.fillRect(x0 + px, y0 - top, 1, Math.max(1, top - bot));
  }
}

// ---------- digital message
function runMsg() {
  const t = tab(), m = st.msg, bits = [1, ...W.textToBits(m.text || ' ')];
  const L = m.bits === 'smooth' ? 100 : 40, ramp = m.bits === 'smooth' ? 50 : 10, v0 = -200;
  const n = Math.max(4200, 200 + bits.length * L + 2000);
  const x = W.bpskWave(bits, L, ramp, m.nu, v0, n);
  const o = W.through(x, 1, t, 1, n, 8);
  const clean = W.bestLag(x, o.y, 3000);
  let y = o.y, Eb = 0, sigma = 0;
  if (m.noise) {
    for (let i = 0; i < n; i++) Eb += x[i] * x[i];
    Eb /= bits.length; sigma = Math.sqrt(Eb / 10 ** (m.ebn0 / 10) / 2);
    const z = W.gaussNoise(n, 1000 + m.seed); y = Float64Array.from(o.y, (v, i) => v + sigma * z[i]);
  }
  const { lag } = m.noise ? W.bestLag(x, y, 3000) : clean;
  const rx = W.demodBPSK(y, v0, lag, L, m.nu, bits.length);
  let ok = 0; for (let i = 1; i < bits.length; i++) ok += rx[i] === bits[i];
  R.msg = { bits, rx, ok, x, y, E: o.E, fid: clean.fidelity, lag, L, v0, n, spec: o.specIn, N: o.N, text: W.bitsToText(rx.slice(1)) };
  drawMsg();
}
function drawMsg(onlyT) {
  const t = tab(), r = R.msg;
  let fill;
  if (r) { // energy spectrum ω²|X|² of the sent message, smoothed over a few bins
    const h = r.spec.length, dw = 2 * Math.PI / r.N, xs = [], ys = []; let mx = 0;
    for (let k = 1; k < h && k * dw < 0.85; k++) { const w = k * dw; xs.push(w); ys.push(w * w * r.spec[k]); }
    const sm = ys.map((_, i) => { let a = 0, c = 0; for (let j = i - 12; j <= i + 12; j++) if (j >= 0 && j < ys.length) { a += ys[j]; c++; } return a / c; });
    sm.forEach(v => { mx = Math.max(mx, v); });
    fill = { x: Float64Array.from(xs), y: Float64Array.from(sm, v => v / mx) };
  }
  drawT($c('msgT'), { xmin: 0, xmax: 0.8, logx: false, toMw: w => w, xTicks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], xfmt: v => v.toFixed(1), xlabel: 'Mω',
    marks: { vlines: [{ v: t.wtop, label: 'barrier top' }], fill, carrier: st.msg.nu } }, hovers.msg);
  $o('nuMsg').textContent = `${st.msg.nu.toFixed(3)} · ${(st.msg.nu / t.wtop).toFixed(2)}× top`;
  if (onlyT || !r) return;
  const nb = r.bits.length - 1;
  $o('msgOk').textContent = `${r.ok} / ${nb}`;
  $o('msgOk').classList.toggle('whm-bad', r.ok < nb);
  $o('msgText').textContent = `“${r.text}”`;
  $o('msgE').textContent = pct(r.E);
  $o('msgFid').textContent = r.fid.toFixed(2);
  $o('msgLag').textContent = `${r.lag} M`;
  // bit strip
  const cells = (arr, cmp) => arr.map((b, i) => `<span class="${i === 0 ? 'pre' : cmp && b !== cmp[i] ? 'err' : ''}">${b}</span>`).join('');
  $o('msgBits').innerHTML = `<div><em>sent</em>${cells(r.bits)}</div><div><em>received</em>${cells(r.rx, r.bits)}</div>`;
  // waveforms
  const { c, W: Wd, H } = setup($c('msgWave')), L = 10, Rr = 10, T = 8, B = 28, pw = Wd - L - Rr, ph = H - T - B;
  const vmin = r.v0, vmax = r.v0 + r.n, X = v => L + (v - vmin) / (vmax - vmin) * pw, half = ph / 4 - 3;
  c.strokeStyle = COL.rule; c.lineWidth = 1; c.beginPath(); c.moveTo(L, T + ph / 4); c.lineTo(L + pw, T + ph / 4); c.moveTo(L, T + 3 * ph / 4); c.lineTo(L + pw, T + 3 * ph / 4); c.stroke();
  // wrong bits shaded in the received lane
  c.fillStyle = 'rgba(192,57,43,.14)';
  for (let k = 1; k < r.bits.length; k++) if (r.rx[k] !== r.bits[k]) c.fillRect(X(r.lag + k * r.L), T + ph / 2 + 2, X(r.lag + (k + 1) * r.L) - X(r.lag + k * r.L), ph / 2 - 4);
  c.setLineDash([2, 3]); c.strokeStyle = '#8a93a1';
  for (let k = 0; k <= r.bits.length; k++) {
    let xx = X(k * r.L); c.beginPath(); c.moveTo(xx, T + 2); c.lineTo(xx, T + ph / 2 - 2); c.stroke();
    xx = X(r.lag + k * r.L); c.beginPath(); c.moveTo(xx, T + ph / 2 + 2); c.lineTo(xx, T + ph - 2); c.stroke();
  }
  c.setLineDash([]);
  lane(c, r.x, L, pw, T + ph / 4, half, half, COL.ref);
  lane(c, r.y, L, pw, T + 3 * ph / 4, half, half, COL.recv);
  c.fillStyle = COL.muted; c.textAlign = 'center';
  const step = r.n > 5000 ? 1000 : 500;
  for (let v = 0; v <= vmax; v += step) c.fillText(v + 'M', X(v), T + ph + 15);
  c.textAlign = 'right'; c.fillText('both lanes on the same vertical scale', L + pw, T + 12);
}

// ---------- SOS in Morse
const ENV = W.morseEnv('SOS SOS', FS);
function sosLines() {
  const t = tab(), s = st.mass * GM;
  return t.lines.map(l => ({ f: l[0] / (2 * Math.PI * s), ring: s / l[1] })).filter(l => l.f > 100 && l.f < 0.47 * FS);
}
function sosTone() {
  const t = tab(), s = st.mass * GM, ftop = t.wtop / (2 * Math.PI * s);
  if (st.sos.mode === '700') return { f: 700, ring: null };
  if (st.sos.mode === 'line') {
    const Ls = sosLines(); if (!Ls.length) return null;
    const i = st.sos.line >= 0 && st.sos.line < Ls.length ? st.sos.line : Ls.length - 1; return Ls[i];
  }
  const f = Math.min(1.6 * ftop, 0.47 * FS); return f > 1.35 * ftop ? { f, ring: null } : null;
}
function fillLineSel() {
  const Ls = sosLines(), sel = root.querySelector('#whm-line');
  if (st.sos.line >= Ls.length) st.sos.line = -1;
  const cur = st.sos.line >= 0 ? st.sos.line : Ls.length - 1;
  sel.innerHTML = Ls.length ? Ls.map((l, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${fmtHz(l.f)} · rings ${fmtS(l.ring)}</option>`).join('') : '<option>none in the audio band</option>';
  sel.disabled = !Ls.length;
}
function runSos() {
  fillLineSel();
  const tone = sosTone(); $busy('sos').textContent = '';
  if (!tone) {
    R.sos = null; drawSos();
    $busy('sos').textContent = st.sos.mode === 'line' ? 'This throat has no comb line in the audio band at this mass. Change the mass or the throat.' : 'At this mass the barrier top is too high for the audio band. Increase the mass.';
    return;
  }
  const x = new Float32Array(ENV.length);
  for (let i = 0; i < x.length; i++) x[i] = ENV[i] * Math.sin(2 * Math.PI * tone.f * i / FS);
  const outLen = x.length + Math.round(TAIL * FS), r = W.through(x, 1 / FS, tab(), st.mass * GM, outLen);
  const fade = Math.round(0.25 * FS); for (let i = 0; i < fade; i++) r.y[outLen - 1 - i] *= i / fade;
  const z = W.gaussNoise(outLen, 1); for (let i = 0; i < outLen; i++) r.y[i] += W.MORSE.NOISE * z[i];
  const dec = W.decodeMorse(r.y, tone.f, FS);
  R.sos = Object.assign(r, { x, tone, dec, ...peaks(x, r.y) });
  drawSos();
}
function peaks(x, y) { let pin = 0, pout = 0; for (const v of x) pin = Math.max(pin, Math.abs(v)); for (const v of y) pout = Math.max(pout, Math.abs(v)); return { pin, pout }; }
function drawSos(onlyT) {
  const t = tab(), s = st.mass * GM, toMw = f => 2 * Math.PI * f * s, ftop = t.wtop / (2 * Math.PI * s), r = R.sos;
  drawT($c('sosT'), { xmin: 20, xmax: FS / 2, logx: true, toMw, xTicks: [20, 100, 1000, 10000], xfmt: fmtHz, xlabel: 'frequency',
    marks: { vlines: [{ v: ftop, label: 'barrier top' }], carrier: r ? r.tone.f : undefined } }, hovers.sos);
  if (onlyT) return;
  $o('mass').textContent = massLabel();
  $o('sosTone').textContent = r ? fmtHz(r.tone.f) : '–';
  $o('sosT2').textContent = r ? expo(W.T2at(t, toMw(r.tone.f))) : '–';
  $o('sosE').textContent = r ? pct(r.E) : '–';
  $o('sosRing').textContent = r && r.tone.ring ? fmtS(r.tone.ring) : '–';
  const okDec = r && r.dec.text === 'SOS SOS';
  $o('sosDec').textContent = !r ? '–' : okDec ? 'SOS SOS ✓' : `✗ “${r.dec.text.length > 9 ? r.dec.text.slice(0, 9) + '…' : r.dec.text}”`;
  $o('sosDec').classList.toggle('whm-bad', !!r && !okDec);
  const { c, W: Wd, H } = setup($c('sosEnv')), L = 10, Rr = 10, T = 8, B = 24, pw = Wd - L - Rr, ph = H - T - B;
  c.strokeStyle = COL.rule; c.beginPath(); c.moveTo(L, T + ph / 2 - 6); c.lineTo(L + pw, T + ph / 2 - 6); c.moveTo(L, T + ph); c.lineTo(L + pw, T + ph); c.stroke();
  if (!r) return;
  const n = r.y.length, dur = n / FS, X = i => L + i / n * pw, laneH = ph / 2 - 12;
  const path = (arr, y0, scale, col) => { c.strokeStyle = col; c.lineWidth = 1.4; c.beginPath(); const step = Math.max(1, Math.floor(n / (pw * 2)));
    for (let i = 0; i < arr.length; i += step) { const yy = y0 - Math.min(1, arr[i] * scale) * laneH; i ? c.lineTo(X(i), yy) : c.moveTo(X(i), yy); } c.stroke(); };
  path(ENV, T + ph / 2 - 6, 1, COL.sent);
  let mx = 0; for (const v of r.dec.env) mx = Math.max(mx, v);
  path(r.dec.env, T + ph, 1 / (mx || 1), COL.recv);
  c.setLineDash([2, 3]); c.strokeStyle = '#8a93a1'; c.beginPath(); c.moveTo(L, T + ph - 0.5 * laneH); c.lineTo(L + pw, T + ph - 0.5 * laneH); c.stroke(); c.setLineDash([]);
  c.fillStyle = COL.muted; c.textAlign = 'center';
  for (let q = 0; q <= dur; q += 1) c.fillText(q + ' s', X(q * FS), T + ph + 15);
}

// ---------- sound
function runSnd() {
  $busy('snd').textContent = '';
  const x = SRC[st.snd.src];
  if (!x) { R.snd = null; drawSnd(); if (st.snd.src === 'upload') $busy('snd').textContent = 'Choose an audio file.'; return; }
  const outLen = x.length + Math.round(TAIL * FS), r = W.through(x, 1 / FS, tab(), st.mass * GM, outLen);
  const fade = Math.round(0.25 * FS); for (let i = 0; i < fade; i++) r.y[outLen - 1 - i] *= i / fade;
  R.snd = Object.assign(r, { x, ...peaks(x, r.y) });
  drawSnd();
}
function drawSnd(onlyT) {
  const t = tab(), s = st.mass * GM, toMw = f => 2 * Math.PI * f * s, ftop = t.wtop / (2 * Math.PI * s), r = R.snd;
  drawT($c('sndT'), { xmin: 20, xmax: FS / 2, logx: true, toMw, xTicks: [20, 100, 1000, 10000], xfmt: fmtHz, xlabel: 'frequency',
    marks: { vlines: [{ v: ftop, label: 'barrier top' }] } }, hovers.snd);
  if (onlyT) return;
  $o('mass').textContent = massLabel();
  $o('sndTop').textContent = fmtHz(ftop);
  $o('sndEcho').textContent = t.d > 0 ? fmtS(4 * t.d * s) : 'no cavity';
  $o('sndLines').textContent = t.lines.length ? t.lines.slice(0, 3).map(l => fmtHz(l[0] / (2 * Math.PI * s))).join(', ') + (t.lines.length > 3 ? ', …' : '') : 'none';
  $o('sndE').textContent = r ? pct(r.E) : '–';
  { // spectra in log-spaced bands, dB relative to the sent maximum
    const { c, W: Wd, H } = setup($c('sndSpec')), L = 44, Rr = 10, T = 8, B = 24, pw = Wd - L - Rr, ph = H - T - B, f0 = 20, f1 = FS / 2;
    const X = f => L + Math.log(f / f0) / Math.log(f1 / f0) * pw, Y = db => T + (-db / 80) * ph;
    c.strokeStyle = COL.rule; c.fillStyle = COL.muted; c.textAlign = 'right';
    for (const db of [0, -20, -40, -60, -80]) { c.beginPath(); c.moveTo(L, Y(db)); c.lineTo(L + pw, Y(db)); c.stroke(); c.fillText(db + ' dB', L - 4, Y(db) + 4); }
    c.textAlign = 'center'; for (const f of [20, 100, 1000, 10000]) c.fillText(fmtHz(f), X(f), T + ph + 15);
    if (r) {
      const nb = 220, df = 1 / (r.N * r.dt), bi = new Float64Array(nb), bo = new Float64Array(nb), cnt = new Float64Array(nb);
      for (let k = 1; k < r.specIn.length; k++) { const f = k * df; if (f < f0) continue; const b = Math.min(nb - 1, Math.floor(Math.log(f / f0) / Math.log(f1 / f0) * nb)); bi[b] += r.specIn[k]; bo[b] += r.specOut[k]; cnt[b]++; }
      let mx = 0; for (let b = 0; b < nb; b++) if (cnt[b]) mx = Math.max(mx, bi[b] / cnt[b]);
      const line = (arr, col) => { c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); let first = true;
        for (let b = 0; b < nb; b++) { if (!cnt[b]) continue; const db = Math.max(-80, 10 * Math.log10(arr[b] / cnt[b] / mx + 1e-30)), x = X(f0 * Math.pow(f1 / f0, (b + .5) / nb));
          first ? c.moveTo(x, Y(db)) : c.lineTo(x, Y(db)); first = false; } c.stroke(); };
      c.save(); c.beginPath(); c.rect(L, T, pw, ph); c.clip(); line(bi, COL.sent); line(bo, COL.recv); c.restore();
    }
  }
  { // waveforms
    const { c, W: Wd, H } = setup($c('sndWave')), L = 10, Rr = 10, T = 8, B = 24, pw = Wd - L - Rr, ph = H - T - B;
    c.strokeStyle = COL.rule; c.beginPath(); c.moveTo(L, T + ph / 4); c.lineTo(L + pw, T + ph / 4); c.moveTo(L, T + 3 * ph / 4); c.lineTo(L + pw, T + 3 * ph / 4); c.stroke();
    if (r) {
      const n = r.y.length, dur = n / FS, g = st.norm ? (r.pout ? r.pin / r.pout : 1) : 1, half = ph / 4, sc = half / Math.max(r.pin, 1e-9);
      $o('sndGain').textContent = st.norm ? `received ×${g.toFixed(g < 10 ? 1 : 0)}` : 'true scale';
      lane(c, r.x, L, pw, T + ph / 4, half, sc, COL.sent, n);
      lane(c, r.y, L, pw, T + 3 * ph / 4, half, sc * g, COL.recv, n);
      c.fillStyle = COL.muted; c.textAlign = 'center';
      for (let q = 0; q <= dur; q += dur > 8 ? 2 : 1) c.fillText(q + ' s', L + q / dur * pw, T + ph + 15);
    }
  }
}
const massLabel = () => `${st.mass < 1 ? st.mass.toFixed(2) : st.mass.toFixed(1)} M☉`;

// ---------- audio
let actx = null, playing = null;
function ctx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; }
function play(which) {
  stop(); const r = st.tab === 'sos' ? R.sos : R.snd; if (!r) return;
  const a = ctx(), data = which === 'sent' ? r.x : r.y;
  const g = which === 'recv' && st.norm ? (r.pout > 0 ? r.pin / r.pout : 1) : 1;
  const buf = a.createBuffer(1, data.length, FS), ch = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) ch[i] = Math.max(-1, Math.min(1, g * data[i]));
  const src = a.createBufferSource(); src.buffer = buf; src.connect(a.destination); src.start(); playing = src;
  src.onended = () => { if (playing === src) playing = null; };
}
function stop() { if (playing) { try { playing.stop(); } catch (e) { /* already stopped */ } playing = null; } }
async function decodeUpload(file) {
  const dec = await ctx().decodeAudioData(await file.arrayBuffer());
  const len = Math.min(dec.duration, MAXDUR), off = new OfflineAudioContext(1, Math.ceil(len * FS), FS);
  const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0).slice();
}

// ---------- pictures
function grayOf(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, IW, IH).data, g = new Float32Array(IW * IH);
  for (let i = 0; i < IW * IH; i++) g[i] = (0.2126 * d[4 * i] + 0.7152 * d[4 * i + 1] + 0.0722 * d[4 * i + 2]) / 255;
  return g;
}
function testCard() {
  const cv = document.createElement('canvas'); cv.width = IW; cv.height = IH; const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, IW, IH); c.fillStyle = '#fff'; c.font = 'bold 30px Helvetica, Arial, sans-serif';
  c.textBaseline = 'top'; c.textAlign = 'center'; c.fillText('SOS', IW / 2, 6);
  c.fillStyle = '#b4b4b4'; c.beginPath(); c.arc(25, 64, 15, 0, 2 * Math.PI); c.fill(); c.fillStyle = '#6e6e6e'; c.fillRect(52, 49, 36, 30);
  for (let i = 0; i < 8; i++) { c.fillStyle = `rgb(${i * 36},${i * 36},${i * 36})`; c.fillRect(6 + i * 10.5, 84, 10.5, 8); }
  return grayOf(cv);
}
function loadImageFile(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = IW; cv.height = IH; const c = cv.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, IW, IH);
      const s = Math.min(IW / img.width, IH / img.height), w = img.width * s, h = img.height * s;
      c.drawImage(img, (IW - w) / 2, (IH - h) / 2, w, h); URL.revokeObjectURL(img.src); res(grayOf(cv));
    };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
function paintGray(cv, g, map) {
  const c = cv.getContext('2d'), d = c.createImageData(IW, IH);
  for (let i = 0; i < IW * IH; i++) { const v = Math.max(0, Math.min(255, Math.round(255 * map(g[i])))); d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v; d.data[4 * i + 3] = 255; }
  c.putImageData(d, 0, 0);
}
function runImg() { R.img = W.sendPicture(IMG, IW, IH, st.img.tau, st.img.nu, tab()); drawImg(); }
function drawImg(onlyT) {
  const t = tab(), bw = Math.PI / st.img.tau, im = k => root.querySelector(`[data-im="${k}"]`);
  drawT($c('imgT'), { xmin: 0.005, xmax: 0.85, logx: false, toMw: w => w, xTicks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], xfmt: v => v.toFixed(1), xlabel: 'Mω',
    marks: { vlines: [{ v: t.wtop, label: 'barrier top' }], band: [st.img.nu - bw, st.img.nu + bw], carrier: st.img.nu } }, hovers.img);
  $o('nuImg').textContent = `${st.img.nu.toFixed(3)} · ${(st.img.nu / t.wtop).toFixed(2)}× top`;
  $o('tau').textContent = `${st.img.tau} M`;
  $o('imgEcho').textContent = t.d > 0 ? `${(4 * t.d).toFixed(0)} M ≈ ${(4 * t.d / st.img.tau).toFixed(0)} pixels` : 'no cavity';
  if (onlyT) return;
  paintGray(im('sent'), IMG, v => v);
  const r = R.img;
  if (r) {
    paintGray(im('raw'), r.rec, v => (v - 0.2) / 0.8);
    const srt = Float32Array.from(r.rec).sort(), lo = srt[Math.floor(0.01 * srt.length)], hi = srt[Math.floor(0.99 * srt.length)];
    paintGray(im('agc'), r.rec, v => (v - lo) / Math.max(1e-9, hi - lo));
    $o('imgE').textContent = pct(r.E); $o('imgLag').textContent = `${r.lag} M`;
  }
}

// ---------- wiring
const hovers = {};
const RUN = { msg: runMsg, sos: runSos, snd: runSnd, img: runImg };
const DRAW = { msg: drawMsg, sos: drawSos, snd: drawSnd, img: drawImg };
const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
const recompute = debounce(() => {
  const k = st.tab, b = $busy(k);
  if (b) b.textContent = 'Computing…';
  setTimeout(() => { if (b) b.textContent = ''; RUN[k](); }, 20);
}, 120);
function invalidate() { stop(); for (const k in R) R[k] = null; updateThrNote(); recompute(); }
function updateThrNote() {
  const t = tab();
  $o('thrNote').textContent = t.d > 0
    ? `a = ${t.a < 2.0001 ? t.a.toFixed(6) : t.a.toFixed(2)}M · cavity of ${(2 * t.d).toFixed(0)}M · ${t.lines.length} comb line${t.lines.length === 1 ? '' : 's'} below the top`
    : `a = ${t.a.toFixed(2)}M · throat outside the peak: one barrier, no cavity`;
}
function showTab(k) {
  st.tab = k; stop();
  root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k)));
  root.querySelectorAll('.whm-pane').forEach(p => { p.hidden = p.id !== `pane-${k}`; });
  root.querySelectorAll('[data-show]').forEach(g => { g.hidden = !g.dataset.show.split(' ').includes(k); });
  if (!R[k]) recompute(); else DRAW[k]();
}
function seg(name, fn) {
  const g = root.querySelector(`[data-seg="${name}"]`);
  g.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    fn(b.dataset.v);
  });
}

async function init() {
  try {
    TAB = W.loadTables(await fetch(new URL('./whm-tables.json', import.meta.url)).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }));
  } catch (e) {
    root.insertAdjacentHTML('afterbegin', '<p class="whm-busy">Could not load the transmission tables.</p>');
    return;
  }
  SRC.melody = W.melody(FS); SRC.chirp = W.chirp(FS); IMG = testCard();
  hovers.msg = bindHover($c('msgT'), $tip('msgT'), w => `Mω = ${w.toFixed(4)} · |T|² = ${expo(W.T2at(tab(), w))}`, () => drawMsg(true));
  const hz = f => { const w = 2 * Math.PI * f * st.mass * GM; return `${fmtHz(f)} · Mω = ${w.toFixed(4)} · |T|² = ${expo(W.T2at(tab(), w))}`; };
  hovers.sos = bindHover($c('sosT'), $tip('sosT'), hz, () => drawSos(true));
  hovers.snd = bindHover($c('sndT'), $tip('sndT'), hz, () => drawSnd(true));
  hovers.img = bindHover($c('imgT'), $tip('imgT'), w => `Mω = ${w.toFixed(4)} · |T|² = ${expo(W.T2at(tab(), w))}`, () => drawImg(true));

  root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  root.querySelector('.whm-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...root.querySelectorAll('[data-tab]')], i = tabs.findIndex(b => b.dataset.tab === st.tab);
    const nx = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; nx.focus(); showTab(nx.dataset.tab);
  });
  seg('field', v => { st.field = +v; invalidate(); });
  seg('thr', v => { st.thr = v; invalidate(); });
  seg('bits', v => { st.msg.bits = v; recompute(); });
  seg('tone', v => { st.sos.mode = v; root.querySelector('[data-show-line]').hidden = v !== 'line'; stop(); recompute(); });
  seg('src', v => {
    st.snd.src = v; root.querySelector('[data-show-upload]').hidden = v !== 'upload'; stop(); recompute();
  });
  seg('img', v => {
    st.img.src = v; root.querySelector('[data-show-iupload]').hidden = v !== 'upload';
    if (v === 'test') { IMG = testCard(); recompute(); } else $busy('img').textContent = 'Choose a picture.';
  });
  const text = root.querySelector('#whm-text');
  text.addEventListener('input', () => { st.msg.text = text.value.replace(/[^\x20-\x7e]/g, ''); recompute(); });
  const nu = root.querySelector('#whm-nu');
  nu.addEventListener('input', () => { st.msg.nu = +nu.value; drawMsg(true); recompute(); });
  const noise = root.querySelector('[data-k="noise"]'), eb = root.querySelector('#whm-ebn0');
  const ebLabel = () => { $o('ebn0').textContent = `${st.msg.ebn0.toFixed(1)} dB`; };
  noise.addEventListener('change', () => { st.msg.noise = noise.checked; root.querySelector('[data-show-noise]').hidden = !noise.checked; recompute(); });
  eb.addEventListener('input', () => { st.msg.ebn0 = +eb.value; ebLabel(); recompute(); });
  root.querySelector('[data-action="reseed"]').addEventListener('click', () => { st.msg.seed++; recompute(); });
  root.querySelector('#whm-line').addEventListener('change', e => { st.sos.line = +e.target.value; stop(); recompute(); });
  const mass = root.querySelector('#whm-mass');
  mass.addEventListener('input', () => { st.mass = 10 ** +mass.value; $o('mass').textContent = massLabel(); R.sos = R.snd = null; stop(); DRAW[st.tab](true); recompute(); });
  root.querySelector('[data-k="norm"]').addEventListener('change', e => { st.norm = e.target.checked; if (st.tab === 'snd') drawSnd(); });
  root.querySelector('[data-action="play-sent"]').addEventListener('click', () => play('sent'));
  root.querySelector('[data-action="play-recv"]').addEventListener('click', () => play('recv'));
  root.querySelector('[data-action="stop"]').addEventListener('click', stop);
  root.querySelector('[data-k="upload"]').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return; $busy('snd').textContent = 'Reading the file…';
    try { SRC.upload = await decodeUpload(f); recompute(); } catch (err) { $busy('snd').textContent = 'Could not read that file. Try an MP3, WAV or OGG.'; }
  });
  root.querySelector('[data-k="iupload"]').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { IMG = await loadImageFile(f); recompute(); } catch (err) { $busy('img').textContent = 'Could not read that picture.'; }
  });
  const iNu = root.querySelector('#whm-inu'), tau = root.querySelector('#whm-tau');
  iNu.addEventListener('input', () => { st.img.nu = +iNu.value; drawImg(true); recompute(); });
  tau.addEventListener('input', () => { st.img.tau = +tau.value; drawImg(true); recompute(); });
  new ResizeObserver(debounce(() => DRAW[st.tab](), 60)).observe(root);

  ebLabel(); $o('mass').textContent = massLabel(); updateThrNote();
  runMsg();
}
init();
