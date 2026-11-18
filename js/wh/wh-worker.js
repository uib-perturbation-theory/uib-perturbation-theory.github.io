/* Thin-shell wormhole solver, run in a (module) Web Worker.

   Two jobs, chosen by msg.type:

   "run"       time domain: a Gaussian pulse in universe 1 moves towards the
               throat. psi_tt = psi_xx - V psi on x in [-600, 600] M, with
               fourth-order finite differences, classical RK4, and the shell as
               a discrete delta C / dx added to V at the node x = 0. No
               boundary conditions: nothing reflected at the ends of the grid
               comes back to the displayed region before the final time.
               Streams meta, frames (psi on the display grid), obs (psi at the
               two observers and the energy beyond each of them), done.

   "spectrum"  frequency domain: transmission |T(omega)|^2 from universe 1 to
               universe 2. The outgoing solution j ~ e^{i omega x} is started
               from its asymptotic series at large r and integrated in to the
               throat; with q = j(0), h = j'(0) - C q / 2, matching across the
               shell gives T = i omega / (q h). Comb lines narrower than the
               frequency grid are found from jumps in the phase of q or h and
               refined to their peak.

   Units: G = c = M = 1. */

import { makeWormhole } from "./wh-model.js";

// ---------- Fourth-order operators on an active range [lo, hi] ----------

function d1(u, out, dx) {
  const n = u.length;
  const c = 1 / (12 * dx);

  for (let i = 2; i < n - 2; i += 1) {
    out[i] = (-u[i + 2] + 8 * u[i + 1] - 8 * u[i - 1] + u[i - 2]) * c;
  }

  out[0] = (-25 * u[0] + 48 * u[1] - 36 * u[2] + 16 * u[3] - 3 * u[4]) * c;
  out[1] = (-3 * u[0] - 10 * u[1] + 18 * u[2] - 6 * u[3] + u[4]) * c;
  out[n - 2] = (3 * u[n - 1] + 10 * u[n - 2] - 18 * u[n - 3] + 6 * u[n - 4] - u[n - 5]) * c;
  out[n - 1] = (25 * u[n - 1] - 48 * u[n - 2] + 36 * u[n - 3] - 16 * u[n - 4] + 3 * u[n - 5]) * c;
}

// out = u_xx - V u on [lo, hi]. Outside the range u is zero.
function rhs(u, out, V, dx, lo, hi) {
  const n = u.length;
  const c = 1 / (12 * dx * dx);
  const a = Math.max(lo, 2);
  const b = Math.min(hi, n - 3);

  for (let i = a; i <= b; i += 1) {
    out[i] = (-u[i - 2] + 16 * u[i - 1] - 30 * u[i] + 16 * u[i + 1] - u[i + 2]) * c - V[i] * u[i];
  }

  if (lo <= 1) {
    out[0] = (35 * u[0] - 104 * u[1] + 114 * u[2] - 56 * u[3] + 11 * u[4]) * c - V[0] * u[0];
    out[1] = (10 * u[0] - 15 * u[1] - 4 * u[2] + 14 * u[3] - 6 * u[4] + u[5]) * c - V[1] * u[1];
  }

  if (hi >= n - 2) {
    const m = n - 1;
    out[m] = (35 * u[m] - 104 * u[m - 1] + 114 * u[m - 2] - 56 * u[m - 3] + 11 * u[m - 4]) * c - V[m] * u[m];
    out[m - 1] =
      (10 * u[m] - 15 * u[m - 1] - 4 * u[m - 2] + 14 * u[m - 3] - 6 * u[m - 4] + u[m - 5]) * c -
      V[m - 1] * u[m - 1];
  }
}

// ---------- Time domain ----------

const SETUP = {
  dx: 0.2,
  X: 600, // grid x in [-X, X]
  cfl: 0.25,
  tFinal: 800,
  far: [450, 580], // the potential is switched off smoothly between these |x|
};

