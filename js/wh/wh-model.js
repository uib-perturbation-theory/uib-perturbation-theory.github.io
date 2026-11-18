/* Thin-shell wormhole: geometry and potential, shared by the page and the
   solver (wh-worker.js).

   Two Schwarzschild exteriors of mass M are cut at r = a = 2M(1 + delta) and
   glued along a thin shell. A global coordinate x runs through both sides:
   x > 0 is universe 1, x < 0 universe 2, x = 0 the throat, and
     r(x) = r*^{-1}( r*(a) + |x| ),   r* = r + 2M ln(r/2M - 1),
   so x is the tortoise distance from the throat. A perturbation of spin s
   (0 scalar, 1 electromagnetic, 2 axial gravitational) and multipole l obeys
     psi_tt - psi_xx + V psi = 0,
     V = (1 - 2M/r) [ l(l+1)/r^2 + 2M(1 - s^2)/r^3 ],
   and the shell adds C delta(x) to V: psi is continuous and its slope jumps,
   psi'(0+) - psi'(0-) = C psi(0), with C = (2 f(a)/a) x {+1, 0, -1} for
   s = {0, 1, 2}. Units: G = c = M = 1. */

// Solves w + ln w = L, i.e. w e^w = e^L (principal branch, w > 0), without
// forming e^L.
export function lambertWExp(L) {
  if (L < -30) {
    return Math.exp(L);
  }

  let w = L > 1 ? L - Math.log(L) : Math.exp(L) / (1 + Math.exp(L));

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

export const rStar = (r) => r + 2 * Math.log(r / 2 - 1);

// Areal radius of the peak of the Schwarzschild potential for (s, l).
export function peakRadius(s, l) {
  const L = l * (l + 1);
  const b = 2 * (1 - s * s);

  if (L === 0) {
    return 8 / 3; // s = 0, l = 0: V = 2 f / r^3
  }

  return (-3 * (b - 2 * L) + Math.sqrt(9 * (b - 2 * L) ** 2 + 64 * L * b)) / (4 * L);
}

export const SPIN_NAMES = ["scalar", "electromagnetic", "axial gravitational"];

export function makeWormhole(s, l, delta) {
  const a = 2 * (1 + delta);
  const ra = a + 2 * Math.log(delta); // r*(a), without cancellation
  const L = l * (l + 1);
  const b = 2 * (1 - s * s);
  const twoFoverA = delta / (1 + delta) ** 2; // 2 f(a) / a
  const C = [twoFoverA, 0, -twoFoverA][s];
  const rPeak = peakRadius(s, l);
  // Tortoise distance from the throat to each potential peak; <= 0 means the
  // throat is outside the peak and V has a single maximum at x = 0.
  const d = rStar(rPeak) - ra;

  // W(x) = r/2 - 1, so that f = W / (1 + W) without cancellation near r = 2.
  const W = (x) => lambertWExp((ra + Math.abs(x)) / 2 - 1);
  const r = (x) => 2 * (1 + W(x));

  const V = (x) => {
    const w = W(x);
    const rr = 2 * (1 + w);
    return (w / (1 + w)) * (L / (rr * rr) + b / (rr * rr * rr));
  };

  const vTop = d > 0 ? V(d) : V(0);

  return { s, l, delta, a, ra, L, b, C, rPeak, d, vTop, W, r, V };
}

// "10⁻⁴"-style label for delta = 10^e.
const SUP = { "-": "⁻", ".": "·", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

export function powerLabel(e) {
  const v = +e.toFixed(2);
  return `10${String(v).split("").map((c) => SUP[c] ?? c).join("")}`;
}
