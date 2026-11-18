/* Kerr background and the trajectory of a particle that falls from rest at
   infinity (E = 1) along the symmetry axis. Units G = c = M = 1.

   Along the axis (L = 0, Carter constant Q = 0):
     dr/dtau = -sqrt(2 r (r^2 + a^2)) / (r^2 + a^2),   dt/dtau = (r^2 + a^2) / Delta.
   With the advanced time v = t + r* this gives
     dv/dr = -(r^2 + a^2) / (2 r (1 + s)),   s = sqrt((r^2 + a^2) / (2 r)),
   which is finite at the horizon. As in the GSN waveforms, v = 0 when the
   particle crosses the horizon, so t_p(r) = v(r) - r*(r). */

export function kerr(a) {
  const q = Math.sqrt(1 - a * a);
  return { rp: 1 + q, rm: 1 - q };
}

// Tortoise coordinate with the same integration constant as the GSN code
// (for a = 0 it is r + 2 ln(r/2 - 1)).
export function rstar(r, a) {
  const { rp, rm } = kerr(a);
  const d = rp - rm;
  return r + ((2 * rp) / d) * Math.log((r - rp) / 2) - ((2 * rm) / d) * Math.log((r - rm) / 2);
}

function dvdr(r, a) {
  const S = r * r + a * a;
  const s = Math.sqrt(S / (2 * r));
  return -S / (2 * r * (1 + s));
}

// Radius of the polar circular photon orbit: r^3 - 3 r^2 + a^2 r + a^2 = 0.
export function lightRing(a) {
  let r = 3;

  for (let k = 0; k < 40; k += 1) {
    const f = r * r * r - 3 * r * r + a * a * r + a * a;
    const df = 3 * r * r - 6 * r + a * a;
    r -= f / df;
  }

  return r;
}

/* Tabulates the infall from rMax down to r+ + 1e-10 on a grid uniform in
   ln(r - r+), and returns the position at any time t. */
export function infall(a, rMax = 60, N = 4000) {
  const { rp } = kerr(a);
  const lx0 = Math.log(1e-10);
  const lx1 = Math.log(rMax - rp);
  const h = (lx1 - lx0) / (N - 1);

  const r = new Float64Array(N);
  const rs = new Float64Array(N);
  const tp = new Float64Array(N);

  let v = dvdr(rp, a) * Math.exp(lx0);
  let fPrev = 0;

  for (let i = 0; i < N; i += 1) {
    const x = Math.exp(lx0 + i * h);
    r[i] = rp + x;
    rs[i] = rstar(r[i], a);
    const f = dvdr(r[i], a) * x; // dv / d(ln x)

    if (i > 0) {
      v += 0.5 * h * (f + fPrev);
    }

    fPrev = f;
    tp[i] = v - rs[i];
  }

  // t_p decreases with r: find the radius at time t by bisection.
  function locate(t) {
    if (t >= tp[0]) {
      return { i: 0, w: 0 };
    }

    if (t <= tp[N - 1]) {
      return { i: N - 2, w: 1 };
    }

    let lo = 0;
    let hi = N - 1;

    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;

      if (tp[mid] > t) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return { i: lo, w: (tp[lo] - t) / (tp[lo] - tp[lo + 1]) };
  }

  const lerp = (arr, { i, w }) => arr[i] + w * (arr[i + 1] - arr[i]);

  return {
    a,
    rp,
    // time at which the particle is at radius R
    timeAt(R) {
      const x = Math.log(R - rp);
      const k = Math.min(N - 2, Math.max(0, Math.floor((x - lx0) / h)));
      const w = (x - (lx0 + k * h)) / h;
      return tp[k] + w * (tp[k + 1] - tp[k]);
    },
    // { r, rStar } at time t
    at(t) {
      const loc = locate(t);
      return { r: lerp(r, loc), rStar: lerp(rs, loc) };
    },
  };
}