function farWindow(ax) {
  const [a, b] = SETUP.far;

  if (ax <= a) {
    return 1;
  }

  if (ax >= b) {
    return 0;
  }

  return Math.cos((0.5 * Math.PI * (ax - a)) / (b - a)) ** 2;
}

function run(p) {
  const wh = makeWormhole(p.s, p.l, p.delta);
  const { sigma, nu, x0 } = p;
  const xObs = p.xObs;
  const dx = SETUP.dx;
  const half = Math.round(SETUP.X / dx);
  const n = 2 * half + 1;
  const i0 = half; // x = 0
  const dt = SETUP.cfl * dx;
  const nSteps = Math.round(SETUP.tFinal / dt);
  const xOf = (i) => (i - i0) * dx;

  const V = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const x = xOf(i);
    V[i] = farWindow(Math.abs(x)) * wh.V(x);
  }

  // The shell: C delta(x) -> C / dx at the throat node.
  V[i0] += wh.C / dx;

  // Observers on grid nodes, A in universe 1 and B in universe 2.
  const iA = i0 + Math.round(xObs / dx);
  const iB = i0 - Math.round(xObs / dx);

  // Display grid: every other node with |x| <= xDisp.
  const xDisp = Math.max(x0 + 3 * sigma, xObs) + 25;
  const dispStep = 2;
  const kDisp = Math.floor(xDisp / (dispStep * dx));
  const dispIdx = [];

  for (let k = -kDisp; k <= kDisp; k += 1) {
    dispIdx.push(i0 + k * dispStep);
  }

  const nDisp = dispIdx.length;
  const xs = new Float32Array(nDisp);
  const vDisp = new Float32Array(nDisp);

  dispIdx.forEach((i, k) => {
    xs[k] = xOf(i);
    vDisp[k] = i === i0 ? wh.V(0) : V[i];
  });

  const sub = Math.max(1, Math.round(0.4 / dt));
  const frameDt = sub * dt;
  const nFrames = Math.floor(nSteps / sub) + 1;

  // Initial data: oscillating Gaussian moving towards the throat.
  const u = new Float64Array(n);
  const v = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const y = xOf(i) - x0;
    u[i] = Math.exp((-y * y) / (2 * sigma * sigma)) * Math.cos(nu * y);
  }

  d1(u, v, dx);

  // Energy, 1/2 (psi_t^2 + psi_x^2 + V psi^2), in total and beyond each
  // observer (the junction term sits at x = 0, between them).
  const ux = new Float64Array(n);
  d1(u, ux, dx);
  let E0 = 0;
  let EA = 0;
  let EB = 0;

  for (let i = 0; i < n; i += 1) {
    const e = 0.5 * (v[i] * v[i] + ux[i] * ux[i] + V[i] * u[i] * u[i]) * dx;
    const w = i === iA || i === iB ? 0.5 : 1;
    E0 += e;

    if (i >= iA) {
      EA += w * e;
    }

    if (i <= iB) {
      EB += w * e;
    }
  }

  self.postMessage({
    type: "meta",
    n,
    dx,
    dt,
    cfl: SETUP.cfl,
    xMin: xOf(0),
    xMax: xOf(n - 1),
    tEnd: (nFrames - 1) * frameDt,
    frameDt,
    nFrames,
    nSteps,
    xs,
    vDisp,
    xDisp: kDisp * dispStep * dx,
    xObs: xOf(iA),
    x0,
    s: wh.s,
    l: wh.l,
    delta: wh.delta,
    d: wh.d,
    C: wh.C,
    E0,
  });

  // Active range: the light cone of the initial pulse, widened at 1.25 c
  // plus a margin. Outside it the field is zero to round-off.
  const supLo = Math.max(0, i0 + Math.floor((x0 - 7 * sigma) / dx) - 60);
  const supHi = Math.min(n - 1, i0 + Math.ceil((x0 + 7 * sigma) / dx) + 60);
  const grow = (1.25 * dt) / dx;

  const ut = new Float64Array(n);
  const vt = new Float64Array(n);
  const acc = new Float64Array(n);
  const du = new Float64Array(n);
  const dv = new Float64Array(n);
  const h = 0.5 * dt;
  const sixth = dt / 6;

  const FRAMES_PER_CHUNK = 24;
  const chunk = new Float32Array(FRAMES_PER_CHUNK * nDisp);
  let chunkStart = 0;
  let chunkCount = 0;

  const OBS_PER_CHUNK = FRAMES_PER_CHUNK * sub;
  const obsA = new Float32Array(OBS_PER_CHUNK);
  const obsB = new Float32Array(OBS_PER_CHUNK);
  const enA = new Float32Array(OBS_PER_CHUNK);
  const enB = new Float32Array(OBS_PER_CHUNK);
  let obsStart = 0;
  let obsCount = 0;
  const cx = 1 / (12 * dx);

  // Energy flux towards +x is -psi_t psi_x.
  const fluxOut = (i, sign) =>
    -sign * v[i] * (-u[i + 2] + 8 * u[i + 1] - 8 * u[i - 1] + u[i - 2]) * cx;
  let fA = fluxOut(iA, 1);
  let fB = fluxOut(iB, -1);

  const pushFrame = (frame) => {
    const off = chunkCount * nDisp;

    for (let k = 0; k < nDisp; k += 1) {
      chunk[off + k] = u[dispIdx[k]];
    }

    chunkCount += 1;

    if (chunkCount === FRAMES_PER_CHUNK || frame === nFrames - 1) {
      const data = chunk.slice(0, chunkCount * nDisp);
      self.postMessage({ type: "frames", start: chunkStart, count: chunkCount, data }, [data.buffer]);
      chunkStart += chunkCount;
      chunkCount = 0;
    }
  };

  const pushObs = (last) => {
    obsA[obsCount] = u[iA];
    obsB[obsCount] = u[iB];
    enA[obsCount] = EA / E0;
    enB[obsCount] = EB / E0;
    obsCount += 1;

    if (obsCount === OBS_PER_CHUNK || last) {
      const a = obsA.slice(0, obsCount);
      const b = obsB.slice(0, obsCount);
      const ea = enA.slice(0, obsCount);
      const eb = enB.slice(0, obsCount);
      self.postMessage(
        { type: "obs", start: obsStart, count: obsCount, a, b, ea, eb },
        [a.buffer, b.buffer, ea.buffer, eb.buffer]
      );
      obsStart += obsCount;
      obsCount = 0;
    }
  };

  pushFrame(0);
  pushObs(nSteps === 0);

  for (let step = 1; step <= nSteps; step += 1) {
    const spread = Math.ceil(step * grow);
    const lo = Math.max(0, supLo - spread);
    const hi = Math.min(n - 1, supHi + spread);

    rhs(u, acc, V, dx, lo, hi);
    for (let i = lo; i <= hi; i += 1) {
      du[i] = v[i];
      dv[i] = acc[i];
      ut[i] = u[i] + h * v[i];
      vt[i] = v[i] + h * acc[i];
    }

    rhs(ut, acc, V, dx, lo, hi);
    for (let i = lo; i <= hi; i += 1) {
      du[i] += 2 * vt[i];
      dv[i] += 2 * acc[i];
      ut[i] = u[i] + h * vt[i];
      vt[i] = v[i] + h * acc[i];
    }

    rhs(ut, acc, V, dx, lo, hi);
    for (let i = lo; i <= hi; i += 1) {
      du[i] += 2 * vt[i];
      dv[i] += 2 * acc[i];
      ut[i] = u[i] + dt * vt[i];
      vt[i] = v[i] + dt * acc[i];
    }

    rhs(ut, acc, V, dx, lo, hi);
    for (let i = lo; i <= hi; i += 1) {
      u[i] += sixth * (du[i] + vt[i]);
      v[i] += sixth * (dv[i] + acc[i]);
    }

    // Energy beyond each observer: what was there plus what has crossed it.
    const nA = fluxOut(iA, 1);
    const nB = fluxOut(iB, -1);
    EA += 0.5 * (fA + nA) * dt;
    EB += 0.5 * (fB + nB) * dt;
    fA = nA;
    fB = nB;

    pushObs(step === nSteps);

    if (step % sub === 0) {
      pushFrame(step / sub);
    }
  }

  self.postMessage({ type: "done" });
}

