/* Sasaki–Nakamura simulator: 3D view, observer trace and controls.

   A particle falls from rest at infinity along the symmetry axis of a Kerr
   black hole. Its worldline is computed here (sn-orbit.js); the outgoing
   wave Psi(u), u = t - r*, comes from precomputed generalized Sasaki–Nakamura
   waveforms (sn-gsn.json).

   The sheet is the meridional plane through the black hole (symmetry axis
   along world x). Its height is H f(Psi(t - r*)) sin^2(theta): the outgoing
   radiation emitted so far, which lies outside the particle and outside the
   light ring. */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SPINS, OMEGA } from "./sn-qnm.js";
import { infall, kerr, lightRing, rstar } from "./sn-orbit.js";
import { fitRingdown, loadWaveforms, waveform } from "./sn-data.js";
import { createQnmPlane, createSpectrum } from "./sn-panels.js";

const root = document.querySelector("[data-sn]");

if (root) {
  init();
}

function init() {
  // ---------- Constants ----------

  const R_BH = 9; // radius of the drawn black hole (world units)
  const HEIGHT = 11; // sheet height for |Psi| = peak
  const EPS = 0.02; // scale of the asinh compression (fraction of the peak)
  const SEGMENTS = 192; // angular resolution of the sheet
  const R_IN = -10; // tortoise coordinate at the edge of the black hole
  const DR = 0.35; // radial spacing of the sheet (tortoise)
  const FADE = 4; // width of the fade at the inner edge of the radiation
  const R_START = 40; // the animation starts with the particle at r = 40 M
  const T_AFTER = 110; // run until 110 M after the peak reaches the observer
  const OBS_PHI = -Math.PI / 2; // observer in the equatorial direction

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

  const params = { spin: 0, sObs: 60, speed: 20, log: true };

  root.querySelectorAll("[data-param]").forEach((input) => {
    const key = input.dataset.param;
    params[key] = input.type === "checkbox" ? input.checked : Number(input.value);
  });

  const formatters = {
    spin: (v) => `a = ${v.toFixed(1)} M`,
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

  // ---------- Black hole and spin ----------

  const bh = new THREE.Mesh(
    new THREE.SphereGeometry(R_BH, 64, 48),
    new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.32, metalness: 0.1 })
  );
  scene.add(bh);

  // Spin vector along the rotation axis, on the side opposite to the
  // particle; its length grows with a.
  const spinGroup = new THREE.Group();
  scene.add(spinGroup);

  const spinMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.45 });
  const spinShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1, 16), spinMat);
  const spinHead = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.6, 24), spinMat);
  spinShaft.rotation.z = Math.PI / 2;
  spinHead.rotation.z = Math.PI / 2; // cone tip towards -x
  spinGroup.add(spinShaft, spinHead);

  function setSpinVector(a) {
    const len = 3 + 14 * a;
    spinShaft.scale.set(1, len, 1);
    spinShaft.position.set(-R_BH - len / 2, 0.9, 0);
    spinHead.position.set(-R_BH - len - 1.2, 0.9, 0);
    spinGroup.visible = a > 0;
  }

  // ---------- Sheet ----------

  const uniforms = {
    uRing: { value: null },
    uPos: { value: COLORS.pos },
    uNeg: { value: COLORS.neg },
    uZero: { value: COLORS.zero },
    uR0: { value: R_IN },
    uDr: { value: DR },
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
  let rStarRing = null;
  let rhoRing = null;
  let taper = null;
  let rOutSheet = 0;

  const smoothstep = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  function buildSheet(rOut) {
    if (sheet) {
      scene.remove(sheet);
      sheet.geometry.dispose();
    }

    if (ringTex) {
      ringTex.dispose();
    }

    rOutSheet = rOut;
    const nRing = Math.floor((rOut - R_IN) / DR) + 1;
    const nCol = SEGMENTS + 1;
    const nv = nRing * nCol;
    const position = new Float32Array(nv * 3);
    const aRing = new Float32Array(nv);
    const aG = new Float32Array(nv);
    const aGp = new Float32Array(nv);

    rStarRing = new Float32Array(nRing);
    rhoRing = new Float32Array(nRing);
    taper = new Float32Array(nRing);

    // Angular pattern of l = 2, m = 0 radiation: -2Y20 ∝ sin^2(theta),
    // theta measured from the symmetry axis (world x).
    const G = new Float32Array(nCol);
    const Gp = new Float32Array(nCol);

    for (let j = 0; j < nCol; j += 1) {
      const phi = (2 * Math.PI * j) / SEGMENTS;
      G[j] = Math.sin(phi) ** 2;
      Gp[j] = 2 * Math.sin(phi) * Math.cos(phi);
    }

    for (let i = 0; i < nRing; i += 1) {
      const rs = R_IN + i * DR;
      const rho = rhoOf(rs);
      rStarRing[i] = rs;
      rhoRing[i] = rho;
      taper[i] = 1 - smoothstep(rOut - 14, rOut, rs);

      for (let j = 0; j < nCol; j += 1) {
        const phi = (2 * Math.PI * j) / SEGMENTS;
        const v = i * nCol + j;
        position[3 * v] = rho * Math.cos(phi);
        position[3 * v + 1] = 0;
        position[3 * v + 2] = rho * Math.sin(phi);
        aRing[v] = i;
        aG[v] = G[j];
        aGp[v] = Gp[j];
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
    geometry.setAttribute("aG", new THREE.BufferAttribute(aG, 1));
    geometry.setAttribute("aGp", new THREE.BufferAttribute(aGp, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));

    ringData = new Float32Array(nRing * 4);
    ringTex = new THREE.DataTexture(ringData, nRing, 1, THREE.RGBAFormat, THREE.FloatType);
    ringTex.minFilter = THREE.NearestFilter;
    ringTex.magFilter = THREE.NearestFilter;
    ringTex.generateMipmaps = false;
    ringTex.needsUpdate = true;

    uniforms.uRing.value = ringTex;
    uniforms.uR0.value = R_IN;
    uniforms.uDr.value = DR;

    sheet = new THREE.Mesh(geometry, sheetMat);
    sheet.frustumCulled = false;
    scene.add(sheet);
  }

  // ---------- Markers ----------

  function dashedLine(points, color, opacity, dash, gap) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({ color, dashSize: dash, gapSize: gap, transparent: true, opacity })
    );
    line.computeLineDistances();
    return line;
  }

  function circlePoints(radius) {
    const pts = [];

    for (let i = 0; i <= 256; i += 1) {
      const a = (2 * Math.PI * i) / 256;
      pts.push(new THREE.Vector3(radius * Math.cos(a), 0.06, radius * Math.sin(a)));
    }

    return pts;
  }

  const markerGroup = new THREE.Group();
  scene.add(markerGroup);

  let ringLine = null;
  let pathLine = null;
  let startRing = null;

  function replace(obj, next) {
    if (obj) {
      markerGroup.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    }

    markerGroup.add(next);
    return next;
  }

  function setMarkers() {
    ringLine = replace(ringLine, dashedLine(circlePoints(rhoOf(state.rsLR)), 0x0b1220, 0.45, 0.8, 0.8));

    // Path of the particle along the axis, from its starting point to the hole.
    pathLine = replace(
      pathLine,
      dashedLine(
        [new THREE.Vector3(rhoOf(state.rs0), 0.08, 0), new THREE.Vector3(R_BH, 0.08, 0)],
        0xd8611c,
        0.7,
        1.6,
        1.2
      )
    );

    const tick = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.6, 40),
      new THREE.MeshBasicMaterial({ color: 0xd8611c, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(rhoOf(state.rs0), 0.07, 0);
    startRing = replace(startRing, tick);
  }

  const particle = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xd8611c, roughness: 0.35, emissive: 0x4a1a04 })
  );
  scene.add(particle);

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

  // ---------- State ----------

  const state = {
    data: null,
    k: 0,
    a: 0,
    wave: null,
    orbit: null,
    rsLR: 0,
    rs0: 0,
    tStart: 0,
    tEnd: 1,
    fit: undefined,
  };

  let t = 0;
  let playing = true;

  function setSpin(k, { keepTime = true } = {}) {
    const d = state.data;
    state.k = k;
    state.a = d.spins[k];
    state.wave = waveform(d, k);
    state.orbit = infall(state.a);
    state.rsLR = rstar(lightRing(state.a), state.a);
    state.rs0 = rstar(R_START, state.a);
    state.fit = undefined;

    const oldStart = state.tStart;
    state.tStart = state.orbit.timeAt(R_START);
    setTimeRange();

    if (keepTime) {
      t = Math.min(Math.max(t, state.tStart), state.tEnd);
    } else {
      t = state.tStart;
    }

    if (!Number.isFinite(oldStart)) {
      t = state.tStart;
    }

    const rOut = Math.max(params.sObs, state.rs0) + 25;

    if (Math.abs(rOut - rOutSheet) > 1e-6) {
      buildSheet(rOut);
    }

    setMarkers();
    setSpinVector(state.a);
    labels.bh.textContent = state.a > 0 ? `Kerr black hole · a = ${state.a.toFixed(1)} M` : "Schwarzschild black hole";

    if (spectrum) {
      spectrum.setSpin(k);
    }

    if (plane) {
      plane.setSpin(k);
    }

    traceDirty = true;
  }

  function setTimeRange() {
    state.tEnd = params.sObs + state.wave.uPeak + T_AFTER;
  }

  // ---------- Per-frame update of the sheet ----------

  const compress = (v) =>
    params.log ? Math.asinh(v / EPS) / Math.asinh(1 / EPS) : Math.max(-1.25, Math.min(1.25, v));

  let particleR = 0;

  function updateScene() {
    if (!state.wave || !sheet) {
      return;
    }

    const { wave, orbit } = state;
    const p = orbit.at(t);
    particleR = p.r;

    // Outgoing radiation lives outside the particle; once the particle is
    // inside the light ring it is emitted from there.
    const cut = Math.max(p.rStar, state.rsLR - 3);
    const n = rStarRing.length;
    const inv = 1 / wave.peak;

    for (let i = 0; i < n; i += 1) {
      const rs = rStarRing[i];
      const w = taper[i] * smoothstep(cut, cut + FADE, rs);
      const c = w > 0 ? compress(wave.at(t - rs) * inv) * w : 0;
      ringData[4 * i] = HEIGHT * c;
      ringData[4 * i + 2] = c;
    }

    for (let i = 0; i < n; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      ringData[4 * i + 1] = (ringData[4 * b] - ringData[4 * a]) / (rhoRing[b] - rhoRing[a]);
    }

    ringTex.needsUpdate = true;

    // Particle: on the axis, where the sheet stays flat.
    const visible = p.rStar > R_IN + 0.6;
    particle.visible = visible;

    if (visible) {
      particle.position.set(rhoOf(p.rStar), 1.35, 0);
    }

    // Observer: on the sheet, in the equatorial direction (sin^2 theta = 1).
    const x = (params.sObs - R_IN) / DR;
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(x)));
    const u = x - i0;
    const y = (1 - u) * ringData[4 * i0] + u * ringData[4 * (i0 + 1)];
    const rhoObs = rhoOf(params.sObs);
    const ox = rhoObs * Math.cos(OBS_PHI);
    const oz = rhoObs * Math.sin(OBS_PHI);
    observer.position.set(ox, y + 1.7, oz);

    const stem = obsStem.geometry.getAttribute("position");
    stem.setXYZ(0, ox, 0.05, oz);
    stem.setXYZ(1, ox, y, oz);
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
    if (!state.wave) {
      Object.values(labels).forEach((el) => (el.hidden = true));
      return;
    }

    placeLabel(labels.bh, labelPoint.set(0, R_BH + 1.5, 0), -6);

    const az = Math.atan2(camera.position.z, camera.position.x);
    const rl = rhoOf(state.rsLR);
    const al = az + 1.1;

    if (stage.clientWidth < 640) {
      labels.ring.hidden = true;
    } else {
      placeLabel(labels.ring, labelPoint.set(rl * Math.cos(al), 0, rl * Math.sin(al)), -4);
    }

    if (particle.visible) {
      placeLabel(labels.particle, labelPoint.copy(particle.position).setY(particle.position.y + 1.6), -6);
    } else {
      labels.particle.hidden = true;
    }

    placeLabel(labels.obs, labelPoint.copy(observer.position).setY(observer.position.y + 2), -6);
  }

  // ---------- 2D panels ----------

  const spectrumEl = document.querySelector("[data-sn-spectrum]");
  const planeEl = document.querySelector("[data-sn-qnm]");
  const spectrum = spectrumEl ? createSpectrum(spectrumEl) : null;
  const plane = planeEl
    ? createQnmPlane(planeEl, {
        onPick: (k) => {
          params.spin = SPINS[k];
          root.querySelector('[data-param="spin"]').value = String(params.spin);
          showOutputs();

          if (state.data) {
            setSpin(k);
          }
        },
      })
    : null;

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
  const LOG_DECADES = 6;
  const TRACE_INK = "#0b1220";
  const TRACE_MUTED = "#8a93a1";
  const TRACE_GRID = "rgba(11,18,32,0.07)";
  const QNM_COLOR = "#2a78d6";
  const TRACE_STEP = 0.25;

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

  const plotWidth = () => Math.max(1, traceW - PAD_L - PAD_R);
  const traceX = (time) => PAD_L + ((time - state.tStart) / (state.tEnd - state.tStart)) * plotWidth();
  const signalAt = (time) => state.wave.at(time - params.sObs);

  const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  const powerOfTen = (e) => `10${String(e).split("").map((c) => SUPERSCRIPT[c]).join("")}`;

  function niceStep(span, target) {
    const raw = span / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  function setupScale() {
    const top = PAD_T;
    const bottom = traceH - PAD_B;
    const peak = state.wave ? state.wave.peak : 1;

    if (traceScale === "log") {
      const hi = Math.ceil(Math.log10(peak * 1.2));
      const lo = hi - LOG_DECADES;
      traceY = (v) => {
        const e = Math.log10(Math.max(Math.abs(v), 1e-300));
        const u = (Math.min(hi, Math.max(lo, e)) - lo) / (hi - lo);
        return bottom - u * (bottom - top);
      };

      const ticks = [];

      for (let e = hi; e >= lo; e -= 2) {
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

  // One fit per spin: modes n = 0..3 at the Kerr frequencies plus a tail of
  // real exponentials (see fitRingdown), from 5 M after the peak. The "n = 0"
  // view shows the tail plus the fundamental mode of that fit.
  let qnmMode = 0; // -1: off, otherwise highest overtone shown
  const FIT = { nMax: 3, tauA: 5, tauB: T_AFTER };
  // Without the overtones the curve is off until they have decayed.
  const DRAW_FROM = { 0: 25, 3: FIT.tauA };
  const TAIL_RATES = [0.005, 0.015, 0.04, 0.1, 0.25];
  const TAIL_COLOR = "#8a93a1";

  function ringdownFit() {
    if (qnmMode < 0 || !state.wave) {
      return null;
    }

    if (state.fit === undefined) {
      const omegas = OMEGA.slice(0, FIT.nMax + 1).map((row) => row[state.k]);
      state.fit = fitRingdown(state.data, state.k, state.wave, omegas, TAIL_RATES, FIT.tauA, FIT.tauB);
    }

    return state.fit;
  }

  function drawTraceCache() {
    cctx.clearRect(0, 0, traceW, traceH);
    cctx.font = '10px "IBM Plex Mono", monospace';

    const ticks = setupScale();
    const left = PAD_L;
    const right = left + plotWidth();
    const bottom = traceH - PAD_B;

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

    cctx.strokeStyle = "rgba(11,18,32,0.22)";
    cctx.beginPath();
    cctx.moveTo(left, bottom + 0.5);
    cctx.lineTo(right, bottom + 0.5);
    cctx.stroke();

    if (!state.wave) {
      return;
    }

    cctx.textAlign = "center";
    cctx.textBaseline = "top";

    for (let time = Math.ceil(state.tStart / 50) * 50; time <= state.tEnd + 1e-9; time += 50) {
      const x = traceX(time);
      cctx.strokeStyle = TRACE_GRID;
      cctx.beginPath();
      cctx.moveTo(x, PAD_T);
      cctx.lineTo(x, bottom);
      cctx.stroke();

      if (x < right - 44) {
        cctx.fillStyle = TRACE_MUTED;
        cctx.fillText(String(time).replace("-", "−"), x, bottom + 5);
      }
    }

    cctx.textAlign = "right";
    cctx.fillText("t / M", right, bottom + 5);

    cctx.save();
    cctx.beginPath();
    cctx.rect(left, PAD_T - 1, right - left, bottom - PAD_T + 2);
    cctx.clip();

    cctx.strokeStyle = TRACE_INK;
    cctx.lineWidth = 1.3;
    cctx.lineJoin = "round";
    cctx.beginPath();

    for (let time = state.tStart, first = true; time <= state.tEnd + 1e-9; time += TRACE_STEP) {
      const x = traceX(time);
      const y = traceY(signalAt(time));

      if (first) {
        cctx.moveTo(x, y);
        first = false;
      } else {
        cctx.lineTo(x, y);
      }
    }

    cctx.stroke();

    const fit = ringdownFit();

    if (fit) {
      const tPeak = params.sObs + state.wave.uPeak;
      const fitCurve = (fn, color, width, dash, tauStart) => {
        cctx.strokeStyle = color;
        cctx.lineWidth = width;
        cctx.setLineDash(dash);
        cctx.beginPath();

        for (let time = tPeak + tauStart, first = true; time <= state.tEnd + 1e-9; time += TRACE_STEP) {
          const x = traceX(time);
          const y = traceY(fn(time - tPeak));

          if (first) {
            cctx.moveTo(x, y);
            first = false;
          } else {
            cctx.lineTo(x, y);
          }
        }

        cctx.stroke();
        cctx.setLineDash([]);
      };

      fitCurve(fit.tail, TAIL_COLOR, 1.4, [2, 3], FIT.tauA);
      fitCurve((tau) => fit.upTo(qnmMode, tau), QNM_COLOR, 1.6, [5, 4], DRAW_FROM[qnmMode]);
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

    if (!state.wave) {
      return;
    }

    const bottom = traceH - PAD_B;
    const x = traceX(t);
    tctx.strokeStyle = "#f2762e";
    tctx.lineWidth = 1.5;
    tctx.beginPath();
    tctx.moveTo(x, PAD_T);
    tctx.lineTo(x, bottom);
    tctx.stroke();

    tctx.fillStyle = "#f2762e";
    tctx.beginPath();
    tctx.arc(x, traceY(signalAt(t)), 3.2, 0, 2 * Math.PI);
    tctx.fill();
  }

  function seekFromTrace(event) {
    if (!state.wave) {
      return;
    }

    const rect = traceCanvas.getBoundingClientRect();
    const frac = (event.clientX - rect.left - PAD_L) / plotWidth();
    t = state.tStart + Math.max(0, Math.min(1, frac)) * (state.tEnd - state.tStart);
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
    const reach = rhoOf(Math.max(params.sObs, rstar(R_START, 0))) + 10;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const fit = Math.min(hfov, vfov * 1.6);
    const portrait = camera.aspect < 1;
    const dist = (reach / Math.tan(fit / 2)) * (portrait ? 0.95 : 0.9);
    const dir = portrait
      ? new THREE.Vector3(0.15, 0.95, 1).normalize()
      : new THREE.Vector3(0.12, 0.62, 1).normalize();

    controls.target.set(reach * 0.08, 0, -reach * 0.12);
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

  const spinIndex = (a) => Math.max(0, Math.min(SPINS.length - 1, Math.round(a * 10)));

  root.querySelectorAll('input[type="range"][data-param]').forEach((input) => {
    const key = input.dataset.param;

    input.addEventListener("input", () => {
      params[key] = Number(input.value);
      showOutputs();

      if (!state.data) {
        return;
      }

      if (key === "spin") {
        setSpin(spinIndex(params.spin));
      } else if (key === "sObs") {
        setTimeRange();
        t = Math.min(t, state.tEnd);
        const rOut = Math.max(params.sObs, state.rs0) + 25;

        if (Math.abs(rOut - rOutSheet) > 1e-6) {
          buildSheet(rOut);
        }

        traceDirty = true;
      }
    });
  });

  root.querySelector('input[type="checkbox"][data-param="log"]').addEventListener("change", (event) => {
    params.log = event.target.checked;
  });

  root.querySelectorAll("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      traceScale = btn.dataset.scale;
      root.querySelectorAll("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      traceDirty = true;
    });
  });

  const qnmKey = root.querySelector("[data-qnm-key]");
  const tailKey = root.querySelector("[data-tail-key]");

  root.querySelectorAll("[data-qnm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qnmMode = Number(btn.dataset.qnm);
      root.querySelectorAll("[data-qnm]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));

      if (qnmKey) {
        qnmKey.hidden = qnmMode < 0;
        qnmKey.lastChild.textContent = qnmMode === 0 ? "fit, n = 0 + tail" : "fit, n ≤ 3 + tail";
      }

      if (tailKey) {
        tailKey.hidden = qnmMode < 0;
      }

      traceDirty = true;
    });
  });

  playBtn.addEventListener("click", () => {
    if (!playing && t >= state.tEnd - 1e-6) {
      t = state.tStart;
    }

    playing = !playing;
    updatePlayButton();
  });

  root.querySelector('[data-action="restart"]').addEventListener("click", () => {
    t = state.tStart;
    playing = true;
    updatePlayButton();
  });

  root.querySelector('[data-action="view"]').addEventListener("click", resetView);

  // ---------- Loop ----------

  let last = performance.now();

  function frame(now) {
    const dtReal = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state.wave) {
      if (playing && !seeking) {
        t = Math.min(t + params.speed * dtReal, state.tEnd);

        if (t >= state.tEnd - 1e-9) {
          t = state.tEnd;
          playing = false;
          updatePlayButton();
        }
      }

      timeEl.textContent = `t = ${t.toFixed(1).replace("-", "−")} M`;
      const where =
        particleR > state.orbit.rp + 1e-3 && particle.visible
          ? `particle at r = ${particleR.toFixed(particleR < 10 ? 2 : 1)} M`
          : "particle at the horizon";
      statusEl.textContent = `${where} · r₊ = ${state.orbit.rp.toFixed(3)} M · light ring r = ${lightRing(state.a).toFixed(2)} M`;
    }

    updateScene();
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
    drawTrace();
    requestAnimationFrame(frame);
  }

  state.tStart = NaN;
  statusEl.textContent = "Loading the waveforms…";

  loadWaveforms(new URL("./sn-gsn.json", import.meta.url))
    .then((data) => {
      state.data = data;

      if (spectrum) {
        spectrum.setData(data);
      }

      setSpin(spinIndex(params.spin), { keepTime: false });
      updatePlayButton();
    })
    .catch((err) => {
      statusEl.textContent = `Could not load the waveforms: ${err.message}`;
    });

  requestAnimationFrame(frame);
}
