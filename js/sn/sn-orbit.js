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

/* Radius of the spherical photon orbit with inclination x = cos(iota) (same
   convention as the particle: z_- = sqrt(1 - x^2) is the largest |cos(theta)|
   reached, and x > 0 for prograde motion). With E = 1, the orbit at radius r
   has L = xi and Q = eta,
     xi  = -(r^3 - 3 r^2 + a^2 r + a^2) / (a (r - 1)),
     eta = r^3 (4 a^2 - r (r - 3)^2) / (a^2 (r - 1)^2),
   and z_-^2 is the smaller root of a^2 z^4 - (eta + xi^2 + a^2) z^2 + eta = 0.
   x falls from +1 to -1 between the prograde and the retrograde circular
   photon orbits, so bisection finds r. */
export function sphericalPhotonOrbit(a, x) {
  if (a < 1e-9) return 3;
  const xOf = (r) => {
    const xi = -(r ** 3 - 3 * r * r + a * a * r + a * a) / (a * (r - 1));
    const eta = Math.max(0, (r ** 3 * (4 * a * a - r * (r - 3) ** 2)) / (a * a * (r - 1) ** 2));
    const b = eta + xi * xi + a * a;
    const z2 = (2 * eta) / (b + Math.sqrt(Math.max(b * b - 4 * a * a * eta, 0)));
    return Math.sign(xi) * Math.sqrt(Math.max(0, 1 - z2));
  };
  let lo = photonOrbit(a);
  let hi = 2 * (1 + Math.cos((2 / 3) * Math.acos(a)));

  for (let i = 0; i < 60; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (xOf(mid) > x) lo = mid;
    else hi = mid;
  }

  return 0.5 * (lo + hi);
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

/* Inclined plunge from the innermost stable spherical orbit (ISSO).
   x = cos(iota): the orbit reaches latitudes up to iota (prograde for
   iota < 90 degrees, retrograde above), so that cos(theta_min) = sqrt(1 - x^2)
   and L has the sign of x. In Mino time (d tau = Sigma d lambda) the radial and
   polar motions separate:
     (dr/dl)^2 = R(r),   cos(theta) = z_- cos(chi),
     dchi/dl = sqrt(w2 - beta z_-^2 cos^2 chi),  beta = a^2 (1 - E^2),  w2 = Q / z_-^2.
   R(r) = (E^2 - 1) r^4 + 2 r^3 + (a^2 (E^2 - 1) - L^2 - Q) r^2
          + 2 ((L - a E)^2 + Q) r - a^2 Q. */

function rCoef(a, E, L, Q) {
  return [E * E - 1, 2, a * a * (E * E - 1) - L * L - Q, 2 * ((L - a * E) ** 2 + Q), -a * a * Q];
}

function rPoly(c, r, d = 0) {
  if (d === 0) return (((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4];
  if (d === 1) return ((4 * c[0] * r + 3 * c[1]) * r + 2 * c[2]) * r + c[3];
  return (12 * c[0] * r + 6 * c[1]) * r + 2 * c[2];
}

// Theta(z_-) = 0, written so that it stays regular at x = 0 and at |x| = 1.
function inclination(a, x, E, L, Q) {
  const beta = a * a * (1 - E * E);
  const zm2 = 1 - x * x;
  if (Math.abs(x) > 0.5) return Q * x * x - zm2 * (L * L + beta * x * x);
  return L - x * Math.sqrt(Math.max(Q - beta * zm2, 0) / zm2);
}

function solve4(J, f) {
  // Gaussian elimination with partial pivoting
  const n = f.length;
  const A = J.map((row, i) => [...row, f[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < n; r += 1) {
      const k = A[r][c] / A[c][c];
      for (let j = c; j <= n; j += 1) A[r][j] -= k * A[c][j];
    }
  }
  const u = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = A[r][n];
    for (let j = r + 1; j < n; j += 1) s -= A[r][j] * u[j];
    u[r] = s / A[r][r];
  }
  return u;
}

// ISSO radius and constants of motion, by Newton's method with continuation in a.
export function isso(a, x) {
  const Lt = Math.sqrt(12);
  let u = [6, Math.sqrt(8 / 9), x * Lt, (1 - x * x) * 12];
  const steps = 20;

  for (let k = 1; k <= steps; k += 1) {
    const ak = (a * k) / steps;
    const F = ([r, E, L, Q]) => {
      const c = rCoef(ak, E, L, Q);
      return [rPoly(c, r), rPoly(c, r, 1), rPoly(c, r, 2), inclination(ak, x, E, L, Q)];
    };

    for (let it = 0; it < 50; it += 1) {
      const f = F(u);
      const J = [[], [], [], []];
      for (let j = 0; j < 4; j += 1) {
        const h = 1e-7 * Math.max(1, Math.abs(u[j]));
        const up = u.slice();
        const um = u.slice();
        up[j] += h;
        um[j] -= h;
        const fp = F(up);
        const fm = F(um);
        for (let i = 0; i < 4; i += 1) J[i][j] = (fp[i] - fm[i]) / (2 * h);
      }
      const du = solve4(J, f);
      u = u.map((v, i) => v - du[i]);
      if (Math.max(...du.map(Math.abs)) < 1e-14) break;
    }
  }

  const [r, E, L, Q] = u;
  return { r, E, L, Q };
}

/* The plunge on a uniform grid in coordinate time, integrated with RK4 in
   (ln(r - r+), chi, phi). As for the equatorial plunge, t = 0 and phi = 0 where
   the particle crosses the prograde light ring; chi0 is the polar phase there.
   Returns { r, rStar, theta, phi } at any time t. */
export function inclinedPlunge(a, x, chi0 = 0, tMin = -220, rsMin = -16, dt = 0.1) {
  const { rp } = kerr(a);
  const o = isso(a, x);
  const { E, L, Q } = o;
  const rph = photonOrbit(a);
  const c = rCoef(a, E, L, Q);
  const beta = a * a * (1 - E * E);
  const B = Q + L * L + beta;
  const w2 = (B + Math.sqrt(Math.max(B * B - 4 * beta * Q, 0))) / 2;
  const zm = w2 > 0 ? Math.sqrt(Q / w2) : 0;
  const polar = Math.abs(L) < 1e-13;

  function f([y, chi]) {
    const r = rp + Math.exp(y);
    const D = r * r - 2 * r + a * a;
    const P = E * (r * r + a * a) - a * L;
    const z = zm * Math.cos(chi);
    const s2 = 1 - z * z;
    const drdl = -Math.sqrt(Math.max(rPoly(c, r), 0));
    const dchidl = Math.sqrt(Math.max(w2 - beta * zm * zm * Math.cos(chi) ** 2, 0));
    const dtdl = ((r * r + a * a) * P) / D + a * L - a * a * E * s2;
    const dphidl = (a * P) / D - a * E + (polar ? 0 : L / s2);
    return [drdl / dtdl / (r - rp), dchidl / dtdl, dphidl / dtdl];
  }

  function step(s, h) {
    const k1 = f(s);
    const k2 = f(s.map((v, i) => v + 0.5 * h * k1[i]));
    const k3 = f(s.map((v, i) => v + 0.5 * h * k2[i]));
    const k4 = f(s.map((v, i) => v + h * k3[i]));
    return s.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  }

  const s0 = [Math.log(rph - rp), chi0, 0];
  const back = [];
  let s = s0;

  for (let k = 1, n0 = Math.ceil(-tMin / dt); k <= n0; k += 1) {
    s = step(s, -dt);
    back.push(s);
  }

  const fwd = [];
  s = s0;

  for (let k = 1; k <= 6000; k += 1) {
    s = step(s, dt);
    fwd.push(s);
    if (rstar(rp + Math.exp(s[0]), a) < rsMin) break;
  }

  const states = [...back.reverse(), s0, ...fwd];
  const N = states.length;
  const t0 = -back.length * dt;
  const r = new Float64Array(N);
  const rs = new Float64Array(N);
  const z = new Float64Array(N);
  const phi = new Float64Array(N);

  states.forEach(([y, chi, ph], i) => {
    r[i] = rp + Math.exp(y);
    rs[i] = rstar(r[i], a);
    z[i] = zm * Math.cos(chi);
    // an exactly polar orbit goes over the pole, to the other side (phi + pi)
    phi[i] = polar && Math.sin(chi) < 0 ? ph + Math.PI : ph;
  });

  return {
    a,
    x,
    rp,
    rIsso: o.r,
    E,
    L,
    Q,
    rph,
    tMin: t0,
    tMax: t0 + (N - 1) * dt,
    at(t) {
      const u = Math.min(N - 1, Math.max(0, (t - t0) / dt));
      const i = Math.min(N - 2, Math.floor(u));
      const w = u - i;
      const lerp = (A) => A[i] + w * (A[i + 1] - A[i]);
      // Cartesian-like interpolation avoids the phi jump of a polar orbit
      const p0 = phi[i];
      const p1 = phi[i + 1];
      const dp = Math.abs(p1 - p0) > 2 ? 0 : p1 - p0;
      return { r: lerp(r), rStar: lerp(rs), theta: Math.acos(Math.max(-1, Math.min(1, lerp(z)))), phi: p0 + w * dp };
    },
  };
}
