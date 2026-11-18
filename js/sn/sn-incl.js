/* Data of the inclined plunge from the ISSO.

   Each orbit (spin a, inclination iota, polar phase chi0) is stored as the
   spherical-harmonic modes of the strain, r h_lm(u) / mu for l = 2..4 and
   m = -l..l, so that at any direction (theta, phi) from the spin axis
     h_+ - i h_x = sum_lm h_lm(u) _{-2}Y_lm(theta, phi).
   They were computed in the frequency domain (Teukolsky equation solved with
   the generalised Sasaki-Nakamura transformation, source integrated along the
   geodesic) and projected from the spheroidal onto the spherical harmonics.

   Binary layout: Float32, modes in the order of MODES, each n complex samples
   (re, im interleaved) on u = u0 + i du.

   Only the phases chi0 = 0 and pi/2 are stored. chi0 + pi is the mirror image
   of the orbit in the equatorial plane, whose modes are
     h_lm -> (-1)^l conj(h_{l,-m}). */

export const MODES = [];
for (let l = 2; l <= 4; l += 1) {
  for (let m = -l; m <= l; m += 1) MODES.push([l, m]);
}
const modeIndex = (l, m) => MODES.findIndex(([L, M]) => L === l && M === m);

function fact(n) {
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
}

function binom(n, k) {
  return k < 0 || k > n ? 0 : fact(n) / (fact(k) * fact(n - k));
}

// Spin-weighted spherical harmonic sY_lm(theta, 0) (Goldberg et al. 1967), real.
export function sYlm(s, l, m, theta) {
  const pre = (-1) ** m * Math.sqrt((fact(l + m) * fact(l - m) * (2 * l + 1)) / (4 * Math.PI * fact(l + s) * fact(l - s)));
  const sh = Math.sin(theta / 2);
  const ch = Math.cos(theta / 2);
  let sum = 0;

  for (let r = 0; r <= l - s; r += 1) {
    const b = binom(l - s, r) * binom(l + s, r + s - m);
    if (!b) continue;
    const k = 2 * r + s - m;
    sum += b * (-1) ** (l - r - s) * sh ** (2 * l - k) * ch ** k;
  }

  return pre * sum;
}

export async function loadInclIndex(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const j = await res.json();
  return { ...j, base: new URL(".", res.url).href };
}

const cache = new Map();

/* Orbit k (spin), i (inclination) and phase c = 0..3 (chi0 = c pi/2).
   Returns { modes: [Float32Array(2n)], u0, du, n, meta }. */
export async function loadInclOrbit(index, k, i, c) {
  const meta = index.orbits[k][i][c % 2] ?? index.orbits[k][i][0];
  const url = new URL(meta.file, index.base).href;

  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
        return res.arrayBuffer();
      })
    );
  }

  const all = new Float32Array(await cache.get(url));
  const { n } = index;
  let modes = MODES.map((_, q) => all.subarray(2 * n * q, 2 * n * (q + 1)));

  // equatorial orbits do not depend on the phase; the others are mirrored for c >= 2
  if (c >= 2 && meta.iota % 180 !== 0) {
    modes = MODES.map(([l, m]) => {
      const src = modes[modeIndex(l, -m)];
      const out = new Float32Array(2 * n);
      const sg = l % 2 === 0 ? 1 : -1;
      for (let s = 0; s < n; s += 1) {
        out[2 * s] = sg * src[2 * s];
        out[2 * s + 1] = -sg * src[2 * s + 1];
      }
      return out;
    });
  }

  return { modes, u0: index.u0, du: index.du, n, meta };
}

// Catmull-Rom interpolation of an interleaved complex series at fractional index x
function interp(H, n, x, out) {
  const i = Math.min(n - 2, Math.max(0, Math.floor(x)));
  const s = Math.min(1, Math.max(0, x - i));
  const i0 = Math.max(0, i - 1);
  const i3 = Math.min(n - 1, i + 2);

  for (let c = 0; c < 2; c += 1) {
    const p0 = H[2 * i0 + c];
    const p1 = H[2 * i + c];
    const p2 = H[2 * i + 2 + c];
    const p3 = H[2 * i3 + c];
    out[c] = p1 + 0.5 * s * (p2 - p0 + s * (2 * p0 - 5 * p1 + 4 * p2 - p3 + s * (3 * (p1 - p2) + p3 - p0)));
  }

  return out;
}

