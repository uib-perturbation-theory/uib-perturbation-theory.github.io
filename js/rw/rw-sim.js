/* Regge–Wheeler simulator: 3D view.
   The solver runs in rw-worker.js and streams Psi(t, r*) on a display grid.
   The sheet is the meridional plane through the black hole (symmetry axis
   along world x); its height is H * f(Psi) * P_l(cos theta). */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { R_PEAK, excitation, mode, qnmSignal } from "./rw-qnm.js";
import { createExcitationMap, createSpectrum } from "./rw-panels.js";

const root = document.querySelector("[data-rw]");

if (root) {
  init();
}

function init() {
  // ---------- Constants ----------

  const R_BH = 9; // radius of the drawn black hole (world units)
  const HEIGHT = 11; // sheet height for |Psi| = 1
  const EPS = 0.01; // scale of the asinh compression
  const SEGMENTS = 192; // angular resolution of the sheet
  const R_IN = -10; // tortoise coordinate at the edge of the black hole

  const COLORS = {
    pos: new THREE.Color("#f2762e"),
    neg: new THREE.Color("#3e7cb1"),
    zero: new THREE.Color("#efebe3"),
  };

  const rhoOf = (rStar) => R_BH + (rStar - R_IN);

  // ---------- DOM ----------

  const stage = root.querySelector(".rw-stage");
  const canvas = stage.querySelector(".rw-canvas");
  const timeEl = stage.querySelector(".rw-time");
  const statusEl = stage.querySelector(".rw-status");
  const labels = Object.fromEntries(
    [...stage.querySelectorAll("[data-label]")].map((el) => [el.dataset.label, el])
  );
  const traceCanvas = root.querySelector(".rw-trace canvas");
  const playBtn = root.querySelector('[data-action="play"]');
  const outputs = Object.fromEntries(
    [...root.querySelectorAll("[data-out]")].map((el) => [el.dataset.out, el])
  );

  const params = {
    sigma: 6,
    nu: 0.45,
    s0: 100,
    sObs: 100,
    l: 2,
    speed: 20,
    log: true,
  };

  root.querySelectorAll("[data-param]").forEach((input) => {
    const key = input.dataset.param;
    params[key] = input.type === "checkbox" ? input.checked : Number(input.value);
  });

  const formatters = {
    sigma: (v) => `${v.toFixed(1)} M`,
    nu: (v) => `${v.toFixed(2)} / M`,
    s0: (v) => `${v.toFixed(0)} M`,
    sObs: (v) => `${v.toFixed(0)} M`,
    speed: (v) => `${v.toFixed(0)} M/s`,
  };

  const showOutputs = () => {
    Object.entries(formatters).forEach(([key, fmt]) => {
      if (outputs[key]) {
        outputs[key].textContent = fmt(params[key]);
      }
    });
  };

  showOutputs();

  // ---------- Renderer, scene, camera ----------

  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    stage.insertAdjacentHTML(
      "beforeend",
      '<div class="rw-error">This simulator needs WebGL, which is not available in this browser.</div>'
    );
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 25;
  controls.maxDistance = 1200;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.rotateSpeed = 0.7;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.25));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(-90, 170, 120);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffeedd, 0.55);
  fillLight.position.set(140, 60, -110);
  scene.add(fillLight);

  // ---------- Black hole ----------

  const bh = new THREE.Mesh(
    new THREE.SphereGeometry(R_BH, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.32, metalness: 0.1 })
  );
  scene.add(bh);

  // ---------- Sheet ----------

  const uniforms = {
    uRing: { value: null },
    uPos: { value: COLORS.pos },
    uNeg: { value: COLORS.neg },
    uZero: { value: COLORS.zero },
    uR0: { value: R_IN },
    uDr: { value: 0.3 },
  };

  const sheetMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  sheetMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D uRing;
        attribute float aRing;
        attribute float aG;
        attribute float aGp;
        varying float vVal;
        varying float vRing;`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec4 ringData = texelFetch(uRing, ivec2(int(aRing + 0.5), 0), 0);
        float rhoV = max(length(position.xz), 1e-3);
        float cph = position.x / rhoV;
        float sph = position.z / rhoV;
        float dyr = ringData.y * aG;
        float dyp = ringData.x * aGp / rhoV;
        float gx = dyr * cph - dyp * sph;
        float gz = dyr * sph + dyp * cph;
        vec3 objectNormal = normalize(vec3(-gx, 1.0, -gz));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position.x, ringData.x * aG, position.z);
        #ifdef USE_ALPHAHASH
          vPosition = vec3(position);
        #endif
        vVal = ringData.z * aG;
        vRing = aRing;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uPos;
        uniform vec3 uNeg;
        uniform vec3 uZero;
        uniform float uR0;
        uniform float uDr;
        varying float vVal;
        varying float vRing;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float vv = clamp(vVal, -1.0, 1.0);
        vec3 sheetCol = vv >= 0.0
          ? mix(uZero, uPos, pow(vv, 0.7))
          : mix(uZero, uNeg, pow(-vv, 0.7));
        float rs = uR0 + vRing * uDr;
        float gridDist = abs(fract(rs / 25.0 + 0.5) - 0.5) * 25.0;
        float gridLine = 1.0 - smoothstep(0.0, fwidth(rs) * 1.2, gridDist);
        sheetCol *= 1.0 - 0.14 * gridLine;
        diffuseColor.rgb *= sheetCol;`
      );
  };

  let sheet = null;
  let ringTex = null;
  let ringData = null; // Float32Array(nRing * 4): F, dF/drho, value, 0
  let rhoRing = null;
  let taper = null;
  let psiNow = null;

  function legendre(l, x) {
    let p0 = 1;
    let p1 = x;

    if (l === 0) {
      return [1, 0];
    }

    for (let k = 2; k <= l; k += 1) {
      const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
      p0 = p1;
      p1 = p2;
    }

    const d = 1 - x * x;
    const dP =
      d > 1e-9
        ? (l * (p0 - x * p1)) / d
        : 0.5 * l * (l + 1) * (x > 0 ? 1 : l % 2 ? 1 : -1);

    return [p1, dP];
  }

  function buildSheet(rStar, rOut) {
    if (sheet) {
      scene.remove(sheet);
      sheet.geometry.dispose();
    }

    if (ringTex) {
      ringTex.dispose();
    }

    const nRing = rStar.length;
    const nCol = SEGMENTS + 1;
    const nv = nRing * nCol;
    const position = new Float32Array(nv * 3);
    const aRing = new Float32Array(nv);

    rhoRing = new Float32Array(nRing);
    taper = new Float32Array(nRing);
    psiNow = new Float32Array(nRing);

    for (let i = 0; i < nRing; i += 1) {
      const rho = rhoOf(rStar[i]);
      rhoRing[i] = rho;

      // Fade into the black hole and towards the outer edge of the slice.
      const inner = smoothstep(R_IN, R_IN + 6, rStar[i]);
      const outer = 1 - smoothstep(rOut - 14, rOut, rStar[i]);
      taper[i] = inner * outer;

      for (let j = 0; j < nCol; j += 1) {
        const phi = (2 * Math.PI * j) / SEGMENTS;
        const v = i * nCol + j;
        position[3 * v] = rho * Math.cos(phi);
        position[3 * v + 1] = 0;
        position[3 * v + 2] = rho * Math.sin(phi);
        aRing[v] = i;
      }
    }

    const index = new Uint32Array((nRing - 1) * SEGMENTS * 6);
    let k = 0;

    for (let i = 0; i < nRing - 1; i += 1) {
      for (let j = 0; j < SEGMENTS; j += 1) {
        const a = i * nCol + j;
        const b = (i + 1) * nCol + j;
        const c = (i + 1) * nCol + j + 1;
        const d = i * nCol + j + 1;
        index[k++] = a;
        index[k++] = d;
        index[k++] = b;
        index[k++] = b;
        index[k++] = d;
        index[k++] = c;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aRing", new THREE.BufferAttribute(aRing, 1));
    geometry.setAttribute("aG", new THREE.BufferAttribute(new Float32Array(nv), 1));
    geometry.setAttribute("aGp", new THREE.BufferAttribute(new Float32Array(nv), 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    ringData = new Float32Array(nRing * 4);
    ringTex = new THREE.DataTexture(ringData, nRing, 1, THREE.RGBAFormat, THREE.FloatType);
    ringTex.minFilter = THREE.NearestFilter;
    ringTex.magFilter = THREE.NearestFilter;
    ringTex.generateMipmaps = false;
    ringTex.needsUpdate = true;

    uniforms.uRing.value = ringTex;
    uniforms.uR0.value = rStar[0];
    uniforms.uDr.value = nRing > 1 ? rStar[1] - rStar[0] : 0.3;

    sheet = new THREE.Mesh(geometry, sheetMat);
    sheet.frustumCulled = false;
    scene.add(sheet);
  }

  function setAngular(l) {
    if (!sheet) {
      return;
    }

    const nCol = SEGMENTS + 1;
    const nRing = rhoRing.length;
    const G = new Float32Array(nCol);
    const Gp = new Float32Array(nCol);

    for (let j = 0; j < nCol; j += 1) {
      const phi = (2 * Math.PI * j) / SEGMENTS;
      const [P, dP] = legendre(l, Math.cos(phi));
      G[j] = P;
      Gp[j] = -Math.sin(phi) * dP;
    }

    const aG = sheet.geometry.getAttribute("aG");
    const aGp = sheet.geometry.getAttribute("aGp");

    for (let i = 0; i < nRing; i += 1) {
      aG.array.set(G, i * nCol);
      aGp.array.set(Gp, i * nCol);
    }

    aG.needsUpdate = true;
    aGp.needsUpdate = true;
  }

  // ---------- Markers ----------

  const markerGroup = new THREE.Group();
  scene.add(markerGroup);

  function dashedCircle(radius, color, opacity, dash, gap) {
    const pts = [];
    const n = 256;

    for (let i = 0; i <= n; i += 1) {
      const a = (2 * Math.PI * i) / n;
      pts.push(new THREE.Vector3(radius * Math.cos(a), 0.06, radius * Math.sin(a)));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({
        color,
        dashSize: dash,
        gapSize: gap,
        transparent: true,
        opacity,
      })
    );
    line.computeLineDistances();
    return line;
  }

  const peakRing = dashedCircle(rhoOf(R_PEAK), 0x0b1220, 0.45, 0.8, 0.8);
  markerGroup.add(peakRing);

  let pulseRing = null;

  function setPulseRing(s0) {
    if (pulseRing) {
      markerGroup.remove(pulseRing);
      pulseRing.geometry.dispose();
      pulseRing.material.dispose();
    }

    pulseRing = dashedCircle(rhoOf(s0), 0xd8611c, 0.85, 2.4, 1.8);
    markerGroup.add(pulseRing);
  }

  const observer = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.35 })
  );
  scene.add(observer);

  const obsStem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.35 })
  );
  scene.add(obsStem);

  // ---------- Simulation state ----------

  let worker = null;
  let sim = null; // simulation being shown
  let pending = null; // simulation being computed, shown once it has frames
  let t = 0;
  let playing = true;
  let keepTimeOnSwap = false;

  function startSim({ keepTime = false } = {}) {
    if (worker) {
      worker.terminate();
    }

    worker = new Worker(new URL("./rw-worker.js", import.meta.url));
    pending = null;
    keepTimeOnSwap = keepTime;

    if (spectrum) {
      spectrum.clearSignal("Solving… the scattered spectrum appears when the run ends.");
    }

    const startedAt = performance.now();
    const request = {
      sigma: params.sigma,
      nu: params.nu,
      l: params.l,
      s0: params.s0,
      sObs: params.sObs,
    };

    worker.onmessage = (event) => {
      const msg = event.data;

      if (msg.type === "meta") {
        pending = {
          ...msg,
          request,
          nDisp: msg.rStar.length,
          rOut: msg.rStar[msg.rStar.length - 1],
          frames: new Float32Array(msg.nFrames * msg.rStar.length),
          framesReady: 0,
          obs: new Float32Array(msg.nSteps + 1),
          obsReady: 0,
          done: false,
          startedAt,
        };
        return;
      }

      const target = pending;

      if (!target) {
        return;
      }

      if (msg.type === "frames") {
        target.frames.set(msg.data, msg.start * target.nDisp);
        target.framesReady = msg.start + msg.count;
      } else if (msg.type === "obs") {
        target.obs.set(msg.data, msg.start);
        target.obsReady = msg.start + msg.count;
        traceDirty = true;
      } else if (msg.type === "done") {
        target.done = true;
        target.elapsed = (performance.now() - startedAt) / 1000;
      } else if (msg.type === "error") {
        statusEl.textContent = `Solver error: ${msg.message}`;
      }

      maybeSwap();

      if (msg.type === "done" && target === sim && spectrum) {
        spectrum.setSignal(sim);
      }
    };

    worker.postMessage(request);
  }

  function maybeSwap() {
    if (!pending || pending === sim || pending.framesReady === 0) {
      return;
    }

    const covered = (pending.framesReady - 1) * pending.frameDt;

    if (keepTimeOnSwap && sim && covered < Math.min(t, pending.tEnd) && !pending.done) {
      return;
    }

    sim = pending;
    buildSheet(sim.rStar, sim.rOut);
    setAngular(sim.l);
    setPulseRing(sim.s0);

    if (keepTimeOnSwap) {
      t = Math.min(t, sim.tEnd);
    } else {
      t = 0;
      playing = true;
    }

    updatePlayButton();
    traceDirty = true;

    if (sim.done && spectrum) {
      spectrum.setSignal(sim);
    }
  }

  // ---------- Per-frame update of the sheet ----------

  const smoothstep = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  const compress = (psi) =>
    params.log
      ? Math.asinh(psi / EPS) / Math.asinh(1 / EPS)
      : Math.max(-1.25, Math.min(1.25, psi));

  function updateSheet() {
    if (!sim || !sheet) {
      return;
    }

    const n = sim.nDisp;
    const ft = Math.min(t / sim.frameDt, sim.framesReady - 1);
    const f0 = Math.max(0, Math.floor(ft));
    const f1 = Math.min(f0 + 1, sim.framesReady - 1);
    const w = ft - f0;
    const F = sim.frames;
    const o0 = f0 * n;
    const o1 = f1 * n;

    for (let i = 0; i < n; i += 1) {
      psiNow[i] = (1 - w) * F[o0 + i] + w * F[o1 + i];
      const c = compress(psiNow[i]) * taper[i];
      ringData[4 * i] = HEIGHT * c;
      ringData[4 * i + 2] = c;
    }

    for (let i = 0; i < n; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      ringData[4 * i + 1] =
        (ringData[4 * b] - ringData[4 * a]) / (rhoRing[b] - rhoRing[a]);
    }

    ringTex.needsUpdate = true;

    // Observer: sits on the sheet, on the axis (theta = 0, P_l = 1).
    const x = (sim.sObs - sim.rStar[0]) / (sim.rStar[1] - sim.rStar[0]);
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(x)));
    const u = x - i0;
    const y = (1 - u) * ringData[4 * i0] + u * ringData[4 * (i0 + 1)];
    const rhoObs = rhoOf(sim.sObs);
    observer.position.set(rhoObs, y + 1.7, 0);

    const stem = obsStem.geometry.getAttribute("position");
    stem.setXYZ(0, rhoObs, 0.05, 0);
    stem.setXYZ(1, rhoObs, y, 0);
    stem.needsUpdate = true;
  }

  // ---------- Labels ----------

  const tmp = new THREE.Vector3();

  function placeLabel(el, point, dy = 0) {
    tmp.copy(point).project(camera);

    if (tmp.z > 1 || tmp.z < -1) {
      el.hidden = true;
      return;
    }

    el.hidden = false;
    const x = (tmp.x * 0.5 + 0.5) * stage.clientWidth;
    const y = (-tmp.y * 0.5 + 0.5) * stage.clientHeight + dy;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  const labelPoint = new THREE.Vector3();

  function updateLabels() {
    placeLabel(labels.bh, labelPoint.set(0, R_BH + 1.5, 0), -6);

    // Ring labels sit on the side of the ring facing the camera.
    const az = Math.atan2(camera.position.z, camera.position.x);
    const rp = rhoOf(R_PEAK);
    const ap = az - 1.1;

    if (stage.clientWidth < 640) {
      labels.peak.hidden = true;
    } else {
      placeLabel(labels.peak, labelPoint.set(rp * Math.cos(ap), 0, rp * Math.sin(ap)), -4);
    }

    if (sim) {
      const r0 = rhoOf(sim.s0);
      const a0 = az - 0.45;
      placeLabel(labels.pulse, labelPoint.set(r0 * Math.cos(a0), 0, r0 * Math.sin(a0)), -4);
      placeLabel(labels.obs, labelPoint.copy(observer.position).setY(observer.position.y + 2), -6);
    } else {
      labels.pulse.hidden = true;
      labels.obs.hidden = true;
    }
  }

  // ---------- 2D panels (excitation map and spectrum) ----------

  const mapEl = document.querySelector("[data-rw-map]");
  const spectrumEl = document.querySelector("[data-rw-spectrum]");

  const map = mapEl
    ? createExcitationMap(mapEl, {
        onPick: ({ sigma, nu }) => {
          params.sigma = sigma;
          params.nu = nu;
          root.querySelector('[data-param="sigma"]').value = String(sigma);
          root.querySelector('[data-param="nu"]').value = String(nu);
          showOutputs();
          syncPanels();
          scheduleRestart({ keepTime: false });
        },
      })
    : null;

  const spectrum = spectrumEl ? createSpectrum(spectrumEl) : null;

  function syncPanels() {
    const values = { l: params.l, sigma: params.sigma, nu: params.nu };

    if (map) {
      map.set(values);
    }

    if (spectrum) {
      spectrum.setPulse(values);
    }
  }

  // ---------- Observer trace ----------

  const tctx = traceCanvas.getContext("2d");
  const traceCache = document.createElement("canvas");
  const cctx = traceCache.getContext("2d");
  let traceDirty = true;
  let traceScale = "lin";
  let traceW = 0;
  let traceH = 0;
  let traceY = () => 0;

  const PAD_L = 46;
  const PAD_R = 10;
  const PAD_T = 8;
  const PAD_B = 20;
  const LOG_DECADES = 9;
  const TRACE_INK = "#0b1220";
  const TRACE_MUTED = "#8a93a1";
  const TRACE_GRID = "rgba(11,18,32,0.07)";
  const QNM_COLOR = "#2a78d6";

  function resizeTrace() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    traceW = traceCanvas.clientWidth;
    traceH = traceCanvas.clientHeight;
    traceCanvas.width = Math.round(traceW * dpr);
    traceCanvas.height = Math.round(traceH * dpr);
    traceCache.width = traceCanvas.width;
    traceCache.height = traceCanvas.height;
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    traceDirty = true;
  }

  const plotLeft = () => PAD_L;
  const plotWidth = () => Math.max(1, traceW - PAD_L - PAD_R);
  const traceX = (time) => PAD_L + (sim ? time / sim.tEnd : 0) * plotWidth();

  const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  const powerOfTen = (e) =>
    `10${String(e).split("").map((c) => SUPERSCRIPT[c]).join("")}`;

  function niceStep(span, target) {
    const raw = span / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  function maxAbsObs() {
    let m = 0;

    for (let k = 0; k < sim.obsReady; k += 1) {
      const a = Math.abs(sim.obs[k]);

      if (a > m) {
        m = a;
      }
    }

    return m || 1;
  }

  // Sets traceY for the current scale and returns the y-axis ticks.
  function setupScale() {
    const top = PAD_T;
    const bottom = traceH - PAD_B;
    const peak = sim && sim.obsReady > 0 ? maxAbsObs() : 1;

    if (traceScale === "log") {
      const hi = Math.ceil(Math.log10(peak * 1.2));
      const lo = hi - LOG_DECADES;
      traceY = (v) => {
        const e = Math.log10(Math.max(Math.abs(v), 1e-300));
        const u = (Math.min(hi, Math.max(lo, e)) - lo) / (hi - lo);
        return bottom - u * (bottom - top);
      };

      const ticks = [];

      for (let e = hi; e >= lo; e -= 3) {
        ticks.push({ y: traceY(10 ** e), label: powerOfTen(e) });
      }

      return ticks;
    }

    const yMax = peak * 1.08;
    const mid = (top + bottom) / 2;
    traceY = (v) => mid - (v / yMax) * ((bottom - top) / 2);

    const step = niceStep(yMax, 2);
    const ticks = [];

    for (let v = -Math.floor(yMax / step) * step; v <= yMax + 1e-12; v += step) {
      const label = Math.abs(v) < 1e-12 ? "0" : String(+v.toPrecision(3));
      ticks.push({ y: traceY(v), label, zero: Math.abs(v) < 1e-12 });
    }

    return ticks;
  }

  // Asymptotic QNM prediction, drawn from the peak of the scattered signal.
  // Returns null until the solver has recorded that peak.
  let qnmMode = 0; // -1: off, otherwise highest overtone included

  function qnmOverlay(s) {
    if (qnmMode < 0 || !s) {
      return null;
    }

    if (s.qnm && s.qnm.mode === qnmMode) {
      return s.qnm;
    }

    const { sigma, nu, s0, sObs } = s.request;
    const tArrive = s0 + sObs - 2 * R_PEAK;
    const tA = Math.max(0, tArrive - 3 * sigma, s0 - sObs + 3.5 * sigma);
    const tB = Math.max(tA + 1, tArrive + 3 * sigma + 15);
    const kA = Math.ceil(tA / s.dt);
    const kB = Math.min(s.nSteps, Math.floor(tB / s.dt));

    if (s.obsReady <= kB) {
      return null;
    }

    let kPeak = kA;
    let peak = 0;

    for (let k = kA; k <= kB; k += 1) {
      const a = Math.abs(s.obs[k]);

      if (a > peak) {
        peak = a;
        kPeak = k;
      }
    }

    const step = 4 * s.dt;
    const tPeak = kPeak * s.dt;
    const count = Math.max(2, Math.floor((s.nSteps * s.dt - tPeak) / step) + 1);
    const times = Float64Array.from({ length: count }, (_, i) => tPeak + i * step);
    const values = qnmSignal(s.l, qnmMode, sigma, nu, s0, sObs, times);

    // Overtones of wide pulses have huge asymptotic amplitudes that only
    // decay later on: start the curve once their envelope is below the peak.
    let i0 = 0;

    if (qnmMode > 0) {
      const env = (time) => {
        let sum = 0;

        for (let n = 1; n <= qnmMode; n += 1) {
          const w = mode(s.l, n).w;
          sum += 2 * excitation(s.l, n, sigma, nu) * Math.exp(w[1] * (time - sObs - s0));
        }

        return sum;
      };

      while (i0 < count - 2 && env(times[i0]) > peak) {
        i0 += 1;
      }
    }

    s.qnm = { mode: qnmMode, times, values, i0 };
    return s.qnm;
  }

  function drawTraceCache() {
    cctx.clearRect(0, 0, traceW, traceH);
    cctx.font = '10px "IBM Plex Mono", monospace';

    const ticks = setupScale();
    const left = plotLeft();
    const right = left + plotWidth();
    const bottom = traceH - PAD_B;

    // y grid and labels
    cctx.textAlign = "right";
    cctx.textBaseline = "middle";

    ticks.forEach((tick) => {
      cctx.strokeStyle = tick.zero ? "rgba(11,18,32,0.22)" : TRACE_GRID;
      cctx.beginPath();
      cctx.moveTo(left, tick.y);
      cctx.lineTo(right, tick.y);
      cctx.stroke();
      cctx.fillStyle = TRACE_MUTED;
      cctx.fillText(tick.label, left - 6, tick.y);
    });

    // time axis
    cctx.strokeStyle = "rgba(11,18,32,0.22)";
    cctx.beginPath();
    cctx.moveTo(left, bottom + 0.5);
    cctx.lineTo(right, bottom + 0.5);
    cctx.stroke();

    if (!sim) {
      return;
    }

    const tStep = sim.tEnd > 600 ? 100 : 50;
    cctx.textAlign = "center";
    cctx.textBaseline = "top";

    for (let time = 0; time <= sim.tEnd + 1e-9; time += tStep) {
      const x = traceX(time);
      cctx.strokeStyle = TRACE_GRID;
      cctx.beginPath();
      cctx.moveTo(x, PAD_T);
      cctx.lineTo(x, bottom);
      cctx.stroke();
      // Leave room for the axis title at the right end.
      if (x < right - 44) {
        cctx.fillStyle = TRACE_MUTED;
        cctx.fillText(String(time), x, bottom + 5);
      }
    }

    cctx.textAlign = "right";
    cctx.fillText("t / M", right, bottom + 5);

    if (sim.obsReady < 2) {
      return;
    }

    // Waveform: one vertex per time step (a few thousand points).
    cctx.save();
    cctx.beginPath();
    cctx.rect(left, PAD_T - 1, right - left, bottom - PAD_T + 2);
    cctx.clip();

    cctx.strokeStyle = TRACE_INK;
    cctx.lineWidth = 1.3;
    cctx.lineJoin = "round";
    cctx.beginPath();

    for (let k = 0; k < sim.obsReady; k += 1) {
      const x = traceX(k * sim.dt);
      const y = traceY(sim.obs[k]);

      if (k === 0) {
        cctx.moveTo(x, y);
      } else {
        cctx.lineTo(x, y);
      }
    }

    cctx.stroke();

    const q = qnmOverlay(sim);

    if (q) {
      cctx.strokeStyle = QNM_COLOR;
      cctx.lineWidth = 1.6;
      cctx.setLineDash([5, 4]);
      cctx.beginPath();

      for (let i = q.i0; i < q.times.length; i += 1) {
        const x = traceX(q.times[i]);
        const y = traceY(q.values[i]);

        if (i === q.i0) {
          cctx.moveTo(x, y);
        } else {
          cctx.lineTo(x, y);
        }
      }

      cctx.stroke();
      cctx.setLineDash([]);
    }

    cctx.restore();
  }

  function drawTrace() {
    if (traceDirty) {
      drawTraceCache();
      traceDirty = false;
    }

    tctx.clearRect(0, 0, traceW, traceH);
    tctx.drawImage(traceCache, 0, 0, traceW, traceH);

    if (!sim) {
      return;
    }

    const left = plotLeft();
    const width = plotWidth();
    const bottom = traceH - PAD_B;
    const computed = Math.max(0, (sim.obsReady - 1) / sim.nSteps);

    if (computed < 1) {
      tctx.fillStyle = "rgba(11,18,32,0.04)";
      tctx.fillRect(left + computed * width, PAD_T, (1 - computed) * width, bottom - PAD_T);
    }

    const x = traceX(t);
    tctx.strokeStyle = "#f2762e";
    tctx.lineWidth = 1.5;
    tctx.beginPath();
    tctx.moveTo(x, PAD_T);
    tctx.lineTo(x, bottom);
    tctx.stroke();

    const k = Math.round(t / sim.dt);

    if (k < sim.obsReady) {
      tctx.fillStyle = "#f2762e";
      tctx.beginPath();
      tctx.arc(x, traceY(sim.obs[k]), 3.2, 0, 2 * Math.PI);
      tctx.fill();
    }
  }

  function seekFromTrace(event) {
    if (!sim) {
      return;
    }

    const rect = traceCanvas.getBoundingClientRect();
    const frac = (event.clientX - rect.left - PAD_L) / plotWidth();
    const available = (sim.framesReady - 1) * sim.frameDt;
    t = Math.max(0, Math.min(available, frac * sim.tEnd));
  }

  let seeking = false;

  traceCanvas.addEventListener("pointerdown", (event) => {
    seeking = true;
    traceCanvas.setPointerCapture(event.pointerId);
    seekFromTrace(event);
  });
  traceCanvas.addEventListener("pointermove", (event) => {
    if (seeking) {
      seekFromTrace(event);
    }
  });
  traceCanvas.addEventListener("pointerup", () => (seeking = false));
  traceCanvas.addEventListener("pointercancel", () => (seeking = false));

  // ---------- Camera ----------

  function resetView() {
    const reach = rhoOf(Math.max(params.s0 + 2 * params.sigma, params.sObs)) + 12;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const fit = Math.min(hfov, vfov * 1.6);
    const portrait = camera.aspect < 1;
    const dist = (reach / Math.tan(fit / 2)) * (portrait ? 0.95 : 0.9);
    const dir = portrait
      ? new THREE.Vector3(-0.15, 0.95, 1).normalize()
      : new THREE.Vector3(-0.2, 0.42, 1).normalize();

    controls.target.set(reach * 0.12, 0, reach * 0.08);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  // ---------- Resize ----------

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    resizeTrace();
  }

  new ResizeObserver(resize).observe(stage);
  resize();
  resetView();

  // ---------- Controls ----------

  function updatePlayButton() {
    playBtn.textContent = playing ? "Pause" : "Play";
  }

  let restartTimer = 0;

  const scheduleRestart = (options) => {
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => startSim(options), 120);
  };

  root.querySelectorAll('input[type="range"][data-param]').forEach((input) => {
    const key = input.dataset.param;

    input.addEventListener("input", () => {
      params[key] = Number(input.value);
      showOutputs();

      if (key === "s0") {
        setPulseRing(params.s0);
      }

      if (key === "sigma" || key === "nu") {
        syncPanels();
      }
    });

    input.addEventListener("change", () => {
      if (key === "speed") {
        return;
      }

      scheduleRestart({ keepTime: key === "sObs" });
    });
  });

  root.querySelector('input[type="checkbox"][data-param="log"]').addEventListener("change", (event) => {
    params.log = event.target.checked;
  });

  root.querySelectorAll("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      traceScale = btn.dataset.scale;
      root.querySelectorAll("[data-scale]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn))
      );
      traceDirty = true;
    });
  });

  const qnmKey = root.querySelector("[data-qnm-key]");

  root.querySelectorAll("[data-qnm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qnmMode = Number(btn.dataset.qnm);
      root.querySelectorAll("[data-qnm]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn))
      );

      if (qnmKey) {
        qnmKey.hidden = qnmMode < 0;
        qnmKey.lastChild.textContent = qnmMode === 0 ? "QNM prediction, n = 0" : "QNM prediction, n ≤ 3";
      }

      traceDirty = true;
    });
  });

  root.querySelectorAll("[data-l]").forEach((btn) => {
    btn.addEventListener("click", () => {
      params.l = Number(btn.dataset.l);
      root.querySelectorAll("[data-l]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b === btn))
      );
      syncPanels();
      scheduleRestart({ keepTime: false });
    });
  });

  playBtn.addEventListener("click", () => {
    if (sim && !playing && t >= sim.tEnd - 1e-6) {
      t = 0;
    }

    playing = !playing;
    updatePlayButton();
  });

  root.querySelector('[data-action="restart"]').addEventListener("click", () => {
    t = 0;
    playing = true;
    updatePlayButton();
  });

  root.querySelector('[data-action="view"]').addEventListener("click", resetView);

  // ---------- Loop ----------

  let last = performance.now();

  function frame(now) {
    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (sim) {
      const available = (sim.framesReady - 1) * sim.frameDt;

      if (playing && !seeking) {
        t = Math.min(t + params.speed * dtReal, available);

        if (t >= sim.tEnd - 1e-9) {
          t = sim.tEnd;
          playing = false;
          updatePlayButton();
        }
      }

      timeEl.textContent = `t = ${t.toFixed(1)} M`;

      const busy = pending && !pending.done ? pending : null;

      if (busy) {
        const pct = Math.round((100 * (busy.framesReady - 1)) / (busy.nFrames - 1));
        statusEl.textContent = `solving · ${Math.max(0, pct)} %`;
      } else if (sim.done) {
        statusEl.textContent =
          `ℓ = ${sim.l} · r* ∈ [${Math.round(sim.xMin)}, ${Math.round(sim.xMax)}] · ` +
          `${sim.n.toLocaleString("en")} points · CFL ${sim.cfl} · ` +
          `${sim.nSteps.toLocaleString("en")} steps · ${sim.elapsed.toFixed(1)} s`;
      }
    }

    updateSheet();
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
    drawTrace();
    requestAnimationFrame(frame);
  }

  setPulseRing(params.s0);
  syncPanels();
  startSim();
  requestAnimationFrame(frame);
}
