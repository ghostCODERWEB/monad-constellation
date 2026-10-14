// The shuttle: a delta-wing spaceplane built from primitives and lofted
// surfaces, no model file. Points along -Z, so "forward" is the object's local
// (0, 0, -1). One long fuselage, thick swept delta wings with moving elevons,
// a single tail fin with a rudder, three main engines at the tail, two
// orbital-manoeuvring pods on the back, reaction-control thrusters round the
// nose, and a glazed cockpit. Used by the station hangar and the galaxy.
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { loadNasaOrbiter, nasaMaterials } from './shuttleNasa';

export interface Shuttle {
  group: THREE.Group;
  /** First-person camera anchors in shuttle-local coordinates. */
  cockpit: { eye: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 };
  /** Engine exhaust points in the shuttle's local space. */
  nozzles: THREE.Vector3[];
  engineMats: THREE.MeshBasicMaterial[];
  /** Thrust plumes; scaled along Z by throttle every frame. */
  plumes: THREE.Mesh[];
  /** Blinking navigation and strobe lights. */
  blinkers: { mesh: THREE.Mesh; phase: number }[];
  light: THREE.PointLight;
  /** Reaction-control thrusters: where each sits (local) and which way it fires. */
  rcs: { pos: THREE.Vector3; dir: THREE.Vector3 }[];
  /** Deflect the control surfaces: pitch, roll and yaw, each in −1…1. */
  setControl(pitch: number, roll: number, yaw: number): void;
  /** Show the flight-deck interior (instrument panels, seats): only when the camera is inside the cockpit. */
  setCockpitView(on: boolean): void;
  /** Extend the undercarriage, where 0 is fully stowed and 1 is weight-on-wheels. */
  setGear(k: number): void;
  /** Drive the shader exhaust, including ignition flash and Mach diamonds. */
  setThrust(throttle: number, time: number, ignition?: number): void;
  /** Distance from the model origin to the tyre contact patch, in model units. */
  gearDrop: number;
  /** Swap in better surfaces after the fact (the galaxy builds the PBR set only when you first fly). */
  applyMaterials(m: ShuttleMaterials): void;
}

/** Optional surface overrides; the defaults are a plain painted look. */
export interface ShuttleMaterials {
  paint?: THREE.Material;      // fuselage
  wing?: THREE.Material;       // wing and fin skin
  wingBottom?: THREE.Material; // wing underside (thermal tiles)
  violet?: THREE.Material;     // trailing edges, tips
  nacelle?: THREE.Material;    // OMS pods (foil blanket)
  bell?: THREE.Material;       // engine bells
  chrome?: THREE.Material;     // trim
  canopy?: THREE.Material;     // cockpit glass
}
type Role = keyof ShuttleMaterials;

/** Hull paint for the default look: pale pearl with panel seams and a violet stripe. */
function hullTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#f4f1ff'); grd.addColorStop(0.5, '#d9d3f2'); grd.addColorStop(1, '#b9b1dc');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  g.strokeStyle = 'rgba(40, 28, 90, 0.35)'; g.lineWidth = 2;
  for (let x = 64; x < 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 96; y < 512; y += 160) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.fillStyle = '#836ef9'; g.fillRect(0, 200, 1024, 70);
  g.fillStyle = '#f5c542'; g.fillRect(0, 276, 1024, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- lofted aerodynamic surfaces ----------

interface Station { x: number; y: number; zle: number; zte: number; T: number }

/** Thickness along the chord: sharp-ish nose, maximum a third of the way back, thin trailing edge. */
const thick = (u: number) => 0.07 + 0.93 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85);

/**
 * A wing-like surface through stations that run along +x: top skin (group 0), bottom skin (group 1) and the
 * edge faces (group 2: leading cap, trailing edge, tip). `u0`…`u1` selects a slice of the chord, so the
 * trailing control surface can be lofted on its own from the same stations.
 */
