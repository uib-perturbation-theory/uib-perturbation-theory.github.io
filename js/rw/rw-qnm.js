/* Quasinormal modes of a Schwarzschild black hole and the asymptotic
   excitation formula of "Shaping black hole resonances" I and II.
   Units G = c = M = 1.

   Frequencies and excitation factors B_n: Berti & Cardoso,
   Phys. Rev. D 74, 104020 (2006), a = 0 row of their tables
   (converted from 2M = 1 to M = 1 units for the frequencies; B_n is
   dimensionless). */

// r* of the peak of the potential (r = 3M).
export const R_PEAK = 3 + 2 * Math.log(0.5);

// [Re omega, Im omega, Re B, Im B] for n = 0..3
const TABLE = {
  2: [
    [0.373671685, -0.088962315, 0.12690241, 0.020315172],
    [0.346710995, -0.273914875, 0.047682594, -0.2237546],
    [0.301053455, -0.478276985, -0.19028432, 0.01574857],
    [0.25150496, -0.7051482, 0.08086762, 0.079612596],
  ],
  3: [
    [0.5994433, -0.09270305, -0.093889764, -0.049192751],
    [0.5826438, -0.281298115, -0.15113473, 0.26974966],
    [0.5516849, -0.47909275, 0.4150292, 0.14103805],
    [0.5119619, -0.6903371, -0.04340279, -0.41274747],
  ],
  4: [
    [0.8091784, -0.09416396, 0.065347947, 0.065239079],
    [0.79663155, -0.28433435, 0.26148793, -0.25152402],
    [0.77270955, -0.479908175, -0.54921679, -0.43532772],
    [0.73983675, -0.6839243, -0.31692114, 0.83791083],
  ],
};

export const N_MODES = 4;

export function mode(l, n) {
  const [wr, wi, br, bi] = TABLE[l][n];
  return { w: [wr, wi], B: [br, bi] };
}

// ---------- complex helpers on [re, im] ----------

const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const cexp = (z) => {
  const m = Math.exp(z[0]);
  return [m * Math.cos(z[1]), m * Math.sin(z[1])];
};
const abs = (z) => Math.hypot(z[0], z[1]);

// exp(-sigma^2 (w - nu)^2 / 2) for complex w
function gauss(w, nu, sigma) {
  const a = w[0] - nu;
  const b = w[1];
  const s2 = 0.5 * sigma * sigma;
  return cexp([-s2 * (a * a - b * b), -s2 * 2 * a * b]);
}

/* Overlap of the purely ingoing Gaussian pulse with mode n, without the
   factor e^{i w_n r0} (as in the papers):
     T_n = -i sqrt(8 pi) sigma w_n e^{-sigma^2 (w_n^2 + nu^2)/2} cosh(sigma^2 w_n nu)
         = -i sqrt(2 pi) sigma w_n [e^{-sigma^2 (w_n - nu)^2/2} + e^{-sigma^2 (w_n + nu)^2/2}] */
export function overlap(w, sigma, nu) {
  const bracket = add(gauss(w, nu, sigma), gauss(w, -nu, sigma));
  const pref = mul([0, -Math.sqrt(2 * Math.PI) * sigma], w);
  return mul(pref, bracket);
}

// |C_n| = |B_n T_n|
export function excitation(l, n, sigma, nu) {
  const { w, B } = mode(l, n);
  return abs(mul(B, overlap(w, sigma, nu)));
}

/* Asymptotic QNM part of the signal at the observer,
     Psi_QNM(t) = sum_n 2 Re[ B_n T_n e^{-i w_n (t - r*_obs - r0)} ],
   the factor 2 accounting for the mirror modes -w_n^*. */
export function qnmSignal(l, nMax, sigma, nu, s0, sObs, times) {
  const out = new Float64Array(times.length);

  for (let n = 0; n <= nMax; n += 1) {
    const { w, B } = mode(l, n);
    const K = mul([2 * B[0], 2 * B[1]], overlap(w, sigma, nu));

    for (let k = 0; k < times.length; k += 1) {
      const tau = times[k] - sObs - s0;
      // e^{-i w tau} = e^{Im(w) tau} (cos(Re w tau) - i sin(Re w tau))
      const m = Math.exp(w[1] * tau);
      const er = m * Math.cos(w[0] * tau);
      const ei = -m * Math.sin(w[0] * tau);
      out[k] += K[0] * er - K[1] * ei;
    }
  }

  return out;
}

// |Psi~(omega)| of the initial Gaussian for real omega (A = 1).
export function sourceSpectrum(omega, sigma, nu) {
  const s2 = 0.5 * sigma * sigma;
  return (
    Math.sqrt(2 * Math.PI) *
    sigma *
    0.5 *
    (Math.exp(-s2 * (omega - nu) ** 2) + Math.exp(-s2 * (omega + nu) ** 2))
  );
}
