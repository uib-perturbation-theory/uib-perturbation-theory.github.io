/* Sasaki–Nakamura simulator: 3D view, observer trace and controls.

   Two trajectories into a Kerr black hole, computed here (sn-orbit.js):
   - "axis": a particle falls from rest at infinity along the symmetry axis.
     The outgoing wave Psi(u), u = t - r*, comes from precomputed generalized
     Sasaki–Nakamura waveforms (sn-gsn.json). The sheet is the meridional
     plane through the black hole (symmetry axis along world x), with height
     H f(Psi(t - r*)) sin^2(theta).
   - "plunge": a particle plunges from the innermost stable circular orbit in
     the equatorial plane. The sheet is the equatorial plane (spin along
     world y), with height H Re[f(h_22(t - r*)) e^{2 i phi}], the strain h_+
     radiated in that plane (sn-plunge.json); f compresses the modulus and
     keeps the phase.
   - "incl": a particle plunges from the innermost stable spherical orbit,
     tilted by iota from the equator. The sheet is again the equatorial plane,
     with height the strain h_+ radiated in that plane, summed over the modes
     l = 2..4 (sn-incl.js, js/sn/incl/); the observer can sit at any angle
     from the spin axis.
   In all three, the sheet shows the outgoing radiation emitted so far, which
   lies outside the particle and outside the light ring. */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SPINS, OMEGA, CURVE, OMEGA22, CURVE22, OMEGA2M, CURVE2M } from "./sn-qnm.js";