function loft(st: Station[], u0 = 0, u1 = 1, N = 12) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const vert = (x: number, y: number, z: number, u: number, v: number) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
  const at = (i: number, k: number, side: 1 | -1) => {
    const s = st[i], u = u0 + ((u1 - u0) * k) / (N - 1);
    return [s.x, s.y + (side * thick(u) * s.T) / 2, s.zle + (s.zte - s.zle) * u, u, i / (st.length - 1)] as const;
  };
  const M = st.length;
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  const mark = (mi: number, from: number) => groups.push({ start: from, count: idx.length - from, materialIndex: mi });
  // top, then bottom
  for (const [side, mi] of [[1, 0], [-1, 1]] as const) {
    const from = idx.length;
    const grid: number[][] = [];
    for (let i = 0; i < M; i++) { grid.push([]); for (let k = 0; k < N; k++) { const p = at(i, k, side); grid[i].push(vert(p[0], p[1], p[2], p[3], p[4])); } }
    for (let i = 0; i < M - 1; i++) for (let k = 0; k < N - 1; k++) {
      const a = grid[i][k], b = grid[i][k + 1], c = grid[i + 1][k], d = grid[i + 1][k + 1];
      if (side === 1) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    mark(mi, from);
  }
  // edges: leading cap, trailing face, tip cap
  const from = idx.length;
  const strip = (kTop: number, kBot: number, i: number, j: number, flip: boolean) => {
    const pa = at(i, kTop, 1), pb = at(j, kTop, 1), pc = at(i, kBot, -1), pd = at(j, kBot, -1);
    const a = vert(pa[0], pa[1], pa[2], 0, 0), b = vert(pb[0], pb[1], pb[2], 0, 1), c = vert(pc[0], pc[1], pc[2], 1, 0), d = vert(pd[0], pd[1], pd[2], 1, 1);
    if (!flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  };
  for (let i = 0; i < M - 1; i++) { strip(N - 1, N - 1, i, i + 1, false); strip(0, 0, i, i + 1, true); }
  for (let k = 0; k < N - 1; k++) { // tip cap, +x
    const pa = at(M - 1, k, 1), pb = at(M - 1, k + 1, 1), pc = at(M - 1, k, -1), pd = at(M - 1, k + 1, -1);
    const a = vert(pa[0], pa[1], pa[2], 0, 0), b = vert(pb[0], pb[1], pb[2], 0, 1), c = vert(pc[0], pc[1], pc[2], 1, 0), d = vert(pd[0], pd[1], pd[2], 1, 1);
    idx.push(a, b, c, b, d, c);
  }
  mark(2, from);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  geo.computeVertexNormals();
  return geo;
}

/** The mirror image about x = 0, with the winding put right. */
function mirror(geo: THREE.BufferGeometry) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const i = g.index!;
  for (let k = 0; k < i.count; k += 3) { const a = i.getX(k + 1), b = i.getX(k + 2); i.setX(k + 1, b); i.setX(k + 2, a); }
  g.computeVertexNormals();
  return g;
}

/** Re-centres a geometry on `p` (so it can pivot about a hinge there). */
const recentre = (g: THREE.BufferGeometry, p: THREE.Vector3) => { g.translate(-p.x, -p.y, -p.z); return g; };

interface HullStation { z: number; width: number; top: number; bottom: number; power: number }

/** A lifting-body shell with square shoulders, a flat belly and a rounded nose. */
function hullGeometry() {
  const stations: HullStation[] = [
    { z: -1.18, width: 0.025, top: 0.035, bottom: 0.025, power: 2.0 },
    { z: -1.10, width: 0.15, top: 0.14, bottom: 0.10, power: 2.1 },
    { z: -0.92, width: 0.23, top: 0.22, bottom: 0.15, power: 2.2 },
    { z: -0.66, width: 0.28, top: 0.29, bottom: 0.19, power: 2.5 },
    { z: -0.28, width: 0.33, top: 0.31, bottom: 0.21, power: 3.1 },
    { z: 0.18, width: 0.35, top: 0.28, bottom: 0.22, power: 3.5 },
    { z: 0.55, width: 0.32, top: 0.25, bottom: 0.21, power: 3.0 },
    { z: 0.78, width: 0.255, top: 0.20, bottom: 0.18, power: 2.5 },
    { z: 0.86, width: 0.21, top: 0.16, bottom: 0.15, power: 2.2 },
  ];
  const around = 48, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j < stations.length; j++) {
    const s = stations[j];
    for (let i = 0; i < around; i++) {
      const a = (i / around) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const e = 2 / s.power;
      const x = s.width * Math.sign(ca) * Math.pow(Math.abs(ca), e);
      const y = (sa >= 0 ? s.top : s.bottom) * Math.sign(sa) * Math.pow(Math.abs(sa), e);
      pos.push(x, y, s.z);
      uv.push(i / around, j / (stations.length - 1));
    }
  }
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < around; i++) {
    const n = (i + 1) % around, a = j * around + i, b = j * around + n, c = (j + 1) * around + i, d = (j + 1) * around + n;
    idx.push(a, b, c, b, d, c);
  }
  // Close the engine bulkhead. The nose converges tightly enough that it does not need a visible cap.
  const rear = pos.length / 3;
  pos.push(0, 0, stations.at(-1)!.z); uv.push(0.5, 1);
  const ring = (stations.length - 1) * around;
  for (let i = 0; i < around; i++) idx.push(rear, ring + i, ring + ((i + 1) % around));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingBox();
  return g;
}

