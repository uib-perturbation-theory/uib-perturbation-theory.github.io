/* Waveforms of the two trajectories and the quasinormal-mode fit.

   sn-gsn.json, the on-axis infall, holds for a = 0, 0.1, ..., 0.9:
     D[k]    Psi(u) for u = u0 + j du (float32, base64), l = 2, m = 0, s = -2,
     absX[k] |X(omega)| for omega = w0 + j dw (float32, base64).
   Psi(u) = (1/pi) Re int_0^inf X(omega) e^{-i omega u} d omega.

   sn-plunge.json, the equatorial plunge from the ISCO, holds for the same
   spins:
     H[k]    r h_22(u) / mu, interleaved real and imaginary parts, for
             u = u0 + j du,
     absH[k] |h_22(omega)|, the modulus of its Fourier transform, for
             omega = w0 + j dw. */

function decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);

  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }

  return new Float32Array(bytes.buffer);
}

export async function loadWaveforms(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`could not load ${url} (${res.status})`);
  }

  const j = await res.json();

  return {
    spins: j.spins,
    u0: j.u0,
    du: j.du,
    n: j.n,
    D: j.D.map(decode),
    w0: j.w0,
    dw: j.dw,
    nw: j.nw,
    absX: j.absX.map(decode),
  };
}

/* Waveform of one spin: cubic (Catmull-Rom) interpolation in u, the time and
   size of the peak of |Psi|. */
export function waveform(data, k) {
  const D = data.D[k];
  const { u0, du, n } = data;
  let iPeak = 0;

  for (let i = 1; i < n; i += 1) {
    if (Math.abs(D[i]) > Math.abs(D[iPeak])) {
      iPeak = i;
    }
  }

  // Refine the peak with a parabola through the three samples around it.
  const y0 = D[iPeak - 1];
  const y1 = D[iPeak];
  const y2 = D[iPeak + 1];
  const den = y0 - 2 * y1 + y2;
  const shift = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;

  function at(u) {
    const x = (u - u0) / du;

    if (x <= 0) {
      return D[0];
    }

    if (x >= n - 1) {
      return D[n - 1];
    }

    const i = Math.floor(x);
    const s = x - i;
    const p0 = D[Math.max(0, i - 1)];
    const p1 = D[i];
    const p2 = D[i + 1];
    const p3 = D[Math.min(n - 1, i + 2)];

    return (
      p1 +
      0.5 *
        s *
        (p2 - p0 + s * (2 * p0 - 5 * p1 + 4 * p2 - p3 + s * (3 * (p1 - p2) + p3 - p0)))
    );
  }

  return {
    at,
    uPeak: u0 + (iPeak + shift) * du,
    peak: Math.abs(y1 - 0.25 * (y0 - y2) * shift),
    samples: D,
    u0,
    du,
    n,
  };
}

export async function loadPlunge(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`could not load ${url} (${res.status})`);
  }

  const j = await res.json();

  return {
    spins: j.spins,
    u0: j.u0,
    du: j.du,
    n: j.n,
    H: j.H.map(decode),
    w0: j.w0,
    dw: j.dw,
    nw: j.nw,
    absH: j.absH.map(decode),
    tOn: j.tOn,
  };
}

// h_+ on the equator: h = h_22 Y_22 + h_2,-2 Y_2,-2 with h_2,-2 = conj(h_22)
// and -2Y_2,+-2(pi/2, phi) = sqrt(5 / 64 pi) e^{+-2 i phi}.
export const H_PLUS = 2 * Math.sqrt(5 / (64 * Math.PI));

/* Plunge waveform of one spin. atC(u, out) writes r h_22 / mu (real,
   imaginary) into out; at(u) is r h_+ / mu at the azimuth phiObs of the
   observer. The reference time uPeak is the peak of |dh_22/du|: for fast
   spins |h_22| itself barely rises above its value on the ISCO. */
export function plungeWave(data, k, phiObs) {
  const H = data.H[k];
  const { u0, du, n } = data;
  const c2 = Math.cos(2 * phiObs);
  const s2 = Math.sin(2 * phiObs);

  function atC(u, out) {
    const x = Math.min(n - 1, Math.max(0, (u - u0) / du));
    const i = Math.min(n - 2, Math.floor(x));
    const s = x - i;
    const i0 = Math.max(0, i - 1);
    const i3 = Math.min(n - 1, i + 2);

    for (let c = 0; c < 2; c += 1) {
      const p0 = H[2 * i0 + c];
      const p1 = H[2 * i + c];
      const p2 = H[2 * i + 2 + c];
      const p3 = H[2 * i3 + c];
      out[c] =
        p1 +
        0.5 * s * (p2 - p0 + s * (2 * p0 - 5 * p1 + 4 * p2 - p3 + s * (3 * (p1 - p2) + p3 - p0)));
    }

    return out;
  }

  let ampPeak = 0;
  const samples = new Float64Array(n);

  for (let i = 0; i < n; i += 1) {
    const re = H[2 * i];
    const im = H[2 * i + 1];
    ampPeak = Math.max(ampPeak, Math.hypot(re, im));
    samples[i] = H_PLUS * (re * c2 - im * s2);
  }

  // Peak of |dh/du| within 150 M of the light-ring crossing.
  const news = (i) => Math.hypot(H[2 * i + 2] - H[2 * i - 2], H[2 * i + 3] - H[2 * i - 1]);
  let iPeak = 1;

  for (let i = 1; i < n - 1; i += 1) {
    const u = u0 + i * du;

    if (Math.abs(u) < 150 && (iPeak === 1 || news(i) > news(iPeak))) {
      iPeak = i;
    }
  }

  const y0 = news(iPeak - 1);
  const y1 = news(iPeak);
  const y2 = news(iPeak + 1);
  const den = y0 - 2 * y1 + y2;
  const shift = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
  const tmp = new Float64Array(2);

  return {
    atC,
    at(u) {
      atC(u, tmp);
      return H_PLUS * (tmp[0] * c2 - tmp[1] * s2);
    },
    uPeak: u0 + (iPeak + shift) * du,
    ampPeak,
    peak: H_PLUS * ampPeak,
    samples,
    u0,
    du,
    n,
  };
}