// ---------- Frequency domain ----------

const W_MIN = 0.02;
const W_MAX = 1.25;
const NW = 1200;
const H_FINE = 0.025; // step inside the cavity and around the peaks
const H_COARSE = 0.25; // step further out, where j / e^{i w x} is smooth

/* Shared x grid for the inward integration. Coarse nodes from xMax down to
   xF, fine nodes from xF to the throat; V is tabulated at every node and
   half-node. */
function makeGrid(wh) {
  const xF = Math.ceil((Math.max(wh.d, 0) + 40) / H_COARSE) * H_COARSE;
  const rJoin = (w) => Math.max(250, 25 / w);
  const xJoin = (w) => {
    const r = rJoin(w);
    return r + 2 * Math.log(r / 2 - 1) - wh.ra;
  };
  const nC = Math.ceil((xJoin(W_MIN) - xF) / H_COARSE) + 1;
  const nF = Math.round(xF / H_FINE);
  const Vc = new Float64Array(2 * nC + 1);
  const Vf = new Float64Array(2 * nF + 1);

  for (let k = 0; k <= 2 * nC; k += 1) {
    Vc[k] = wh.V(xF + 0.5 * k * H_COARSE);
  }

  for (let k = 0; k <= 2 * nF; k += 1) {
    Vf[k] = wh.V(0.5 * k * H_FINE);
  }

  // First coarse node at or beyond the matching point of each frequency.
  const kStart = (w) => Math.min(nC, Math.ceil((xJoin(w) - xF) / H_COARSE));

  return { wh, xF, nC, nF, Vc, Vf, kStart };
}

