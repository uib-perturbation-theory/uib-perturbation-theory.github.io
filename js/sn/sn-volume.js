/* Volume view of the Sasaki–Nakamura simulator: the strain h_+ around the
   hole, drawn as a glowing, semi-transparent cloud instead of a sheet.

   The field at a point at distance rho from the hole (r* = rho - R_BH + R_IN,
   the same radial map as the sheet), polar angle theta from the axis and
   azimuth phi is
     h_+ - i h_x = sum_lm h_lm(t - r*) Y_lm(theta) e^{i m phi},
   so h_+ = sum_{m=0..4} Re[G_m(rho, theta) e^{i m phi}] with
     G_0 = F_0,  G_m = F_m + conj(F_{-m}),  F_m = sum_l h_lm(t - r*) Y_lm(theta)
   for real angular functions Y_lm. Each frame the G_m are tabulated on a
   (rho, theta) grid on the CPU and uploaded as a float texture; a fragment
   shader marches along each view ray through a ball, sums the five m with
   the azimuth of the sample, and accumulates colour (orange for h_+ > 0,
   blue for h_+ < 0) and opacity front to back. Rays stop at the hole. */

const N_RHO = 256;
const N_TH = 64;
const N_BLOCK = 3; // texture blocks: (G0, G1), (G2, G3), (G4, -)

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uG;
  uniform vec3 uAxis;
  uniform vec3 uE1;
  uniform vec3 uE2;
  uniform float uRho0;
  uniform float uRho1;
  uniform float uRBH;
  uniform float uLog;
  uniform float uEps;
  uniform float uDensity;
  uniform float uLo;
  uniform float uPow;
  uniform float uHi;
  uniform vec3 uPos;
  uniform vec3 uNeg;
  varying vec3 vWorld;

  const float NR = ${N_RHO.toFixed(1)};
  const float NT = ${N_TH.toFixed(1)};
  const float NB = ${N_BLOCK.toFixed(1)};
  const int STEPS = 128;

  vec4 block(float s, float y, float k) {
    return texture(uG, vec2(s, (k * NT + y) / (NB * NT)));
  }

  float field(vec3 p) {
    float rho = length(p);
    float s = ((rho - uRho0) / (uRho1 - uRho0) * (NR - 1.0) + 0.5) / NR;
    if (s <= 0.5 / NR || s >= 1.0 - 0.5 / NR) return 0.0;
    float ct = clamp(dot(p, uAxis) / rho, -1.0, 1.0);
    float y = acos(ct) / 3.14159265 * (NT - 1.0) + 0.5;
    vec4 b0 = block(s, y, 0.0);
    vec4 b1 = block(s, y, 1.0);
    vec4 b2 = block(s, y, 2.0);
    float x1 = dot(p, uE1);
    float x2 = dot(p, uE2);
    float rp = sqrt(x1 * x1 + x2 * x2) + 1e-6;
    float c1 = x1 / rp;
    float s1 = x2 / rp;
    float c2 = c1 * c1 - s1 * s1;
    float s2 = 2.0 * c1 * s1;
    float c3 = c2 * c1 - s2 * s1;
    float s3 = s2 * c1 + c2 * s1;
    float c4 = c2 * c2 - s2 * s2;
    float s4 = 2.0 * c2 * s2;
    return b0.x + (b0.z * c1 - b0.w * s1) + (b1.x * c2 - b1.y * s2)
         + (b1.z * c3 - b1.w * s3) + (b2.x * c4 - b2.y * s4);
  }

  float hash(vec2 q) {
    return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    float b = dot(ro, rd);
    float c = dot(ro, ro) - uRho1 * uRho1;
    float h = b * b - c;
    if (h <= 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0);
    float t1 = -b + h;
    // stop at the hole
    float cb = dot(ro, ro) - uRBH * uRBH;
    float hb = b * b - cb;
    if (hb > 0.0) {
      float tb = -b - sqrt(hb);
      if (tb > 0.0) t1 = min(t1, tb);
    }
    if (t1 <= t0) discard;

    float ds = (t1 - t0) / float(STEPS);
    float tt = t0 + ds * hash(gl_FragCoord.xy);
    vec3 col = vec3(0.0);
    float alpha = 0.0;

    for (int i = 0; i < STEPS; i++) {
      if (tt > t1 || alpha > 0.97) break;
      float f = field(ro + tt * rd);
      float v = uLog > 0.5 ? asinh(f / uEps) / asinh(1.0 / uEps) : clamp(f, -1.25, 1.25);
      // transparent where the wave is weak; brighter, denser crests with a light core
      float a = smoothstep(uLo, uHi, abs(v));
      vec3 hue = v > 0.0 ? uPos : uNeg;
      vec3 c = mix(hue * 0.6, mix(hue, vec3(1.0), 0.45), smoothstep(0.5, 1.0, a));
      float k = 1.0 - exp(-uDensity * pow(a, uPow) * ds);
      col += (1.0 - alpha) * k * c;
      alpha += (1.0 - alpha) * k;
      tt += ds;
    }

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createVolume(THREE, scene) {
  const data = new Float32Array(N_RHO * N_TH * N_BLOCK * 4);
  const tex = new THREE.DataTexture(data, N_RHO, N_TH * N_BLOCK, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const uniforms = {
    uG: { value: tex },
    uAxis: { value: new THREE.Vector3(0, 1, 0) },
    uE1: { value: new THREE.Vector3(1, 0, 0) },
    uE2: { value: new THREE.Vector3(0, 0, -1) },
    uRho0: { value: 9 },
    uRho1: { value: 100 },
    uRBH: { value: 9 },
    uLog: { value: 1 },
    uEps: { value: 0.03 },
    uDensity: { value: 0.09 },
    uLo: { value: 0.12 },
    uPow: { value: 2 },
    uHi: { value: 0.85 },
    uPos: { value: new THREE.Color("#ff8a3d") },
    uNeg: { value: new THREE.Color("#4f9be0") },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), material);
  mesh.renderOrder = 10;
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Angular tables Y_k(theta_j) of the current set of modes
  let modesKey = "";
  let Y = null;
  const thetas = Array.from({ length: N_TH }, (_, j) => (Math.PI * j) / (N_TH - 1));
  const H = new Float64Array(2 * 32);
  const tmp = new Float64Array(2);

  /* source = { key, modes: [{ l, m, at(u, out) -> [re, im] }], Y(l, m, theta),
     axis, e1, e2 (THREE.Vector3), norm } */
  function setAngles(source) {
    if (source.key === modesKey) return;
    modesKey = source.key;
    Y = source.modes.map(({ l, m }) => Float64Array.from(thetas, (th) => source.Y(l, m, th)));
    uniforms.uAxis.value.copy(source.axis);
    uniforms.uE1.value.copy(source.e1);
    uniforms.uE2.value.copy(source.e2);
  }

  /* Fill the texture at time t. rStarOf(rho) gives r* for a radius, weight(rStar)
     the mask (inner cut and outer fade, as on the sheet). */
  function update(t, source, { rho0, rho1, rStarOf, weight, log, eps }) {
    setAngles(source);
    const { modes } = source;
    const inv = 1 / source.norm;
    const nm = modes.length;
    data.fill(0);

    for (let i = 0; i < N_RHO; i += 1) {
      const rho = rho0 + ((rho1 - rho0) * i) / (N_RHO - 1);
      const rs = rStarOf(rho);
      const w = weight(rs) * inv;

      if (w <= 0) continue;

      const u = t - rs;

      for (let k = 0; k < nm; k += 1) {
        modes[k].at(u, tmp);
        H[2 * k] = w * tmp[0];
        H[2 * k + 1] = w * tmp[1];
      }

      for (let j = 0; j < N_TH; j += 1) {
        for (let k = 0; k < nm; k += 1) {
          const y = Y[k][j];
          if (y === 0) continue;
          const m = modes[k].m;
          const am = Math.abs(m);
          // G_m += h Y for m >= 0, conj(h) Y for m < 0
          const re = H[2 * k] * y;
          const im = (m < 0 ? -H[2 * k + 1] : H[2 * k + 1]) * y;
          const blk = am >> 1;
          const ch = 2 * (am & 1);
          const o = 4 * ((blk * N_TH + j) * N_RHO + i) + ch;
          data[o] += re;
          data[o + 1] += im;
        }
      }
    }

    tex.needsUpdate = true;
    uniforms.uRho0.value = rho0;
    uniforms.uRho1.value = rho1;
    uniforms.uLog.value = log ? 1 : 0;
    uniforms.uEps.value = eps;
    mesh.scale.setScalar(rho1);
  }

  /* Largest |h_+| over the sky and all times, for the colour scale (sampled
     in u, theta and 16 azimuths). */
  function normOf(source, us) {
    setAngles(source);
    const { modes } = source;
    const G = new Float64Array(10);
    let best = 0;

    for (const u of us) {
      for (let k = 0; k < modes.length; k += 1) {
        modes[k].at(u, tmp);
        H[2 * k] = tmp[0];
        H[2 * k + 1] = tmp[1];
      }

      for (let j = 0; j < N_TH; j += 2) {
        G.fill(0);

        for (let k = 0; k < modes.length; k += 1) {
          const m = modes[k].m;
          const am = Math.abs(m);
          const y = Y[k][j];
          G[2 * am] += H[2 * k] * y;
          G[2 * am + 1] += (m < 0 ? -H[2 * k + 1] : H[2 * k + 1]) * y;
        }

        for (let q = 0; q < 16; q += 1) {
          const ph = (Math.PI * q) / 8;
          let f = G[0];
          for (let m = 1; m <= 4; m += 1) f += G[2 * m] * Math.cos(m * ph) - G[2 * m + 1] * Math.sin(m * ph);
          best = Math.max(best, Math.abs(f));
        }
      }
    }

    return best || 1;
  }

  return {
    mesh,
    update,
    normOf,
    set visible(v) {
      mesh.visible = v;
    },
    get visible() {
      return mesh.visible;
    },
    set density(v) {
      uniforms.uDensity.value = v;
    },
  };
}
