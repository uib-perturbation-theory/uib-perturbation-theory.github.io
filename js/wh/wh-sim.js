/* Wormhole simulator: 3D view, observer traces and controls.

   The time-domain solver and the transmission run in wh-worker.js. The 3D
   surface is a slice through the wormhole that contains the symmetry axis
   of the multipole: universe 1 is the upper sheet, universe 2 the lower
   one, and they meet at the throat ring. Distance along the surface, away
   from the throat, is the tortoise coordinate |x|, and the slope of the
   surface follows the Flamm paraboloid of each Schwarzschild exterior,
   dz/dr = sqrt(2M/(r - 2M)), so the long cavity of a throat close to r = 2M
   appears as a long tube. The wave pushes the surface along its normal by
   H f(psi) P_l(cos theta). */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeWormhole, powerLabel, SPIN_NAMES } from "./wh-model.js";
import { createPotential, createTransmission } from "./wh-panels.js";

const root = document.querySelector("[data-wh]");

if (root) {
  init();
}

function init() {
  // ---------- Constants ----------

  const HEIGHT = 6.5; // displacement for |psi| = 1
  const EPS = 0.02; // scale of the asinh compression
  const SEGMENTS = 192; // angular resolution of a full turn
  const CUT = 0.25; // fraction of the turn removed by the cutaway

  const COLORS = {
    pos: new THREE.Color("#f2762e"),
    neg: new THREE.Color("#3e7cb1"),
    zero1: new THREE.Color("#efebe3"),
    zero2: new THREE.Color("#e4e8ee"),
    mark: new THREE.Color("#0b1220"),
    pulse: new THREE.Color("#d8611c"),
  };

  // ---------- DOM ----------

  const stage = root.querySelector(".rw-stage");
  const canvas = stage.querySelector(".rw-canvas");
  const timeEl = stage.querySelector(".rw-time");
  const statusEl = stage.querySelector(".rw-status");
  const labels = Object.fromEntries(
    [...stage.querySelectorAll("[data-label]")].map((el) => [el.dataset.label, el])
  );
  const traceCanvas = root.querySelector(".rw-trace canvas");
  const energyEl = root.querySelector("[data-energy]");
  const playBtn = root.querySelector('[data-action="play"]');
  const outputs = Object.fromEntries(
    [...root.querySelectorAll("[data-out]")].map((el) => [el.dataset.out, el])
  );
  const cavityNote = root.querySelector("[data-cavity-note]");

  const params = {
    logDelta: -4,
    s: 2,
    l: 2,
    sigma: 8,
    nu: 0.3,
    x0: 70,
    xObs: 100,
    speed: 20,
    log: true,
    cut: true,
  };

  root.querySelectorAll("[data-param]").forEach((input) => {
    const key = input.dataset.param;
    params[key] = input.type === "checkbox" ? input.checked : Number(input.value);
  });

  const delta = () => 10 ** params.logDelta;

  const formatters = {
    logDelta: (v) => `${powerLabel(v)} · a = ${(2 * (1 + 10 ** v)).toPrecision(v < -3 ? 8 : 4)} M`,
    sigma: (v) => `${v.toFixed(1)} M`,
    nu: (v) => `${v.toFixed(2)} / M`,
    x0: (v) => `${v.toFixed(0)} M`,
    xObs: (v) => `±${v.toFixed(0)} M`,
    speed: (v) => `${v.toFixed(0)} M/s`,
  };

  const showOutputs = () => {
    Object.entries(formatters).forEach(([key, fmt]) => {
      if (outputs[key]) {
        outputs[key].textContent = fmt(params[key]);
      }
    });

    if (outputs.l) {
      outputs.l.textContent = `ℓ = ${params.l}`;
    }

    if (cavityNote) {
      const wh = makeWormhole(params.s, params.l, delta());
      cavityNote.textContent =
        wh.d > 0
          ? `Potential peaks at x = ±${wh.d.toFixed(1)} M: a cavity of length ${(2 * wh.d).toFixed(1)} M.`
          : `The throat is outside the potential peak (a > ${wh.rPeak.toFixed(2)} M): no cavity.`;
    }
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
  controls.maxDistance = 1400;
  controls.maxPolarAngle = Math.PI; // free to look from below
  controls.rotateSpeed = 0.7;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.2));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(-90, 170, 120);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffeedd, 0.55);
  fillLight.position.set(140, 60, -110);
  scene.add(fillLight);

  const underLight = new THREE.DirectionalLight(0xffffff, 1.3);
  underLight.position.set(70, -170, -100);
  scene.add(underLight);

  // ---------- Surface ----------

  const uniforms = {
    uRing: { value: null },
    uPos: { value: COLORS.pos },
    uNeg: { value: COLORS.neg },
    uZero1: { value: COLORS.zero1 },
    uZero2: { value: COLORS.zero2 },
    uMark: { value: COLORS.mark },
    uPulse: { value: COLORS.pulse },
    uPeak: { value: 0 }, // x of the potential peaks (0: none)
    uX0: { value: 70 },
  };

  const sheetMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
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
        attribute float aX;
        attribute float aArc;
        attribute float aG;
        attribute float aGp;
        attribute float aRho;
        attribute vec3 aN;
        attribute vec3 aT;
        attribute vec3 aB;
        varying float vVal;
        varying float vX;
        varying float vArc;`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec4 ringData = texelFetch(uRing, ivec2(int(aRing + 0.5), 0), 0);
        vec3 objectNormal = normalize(aN - ringData.y * aG * aT - ringData.x * aGp / max(aRho, 1e-3) * aB);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = position + ringData.x * aG * aN;
        #ifdef USE_ALPHAHASH
          vPosition = vec3(position);
        #endif
        vVal = ringData.z * aG;
        vX = aX;
        vArc = aArc;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uPos;
        uniform vec3 uNeg;
        uniform vec3 uZero1;
        uniform vec3 uZero2;
        uniform vec3 uMark;
        uniform vec3 uPulse;
        uniform float uPeak;
        uniform float uX0;
        varying float vVal;
        varying float vX;
        varying float vArc;

        // 1 on a line |x - c| < width (in pixels), antialiased
        float lineAt(float x, float c, float px) {
          float w = fwidth(x) * px;
          return 1.0 - smoothstep(0.5 * w, w, abs(x - c));
        }`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float vv = clamp(vVal, -1.0, 1.0);
        vec3 zero = vX >= 0.0 ? uZero1 : uZero2;
        vec3 sheetCol = vv >= 0.0
          ? mix(zero, uPos, pow(vv, 0.7))
          : mix(zero, uNeg, pow(-vv, 0.7));
        float gridDist = abs(fract(vX / 25.0 + 0.5) - 0.5) * 25.0;
        float gridLine = 1.0 - smoothstep(0.0, fwidth(vX) * 1.2, gridDist);
        sheetCol *= 1.0 - 0.12 * gridLine;
        float dash = step(0.5, fract(vArc / 3.0));
        if (uPeak > 0.0) {
          float pk = max(lineAt(vX, uPeak, 2.4), lineAt(vX, -uPeak, 2.4));
          sheetCol = mix(sheetCol, uMark, 0.55 * pk * dash);
        }
        float pl = lineAt(vX, uX0, 2.6) * step(0.45, fract(vArc / 5.0));
        sheetCol = mix(sheetCol, uPulse, 0.85 * pl);
        sheetCol = mix(sheetCol, uMark, 0.85 * lineAt(vX, 0.0, 3.2));
        diffuseColor.rgb *= sheetCol;`
      );
  };

  let sheet = null;
  let ringTex = null;
  let ringData = null; // Float32Array(nRing * 4): D, dD/dx, value, 0
  let taper = null;
  let profile = null; // meridian of the current geometry

  /* Meridian of the surface, s = |x| from 0 to sMax: radius rho(s) and
     height z(s) with rho' = cos(alpha), z' = sin(alpha) and
     tan(alpha) = sqrt(2 / (r - 2)) = 1 / sqrt(W), as for the Flamm
     paraboloid. */
  function meridian(wh, sMax, ds) {
    const n = Math.round(sMax / ds) + 1;
    const rho = new Float64Array(n);
    const z = new Float64Array(n);
    const ca = new Float64Array(n);
    const sa = new Float64Array(n);
    const rT = 6 * wh.a; // drawn radius of the throat
    const angle = (s) => {
      const w = wh.W(s);
      return [Math.sqrt(w / (1 + w)), 1 / Math.sqrt(1 + w)];
    };
    const SUB = 4;
    let r = rT;
    let y = 0;

    for (let k = 0; k < n; k += 1) {
      const [c, sn] = angle(k * ds);
      rho[k] = r;
      z[k] = y;
      ca[k] = c;
      sa[k] = sn;

      for (let j = 0; j < SUB; j += 1) {
        const [cm, sm] = angle((k + (j + 0.5) / SUB) * ds);
        r += (cm * ds) / SUB;
        y += (sm * ds) / SUB;
      }
    }

    return { rho, z, ca, sa, ds, rT };
  }

  // Position, normal and tangent of the undisplaced surface at x, phi.
  function surfacePoint(x, phi, out) {
    const k = Math.min(profile.rho.length - 1, Math.round(Math.abs(x) / profile.ds));
    const sg = x >= 0 ? 1 : -1;
    const rho = profile.rho[k];
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    out.p.set(rho * c, sg * profile.z[k], rho * s);
    out.n.set(-profile.sa[k] * c, sg * profile.ca[k], -profile.sa[k] * s);
    return out;
  }

  function buildSheet(xs, xDisp, wh) {
    if (sheet) {
      scene.remove(sheet);
      sheet.geometry.dispose();
    }

    if (ringTex) {
      ringTex.dispose();
    }

    const nRing = xs.length;
    const ds = Math.abs(xs[1] - xs[0]);
    profile = meridian(wh, xDisp + ds, ds);

    // The cutaway leaves out the wedge -pi/2 < phi < 0 (facing the default
    // camera); the axis theta = 0 (phi = 0) is one of its edges.
    const span = 2 * Math.PI * (params.cut ? 1 - CUT : 1);
    const segs = Math.round(SEGMENTS * (params.cut ? 1 - CUT : 1));
    const nCol = segs + 1;
    const nv = nRing * nCol;

    const position = new Float32Array(nv * 3);
    const aN = new Float32Array(nv * 3);
    const aT = new Float32Array(nv * 3);
    const aB = new Float32Array(nv * 3);
    const aRing = new Float32Array(nv);
    const aX = new Float32Array(nv);
    const aArc = new Float32Array(nv);
    const aRho = new Float32Array(nv);

    taper = new Float32Array(nRing);

    for (let i = 0; i < nRing; i += 1) {
      const x = xs[i];
      const ax = Math.abs(x);
      const k = Math.min(profile.rho.length - 1, Math.round(ax / ds));
      const sg = x >= 0 ? 1 : -1;
      const rho = profile.rho[k];
      const z = sg * profile.z[k];
      const ca = profile.ca[k];
      const sa = profile.sa[k];
      taper[i] = 1 - smoothstep(xDisp - 14, xDisp, ax);

      for (let j = 0; j < nCol; j += 1) {
        const phi = phiOf(j, segs, span);
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        const v = i * nCol + j;
        position[3 * v] = rho * c;
        position[3 * v + 1] = z;
        position[3 * v + 2] = rho * s;
        // normal: "up and inwards" on universe 1, mirrored on universe 2
        aN[3 * v] = -sa * c;
        aN[3 * v + 1] = sg * ca;
        aN[3 * v + 2] = -sa * s;
        // unit tangent along increasing x
        aT[3 * v] = ca * c * sg;
        aT[3 * v + 1] = sa;
        aT[3 * v + 2] = ca * s * sg;
        aB[3 * v] = -s;
        aB[3 * v + 1] = 0;
        aB[3 * v + 2] = c;
        aRing[v] = i;
        aX[v] = x;
        aArc[v] = rho * phi;
        aRho[v] = rho;
      }
    }

    const index = new Uint32Array((nRing - 1) * segs * 6);
    let q = 0;

    for (let i = 0; i < nRing - 1; i += 1) {
      for (let j = 0; j < segs; j += 1) {
        const a = i * nCol + j;
        const b = (i + 1) * nCol + j;
        const c = (i + 1) * nCol + j + 1;
        const d = i * nCol + j + 1;
        index[q++] = a;
        index[q++] = b;
        index[q++] = d;
        index[q++] = b;
        index[q++] = c;
        index[q++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("aN", new THREE.BufferAttribute(aN, 3));
    geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 3));
    geometry.setAttribute("aB", new THREE.BufferAttribute(aB, 3));
    geometry.setAttribute("aRing", new THREE.BufferAttribute(aRing, 1));
    geometry.setAttribute("aX", new THREE.BufferAttribute(aX, 1));
    geometry.setAttribute("aArc", new THREE.BufferAttribute(aArc, 1));
    geometry.setAttribute("aRho", new THREE.BufferAttribute(aRho, 1));
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

    sheet = new THREE.Mesh(geometry, sheetMat);
    sheet.frustumCulled = false;
    scene.add(sheet);
    sheet.userData = { nRing, nCol, segs, span };
    setAngular(params.l);
  }

  // Azimuth of column j
  const phiOf = (j, segs, span) => (span * j) / segs;

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
    const dP = d > 1e-9 ? (l * (p0 - x * p1)) / d : 0.5 * l * (l + 1) * (x > 0 ? 1 : l % 2 ? 1 : -1);
    return [p1, dP];
  }

  function setAngular(l) {
    if (!sheet) {
      return;
    }

    const { nRing, nCol, segs, span } = sheet.userData;
    const G = new Float32Array(nCol);
    const Gp = new Float32Array(nCol);

    for (let j = 0; j < nCol; j += 1) {
      const phi = phiOf(j, segs, span);
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

  // ---------- Observers ----------

  const observerMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.35 });
  const makeObserver = () => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 24), observerMat);
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.4 })
    );
    scene.add(ball, stem);
    return { ball, stem };
  };
  const obsA = makeObserver();
  const obsB = makeObserver();

  // ---------- Simulation state ----------

  let worker = null;
  let sim = null;
  let pending = null;
  let t = 0;
  let playing = true;
  let keepTimeOnSwap = false;

  function startSim({ keepTime = false } = {}) {
    if (worker) {
      worker.terminate();
    }

    worker = new Worker(new URL("./wh-worker.js", import.meta.url), { type: "module" });
    pending = null;
    keepTimeOnSwap = keepTime;

    const startedAt = performance.now();
    const request = {
      type: "run",
      s: params.s,
      l: params.l,
      delta: delta(),
      sigma: params.sigma,
      nu: params.nu,
      x0: params.x0,
      xObs: params.xObs,
    };

    worker.onmessage = (event) => {
      const msg = event.data;

      if (msg.type === "meta") {
        pending = {
          ...msg,
          request,
          wh: makeWormhole(msg.s, msg.l, msg.delta),
          nDisp: msg.xs.length,
          frames: new Float32Array(msg.nFrames * msg.xs.length),
          framesReady: 0,
          a: new Float32Array(msg.nSteps + 1),
          b: new Float32Array(msg.nSteps + 1),
          ea: new Float32Array(msg.nSteps + 1),
          eb: new Float32Array(msg.nSteps + 1),
          obsReady: 0,
          done: false,
          startedAt,
        };
        return;
      }

      const target = pending;

      if (!target) {
        if (msg.type === "error") {
          statusEl.textContent = `Solver error: ${msg.message}`;
        }
        return;
      }

      if (msg.type === "frames") {
        target.frames.set(msg.data, msg.start * target.nDisp);
        target.framesReady = msg.start + msg.count;
      } else if (msg.type === "obs") {
        target.a.set(msg.a, msg.start);
        target.b.set(msg.b, msg.start);
        target.ea.set(msg.ea, msg.start);
        target.eb.set(msg.eb, msg.start);
        target.obsReady = msg.start + msg.count;
        traceDirty = true;
      } else if (msg.type === "done") {
        target.done = true;
        target.elapsed = (performance.now() - startedAt) / 1000;
      } else if (msg.type === "error") {
        statusEl.textContent = `Solver error: ${msg.message}`;
      }

      maybeSwap();
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

    const reframe = !sim || sim.xDisp !== pending.xDisp || sim.delta !== pending.delta;
    sim = pending;
    uniforms.uPeak.value = sim.wh.d > 0 ? sim.wh.d : 0;
    uniforms.uX0.value = sim.x0;
    buildSheet(sim.xs, sim.xDisp, sim.wh);

    if (keepTimeOnSwap) {
      t = Math.min(t, sim.tEnd);
    } else {
      t = 0;
      playing = true;
    }

    if (reframe && !userMoved) {
      resetView();
    }

    updatePlayButton();
    traceDirty = true;
    syncPotential();
  }

  // ---------- Per-frame update ----------

  const smoothstep = (a, b, x) => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  const compress = (psi) =>
    params.log ? Math.asinh(psi / EPS) / Math.asinh(1 / EPS) : Math.max(-1.25, Math.min(1.25, psi));

  const pt = { p: new THREE.Vector3(), n: new THREE.Vector3() };

  function placeObserver(obs, x) {
    const n = sim.nDisp;
    const u = (x - sim.xs[0]) / (sim.xs[1] - sim.xs[0]);
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(u)));
    const w = u - i0;
    const D = (1 - w) * ringData[4 * i0] + w * ringData[4 * (i0 + 1)];
    surfacePoint(x, 0, pt);
    // P_l(cos 0) = 1 on the axis
    obs.ball.position.copy(pt.p).addScaledVector(pt.n, D + 1.8 * Math.sign(D || 1));
    const stem = obs.stem.geometry.getAttribute("position");
    stem.setXYZ(0, pt.p.x, pt.p.y, pt.p.z);
    stem.setXYZ(1, obs.ball.position.x, obs.ball.position.y, obs.ball.position.z);
    stem.needsUpdate = true;
  }

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
      const psi = (1 - w) * F[o0 + i] + w * F[o1 + i];
      const c = compress(psi) * taper[i];
      ringData[4 * i] = HEIGHT * c;
      ringData[4 * i + 2] = c;
    }

    const dxs = sim.xs[1] - sim.xs[0];

    for (let i = 0; i < n; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      ringData[4 * i + 1] = (ringData[4 * b] - ringData[4 * a]) / ((b - a) * dxs);
    }

    ringTex.needsUpdate = true;
    placeObserver(obsA, sim.xObs);
    placeObserver(obsB, -sim.xObs);
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

  // Angle on the drawn part of the surface closest to phi.
  function onSheet(phi) {
    if (!params.cut) {
      return phi;
    }

    const span = 2 * Math.PI * (1 - CUT);
    let a = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

    if (a > span) {
      a = a - span < 2 * Math.PI - a ? span : 0;
    }

    return a;
  }

  function updateLabels() {
    if (!sim || !profile) {
      Object.values(labels).forEach((el) => (el.hidden = true));
      return;
    }

    const az = Math.atan2(camera.position.z, camera.position.x);
    const back = az + Math.PI;
    const small = stage.clientWidth < 640;

    surfacePoint(0, onSheet(back), pt);
    placeLabel(labels.throat, labelPoint.copy(pt.p), -6);

    if (sim.wh.d > 0 && !small) {
      surfacePoint(sim.wh.d, onSheet(back - 0.5), pt);
      placeLabel(labels.peak, labelPoint.copy(pt.p), -4);
    } else {
      labels.peak.hidden = true;
    }

    if (small) {
      labels.pulse.hidden = true;
    } else {
      surfacePoint(sim.x0, onSheet(back + 0.45), pt);
      placeLabel(labels.pulse, labelPoint.copy(pt.p), -4);
    }

    const xu = 0.8 * sim.xDisp;
    surfacePoint(xu, onSheet(back - 0.25), pt);
    placeLabel(labels.u1, labelPoint.copy(pt.p), -4);
    surfacePoint(-xu, onSheet(back - 0.25), pt);
    placeLabel(labels.u2, labelPoint.copy(pt.p), 18);

    placeLabel(labels.obsA, labelPoint.copy(obsA.ball.position).setY(obsA.ball.position.y + 2.2), -6);
    placeLabel(labels.obsB, labelPoint.copy(obsB.ball.position).setY(obsB.ball.position.y - 2.2), 22);
  }

  // ---------- 2D panels ----------

  const potEl = document.querySelector("[data-wh-potential]");
  const transEl = document.querySelector("[data-wh-transmission]");
  const potential = potEl ? createPotential(potEl) : null;
  const transmission = transEl ? createTransmission(transEl) : null;

  function syncPotential() {
    if (!potential) {
      return;
    }

    const wh = sim && sim.request.s === params.s && sim.request.l === params.l && sim.request.delta === delta()
      ? sim.wh
      : makeWormhole(params.s, params.l, delta());
    potential.set({
      wh,
      xMax: sim ? sim.xDisp : Math.max(params.x0 + 3 * params.sigma, params.xObs) + 25,
      x0: params.x0,
      xObs: params.xObs,
      nu: params.nu,
    });
  }

  let specWorker = null;
  const specCache = new Map();

  function requestSpectrum() {
    if (!transmission) {
      return;
    }

    const key = `${params.s}/${params.l}/${params.logDelta}`;

    if (specCache.has(key)) {
      transmission.setData(specCache.get(key));
      return;
    }

    if (specWorker) {
      specWorker.terminate();
    }

    transmission.clear("Computing the transmission…");
    specWorker = new Worker(new URL("./wh-worker.js", import.meta.url), { type: "module" });
    specWorker.onmessage = (event) => {
      const msg = event.data;

      if (msg.type === "spectrum") {
        specCache.set(msg.key, msg);

        if (msg.key === `${params.s}/${params.l}/${params.logDelta}`) {
          transmission.setData(msg);
        }
      } else if (msg.type === "error") {
        transmission.clear(`Transmission error: ${msg.message}`);
      }
    };
    specWorker.postMessage({ type: "spectrum", key, s: params.s, l: params.l, delta: delta() });
  }

  function syncPulse() {
    if (transmission) {
      transmission.setPulse({ sigma: params.sigma, nu: params.nu });
    }

    syncPotential();
  }

  // ---------- Observer traces ----------

  const tctx = traceCanvas.getContext("2d");
  const traceCache = document.createElement("canvas");
  const cctx = traceCache.getContext("2d");
  let traceDirty = true;
  let traceScale = "lin";
  let traceW = 0;
  let traceH = 0;

  const PAD_L = 46;
  const PAD_R = 10;
  const PAD_T = 8;
  const PAD_B = 20;
  const GAP = 10;
  const LOG_DECADES = 8;
  const TRACE_INK = "#0b1220";
  const TRACE_B = "#2a78d6";
  const TRACE_MUTED = "#8a93a1";
  const TRACE_GRID = "rgba(11,18,32,0.07)";

  const SUPERSCRIPT = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  const powerOfTen = (e) => `10${String(e).split("").map((c) => SUPERSCRIPT[c]).join("")}`;

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
  const traceX = (time) => PAD_L + (sim ? time / sim.tEnd : 0) * plotWidth();

  // The two rows: A (universe 1) on top, B (universe 2) below.
  const rows = () => {
    const h = (traceH - PAD_T - PAD_B - GAP) / 2;
    return [
      { top: PAD_T, bottom: PAD_T + h, key: "a", color: TRACE_INK, name: "A · universe 1" },
      { top: PAD_T + h + GAP, bottom: PAD_T + 2 * h + GAP, key: "b", color: TRACE_B, name: "B · universe 2" },
    ];
  };

  function niceStep(span, target) {
    const raw = span / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  function rowScale(row) {
    const arr = sim ? sim[row.key] : null;
    let peak = 0;

    if (arr) {
      for (let k = 0; k < sim.obsReady; k += 1) {
        peak = Math.max(peak, Math.abs(arr[k]));
      }
    }

    peak = peak || 1;

    if (traceScale === "log") {
      const hi = Math.ceil(Math.log10(peak * 1.2));
      const lo = hi - LOG_DECADES;
      const y = (v) => {
        const e = Math.log10(Math.max(Math.abs(v), 1e-300));
        const u = (Math.min(hi, Math.max(lo, e)) - lo) / (hi - lo);
        return row.bottom - u * (row.bottom - row.top);
      };
      const ticks = [hi, hi - 4, lo].map((e) => ({ y: y(10 ** e), label: powerOfTen(e) }));
      return { y, ticks };
    }

    const yMax = peak * 1.1;
    const mid = (row.top + row.bottom) / 2;
    const y = (v) => mid - (v / yMax) * ((row.bottom - row.top) / 2);
    const step = niceStep(yMax, 1);
    const ticks = [-step, 0, step]
      .filter((v) => Math.abs(v) <= yMax)
      .map((v) => ({ y: y(v), label: v === 0 ? "0" : String(+v.toPrecision(2)), zero: v === 0 }));
    return { y, ticks };
  }

  let scales = [];

  function drawTraceCache() {
    cctx.clearRect(0, 0, traceW, traceH);
    cctx.font = '10px "IBM Plex Mono", monospace';
    const left = PAD_L;
    const right = left + plotWidth();
    const bottom = traceH - PAD_B;
    scales = rows().map((row) => ({ row, ...rowScale(row) }));

    scales.forEach(({ row, ticks }) => {
      cctx.textAlign = "right";
      cctx.textBaseline = "middle";

      ticks.forEach((tick) => {
        cctx.strokeStyle = tick.zero ? "rgba(11,18,32,0.2)" : TRACE_GRID;
        cctx.beginPath();
        cctx.moveTo(left, tick.y);
        cctx.lineTo(right, tick.y);
        cctx.stroke();
        cctx.fillStyle = TRACE_MUTED;
        cctx.fillText(tick.label, left - 6, tick.y);
      });

      cctx.textAlign = "left";
      cctx.textBaseline = "top";
      cctx.fillStyle = row.color;
      cctx.fillText(row.name, left + 6, row.top + 1);
    });

    cctx.strokeStyle = "rgba(11,18,32,0.22)";
    cctx.beginPath();
    cctx.moveTo(left, bottom + 0.5);
    cctx.lineTo(right, bottom + 0.5);
    cctx.stroke();

    if (!sim) {
      return;
    }

    const tStep = 100;
    cctx.textAlign = "center";
    cctx.textBaseline = "top";

    for (let time = 0; time <= sim.tEnd + 1e-9; time += tStep) {
      const x = traceX(time);
      cctx.strokeStyle = TRACE_GRID;
      cctx.beginPath();
      cctx.moveTo(x, PAD_T);
      cctx.lineTo(x, bottom);
      cctx.stroke();

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

    scales.forEach(({ row, y }) => {
      const arr = sim[row.key];
      cctx.save();
      cctx.beginPath();
      cctx.rect(left, row.top - 1, right - left, row.bottom - row.top + 2);
      cctx.clip();
      cctx.strokeStyle = row.color;
      cctx.lineWidth = 1.2;
      cctx.lineJoin = "round";
      cctx.beginPath();

      // One vertex per pixel column pair is plenty: decimate by min/max.
      const perPx = Math.max(1, Math.floor(sim.obsReady / (2 * plotWidth())));

      for (let k = 0; k < sim.obsReady; k += perPx) {
        let v = arr[k];

        if (perPx > 1) {
          let lo = Infinity;
          let hi = -Infinity;

          for (let q = k; q < Math.min(sim.obsReady, k + perPx); q += 1) {
            lo = Math.min(lo, arr[q]);
            hi = Math.max(hi, arr[q]);
          }

          cctx.lineTo(traceX(k * sim.dt), y(traceScale === "log" ? Math.max(Math.abs(lo), Math.abs(hi)) : lo));
          v = traceScale === "log" ? Math.max(Math.abs(lo), Math.abs(hi)) : hi;
        }

        const px = traceX(k * sim.dt);

        if (k === 0) {
          cctx.moveTo(px, y(v));
        } else {
          cctx.lineTo(px, y(v));
        }
      }

      cctx.stroke();
      cctx.restore();
    });
  }

  function drawTrace() {
    if (traceCache.width === 0 || traceCache.height === 0) {
      return;
    }

    if (traceDirty) {
      drawTraceCache();
      traceDirty = false;
    }

    tctx.clearRect(0, 0, traceW, traceH);
    tctx.drawImage(traceCache, 0, 0, traceW, traceH);

    if (!sim) {
      return;
    }

    const left = PAD_L;
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
      scales.forEach(({ row, y }) => {
        tctx.fillStyle = "#f2762e";
        tctx.beginPath();
        tctx.arc(x, y(sim[row.key][k]), 3, 0, 2 * Math.PI);
        tctx.fill();
      });
    }
  }

  function showEnergy() {
    if (!energyEl) {
      return;
    }

    if (!sim || sim.obsReady === 0) {
      energyEl.textContent = "";
      return;
    }

    const k = Math.min(sim.obsReady - 1, Math.round(t / sim.dt));
    const a = sim.ea[k];
    const b = sim.eb[k];
    const pct = (v) => `${(100 * Math.max(0, v)).toFixed(1)} %`;
    energyEl.textContent = `energy beyond A ${pct(a)} · beyond B ${pct(b)} · between them ${pct(1 - a - b)}`;
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

  let userMoved = false;
  controls.addEventListener("start", () => (userMoved = true));

  function resetView() {
    userMoved = false;
    const wh = sim ? sim.wh : makeWormhole(params.s, params.l, delta());
    const xDisp = sim ? sim.xDisp : Math.max(params.x0 + 3 * params.sigma, params.xObs) + 25;
    const prof = profile && sim ? profile : meridian(wh, xDisp, 0.4);
    const k = prof.rho.length - 1;
    const rhoMax = prof.rho[k];
    const zMax = prof.z[k];
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const portrait = camera.aspect < 1;
    // Fit the width (2 rho) horizontally and the height (2 z) vertically.
    const dW = (rhoMax * 1.05) / Math.tan(hfov / 2);
    const dH = (zMax * 1.25 + 10) / Math.tan(vfov / 2);
    // Perspective: the near rim is much closer than the centre.
    const dist = Math.max(dW, dH) * (portrait ? 1.0 : 1.25);
    // Look into the cutaway (centred on phi = -pi/4) from slightly above.
    const el = portrait ? 0.3 : 0.22;
    const az = -Math.PI / 4;
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));

    controls.target.set(0, 0, 0);
    camera.position.copy(dir.multiplyScalar(dist));
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

      if (key === "sigma" || key === "nu") {
        syncPulse();
      } else if (key === "x0" || key === "xObs" || key === "logDelta") {
        syncPotential();
      }
    });

    input.addEventListener("change", () => {
      if (key === "speed") {
        return;
      }

      if (key === "logDelta") {
        requestSpectrum();
      }

      scheduleRestart({ keepTime: key === "xObs" });
    });
  });

  root.querySelector('input[type="checkbox"][data-param="log"]').addEventListener("change", (event) => {
    params.log = event.target.checked;
  });

  root.querySelector('input[type="checkbox"][data-param="cut"]').addEventListener("change", (event) => {
    params.cut = event.target.checked;

    if (sim) {
      buildSheet(sim.xs, sim.xDisp, sim.wh);
    }
  });

  root.querySelectorAll("[data-scale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      traceScale = btn.dataset.scale;
      root.querySelectorAll("[data-scale]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      traceDirty = true;
    });
  });

  document.querySelectorAll("[data-tscale]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-tscale]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));

      if (transmission) {
        transmission.setScale(btn.dataset.tscale);
      }
    });
  });

  function syncFieldButtons() {
    root.querySelectorAll("[data-s]").forEach((b) =>
      b.setAttribute("aria-pressed", String(Number(b.dataset.s) === params.s))
    );
    root.querySelectorAll("[data-l]").forEach((b) => {
      const l = Number(b.dataset.l);
      b.disabled = l < params.s;
      b.setAttribute("aria-pressed", String(l === params.l));
    });
    showOutputs();
  }

  root.querySelectorAll("[data-s]").forEach((btn) => {
    btn.addEventListener("click", () => {
      params.s = Number(btn.dataset.s);
      params.l = Math.max(params.l, params.s);
      syncFieldButtons();
      syncPotential();
      requestSpectrum();
      scheduleRestart({ keepTime: false });
    });
  });

  root.querySelectorAll("[data-l]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) {
        return;
      }

      params.l = Number(btn.dataset.l);
      syncFieldButtons();
      syncPotential();
      requestSpectrum();
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
          `${SPIN_NAMES[sim.s]}, ℓ = ${sim.l} · δ = ${powerLabel(Math.log10(sim.delta))} · ` +
          `x ∈ [${Math.round(sim.xMin)}, ${Math.round(sim.xMax)}] · ${sim.n.toLocaleString("en")} points · ` +
          `CFL ${sim.cfl} · ${sim.nSteps.toLocaleString("en")} steps · ${sim.elapsed.toFixed(1)} s`;
      }
    }

    updateSheet();
    controls.update();
    renderer.render(scene, camera);
    updateLabels();
    drawTrace();
    showEnergy();
    requestAnimationFrame(frame);
  }

  syncFieldButtons();
  syncPulse();
  requestSpectrum();
  startSim();
  requestAnimationFrame(frame);
}
