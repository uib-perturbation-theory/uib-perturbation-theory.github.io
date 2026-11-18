/* Regge–Wheeler time-domain solver, run in a Web Worker.

   JavaScript port of the group's rw_solver.py (the code used in
   "Shaping black hole resonances" I and II):
     - tortoise coordinate inverted with the Lambert W function,
     - Regge–Wheeler potential with smooth windows near the horizon
       (r = 2.01M -> 2.2M) and far away (r = 500M -> 1000M),
     - fourth-order finite differences with one-sided stencils at the edges,
     - classical RK4 on (Psi, Pi), Pi = dPsi/dt,
     - purely ingoing initial data, Pi = dPsi/ds.
   Units: G = c = M = 1, so the horizon is at r = 2.

   Messages in:  { sigma, nu, l, s0, sObs, ... }
   Messages out: meta, frames (chunks of Psi on the display grid),
                 obs (chunks of Psi at the observer), done. */

"use strict";

// ---------- Background ----------

// Solves w + ln w = L, i.e. w e^w = e^L (principal branch, w > 0).
// Working with L avoids overflowing e^L far from the black hole.
function lambertWExp(L) {
  let w;

  if (L < -30) {
    return Math.exp(L);
  }

  if (L > 1) {
    w = L - Math.log(L);
  } else {
    w = Math.exp(L) / (1 + Math.exp(L));
  }

  for (let k = 0; k < 60; k += 1) {
    const next = (w * (1 + L - Math.log(w))) / (1 + w);
    const done = Math.abs(next - w) <= 1e-15 * Math.max(1, Math.abs(next));
    w = next > 0 ? next : w * 0.5;

    if (done) {
      break;
    }
  }

  return w;
}

// Areal radius from the tortoise coordinate: r = 2M (1 + W(e^{s/2M - 1})).
function rOfS(s) {
  return 2 * (1 + lambertWExp(s / 2 - 1));
}

function windowW(r, rmin = 2.01, rramp = 2.2, rstart = 500, rcut = 1000) {
  let wL = 0;
  let wR = 0;

  if (r >= rramp) {
    wL = 1;
  } else if (r > rmin) {
    wL = Math.sin((0.5 * Math.PI * (r - rmin)) / (rramp - rmin)) ** 2;
  }

  if (r <= rstart) {
    wR = 1;
  } else if (r < rcut) {
    wR = Math.cos((0.5 * Math.PI * (r - rstart)) / (rcut - rstart)) ** 2;
  }

  return wL * wR;
}

function reggeWheeler(r, l) {
  return (1 - 2 / r) * ((l * (l + 1)) / (r * r) - 6 / (r * r * r));
}

// ---------- Fourth-order operators ----------

function d1(u, out, ds) {
  const n = u.length;
  const c = 1 / (12 * ds);

  for (let i = 2; i < n - 2; i += 1) {
    out[i] = (-u[i + 2] + 8 * u[i + 1] - 8 * u[i - 1] + u[i - 2]) * c;
  }

  out[0] = (-25 * u[0] + 48 * u[1] - 36 * u[2] + 16 * u[3] - 3 * u[4]) * c;
  out[1] = (-3 * u[0] - 10 * u[1] + 18 * u[2] - 6 * u[3] + u[4]) * c;
  out[n - 2] =
    (3 * u[n - 1] + 10 * u[n - 2] - 18 * u[n - 3] + 6 * u[n - 4] - u[n - 5]) * c;
  out[n - 1] =
    (25 * u[n - 1] - 48 * u[n - 2] + 36 * u[n - 3] - 16 * u[n - 4] + 3 * u[n - 5]) * c;
}