/* The wave seen from (theta, phi): h_+ and h_x on the sample grid, and
   interpolated at any u. The reference time uPeak is the peak of the total
   news sum_lm |dh_lm/du|^2, which does not depend on the observer. */
export function inclWave(orbit, theta, phi) {
  const { modes, u0, du, n } = orbit;
  const w = MODES.map(([l, m]) => {
    const y = sYlm(-2, l, m, theta);
    return [y * Math.cos(m * phi), y * Math.sin(m * phi)];
  });
  const hc = new Float64Array(2 * n); // h_+ - i h_x, interleaved

  modes.forEach((H, q) => {
    const [wr, wi] = w[q];
    if (wr === 0 && wi === 0) return;
    for (let s = 0; s < n; s += 1) {
      hc[2 * s] += H[2 * s] * wr - H[2 * s + 1] * wi;
      hc[2 * s + 1] += H[2 * s] * wi + H[2 * s + 1] * wr;
    }
  });

  const plus = new Float64Array(n);
  const cross = new Float64Array(n);
  let peak = 0;

  for (let s = 0; s < n; s += 1) {
    plus[s] = hc[2 * s];
    cross[s] = -hc[2 * s + 1];
    peak = Math.max(peak, Math.hypot(plus[s], cross[s]));
  }

  const news = (s) => {
    let acc = 0;
    for (const H of modes) {
      const dr = H[2 * s + 2] - H[2 * s - 2];
      const di = H[2 * s + 3] - H[2 * s - 1];
      acc += dr * dr + di * di;
    }
    return acc;
  };
  let iPeak = 1;
  for (let s = 1; s < n - 1; s += 1) {
    if (Math.abs(u0 + s * du) < 150 && news(s) > news(iPeak)) iPeak = s;
  }
  const y0 = news(iPeak - 1);
  const y1 = news(iPeak);
  const y2 = news(iPeak + 1);
  const den = y0 - 2 * y1 + y2;
  const shift = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
  const tmp = new Float64Array(2);

  return {
    // complex h_+ - i h_x at u
    atC(u, out) {
      return interp(hc, n, (u - u0) / du, out);
    },
    at(u) {
      return interp(hc, n, (u - u0) / du, tmp)[0];
    },
    atCross(u) {
      return -interp(hc, n, (u - u0) / du, tmp)[1];
    },
    uPeak: u0 + (iPeak + shift) * du,
    peak,
    samples: plus,
    cross,
    u0,
    du,
    n,
  };
}

/* Strain on the equatorial plane, h_+(u, pi/2, phi) = sum_{m=0..4} Re[G_m(u) e^{i m phi}],
   with G_0 = F_0, G_m = F_m + conj(F_{-m}) and F_m = sum_l h_lm _{-2}Y_lm(pi/2).
   Returns G as interleaved complex series, G[m] = Float64Array(2n). */
export function equatorialCoeffs(orbit) {
  const { modes, n } = orbit;
  const F = new Map();

  MODES.forEach(([l, m], q) => {
    const y = sYlm(-2, l, m, Math.PI / 2);
    if (!F.has(m)) F.set(m, new Float64Array(2 * n));
    const f = F.get(m);
    const H = modes[q];
    for (let s = 0; s < 2 * n; s += 1) f[s] += y * H[s];
  });

  const G = [F.get(0)];
  for (let m = 1; m <= 4; m += 1) {
    const g = new Float64Array(2 * n);
    const fp = F.get(m);
    const fm = F.get(-m);
    for (let s = 0; s < n; s += 1) {
      g[2 * s] = fp[2 * s] + fm[2 * s];
      g[2 * s + 1] = fp[2 * s + 1] - fm[2 * s + 1];
    }
    G.push(g);
  }

  return G;
}

export { interp as interpComplex };
