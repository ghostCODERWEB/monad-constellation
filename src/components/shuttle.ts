// The shuttle: a delta-wing spaceplane built from primitives and lofted
// surfaces, no model file. Points along -Z, so "forward" is the object's local
// (0, 0, -1). One long fuselage, thick swept delta wings with moving elevons,
// a single tail fin with a rudder, three main engines at the tail, two
// orbital-manoeuvring pods on the back, reaction-control thrusters round the
// nose, and a glazed cockpit. Used by the station hangar and the galaxy.
import * as THREE from 'three';

export interface Shuttle {
  group: THREE.Group;
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

function glowTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
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

export function buildShuttle(over: ShuttleMaterials = {}): Shuttle {
  const group = new THREE.Group();

  const paintDefault = new THREE.MeshPhysicalMaterial({
    map: hullTexture(), metalness: 0.45, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, color: 0x9a93b8,
    emissive: 0x150d36, emissiveIntensity: 0.08,
  });
  const violetDefault = new THREE.MeshPhysicalMaterial({ color: 0x6d5bd0, metalness: 0.8, roughness: 0.25, clearcoat: 1, emissive: 0x3b2a8c, emissiveIntensity: 0.15 });
  const gunmetalDefault = new THREE.MeshPhysicalMaterial({ color: 0x24203a, metalness: 0.9, roughness: 0.35, clearcoat: 0.6 });
  const chromeDefault = new THREE.MeshPhysicalMaterial({ color: 0xd8d4ec, metalness: 1, roughness: 0.12 });
  const canopyDefault = new THREE.MeshPhysicalMaterial({ color: 0x0b1a3a, metalness: 0.1, roughness: 0.02, clearcoat: 1, emissive: 0x22d3ee, emissiveIntensity: 0.35, transparent: true, opacity: 0.92 });
  const defaults: Required<ShuttleMaterials> = {
    paint: paintDefault, wing: paintDefault, wingBottom: gunmetalDefault, violet: violetDefault, nacelle: gunmetalDefault,
    bell: chromeDefault, chrome: chromeDefault, canopy: canopyDefault,
  };
  const mats = { ...defaults, ...over } as Required<ShuttleMaterials>;
  if (!over.wing && over.paint) mats.wing = over.paint;

  // Everything that takes a swappable surface registers here with its role.
  const roles: { mesh: THREE.Mesh; role: Role[] }[] = [];
  const mesh = (geo: THREE.BufferGeometry, role: Role | Role[], parent: THREE.Object3D = group) => {
    const rs = Array.isArray(role) ? role : [role];
    const m = new THREE.Mesh(geo, rs.length === 1 ? mats[rs[0]] : rs.map((r) => mats[r]));
    roles.push({ mesh: m, role: rs });
    parent.add(m);
    return m;
  };

  // Fuselage: a lathe profile, needle nose to a broad engine block, flattened to a lifting body.
  const profile = ([[0.0, -1.05], [0.035, -0.98], [0.075, -0.86], [0.12, -0.66], [0.155, -0.42], [0.18, -0.15], [0.19, 0.12], [0.185, 0.38], [0.17, 0.56], [0.15, 0.64], [0.0, 0.64]] as const).map(([r, z]) => new THREE.Vector2(r, z));
  const bodyGeo = new THREE.LatheGeometry(profile, 48);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.scale(1, 0.72, 1);
  mesh(bodyGeo, 'paint');

  // Cockpit: a glazed canopy with chrome mullions and a frame.
  const canopy = mesh(new THREE.SphereGeometry(0.11, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), 'canopy');
  canopy.scale.set(0.9, 0.62, 2.5); canopy.position.set(0, 0.095, -0.42);
  const rim = mesh(new THREE.TorusGeometry(0.1, 0.007, 8, 40), 'chrome');
  rim.rotation.x = Math.PI / 2; rim.scale.set(0.9, 2.5, 1); rim.position.set(0, 0.096, -0.42);
  for (const z of [-0.54, -0.42, -0.30]) {
    const bar = mesh(new THREE.TorusGeometry(0.1, 0.004, 6, 24, Math.PI), 'chrome');
    bar.scale.set(0.9, 0.62, 1); bar.position.set(0, 0.095, z); bar.rotation.y = 0;
  }

  // Delta wings: strake and main panel, with elevons that move.
  const st: Station[] = [
    { x: 0.10, y: -0.030, zle: -0.60, zte: 0.56, T: 0.075 },
    { x: 0.30, y: -0.034, zle: -0.30, zte: 0.54, T: 0.055 },
    { x: 0.66, y: -0.038, zle: 0.04, zte: 0.50, T: 0.030 },
    { x: 1.00, y: -0.040, zle: 0.30, zte: 0.46, T: 0.014 },
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
    { x: 0.04, y: 0, zle: 0.00, zte: 0.60, T: 0.05 },
    { x: 0.30, y: 0, zle: 0.22, zte: 0.58, T: 0.032 },
    { x: 0.58, y: 0, zle: 0.38, zte: 0.54, T: 0.014 },
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

  // Wing-tip navigation lights: red port, green starboard, and a dorsal strobe on the fin.
  const blinkers: Shuttle['blinkers'] = [];
  for (const side of [1, -1]) {
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x4ade80 : 0xf87171 }));
    nav.position.set(side * 1.0, -0.04, 0.38);
    group.add(nav);
    blinkers.push({ mesh: nav, phase: side > 0 ? 0 : 0.5 });
  }
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.set(0, 0.09 + 0.6, 0.5);
  group.add(strobe);
  blinkers.push({ mesh: strobe, phase: 0.25 });

  // Orbital-manoeuvring pods: foil-wrapped, on the upper rear flanks, each with a small nozzle.
  const podProfile = ([[0, -0.22], [0.026, -0.2], [0.044, -0.14], [0.05, -0.02], [0.05, 0.12], [0.042, 0.2], [0.0, 0.21]] as const).map(([r, z]) => new THREE.Vector2(r, z));
  const bronzeSide = Object.assign(new THREE.MeshPhysicalMaterial({ color: 0x6b4a2a, metalness: 1, roughness: 0.4 }), { side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const podGeo = new THREE.LatheGeometry(podProfile, 32); podGeo.rotateX(Math.PI / 2);
    const pod = mesh(podGeo, 'nacelle'); pod.scale.set(1, 0.9, 1); pod.position.set(side * 0.115, 0.108, 0.31);
    const nz = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.06, 20, 1, true), bronzeSide);
    nz.rotation.x = -Math.PI / 2; nz.position.set(side * 0.115, 0.108, 0.54); group.add(nz);
  }

  // Three main engines in a triangle at the tail: housing, bell, glowing core and plume.
  const nozzles: THREE.Vector3[] = [];
  const engineMats: THREE.MeshBasicMaterial[] = [];
  const plumes: THREE.Mesh[] = [];
  const plumeTex = glowTexture('rgba(255,255,255,1)', 'rgba(150,120,255,0.6)');
  const bellProfile = ([[0.018, 0.0], [0.024, 0.025], [0.034, 0.06], [0.05, 0.115], [0.062, 0.16]] as const).map(([r, z]) => new THREE.Vector2(r, z));
  for (const [x, y] of [[0, 0.065], [-0.082, -0.042], [0.082, -0.042]] as const) {
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.066, 0.1, 24), mats.nacelle);
    roles.push({ mesh: housing, role: ['nacelle'] });
    housing.rotation.x = Math.PI / 2; housing.position.set(x, y, 0.645); group.add(housing);
    const bellGeo = new THREE.LatheGeometry(bellProfile, 32); bellGeo.rotateX(Math.PI / 2);
    const bell = mesh(Object.assign(bellGeo, {}), 'bell'); bell.position.set(x, y, 0.64);
    (bell.material as THREE.Material).side = THREE.DoubleSide;
    const core = new THREE.MeshBasicMaterial({ color: 0xc9bbff });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), core);
    disc.position.set(x, y, 0.675); disc.rotation.y = Math.PI; group.add(disc);
    engineMats.push(core);
    const plumeGeo = new THREE.ConeGeometry(0.06, 1, 20, 1, true);
    plumeGeo.translate(0, -0.5, 0);
    plumeGeo.rotateX(-Math.PI / 2); // tip trails backwards (+Z)
    const plume = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({
      color: 0x9d8cff, map: plumeTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    plume.position.set(x, y, 0.8);
    group.add(plume);
    plumes.push(plume);
    nozzles.push(new THREE.Vector3(x, y, 0.82));
  }

  // Reaction-control thrusters round the nose, mid-body and tail; also a docking probe and a belly antenna.
  const rcs: Shuttle['rcs'] = [];
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.7, metalness: 0.4 });
  for (const [z, r] of [[-0.84, 0.12], [-0.55, 0.155], [0.28, 0.185]] as const) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const pos = new THREE.Vector3(Math.sin(a) * r, Math.cos(a) * r * 0.72, z);
      const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0).normalize();
      const nz = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 16, 1, true), bronzeSide);
      nz.position.copy(pos); nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); group.add(nz);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0095, 16), dark);
      hole.position.set(pos.x * 1.12, pos.y * 1.12, pos.z); hole.lookAt(pos.x * 3, pos.y * 3, pos.z); group.add(hole);
      rcs.push({ pos, dir });
    }
  }
  const probe = mesh(new THREE.CylinderGeometry(0.003, 0.012, 0.16, 16), 'chrome');
  probe.rotation.x = Math.PI / 2; probe.position.set(0, 0, -1.12);
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

  group.scale.setScalar(1.15);

  const MAX_DEFLECT = 0.42;
  const tmpQ = new THREE.Quaternion();
  return {
    group, nozzles, engineMats, plumes, blinkers, light, rcs,
    setControl(pitch, roll, yaw) {
      // Elevons move together for pitch (trailing edge down for nose-down) and in opposition for roll.
      for (const e of elevons) {
        const a = THREE.MathUtils.clamp(pitch + (e.side > 0 ? -roll : roll), -1, 1) * MAX_DEFLECT;
        e.obj.quaternion.copy(tmpQ.setFromAxisAngle(e.axis, a));
      }
      rudMesh.quaternion.copy(tmpQ.setFromAxisAngle(rudAxis, THREE.MathUtils.clamp(yaw, -1, 1) * MAX_DEFLECT * 0.8));
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