// out = d^2u/ds^2 - V u
function rhs(u, out, V, ds) {
  const n = u.length;
  const c = 1 / (12 * ds * ds);

  for (let i = 2; i < n - 2; i += 1) {
    out[i] =
      (-u[i - 2] + 16 * u[i - 1] - 30 * u[i] + 16 * u[i + 1] - u[i + 2]) * c -
      V[i] * u[i];
  }

  out[0] =
    (35 * u[0] - 104 * u[1] + 114 * u[2] - 56 * u[3] + 11 * u[4]) * c - V[0] * u[0];
  out[1] =
    (10 * u[0] - 15 * u[1] - 4 * u[2] + 14 * u[3] - 6 * u[4] + u[5]) * c -
    V[1] * u[1];
  out[n - 1] =
    (35 * u[n - 1] - 104 * u[n - 2] + 114 * u[n - 3] - 56 * u[n - 4] + 11 * u[n - 5]) * c -
    V[n - 1] * u[n - 1];
  out[n - 2] =
    (10 * u[n - 1] - 15 * u[n - 2] - 4 * u[n - 3] + 14 * u[n - 4] - 6 * u[n - 5] + u[n - 6]) * c -
    V[n - 2] * u[n - 2];
}

// ---------- Run ----------

// Numerical set-up. Grid spacing, CFL and amplitude as in the papers
// ("Shaping black hole resonances" I, Sec. V, and the group's scan scripts:
// np.linspace(-200, 1500, 8000), dt = 0.1 dr*, A = 1). The grid is extended
// to the left with the same nodes down to r* = -400.2, so that the part of
// the pulse that falls into the black hole and bounces off the inner edge of
// the grid does not come back before the final time of 700 M.
const PAPER_DS = 1700 / 7999;
const EXTRA_LEFT = Math.ceil(200 / PAPER_DS); // 942 nodes

const SETUP = {
  xMin: -200 - EXTRA_LEFT * PAPER_DS,
  xMax: 1500,
  n: 8000 + EXTRA_LEFT,
  cfl: 0.1,
  amp: 1,
  tFinal: 700,
};

