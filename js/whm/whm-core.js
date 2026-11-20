// Talking through a wormhole: signal processing shared by the page and its tests.
// The channel is the transmission amplitude T(Mω) of a thin-shell Schwarzschild wormhole,
// tabulated by the paper's code (one multipole, no rotation). Everything here is pure JS
// with no DOM, so it can also be imported in Node.

const b64buf = s => {
  const b = atob(s), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
};

// tables[key] with key `s${s}_d${delta}`: om (Mω, increasing), re/im of T, ell, wtop = sqrt(Vmax),
// d = tortoise distance from the throat to the barrier peak (in M; negative when there is no cavity),
// lines = [[Mω_n, MΓ_n], ...] comb lines below the barrier top.
export function loadTables(json) {
  const out = {};
  for (const [k, t] of Object.entries(json.tables)) {
    out[k] = Object.assign({}, t, {
      om: new Float64Array(b64buf(t.om)),
      re: new Float32Array(b64buf(t.re)),
      im: new Float32Array(b64buf(t.im)),
    });
  }
  return out;
}

// T(Mω) at increasing frequencies w: linear interpolation in the table; T ∝ ω^(ℓ+1) below it
// and |T| = 1 with phase ∝ 1/ω above it (checked against the full solver at Mω = 2, 4, 8).
export function fillT(t, w, outRe, outIm) {
  const om = t.om, n = om.length, re = t.re, im = t.im, ph = Math.atan2(im[n - 1], re[n - 1]);
  let j = 0;
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    if (x <= 0) { outRe[i] = 0; outIm[i] = 0; continue; }
    if (x < om[0]) { const s = Math.pow(x / om[0], t.ell + 1); outRe[i] = re[0] * s; outIm[i] = im[0] * s; continue; }
    if (x >= om[n - 1]) { const p = ph * om[n - 1] / x; outRe[i] = Math.cos(p); outIm[i] = Math.sin(p); continue; }
    while (om[j + 1] <= x) j++;
    const f = (x - om[j]) / (om[j + 1] - om[j]);
    outRe[i] = re[j] + f * (re[j + 1] - re[j]);
    outIm[i] = im[j] + f * (im[j + 1] - im[j]);
  }
}
export function T2at(t, x) {
  const r = new Float64Array(1), i = new Float64Array(1);
  fillT(t, [x], r, i);
  return r[0] * r[0] + i[0] * i[0];
}

// radix-2 FFT, numpy sign convention (forward e^{-2πi jk/N})
const twc = new Map();
function tw(n) {
  if (!twc.has(n)) {
    const c = new Float64Array(n / 2), s = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) { c[k] = Math.cos(2 * Math.PI * k / n); s[k] = Math.sin(2 * Math.PI * k / n); }
    twc.set(n, { c, s });
  }
  return twc.get(n);
}
export function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const { c, s } = tw(n), sg = inv ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const wr = c[k], wi = sg * s[k], a = i + j, b = a + half;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
export const pow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };

// received = IFFT( FFT(sent) · conj T(Mω) )  (conj because T is defined with e^{-iωt}).
// dt is the sample step, wscale converts ω to Mω (1 when time is measured in M).
// pad: the FFT length is at least pad × the output length, so that the slow ringing of narrow
// lines does not wrap around into the start of the record.
export function through(x, dt, t, wscale, outLen, pad = 2) {
  const N = pow2(Math.max(outLen, x.length) * pad), re = new Float64Array(N), im = new Float64Array(N);
  re.set(x); fft(re, im, false);
  const h = N / 2, w = new Float64Array(h + 1), Tr = new Float64Array(h + 1), Ti = new Float64Array(h + 1);
  for (let k = 0; k <= h; k++) w[k] = 2 * Math.PI * k / (N * dt) * wscale;
  fillT(t, w, Tr, Ti);
  let Ein = 0, Eout = 0;
  const specIn = new Float64Array(h + 1), specOut = new Float64Array(h + 1);
  for (let k = 0; k <= h; k++) {
    const a = re[k], b = im[k], yr = a * Tr[k] + b * Ti[k], yi = b * Tr[k] - a * Ti[k];
    const pin = a * a + b * b, pout = yr * yr + yi * yi, w2 = w[k] * w[k];
    specIn[k] = pin; specOut[k] = pout; Ein += w2 * pin; Eout += w2 * pout;   // energy flux weights ω²|ψ̃|²
    if (k === 0) { re[0] = 0; im[0] = 0; }
    else if (k === h) { re[h] = yr; im[h] = 0; }
    else { re[k] = yr; im[k] = yi; re[N - k] = yr; im[N - k] = -yi; }
  }
  fft(re, im, true);
  return { y: re.slice(0, outLen), E: Eout / Ein, specIn, specOut, N, dt };
}