// Asymptotic series j = e^{i w x} sum_n c_n r^-n; returns A, dA/dr.
function series(w, r, L, s, out) {
  let cPrevR = 0;
  let cPrevI = 0;
  let cR = 1;
  let cI = 0;
  let aR = 1;
  let aI = 0;
  let dR = 0;
  let dI = 0;
  let rn = 1;
  let lastMag = Infinity;

  for (let k = 0; k < 30; k += 1) {
    // c_{k+1} = ([k(k+1) - L] c_k + 2 (s^2 - k^2) c_{k-1}) / (2 i w (k+1))
    const nr = (k * (k + 1) - L) * cR + 2 * (s * s - k * k) * cPrevR;
    const ni = (k * (k + 1) - L) * cI + 2 * (s * s - k * k) * cPrevI;
    const den = 2 * w * (k + 1);
    const nextR = ni / den; // divide by i: (nr + i ni) / i = ni - i nr
    const nextI = -nr / den;
    cPrevR = cR;
    cPrevI = cI;
    cR = nextR;
    cI = nextI;
    rn *= r;
    const tR = cR / rn;
    const tI = cI / rn;
    const mag = Math.hypot(tR, tI);

    if (mag > lastMag || mag < 1e-17) {
      break;
    }

    lastMag = mag;
    aR += tR;
    aI += tI;
    dR -= ((k + 1) * tR) / r;
    dI -= ((k + 1) * tI) / r;
  }

  out[0] = aR;
  out[1] = aI;
  out[2] = dR;
  out[3] = dI;
}

