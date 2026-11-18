/* Regge–Wheeler simulator: 2D panels.
   - Excitation map: |C_n| of a quasinormal mode over the (nu, sigma) plane,
     from the asymptotic formula of "Shaping black hole resonances".
     Clicking picks a pulse.
   - Spectrum: Fourier transform of the initial pulse and of the scattered
     signal recorded by the observer. */

import { R_PEAK, mode, excitation, sourceSpectrum } from "./rw-qnm.js";

const INK = "#0b1220";
const AXIS = "#7a8492";
const GRID = "rgba(11,18,32,0.07)";
const FONT = '10px "IBM Plex Mono", monospace';
const PULSE = "#d8611c";
const QNM = "#2a78d6";

// Sequential blue ramp, light (small) to dark (large).
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const SUBSCRIPT = ["₀", "₁", "₂", "₃"];

export const powerOfTen = (e) =>
  `10${String(e).split("").map((c) => SUPERSCRIPT[c]).join("")}`;

// 3.2 × 10⁻⁴ style, plain decimals between 0.01 and 1000.
export function formatValue(v) {
  if (!Number.isFinite(v) || v === 0) {
    return "0";
  }

  const a = Math.abs(v);

  if (a >= 0.01 && a < 1000) {
    return String(+v.toPrecision(3));
  }

  const e = Math.floor(Math.log10(a));
  const m = v / 10 ** e;
  return `${m.toFixed(1)} × ${powerOfTen(e)}`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const LUT = (() => {
  const stops = RAMP.map(hexToRgb);
  const lut = new Uint8ClampedArray(256 * 3);

  for (let k = 0; k < 256; k += 1) {
    const x = (k / 255) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const u = x - i;

    for (let c = 0; c < 3; c += 1) {
      lut[3 * k + c] = stops[i][c] + u * (stops[i + 1][c] - stops[i][c]);
    }
  }

  return lut;
})();

// Canvas sized to its CSS box at device resolution.
function fitCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

function dashedVLine(ctx, x, top, bottom, color, width, dash) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, bottom);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Excitation map
// ---------------------------------------------------------------------------