// deterministic Gaussian noise (mulberry32 + Box–Muller)
export function gaussNoise(n, seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(rnd() + 1e-300)), p = 2 * Math.PI * rnd();
    out[i] = r * Math.cos(p); if (i + 1 < n) out[i + 1] = r * Math.sin(p);
  }
  return out;
}

// ---------- digital message: BPSK, as in scripts/message_experiment.py of the paper
export const textToBits = text => [...text].flatMap(ch => {
  const c = ch.charCodeAt(0) & 0x7f;
  return [7, 6, 5, 4, 3, 2, 1, 0].map(k => (c >> k) & 1);
});
export function bitsToText(bits) {
  let s = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let c = 0; for (let k = 0; k < 8; k++) c = (c << 1) | bits[i + k];
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : '·';
  }
  return s;
}
const raisedCos = (X, lo, hi, ramp) => {
  if (X < lo || X > hi) return 0;
  if (X < lo + ramp) return 0.5 * (1 - Math.cos(Math.PI * (X - lo) / ramp));
  if (X > hi - ramp) return 0.5 * (1 - Math.cos(Math.PI * (hi - X) / ramp));
  return 1;
};
// Sent wave on the grid v = v0 + i (time in M, dt = 1); bit k occupies [k L, (k+1) L].
export function bpskWave(bits, L, ramp, nu, v0, n) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = v0 + i; let env = 0;
    const k = Math.floor(v / L);
    for (let q = k - 1; q <= k + 1; q++) if (q >= 0 && q < bits.length) env += (2 * bits[q] - 1) * raisedCos(v, q * L, (q + 1) * L, ramp);
    x[i] = env * Math.cos(nu * v);
  }
  return x;
}
// Delay that maximizes |normalized cross-correlation| between received and sent (numpy 'full'), in samples.
export function bestLag(sent, rec, maxLag) {
  const n = Math.max(sent.length, rec.length), N = pow2(2 * n);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length, ms = mean(sent), mr = mean(rec);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  let ns = 0, nr = 0;
  for (let i = 0; i < sent.length; i++) { br[i] = sent[i] - ms; ns += br[i] * br[i]; }
  for (let i = 0; i < rec.length; i++) { ar[i] = rec[i] - mr; nr += ar[i] * ar[i]; }
  fft(ar, ai, false); fft(br, bi, false);
  for (let k = 0; k < N; k++) {
    const xr = ar[k] * br[k] + ai[k] * bi[k], xi = ai[k] * br[k] - ar[k] * bi[k];
    ar[k] = xr; ai[k] = xi;
  }
  fft(ar, ai, true);
  let best = 0, bv = -1;
  for (let l = -maxLag; l <= maxLag; l++) {
    const v = Math.abs(ar[(l + N) % N]);
    if (v > bv) { bv = v; best = l; }
  }
  return { lag: best, fidelity: bv / Math.sqrt(ns * nr) };
}
// Coherent BPSK receiver: correlate each bit window with the carrier, phase reference from the preamble.
export function demodBPSK(rec, v0, lag, L, nu, nBits) {
  const z = [];
  for (let k = 0; k < nBits; k++) {
    let zr = 0, zi = 0;
    const lo = lag + k * L, hi = lag + (k + 1) * L;
    for (let v = Math.ceil(lo); v < hi; v++) {
      const i = v - v0; if (i < 0 || i >= rec.length) continue;
      zr += rec[i] * Math.cos(nu * (v - lag)); zi += rec[i] * Math.sin(nu * (v - lag));
    }
    z.push([zr, zi]);
  }
  const [r0, i0] = z[0], m0 = Math.hypot(r0, i0) || 1;
  return z.map(([zr, zi]) => ((zr * r0 + zi * i0) / m0 > 0 ? 1 : 0));
}