/* q = j(0) and h = j'(0) - C q / 2 for every frequency in ws (ascending).
   Writes j = e^{i w x} A(x) and integrates A'' = V A - 2 i w A' inwards with
   RK4 on the shared grid. */
function outgoing(grid, ws) {
  const { wh, xF, nC, nF, Vc, Vf, kStart } = grid;
  const m = ws.length;
  const AR = new Float64Array(m);
  const AI = new Float64Array(m);
  const PR = new Float64Array(m);
  const PI = new Float64Array(m);
  const starts = Int32Array.from(ws, (w) => kStart(w));
  const tmp = new Float64Array(4);
  let active = 0;

  const begin = (k) => {
    while (active < m && starts[active] >= k) {
      const x = xF + k * H_COARSE;
      const r = wh.r(x);
      series(ws[active], r, wh.L, wh.s, tmp);
      const f = 1 - 2 / r;
      AR[active] = tmp[0];
      AI[active] = tmp[1];
      PR[active] = f * tmp[2];
      PI[active] = f * tmp[3];
      active += 1;
    }
  };

  // One RK4 step of length -hh for the active frequencies, with V at the
  // start, middle and end of the step.
  const step = (hh, v0, v1, v2) => {
    for (let j = 0; j < active; j += 1) {
      const w2 = 2 * ws[j];
      const ar = AR[j];
      const ai = AI[j];
      const pr = PR[j];
      const pi = PI[j];
      // F(A, P) = (P, V A - 2 i w P); stepping backwards: x -> x - hh.
      const k1ar = pr;
      const k1ai = pi;
      const k1pr = v0 * ar + w2 * pi;
      const k1pi = v0 * ai - w2 * pr;
      let tar = ar - 0.5 * hh * k1ar;
      let tai = ai - 0.5 * hh * k1ai;
      let tpr = pr - 0.5 * hh * k1pr;
      let tpi = pi - 0.5 * hh * k1pi;
      const k2ar = tpr;
      const k2ai = tpi;
      const k2pr = v1 * tar + w2 * tpi;
      const k2pi = v1 * tai - w2 * tpr;
      tar = ar - 0.5 * hh * k2ar;
      tai = ai - 0.5 * hh * k2ai;
      tpr = pr - 0.5 * hh * k2pr;
      tpi = pi - 0.5 * hh * k2pi;
      const k3ar = tpr;
      const k3ai = tpi;
      const k3pr = v1 * tar + w2 * tpi;
      const k3pi = v1 * tai - w2 * tpr;
      tar = ar - hh * k3ar;
      tai = ai - hh * k3ai;
      tpr = pr - hh * k3pr;
      tpi = pi - hh * k3pi;
      const k4ar = tpr;
      const k4ai = tpi;
      const k4pr = v2 * tar + w2 * tpi;
      const k4pi = v2 * tai - w2 * tpr;
      const c = hh / 6;
      AR[j] = ar - c * (k1ar + 2 * k2ar + 2 * k3ar + k4ar);
      AI[j] = ai - c * (k1ai + 2 * k2ai + 2 * k3ai + k4ai);
      PR[j] = pr - c * (k1pr + 2 * k2pr + 2 * k3pr + k4pr);
      PI[j] = pi - c * (k1pi + 2 * k2pi + 2 * k3pi + k4pi);
    }
  };

  for (let k = nC; k >= 1; k -= 1) {
    begin(k);
    step(H_COARSE, Vc[2 * k], Vc[2 * k - 1], Vc[2 * k - 2]);
  }

  begin(0);

  for (let k = nF; k >= 1; k -= 1) {
    step(H_FINE, Vf[2 * k], Vf[2 * k - 1], Vf[2 * k - 2]);
  }

  // q = A(0), j'(0) = A'(0) + i w A(0)
  const out = new Float64Array(4 * m);

  for (let j = 0; j < m; j += 1) {
    const qr = AR[j];
    const qi = AI[j];
    const hr = PR[j] - ws[j] * qi - 0.5 * wh.C * qr;
    const hi = PI[j] + ws[j] * qr - 0.5 * wh.C * qi;
    out.set([qr, qi, hr, hi], 4 * j);
  }

  return out;
}

