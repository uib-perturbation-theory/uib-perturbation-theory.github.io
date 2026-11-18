/* Kerr background and the two trajectories of the simulator: a particle that
   falls from rest at infinity (E = 1) along the symmetry axis, and the
   equatorial plunge from the innermost stable circular orbit. Units
   G = c = M = 1.

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

/* Prograde innermost stable circular orbit (Bardeen, Press and Teukolsky
   1972): radius, energy and angular momentum per unit mass, angular
   frequency. */
export function isco(a) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const r = 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  const v = 1 / Math.sqrt(r);
  const den = Math.sqrt(1 - 3 * v * v + 2 * a * v ** 3);
  return {
    r,
    E: (1 - 2 * v * v + a * v ** 3) / den,
    L: (r * v * (1 - 2 * a * v ** 3 + a * a * v ** 4)) / den,
    omega: 1 / (r ** 1.5 + a),
  };
}

// Radius of the prograde circular photon orbit in the equatorial plane.
export function photonOrbit(a) {
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
}

/* Equatorial plunge from the ISCO: the geodesic with the energy and angular
   momentum of the ISCO, which leaves it at t = -infinity. With
   P = E (r^2 + a^2) - a L and R = P^2 - Delta (r^2 + (L - a E)^2), which has a
   triple root at the ISCO,
     dr/dt   = -sqrt(R) / T,                       T = (r^2 + a^2) P / Delta - a (a E - L),
     dphi/dt = (a P / Delta - (a E - L)) / T.
   As in the waveforms, t = 0 and phi = 0 when the particle crosses the
   prograde photon orbit. RK4 in t on y = ln(r - r+), backwards to tMin and
   forwards until r* < rsMin, with the same step as the waveforms. */
export function plunge(a, tMin = -220, rsMin = -16, dt = 0.1) {
  const { rp } = kerr(a);
  const { E, L, r: rIsco } = isco(a);
  const rph = photonOrbit(a);
  const c = a * E - L;

  function f(y) {
    const r = rp + Math.exp(y);
    const D = r * r - 2 * r + a * a;
    const P = E * (r * r + a * a) - a * L;
    const R = P * P - D * (r * r + c * c);
    const T = ((r * r + a * a) * P) / D - a * c;
    return [-Math.sqrt(Math.max(R, 0)) / T / (r - rp), (a * P / D - c) / T];
  }

  function step([y, ph], h) {
    const k1 = f(y);
    const k2 = f(y + 0.5 * h * k1[0]);
    const k3 = f(y + 0.5 * h * k2[0]);
    const k4 = f(y + h * k3[0]);
    return [
      y + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      ph + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    ];
  }

  const back = [];
  let s = [Math.log(rph - rp), 0];

  for (let k = 1, n0 = Math.ceil(-tMin / dt); k <= n0; k += 1) {
    s = step(s, -dt);
    back.push(s);
  }

  const fwd = [];
  s = [Math.log(rph - rp), 0];

  for (let k = 1; k <= 4000; k += 1) {
    s = step(s, dt);
    fwd.push(s);

    if (rstar(rp + Math.exp(s[0]), a) < rsMin) {
      break;
    }
  }

  const states = [...back.reverse(), [Math.log(rph - rp), 0], ...fwd];
  const N = states.length;
  const t0 = -back.length * dt;
  const r = new Float64Array(N);
  const rs = new Float64Array(N);
  const phi = new Float64Array(N);

  states.forEach(([y, ph], i) => {
    r[i] = rp + Math.exp(y);
    rs[i] = rstar(r[i], a);
    phi[i] = ph;
  });

  return {
    a,
    rp,
    rIsco,
    rph,
    tMin: t0,
    tMax: t0 + (N - 1) * dt,
    // { r, rStar, phi } at time t
    at(t) {
      const x = Math.min(N - 1, Math.max(0, (t - t0) / dt));
      const i = Math.min(N - 2, Math.floor(x));
      const w = x - i;
      return {
        r: r[i] + w * (r[i + 1] - r[i]),
        rStar: rs[i] + w * (rs[i + 1] - rs[i]),
        phi: phi[i] + w * (phi[i + 1] - phi[i]),
      };
    },
  };
}