function quad(points: [number, number, number][]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
  return g;
}

function wordmarkTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 384;
  const g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height);
  g.font = '900 260px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 28; g.strokeStyle = 'rgba(245,245,255,.98)'; g.strokeText(text, c.width / 2, c.height / 2);
  g.fillStyle = '#4f3acb'; g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; return t;
}

function cockpitScreen(lines: string[], accent = '#00ffa7') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#020908'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = accent; g.lineWidth = 8; g.strokeRect(16, 16, c.width - 32, c.height - 32);
  g.fillStyle = accent; g.font = '700 58px monospace';
  lines.forEach((line, i) => g.fillText(line, 54, 105 + i * 92));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function plumeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uThrottle: { value: 0 }, uTime: { value: 0 }, uIgnition: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `
      varying vec2 vUv; uniform float uThrottle; uniform float uTime; uniform float uIgnition;
      float hash(float n){return fract(sin(n)*43758.5453);}
      void main(){
        float axial=vUv.y, radial=abs(vUv.x-.5)*2.;
        float edge=(1.-smoothstep(.12,1.,radial))*(1.-smoothstep(.82,1.,axial));
        float flick=.88+.12*sin(uTime*43.+axial*31.)+.05*hash(floor(uTime*55.)+axial*9.);
        float diamonds=pow(max(0.,cos((axial*6.-uTime*.35)*6.283)),12.)*smoothstep(.35,.92,uThrottle);
        vec3 outer=mix(vec3(1.,.22,.04),vec3(.36,.18,1.),smoothstep(.05,.8,axial));
        vec3 core=mix(vec3(.35,.62,1.),vec3(1.),smoothstep(.15,.72,1.-radial));
        vec3 col=mix(outer,core,1.-smoothstep(.05,.75,radial));
        col+=diamonds*vec3(.75,.9,1.8)+uIgnition*vec3(1.8,.75,.2)*(1.-axial);
        float alpha=edge*(.18+.72*uThrottle)*flick;
        if(alpha<.015) discard; gl_FragColor=vec4(col,alpha);
      }`,
  });
}