// |T|^2 = w^2 / |q h|^2
const t2Of = (w, o, j) => (w * w) / ((o[4 * j] ** 2 + o[4 * j + 1] ** 2) * (o[4 * j + 2] ** 2 + o[4 * j + 3] ** 2));

function t2At(grid, w) {
  return t2Of(w, outgoing(grid, [w]), 0);
}

// Maximum of |T|^2 on [a, b] by golden-section search (one comb line).
function refine(grid, a, b) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = t2At(grid, c);
  let fd = t2At(grid, d);

  for (let it = 0; it < 90 && b - a > 1e-15 * b; it += 1) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = t2At(grid, c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = t2At(grid, d);
    }
  }

  return fc > fd ? { w: c, t2: fc } : { w: d, t2: fd };
}

function spectrum(p) {
  const wh = makeWormhole(p.s, p.l, p.delta);
  const grid = makeGrid(wh);
  const ws = Float64Array.from({ length: NW }, (_, j) => W_MIN + ((W_MAX - W_MIN) * j) / (NW - 1));
  const o = outgoing(grid, ws);
  const t2 = Float64Array.from(ws, (w, j) => t2Of(w, o, j));

  // Brackets: a jump of the phase of q or h between two samples (a line
  // narrower than the grid), or a local maximum of |T|^2 below 1.
  const brackets = [];
  const phase = (j, off) => Math.atan2(o[4 * j + off + 1], o[4 * j + off]);
  const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

  for (let j = 0; j + 1 < NW; j += 1) {
    const jq = Math.abs(wrap(phase(j + 1, 0) - phase(j, 0)));
    const jh = Math.abs(wrap(phase(j + 1, 2) - phase(j, 2)));

    if (jq > 1.5 || jh > 1.5) {
      brackets.push([j, j + 1]);
    }
  }

  for (let j = 1; j + 1 < NW; j += 1) {
    if (t2[j] >= t2[j - 1] && t2[j] >= t2[j + 1] && t2[j] < 0.995) {
      brackets.push([j - 1, j + 1]);
    }
  }

  brackets.sort((x, y) => x[0] - y[0]);
  const merged = [];

  for (const br of brackets) {
    const last = merged[merged.length - 1];

    if (last && br[0] <= last[1]) {
      last[1] = Math.max(last[1], br[1]);
    } else {
      merged.push([...br]);
    }
  }

  const lines = merged
    .map(([ja, jb]) => ({ ...refine(grid, ws[ja], ws[jb]), ja, jb }))
    .filter((line) => Number.isFinite(line.t2) && line.t2 > Math.max(t2[line.ja], t2[line.jb]));

  // Lines wide enough to be resolved by the grid itself
  for (let j = 1; j + 1 < NW; j += 1) {
    const peak = t2[j] >= t2[j - 1] && t2[j] >= t2[j + 1] && t2[j] >= 0.995;

    if (peak && !lines.some((line) => j >= line.ja && j <= line.jb)) {
      lines.push({ w: ws[j], t2: t2[j], ja: j, jb: j });
    }
  }

  lines.sort((x, y) => x.w - y.w);

  self.postMessage({
    type: "spectrum",
    key: p.key,
    omegas: ws,
    t2,
    lines,
    vTop: wh.vTop,
    d: wh.d,
  });
}

self.onmessage = (event) => {
  const msg = event.data;

  try {
    if (msg.type === "spectrum") {
      spectrum(msg);
    } else {
      run(msg);
    }
  } catch (err) {
    self.postMessage({ type: "error", job: msg.type, message: String(err && err.message ? err.message : err) });
  }
};