function run(p) {
  const sigma = p.sigma;
  const nu = p.nu;
  const l = p.l;
  const s0 = p.s0;
  const sObs = p.sObs;
  const amp = p.amp ?? SETUP.amp;
  const xMin = p.xMin ?? SETUP.xMin;
  const xMax = p.xMax ?? SETUP.xMax;
  const n = p.n ?? SETUP.n;
  const cfl = p.cfl ?? SETUP.cfl;
  const tFinal = p.tFinal ?? SETUP.tFinal;
  const dispStep = p.dispStep ?? 2;
  const rIn = p.rIn ?? -10; // inner edge of the displayed sheet (tortoise)
  const rOut = Math.max(s0 + 3 * sigma, sObs) + 25; // outer edge of the sheet

  // Uniform grid as np.linspace(xMin, xMax, n); time step and number of steps
  // as in rw_solver.simula_full.
  const ds = (xMax - xMin) / (n - 1);
  const dt = cfl * ds;
  const nSteps = Math.floor(tFinal / dt);

  const s = new Float64Array(n);
  const V = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    s[i] = xMin + i * ds;
    const r = rOfS(s[i]);
    V[i] = windowW(r) * reggeWheeler(r, l);
  }

  // Observer: fourth-order Lagrange interpolation on four nodes, as in
  // rw_solver.extract_observer_4th.
  let idx = 0;
  while (idx < n && s[idx] < sObs) {
    idx += 1;
  }
  idx = Math.max(2, Math.min(idx, n - 2));
  const obsIdx = [idx - 2, idx - 1, idx, idx + 1];
  const obsW = obsIdx.map((ij, j) => {
    let num = 1;
    let den = 1;
    obsIdx.forEach((ik, k) => {
      if (k !== j) {
        num *= sObs - s[ik];
        den *= s[ij] - s[ik];
      }
    });
    return num / den;
  });

  // Display grid: every dispStep nodes between rIn and rOut.
  const iIn = Math.max(0, Math.ceil((rIn - xMin) / ds));
  const iOut = Math.min(n - 1, Math.floor((rOut - xMin) / ds));
  const dispIdx = [];

  for (let i = iIn; i <= iOut; i += dispStep) {
    dispIdx.push(i);
  }

  const nDisp = dispIdx.length;
  const rStar = new Float32Array(nDisp);
  const vDisp = new Float32Array(nDisp);

  dispIdx.forEach((i, k) => {
    rStar[k] = s[i];
    vDisp[k] = V[i];
  });

  // Frames for the 3D view every `sub` steps (about 0.25 M).
  const sub = Math.max(1, Math.round((p.frameDt ?? 0.25) / dt));
  const frameDt = sub * dt;
  const nFrames = Math.floor(nSteps / sub) + 1;

  self.postMessage({
    type: "meta",
    n,
    ds,
    dt,
    cfl,
    xMin,
    xMax,
    tEnd: (nFrames - 1) * frameDt,
    frameDt,
    nFrames,
    nSteps,
    rStar,
    vDisp,
    sObs,
    s0,
    l,
  });

  // Initial data: oscillating Gaussian, purely ingoing.
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const ut = new Float64Array(n);
  const vt = new Float64Array(n);
  const a = new Float64Array(n);
  const du = new Float64Array(n);
  const dv = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const x = s[i] - s0;
    u[i] = amp * Math.exp((-x * x) / (2 * sigma * sigma)) * Math.cos(nu * x);
  }

  d1(u, v, ds);

  const h = 0.5 * dt;
  const sixth = dt / 6;

  const FRAMES_PER_CHUNK = 24;
  let chunk = new Float32Array(FRAMES_PER_CHUNK * nDisp);
  let chunkStart = 0;
  let chunkCount = 0;

  const OBS_PER_CHUNK = FRAMES_PER_CHUNK * sub;
  let obs = new Float32Array(OBS_PER_CHUNK);
  let obsStart = 0;
  let obsCount = 0;

  const pushFrame = (frame) => {
    const off = chunkCount * nDisp;

    for (let k = 0; k < nDisp; k += 1) {
      chunk[off + k] = u[dispIdx[k]];
    }

    chunkCount += 1;

    if (chunkCount === FRAMES_PER_CHUNK || frame === nFrames - 1) {
      const data = chunk.slice(0, chunkCount * nDisp);
      self.postMessage(
        { type: "frames", start: chunkStart, count: chunkCount, data },
        [data.buffer]
      );
      chunkStart += chunkCount;
      chunkCount = 0;
    }
  };

  const pushObs = (last) => {
    obs[obsCount] =
      obsW[0] * u[obsIdx[0]] +
      obsW[1] * u[obsIdx[1]] +
      obsW[2] * u[obsIdx[2]] +
      obsW[3] * u[obsIdx[3]];
    obsCount += 1;

    if (obsCount === OBS_PER_CHUNK || last) {
      const data = obs.slice(0, obsCount);
      self.postMessage(
        { type: "obs", start: obsStart, count: obsCount, data },
        [data.buffer]
      );
      obsStart += obsCount;
      obsCount = 0;
    }
  };

  pushFrame(0);
  pushObs(nSteps === 0);

  for (let step = 1; step <= nSteps; step += 1) {
    // k1
    rhs(u, a, V, ds);
    for (let i = 0; i < n; i += 1) {
      du[i] = v[i];
      dv[i] = a[i];
      ut[i] = u[i] + h * v[i];
      vt[i] = v[i] + h * a[i];
    }

    // k2
    rhs(ut, a, V, ds);
    for (let i = 0; i < n; i += 1) {
      du[i] += 2 * vt[i];
      dv[i] += 2 * a[i];
      ut[i] = u[i] + h * vt[i];
      vt[i] = v[i] + h * a[i];
    }

    // k3
    rhs(ut, a, V, ds);
    for (let i = 0; i < n; i += 1) {
      du[i] += 2 * vt[i];
      dv[i] += 2 * a[i];
      ut[i] = u[i] + dt * vt[i];
      vt[i] = v[i] + dt * a[i];
    }

    // k4
    rhs(ut, a, V, ds);
    for (let i = 0; i < n; i += 1) {
      u[i] += sixth * (du[i] + vt[i]);
      v[i] += sixth * (dv[i] + a[i]);
    }

    pushObs(step === nSteps);

    if (step % sub === 0) {
      pushFrame(step / sub);
    }
  }

  self.postMessage({ type: "done" });
}

self.onmessage = (event) => {
  try {
    run(event.data);
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  }
};
