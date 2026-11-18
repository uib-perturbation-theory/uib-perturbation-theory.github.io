/* GSN waveforms of the on-axis plunge and the quasinormal-mode fit.

   sn-gsn.json holds, for a = 0, 0.1, ..., 0.9:
     D[k]    Psi(u) for u = u0 + j du (float32, base64), l = 2, m = 0, s = -2,
     absX[k] |X(omega)| for omega = w0 + j dw (float32, base64).
   Psi(u) = (1/pi) Re int_0^inf X(omega) e^{-i omega u} d omega. */

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
    uMin: u0,
    uMax: u0 + (n - 1) * du,
  };
}

/* Least-squares fit of the signal after the peak with
     Psi(u) ~ sum_n 2 Re[C_n e^{-i w_n tau}] + sum_k b_k e^{-g_k tau},
   tau = u - uPeak, on the samples with tauA <= tau <= tauB. The quasinormal
   frequencies w_n are fixed (Kerr values); each mode contributes
   e^{Im w_n tau} [c_n cos(Re w_n tau) + s_n sin(Re w_n tau)]. The real
   exponentials with fixed rates g_k stand for the tail: the branch-cut
   integral (1/pi) int Im X(-i g) e^{-g u} dg is itself a superposition of
   such exponentials. Householder QR keeps the fit stable. Returns functions
   of tau: the tail plus the first modes of the fit, and the tail alone. */
export function fitRingdown(data, k, wave, omegas, rates, tauA, tauB) {
  const D = data.D[k];
  const { u0, du, n } = data;
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
