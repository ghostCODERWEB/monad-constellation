// Worlds: the sun, planets with terrain, oceans, clouds and a scattering
// atmosphere, and moons. All procedural, all lit from the sun at the origin.
import * as THREE from 'three';
import type { WorldStyle } from '@/lib/worldStyle';

// 3D simplex noise (Ashima Arts / Ian McEwan, MIT licence) and fBm.
const NOISE = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
  float fbm(vec3 p, int oct) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 10; i++) {
      if (i >= oct) break;
      s += a * snoise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
`;

const WORLD_VS = /* glsl */ `
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vN;
  void main() {
    vObj = position;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const SURFACE_FS = /* glsl */ `
  uniform vec3 uSunPos; uniform vec3 uCenter; uniform float uR; uniform float uA;
  uniform vec3 uDeep, uShallow, uSand, uLow, uHigh, uPeak, uSnow, uLava, uDay, uDusk, uRim;
  uniform float uSea, uRough, uCity, uLavaAmt, uIce, uSeed, uTime, uPulse;
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vN;
  ${NOISE}
  vec3 bump(vec3 pos, vec3 nrm, float h) {
    vec3 dpx = dFdx(pos), dpy = dFdy(pos);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1 = cross(dpy, nrm), r2 = cross(nrm, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * nrm - grad);
  }
  void main() {
    vec3 n = normalize(vObj);
    vec3 p = n * 1.7 + uSeed;
    vec3 warp = vec3(fbm(p + 3.1, 4), fbm(p + 7.3, 4), fbm(p + 1.7, 4));
    float e = fbm(p + warp * 0.65 * uRough, 8) * 0.5 + 0.5;
    float lat = abs(n.y);
    bool ocean = e < uSea;
    float land = ocean ? 0.0 : (e - uSea) / (1.0 - uSea);

    // Relief: bump the normal by the terrain height, land only.
    vec3 N = normalize(vN);
    if (!ocean) N = bump(vWorld, N, land * uR * 0.035 * uRough);
    vec3 L = normalize(uSunPos - vWorld);
    vec3 V = normalize(cameraPosition - vWorld);
    float ndl = dot(N, L);
    float ndlFlat = dot(normalize(vN), L);

    vec3 col;
    float spec = 0.0;
    if (ocean) {
      float d = (uSea - e) / max(uSea, 0.01);
      col = mix(uShallow, uDeep, smoothstep(0.0, 0.45, d));
      vec3 H = normalize(L + V);
      float waves = snoise(n * 140.0 + uTime * 0.2) * 0.05;
      spec = pow(max(dot(normalize(vN + waves), H), 0.0), 120.0) * 1.4;
    } else {
      col = mix(uSand, uLow, smoothstep(0.0, 0.06, land));
      col = mix(col, uHigh, smoothstep(0.3, 0.6, land));
      col = mix(col, uPeak, smoothstep(0.65, 0.9, land));
      float fine = snoise(n * 70.0 + uSeed) * 0.5 + 0.5;
      float finer = snoise(n * 380.0 + uSeed) * 0.5 + 0.5;
      col *= 0.82 + 0.22 * fine + 0.12 * finer;
    }
    float ice = smoothstep(uIce, uIce + 0.12, lat + (e - 0.5) * 0.3);
    col = mix(col, uSnow, ice);

    // Sunlight: a soft terminator that goes warm at dawn and dusk.
    float diff = smoothstep(-0.06, 0.55, ndl);
    vec3 sunCol = mix(vec3(1.0, 0.5, 0.25), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.3, ndlFlat));
    vec3 lit = col * (diff * sunCol * 0.95 + 0.025);
    lit += spec * sunCol * smoothstep(0.0, 0.2, ndlFlat);

    // Night side: settlements light up the land.
    float night = 1.0 - smoothstep(-0.12, 0.04, ndlFlat);
    if (!ocean) {
      float c1 = snoise(n * 38.0 + uSeed * 2.0) * 0.5 + 0.5;
      float c2 = snoise(n * 160.0 + uSeed) * 0.5 + 0.5;
      float cities = smoothstep(1.0 - uCity * 0.32, 1.0, c1) * smoothstep(0.35, 0.9, c2);
      cities *= smoothstep(0.01, 0.25, land) * (1.0 - ice);
      lit += vec3(1.0, 0.72, 0.38) * cities * night * 2.2;
    }
    // Volcanic worlds: glowing lava seas and cracks.
    if (uLavaAmt > 0.0) {
      float r = 1.0 - abs(snoise(n * 7.0 + uSeed));
      float crack = smoothstep(0.88, 0.98, r) * (ocean ? 0.0 : 1.0);
      float flicker = 0.85 + 0.15 * sin(uTime * 2.0 + r * 30.0);
      lit += uLava * (crack * 1.6 + (ocean ? 0.9 : 0.0)) * flicker * (0.5 + night);
    }

    // Aerial perspective when the camera is inside the atmosphere.
    float camAlt = length(cameraPosition - uCenter) - uR;
    float inside = 1.0 - smoothstep(uA - uR, (uA - uR) * 1.8, camAlt);
    if (inside > 0.0) {
      float dist = length(cameraPosition - vWorld);
      float fog = (1.0 - exp(-dist / (uR * 0.32))) * inside * 0.88;
      vec3 sunDir = normalize(uSunPos - uCenter);
      float camUp = dot(normalize(cameraPosition - uCenter), sunDir);
      vec3 fogCol = mix(uDusk, uDay, smoothstep(-0.02, 0.35, camUp)) * smoothstep(-0.25, 0.1, camUp) * 0.85;
      lit = mix(lit, fogCol, fog);
    }

    float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 3.0);
    lit += uRim * rim * uPulse * 0.8;
    gl_FragColor = vec4(lit, 1.0);
  }`;

const CLOUD_FS = /* glsl */ `
  uniform vec3 uSunPos; uniform vec3 uColor; uniform vec3 uDusk; uniform float uCover, uSeed, uTime;
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vN;
  ${NOISE}
  void main() {
    vec3 n = normalize(vObj);
    vec3 q = n * 2.6 + uSeed + vec3(uTime * 0.004, 0.0, 0.0);
    float w = fbm(q * 1.3 + 4.0, 3);
    float c = fbm(q + w * 0.8, 6) * 0.5 + 0.5;
    float band = 0.06 * sin(n.y * 14.0 + w * 3.0);
    float a = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, c + band);
    vec3 L = normalize(uSunPos - vWorld);
    float ndl = dot(normalize(vN), L);
    float day = smoothstep(-0.1, 0.35, ndl);
    vec3 col = mix(uDusk * 0.9, uColor, smoothstep(0.0, 0.35, ndl)) * (0.06 + day * 0.88);
    gl_FragColor = vec4(col * a, a * 0.92);
  }`;

const ATMO_VS = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Single-scattering-ish atmosphere, ray-marched against the shell and the
// ground. Correct from space (limb glow, haze over the disk) and from inside
// (a blue day sky, orange dusk at the terminator).
const ATMO_FS = /* glsl */ `
  uniform vec3 uCenter; uniform float uR; uniform float uA; uniform vec3 uSunPos;
  uniform vec3 uDay; uniform vec3 uDusk; uniform float uDensity;
  varying vec3 vWorld;
  void main() {
    vec3 ro = cameraPosition - uCenter;
    vec3 rd = normalize(vWorld - cameraPosition);
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - uA * uA);
    if (h < 0.0) discard;
    h = sqrt(h);
    float t0 = max(-b - h, 0.0);
    float t1 = -b + h;
    float hp = b * b - (dot(ro, ro) - uR * uR);
    bool ground = false;
    if (hp > 0.0) { float tg = -b - sqrt(hp); if (tg > 0.0) { t1 = min(t1, tg); ground = true; } }
    float len = t1 - t0;
    if (len <= 0.0) discard;
    vec3 sunDir = normalize(uSunPos - uCenter);
    float H = uA - uR;
    vec3 sum = vec3(0.0);
    float od = 0.0;
    for (int i = 0; i < 8; i++) {
      float t = t0 + (float(i) + 0.5) / 8.0 * len;
      vec3 p = ro + rd * t;
      float alt = max(length(p) - uR, 0.0) / H;
      float dens = exp(-alt * 3.6);
      float up = dot(normalize(p), sunDir);
      float lit = smoothstep(-0.2, 0.12, up);
      vec3 sky = mix(uDusk, uDay, smoothstep(-0.03, 0.32, up));
      sum += sky * dens * lit;
      od += dens;
    }
    float stepLen = len / 8.0 / H;
    sum *= stepLen; od *= stepLen;
    float mu = dot(rd, normalize(uSunPos - cameraPosition));
    float phase = 0.75 + 0.25 * mu * mu + pow(max(mu, 0.0), 10.0) * 1.6;
    float k = ground ? 0.85 : 6.5;
    float alpha = 1.0 - exp(-od * k * uDensity);
    // From space the limb glows; from inside it is the whole sky. Keep the
    // former from blooming into a white halo.
    float camAlt = (length(ro) - uR) / H;
    float fromSpace = smoothstep(0.9, 1.6, camAlt);
    vec3 col = (sum / max(od, 1e-3)) * alpha * phase * mix(1.0, 0.62, fromSpace);
    gl_FragColor = vec4(col, alpha);
  }`;

const MOON_FS = /* glsl */ `
  uniform vec3 uSunPos; uniform vec3 uTint; uniform float uSeed;
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vN;
  ${NOISE}
  void main() {
    vec3 n = normalize(vObj);
    float base = fbm(n * 2.2 + uSeed, 5) * 0.5 + 0.5;
    float craters = 0.0;
    for (int i = 0; i < 3; i++) {
      float f = 4.0 * pow(2.6, float(i));
      float c = snoise(n * f + uSeed * float(i + 1));
      craters += smoothstep(0.55, 0.7, c) * 0.5 - smoothstep(0.7, 0.85, c) * 0.35;
    }
    vec3 albedo = mix(vec3(0.16, 0.155, 0.17), vec3(0.46, 0.45, 0.48), base) * (1.0 + craters * 0.6);
    albedo = mix(albedo, uTint, 0.12);
    vec3 L = normalize(uSunPos - vWorld);
    float diff = max(dot(normalize(vN), L), 0.0);
    gl_FragColor = vec4(albedo * (diff * 0.95 + 0.015), 1.0);
  }`;

const SUN_FS = /* glsl */ `
  uniform float uTime;
  varying vec3 vObj; varying vec3 vWorld; varying vec3 vN;
  ${NOISE}
  void main() {
    vec3 n = normalize(vObj);
    float g = fbm(n * 4.0 + vec3(0.0, uTime * 0.025, 0.0), 5) * 0.5 + 0.5;
    float g2 = fbm(n * 16.0 - uTime * 0.04, 3) * 0.5 + 0.5;
    vec3 V = normalize(cameraPosition - vWorld);
    float mu = max(dot(normalize(vN), V), 0.0);
    float limb = pow(mu, 0.4);
    vec3 col = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.93, 0.78), g * 0.75 + g2 * 0.25);
    col = mix(col, vec3(0.75, 0.6, 1.0), (1.0 - limb) * 0.35);
    gl_FragColor = vec4(col * (0.7 + 1.6 * limb), 1.0);
  }`;

const c3 = (hex: string) => new THREE.Color(hex);

function glowTexture(stops: [number, string][], size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

function ringTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const g = cv.getContext('2d')!;
  // Planar UVs on a ring: draw concentric bands around the centre.
  for (let r = 256; r > 150; r -= 1.5) {
    const k = (r - 150) / 106;
    const band = 0.35 + 0.65 * Math.abs(Math.sin(r * 0.37) * Math.cos(r * 0.11));
    const a = Math.sin(k * Math.PI) * band;
    g.strokeStyle = `rgba(255, ${Math.round(205 + 30 * k)}, ${Math.round(120 + 60 * k)}, ${a.toFixed(3)})`;
    g.lineWidth = 2;
    g.beginPath(); g.arc(256, 256, r, 0, Math.PI * 2); g.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

export interface Sun { group: THREE.Group; mat: THREE.ShaderMaterial; radius: number; light: THREE.PointLight }

export function buildSun(radius: number): Sun {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({ vertexShader: WORLD_VS, fragmentShader: SUN_FS, uniforms: { uTime: { value: 0 } }, transparent: true });
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat);
  body.renderOrder = 100; // after atmospheres, so the sun shines through a sky
  group.add(body);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(255,240,210,0.95)'], [0.18, 'rgba(255,200,120,0.55)'], [0.45, 'rgba(160,120,255,0.18)'], [1, 'rgba(0,0,0,0)']]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  corona.scale.setScalar(radius * 9);
  corona.renderOrder = 101;
  group.add(corona);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, 'rgba(180,150,255,0.35)'], [0.5, 'rgba(120,90,230,0.08)'], [1, 'rgba(0,0,0,0)']]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  halo.scale.setScalar(radius * 28);
  halo.renderOrder = 101;
  group.add(halo);

  const light = new THREE.PointLight(0xfff1dc, 2.4, 0, 0);
  group.add(light);
  return { group, mat, radius, light };
}

export interface World {
  group: THREE.Group;
  /** Rotates with the planet's day. */
  spinner: THREE.Group;
  surface: THREE.Mesh;
  surfaceMat: THREE.ShaderMaterial;
  clouds: THREE.Mesh;
  cloudMat: THREE.ShaderMaterial;
  atmo: THREE.Mesh;
  atmoMat: THREE.ShaderMaterial;
  radius: number;
  atmoRadius: number;
}

export function buildWorld(style: WorldStyle, radius: number, center: THREE.Vector3, sunPos: { value: THREE.Vector3 }, ring: boolean, atmoScale = 1.1): World {
  const pal = style.palette;
  const group = new THREE.Group();
  group.position.copy(center);
  group.rotation.z = style.tilt;
  const spinner = new THREE.Group();
  group.add(spinner);
  const atmoRadius = radius * atmoScale;

  const surfaceMat = new THREE.ShaderMaterial({
    vertexShader: WORLD_VS, fragmentShader: SURFACE_FS,
    uniforms: {
      uSunPos: sunPos, uCenter: { value: center.clone() }, uR: { value: radius }, uA: { value: atmoRadius },
      uDeep: { value: c3(pal.deep) }, uShallow: { value: c3(pal.shallow) }, uSand: { value: c3(pal.sand) },
      uLow: { value: c3(pal.low) }, uHigh: { value: c3(pal.high) }, uPeak: { value: c3(pal.peak) }, uSnow: { value: c3(pal.snow) },
      uLava: { value: c3(pal.lava) }, uDay: { value: c3(pal.day) }, uDusk: { value: c3(pal.dusk) }, uRim: { value: c3(pal.rim) },
      uSea: { value: style.sea }, uRough: { value: style.rough }, uCity: { value: style.city }, uLavaAmt: { value: style.lava },
      uIce: { value: style.ice }, uSeed: { value: style.seed }, uTime: { value: 0 }, uPulse: { value: 0 },
    },
  });
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 160, 120), surfaceMat);
  spinner.add(surface);

  const cloudMat = new THREE.ShaderMaterial({
    vertexShader: WORLD_VS, fragmentShader: CLOUD_FS,
    uniforms: { uSunPos: sunPos, uColor: { value: c3(pal.cloud) }, uDusk: { value: c3(pal.dusk) }, uCover: { value: style.clouds }, uSeed: { value: style.seed + 11 }, uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.009, 128, 96), cloudMat);
  clouds.renderOrder = 5;
  spinner.add(clouds);

  const atmoMat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VS, fragmentShader: ATMO_FS,
    uniforms: {
      uCenter: { value: center.clone() }, uR: { value: radius }, uA: { value: atmoRadius }, uSunPos: sunPos,
      uDay: { value: c3(pal.day) }, uDusk: { value: c3(pal.dusk) }, uDensity: { value: style.biome === 'magma' ? 1.3 : 1 },
    },
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(atmoRadius, 96, 64), atmoMat);
  atmo.renderOrder = 10;
  group.add(atmo);

  if (ring) {
    // Smart money holds this token: a golden ring system.
    const inner = radius * 1.75, outer = radius * 2.55;
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (outer * 2) + 0.5, pos.getY(i) / (outer * 2) + 0.5);
    const r = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: ringTexture(), side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    }));
    r.rotation.x = Math.PI / 2;
    r.renderOrder = 6;
    group.add(r);
  }

  return { group, spinner, surface, surfaceMat, clouds, cloudMat, atmo, atmoMat, radius, atmoRadius };
}

export function buildMoon(radius: number, tint: string, seed: number, sunPos: { value: THREE.Vector3 }) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: WORLD_VS, fragmentShader: MOON_FS,
    uniforms: { uSunPos: sunPos, uTint: { value: c3(tint) }, uSeed: { value: seed } },
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 48), mat);
}

export function nebula(color: string, size: number, opacity: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture([[0, color], [0.4, color.replace(/[\d.]+\)$/, '0.25)')], [1, 'rgba(0,0,0,0)']], 256),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity,
  }));
  s.scale.setScalar(size);
  s.renderOrder = -1;
  return s;
}
