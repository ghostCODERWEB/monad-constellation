// The station: modules, racks, rails, hatches, windows, exterior. Units are
// metres; +Y points away from Earth. Interior collision comes from the same
// numbers that place the walls, so what you see is what you bump into.
//
//   habitation  [hub]  research  observation
//      x−          │      x+          x++
//            airlock z+ · hangar z− (via a short tunnel)
import * as THREE from 'three';
import { Space, box, cyl } from '../core/space';
import { labelTexture, panelBump, panelTexture, patchTexture, rackTexture, type RackKind } from './textures';

export interface Rail { a: THREE.Vector3; b: THREE.Vector3 }

export interface Anchors {
  spawn: THREE.Vector3;
  telescopeBase: THREE.Vector3;
  telescopeEye: THREE.Vector3;
  workstation: THREE.Vector3;
  workstationSeat: THREE.Vector3;
  missionControl: THREE.Vector3;
  airlockInner: THREE.Vector3;
  airlockOuter: THREE.Vector3;
  airlockConsole: THREE.Vector3;
  hangarConsole: THREE.Vector3;
  shuttleDock: THREE.Vector3;
  sleeping: THREE.Vector3;
  galley: THREE.Vector3;
  cupola: THREE.Vector3;
}

export interface Station {
  interior: THREE.Group;
  exterior: THREE.Group;
  space: Space;
  rails: Rail[];
  anchors: Anchors;
  /** Doors the airlock and hangar animate. */
  doors: { airlockInner: THREE.Object3D; airlockOuter: THREE.Object3D; hangarLeft: THREE.Object3D; hangarRight: THREE.Object3D };
  /** The pressure hull seen from outside: hidden while the camera is aboard, or its end caps would wall off every hatch. */
  hull: THREE.Group;
  /** Spots where props can be placed (wall position + inward normal). */
  wallSpots: { zone: string; pos: THREE.Vector3; normal: THREE.Vector3 }[];
  glass: THREE.Material;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildStation(): Station {
  const interior = new THREE.Group();
  interior.name = 'interior';
  const exterior = new THREE.Group();
  exterior.name = 'exterior';
  const space = new Space();
  const rails: Rail[] = [];
  const wallSpots: Station['wallSpots'] = [];

  // ---------- materials ----------
  const wallMat = new THREE.MeshStandardMaterial({ map: panelTexture([2, 1]), bumpMap: panelBump([2, 1]), bumpScale: 0.6, roughness: 0.62, metalness: 0.15 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x9ea1aa, roughness: 0.35, metalness: 0.75 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2b33, roughness: 0.55, metalness: 0.5 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd7b54a, roughness: 0.45, metalness: 0.35 });
  const cableMats = [0x1f2937, 0x374151, 0x7c2d12, 0x1e3a8a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 0.85 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x836ef9, emissive: 0x836ef9, emissiveIntensity: 0.9 });
  const velcroMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
  const mliMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.75, metalness: 0.05, map: panelTexture([4, 2]) });

  const add = (m: THREE.Object3D, g = interior) => { g.add(m); return m; };
  const plane = (w: number, h: number, mat: THREE.Material) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);

  /**
   * A face of a box room, built as quads around an optional square opening.
   * `n` is the inward normal; `c` the face centre; `u`/`v` the in-plane axes.
   */
  const face = (c: THREE.Vector3, n: THREE.Vector3, u: THREE.Vector3, w: number, h: number, hole?: number, mat: THREE.Material = wallMat) => {
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const put = (cx: number, cy: number, pw: number, ph: number) => {
      if (pw <= 0.01 || ph <= 0.01) return;
      const p = plane(pw, ph, mat);
      const m = new THREE.Matrix4().makeBasis(u, v, n);
      p.quaternion.setFromRotationMatrix(m);
      p.position.copy(c).addScaledVector(u, cx).addScaledVector(v, cy);
      add(p);
    };
    if (!hole) { put(0, 0, w, h); return; }
    const hh = hole;
    put(0, (h / 2 + hh) / 2, w, h / 2 - hh);
    put(0, -(h / 2 + hh) / 2, w, h / 2 - hh);
    put((w / 2 + hh) / 2, 0, w / 2 - hh, hh * 2);
    put(-(w / 2 + hh) / 2, 0, w / 2 - hh, hh * 2);
  };

  /**
   * A face with windows cut through it: `rects` are [x0, y0, x1, y1] in the
   * face's u/v frame. A rect marked `open` is a doorway (no glass); the rest
   * get glass and a metal bezel. UVs are normalised so the panel texture tiles
   * as it does on a plain face.
   */
  const windowFace = (c: THREE.Vector3, n: THREE.Vector3, u: THREE.Vector3, w: number, h: number, rects: { r: [number, number, number, number]; open?: boolean }[], mat: THREE.Material = wallMat) => {
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const shape = new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2)]);
    for (const { r: [x0, y0, x1, y1] } of rects) shape.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)]));
    const geo = new THREE.ShapeGeometry(shape);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + w / 2) / w, (uv.getY(i) + h / 2) / h);
    const g = new THREE.Group();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    g.position.copy(c);
    g.add(new THREE.Mesh(geo, mat));
    for (const { r: [x0, y0, x1, y1], open } of rects) {
      if (open) continue;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), glass);
      pane.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.03);
      g.add(pane);
      const t = 0.07;
      for (const [x, y, bw, bh] of [[(x0 + x1) / 2, y1 + t / 2, x1 - x0 + t * 2, t], [(x0 + x1) / 2, y0 - t / 2, x1 - x0 + t * 2, t], [x0 - t / 2, (y0 + y1) / 2, t, y1 - y0], [x1 + t / 2, (y0 + y1) / 2, t, y1 - y0]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), frameMat);
        b.position.set(x, y, 0);
        g.add(b);
      }
    }
    add(g);
  };

  /** A hatch frame around a square opening, with the hatch door swung aside. */
  const hatch = (c: THREE.Vector3, n: THREE.Vector3, half: number, open = true, swing = 1) => {
    const g = new THREE.Group();
    const t = 0.12, d = 0.18;
    const parts: [number, number, number, number][] = [[0, half + t / 2, half * 2 + t * 2, t], [0, -half - t / 2, half * 2 + t * 2, t], [half + t / 2, 0, t, half * 2], [-half - t / 2, 0, t, half * 2]];
    for (const [x, y, w, h] of parts) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      b.position.set(x, y, 0);
      g.add(b);
    }
    // Warning chevrons on the frame.
    const chev = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 0.08), new THREE.MeshStandardMaterial({ map: labelTexture(['▲ HATCH ▲'], { bg: '#facc15', fg: '#111', w: 256, h: 32, font: 18 }) }));
    chev.position.set(0, half + t + 0.05, d / 2 + 0.001);
    g.add(chev);
    let door: THREE.Object3D = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(half * 2, half * 2, 0.08), new THREE.MeshStandardMaterial({ color: 0xc8c5be, roughness: 0.5, metalness: 0.4, map: rackTexture('grille', 99) }));
    const pivot = new THREE.Group();
    pivot.position.set(-half, 0, 0);
    slab.position.set(half, 0, 0);
    pivot.add(slab);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 16, Math.PI), railMat);
    handle.position.set(half * 1.6, 0, 0.06);
    pivot.add(handle);
    pivot.rotation.y = open ? -Math.PI * 0.55 * swing : 0;
    if (swing < 0) { pivot.position.x = half; slab.position.x = -half; handle.position.x = -half * 1.6; }
    g.add(pivot);
    door = pivot;
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.position.copy(c);
    add(g);
    return door;
  };

  const RACKS: RackKind[] = ['lockers', 'equipment', 'bags', 'science', 'lockers', 'grille', 'bags', 'equipment'];

  /** A rack-lined module along x, square section of half-size `s`. */
  const moduleX = (zone: string, x0: number, x1: number, s: number, opts: { racks?: boolean; rails?: boolean; seed?: number } = {}) => {
    space.add(box(zone, zone, [x0, -s, -s], [x1, s, s]));
    const len = x1 - x0, cx = (x0 + x1) / 2;
    const walls: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
      [V(cx, -s, 0), V(0, 1, 0), V(1, 0, 0)],
      [V(cx, s, 0), V(0, -1, 0), V(1, 0, 0)],
      [V(cx, 0, -s), V(0, 0, 1), V(1, 0, 0)],
      // Facing this wall from inside, "right" is −x: keeps its labels upright and readable.
      [V(cx, 0, s), V(0, 0, -1), V(-1, 0, 0)],
    ];
    walls.forEach(([c, n, uAxis], wi) => {
      face(c, n, uAxis, len, s * 2);
      if (opts.racks === false) return;
      // Racks: about a metre each, inset slightly, faces of varied kinds.
      const count = Math.max(1, Math.floor(len / 1.05));
      for (let i = 0; i < count; i++) {
        const kind = RACKS[(i + wi * 3 + (opts.seed ?? 0)) % RACKS.length];
        const rx = x0 + (i + 0.5) * (len / count);
        const r = plane(len / count - 0.08, s * 2 - 0.25, new THREE.MeshStandardMaterial({ map: rackTexture(kind, i + wi * 7 + (opts.seed ?? 0)), roughness: 0.6, metalness: 0.1 }));
        const v = new THREE.Vector3().crossVectors(n, uAxis).normalize();
        r.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(uAxis, v, n));
        r.position.copy(c).setX(rx).addScaledVector(n, 0.04);
        add(r);
        if (i % 2 === 0) wallSpots.push({ zone, pos: r.position.clone().addScaledVector(n, 0.05), normal: n.clone() });
      }
    });
    // Ceiling light strips along the two upper edges, with a purple accent line.
    for (const z of [-s + 0.18, s - 0.18]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.04, 0.12), lightMat);
      l.position.set(cx, s - 0.06, z);
      add(l);
      const a = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.012, 0.02), accentMat);
      a.position.set(cx, -s + 0.03, z);
      add(a);
    }
    // Handrails on two walls, and cable runs in two corners.
    if (opts.rails !== false) {
      for (const [y, z] of [[0.55 * s, -s + 0.1], [-0.55 * s, s - 0.1]]) {
        const a = V(x0 + 0.5, y, z), b = V(x1 - 0.5, y, z);
        rails.push({ a, b });
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len - 1, 10), railMat);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(cx, y, z);
        add(rod);
        for (let x = x0 + 0.5; x <= x1 - 0.5 + 1e-6; x += (len - 1) / Math.max(1, Math.round((len - 1) / 1.6))) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8), railMat);
          st.position.set(x, y, z + (z < 0 ? -0.05 : 0.05));
          st.rotation.x = Math.PI / 2;
          add(st);
        }
      }
    }
    for (const [y, z, k] of [[-s + 0.06, -s + 0.06, 0], [s - 0.06, s - 0.06, 1]] as const) {
      for (let j = 0; j < 3; j++) {
        const pts = [];
        for (let i = 0; i <= 12; i++) pts.push(V(x0 + 0.3 + (len - 0.6) * (i / 12), y + Math.sin(i * 1.3 + j) * 0.015 + (k ? -j * 0.03 : j * 0.03), z + Math.cos(i * 0.9 + j) * 0.015));
        add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6, false), cableMats[(j + k) % cableMats.length]));
      }
    }
    // Velcro patches: crews stick things to walls with them.
    const velcro = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.12), velcroMat, 18);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 18; i++) {
      const w = walls[i % 4];
      const n = w[1];
      const pos = w[0].clone().setX(x0 + 0.4 + ((i * 0.61) % 1) * (len - 0.8)).addScaledVector(n, 0.05);
      const v = new THREE.Vector3().crossVectors(n, V(1, 0, 0)).normalize();
      pos.addScaledVector(v, (((i * 0.37) % 1) - 0.5) * s);
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(1, 0, 0), v, n));
      velcro.setMatrixAt(i, m4.compose(pos, q, V(1, 1, 1)));
    }
    add(velcro);
    const light = new THREE.PointLight(0xfff1e0, 3.2, s * 8, 2);
    light.position.set(cx, s * 0.6, 0);
    add(light);
  };

  // ---------- hub: mission control node ----------
  const H = 2.4;
  space.add(box('hub', 'Mission control', [-H, -H, -H], [H, H, H]));
  // South: the hangar tunnel hatch, flanked by a gallery of windows onto the hangar.
  windowFace(V(0, 0, -H), V(0, 0, 1), V(1, 0, 0), H * 2, H * 2, [
    { r: [-0.95, -0.95, 0.95, 0.95], open: true },
    { r: [-2.15, -1.55, -1.25, 1.75] }, { r: [1.25, -1.55, 2.15, 1.75] }, { r: [-0.95, 1.2, 0.95, 1.75] },
  ]);
  face(V(0, 0, H), V(0, 0, -1), V(-1, 0, 0), H * 2, H * 2, 0.85);    // north: airlock
  face(V(H, 0, 0), V(-1, 0, 0), V(0, 0, 1), H * 2, H * 2, 0.95);     // east: research
  face(V(-H, 0, 0), V(1, 0, 0), V(0, 0, -1), H * 2, H * 2, 0.95);    // west: habitation
  face(V(0, H, 0), V(0, -1, 0), V(1, 0, 0), H * 2, H * 2);           // ceiling
  // Floor with a round nadir window: Earth is right there.
  {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, H * 1.42, 48, 1), wallMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, -H, 0);
    const clip = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), wallMat);
    clip.visible = false;
    add(ring);
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), glass);
    win.rotation.x = -Math.PI / 2;
    win.position.set(0, -H - 0.02, 0);
    add(win);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.05, 10, 48), frameMat);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0, -H + 0.01, 0);
    add(bezel);
  }
  // Hub corner lights.
  for (const [x, z] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.5), lightMat);
    l.position.set(x, H - 0.03, z);
    add(l);
  }
  const hubLight = new THREE.PointLight(0xfff1e0, 5, 12, 2);
  hubLight.position.set(0, 1.6, 0);
  add(hubLight);
  // Hub rails ring the doorways.
  for (const [a, b] of [[V(-1.6, 1.3, -H + 0.1), V(1.6, 1.3, -H + 0.1)], [V(-1.6, 1.3, H - 0.1), V(1.6, 1.3, H - 0.1)], [V(-H + 0.1, 1.3, -1.6), V(-H + 0.1, 1.3, 1.6)], [V(H - 0.1, 1.3, -1.6), V(H - 0.1, 1.3, 1.6)]]) {
    rails.push({ a, b });
    const len = a.distanceTo(b);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 10), railMat);
    rod.position.copy(a).add(b).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    add(rod);
  }

  // ---------- doorways and modules ----------
  const door = (zone: string, axis: 'x' | 'z', a: number, b: number, half: number) => {
    space.add(axis === 'x' ? box(`${zone}-door`, zone, [a, -half, -half], [b, half, half]) : box(`${zone}-door`, zone, [-half, -half, a], [half, half, b]));
    // The sleeve through the wall: four short plates, so no gap shows.
    const len = b - a, mid = (a + b) / 2;
    const along = axis === 'x' ? V(1, 0, 0) : V(0, 0, 1);
    const sides: [THREE.Vector3, THREE.Vector3][] = axis === 'x'
      ? [[V(mid, half, 0), V(0, -1, 0)], [V(mid, -half, 0), V(0, 1, 0)], [V(mid, 0, half), V(0, 0, -1)], [V(mid, 0, -half), V(0, 0, 1)]]
      : [[V(0, half, mid), V(0, -1, 0)], [V(0, -half, mid), V(0, 1, 0)], [V(half, 0, mid), V(-1, 0, 0)], [V(-half, 0, mid), V(1, 0, 0)]];
    for (const [c, n] of sides) {
      const u = along.clone();
      const v = new THREE.Vector3().crossVectors(n, u).normalize();
      const p = plane(len, half * 2, frameMat);
      p.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
      p.position.copy(c);
      add(p);
    }
  };

  // Research module (east).
  door('Research module', 'x', 2.2, 3.0, 0.95);
  hatch(V(H + 0.0, 0, 0), V(-1, 0, 0), 0.95, true, -1); // swings north, clear of the hangar gallery
  moduleX('Research module', 2.8, 11.2, 1.5, { seed: 1 });
  face(V(2.8, 0, 0), V(1, 0, 0), V(0, 0, -1), 3, 3, 0.95);
  face(V(11.2, 0, 0), V(-1, 0, 0), V(0, 0, 1), 3, 3, 0.95);

  // Observation module (east of research): bigger, with a great round window.
  door('Observation module', 'x', 11.0, 11.8, 0.95);
  hatch(V(11.2, 0, 0), V(1, 0, 0), 0.95);
  const OS = 2.2;
  space.add(box('Observation module', 'Observation module', [11.6, -OS, -OS], [17.6, OS, OS]));
  {
    const len = 6, cx = 14.6;
    face(V(cx, OS, 0), V(0, -1, 0), V(1, 0, 0), len, OS * 2);
    face(V(cx, 0, -OS), V(0, 0, 1), V(1, 0, 0), len, OS * 2);
    face(V(cx, 0, OS), V(0, 0, -1), V(1, 0, 0), len, OS * 2);
    face(V(11.6, 0, 0), V(1, 0, 0), V(0, 0, -1), OS * 2, OS * 2, 0.95);
    // Belly window strip.
    face(V(cx - 2, -OS, 0), V(0, 1, 0), V(1, 0, 0), 2, OS * 2);
    face(V(cx + 2.5, -OS, 0), V(0, 1, 0), V(1, 0, 0), 1, OS * 2);
    for (const z of [-OS + 0.6, OS - 0.6]) face(V(cx + 0.5, -OS, z), V(0, 1, 0), V(1, 0, 0), 3, 1.2);
    const belly = new THREE.Mesh(new THREE.PlaneGeometry(3, OS * 2 - 2.4), glass);
    belly.rotation.x = -Math.PI / 2;
    belly.position.set(cx + 0.5, -OS - 0.02, 0);
    add(belly);
    // The great window on the end cap.
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, OS * 1.42, 64, 1), wallMat);
    ring.rotation.y = -Math.PI / 2;
    ring.position.set(17.6, 0, 0);
    add(ring);
    const win = new THREE.Mesh(new THREE.CircleGeometry(1.75, 64), glass);
    win.rotation.y = -Math.PI / 2;
    win.position.set(17.62, 0, 0);
    add(win);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.07, 12, 64), frameMat);
    bezel.rotation.y = Math.PI / 2;
    bezel.position.set(17.58, 0, 0);
    add(bezel);
    for (let i = 0; i < 8; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), frameMat);
      b.position.set(17.55, Math.sin(i / 8 * Math.PI * 2) * 1.88, Math.cos(i / 8 * Math.PI * 2) * 1.88);
      add(b);
    }
    for (const [y, z] of [[OS - 0.25, -OS + 0.25], [OS - 0.25, OS - 0.25]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.04, 0.14), lightMat);
      l.position.set(cx, y, z);
      add(l);
    }
    const light = new THREE.PointLight(0xe8e0ff, 4, 14, 2);
    light.position.set(cx - 1, OS * 0.6, 0);
    add(light);
    for (const z of [-OS + 0.1, OS - 0.1]) {
      const a = V(12.1, 0.9, z), b = V(17.1, 0.9, z);
      rails.push({ a, b });
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 5, 10), railMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(14.6, 0.9, z);
      add(rod);
    }
  }

  // Habitation (west): sleeping quarters and the galley.
  door('Habitation module', 'x', -3.0, -2.2, 0.95);
  hatch(V(-H, 0, 0), V(1, 0, 0), 0.95);
  moduleX('Habitation module', -11.2, -2.8, 1.5, { seed: 5 });
  face(V(-2.8, 0, 0), V(-1, 0, 0), V(0, 0, 1), 3, 3, 0.95);
  face(V(-11.2, 0, 0), V(1, 0, 0), V(0, 0, -1), 3, 3);

  // Airlock (north): a cylinder with an inner and an outer hatch.
  door('Airlock', 'z', 2.2, 3.0, 0.85);
  const airlockInner = hatch(V(0, 0, H), V(0, 0, -1), 0.85, true);
  space.add(cyl('Airlock', 'Airlock', 'z', 2.8, 6.6, 0, 0, 1.3));
  {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.32, 3.8, 40, 1, true), new THREE.MeshStandardMaterial({ map: panelTexture([4, 1]), roughness: 0.6, metalness: 0.2, side: THREE.BackSide }));
    shell.rotation.x = Math.PI / 2;
    shell.position.set(0, 0, 4.7);
    add(shell);
    const back = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.32, 40), wallMat);
    back.position.set(0, 0, 2.8);
    add(back);
    const endRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.32, 40), wallMat);
    endRing.rotation.y = Math.PI;
    endRing.position.set(0, 0, 6.6);
    add(endRing);
    const light = new THREE.PointLight(0xffe6c0, 2.2, 6, 2);
    light.position.set(0, 0.9, 4.6);
    add(light);
    for (const x of [-1.05, 1.05]) {
      const a = V(x, 0, 3.0), b = V(x, 0, 6.4);
      rails.push({ a, b });
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 3.4, 10), railMat);
      rod.rotation.x = Math.PI / 2;
      rod.position.set(x, 0, 4.7);
      add(rod);
    }
  }
  const airlockOuter = (() => {
    const pivot = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.1, 40), new THREE.MeshStandardMaterial({ color: 0xc8c5be, roughness: 0.45, metalness: 0.5 }));
    slab.rotation.x = Math.PI / 2;
    slab.position.set(0.78, 0, 0);
    pivot.add(slab);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 8, 24), railMat);
    wheel.position.set(0.78, 0, -0.08);
    pivot.add(wheel);
    pivot.position.set(-0.78, 0, 6.62);
    add(pivot);
    return pivot;
  })();

  // Tunnel and hangar (south).
  door('Hangar', 'z', -3.0, -2.2, 0.95);
  // This hatch slides into the wall rather than swinging, so the gallery windows stay clear.
  hatch(V(0, 0, -H), V(0, 0, 1), 0.95).visible = false;
  space.add(cyl('Hangar tunnel', 'Hangar', 'z', -5.2, -2.8, 0, 0, 1.15));
  door('Hangar', 'z', -5.6, -4.8, 0.95);
  {
    // A glass walkway: the shuttle is on show from the moment you leave mission control.
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.17, 1.17, 2.4, 32, 1, true), glass);
    shell.rotation.x = Math.PI / 2;
    shell.position.set(0, 0, -4.0);
    add(shell);
    for (const z of [-2.55, -3.2, -4.0, -4.8, -5.1]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.17, 0.035, 8, 40), frameMat);
      rib.position.set(0, 0, z);
      add(rib);
    }
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 2.4), frameMat);
    floor.position.set(0, -1.05, -4.0);
    add(floor);
    for (const x of [-0.9, 0.9]) {
      const a = V(x, 0.4, -2.9), b = V(x, 0.4, -5.1);
      rails.push({ a, b });
    }
  }
  const HG = { x: 6, y: 4, z0: -22, z1: -5.2 };
  space.add(box('Hangar', 'Hangar', [-HG.x, -HG.y, HG.z0], [HG.x, HG.y, HG.z1]));
  const hangarMat = new THREE.MeshStandardMaterial({ map: panelTexture([6, 3]), bumpMap: panelBump([6, 3]), bumpScale: 0.6, roughness: 0.5, metalness: 0.35, color: 0xb9b7b2 });
  {
    const len = HG.z1 - HG.z0, cz = (HG.z0 + HG.z1) / 2;
    face(V(0, -HG.y, cz), V(0, 1, 0), V(1, 0, 0), HG.x * 2, len, undefined, hangarMat);
    face(V(0, HG.y, cz), V(0, -1, 0), V(1, 0, 0), HG.x * 2, len, undefined, hangarMat);
    face(V(-HG.x, 0, cz), V(1, 0, 0), V(0, 0, 1), len, HG.y * 2, undefined, hangarMat);
    face(V(HG.x, 0, cz), V(-1, 0, 0), V(0, 0, -1), len, HG.y * 2, undefined, hangarMat);
    // The hangar's station-side wall is mostly glass: the shuttle is on show from mission control.
    windowFace(V(0, 0, HG.z1), V(0, 0, -1), V(-1, 0, 0), HG.x * 2, HG.y * 2, [
      { r: [-0.95, -0.95, 0.95, 0.95], open: true },
      { r: [-5.2, -2.6, -1.4, 2.9] }, { r: [1.4, -2.6, 5.2, 2.9] }, { r: [-1.4, 1.4, 1.4, 2.9] },
    ], hangarMat);
    // Floor markings and docking lights.
    for (let z = HG.z0 + 1; z < HG.z1 - 0.5; z += 2) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x806600, emissiveIntensity: 0.4 }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, -HG.y + 0.01, z);
      add(m);
    }
    for (const x of [-HG.x + 0.05, HG.x - 0.05]) for (let z = HG.z0 + 2; z < HG.z1; z += 3) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.6), lightMat);
      l.position.set(x, HG.y - 0.4, z);
      add(l);
    }
    const sign = plane(3.4, 0.5, new THREE.MeshStandardMaterial({ map: labelTexture(['PLEASE SECURE ALL BELONGINGS, INCLUDING YOUR EXPECTATIONS'], { bg: '#1f2937', fg: '#facc15', w: 1024, h: 150, font: 30 }) }));
    sign.position.set(0, 3.4, HG.z1 - 0.05);
    sign.rotation.y = Math.PI;
    add(sign);
    for (const [x, y] of [[-3, 2.5], [3, 2.5]]) {
      const l = new THREE.PointLight(0xe0e8ff, 14, 26, 2);
      l.position.set(x, y, cz);
      add(l);
    }
    for (const x of [-HG.x + 0.12, HG.x - 0.12]) {
      const a = V(x, 1.5, HG.z1 - 0.6), b = V(x, 1.5, HG.z0 + 1.5);
      rails.push({ a, b });
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, a.distanceTo(b), 10), railMat);
      rod.rotation.x = Math.PI / 2;
      rod.position.copy(a).add(b).multiplyScalar(0.5);
      add(rod);
    }
  }
  // Hangar doors at the far end: two leaves that slide apart.
  const doorMat = new THREE.MeshStandardMaterial({ map: rackTexture('grille', 42), color: 0xd8d6d0, roughness: 0.5, metalness: 0.5 });
  const hangarLeft = new THREE.Mesh(new THREE.BoxGeometry(HG.x, HG.y * 2, 0.2), doorMat);
  hangarLeft.position.set(-HG.x / 2, 0, HG.z0);
  const hangarRight = hangarLeft.clone();
  hangarRight.position.set(HG.x / 2, 0, HG.z0);
  add(hangarLeft); add(hangarRight);
  for (const d of [hangarLeft, hangarRight]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(HG.x - 0.4, 0.3), new THREE.MeshStandardMaterial({ map: labelTexture(['◢◤◢◤◢◤◢◤◢◤◢◤'], { bg: '#facc15', fg: '#111', w: 512, h: 48, font: 30 }) }));
    stripe.position.set(0, -HG.y + 0.5, 0.11);
    d.add(stripe);
  }

  // ---------- mission patches ----------
  const patchMat = new THREE.MeshStandardMaterial({ map: patchTexture(), transparent: true, roughness: 0.7 });
  for (const [pos, rotY] of [[V(0, 1.6, H - 0.03), Math.PI], [V(13.0, 1.5, -OS + 0.03), 0]] as const) {
    const p = plane(0.6, 0.6, patchMat);
    p.position.copy(pos);
    p.rotation.y = rotY;
    add(p);
  }

  // ---------- exterior ----------
  const hull = new THREE.Group();
  hull.name = 'hull';
  exterior.add(hull);
  {
    const shellAt = (x0: number, x1: number, r: number) => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 40, 1), mliMat);
      s.rotation.z = Math.PI / 2;
      s.position.set((x0 + x1) / 2, 0, 0);
      hull.add(s);
      for (const x of [x0, x1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 40), frameMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(x, 0, 0);
        hull.add(ring);
      }
    };
    shellAt(2.8, 11.2, 2.15);
    shellAt(-11.2, -2.8, 2.15);
    const node = new THREE.Mesh(new THREE.BoxGeometry(H * 2 + 0.3, H * 2 + 0.3, H * 2 + 0.3), mliMat);
    hull.add(node);
    const obs = new THREE.Mesh(new THREE.CylinderGeometry(OS * 1.45, OS * 1.45, 6, 48, 1, false, 0, Math.PI * 2), mliMat);
    obs.rotation.z = Math.PI / 2;
    obs.position.set(14.6, 0, 0);
    hull.add(obs);
    const al = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 4, 32), mliMat);
    al.rotation.x = Math.PI / 2;
    al.position.set(0, 0, 4.7);
    hull.add(al);
    const hangarShell = new THREE.Mesh(new THREE.BoxGeometry(HG.x * 2 + 0.4, HG.y * 2 + 0.4, HG.z1 - HG.z0), mliMat);
    hangarShell.position.set(0, 0, (HG.z0 + HG.z1) / 2);
    hull.add(hangarShell);
    // Truss above the station, carrying solar wings and radiators.
    const truss = new THREE.Group();
    const trussMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.4, metalness: 0.7 });
    for (let x = -28; x <= 28; x += 2) {
      for (const [y, z] of [[5.6, -0.7], [5.6, 0.7], [7.0, -0.7], [7.0, 0.7]]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.08), trussMat);
        b.position.set(x, y, z);
        truss.add(b);
      }
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), trussMat);
      d.position.set(x - 1, 6.3, 0);
      d.rotation.x = 0.5;
      truss.add(d);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.4, 12), trussMat);
    mast.position.set(0, 4.0, 0);
    truss.add(mast);
    const cellTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 512;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0a1a3a'; g.fillRect(0, 0, 256, 512);
      for (let y = 0; y < 512; y += 16) for (let x = 0; x < 256; x += 16) { g.fillStyle = `rgb(${18 + (x + y) % 9},${40 + (x * y) % 13},${110 + (y % 30)})`; g.fillRect(x + 1, y + 1, 14, 14); }
      g.strokeStyle = '#c0a060'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 510);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const cellMat = new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.25, metalness: 0.6, side: THREE.DoubleSide });
    for (const x of [-24, -18, 18, 24]) for (const z of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 16), cellMat);
      wing.rotation.x = -Math.PI / 2;
      wing.position.set(x, 6.3, z * 9.2);
      truss.add(wing);
    }
    const radMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide });
    for (const x of [-8, 8]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(3, 9), radMat);
      r.position.set(x, 9.5, 0);
      truss.add(r);
    }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
    dish.position.set(4, 8.2, 2);
    dish.rotation.x = -0.6;
    truss.add(dish);
    for (const [x, h] of [[-4, 2.4], [6, 1.6], [-12, 2.0]]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 6), trussMat);
      ant.position.set(x, 7.0 + h / 2, -0.6);
      truss.add(ant);
    }
    exterior.add(truss);
    // Exterior handrails along the airlock and research shell: EVA routes.
    const extRailMat = new THREE.MeshStandardMaterial({ color: 0xd7b54a, roughness: 0.5, metalness: 0.3 });
    const extRails: [THREE.Vector3, THREE.Vector3][] = [
      [V(0.9, 1.5, 6.4), V(0.9, 1.5, 2.8)], [V(0.9, 2.5, 2.4), V(10.5, 2.5, 2.4)], [V(-0.9, 2.5, 2.4), V(-10.5, 2.5, 2.4)],
      [V(0, 2.6, 2.6), V(0, 5.4, 0.8)], [V(11, 2.5, 2.4), V(16.8, 3.2, 3.2)],
    ];
    for (const [a, b] of extRails) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, a.distanceTo(b), 8), extRailMat);
      rod.position.copy(a).add(b).multiplyScalar(0.5);
      rod.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      exterior.add(rod);
      exterior.userData.rails = [...(exterior.userData.rails ?? []), { a, b }];
    }
    // Exterior patch.
    const extPatch = plane(2.2, 2.2, patchMat);
    extPatch.position.set(7, 0, 2.17);
    hull.add(extPatch);
  }

  const anchors: Anchors = {
    spawn: V(0, 0.2, 0),
    telescopeBase: V(15.4, -0.7, 0),
    telescopeEye: V(14.3, 0.35, 0),
    workstation: V(8.2, -0.25, -1.2),
    workstationSeat: V(8.2, 0.05, -0.35),
    missionControl: V(0, 0.4, -2.0),
    airlockInner: V(0, 0, 2.6),
    airlockOuter: V(0, 0, 6.5),
    airlockConsole: V(1.0, 0.4, 3.4),
    hangarConsole: V(-1.4, 0.6, -5.6),
    shuttleDock: V(0, -0.6, -11.5),
    sleeping: V(-4.6, 0, 1.4),
    galley: V(-8.2, 0, -1.4),
    cupola: V(14.6, -1.6, 0),
  };

  return {
    interior, exterior, space, rails, anchors, wallSpots, glass,
    doors: { airlockInner, airlockOuter, hangarLeft, hangarRight },
    hull,
  };
}
