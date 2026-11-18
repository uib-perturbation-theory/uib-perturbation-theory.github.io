/* Sasaki–Nakamura simulator: 2D panels.
   - Spectrum |X(omega)| of the plunge waveform, with the quasinormal
     frequencies marked.
   - Quasinormal frequencies of l = 2, m = 0 in the complex plane as the spin
     goes from 0 to 0.99. Clicking a dot picks that spin. */

import { powerOfTen, formatValue } from "../rw/rw-panels.js";
import { SPINS, OMEGA, CURVE } from "./sn-qnm.js";

const INK = "#0b1220";
const AXIS = "#7a8492";
const GRID = "rgba(11,18,32,0.07)";
const REF = "#a3abb8";
const QNM = "#2a78d6";
const PICK = "#f2762e";
const FONT = '10px "IBM Plex Mono", monospace';
const SUB = ["₀", "₁", "₂", "₃"];

function fitCanvas(canvas, ctx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

const complexText = ([re, im]) =>
  `${re.toFixed(4)} ${im < 0 ? "−" : "+"} ${Math.abs(im).toFixed(4)} i`;

// ---------- Spectrum ----------

export function createSpectrum(el) {
  const canvas = el.querySelector("canvas");
  const readout = el.querySelector("[data-readout]");
  const refKey = el.querySelector("[data-ref-key]");
  const ctx = canvas.getContext("2d");

  const W_MAX = 1.5;
  const DECADES = 10;
  const PAD = { l: 46, r: 12, t: 10, b: 32 };

  let data = null;
  let k = 0;
  let size = { w: 0, h: 0 };
  let hover = null; // omega

  const plot = () => ({ x0: PAD.l, x1: size.w - PAD.r, y0: PAD.t, y1: size.h - PAD.b });
  const xOf = (w, p) => p.x0 + (w / W_MAX) * (p.x1 - p.x0);

  function valueAt(kk, w) {
    const X = data.absX[kk];
    const x = (w - data.w0) / data.dw;
    const i = Math.max(0, Math.min(data.nw - 2, Math.floor(x)));
    const s = Math.max(0, Math.min(1, x - i));
    // log-linear interpolation
    return Math.exp((1 - s) * Math.log(X[i]) + s * Math.log(X[i + 1]));
  }

  function draw() {
    if (size.w === 0) {
      return;
    }

    const p = plot();
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;

    if (!data) {
      return;
    }

    let m = 0;

    for (let j = 0; j < data.nw; j += 1) {
      m = Math.max(m, data.absX[k][j], data.absX[0][j]);
    }

    const hiE = Math.ceil(Math.log10(m * 1.15));
    const loE = hiE - DECADES;
    const yOf = (v) => {
      const e = Math.log10(Math.max(v, 1e-300));
      const u = (Math.min(hiE, Math.max(loE - 0.2, e)) - loE) / (hiE - loE);
      return p.y1 - u * (p.y1 - p.y0);
    };

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

      if ((hiE - e) % 2 === 0) {
        ctx.fillStyle = AXIS;
        ctx.fillText(powerOfTen(e), p.x0 - 6, y);
      }
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

    // Quasinormal frequencies (real parts)
    for (let n = 3; n >= 0; n -= 1) {
      const x = xOf(OMEGA[n][k][0], p);
      ctx.save();
      ctx.strokeStyle = n === 0 ? QNM : "rgba(42,120,214,0.35)";
      ctx.lineWidth = n === 0 ? 1.4 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, p.y0);
      ctx.lineTo(x, p.y1);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = QNM;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Re ω₀", xOf(OMEGA[0][k][0], p) + 5, p.y0 + 2);

    // Curves
    const curve = (kk, color, width) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x0, p.y0 - 1, p.x1 - p.x0, p.y1 - p.y0 + 2);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.beginPath();

      for (let j = 0; j < data.nw; j += 1) {
        const w = data.w0 + j * data.dw;

        if (w > W_MAX + data.dw) {
          break;
        }

        const x = xOf(w, p);
        const y = yOf(data.absX[kk][j]);

        if (j === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
      ctx.restore();
    };

    if (k !== 0) {
      curve(0, REF, 1.3);
    }

    curve(k, INK, 1.7);

    if (hover !== null) {
      const x = xOf(hover, p);
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

      if (k !== 0) {
        dot(valueAt(0, hover), REF);
      }

      dot(valueAt(k, hover), INK);
    }

    showReadout();
  }

  function showReadout() {
    if (!data) {
      readout.textContent = "Loading…";
      return;
    }

    const a = SPINS[k];

    if (hover !== null) {
      let text = `ω = ${hover.toFixed(3)} / M · |X| = ${formatValue(valueAt(k, hover))}`;

      if (k !== 0) {
        text += ` · a = 0: ${formatValue(valueAt(0, hover))}`;
      }

      readout.textContent = text;
      return;
    }

    readout.textContent =
      `a = ${a.toFixed(1)} M · Re ω₀ = ${OMEGA[0][k][0].toFixed(4)} / M. ` +
      "Hover to read values.";
  }

  canvas.addEventListener("pointermove", (event) => {
    if (!data) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const p = plot();
    const x = event.clientX - rect.left;

    if (x < p.x0 || x > p.x1) {
      hover = null;
    } else {
      hover = Math.max(data.w0, ((x - p.x0) / (p.x1 - p.x0)) * W_MAX);
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

  return {
    setData(d) {
      data = d;
      draw();
    },
    setSpin(kk) {
      k = kk;

      if (refKey) {
        refKey.hidden = k === 0;
      }

      draw();
    },
  };
}

// ---------- Quasinormal frequencies in the complex plane ----------

export function createQnmPlane(el, { onPick }) {
  const canvas = el.querySelector("canvas");
  const readout = el.querySelector("[data-readout]");
  const ctx = canvas.getContext("2d");

  const X_RANGE = [0.22, 0.44];
  const Y_RANGE = [-0.76, 0];
  const PAD = { l: 46, r: 14, t: 12, b: 32 };

  let k = 0;
  let size = { w: 0, h: 0 };
  let hover = null; // { n, k }

  const plot = () => ({ x0: PAD.l, x1: size.w - PAD.r, y0: PAD.t, y1: size.h - PAD.b });
  const xOf = (re, p) => p.x0 + ((re - X_RANGE[0]) / (X_RANGE[1] - X_RANGE[0])) * (p.x1 - p.x0);
  const yOf = (im, p) => p.y0 + ((Y_RANGE[1] - im) / (Y_RANGE[1] - Y_RANGE[0])) * (p.y1 - p.y0);

  function draw() {
    if (size.w === 0) {
      return;
    }

    const p = plot();
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.font = FONT;

    // Grid
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let im = 0; im >= Y_RANGE[0] - 1e-9; im -= 0.1) {
      const y = yOf(im, p);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(p.x0, y);
      ctx.lineTo(p.x1, y);
      ctx.stroke();

      if (Math.round(im * 10) % 2 === 0) {
        ctx.fillStyle = AXIS;
        ctx.fillText(im === 0 ? "0" : im.toFixed(1).replace("-", "−"), p.x0 - 6, y);
      }
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let re = 0.25; re <= X_RANGE[1] + 1e-9; re += 0.05) {
      const x = xOf(re, p);
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(x, p.y0);
      ctx.lineTo(x, p.y1);
      ctx.stroke();

      if (x < p.x1 - 40) {
        ctx.fillStyle = AXIS;
        ctx.fillText(re.toFixed(2), x, p.y1 + 6);
      }
    }

    ctx.strokeStyle = "rgba(11,18,32,0.22)";
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y1 + 0.5);
    ctx.lineTo(p.x1, p.y1 + 0.5);
    ctx.stroke();

    ctx.fillStyle = AXIS;
    ctx.textAlign = "right";
    ctx.fillText("Re ω M", p.x1, p.y1 + 6);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Im ω M", p.x0 + 6, p.y0 + 4);

    // Curves a = 0 -> 0.99
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x0, p.y0 - 1, p.x1 - p.x0, p.y1 - p.y0 + 2);
    ctx.clip();

    CURVE.forEach((pts) => {
      ctx.strokeStyle = "rgba(42,120,214,0.55)";
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach(([re, im], j) => {
        const x = xOf(re, p);
        const y = yOf(im, p);

        if (j === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });

    // Dots at the spins of the waveforms
    OMEGA.forEach((row, n) => {
      row.forEach(([re, im], kk) => {
        const x = xOf(re, p);
        const y = yOf(im, p);
        const isHover = hover && hover.n === n && hover.k === kk;
        ctx.beginPath();
        ctx.arc(x, y, isHover ? 5 : 3.6, 0, 2 * Math.PI);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, isHover ? 3.6 : 2.4, 0, 2 * Math.PI);
        ctx.fillStyle = QNM;
        ctx.fill();
      });
    });

    // Current spin
    OMEGA.forEach((row) => {
      const [re, im] = row[k];
      const x = xOf(re, p);
      const y = yOf(im, p);
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = PICK;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, 2 * Math.PI);
      ctx.fillStyle = PICK;
      ctx.fill();
    });

    ctx.restore();

    // Labels: overtone number at the a = 0 end, spin at the ends of n = 0
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    CURVE.forEach((pts, n) => {
      const [re, im] = pts[0];
      ctx.fillText(`n = ${n}`, xOf(re, p) - 10, yOf(im, p));
    });

    ctx.fillStyle = AXIS;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    {
      const [re0, im0] = CURVE[0][0];
      const [re1, im1] = CURVE[0][CURVE[0].length - 1];
      ctx.fillText("a = 0", xOf(re0, p), yOf(im0, p) - 9);
      ctx.fillText("a = 0.99", xOf(re1, p), yOf(im1, p) - 9);
    }

    showReadout();
  }

  function showReadout() {
    if (hover) {
      readout.textContent =
        `a = ${SPINS[hover.k].toFixed(1)} M · ω${SUB[hover.n]} M = ${complexText(OMEGA[hover.n][hover.k])}. ` +
        "Click to use this spin.";
      return;
    }

    readout.textContent =
      `a = ${SPINS[k].toFixed(1)} M · ω₀ M = ${complexText(OMEGA[0][k])} · ` +
      `ω₁ M = ${complexText(OMEGA[1][k])}`;
  }

  function nearest(event) {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const p = plot();
    let best = null;
    let bestD = 14 * 14;

    OMEGA.forEach((row, n) => {
      row.forEach(([re, im], kk) => {
        const dx = xOf(re, p) - mx;
        const dy = yOf(im, p) - my;
        const d = dx * dx + dy * dy;

        if (d < bestD) {
          bestD = d;
          best = { n, k: kk };
        }
      });
    });

    return best;
  }

  canvas.addEventListener("pointermove", (event) => {
    hover = nearest(event);
    canvas.style.cursor = hover ? "pointer" : "default";
    draw();
  });

  canvas.addEventListener("pointerleave", () => {
    hover = null;
    draw();
  });

  canvas.addEventListener("click", (event) => {
    const hit = nearest(event);

    if (hit) {
      onPick(hit.k);
    }
  });

  new ResizeObserver(() => {
    size = fitCanvas(canvas, ctx);
    draw();
  }).observe(canvas);

  return {
    setSpin(kk) {
      k = kk;
      draw();
    },
  };
}