import { inclinedPlunge, infall, isco, lightRing, photonOrbit, plunge, rstar, sphericalPhotonOrbit } from "./sn-orbit.js";
import { MODES, equatorialCoeffs, inclWave, interpComplex, loadInclIndex, loadInclOrbit, sYlm } from "./sn-incl.js";
import { createVolume } from "./sn-volume.js";
import { fitRingdown, loadPlunge, loadWaveforms, plungeWave, waveform } from "./sn-data.js";
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
  const T_START_PLUNGE = -200; // the plunge animation starts at t = -200 M
  // Boyer–Lindquist azimuth of the observer in the plunge; the equatorial
  // sheet maps phi to world (cos phi, -sin phi), so the observer sits at the
  // same place as in the on-axis view.
  const PHI_OBS = Math.PI / 2;

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

  const params = { spin: 0, sObs: 60, speed: 20, log: true, mode: "axis", iota: 60, phase: 0, thetaObs: 60, view: "sheet" };

  root.querySelectorAll("[data-param]").forEach((input) => {
    const key = input.dataset.param;
    params[key] = input.type === "checkbox" ? input.checked : Number(input.value);
  });

  const formatters = {
    spin: (v) => `a = ${v.toFixed(1)} M`,
    sObs: (v) => `${v.toFixed(0)} M`,
    speed: (v) => `${v.toFixed(0)} M/s`,
    iota: (v) => `${v.toFixed(0)}°`,
    thetaObs: (v) => `${v.toFixed(0)}°`,
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
  // the camera can go below the sheet, which is drawn on both sides
  controls.maxPolarAngle = Math.PI;
  controls.rotateSpeed = 0.7;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.25));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(-90, 170, 120);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffeedd, 0.55);
  fillLight.position.set(140, 60, -110);
  scene.add(fillLight);

  // lights the underside of the sheet (the faces above do not see it)
  const underLight = new THREE.DirectionalLight(0xffffff, 1.4);
  underLight.position.set(70, -170, -100);
  scene.add(underLight);

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
  spinGroup.add(spinShaft, spinHead);

  const spinLength = (a) => 3 + 14 * a;

  function setSpinVector(a) {
    const len = spinLength(a);
    spinShaft.scale.set(1, len, 1);

    if (params.mode !== "axis") {
      // Rotation axis vertical: the arrow comes out of the top of the hole.
      spinShaft.rotation.set(0, 0, 0);
      spinHead.rotation.set(0, 0, 0);
      spinShaft.position.set(0, R_BH + len / 2, 0);
      spinHead.position.set(0, R_BH + len + 1.2, 0);
    } else {
      spinShaft.rotation.set(0, 0, Math.PI / 2);
      spinHead.rotation.set(0, 0, Math.PI / 2); // cone tip towards -x
      spinShaft.position.set(-R_BH - len / 2, 0.9, 0);
      spinHead.position.set(-R_BH - len - 1.2, 0.9, 0);
    }

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
    uMode: { value: 0 },
    uHeight: { value: HEIGHT },
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
        uniform float uMode;
        uniform float uHeight;
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
        float yV;
        float gx;
        float gz;
        if (uMode < 0.5) {
          // meridional plane: ring = (F, dF/drho, value), angular factor aG
          yV = ringData.x * aG;
          float dyr = ringData.y * aG;
          float dyp = ringData.x * aGp / rhoV;
          gx = dyr * cph - dyp * sph;
          gz = dyr * sph + dyp * cph;
          vVal = ringData.z * aG;
        } else if (uMode < 1.5) {
          // equatorial plane, azimuth phi = atan2(-z, x):
          // ring = (A, B, dA/drho, dB/drho), height A cos 2phi - B sin 2phi
          float c2 = cph * cph - sph * sph;
          float s2 = -2.0 * sph * cph;
          yV = ringData.x * c2 - ringData.y * s2;
          float dyr = ringData.z * c2 - ringData.w * s2;
          float dyp = -2.0 * (ringData.x * s2 + ringData.y * c2) / rhoV;
          gx = dyr * cph + dyp * sph;
          gz = dyr * sph - dyp * cph;
          vVal = yV / uHeight;
        } else {
          // equatorial plane, all m: row m of the ring texture holds
          // (A_m, B_m, dA_m/drho, dB_m/drho), height sum A_m cos m phi - B_m sin m phi
          float cp = cph;
          float sp = -sph;
          float cm = 1.0;
          float sm = 0.0;
          yV = 0.0;
          float dyr = 0.0;
          float dyp = 0.0;
          for (int m = 0; m < 5; m++) {
            vec4 d = texelFetch(uRing, ivec2(int(aRing + 0.5), m), 0);
            float fm = float(m);
            yV += d.x * cm - d.y * sm;
            dyr += d.z * cm - d.w * sm;
            dyp -= fm * (d.x * sm + d.y * cm);
            float cn = cm * cp - sm * sp;
            sm = sm * cp + cm * sp;
            cm = cn;
          }
          dyp /= rhoV;
          gx = dyr * cph + dyp * sph;
          gz = dyr * sph - dyp * cph;
          vVal = yV / uHeight;
        }
        vec3 objectNormal = normalize(vec3(-gx, 1.0, -gz));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3(position.x, yV, position.z);
        #ifdef USE_ALPHAHASH
          vPosition = vec3(position);
        #endif
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
  const N_ROWS = 5; // rows of the ring texture: m = 0..4 in the inclined plunge
  // Float32Array(nRing * 4): on axis F, dF/drho, value, 0; in the plunge
  // A, B, dA/drho, dB/drho (see the vertex shader)
  let ringData = null;
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

    ringData = new Float32Array(nRing * 4 * N_ROWS);
    ringTex = new THREE.DataTexture(ringData, nRing, N_ROWS, THREE.RGBAFormat, THREE.FloatType);
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
  let iscoLine = null;
  let pathLine = null;
  let startRing = null;

  function drop(obj) {
    if (obj) {
      markerGroup.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    }

    return null;
  }

  function replace(obj, next) {
    drop(obj);
    markerGroup.add(next);
    return next;
  }

  // World position on the equatorial sheet of a point at (r*, phi).
  const onSheet = (rStar, phi, y, out = new THREE.Vector3()) => {
    const rho = rhoOf(rStar);
    return out.set(rho * Math.cos(phi), y, -rho * Math.sin(phi));
  };

  // A point of the inclined orbit in the scene (spin along world y).
  const inSpace = (p, out = new THREE.Vector3()) => {
    const rho = rhoOf(p.rStar);
    const st = Math.sin(p.theta);
    return out.set(rho * st * Math.cos(p.phi), rho * Math.cos(p.theta), -rho * st * Math.sin(p.phi));
  };

  function setMarkers() {
    ringLine = replace(ringLine, dashedLine(circlePoints(rhoOf(state.rsLR)), 0x0b1220, 0.45, 0.8, 0.8));

    let start;
    let path;

    if (params.mode === "incl") {
      iscoLine = replace(iscoLine, dashedLine(circlePoints(rhoOf(state.rsIsco)), 0x0b1220, 0.3, 0.4, 1.2));
      path = [];

      for (let time = state.tStart; time <= state.orbit.tMax; time += 0.25) {
        const p = state.orbit.at(time);

        if (p.rStar < R_IN) {
          break;
        }

        path.push(inSpace(p));
      }

      start = inSpace(state.orbit.at(state.tStart));
    } else if (params.mode === "plunge") {
      iscoLine = replace(iscoLine, dashedLine(circlePoints(rhoOf(state.rsIsco)), 0x0b1220, 0.3, 0.4, 1.2));

      // Spiral path of the particle, from its starting point to the hole.
      path = [];

      for (let time = state.tStart; time <= state.orbit.tMax; time += 0.25) {
        const p = state.orbit.at(time);

        if (p.rStar < R_IN) {
          break;
        }

        path.push(onSheet(p.rStar, p.phi, 0.08));
      }

      const p0 = state.orbit.at(state.tStart);
      start = onSheet(p0.rStar, p0.phi, 0.07);
    } else {
      iscoLine = drop(iscoLine);

      // Path of the particle along the axis, from its starting point to the hole.
      path = [new THREE.Vector3(rhoOf(state.rs0), 0.08, 0), new THREE.Vector3(R_BH, 0.08, 0)];
      start = new THREE.Vector3(rhoOf(state.rs0), 0.07, 0);
    }

    pathLine = replace(pathLine, dashedLine(path, 0xd8611c, 0.7, 1.6, 1.2));

    const tick = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.6, 40),
      new THREE.MeshBasicMaterial({ color: 0xd8611c, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    tick.rotation.x = -Math.PI / 2;
    tick.position.copy(start);
    startRing = replace(startRing, tick);
  }

  const particle = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0xd8611c, roughness: 0.35, emissive: 0x4a1a04 })
  );
  scene.add(particle);

  const observerMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.35 });
  const observer = new THREE.Mesh(new THREE.SphereGeometry(1.7, 32, 24), observerMat);
  scene.add(observer);

  const obsStem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.35 })
  );
  scene.add(obsStem);

  // ---------- State ----------

  const state = {
    data: null, // on-axis waveforms
    plungeData: null, // plunge waveforms, loaded on first use
    incl: null, // index of the inclined plunges, loaded on first use
    inclOrbit: null, // modes of the current inclined orbit
    inclKey: "",
    G: null, // equatorial coefficients G_m(u) of the inclined orbit
    envPeak: 1,
    loading: false,
    k: 0,
    a: 0,
    wave: null,
    orbit: null,
    rsLR: 0,
    rsIsco: 0,
    rs0: 0,
    tStart: 0,
    tEnd: 1,
    fit: undefined,
  };

  let t = 0;
  let playing = true;

  // Spins and orbits of the inclined plunge
  function showInclSpins(sp) {
    const el = root.querySelector("[data-incl-spins]");

    if (!el) {
      return;
    }

    const fmt = (a) => String(+a.toFixed(2));
    const uniform = sp.length > 2 && sp.every((s, j) => j === 0 || Math.abs(s - sp[j - 1] - (sp[1] - sp[0])) < 1e-9);
    el.textContent =
      sp.length === 1
        ? `Computed for a = ${fmt(sp[0])}.`
        : uniform
          ? `Computed for a = ${fmt(sp[0])} to ${fmt(sp[sp.length - 1])} in steps of ${fmt(sp[1] - sp[0])}.`
          : `Computed for a = ${sp.slice(0, -1).map(fmt).join(", ")} and ${fmt(sp[sp.length - 1])}.`;
  }

  const inclSpin = (a) => {
    const sp = state.incl.spins;
    return sp.reduce((best, s, j) => (Math.abs(s - a) < Math.abs(sp[best] - a) ? j : best), 0);
  };
  let inclToken = 0;

  async function loadIncl(k, opts) {
    const idx = state.incl;
    const kk = inclSpin(SPINS[k]);
    const i = idx.iotas.indexOf(params.iota);
    const c = params.phase;
    const key = `${kk}/${i}/${c}`;
    const token = ++inclToken;
    state.loading = true;
    statusEl.textContent = "Loading the waveforms…";

    try {
      const orbit = await loadInclOrbit(idx, kk, i, c);
      if (token !== inclToken) return;
      state.inclOrbit = orbit;
      state.inclKey = key;
    } catch (err) {
      statusEl.textContent = `Could not load the waveforms: ${err.message}`;
      return;
    } finally {
      if (token === inclToken) state.loading = false;
    }

    setSpin(k, opts);
  }

  function setSpin(k, { keepTime = true } = {}) {
    if (params.mode === "incl") {
      const key = `${inclSpin(SPINS[k])}/${state.incl.iotas.indexOf(params.iota)}/${params.phase}`;

      if (key !== state.inclKey) {
        loadIncl(k, { keepTime });
        return;
      }
    }

    state.k = k;
    state.a = SPINS[k];
    state.fit = undefined;
    const oldStart = state.tStart;

    if (params.mode === "incl") {
      const orb = state.inclOrbit;
      // equatorial orbits have no polar phase
      root.querySelectorAll("[data-phase]").forEach((b) => (b.disabled = orb.meta.iota % 180 === 0));
      state.wave = inclWave(orb, (params.thetaObs * Math.PI) / 180, PHI_OBS);
      state.G = equatorialCoeffs(orb);
      let env = 0;

      for (let s = 0; s < orb.n; s += 1) {
        let e = 0;
        for (const g of state.G) e += Math.hypot(g[2 * s], g[2 * s + 1]);
        env = Math.max(env, e);
      }

      state.envPeak = env || 1;
      state.orbit = inclinedPlunge(state.a, orb.meta.x, (params.phase * Math.PI) / 2, T_START_PLUNGE - 20);
      // the photon orbit with the inclination of the particle
      state.rsLR = rstar(sphericalPhotonOrbit(state.a, orb.meta.x), state.a);
      state.rsIsco = rstar(state.orbit.rIsso, state.a);
      state.tStart = T_START_PLUNGE;
      state.rs0 = state.orbit.at(state.tStart).rStar;
      state.spectrum = inclSpectrum(state.wave);
      if (spectrum) spectrum.setData(inclSpectrumData());
    } else if (params.mode === "plunge") {
      state.wave = plungeWave(state.plungeData, k, PHI_OBS);
      state.orbit = plunge(state.a, T_START_PLUNGE - 20);
      state.rsLR = rstar(photonOrbit(state.a), state.a);
      state.rsIsco = rstar(isco(state.a).r, state.a);
      state.tStart = T_START_PLUNGE;
      state.rs0 = state.orbit.at(state.tStart).rStar;
    } else {
      state.wave = waveform(state.data, k);
      state.orbit = infall(state.a);
      state.rsLR = rstar(lightRing(state.a), state.a);
      state.rs0 = rstar(R_START, state.a);
      state.tStart = state.orbit.timeAt(R_START);
    }

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

  // ---------- Volume view ----------

  let volume = null;
  let vsrc = null;
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const Z_NEG = new THREE.Vector3(0, 0, -1);

  /* The modes of the current trajectory for the volume view. In the plunges
     the axis is the spin (world y) and phi = atan2(-z, x), as on the sheet;
     along the axis the radiation is Psi(t - r*) sin^2(theta) around the
     line of fall (world x). */
  function volumeSource() {
    const key = params.mode === "incl" ? `incl/${state.inclKey}` : `${params.mode}/${state.k}`;

    if (vsrc && vsrc.key === key) {
      return vsrc;
    }

    let src;

    if (params.mode === "incl") {
      const { modes, u0, du, n } = state.inclOrbit;
      src = {
        modes: MODES.map(([l, m], q) => ({
          l,
          m,
          at: (u, out) => {
            const x = (u - u0) / du;
            if (x < 0 || x > n - 1) {
              out[0] = 0;
              out[1] = 0;
              return out;
            }
            return interpComplex(modes[q], n, x, out);
          },
        })),
        Y: (l, m, th) => sYlm(-2, l, m, th),
        axis: Y_AXIS,
        e1: X_AXIS,
        e2: Z_NEG,
      };
    } else if (params.mode === "plunge") {
      const { wave } = state;
      src = {
        modes: [
          { l: 2, m: 2, at: (u, out) => wave.atC(u, out) },
          {
            l: 2,
            m: -2,
            at: (u, out) => {
              wave.atC(u, out);
              out[1] = -out[1];
              return out;
            },
          },
        ],
        Y: (l, m, th) => sYlm(-2, l, m, th),
        axis: Y_AXIS,
        e1: X_AXIS,
        e2: Z_NEG,
      };
    } else {
      const { wave } = state;
      src = {
        modes: [
          {
            l: 2,
            m: 0,
            at: (u, out) => {
              out[0] = wave.at(u);
              out[1] = 0;
              return out;
            },
          },
        ],
        Y: (l, m, th) => Math.sin(th) ** 2,
        axis: X_AXIS,
        e1: Y_AXIS,
        e2: Z_AXIS,
      };
    }

    src.key = key;
    const us = [];
    for (let u = state.wave.uPeak - 320; u <= state.wave.uPeak + 120; u += 1) us.push(u);
    src.norm = volume.normOf(src, us);
    vsrc = src;
    return src;
  }

  const lightMat = new THREE.MeshStandardMaterial({ color: 0xe9e4da, roughness: 0.4 });

  function setView(view) {
    params.view = view;
    const vol = view === "volume";

    if (vol && !volume) {
      volume = createVolume(THREE, scene);
    }

    if (volume) {
      volume.visible = vol;
    }

    root.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    stage.classList.toggle("is-volume", vol);
    // dark pieces turn light on the dark background of the volume
    observer.material = vol ? lightMat : observerMat;
    spinShaft.material = vol ? lightMat : spinMat;
    spinHead.material = vol ? lightMat : spinMat;
    obsStem.material.color.set(vol ? 0xe9e4da : 0x0b1220);
    // fewer pixels for the ray marching
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, vol ? 1.25 : 2));
    resize();
    resetView();
  }

  // ---------- Per-frame update of the sheet ----------

  const compress = (v) =>
    params.log ? Math.asinh(v / EPS) / Math.asinh(1 / EPS) : Math.max(-1.25, Math.min(1.25, v));

  let particleR = 0;
  const hc = new Float64Array(2);

  function updateScene() {
    if (!state.wave || !sheet) {
      return;
    }

    const { wave, orbit } = state;
    const p = orbit.at(t);
    particleR = p.r;

    // the sheet and its circles are replaced by the cloud in the volume view
    const showSheet = params.view !== "volume";
    sheet.visible = showSheet;
    if (ringLine) ringLine.visible = showSheet;
    if (iscoLine) iscoLine.visible = showSheet;

    // Outgoing radiation lives outside the particle; once the particle is
    // inside the light ring it is emitted from there.
    const cut = Math.max(p.rStar, state.rsLR - 3);
    const n = rStarRing.length;
    const plungeMode = params.mode === "plunge";
    const inclMode = params.mode === "incl";

    if (inclMode) {
      // h_+ on the equatorial plane, sum over m of Re[G_m e^{i m phi}]; the
      // envelope sum_m |G_m| is compressed and the pattern kept.
      const inv = 1 / state.envPeak;
      const { G } = state;
      const { u0, du, n: ns } = state.inclOrbit;
      const gm = new Float64Array(10);

      for (let i = 0; i < n; i += 1) {
        const rs = rStarRing[i];
        const w = taper[i] * smoothstep(cut, cut + FADE, rs);
        let f = 0;

        if (w > 0) {
          const x = (t - rs - u0) / du;
          let env = 0;

          for (let m = 0; m <= 4; m += 1) {
            interpComplex(G[m], ns, x, hc);
            gm[2 * m] = hc[0];
            gm[2 * m + 1] = hc[1];
            env += Math.hypot(hc[0], hc[1]);
          }

          if (env > 0 && x >= 0 && x <= ns - 1) {
            f = (HEIGHT * w * compress(env * inv)) / env;
          }
        }

        for (let m = 0; m <= 4; m += 1) {
          const o = 4 * (m * n + i);
          ringData[o] = f * gm[2 * m];
          ringData[o + 1] = f * gm[2 * m + 1];
        }
      }

      for (let m = 0; m <= 4; m += 1) {
        for (let i = 0; i < n; i += 1) {
          const a = Math.max(0, i - 1);
          const b = Math.min(n - 1, i + 1);
          const drho = rhoRing[b] - rhoRing[a];
          const o = 4 * (m * n + i);
          ringData[o + 2] = (ringData[4 * (m * n + b)] - ringData[4 * (m * n + a)]) / drho;
          ringData[o + 3] = (ringData[4 * (m * n + b) + 1] - ringData[4 * (m * n + a) + 1]) / drho;
        }
      }
    } else if (plungeMode) {
      // Compressed modulus, true phase: A + iB = H w f(|h|/peak) h/|h|.
      const inv = 1 / wave.ampPeak;

      for (let i = 0; i < n; i += 1) {
        const rs = rStarRing[i];
        const w = taper[i] * smoothstep(cut, cut + FADE, rs);
        let A = 0;
        let B = 0;

        if (w > 0) {
          wave.atC(t - rs, hc);
          const m = Math.hypot(hc[0], hc[1]);

          if (m > 0) {
            const f = (HEIGHT * w * compress(m * inv)) / m;
            A = hc[0] * f;
            B = hc[1] * f;
          }
        }

        ringData[4 * i] = A;
        ringData[4 * i + 1] = B;
      }

      for (let i = 0; i < n; i += 1) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const drho = rhoRing[b] - rhoRing[a];
        ringData[4 * i + 2] = (ringData[4 * b] - ringData[4 * a]) / drho;
        ringData[4 * i + 3] = (ringData[4 * b + 1] - ringData[4 * a + 1]) / drho;
      }
    } else {
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
    }

    ringTex.needsUpdate = true;

    if (params.view === "volume") {
      const src = volumeSource();
      const rOut = rOutSheet;
      volume.update(t, src, {
        rho0: R_BH,
        rho1: rhoOf(rOut),
        rStarOf: (rho) => rho - R_BH + R_IN,
        weight: (rs) => (1 - smoothstep(rOut - 14, rOut, rs)) * smoothstep(cut, cut + FADE, rs),
        // linear in h_+, as the eye reads the brightness: with the compression
        // of the sheet the long, steady parts of the signal fill the ball
        log: false,
        eps: EPS,
      });
    }

    // Particle: where the sheet is still flat (on the axis, or inside the
    // radiation in the plunge).
    const visible = p.rStar > R_IN + 0.6;
    particle.visible = visible;

    if (visible) {
      if (inclMode) {
        inSpace(p, particle.position);
      } else if (plungeMode) {
        onSheet(p.rStar, p.phi, 1.35, particle.position);
      } else {
        particle.position.set(rhoOf(p.rStar), 1.35, 0);
      }
    }

    // Observer: on the sheet, in the equatorial direction (sin^2 theta = 1),
    // at the azimuth PHI_OBS in the plunge.
    const x = (params.sObs - R_IN) / DR;
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(x)));
    const u = x - i0;
    const height = (i) =>
      plungeMode
        ? ringData[4 * i] * Math.cos(2 * PHI_OBS) - ringData[4 * i + 1] * Math.sin(2 * PHI_OBS)
        : ringData[4 * i];
    const y = (1 - u) * height(i0) + u * height(i0 + 1);
    const rhoObs = rhoOf(params.sObs);
    const stem = obsStem.geometry.getAttribute("position");

    if (inclMode) {
      // at the angle thetaObs from the spin axis, azimuth PHI_OBS; the stem
      // drops to the equatorial plane
      const th = (params.thetaObs * Math.PI) / 180;
      const ox = rhoObs * Math.sin(th) * Math.cos(OBS_PHI);
      const oz = rhoObs * Math.sin(th) * Math.sin(OBS_PHI);
      const oy = rhoObs * Math.cos(th);
      observer.position.set(ox, oy, oz);
      stem.setXYZ(0, ox, 0.05, oz);
      stem.setXYZ(1, ox, oy, oz);
    } else {
      const ox = rhoObs * Math.cos(OBS_PHI);
      const oz = rhoObs * Math.sin(OBS_PHI);
      observer.position.set(ox, y + 1.7, oz);
      stem.setXYZ(0, ox, 0.05, oz);
      stem.setXYZ(1, ox, y, oz);
    }

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

    const plungeMode = params.mode !== "axis";
    const bhTop = plungeMode && state.a > 0 ? R_BH + spinLength(state.a) + 3 : R_BH + 1.5;
    placeLabel(labels.bh, labelPoint.set(0, bhTop, 0), -6);

    const az = Math.atan2(camera.position.z, camera.position.x);
    const rl = rhoOf(state.rsLR);
    const al = az + 1.1;

    if (stage.clientWidth < 640) {
      labels.ring.hidden = true;
    } else {
      placeLabel(labels.ring, labelPoint.set(rl * Math.cos(al), 0, rl * Math.sin(al)), -4);
    }

    if (labels.isco) {
      if (plungeMode && stage.clientWidth >= 640) {
        const ri = rhoOf(state.rsIsco);
        const ai = az - 1.1;
        placeLabel(labels.isco, labelPoint.set(ri * Math.cos(ai), 0, ri * Math.sin(ai)), -4);
      } else {
        labels.isco.hidden = true;
      }
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
          // the inclined plunge has only some spins: take the nearest
          params.spin = params.mode === "incl" ? state.incl.spins[inclSpin(SPINS[k])] : SPINS[k];
          root.querySelector('[data-param="spin"]').value = String(params.spin);
          showOutputs();

          if (state.data && !state.loading) {
            setSpin(spinIndex(params.spin));
          }
        },
      })
    : null;

  // Twice the orbital frequency of the ISCO, where the spectrum of the
  // plunge peaks.
  const TWO_OMEGA_ISCO = SPINS.map((a) => 2 * isco(a).omega);

  // Spectrum |h~_+(omega)| of the inclined plunge at the observer, from the
  // samples (the start is tapered over 60 M).
  const INCL_DW = 0.004;
  const INCL_NW = 300;

  function inclSpectrum(wave) {
    const { samples, u0, du, n } = wave;
    const out = new Float64Array(INCL_NW);

    for (let j = 0; j < INCL_NW; j += 1) {
      const w = (j + 0.5) * INCL_DW;
      let re = 0;
      let im = 0;

      for (let s = 0; s < n; s += 1) {
        const u = s * du;
        const tap = u < 60 ? Math.sin((0.5 * Math.PI * u) / 60) ** 2 : 1;
        const v = samples[s] * tap * du;
        re += v * Math.cos(w * (u0 + u));
        im += v * Math.sin(w * (u0 + u));
      }

      out[j] = Math.hypot(re, im);
    }

    return out;
  }

  function inclSpectrumData() {
    return {
      w0: 0.5 * INCL_DW,
      dw: INCL_DW,
      nw: INCL_NW,
      values: SPINS.map(() => state.spectrum),
      wMax: 1.2,
      omega: OMEGA2M,
      labels: ["m = 2", "m = 1", "m = 0", "m = −1", "m = −2"],
      family: "ℓ = 2, n = 0",
      noRef: true,
      symbol: "|h̃₊|",
      mark: null,
    };
  }

  function setPanels() {
    if (params.mode === "incl") {
      if (spectrum && state.spectrum) {
        spectrum.setData(inclSpectrumData());
      }

      if (plane) {
        plane.setModes({
          omega: OMEGA2M,
          curve: CURVE2M,
          xRange: [0.24, 0.92],
          yRange: [-0.1, -0.02],
          labels: ["m = 2", "m = 1", "m = 0", "m = −1", "m = −2"],
        });
      }
    } else if (params.mode === "plunge") {
      const d = state.plungeData;

      if (spectrum) {
        spectrum.setData({
          w0: d.w0,
          dw: d.dw,
          nw: d.nw,
          values: d.absH,
          wMax: 1.0,
          omega: OMEGA22,
          symbol: "|h̃|",
          mark: { values: TWO_OMEGA_ISCO, label: "2Ω(ISCO)" },
        });
      }

      if (plane) {
        plane.setModes({ omega: OMEGA22, curve: CURVE22, xRange: [0.15, 0.95] });
      }
    } else {
      const d = state.data;

      if (spectrum && d) {
        spectrum.setData({
          w0: d.w0,
          dw: d.dw,
          nw: d.nw,
          values: d.absX,
          wMax: 1.5,
          omega: OMEGA,
          symbol: "|X|",
          mark: null,
        });
      }

      if (plane) {
        plane.setModes({ omega: OMEGA, curve: CURVE, xRange: [0.22, 0.44] });
      }
    }
  }

  setPanels();

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

  // One fit per spin: modes n = 0..3 at the Kerr frequencies (see
  // fitRingdown). On the axis a tail of real exponentials is added and the
  // fit starts 5 M after the peak. In the plunge the tail is negligible, but
  // the signal just after the peak of |dh/du| is not yet a sum of modes, so
  // the fit starts 15 M after it. The "n = 0" view shows (the tail plus) the
  // fundamental mode of that fit; without the overtones the curve is off
  // until they have decayed.
  let qnmMode = 0; // -1: off, otherwise highest overtone shown
  const FITS = {
    axis: { omega: OMEGA, tauA: 5, rates: [0.005, 0.015, 0.04, 0.1, 0.25], drawFrom: { 0: 25, 3: 5 } },
    plunge: { omega: OMEGA22, tauA: 15, rates: [], drawFrom: { 0: 30, 3: 15 } },
    incl: { omega: null, tauA: 15, rates: [], drawFrom: { 0: 30, 3: 15 } },
  };

  /* QNM set of the inclined plunge: the fundamental modes l = 2, 3 with all m
     (group "n = 0") and the first overtones of l = 2 (added for "n <= 1").
     For a real h_+ each frequency w enters as e^{Im w tau} (cos, sin)(Re w tau),
     which also covers the mirror mode -conj(w). Frequencies that coincide (all
     m at a = 0) are kept once. */
  function inclOmegas() {
    const q = state.incl.qnm;
    const kk = inclSpin(state.a);
    const pick = (list) => {
      const out = [];
      list.forEach((key) => {
        const w = q[key][kk];
        if (!out.some((v) => Math.hypot(v[0] - w[0], v[1] - w[1]) < 1e-6)) out.push(w);
      });
      return out;
    };
    const keys = (l, n) => Array.from({ length: 2 * l + 1 }, (_, j) => `${l},${j - l},${n}`);
    const g0 = pick([...keys(2, 0), ...keys(3, 0)]);
    const g1 = pick(keys(2, 1)).filter((w) => !g0.some((v) => Math.hypot(v[0] - w[0], v[1] - w[1]) < 1e-6));
    return { omegas: [...g0, ...g1], n0: g0.length };
  }
  const N_MAX = 3;
  const TAIL_COLOR = "#8a93a1";

  function ringdownFit() {
    if (qnmMode < 0 || !state.wave) {
      return null;
    }

    if (state.fit === undefined) {
      const cfg = FITS[params.mode];

      if (params.mode === "incl") {
        // two separate fits: the fundamental modes alone ("n = 0") and with
        // the l = 2 overtones ("n <= 1")
        const { omegas, n0 } = inclOmegas();
        const f0 = fitRingdown(state.wave, omegas.slice(0, n0), [], cfg.tauA, T_AFTER);
        const f1 = fitRingdown(state.wave, omegas, [], cfg.tauA, T_AFTER);
        state.fit = f0 && f1 && {
          upTo: (nMax, tau) => (nMax === 0 ? f0.upTo(n0 - 1, tau) : f1.upTo(omegas.length - 1, tau)),
          tail: () => 0,
        };
      } else {
        const omegas = cfg.omega.slice(0, N_MAX + 1).map((row) => row[state.k]);
        state.fit = fitRingdown(state.wave, omegas, cfg.rates, cfg.tauA, T_AFTER);
      }
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

    if (params.mode === "incl" && traceScale === "lin") {
      cctx.strokeStyle = "rgba(11,18,32,0.3)";
      cctx.lineWidth = 1;
      cctx.beginPath();

      for (let time = state.tStart, first = true; time <= state.tEnd + 1e-9; time += TRACE_STEP) {
        const x = traceX(time);
        const y = traceY(state.wave.atCross(time - params.sObs));

        if (first) {
          cctx.moveTo(x, y);
          first = false;
        } else {
          cctx.lineTo(x, y);
        }
      }

      cctx.stroke();
    }

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

      const cfg = FITS[params.mode];

      if (cfg.rates.length > 0) {
        fitCurve(fit.tail, TAIL_COLOR, 1.4, [2, 3], cfg.tauA);
      }

      fitCurve((tau) => fit.upTo(qnmMode, tau), QNM_COLOR, 1.6, [5, 4], cfg.drawFrom[qnmMode]);
    }

    cctx.restore();
  }

  function drawTrace() {
    if (traceCache.width === 0 || traceCache.height === 0) {
      return; // not laid out yet
    }

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
    const reach =
      params.view === "volume" && rOutSheet > 0
        ? 1.1 * rhoOf(rOutSheet)
        : rhoOf(Math.max(params.sObs, rstar(R_START, 0))) + 10;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    const fit = Math.min(hfov, vfov * 1.6);
    const portrait = camera.aspect < 1;
    const dist = (reach / Math.tan(fit / 2)) * (portrait ? 0.95 : 0.9);
    const dir = portrait
      ? new THREE.Vector3(0.15, 0.95, 1).normalize()
      : new THREE.Vector3(0.12, 0.62, 1).normalize();

    controls.target.set(reach * 0.08, 0, -reach * 0.12);

    // keep the observer in view when it floats above the plane
    const lift = params.mode === "incl" ? Math.max(0, rhoOf(params.sObs) * Math.cos((params.thetaObs * Math.PI) / 180)) : 0;
    controls.target.y = 0.35 * lift;
    camera.position.copy(controls.target).addScaledVector(dir, dist * (1 + (0.35 * lift) / reach));
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
        if (params.mode === "incl") {
          // only some spins were computed for the inclined plunge
          params.spin = state.incl.spins[inclSpin(params.spin)];
          input.value = String(params.spin);
          showOutputs();
        }
        setSpin(spinIndex(params.spin));
      } else if (key === "iota" || key === "thetaObs") {
        if (params.mode === "incl") {
          setSpin(spinIndex(params.spin));
        }
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

  function updateKeys() {
    const withTail = FITS[params.mode].rates.length > 0;

    if (qnmKey) {
      qnmKey.hidden = qnmMode < 0;
      qnmKey.lastChild.textContent =
        params.mode === "incl"
          ? `fit, ℓ ≤ 3${qnmMode === 0 ? ", n = 0" : ", n ≤ 1 for ℓ = 2"}`
          : `fit, n ${qnmMode === 0 ? "=" : "≤"} ${qnmMode}${withTail ? " + tail" : ""}`;
    }

    if (tailKey) {
      tailKey.hidden = qnmMode < 0 || !withTail;
    }
  }

  root.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  root.querySelectorAll("[data-phase]").forEach((btn) => {
    btn.addEventListener("click", () => {
      params.phase = Number(btn.dataset.phase);
      root.querySelectorAll("[data-phase]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      if (params.mode === "incl") {
        setSpin(spinIndex(params.spin));
      }
    });
  });

  root.querySelectorAll("[data-qnm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      qnmMode = Number(btn.dataset.qnm);
      root.querySelectorAll("[data-qnm]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      updateKeys();
      traceDirty = true;
    });
  });

  // ---------- Trajectory ----------

  const modeButtons = root.querySelectorAll("[data-mode]");

  async function setMode(mode) {
    if (mode === params.mode || state.loading || !state.data) {
      return;
    }

    if (mode === "plunge" && !state.plungeData) {
      state.loading = true;
      statusEl.textContent = "Loading the plunge waveforms…";

      try {
        state.plungeData = await loadPlunge(new URL("./sn-plunge.json", import.meta.url));
      } catch (err) {
        statusEl.textContent = `Could not load the waveforms: ${err.message}`;
        return;
      } finally {
        state.loading = false;
      }
    }

    if (mode === "incl") {
      state.loading = true;
      statusEl.textContent = "Loading the inclined plunges…";

      try {
        if (!state.incl) {
          state.incl = await loadInclIndex(new URL("./incl/index.json", import.meta.url));
          showInclSpins(state.incl.spins);
        }
        // the orbit for the current controls, so that the switch is immediate
        const kk = inclSpin(params.spin);
        const i = state.incl.iotas.indexOf(params.iota);
        const key = `${kk}/${i}/${params.phase}`;

        if (key !== state.inclKey) {
          state.inclOrbit = await loadInclOrbit(state.incl, kk, i, params.phase);
          state.inclKey = key;
        }
      } catch (err) {
        statusEl.textContent = `Could not load the waveforms: ${err.message}`;
        return;
      } finally {
        state.loading = false;
      }
    }

    const reframe = mode === "incl" || params.mode === "incl";
    params.mode = mode;
    uniforms.uMode.value = { axis: 0, plunge: 1, incl: 2 }[mode];

    if (labels.isco) {
      labels.isco.textContent = mode === "incl" ? "ISSO" : "ISCO";
    }

    labels.ring.textContent = mode === "incl" ? "Photon orbit" : "Light ring";
    modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    document.querySelectorAll("[data-show]").forEach((el) => {
      el.hidden = !el.dataset.show.split(" ").includes(mode);
    });

    const spinInput = root.querySelector('[data-param="spin"]');

    if (mode === "incl") {
      // the slider covers the computed spins; values in between snap to the nearest
      const sp = state.incl.spins;
      const gaps = sp.slice(1).map((s, j) => s - sp[j]);
      params.spin = sp[inclSpin(params.spin)];
      spinInput.min = String(sp[0]);
      spinInput.max = String(sp[sp.length - 1]);
      spinInput.step = String(gaps.length ? +Math.min(...gaps).toFixed(2) : 0.1);
      spinInput.disabled = sp.length < 2;
    } else {
      spinInput.min = "0";
      spinInput.step = "0.1";
      spinInput.max = "0.9";
      spinInput.disabled = false;
    }

    spinInput.value = String(params.spin);
    showOutputs();
    state.k = spinIndex(params.spin);
    setPanels();
    setSpin(state.k, { keepTime: false });
    updateKeys();

    if (reframe) {
      resetView();
    }
    playing = true;
    updatePlayButton();
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
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

      if (state.loading) {
        // keep the loading message
      } else if (params.mode === "incl") {
        const deg = Math.round(90 - (state.orbit.at(t).theta * 180) / Math.PI);
        statusEl.textContent = `${where} · latitude ${String(deg).replace("-", "−")}° · ISSO r = ${state.orbit.rIsso.toFixed(2)} M`;
      } else if (params.mode === "plunge") {
        statusEl.textContent = `${where} · ISCO r = ${state.orbit.rIsco.toFixed(2)} M · light ring r = ${state.orbit.rph.toFixed(2)} M`;
      } else {
        statusEl.textContent = `${where} · r₊ = ${state.orbit.rp.toFixed(3)} M · light ring r = ${lightRing(state.a).toFixed(2)} M`;
      }
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
      setPanels();
      setSpin(spinIndex(params.spin), { keepTime: false });
      updatePlayButton();
    })
    .catch((err) => {
      statusEl.textContent = `Could not load the waveforms: ${err.message}`;
    });

  requestAnimationFrame(frame);
}
