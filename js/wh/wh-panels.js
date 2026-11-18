/* Wormhole simulator: 2D panels.
   - Potential: V(x) through both universes, the shell term at x = 0, the
     cavity between the two peaks, the carrier level nu^2 and the positions
     of the pulse and the observers.
   - Transmission: |T(omega)|^2 from universe 1 to universe 2 (computed in the
     worker), with the energy spectrum of the pulse behind it. */

import { formatValue, powerOfTen } from "../rw/rw-panels.js";

const INK = "#0b1220";
const AXIS = "#7a8492";
const GRID = "rgba(11,18,32,0.07)";
const FONT = '10px "IBM Plex Mono", monospace';
const PULSE = "#d8611c";
const BLUE = "#2a78d6";
const CAVITY = "rgba(42,120,214,0.07)";

function fitCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

function hoverDot(ctx, x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, 2 * Math.PI);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
}

/* Energy spectrum of the ingoing Gaussian, omega^2 |F(omega)|^2, up to a
   constant. */
export function pulseEnergy(w, sigma, nu) {
  const g = Math.exp((-sigma * sigma * (w - nu) ** 2) / 2) + Math.exp((-sigma * sigma * (w + nu) ** 2) / 2);
  return w * w * g * g;
}

// ---------- Potential ----------