export function createExcitationMap(el, { onPick }) {
  const canvas = el.querySelector("canvas");
  const readout = el.querySelector("[data-readout]");
  const ctx = canvas.getContext("2d");

  const NU = [0, 1];
  const SIGMA = [1, 10];
  const NX = 201;
  const NY = 181;
  const DECADES = 5;
  const PAD = { l: 40, r: 64, t: 22, b: 32 };

  const image = document.createElement("canvas");
  image.width = NX;
  image.height = NY;
  const ictx = image.getContext("2d");

  const state = { l: 2, n: 0, sigma: 6, nu: 0.45 };
  let hi = 0;
  let lo = -DECADES;
  let size = { w: 0, h: 0 };
  let hover = null;
  let computedFor = "";

  const plot = () => ({
    x0: PAD.l,
    x1: size.w - PAD.r,
    y0: PAD.t,
    y1: size.h - PAD.b,
  });

  const xOf = (nu, p) => p.x0 + ((nu - NU[0]) / (NU[1] - NU[0])) * (p.x1 - p.x0);
  const yOf = (sigma, p) => p.y1 - ((sigma - SIGMA[0]) / (SIGMA[1] - SIGMA[0])) * (p.y1 - p.y0);

  function compute() {
    const key = `${state.l}:${state.n}`;

    if (key === computedFor) {
      return;
    }

    computedFor = key;
    const field = new Float32Array(NX * NY);
    hi = -Infinity;

    for (let j = 0; j < NY; j += 1) {
      // Row 0 is the top of the image (largest sigma).
      const sigma = SIGMA[1] - (j / (NY - 1)) * (SIGMA[1] - SIGMA[0]);

      for (let i = 0; i < NX; i += 1) {
        const nu = NU[0] + (i / (NX - 1)) * (NU[1] - NU[0]);
        const v = Math.log10(Math.max(excitation(state.l, state.n, sigma, nu), 1e-300));
        field[j * NX + i] = v;

        if (v > hi) {
          hi = v;
        }
      }
    }

    lo = hi - DECADES;
    const data = ictx.createImageData(NX, NY);

    for (let k = 0; k < NX * NY; k += 1) {
      const u = Math.min(1, Math.max(0, (field[k] - lo) / (hi - lo)));
      const c = Math.round(u * 255);
      data.data[4 * k] = LUT[3 * c];
      data.data[4 * k + 1] = LUT[3 * c + 1];
      data.data[4 * k + 2] = LUT[3 * c + 2];
      data.data[4 * k + 3] = 255;
    }

    ictx.putImageData(data, 0, 0);
  }

  function draw() {
    if (size.w === 0) {
      return;
    }

    compute();
    const p = plot();
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;

    // Field
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);

    // Axes
    ctx.fillStyle = AXIS;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let nu = 0; nu <= 1.0001; nu += 0.2) {
      const x = xOf(nu, p);
      ctx.strokeStyle = "rgba(11,18,32,0.25)";
      ctx.beginPath();
      ctx.moveTo(x, p.y1);
      ctx.lineTo(x, p.y1 + 4);
      ctx.stroke();
      ctx.fillText(nu.toFixed(1), x, p.y1 + 6);
    }

    ctx.textAlign = "right";
    ctx.fillText("ν M", p.x1, p.y1 + 19);

    ctx.textBaseline = "middle";

    for (let s = 2; s <= 10; s += 2) {
      const y = yOf(s, p);
      ctx.strokeStyle = "rgba(11,18,32,0.25)";
      ctx.beginPath();
      ctx.moveTo(p.x0 - 4, y);
      ctx.lineTo(p.x0, y);
      ctx.stroke();
      ctx.fillText(String(s), p.x0 - 7, y);
    }

    ctx.save();
    ctx.translate(11, (p.y0 + p.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("σ / M", 0, 0);
    ctx.restore();

    ctx.strokeStyle = "rgba(11,18,32,0.25)";
    ctx.strokeRect(p.x0 + 0.5, p.y0 + 0.5, p.x1 - p.x0 - 1, p.y1 - p.y0 - 1);

    // Re omega_n: the carrier frequency that resonates with the mode.
    const { w } = mode(state.l, state.n);

    if (w[0] <= NU[1]) {
      const x = xOf(w[0], p);
      dashedVLine(ctx, x, p.y0, p.y1, "rgba(255,255,255,0.9)", 3, []);
      dashedVLine(ctx, x, p.y0, p.y1, INK, 1.2, [4, 4]);
      ctx.fillStyle = INK;
      ctx.textAlign = x > p.x1 - 60 ? "right" : "left";
      ctx.textBaseline = "top";
      const label = `Re ω${SUBSCRIPT[state.n]}`;
      const tx = x > p.x1 - 60 ? x - 5 : x + 5;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(ctx.textAlign === "right" ? tx - tw - 3 : tx - 3, p.y0 + 4, tw + 6, 14);
      ctx.fillStyle = INK;
      ctx.fillText(label, tx, p.y0 + 6);
    }

    // Hover crosshair
    if (hover) {
      const x = xOf(hover.nu, p);
      const y = yOf(hover.sigma, p);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, p.y0);
      ctx.lineTo(x, p.y1);
      ctx.moveTo(p.x0, y);
      ctx.lineTo(p.x1, y);
      ctx.stroke();
      ctx.restore();
    }

    // Current pulse
    {
      const x = xOf(state.nu, p);
      const y = yOf(state.sigma, p);
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = PULSE;
      ctx.fill();
    }

    // Colour bar
    const bx = p.x1 + 14;
    const bw = 10;
    const grad = ctx.createLinearGradient(0, p.y1, 0, p.y0);
    RAMP.forEach((c, i) => grad.addColorStop(i / (RAMP.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillRect(bx, p.y0, bw, p.y1 - p.y0);
    ctx.strokeStyle = "rgba(11,18,32,0.15)";
    ctx.strokeRect(bx + 0.5, p.y0 + 0.5, bw - 1, p.y1 - p.y0 - 1);

    ctx.fillStyle = AXIS;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let e = Math.floor(hi); e >= Math.ceil(lo); e -= 1) {
      const y = p.y1 - ((e - lo) / (hi - lo)) * (p.y1 - p.y0);
      ctx.strokeStyle = "rgba(11,18,32,0.35)";
      ctx.beginPath();
      ctx.moveTo(bx + bw, y);
      ctx.lineTo(bx + bw + 3, y);
      ctx.stroke();
      ctx.fillText(powerOfTen(e), bx + bw + 6, y);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(`|C${SUBSCRIPT[state.n]}|`, bx - 2, p.y0 - 5);

    showReadout();
  }

  function showReadout() {
    const s = hover || state;
    const v = excitation(state.l, state.n, s.sigma, s.nu);
    const text =
      `σ = ${s.sigma.toFixed(1)} M · ν = ${s.nu.toFixed(2)} / M · ` +
      `|C${SUBSCRIPT[state.n]}| = ${formatValue(v)}`;
    readout.textContent = hover ? `${text} · click to simulate` : `Current pulse: ${text}`;
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    const p = plot();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) {
      return null;
    }

    const nu = NU[0] + ((x - p.x0) / (p.x1 - p.x0)) * (NU[1] - NU[0]);
    const sigma = SIGMA[0] + ((p.y1 - y) / (p.y1 - p.y0)) * (SIGMA[1] - SIGMA[0]);

    // Snap to the steps of the sliders.
    return {
      nu: Math.min(NU[1], Math.max(NU[0], Math.round(nu * 100) / 100)),
      sigma: Math.min(SIGMA[1], Math.max(SIGMA[0], Math.round(sigma * 10) / 10)),
    };
  }

  canvas.addEventListener("pointermove", (event) => {
    hover = pick(event);
    canvas.style.cursor = hover ? "crosshair" : "default";
    draw();
  });

  canvas.addEventListener("pointerleave", () => {
    hover = null;
    draw();
  });

  canvas.addEventListener("click", (event) => {
    const at = pick(event);

    if (at) {
      onPick(at);
    }
  });

  el.querySelectorAll("[data-map-n]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.n = Number(btn.dataset.mapN);
      el.querySelectorAll("[data-map-n]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn))
      );
      draw();
    });
  });

  new ResizeObserver(() => {
    size = fitCanvas(canvas, ctx);
    draw();
  }).observe(canvas);

  return {
    set(values) {
      Object.assign(state, values);
      draw();
    },
  };
}