// ---------- SOS in Morse, as in scripts/sos_demo.py: 20 wpm (60 ms dit), 5 ms sin² edges
export const MORSE = { DIT: 0.060, NOISE: 0.02, RXBW: 120 };
const CODE = { S: '...', O: '---' }, INV = { '...': 'S', '---': 'O', '.': 'E', '-': 'T', '..': 'I', '--': 'M', '.-': 'A', '-.': 'N' };
export function morseEnv(text, FS) {
  const u = [];
  text.split(' ').forEach((wd, i) => {
    if (i) for (let k = 0; k < 7; k++) u.push(0);
    [...wd].forEach((ch, j) => {
      if (j) u.push(0, 0, 0);
      [...CODE[ch]].forEach((s, k) => { if (k) u.push(0); for (let q = 0; q < (s === '.' ? 1 : 3); q++) u.push(1); });
    });
  });
  const nu = Math.round(MORSE.DIT * FS), lead = Math.round(0.3 * FS), raw = new Float64Array(lead + u.length * nu);
  u.forEach((v, i) => { if (v) raw.fill(1, lead + i * nu, lead + (i + 1) * nu); });
  const r = Math.round(0.005 * FS), ker = []; let sum = 0;
  for (let j = 0; j < r; j++) { const v = Math.sin(Math.PI * j / (r - 1)) ** 2; ker.push(v); sum += v; }
  const env = new Float64Array(raw.length), h = r >> 1;
  for (let i = 0; i < raw.length; i++) {
    let a = 0;
    for (let j = 0; j < r; j++) { const q = i + j - h; if (q >= 0 && q < raw.length) a += ker[j] * raw[q]; }
    env[i] = a / sum;
  }
  return env;
}
// Band-pass RXBW around f0, envelope, threshold at half height, durations → dots and dashes.
export function decodeMorse(y, f0, FS) {
  const n = y.length, N = pow2(n), re = new Float64Array(N), im = new Float64Array(N);
  re.set(y); fft(re, im, false);
  for (let k = 0; k < N; k++) {
    const f = (k <= N / 2 ? k : k - N) * FS / N;
    if (f > 0 && Math.abs(f - f0) < MORSE.RXBW / 2) { re[k] *= 2; im[k] *= 2; } else { re[k] = 0; im[k] = 0; }
  }
  fft(re, im, true);
  const w = Math.round(0.005 * FS), cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + Math.hypot(re[i], im[i]);
  const e = new Float64Array(n); let mx = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - (w >> 1)), b = Math.min(n, a + w);
    e[i] = (cs[b] - cs[a]) / (b - a); if (e[i] > mx) mx = e[i];
  }
  const thr = 0.5 * mx, u = MORSE.DIT * FS; let out = '', sym = '', i = 0;
  while (i < n && e[i] <= thr) i++;
  while (i < n) {
    const on = e[i] > thr; let j = i;
    while (j < n && (e[j] > thr) === on) j++;
    const len = (j - i) / u;
    if (on) sym += len < 2 ? '.' : '-';
    else if (j < n && len > 2) { out += INV[sym] || '?'; sym = ''; if (len > 5) out += ' '; }
    i = j;
  }
  if (sym) out += INV[sym] || '?';
  return { text: out.trim(), env: e, thr };
}