export function createPotential(el) {
  const canvas = el.querySelector("canvas");
  const readout = el.querySelector("[data-readout]");
  const ctx = canvas.getContext("2d");
  const PAD = { l: 46, r: 12, t: 20, b: 32 };
  const NX = 601;

  let size = { w: 0, h: 0 };
  let st = null; // { wh, xMax, x0, xObs, nu }
  let xs = null;
  let vs = null;
  let hover = null;

  const plot = () => ({ x0: PAD.l, x1: size.w - PAD.r, y0: PAD.t, y1: size.h - PAD.b });

  function compute() {
    xs = Float64Array.from({ length: NX }, (_, k) => -st.xMax + (2 * st.xMax * k) / (NX - 1));
    vs = Float64Array.from(xs, (x) => st.wh.V(x));
  }

  function draw() {
    if (size.w === 0 || !st) {
      return;
    }

    const p = plot();
    const { wh, xMax } = st;
    const vMax = Math.max(wh.vTop, st.nu * st.nu) * 1.18;
    const X = (x) => p.x0 + ((x + xMax) / (2 * xMax)) * (p.x1 - p.x0);
    const Y = (v) => p.y1 - (v / vMax) * (p.y1 - p.y0);

    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;

    // Cavity between the two peaks
    if (wh.d > 0) {
      ctx.fillStyle = CAVITY;
      ctx.fillRect(X(-wh.d), p.y0, X(wh.d) - X(-wh.d), p.y1 - p.y0);
    }

    // y grid
    const vStep = niceStep(vMax, 3);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let v = 0; v <= vMax + 1e-12; v += vStep) {
      const y = Y(v);
      ctx.strokeStyle = v === 0 ? "rgba(11,18,32,0.22)" : GRID;
      ctx.beginPath();
      ctx.moveTo(p.x0, y);
      ctx.lineTo(p.x1, y);
      ctx.stroke();
      ctx.fillStyle = AXIS;
      ctx.fillText(v === 0 ? "0" : String(+v.toPrecision(2)), p.x0 - 6, y);
    }

    // x grid
    const xStep = xMax > 120 ? 50 : 25;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let x = -Math.floor(xMax / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
      const px = X(x);
      ctx.strokeStyle = x === 0 ? "rgba(11,18,32,0.18)" : GRID;
      ctx.beginPath();
      ctx.moveTo(px, p.y0);
      ctx.lineTo(px, p.y1);
      ctx.stroke();

      if (px < p.x1 - 28) {
        ctx.fillStyle = AXIS;
        ctx.fillText(String(x), px, p.y1 + 6);
      }
    }

    ctx.textAlign = "right";
    ctx.fillText("x / M", p.x1, p.y1 + 6);

    // Universe labels
    ctx.textBaseline = "top";
    ctx.fillStyle = AXIS;
    ctx.textAlign = "left";
    ctx.fillText("← universe 2", p.x0 + 4, p.y0 + 2);
    ctx.textAlign = "right";
    ctx.fillText("universe 1 →", p.x1 - 4, p.y0 + 2);

    // Carrier level nu^2
    const yNu = Y(st.nu * st.nu);
    ctx.save();
    ctx.strokeStyle = PULSE;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(p.x0, yNu);
    ctx.lineTo(p.x1, yNu);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = PULSE;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("ν²", X(st.x0) + 6, yNu - 2);

    // V(x)
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x0, p.y0 - 1, p.x1 - p.x0, p.y1 - p.y0 + 2);
    ctx.clip();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();

    for (let k = 0; k < NX; k += 1) {
      const px = X(xs[k]);
      const py = Y(vs[k]);

      if (k === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.stroke();
    ctx.restore();

    // Shell term C delta(x): an arrow at the throat, pointing up from V(0)
    // for C > 0 and down onto it for C < 0 (not to scale: |C| is small).
    if (wh.C !== 0) {
      const base = Y(wh.V(0));
      const len = Math.min(30, 0.3 * (p.y1 - p.y0));
      const from = wh.C > 0 ? base : base - len;
      const tip = wh.C > 0 ? base - len : base - 1;
      const dir = wh.C > 0 ? -1 : 1;
      ctx.strokeStyle = BLUE;
      ctx.fillStyle = BLUE;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(X(0), from);
      ctx.lineTo(X(0), tip - dir * 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(0), tip);
      ctx.lineTo(X(0) - 4, tip - dir * 6);
      ctx.lineTo(X(0) + 4, tip - dir * 6);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(wh.C > 0 ? "C δ(x)" : "−|C| δ(x)", X(0) + 7, base - 0.6 * len);
    }

    // Cavity label, above the plot
    if (wh.d > 0) {
      ctx.fillStyle = BLUE;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`cavity 2d = ${(2 * wh.d).toFixed(1)} M`, (p.x0 + p.x1) / 2, p.y0 + 2);
    }

    // Pulse and observers on the axis
    const tick = (x, color, label) => {
      const px = X(x);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(px, p.y1 - 1);
      ctx.lineTo(px - 4.5, p.y1 - 9);
      ctx.lineTo(px + 4.5, p.y1 - 9);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, px, p.y1 - 11);
    };

    tick(st.x0, PULSE, "pulse");
    tick(st.xObs, INK, "A");
    tick(-st.xObs, INK, "B");

    if (hover !== null) {
      const k = hover;
      const px = X(xs[k]);
      ctx.strokeStyle = "rgba(11,18,32,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, p.y0);
      ctx.lineTo(px, p.y1);
      ctx.stroke();
      hoverDot(ctx, px, Y(vs[k]), INK);
    }

    showReadout();
  }

  function showReadout() {
    if (!st) {
      return;
    }

    const { wh } = st;

    if (hover !== null) {
      const x = xs[hover];
      readout.textContent =
        `x = ${x.toFixed(1)} M (universe ${x >= 0 ? 1 : 2}) · r = ${wh.r(x).toFixed(4)} M · ` +
        `V = ${formatValue(vs[hover])} / M²`;
      return;
    }

    const top = `barrier top √V = ${Math.sqrt(wh.vTop).toFixed(3)} / M`;
    readout.textContent =
      wh.d > 0
        ? `Two peaks at x = ±${wh.d.toFixed(1)} M (r = ${wh.rPeak.toFixed(2)} M) · ${top} · ` +
          `carrier ν ${st.nu < Math.sqrt(wh.vTop) ? "below" : "above"} it`
        : `The throat is outside the peak (a > ${wh.rPeak.toFixed(2)} M): a single barrier, no cavity · ${top}`;
  }

  canvas.addEventListener("pointermove", (event) => {
    if (!st) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const p = plot();
    const x = event.clientX - rect.left;
    hover = x < p.x0 || x > p.x1 ? null : Math.round(((x - p.x0) / (p.x1 - p.x0)) * (NX - 1));
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

  return {
    set(next) {
      const rebuild = !st || next.wh !== st.wh || next.xMax !== st.xMax;
      st = { ...st, ...next };

      if (rebuild) {
        compute();
      }

      draw();
    },
  };
}

// ---------- Transmission ----------

export function createTransmission(el) {
  const canvas = el.querySelector("canvas");
  const readout = el.querySelector("[data-readout]");
  const ctx = canvas.getContext("2d");
  const PAD = { l: 46, r: 12, t: 10, b: 32 };
  const STRIP = 38; // height of the pulse strip above the plot
  const STRIP_GAP = 10;
  const W_PLOT = 1.25;
  const DECADES = 10;

  let size = { w: 0, h: 0 };
  let data = null; // { omegas, t2, lines, vTop, d }
  let pulse = { sigma: 8, nu: 0.3 };
  let scale = "log";
  let hover = null;
  let note = "Computing the transmission…";

  const plot = () => ({ x0: PAD.l, x1: size.w - PAD.r, y0: PAD.t + STRIP + STRIP_GAP, y1: size.h - PAD.b });
  const X = (w, p) => p.x0 + (w / W_PLOT) * (p.x1 - p.x0);

  function yOf(p) {
    if (scale === "log") {
      return (v) => {
        const e = Math.log10(Math.max(v, 1e-300));
        const u = (Math.min(0, Math.max(-DECADES - 0.3, e)) + DECADES) / DECADES;
        return p.y1 - u * (p.y1 - p.y0);
      };
    }

    return (v) => p.y1 - Math.min(1.04, Math.max(0, v)) * (p.y1 - p.y0) / 1.04;
  }

  // Fraction of the pulse energy carried by |T|^2 (trapezoid on the grid).
  function predicted() {
    const { omegas, t2 } = data;
    let num = 0;
    let den = 0;

    for (let j = 0; j + 1 < omegas.length; j += 1) {
      const dw = omegas[j + 1] - omegas[j];
      const e0 = pulseEnergy(omegas[j], pulse.sigma, pulse.nu);
      const e1 = pulseEnergy(omegas[j + 1], pulse.sigma, pulse.nu);
      num += 0.5 * (e0 * t2[j] + e1 * t2[j + 1]) * dw;
      den += 0.5 * (e0 + e1) * dw;
    }

    return den > 0 ? num / den : 0;
  }

  function draw() {
    if (size.w === 0) {
      return;
    }

    const p = plot();
    const Y = yOf(p);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;

    // y grid
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    if (scale === "log") {
      for (let e = 0; e >= -DECADES; e -= 2) {
        const y = Y(10 ** e);
        ctx.strokeStyle = GRID;
        ctx.beginPath();
        ctx.moveTo(p.x0, y);
        ctx.lineTo(p.x1, y);
        ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(e === 0 ? "1" : powerOfTen(e), p.x0 - 6, y);
      }
    } else {
      for (let v = 0; v <= 1 + 1e-9; v += 0.25) {
        const y = Y(v);
        ctx.strokeStyle = v === 0 ? "rgba(11,18,32,0.22)" : GRID;
        ctx.beginPath();
        ctx.moveTo(p.x0, y);
        ctx.lineTo(p.x1, y);
        ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(String(v), p.x0 - 6, y);
      }
    }

    ctx.strokeStyle = "rgba(11,18,32,0.22)";
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y1 + 0.5);
    ctx.lineTo(p.x1, p.y1 + 0.5);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let w = 0; w <= W_PLOT + 1e-9; w += 0.25) {
      const x = X(w, p);
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

    // Pulse energy spectrum in its own strip, sharing the frequency axis
    {
      const n = 400;
      const top = PAD.t;
      const bot = PAD.t + STRIP;
      const ws = Array.from({ length: n }, (_, k) => (W_PLOT * (k + 0.5)) / n);
      const es = ws.map((w) => pulseEnergy(w, pulse.sigma, pulse.nu));
      const eMax = Math.max(...es) || 1;
      const ys = (v) => bot - (v / eMax) * (bot - top - 2);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(p.x0, bot + 0.5);
      ctx.lineTo(p.x1, bot + 0.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(ws[0], p), bot);
      ws.forEach((w, k) => ctx.lineTo(X(w, p), ys(es[k])));
      ctx.lineTo(X(ws[n - 1], p), bot);
      ctx.closePath();
      ctx.fillStyle = "rgba(216,97,28,0.16)";
      ctx.fill();
      ctx.beginPath();
      ws.forEach((w, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, X(w, p), ys(es[k])));
      ctx.strokeStyle = PULSE;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = PULSE;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("pulse", p.x0 - 6, (top + bot) / 2);
    }

    if (!data) {
      showReadout();
      return;
    }

    // Barrier top
    {
      const x = X(Math.sqrt(data.vTop), p);
      ctx.save();
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, PAD.t);
      ctx.lineTo(x, p.y1);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = BLUE;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText("barrier top", x + 5, p.y1 - 4);
    }

    // |T|^2: the grid curve, then each refined line as a spike to its peak.
    const { omegas, t2, lines } = data;
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x0, p.y0 - 1, p.x1 - p.x0, p.y1 - p.y0 + 2);
    ctx.clip();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    // Merge the line peaks into the curve so that narrow lines show as spikes.
    const pts = [];

    for (let j = 0; j < omegas.length; j += 1) {
      pts.push([omegas[j], t2[j]]);
    }

    lines.forEach((line) => pts.push([line.w, line.t2]));
    pts.sort((a, b) => a[0] - b[0]);
    pts.forEach(([w, v], k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, X(w, p), Y(v)));
    ctx.stroke();
    ctx.restore();

    if (hover !== null) {
      const j = hover;
      const x = X(omegas[j], p);
      ctx.strokeStyle = "rgba(11,18,32,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, p.y0);
      ctx.lineTo(x, p.y1);
      ctx.stroke();
      hoverDot(ctx, x, Y(t2[j]), INK);
    }

    showReadout();
  }

  function showReadout() {
    if (!data) {
      readout.textContent = note;
      return;
    }

    if (hover !== null) {
      const j = hover;
      const T = data.t2[j];
      // Nearest refined line within a few samples
      const dw = data.omegas[1] - data.omegas[0];
      const near = data.lines.find((line) => Math.abs(line.w - data.omegas[j]) < 2.5 * dw);
      let text = `ω = ${data.omegas[j].toFixed(3)} / M · |T|² = ${formatValue(T)} · |R|² = ${formatValue(1 - T)}`;

      if (near) {
        text += ` · line at ω = ${near.w.toFixed(5)} / M`;
      }

      readout.textContent = text;
      return;
    }

    const top = Math.sqrt(data.vTop);
    const below = data.lines.filter((line) => line.w < top && line.t2 > 0.5).length;
    const spacing = data.d > 0 ? ` · spacing ≈ π/2d = ${(Math.PI / (2 * data.d)).toFixed(3)} / M` : "";
    readout.textContent =
      `${below} transmission line${below === 1 ? "" : "s"} below the barrier top${spacing} · ` +
      `this pulse: ${(100 * predicted()).toFixed(1)} % of its energy crosses`;
  }

  canvas.addEventListener("pointermove", (event) => {
    if (!data) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const p = plot();
    const w = ((event.clientX - rect.left - p.x0) / (p.x1 - p.x0)) * W_PLOT;
    const { omegas } = data;
    const dw = omegas[1] - omegas[0];
    const j = Math.round((w - omegas[0]) / dw);
    hover = j < 0 || j >= omegas.length ? null : j;
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

  return {
    setData(next) {
      data = next;
      draw();
    },
    clear(text) {
      data = null;
      note = text;
      draw();
    },
    setPulse(next) {
      pulse = { ...pulse, ...next };
      draw();
    },
    setScale(next) {
      scale = next;
      draw();
    },
    predicted: () => (data ? predicted() : null),
  };
}