// ---------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------

export function createSpectrum(el) {
  const canvas = el.querySelector("canvas");
  const readout = el.querySelector("[data-readout]");
  const ctx = canvas.getContext("2d");

  const W_MAX = 1.5;
  const NW = 301;
  const DECADES = 5;
  const DECIMATE = 8;
  const PAD = { l: 46, r: 12, t: 10, b: 32 };

  const omegas = Float64Array.from({ length: NW }, (_, j) => (j / (NW - 1)) * W_MAX);
  const state = { l: 2, sigma: 6, nu: 0.45 };
  let source = new Float64Array(NW);
  let observed = null; // { values, tCut, overlap }
  let pendingNote = "";
  let size = { w: 0, h: 0 };
  let hover = null;

  const plot = () => ({ x0: PAD.l, x1: size.w - PAD.r, y0: PAD.t, y1: size.h - PAD.b });
  const xOf = (w, p) => p.x0 + (w / W_MAX) * (p.x1 - p.x0);

  function computeSource() {
    for (let j = 0; j < NW; j += 1) {
      source[j] = sourceSpectrum(omegas[j], state.sigma, state.nu);
    }
  }

  /* |integral of Psi(t) e^{i omega t} dt| over the part of the record that
     comes after the incident pulse has passed the observer. */
  function computeObserved(sim) {
    const { sigma, s0, sObs } = sim.request;
    // The incident Gaussian has decayed to e^{-12.5} ~ 4e-6 after 5 sigma.
    const tCut = Math.max(0, s0 - sObs + 5 * sigma);
    const tEnd = sim.nSteps * sim.dt;
    // The reflected pulse reaches the observer at about
    // s0 + sObs - 2 r*_peak - 4 sigma. The window opens smoothly before that,
    // as slowly as there is room for: a fast rise on top of the weak signal
    // backscattered by the tail of the potential leaks into high frequencies.
    const reflectedFront = s0 + sObs - 2 * R_PEAK - 4 * sigma;
    const rise = Math.min(40, Math.max(8, reflectedFront - tCut));
    const fall = 40;
    const step = DECIMATE * sim.dt;
    const k0 = Math.ceil(tCut / sim.dt);

    const times = [];
    const vals = [];

    for (let k = k0; k <= sim.nSteps; k += DECIMATE) {
      const t = k * sim.dt;
      let win = 1;

      if (t < tCut + rise) {
        win = 0.5 - 0.5 * Math.cos((Math.PI * (t - tCut)) / rise);
      }

      if (t > tEnd - fall) {
        win *= 0.5 + 0.5 * Math.cos((Math.PI * (t - (tEnd - fall))) / fall);
      }

      times.push(t);
      vals.push(sim.obs[k] * win);
    }

    const values = new Float64Array(NW);

    for (let j = 0; j < NW; j += 1) {
      const w = omegas[j];
      // Rotating phasor e^{i w t_k}
      const cr = Math.cos(w * step);
      const ci = Math.sin(w * step);
      let pr = Math.cos(w * (times[0] ?? 0));
      let pi = Math.sin(w * (times[0] ?? 0));
      let sr = 0;
      let si = 0;

      for (let k = 0; k < vals.length; k += 1) {
        sr += vals[k] * pr;
        si += vals[k] * pi;
        const nr = pr * cr - pi * ci;
        pi = pr * ci + pi * cr;
        pr = nr;
      }

      values[j] = Math.hypot(sr, si) * step;
    }

    // If the window is not fully open when the reflected pulse arrives, the
    // incident and reflected pulses overlap at the observer.
    return { values, tCut, overlap: reflectedFront < tCut + rise, l: sim.l };
  }

  function yRange() {
    let m = 0;

    for (let j = 0; j < NW; j += 1) {
      m = Math.max(m, source[j], observed ? observed.values[j] : 0);
    }

    const hiE = Math.ceil(Math.log10(Math.max(m, 1e-12) * 1.15));
    return [hiE - DECADES, hiE];
  }

  function draw() {
    if (size.w === 0) {
      return;
    }

    const p = plot();
    const [loE, hiE] = yRange();
    const yOf = (v) => {
      const e = Math.log10(Math.max(v, 1e-300));
      const u = (Math.min(hiE, Math.max(loE - 0.2, e)) - loE) / (hiE - loE);
      return p.y1 - u * (p.y1 - p.y0);
    };

    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;

    // Grid and axes
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let e = hiE; e >= loE; e -= 1) {
      const y = yOf(10 ** e);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(p.x0, y);
      ctx.lineTo(p.x1, y);
      ctx.stroke();
      ctx.fillStyle = AXIS;
      ctx.fillText(powerOfTen(e), p.x0 - 6, y);
    }

    ctx.strokeStyle = "rgba(11,18,32,0.22)";
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y1 + 0.5);
    ctx.lineTo(p.x1, p.y1 + 0.5);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let w = 0; w <= W_MAX + 1e-9; w += 0.25) {
      const x = xOf(w, p);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(x, p.y0);
      ctx.lineTo(x, p.y1);
      ctx.stroke();

      if (x < p.x1 - 30) {
        ctx.fillStyle = AXIS;
        ctx.fillText(String(w), x, p.y1 + 6);
      }
    }

    ctx.textAlign = "right";
    ctx.fillText("ω M", p.x1, p.y1 + 6);

    // Quasinormal frequencies
    for (let n = 3; n >= 0; n -= 1) {
      const x = xOf(mode(state.l, n).w[0], p);
      dashedVLine(ctx, x, p.y0, p.y1, n === 0 ? QNM : "rgba(42,120,214,0.35)", n === 0 ? 1.4 : 1, [4, 4]);
    }

    {
      const x = xOf(mode(state.l, 0).w[0], p);
      ctx.fillStyle = QNM;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("Re ω₀", x + 5, p.y0 + 2);
    }

    // Curves
    const curve = (vals, color, width) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x0, p.y0 - 1, p.x1 - p.x0, p.y1 - p.y0 + 2);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();

      for (let j = 0; j < NW; j += 1) {
        const x = xOf(omegas[j], p);
        const y = yOf(vals[j]);

        if (j === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
      ctx.restore();
    };

    curve(source, PULSE, 2);

    if (observed) {
      curve(observed.values, INK, 1.6);
    }

    // Hover
    if (hover !== null) {
      const x = xOf(omegas[hover], p);
      ctx.strokeStyle = "rgba(11,18,32,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, p.y0);
      ctx.lineTo(x, p.y1);
      ctx.stroke();

      const dot = (v, color) => {
        ctx.beginPath();
        ctx.arc(x, yOf(v), 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, yOf(v), 3, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      };

      dot(source[hover], PULSE);

      if (observed) {
        dot(observed.values[hover], INK);
      }
    }

    showReadout();
  }

  function showReadout() {
    if (hover !== null) {
      const j = hover;
      let text = `ω = ${omegas[j].toFixed(3)} / M · pulse ${formatValue(source[j])}`;

      if (observed) {
        text += ` · scattered ${formatValue(observed.values[j])}`;

        if (source[j] > 1e-6 * Math.max(...source)) {
          text += ` · ratio ${formatValue(observed.values[j] / source[j])}`;
        }
      }

      readout.textContent = text;
      return;
    }

    if (!observed) {
      readout.textContent = pendingNote || "Waiting for the solver…";
      return;
    }

    readout.textContent = observed.overlap
      ? `Signal after t = ${observed.tCut.toFixed(0)} M. The observer is too close: the incident and reflected pulses overlap.`
      : `Signal after t = ${observed.tCut.toFixed(0)} M, once the incident pulse has passed. Hover to read values.`;
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const p = plot();
    const x = event.clientX - rect.left;

    if (x < p.x0 || x > p.x1) {
      hover = null;
    } else {
      hover = Math.round(((x - p.x0) / (p.x1 - p.x0)) * (NW - 1));
    }

    draw();
  });

  canvas.addEventListener("pointerleave", () => {
    hover = null;
    draw();
  });

  new ResizeObserver(() => {
    size = fitCanvas(canvas, ctx);
    draw();
  }).observe(canvas);

  computeSource();

  return {
    setPulse(values) {
      Object.assign(state, values);
      computeSource();
      draw();
    },
    setSignal(sim) {
      observed = sim && sim.done ? computeObserved(sim) : null;
      pendingNote = sim && !sim.done ? "Solving… the scattered spectrum appears when the run ends." : "";
      draw();
    },
    clearSignal(note) {
      observed = null;
      pendingNote = note;
      draw();
    },
  };
}