// ---------- test sounds (mono)
export function melody(FS) {
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 392.0, 523.25], dur = 0.34;
  const n = Math.round(FS * dur * (notes.length + 1)), x = new Float32Array(n);
  notes.forEach((f, k) => {
    const i0 = Math.round(k * dur * FS), len = Math.round(dur * 1.8 * FS);
    for (let i = 0; i < len && i0 + i < n; i++) {
      const t = i / FS, env = Math.min(1, t / 0.008) * Math.exp(-t / 0.28); let v = 0;
      for (let h = 1; h <= 10; h++) v += Math.sin(2 * Math.PI * f * h * t) / h * Math.exp(-t * h / 0.9);
      x[i0 + i] += 0.28 * env * v;
    }
  });
  return x;
}
export function chirp(FS) {
  const T = 6, f0 = 40, f1 = 15000, n = Math.round(T * FS), x = new Float32Array(n), k = Math.log(f1 / f0);
  for (let i = 0; i < n; i++) {
    const t = i / FS, ph = 2 * Math.PI * f0 * T / k * (Math.exp(k * t / T) - 1), env = Math.min(1, t / 0.05, (T - t) / 0.05);
    x[i] = 0.5 * env * Math.sin(ph);
  }
  return x;
}

// ---------- pictures: AM raster with one sample per M, envelope detection, alignment by cross-correlation
export function sendPicture(gray, W, H, spp, nu, t) {
  const n = W * H * spp, bb = new Float64Array(n), s = new Float64Array(n);
  for (let i = 0; i < n; i++) bb[i] = 0.2 + 0.8 * gray[Math.floor(i / spp)];
  { // soft pixel edges
    const k = [], m = spp; let sum = 0;
    for (let j = 0; j <= m; j++) { const v = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / m); k.push(v); sum += v; }
    const sm = new Float64Array(n), hm = m >> 1;
    for (let i = 0; i < n; i++) { let a = 0; for (let j = 0; j <= m; j++) { const q = Math.min(n - 1, Math.max(0, i + j - hm)); a += k[j] * bb[q]; } sm[i] = a / sum; }
    bb.set(sm);
  }
  for (let i = 0; i < n; i++) s[i] = bb[i] * Math.cos(nu * i);
  const outLen = n + 2048, r = through(s, 1, t, 1, outLen), N = pow2(outLen), re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < outLen; i++) { re[i] = 2 * r.y[i] * Math.cos(nu * i); im[i] = 2 * r.y[i] * Math.sin(nu * i); }
  fft(re, im, false);
  const cut = Math.min(nu, 2 * Math.PI / spp);
  for (let k = 0; k < N; k++) { const w = 2 * Math.PI * (k <= N / 2 ? k : k - N) / N; if (Math.abs(w) > cut) { re[k] = 0; im[k] = 0; } }
  fft(re, im, true);
  const env = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) env[i] = Math.hypot(re[i], im[i]);
  let mE = 0, mB = 0;
  for (let i = 0; i < n; i++) { mE += env[i]; mB += bb[i]; }
  mE /= n; mB /= n;
  const a1 = new Float64Array(N), a2 = new Float64Array(N), b1 = new Float64Array(N), b2 = new Float64Array(N);
  for (let i = 0; i < outLen; i++) a1[i] = env[i] - mE;
  for (let i = 0; i < n; i++) b1[i] = bb[i] - mB;
  fft(a1, a2, false); fft(b1, b2, false);
  for (let k = 0; k < N; k++) { const xr = a1[k] * b1[k] + a2[k] * b2[k], xi = a2[k] * b1[k] - a1[k] * b2[k]; a1[k] = xr; a2[k] = xi; }
  fft(a1, a2, true);
  let lag = 0;
  for (let l = 1; l <= 1500; l++) if (a1[l] > a1[lag]) lag = l;
  const rec = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) rec[p] = env[Math.min(outLen - 1, lag + p * spp + (spp >> 1))];
  return { rec, E: r.E, lag };
}