export function buildShuttle(over: ShuttleMaterials = {}): Shuttle {
  const group = new THREE.Group();
  // The procedural airframe is the fallback; NASA's orbiter replaces it as soon as that model has loaded.
  const body = new THREE.Group(); body.name = 'procedural-body'; group.add(body);

  const paintDefault = new THREE.MeshPhysicalMaterial({
    map: hullTexture(), metalness: 0.45, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, color: 0x9a93b8,
    emissive: 0x150d36, emissiveIntensity: 0.08,
  });
  const violetDefault = new THREE.MeshPhysicalMaterial({ color: 0x6d5bd0, metalness: 0.8, roughness: 0.25, clearcoat: 1, emissive: 0x3b2a8c, emissiveIntensity: 0.15 });
  const gunmetalDefault = new THREE.MeshPhysicalMaterial({ color: 0x24203a, metalness: 0.9, roughness: 0.35, clearcoat: 0.6 });
  const chromeDefault = new THREE.MeshPhysicalMaterial({ color: 0xd8d4ec, metalness: 1, roughness: 0.12 });
  const canopyDefault = new THREE.MeshPhysicalMaterial({ color: 0x071329, metalness: 0.18, roughness: 0.08, clearcoat: 1, emissive: 0x0a4660, emissiveIntensity: 0.28, transparent: false, opacity: 1, depthWrite: true });
  const defaults: Required<ShuttleMaterials> = {
    paint: paintDefault, wing: paintDefault, wingBottom: gunmetalDefault, violet: violetDefault, nacelle: gunmetalDefault,
    bell: chromeDefault, chrome: chromeDefault, canopy: canopyDefault,
  };
  const mats = { ...defaults, ...over } as Required<ShuttleMaterials>;
  if (!over.wing && over.paint) mats.wing = over.paint;

  // Everything that takes a swappable surface registers here with its role.
  const roles: { mesh: THREE.Mesh; role: Role[] }[] = [];
  const mesh = (geo: THREE.BufferGeometry, role: Role | Role[], parent: THREE.Object3D = body) => {
    const rs = Array.isArray(role) ? role : [role];
    const m = new THREE.Mesh(geo, rs.length === 1 ? mats[rs[0]] : rs.map((r) => mats[r]));
    roles.push({ mesh: m, role: rs });
    parent.add(m);
    return m;
  };

  // Lofted orbiter body. Its UVs follow circumference (u) and fuselage length (v).
  mesh(hullGeometry(), 'paint');

  // Raised flight deck blended into the shoulders.
  const flightDeck = mesh(new THREE.SphereGeometry(0.22, 32, 16), 'paint');
  flightDeck.scale.set(0.92, 0.42, 1.35); flightDeck.position.set(0, 0.195, -0.53);

  // Six individual panes: two windscreens, two side panes and two overhead panes.
  const panes: [number, number, number][][] = [
    [[-0.155, 0.255, -0.72], [-0.018, 0.285, -0.75], [-0.018, 0.292, -0.55], [-0.17, 0.263, -0.54]],
    [[0.018, 0.285, -0.75], [0.155, 0.255, -0.72], [0.17, 0.263, -0.54], [0.018, 0.292, -0.55]],
    [[-0.205, 0.205, -0.56], [-0.172, 0.257, -0.54], [-0.17, 0.25, -0.37], [-0.215, 0.19, -0.39]],
    [[0.172, 0.257, -0.54], [0.205, 0.205, -0.56], [0.215, 0.19, -0.39], [0.17, 0.25, -0.37]],
    [[-0.13, 0.292, -0.52], [-0.015, 0.305, -0.53], [-0.015, 0.30, -0.38], [-0.12, 0.287, -0.38]],
    [[0.015, 0.305, -0.53], [0.13, 0.292, -0.52], [0.12, 0.287, -0.38], [0.015, 0.30, -0.38]],
  ];
  for (const p of panes) mesh(quad(p), 'canopy');
  const mullionMat = mats.chrome;
  for (const x of [-0.172, 0, 0.172]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.39), mullionMat);
    bar.position.set(x, 0.286 - Math.abs(x) * 0.25, -0.55); body.add(bar);
  }

  // Flight deck interior, sized to be read from the first-person camera.
  // The exterior shell is front-sided, so from inside the modeled tub, frames,
  // seats and instruments define the cabin while the six windows reveal space.
  const cockpit = new THREE.Group(); cockpit.name = 'cockpit-interior'; cockpit.visible = false; group.add(cockpit);
  const cabin = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.72, metalness: 0.28 });
  const padding = new THREE.MeshStandardMaterial({ color: 0x11151b, roughness: 0.94, metalness: 0.02 });
  const frame = new THREE.MeshStandardMaterial({ color: 0xaeb5bf, roughness: 0.36, metalness: 0.82 });
  const glow = (map: THREE.Texture, color: number) => new THREE.MeshBasicMaterial({ map, color, toneMapped: false });
  const tub = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.18, 0.60), cabin); tub.position.set(0, -0.01, -0.43); cockpit.add(tub);
  const dash = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.10, 0.16), cabin); dash.position.set(0, 0.12, -0.73); dash.rotation.x = -0.16; cockpit.add(dash);
  for (const x of [-0.135, 0.135]) {
    const seat = new THREE.Group(); seat.position.set(x, 0.03, -0.26); cockpit.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.31, 0.08), padding); back.position.y = 0.04; back.rotation.x = -0.13; seat.add(back);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.07, 0.20), padding); base.position.set(0, -0.13, -0.05); seat.add(base);
    for (const sx of [-0.07, 0.07]) { const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 10), frame); rail.position.set(sx, 0.02, 0); seat.add(rail); }
  }
  const screenMaps = [cockpitScreen(['NANSEN × MONAD', 'FLIGHT COMPUTER', 'NAV: STANDBY']), cockpitScreen(['RCS  NOMINAL', 'CLAMPS  SAFE', 'DATA  NANSEN'], '#836ef9')];
  for (const [i, x] of [-0.13, 0.13].entries()) {
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.025), padding); bezel.position.set(x, 0.155, -0.815); bezel.rotation.x = -0.13; cockpit.add(bezel);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.10), glow(screenMaps[i], i ? 0xb9a8ff : 0x9effdb)); screen.position.set(x, 0.155, -0.800); screen.rotation.x = -0.13; cockpit.add(screen);
  }
  // Glare shield, overhead switch bank and strong window mullions.
  const glare = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.035, 0.18), padding); glare.position.set(0, 0.225, -0.68); cockpit.add(glare);
  const overhead = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.035, 0.25), cabin); overhead.position.set(0, 0.285, -0.49); overhead.rotation.x = 0.16; cockpit.add(overhead);
  for (let i = 0; i < 18; i++) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.025), new THREE.MeshBasicMaterial({ color: i % 4 === 0 ? 0xf5c542 : 0x7affc4, toneMapped: false }));
    sw.position.set(-0.16 + (i % 9) * 0.04, 0.262, -0.56 + Math.floor(i / 9) * 0.07); cockpit.add(sw);
  }
  for (const x of [-0.19, 0, 0.19]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.34, 0.035), frame); m.position.set(x, 0.22, -0.70); m.rotation.x = -0.12; cockpit.add(m); }
  const cockpitAnchors = { eye: new THREE.Vector3(0, 0.18, -0.39), target: new THREE.Vector3(0, 0.17, -1.8), up: new THREE.Vector3(0, 1, 0) };

  // Large flank wordmarks are separate decal meshes so they stay legible from the gangway.
  const livery = new THREE.MeshBasicMaterial({ map: wordmarkTexture('MONAD'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.18), livery);
    d.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    d.position.set(side * 0.298, 0.015, 0.10); body.add(d);
  }

  // Delta wings: strake and main panel, with elevons that move.
  const st: Station[] = [
    { x: 0.21, y: -0.105, zle: -0.58, zte: 0.67, T: 0.105 },
    { x: 0.42, y: -0.115, zle: -0.28, zte: 0.66, T: 0.086 },
    { x: 0.69, y: -0.122, zle: 0.02, zte: 0.62, T: 0.052 },
    { x: 0.82, y: -0.125, zle: 0.28, zte: 0.56, T: 0.030 },
  ];
  const HINGE = 0.74;
  const hingeAt = (s: Station) => new THREE.Vector3(s.x, s.y, s.zle + (s.zte - s.zle) * HINGE);
  const elevonPivot = hingeAt(st[1]);
  const elevonAxis = hingeAt(st[3]).sub(elevonPivot).normalize();
  const inboard = loft(st.slice(0, 2));
  const outer = loft(st.slice(1), 0, HINGE);
  const elevon = loft(st.slice(1), HINGE, 1, 5);
  const wingRoles: Role[] = ['wing', 'wingBottom', 'violet'];
  const elevons: { obj: THREE.Mesh; axis: THREE.Vector3; side: 1 | -1 }[] = [];
  for (const side of [1, -1] as const) {
    const m = side === 1 ? (g: THREE.BufferGeometry) => g : mirror;
    mesh(m(inboard), wingRoles);
    mesh(m(outer), wingRoles);
    const ev = mesh(m(recentre(elevon.clone(), elevonPivot)), wingRoles);
    ev.position.set(side * elevonPivot.x, elevonPivot.y, elevonPivot.z);
    elevons.push({ obj: ev, axis: new THREE.Vector3(side * elevonAxis.x, elevonAxis.y, elevonAxis.z), side });
  }

  // One tall tail fin on the spine with a rudder, swept back.
  const fst: Station[] = [
    { x: 0.04, y: 0, zle: 0.03, zte: 0.77, T: 0.055 },
    { x: 0.32, y: 0, zle: 0.28, zte: 0.75, T: 0.034 },
    { x: 0.57, y: 0, zle: 0.52, zte: 0.72, T: 0.015 },
  ];
  const finBase = new THREE.Vector3(0, 0.09, 0);
  const fin = loft(fst, 0, 0.7), rud = loft(fst, 0.7, 1, 5);
  fin.rotateZ(Math.PI / 2); rud.rotateZ(Math.PI / 2);
  const rudPivot = new THREE.Vector3(0, fst[0].x, fst[0].zle + (fst[0].zte - fst[0].zle) * 0.7);
  const rudTop = new THREE.Vector3(0, fst[2].x, fst[2].zle + (fst[2].zte - fst[2].zle) * 0.7);
  const rudAxis = rudTop.clone().sub(rudPivot).normalize();
  const finRoles: Role[] = ['wing', 'wing', 'violet'];
  const finMesh = mesh(fin, finRoles); finMesh.position.copy(finBase);
  const rudMesh = mesh(recentre(rud, rudPivot), finRoles); rudMesh.position.copy(finBase).add(rudPivot);

  // Body flap protects the engine cluster and supplies pitch authority during approach.
  const bodyFlap = mesh(new THREE.BoxGeometry(0.32, 0.025, 0.30), ['wing', 'wingBottom', 'violet']);
  bodyFlap.position.set(0, -0.17, 0.72);

  // Retractable tricycle gear. Each leg has its own pivot and paired main tyres.
  const gearRoots: THREE.Group[] = [], gearDoors: { mesh: THREE.Mesh; side: number }[] = [];
  const tyre = new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.94, metalness: 0.02 });
  const makeGear = (x: number, z: number, main: boolean) => {
    const root = new THREE.Group(); root.position.set(x, -0.145, z); group.add(root); gearRoots.push(root);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.026, main ? 0.25 : 0.22, 16), mats.chrome);
    strut.position.y = main ? -0.13 : -0.115; root.add(strut);
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(main ? 0.18 : 0.08, 0.025, 0.035), mats.chrome);
    bogie.position.y = main ? -0.255 : -0.225; root.add(bogie);
    for (const dx of main ? [-0.075, 0.075] : [0]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.035, 20), tyre);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(dx, -0.29, 0); root.add(wheel);
    }
    const door = mesh(new THREE.BoxGeometry(main ? 0.22 : 0.11, 0.012, main ? 0.22 : 0.20), 'wingBottom');
    door.position.set(x, -0.176, z); gearDoors.push({ mesh: door, side: x >= 0 ? 1 : -1 });
  };
  makeGear(0, -0.75, false); makeGear(-0.27, 0.05, true); makeGear(0.27, 0.05, true);
  const gearDrop = 0.493;
  for (let i = 0; i < gearRoots.length; i++) { gearRoots[i].visible = false; gearRoots[i].rotation.x = i === 0 ? 1.42 : -1.30; }

  // Wing-tip navigation lights: red port, green starboard, and a dorsal strobe on the fin.
  const blinkers: Shuttle['blinkers'] = [];
  for (const side of [1, -1]) {
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x4ade80 : 0xf87171 }));
    nav.position.set(side * 0.735, -0.14, 0.66);
    group.add(nav);
    blinkers.push({ mesh: nav, phase: side > 0 ? 0 : 0.5 });
  }
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.set(0, 0.40, 0.86);
  group.add(strobe);
  blinkers.push({ mesh: strobe, phase: 0.25 });

  // Orbital-manoeuvring pods: foil-wrapped, on the upper rear flanks, each with a small nozzle.
  const podProfile = ([[0, -0.22], [0.026, -0.2], [0.044, -0.14], [0.05, -0.02], [0.05, 0.12], [0.042, 0.2], [0.0, 0.21]] as const).map(([r, z]) => new THREE.Vector2(r, z));
  const bronzeSide = Object.assign(new THREE.MeshPhysicalMaterial({ color: 0x6b4a2a, metalness: 1, roughness: 0.4 }), { side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const podGeo = new THREE.LatheGeometry(podProfile, 32); podGeo.rotateX(Math.PI / 2);
    const pod = mesh(podGeo, 'nacelle'); pod.scale.set(1.15, 1.0, 1.25); pod.position.set(side * 0.22, 0.17, 0.43);
    const nz = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.06, 20, 1, true), bronzeSide);
    nz.rotation.x = -Math.PI / 2; nz.position.set(side * 0.22, 0.17, 0.70); body.add(nz);
  }

  // Three main engines in a triangle at the tail: housing, bell, glowing core and plume.
  const nozzles: THREE.Vector3[] = [];
  const engineMats: THREE.MeshBasicMaterial[] = [];
  const plumes: THREE.Mesh[] = [];
  const bellProfile = ([[0.018, 0.0], [0.024, 0.025], [0.034, 0.06], [0.05, 0.115], [0.062, 0.16]] as const).map(([r, z]) => new THREE.Vector2(r, z));
  for (const [x, y] of [[0, -0.0475], [-0.0975, -0.1375], [0.0975, -0.1375]] as const) {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.1, 24), mats.nacelle);
    roles.push({ mesh: housing, role: ['nacelle'] });
    housing.rotation.x = Math.PI / 2; housing.position.set(x, y, 0.83); body.add(housing);
    const bellGeo = new THREE.LatheGeometry(bellProfile, 32); bellGeo.rotateX(Math.PI / 2);
    const bell = mesh(Object.assign(bellGeo, {}), 'bell'); bell.position.set(x, y, 0.81);
    (bell.material as THREE.Material).side = THREE.DoubleSide;
    const core = new THREE.MeshBasicMaterial({ color: 0xc9bbff });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), core);
    disc.position.set(x, y, 0.968); disc.rotation.y = Math.PI; group.add(disc);
    engineMats.push(core);
    const plumeGeo = new THREE.ConeGeometry(0.06, 1, 20, 1, true);
    plumeGeo.translate(0, -0.5, 0);
    plumeGeo.rotateX(-Math.PI / 2); // tip trails backwards (+Z)
    const plume = new THREE.Mesh(plumeGeo, plumeMaterial());
    plume.position.set(x, y, 0.985);
    group.add(plume);
    plumes.push(plume);
    nozzles.push(new THREE.Vector3(x, y, 1.0));
  }

  // Reaction-control thrusters round the nose, mid-body and tail; also a docking probe and a belly antenna.
  const rcs: Shuttle['rcs'] = [];
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.7, metalness: 0.4 });
  for (const [z, r] of [[-1.00, 0.13], [-0.58, 0.20], [0.50, 0.22]] as const) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pos = new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r * 0.72, z);
      const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0).normalize();
      const nz = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 16, 1, true), bronzeSide);
      nz.position.copy(pos); nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); body.add(nz);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0095, 16), dark);
      hole.position.set(pos.x * 1.12, pos.y * 1.12, pos.z); hole.lookAt(pos.x * 3, pos.y * 3, pos.z); body.add(hole);
      rcs.push({ pos, dir });
    }
  }
  const probe = mesh(new THREE.CylinderGeometry(0.003, 0.012, 0.16, 16), 'chrome');
  probe.rotation.x = Math.PI / 2; probe.position.set(0, 0, -1.25);
  const blade = mesh(new THREE.BoxGeometry(0.004, 0.05, 0.05), 'chrome'); blade.position.set(0.05, -0.147, 0.1);

  const light = new THREE.PointLight(0x9d8cff, 1.5, 3);
  light.position.set(0, 0, 1.0);
  group.add(light);
  // Key and rim lights that travel with the ship, so its paint reads anywhere.
  const key = new THREE.PointLight(0xffffff, 0.45, 4);
  key.position.set(0.8, 1.2, -0.6);
  group.add(key);
  const rimL = new THREE.PointLight(0xb8a6ff, 0.35, 4);
  rimL.position.set(-1.2, 0.3, 0.8);
  group.add(rimL);

  // ---- the real orbiter ----
  let disposedNasa = false;
  loadNasaOrbiter().then((parts) => {
    if (disposedNasa) return;
    const M = nasaMaterials();
    const nasa = new THREE.Group(); nasa.name = 'nasa-orbiter';
    const hull = new THREE.Mesh(parts.hull, M.hull);
    for (const [g, m] of [[parts.glass, M.glass], [parts.metal, M.metal]] as const) nasa.add(new THREE.Mesh(g, m));
    nasa.add(hull);
    group.add(nasa);
    body.visible = false;
    // Flank wordmarks and the tail registration are projected onto the real skin as decals.
    hull.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const decal = (from: THREE.Vector3, dir: THREE.Vector3, size: THREE.Vector3, map: THREE.Texture, roll = 0) => {
      ray.set(from, dir.clone().normalize());
      const hit = ray.intersectObject(hull, false)[0];
      if (!hit || !hit.face) return;
      const n = hit.face.normal.clone().transformDirection(hull.matrixWorld);
      const probe = new THREE.Object3D(); probe.position.copy(hit.point); probe.lookAt(hit.point.clone().add(n)); probe.rotateZ(roll);
      const dm = new THREE.Mesh(
        new DecalGeometry(hull, hit.point, probe.rotation, size),
        new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.5 }),
      );
      nasa.add(dm);
    };
    const mark = wordmarkTexture('MONAD'), reg = wordmarkTexture('NX-1001');
    for (const side of [1, -1]) decal(new THREE.Vector3(side * 1.5, -0.04, -0.03), new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0.78, 0.16, 0.5), mark);
    // Registration number on the fin, both faces.
    for (const side of [1, -1]) decal(new THREE.Vector3(side * 0.6, 0.27, 0.8), new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0.3, 0.07, 0.4), reg);
    // Flight-deck anchors move to the real flight deck behind the windscreens.
    cockpitAnchors.eye.set(0, 0.043, -0.70); cockpitAnchors.target.set(0, 0.06, -3);
    // The flight deck in the real orbiter is about 0.2 wide, so the interior is scaled down to sit inside it.
    cockpit.scale.setScalar(0.38); cockpit.position.set(0, 0.043 - 0.38 * 0.18, -0.70 + 0.38 * 0.39);
    // Thrusters sit on the real skin: nose ring, forward ring, aft ring.
    const rings: [number, number, number, number][] = [[-0.98, 0.05, 0.04, -0.06], [-0.55, 0.15, 0.13, -0.05], [0.62, 0.19, 0.16, -0.05]];
    rings.forEach(([z, rx, ry, cy], r) => {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        rcs[r * 4 + i].pos.set(Math.sin(a) * rx, cy + Math.cos(a) * ry, z);
        rcs[r * 4 + i].dir.set(Math.sin(a), Math.cos(a), 0).normalize();
      }
    });
  }).catch((e) => console.warn('NASA orbiter failed to load; keeping the procedural shuttle.', e));

  const MAX_DEFLECT = 0.42;
  const tmpQ = new THREE.Quaternion();
  return {
    setCockpitView(on) { cockpit.visible = on; },
    group, cockpit: cockpitAnchors, nozzles, engineMats, plumes, blinkers, light, rcs, gearDrop,
    setControl(pitch, roll, yaw) {
      // Elevons move together for pitch (trailing edge down for nose-down) and in opposition for roll.
      for (const e of elevons) {
        const a = THREE.MathUtils.clamp(pitch + (e.side > 0 ? -roll : roll), -1, 1) * MAX_DEFLECT;
        e.obj.quaternion.copy(tmpQ.setFromAxisAngle(e.axis, a));
      }
      rudMesh.quaternion.copy(tmpQ.setFromAxisAngle(rudAxis, THREE.MathUtils.clamp(yaw, -1, 1) * MAX_DEFLECT * 0.8));
      bodyFlap.rotation.x = THREE.MathUtils.clamp(pitch, -1, 1) * MAX_DEFLECT * 0.55;
    },
    setGear(value) {
      const k = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(value, 0, 1), 0, 1);
      for (let i = 0; i < gearRoots.length; i++) {
        const root = gearRoots[i]; root.visible = value > 0.015;
        root.rotation.x = (1 - k) * (i === 0 ? 1.42 : -1.30);
      }
      for (const d of gearDoors) d.mesh.rotation.z = d.side * Math.sin(k * Math.PI) * 1.05;
    },
    setThrust(throttle, time, ignition = 0) {
      const k = THREE.MathUtils.clamp(throttle, 0, 1);
      for (const plume of plumes) {
        const mat = plume.material as THREE.ShaderMaterial;
        mat.uniforms.uThrottle.value = k; mat.uniforms.uTime.value = time; mat.uniforms.uIgnition.value = ignition;
        plume.visible = k > 0.005 || ignition > 0.005;
        plume.scale.set(0.8 + k * 0.55, 0.8 + k * 0.55, 0.08 + k * 2.2);
      }
      light.intensity = (k * 2.2 + ignition * 7) * (0.9 + Math.sin(time * 47) * 0.08);
      engineMats.forEach((m) => m.color.setHSL(0.62 + (1 - k) * 0.08, 0.82, 0.46 + k * 0.42));
    },
    applyMaterials(m) {
      Object.assign(mats, m);
      if (!m.wing && m.paint) mats.wing = m.paint;
      for (const { mesh: me, role } of roles) {
        if (role.length === 1) me.material = mats[role[0]]; else me.material = role.map((r) => mats[r]);
      }
    },
  };
}
