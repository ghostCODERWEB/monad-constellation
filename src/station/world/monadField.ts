// The Monad universe as seen from the station: a distant spiral of light with
// one bright point for each token world, fixed in the station frame so it hangs
// in the observation room's great window. The same field is drawn into the
// window's sky scene and the telescope's deep-sky scene; through the telescope
// each point resolves into its real world as you zoom (see cosmos.ts).
import * as THREE from 'three';
import { worldStyle } from '@/lib/worldStyle';
import type { Planet } from '@/lib/galaxy';

/** Where the Monad universe sits: dead ahead through the great window, a little above the horizon. */
export const MONAD_CENTER = new THREE.Vector3(1, 0.16, -0.08).normalize();
const SPREAD_DEG = 20;

/** Direction of the k-th of n worlds (biggest first, near the middle). */
export function monadDirection(k: number, n: number, out = new THREE.Vector3()) {
  const theta = THREE.MathUtils.degToRad(1.5 + SPREAD_DEG * Math.sqrt((k + 0.5) / n));
  const phi = k * 2.39996;
  const u = new THREE.Vector3().crossVectors(MONAD_CENTER, new THREE.Vector3(0, 1, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(MONAD_CENTER, u).normalize();
  return out.copy(MONAD_CENTER).multiplyScalar(Math.cos(theta)).addScaledVector(u, Math.sin(theta) * Math.cos(phi)).addScaledVector(v, Math.sin(theta) * Math.sin(phi)).normalize();
}

function swirlTexture() {
  const N = 1024;
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  let s = 77; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'lighter';
  // Two log-spiral arms of soft dust and young stars, a violet-to-pink gradient out from a warm core.
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 2600; i++) {
      const t = Math.pow(r(), 0.8) * 3.3 + 0.15;
      const ang = arm * (Math.PI * 2 / 3) + t * 1.35 + (r() - 0.5) * (0.5 / (t + 0.3));
      const rad = 28 * Math.exp(0.52 * t) * (1 + (r() - 0.5) * 0.12);
      const x = N / 2 + Math.cos(ang) * rad, y = N / 2 + Math.sin(ang) * rad * 0.82;
      const size = 3 + r() * 16;
      const k = Math.min(1, rad / 460);
      const col = `hsla(${268 + k * 70},${70 + r() * 20}%,${58 + r() * 26}%,${0.012 + r() * 0.03})`;
      const gr = g.createRadialGradient(x, y, 0, x, y, size);
      gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - size, y - size, size * 2, size * 2);
    }
  }
  const core = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, 160);
  core.addColorStop(0, 'rgba(255,236,200,0.8)'); core.addColorStop(0.25, 'rgba(190,150,255,0.35)'); core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core; g.fillRect(0, 0, N, N);
  const edge = g.createRadialGradient(N / 2, N / 2, N * 0.3, N / 2, N / 2, N / 2);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'source-over'; g.fillStyle = edge; g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const VS = /* glsl */ `
  attribute float aSize; attribute vec3 aColor; varying vec3 vColor; uniform float uScale;
  void main() { vColor = aColor; gl_PointSize = aSize * uScale; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */ `
  varying vec3 vColor; uniform float uFade;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0; float d = length(p);
    float core = smoothstep(0.35, 0.0, d), halo = smoothstep(1.0, 0.0, d) * 0.45;
    float spike = smoothstep(0.06, 0.0, abs(p.x)) * smoothstep(1.0, 0.0, abs(p.y)) + smoothstep(0.06, 0.0, abs(p.y)) * smoothstep(1.0, 0.0, abs(p.x));
    float a = (core + halo + spike * 0.25) * uFade;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.6) * a, a);
  }`;

export interface MonadField {
  group: THREE.Group;
  /** Place one point per token world, brightest and biggest for the largest markets. */
  set(planets: Planet[]): void;
  /** Telescope magnification: the points fade as the real worlds resolve. */
  setMag(mag: number): void;
}

export function buildMonadField(radius: number): MonadField {
  const group = new THREE.Group();
  group.name = 'monad-field';
  // The galaxy-like glow behind the points, ~60° across.
  const size = 2 * radius * Math.tan(THREE.MathUtils.degToRad(30));
  const swirl = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: swirlTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  swirl.position.copy(MONAD_CENTER).multiplyScalar(radius);
  swirl.lookAt(0, 0, 0);
  swirl.rotateZ(0.6);
  swirl.frustumCulled = false;
  group.add(swirl);

  const uniforms = { uScale: { value: Math.min(window.devicePixelRatio, 2) }, uFade: { value: 1 } };
  const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  let points: THREE.Points | null = null;
  const set = (planets: Planet[]) => {
    if (points) { group.remove(points); points.geometry.dispose(); }
    const order = planets.map((_, i) => i).sort((a, b) => (planets[b].marketCap ?? 0) - (planets[a].marketCap ?? 0));
    const n = order.length + 1;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n);
    const c = new THREE.Color();
    // MON, the network's own star, at the centre of the spiral.
    pos.set(MONAD_CENTER.clone().multiplyScalar(radius).toArray(), 0); c.set('#ffd9a0'); col.set([c.r, c.g, c.b], 0); sz[0] = 26;
    const d = new THREE.Vector3();
    order.forEach((pi, k) => {
      const p = planets[pi];
      monadDirection(k, order.length, d).multiplyScalar(radius);
      pos.set([d.x, d.y, d.z], (k + 1) * 3);
      c.set(worldStyle(p).palette.day).lerp(new THREE.Color('#ffffff'), 0.25);
      col.set([c.r, c.g, c.b], (k + 1) * 3);
      sz[k + 1] = 9 + 5 * Math.max(0, Math.log10(Math.max(1e4, p.marketCap ?? 1e4) / 1e4)) * 0.9;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
  };
  return { group, set, setMag(mag) { uniforms.uFade.value = THREE.MathUtils.clamp(1.15 - mag / 24, 0, 1); } };
}