/* Least-squares fit of the signal of a waveform (see waveform and
   plungeWave) after its peak with
     s(u) ~ sum_n 2 Re[C_n e^{-i w_n tau}] + sum_k b_k e^{-g_k tau},
   tau = u - uPeak, on the samples with tauA <= tau <= tauB. The quasinormal
   frequencies w_n are fixed (Kerr values); each mode contributes
   e^{Im w_n tau} [c_n cos(Re w_n tau) + s_n sin(Re w_n tau)]. The real
   exponentials with fixed rates g_k stand for the tail: the branch-cut
   integral (1/pi) int Im X(-i g) e^{-g u} dg is itself a superposition of
   such exponentials. Householder QR keeps the fit stable. Returns functions
   of tau: the tail plus the first modes of the fit, and the tail alone. */
export function fitRingdown(wave, omegas, rates, tauA, tauB) {
  const { samples: D, u0, du, n } = wave;
  const iA = Math.max(0, Math.ceil((wave.uPeak + tauA - u0) / du));
  const iB = Math.min(n - 1, Math.floor((wave.uPeak + tauB - u0) / du));
  const rows = iB - iA + 1;
  const nq = 2 * omegas.length;
  const cols = nq + rates.length;

  if (rows <= cols) {
    return null;
  }

  const basis = (tau, out) => {
    omegas.forEach(([wr, wi], m) => {
      const e = Math.exp(wi * tau);
      out[2 * m] = e * Math.cos(wr * tau);
      out[2 * m + 1] = e * Math.sin(wr * tau);
    });
    rates.forEach((g, j) => {
      out[nq + j] = Math.exp(-g * tau);
    });
    return out;
  };

  // A (rows x cols, column-major) and b
  const A = Array.from({ length: cols }, () => new Float64Array(rows));
  const b = new Float64Array(rows);
  const row = new Float64Array(cols);

  for (let r = 0; r < rows; r += 1) {
    const i = iA + r;
    basis(u0 + i * du - wave.uPeak, row);

    for (let c = 0; c < cols; c += 1) {
      A[c][r] = row[c];
    }

    b[r] = D[i];
  }

  // Householder QR, applied to b on the fly.
  const R = Array.from({ length: cols }, () => new Float64Array(cols));

  for (let c = 0; c < cols; c += 1) {
    const col = A[c];
    let norm = 0;

    for (let r = c; r < rows; r += 1) {
      norm += col[r] * col[r];
    }

    norm = Math.sqrt(norm);
    const alpha = col[c] > 0 ? -norm : norm;
    const v = new Float64Array(rows);
    v[c] = col[c] - alpha;

    for (let r = c + 1; r < rows; r += 1) {
      v[r] = col[r];
    }

    let vv = 0;

    for (let r = c; r < rows; r += 1) {
      vv += v[r] * v[r];
    }

    const apply = (x) => {
      if (vv === 0) {
        return;
      }

      let dot = 0;

      for (let r = c; r < rows; r += 1) {
        dot += v[r] * x[r];
      }

      const f = (2 * dot) / vv;

      for (let r = c; r < rows; r += 1) {
        x[r] -= f * v[r];
      }
    };

    for (let c2 = c; c2 < cols; c2 += 1) {
      apply(A[c2]);
    }

    apply(b);

    for (let c2 = c; c2 < cols; c2 += 1) {
      R[c][c2] = A[c2][c];
    }
  }

  // Back substitution R x = Q^T b
  const coef = new Float64Array(cols);

  for (let c = cols - 1; c >= 0; c -= 1) {
    let s = b[c];

    for (let c2 = c + 1; c2 < cols; c2 += 1) {
      s -= R[c][c2] * coef[c2];
    }

    coef[c] = s / R[c][c];
  }

  const part = (tau, c0, c1) => {
    basis(tau, row);
    let s = 0;

    for (let c = c0; c < c1; c += 1) {
      s += coef[c] * row[c];
    }

    return s;
  };

  return {
    // tail plus the modes n = 0..nMax
    upTo: (nMax, tau) => part(tau, 0, 2 * (nMax + 1)) + part(tau, nq, cols),
    tail: (tau) => part(tau, nq, cols),
  };
}
