// The station: modules, racks, rails, hatches, windows, exterior. Units are
// metres; +Y points away from Earth. Interior collision comes from the same
// numbers that place the walls, so what you see is what you bump into.
//
//   hangar ── glass walkway ── research room ── observation room
//   x −16.4…0.4      0.4…2.8        2.8…11.2        11.6…17.6
import * as THREE from 'three';
import { Space, box, cyl } from '../core/space';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { labelTexture, panelBump, panelTexture, patchTexture, rackTexture, type RackKind } from './textures';
import { RACK_MODULES, blanketMaterial, glassSmudge, lightDiffuser, pbrSet, plateTexture, rackModule, recolouredPaint, scaleUV, tileUV } from './pbr';
import { buildWorkstation } from './workstation';

export interface Rail { a: THREE.Vector3; b: THREE.Vector3 }

export interface Anchors {
  spawn: THREE.Vector3;
  telescopeBase: THREE.Vector3;
  telescopeEye: THREE.Vector3;
  workstation: THREE.Vector3;
  workstationSeat: THREE.Vector3;
  hangarConsole: THREE.Vector3;
  shuttleDock: THREE.Vector3;
}

export interface Station {
  interior: THREE.Group;
  exterior: THREE.Group;
  space: Space;
  rails: Rail[];
  anchors: Anchors;
  /** The hangar doors animate (they live in the bay's frame). */
  doors: { hangarLeft: THREE.Object3D; hangarRight: THREE.Object3D };
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

  // Mission control's own PBR set: quilted beta-cloth blankets, brushed anodised trim, diamond-plate kick floor.
  const hubWall = blanketMaterial();
  const hubFrame = pbrSet('brushed-aluminium', { color: 0xd4d7dd, normal: 0.7, roughness: 0.9 });
  hubFrame.userData.tile = 0.5;
  const hubRail = pbrSet('brushed-aluminium', { color: 0xe3b94a, normal: 0.6, roughness: 0.85, clearcoat: 0.3 });
  const hubGrip = pbrSet('rubber', { color: 0x2b2c31, normal: 1.2 });
  const hubFloor = pbrSet('diamond-plate', { color: 0xc9ccd2, normal: 0.9 });
  const hubGlass = new THREE.MeshPhysicalMaterial({
    color: 0xc4dcff, transparent: true, opacity: 0.1, roughness: 1, roughnessMap: glassSmudge(), metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.5, specularIntensity: 1, depthWrite: false, side: THREE.DoubleSide,
  });
  const rubberCables = [0x1f2937, 0x7c2d12, 0x1e3a8a, 0x374151].map((c) => pbrSet('rubber', { color: c, normal: 1.4 }));
  const hubBag = pbrSet('fabric-weave', { color: 0xe3dcc6, normal: 1.1 });
  const hubBagAlt = pbrSet('fabric-weave', { color: 0x9db4c9, normal: 1.1 });
  const hubLamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveMap: lightDiffuser(), emissiveIntensity: 0.9 });
  const hubExt = new THREE.MeshPhysicalMaterial({ color: 0xb3121c, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
  const hubLed = new THREE.MeshBasicMaterial({ color: 0x35ff9b });

  // Where add() puts things: the interior, or (while the hangar bay is built) the bay's own frame.
  let target: THREE.Object3D = interior;
  const add = (m: THREE.Object3D, g: THREE.Object3D = target) => { g.add(m); return m; };
  const plane = (w: number, h: number, mat: THREE.Material, u0 = 0, v0 = 0) => {
    const geo = new THREE.PlaneGeometry(w, h);
    if (mat.userData.tile) tileUV(geo, w, h, mat.userData.tile, u0, v0);
    return new THREE.Mesh(geo, mat);
  };
  /** A box whose UVs are in metres, so scans keep their texel density on any size. */
  const boxPBR = (w: number, h: number, d: number, mat: THREE.Material, tile = 0.5) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile); }
    return new THREE.Mesh(geo, mat);
  };

  /**
   * A face of a box room, built as quads around an optional square opening.
   * `n` is the inward normal; `c` the face centre; `u`/`v` the in-plane axes.
   */
  const face = (c: THREE.Vector3, n: THREE.Vector3, u: THREE.Vector3, w: number, h: number, hole?: number, mat: THREE.Material = wallMat) => {
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const put = (cx: number, cy: number, pw: number, ph: number) => {
      if (pw <= 0.01 || ph <= 0.01) return;
      const p = plane(pw, ph, mat, cx - pw / 2 + w / 2, cy - ph / 2 + h / 2);
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
  const windowFace = (c: THREE.Vector3, n: THREE.Vector3, u: THREE.Vector3, w: number, h: number, rects: { r: [number, number, number, number]; open?: boolean }[], mat: THREE.Material = wallMat, glassMat: THREE.Material = glass, trimMat: THREE.Material = frameMat) => {
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const shape = new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2)]);
    for (const { r: [x0, y0, x1, y1] } of rects) shape.holes.push(new THREE.Path([new THREE.Vector2(x0, y0), new THREE.Vector2(x0, y1), new THREE.Vector2(x1, y1), new THREE.Vector2(x1, y0)]));
    const geo = new THREE.ShapeGeometry(shape);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const tl = mat.userData.tile as number | undefined;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ((uv.getX(i) + w / 2) / w) * (tl ? w / tl : 1), ((uv.getY(i) + h / 2) / h) * (tl ? h / tl : 1));
    const g = new THREE.Group();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    g.position.copy(c);
    g.add(new THREE.Mesh(geo, mat));
    for (const { r: [x0, y0, x1, y1], open } of rects) {
      if (open) continue;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), glassMat);
      pane.position.set((x0 + x1) / 2, (y0 + y1) / 2, -0.03);
      g.add(pane);
      const t = 0.07;
      for (const [x, y, bw, bh] of [[(x0 + x1) / 2, y1 + t / 2, x1 - x0 + t * 2, t], [(x0 + x1) / 2, y0 - t / 2, x1 - x0 + t * 2, t], [x0 - t / 2, (y0 + y1) / 2, t, y1 - y0], [x1 + t / 2, (y0 + y1) / 2, t, y1 - y0]]) {
        const b = boxPBR(bw, bh, 0.12, trimMat);
        b.position.set(x, y, 0);
        g.add(b);
      }
    }
    add(g);
  };

  /** A hatch frame around a square opening, with the hatch door swung aside. */
  const hatch = (c: THREE.Vector3, n: THREE.Vector3, half: number, open = true, swing = 1, frame: THREE.Material = frameMat) => {
    const g = new THREE.Group();
    const t = 0.12, d = 0.18;
    const parts: [number, number, number, number][] = [[0, half + t / 2, half * 2 + t * 2, t], [0, -half - t / 2, half * 2 + t * 2, t], [half + t / 2, 0, t, half * 2], [-half - t / 2, 0, t, half * 2]];
    for (const [x, y, w, h] of parts) {
      const b = boxPBR(w, h, d, frame);
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

  const rackGeos = new Map<string, THREE.PlaneGeometry>();
  const rackGeo = (w: number, h: number) => { const k = `${w.toFixed(3)}x${h.toFixed(3)}`; let g = rackGeos.get(k); if (!g) rackGeos.set(k, g = new THREE.PlaneGeometry(w, h)); return g; };
  const rackMats = new Map<number, THREE.Material>();
  const rackMat = (k: number) => { let m = rackMats.get(k); if (!m) { const t = rackModule(k); rackMats.set(k, m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: 0.52, metalness: 0.12, clearcoat: 0.12, clearcoatRoughness: 0.5 })); } return m; };

  const RACKS: RackKind[] = ['lockers', 'equipment', 'bags', 'science', 'lockers', 'grille', 'bags', 'equipment'];

  /** A rack-lined module along x, square section of half-size `s`. */
  const moduleX = (zone: string, x0: number, x1: number, s: number, opts: { racks?: boolean; rails?: boolean; seed?: number; pbr?: boolean; clear?: [number, number] } = {}) => {
    const P = !!opts.pbr;
    const wm = P ? hubWall : wallMat;
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
      face(c, n, uAxis, len, s * 2, undefined, wm);
      if (opts.racks === false) return;
      // Racks: about a metre each, inset slightly, faces of varied kinds.
      const count = Math.max(1, Math.floor(len / 1.05));
      for (let i = 0; i < count; i++) {
        const kind = RACKS[(i + wi * 3 + (opts.seed ?? 0)) % RACKS.length];
        const rx = x0 + (i + 0.5) * (len / count);
        if (P) {
          // Racks as five stacked 1 × 0.55 m modules, each a 1024 px/m painted-aluminium face, between anodised rails.
          if (wi === 2 && opts.clear && rx > opts.clear[0] && rx < opts.clear[1]) continue;
          const rw = len / count - 0.08, rh = s * 2 - 0.25, mh = rh / 5;
          const vv = new THREE.Vector3().crossVectors(n, uAxis).normalize();
          const q4 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(uAxis, vv, n));
          for (let j = 0; j < 5; j++) {
            const mk = (i * 3 + wi * 5 + j * 2 + (opts.seed ?? 0)) % RACK_MODULES;
            const m = new THREE.Mesh(rackGeo(rw, mh), rackMat(mk));
            m.quaternion.copy(q4);
            m.position.copy(c).setX(rx).addScaledVector(vv, -rh / 2 + mh * (j + 0.5)).addScaledVector(n, 0.04);
            add(m);
          }
          for (const sx of [-1, 1]) {
            const rail = boxPBR(0.04, rh, 0.06, hubFrame);
            rail.position.copy(c).setX(rx).addScaledVector(uAxis, sx * (rw / 2 + 0.02)).addScaledVector(n, 0.05);
            add(rail);
          }
          if (i % 2 === 0) wallSpots.push({ zone, pos: c.clone().setX(rx).addScaledVector(n, 0.1), normal: n.clone() });
          continue;
        }
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
      const l = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.04, 0.12), P ? hubLamp : lightMat);
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
        const rod = new THREE.Mesh(P ? scaleUV(new THREE.CylinderGeometry(0.022, 0.022, len - 1, 24), 1, (len - 1) * 3) : new THREE.CylinderGeometry(0.022, 0.022, len - 1, 10), P ? hubRail : railMat);
        rod.rotation.z = Math.PI / 2;
        rod.position.set(cx, y, z);
        add(rod);
        if (P) { const gp = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.026, 0.026, (len - 1) * 0.3, 24), 2, 1), hubGrip); gp.rotation.z = Math.PI / 2; gp.position.set(cx, y, z); add(gp); }
        for (let x = x0 + 0.5; x <= x1 - 0.5 + 1e-6; x += (len - 1) / Math.max(1, Math.round((len - 1) / 1.6))) {
          const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, P ? 16 : 8), P ? hubFrame : railMat);
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
        add(new THREE.Mesh(P ? scaleUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.012, 10, false), 14, 1) : new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6, false), P ? rubberCables[(j + k) % rubberCables.length] : cableMats[(j + k) % cableMats.length]));
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
    const light = new THREE.PointLight(0xfff1e0, P ? 2.4 : 3.2, s * 8, 2);
    light.position.set(cx, s * 0.6, 0);
    add(light);
  };

  // Wall hardware shared by the research and observation rooms.
  const oru = (c: THREE.Vector3, n: THREE.Vector3, w: number, h: number, lines: string[], bg: string) => {
    const g = new THREE.Group();
    const body = boxPBR(w, h, 0.07, hubFrame);
    g.add(body);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.26), new THREE.MeshStandardMaterial({ map: plateTexture(lines, { bg }), roughness: 0.55 }));
    label.position.set(0, h * 0.27, 0.036);
    g.add(label);
    for (const sx of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 10, 20, Math.PI), hubRail);
      handle.position.set(sx * w * 0.3, -h * 0.12, 0.035); handle.rotation.z = Math.PI;
      g.add(handle);
    }
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12), hubFrame);
      sw.rotation.x = Math.PI / 2; sw.position.set(x * (w / 2 - 0.03), y * (h / 2 - 0.03), 0.038);
      g.add(sw);
    }
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), hubLed);
    led.position.set(w * 0.32, h * 0.1, 0.037);
    g.add(led);
    g.quaternion.setFromUnitVectors(V(0, 0, 1), n);
    g.position.copy(c).addScaledVector(n, 0.045);
    add(g);
  };
  const bag = (c: THREE.Vector3, n: THREE.Vector3, w: number, h: number, mat: THREE.Material, tag: string) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(scaleUV(new RoundedBoxGeometry(w, h, 0.17, 5, 0.045), 2, 2), mat);
    g.add(body);
    for (const sy of [-0.28, 0.28]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.028, 0.18), velcroMat);
      strap.position.y = sy * h; g.add(strap);
    }
    const hd = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 16, Math.PI), velcroMat);
    hd.position.set(0, h / 2, 0.02); g.add(hd);
    const tg = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.45, h * 0.2), new THREE.MeshStandardMaterial({ map: plateTexture([tag], { bg: '#f3f3f0', w: 256, h: 96, font: 40 }), roughness: 0.6 }));
    tg.position.set(0, -h * 0.08, 0.087); g.add(tg);
    g.quaternion.setFromUnitVectors(V(0, 0, 1), n);
    g.position.copy(c).addScaledVector(n, 0.085);
    g.rotateZ((Math.sin(c.y * 7.3 + c.z) * 0.06));
    add(g);
  };
  // ---------- doorways and modules ----------
  const door = (zone: string, axis: 'x' | 'z', a: number, b: number, half: number) => {
    // The player's centre must stay a body-radius inside a volume, so a doorway volume has to reach
    // well into both rooms (at least two radii of overlap) or the hatch is impassable.
    const lo = a - 0.7, hi = b + 0.7;
    space.add(axis === 'x' ? box(`${zone}-door`, zone, [lo, -half, -half], [hi, half, half]) : box(`${zone}-door`, zone, [-half, -half, lo], [half, half, hi]));
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

  // Research room, the middle of the line. Its west end opens onto the glass walkway to the hangar.
  space.add(box('Walkway door', 'Research module', [1.7, -0.95, -0.95], [4.1, 0.95, 0.95]));
  hatch(V(2.8, 0, 0), V(1, 0, 0), 0.95, true, -1, hubFrame);
  moduleX('Research module', 2.8, 11.2, 1.5, { seed: 1, pbr: true, clear: [7.4, 9.0] });
  face(V(2.8, 0, 0), V(1, 0, 0), V(0, 0, -1), 3, 3, 0.95, hubWall);
  face(V(11.2, 0, 0), V(-1, 0, 0), V(0, 0, 1), 3, 3, 0.95, hubWall);
  add(buildWorkstation(V(8.2, -0.25, -1.5)));

  // Observation module (east of research): bigger, with a great round window.
  door('Observation module', 'x', 11.0, 11.8, 0.95);
  hatch(V(11.2, 0, 0), V(1, 0, 0), 0.95, true, 1, hubFrame);
  const OS = 2.2;
  space.add(box('Observation module', 'Observation module', [11.6, -OS, -OS], [17.6, OS, OS]));
  {
    const len = 6, cx = 14.6;
    face(V(cx, OS, 0), V(0, -1, 0), V(1, 0, 0), len, OS * 2, undefined, hubWall);
    face(V(cx, 0, -OS), V(0, 0, 1), V(1, 0, 0), len, OS * 2, undefined, hubWall);
    face(V(cx, 0, OS), V(0, 0, -1), V(1, 0, 0), len, OS * 2, undefined, hubWall);
    face(V(11.6, 0, 0), V(1, 0, 0), V(0, 0, -1), OS * 2, OS * 2, 0.95, hubWall);
    // Floor (nadir side): diamond-plate walkway strips around the belly window.
    const floorStrip = (x: number, w: number, z: number, d: number) => {
      const m = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(w, d), w / 0.8, d / 0.8), hubFloor);
      m.rotation.x = -Math.PI / 2; m.position.set(x, -OS, z); add(m);
    };
    floorStrip(cx - 2, 2, 0, OS * 2); floorStrip(cx + 2.5, 1, 0, OS * 2);
    for (const z of [-OS + 0.6, OS - 0.6]) floorStrip(cx + 0.5, 3, z, 1.2);
    const belly = new THREE.Mesh(new THREE.PlaneGeometry(3, OS * 2 - 2.4), hubGlass);
    belly.rotation.x = -Math.PI / 2;
    belly.position.set(cx + 0.5, -OS - 0.02, 0);
    add(belly);
    for (const z of [-1.2, 1.2]) { const f = boxPBR(3.1, 0.05, 0.06, hubFrame); f.position.set(cx + 0.5, -OS + 0.025, z); add(f); }
    // The great window on the end cap: a thick brushed bezel, a bolt ring, double glazing.
    const ring = new THREE.Mesh(scaleUV(new THREE.RingGeometry(1.75, OS * 1.42, 96, 1), 6, 6), hubWall);
    ring.rotation.y = -Math.PI / 2;
    ring.position.set(17.6, 0, 0);
    add(ring);
    for (const dx of [0.02, 0.1]) { // double glazing
      const pane = new THREE.Mesh(new THREE.CircleGeometry(1.75, 96), hubGlass);
      pane.rotation.y = -Math.PI / 2;
      pane.position.set(17.6 + dx, 0, 0);
      add(pane);
    }
    const bezel = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(1.8, 0.1, 24, 128), 60, 3), hubFrame);
    bezel.rotation.y = Math.PI / 2;
    bezel.position.set(17.57, 0, 0);
    add(bezel);
    const lip = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(1.76, 1.76, 0.22, 96, 1, true), 40, 1), hubFrame);
    lip.rotation.z = Math.PI / 2; lip.position.set(17.5, 0, 0);
    lip.material = Object.assign(hubFrame.clone(), { side: THREE.DoubleSide });
    add(lip);
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), hubFrame, 32);
    const bm = new THREE.Matrix4(), bq = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      bolts.setMatrixAt(i, bm.compose(V(17.56, Math.sin(a) * 1.98, Math.cos(a) * 1.98), bq, V(1, 1, 1)));
    }
    add(bolts);
    // Ceiling light panels and wall hardware.
    for (const [y, z] of [[OS - 0.25, -OS + 0.25], [OS - 0.25, OS - 0.25]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.04, 0.14), hubLamp);
      l.position.set(cx, y, z);
      add(l);
    }
    const light = new THREE.PointLight(0xe8e0ff, 2.6, 14, 2);
    light.position.set(cx - 1, OS * 0.6, 0);
    add(light);
    for (const z of [-OS + 0.1, OS - 0.1]) {
      const a = V(12.1, 0.9, z), b = V(17.1, 0.9, z);
      rails.push({ a, b });
      const rod = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.022, 0.022, 5, 24), 1, 15), hubRail);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(14.6, 0.9, z);
      add(rod);
      const gp = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.026, 0.026, 1.5, 24), 2, 1), hubGrip);
      gp.rotation.z = Math.PI / 2; gp.position.set(14.6, 0.9, z); add(gp);
      for (const x of [12.4, 14.6, 16.8]) {
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 16), hubFrame);
        st.rotation.x = Math.PI / 2; st.position.set(x, 0.9, z + (z < 0 ? -0.05 : 0.05)); add(st);
      }
    }
    // Panels, bags and cable runs on the side walls (clear of the telescope, the console and the hatch).
    oru(V(12.9, 1.0, -OS), V(0, 0, 1), 0.55, 0.7, ['STAR TRACKER', 'ST-2 · NOMINAL'], '#e9e6de');
    oru(V(16.2, 1.0, -OS), V(0, 0, 1), 0.5, 0.6, ['THERMAL', 'LOOP B'], '#f2d24b');
    oru(V(12.9, -0.9, OS), V(0, 0, -1), 0.6, 0.6, ['OPTICS', 'PWR 28V'], '#e9e6de');
    bag(V(16.0, 0.3, OS), V(0, 0, -1), 0.5, 0.34, hubBagAlt, 'EYEPIECES');
    bag(V(16.0, -0.2, OS), V(0, 0, -1), 0.46, 0.3, hubBag, 'FILTERS');
    const cables: THREE.Vector3[][] = [];
    for (let j = 0; j < 4; j++) {
      const pts = [];
      for (let i = 0; i <= 14; i++) pts.push(V(12 + 5 * (i / 14), OS - 0.14 - (j % 2) * 0.022 + Math.sin(i * 0.8 + j) * 0.006, -OS + 0.12 + Math.floor(j / 2) * 0.022));
      cables.push(pts);
    }
    cables.forEach((pts, j) => add(new THREE.Mesh(scaleUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.011, 10, false), 18, 1), rubberCables[j % rubberCables.length])));
    for (let i = 1; i < 14; i += 2) {
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0035, 6, 14), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.55 }));
      tie.position.set(12 + 5 * (i / 14), OS - 0.145, -OS + 0.13); tie.rotation.y = Math.PI / 2; add(tie);
    }
  }

  // The glass walkway between the research room and the hangar: the shuttle is on show all along it.
  space.add(cyl('Hangar tunnel', 'Hangar', 'x', 0.4, 2.8, 0, 0, 1.15));
  space.add(box('Hangar-door', 'Hangar', [-0.5, -0.95, -0.95], [1.5, 0.95, 0.95]));
  {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(1.17, 1.17, 2.4, 48, 1, true), hubGlass);
    shell.rotation.z = Math.PI / 2;
    shell.position.set(1.6, 0, 0);
    add(shell);
    for (const x of [0.45, 1.0, 1.6, 2.2, 2.75]) {
      const rib = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(1.17, 0.045, 16, 64), 40, 2), hubFrame);
      rib.rotation.y = Math.PI / 2;
      rib.position.set(x, 0, 0);
      add(rib);
    }
    // Longitudinal stringers between the ribs.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const st = boxPBR(2.6, 0.04, 0.04, hubFrame);
      st.position.set(1.6, Math.cos(a) * 1.17, Math.sin(a) * 1.17); st.rotation.x = -a; add(st);
    }
    const floor = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(2.4, 0.04, 0.9), 3, 1), hubFloor);
    floor.position.set(1.6, -1.05, 0);
    add(floor);
    for (const z of [-0.9, 0.9]) {
      const a = V(0.6, 0.4, z), b = V(2.6, 0.4, z);
      rails.push({ a, b });
      const rod = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.022, 0.022, 2.0, 24), 1, 6), hubRail);
      rod.rotation.z = Math.PI / 2; rod.position.set(1.6, 0.4, z); add(rod);
    }
  }
  // The hangar bay is built in its own frame (shuttle bay along −z, glass wall at z = −5.2, doors at the far end)
  // and the whole bay is then turned onto the corridor axis: bay (x, z) → world (z + 5.6, −x).
  const bay = new THREE.Group();
  bay.name = 'bay';
  bay.rotation.y = Math.PI / 2;
  bay.position.set(5.6, 0, 0);
  bay.updateMatrix();
  interior.add(bay);
  const bayToWorld = (v: THREE.Vector3) => v.clone().applyMatrix4(bay.matrix);
  target = bay;
  const HG = { x: 6, y: 4, z0: -22, z1: -5.2 };
  space.add(box('Hangar', 'Hangar', [HG.z0 + 5.6, -HG.y, -HG.x], [HG.z1 + 5.6, HG.y, HG.x]));
  // Hangar bay: chipped industrial paint on the walls, a painted deck, structural ribs and caged work lights.
  const hangarMat = pbrSet('brushed-aluminium', { color: 0xe4e7ec, normal: 0.6, roughness: 0.95 });
  hangarMat.metalness = 0.6; hangarMat.userData.tile = 1.2;
  const deckMat = pbrSet('hangar-floor', { color: 0x9aa0a8, normal: 1.2, roughness: 0.9 });
  deckMat.userData.tile = 3;
  const lineYellow = pbrSet('painted-metal', { albedo: recolouredPaint(0xf2c200), normal: 0.6, roughness: 0.9 });
  lineYellow.metalness = 0.05;
  {
    const len = HG.z1 - HG.z0, cz = (HG.z0 + HG.z1) / 2;
    face(V(0, -HG.y, cz), V(0, 1, 0), V(1, 0, 0), HG.x * 2, len, undefined, deckMat);
    face(V(0, HG.y, cz), V(0, -1, 0), V(1, 0, 0), HG.x * 2, len, undefined, hangarMat);
    face(V(-HG.x, 0, cz), V(1, 0, 0), V(0, 0, 1), len, HG.y * 2, undefined, hangarMat);
    face(V(HG.x, 0, cz), V(-1, 0, 0), V(0, 0, -1), len, HG.y * 2, undefined, hangarMat);
    // The hangar's station-side wall is mostly glass: the shuttle is on show from mission control.
    windowFace(V(0, 0, HG.z1), V(0, 0, -1), V(-1, 0, 0), HG.x * 2, HG.y * 2, [
      { r: [-0.95, -0.95, 0.95, 0.95], open: true },
      { r: [-5.2, -2.6, -1.4, 2.9] }, { r: [1.4, -2.6, 5.2, 2.9] }, { r: [-1.4, 1.4, 1.4, 2.9] },
    ], hangarMat, hubGlass, hubFrame);
    // Structural ribs every 3 m: wall posts, ceiling beams, floor kick-rails.
    for (let z = HG.z0 + 1.5; z < HG.z1 - 0.4; z += 3) {
      for (const sx of [-1, 1]) { const p = boxPBR(0.12, HG.y * 2, 0.24, hubFrame, 0.6); p.position.set(sx * (HG.x - 0.06), 0, z); add(p); }
      const beam = boxPBR(HG.x * 2, 0.26, 0.24, hubFrame, 0.6); beam.position.set(0, HG.y - 0.13, z); add(beam);
    }
    // Hazard-striped kick plates along both walls, and floor lane markings in painted yellow.
    for (const sx of [-1, 1]) {
      const kp = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.35), new THREE.MeshStandardMaterial({ map: labelTexture(['◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤'], { bg: '#facc15', fg: '#111', w: 2048, h: 40, font: 32 }), roughness: 0.6 }));
      kp.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; kp.position.set(sx * (HG.x - 0.02), -HG.y + 0.3, cz); add(kp);
    }
    for (const lx of [-2.1, 2.1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, len - 1), lineYellow); m.rotation.x = -Math.PI / 2; m.position.set(lx, -HG.y + 0.012, cz); add(m); }
    for (let z = HG.z0 + 1; z < HG.z1 - 0.5; z += 2) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 1), lineYellow); m.rotation.x = -Math.PI / 2; m.position.set(0, -HG.y + 0.012, z); add(m); }
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: plateTexture(['SHUTTLE BAY 01'], { bg: '#232733', fg: '#facc15', w: 2048, h: 512, font: 200 }), roughness: 0.7, transparent: true }));
    decal.rotation.x = -Math.PI / 2; decal.position.set(0, -HG.y + 0.015, HG.z1 - 3.2); add(decal);
    // Caged work lights along both walls: housing, cage bars and a diffuser.
    for (const x of [-HG.x + 0.3, HG.x - 0.3]) for (let z = HG.z0 + 2; z < HG.z1; z += 3) {
      const housing = boxPBR(0.3, 0.4, 0.7, hubFrame, 0.4); housing.position.set(x, HG.y - 0.7, z); add(housing);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.6), hubLamp); lens.rotation.x = Math.PI / 2; lens.position.set(x, HG.y - 0.905, z); add(lens);
      for (let k = -2; k <= 2; k++) { const bar = boxPBR(0.01, 0.015, 0.7, hubFrame, 0.3); bar.position.set(x + k * 0.055, HG.y - 0.92, z); add(bar); }
    }
    const sign = plane(3.4, 0.5, new THREE.MeshStandardMaterial({ map: labelTexture(['PLEASE SECURE ALL BELONGINGS, INCLUDING YOUR EXPECTATIONS'], { bg: '#1f2937', fg: '#facc15', w: 1024, h: 150, font: 30 }), roughness: 0.5 }));
    sign.position.set(0, 3.4, HG.z1 - 0.05);
    sign.rotation.y = Math.PI;
    add(sign);
    for (const [x, y] of [[-3, 2.5], [3, 2.5]]) {
      const l = new THREE.PointLight(0xe0e8ff, 10, 26, 2);
      l.position.set(x, y, cz);
      add(l);
    }
    for (const x of [-HG.x + 0.12, HG.x - 0.12]) {
      const a = V(x, 1.5, HG.z1 - 0.6), b = V(x, 1.5, HG.z0 + 1.5);
      rails.push({ a: bayToWorld(a), b: bayToWorld(b) });
      const L = a.distanceTo(b);
      const rod = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.025, 0.025, L, 24), 1, L * 3), hubRail);
      rod.rotation.x = Math.PI / 2;
      rod.position.copy(a).add(b).multiplyScalar(0.5);
      add(rod);
      for (let t = 0; t <= 1.001; t += 0.125) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.12, 12), hubFrame); post.rotation.z = Math.PI / 2; post.position.copy(a).lerp(b, t).add(V(-Math.sign(x) * 0.0, 0, 0)); post.position.x += (x < 0 ? -0.06 : 0.06) * -1; add(post); }
    }
  }
  // Hangar doors at the far end: two leaves that slide apart, ribbed and chipped like the walls.
  const doorMat = pbrSet('brushed-aluminium', { color: 0xc4c9d2, normal: 0.7, roughness: 0.95 });
  doorMat.metalness = 0.6; doorMat.userData.tile = 1.2;
  const hangarLeft = boxPBR(HG.x, HG.y * 2, 0.2, doorMat, 1.2);
  hangarLeft.position.set(-HG.x / 2, 0, HG.z0);
  const hangarRight = boxPBR(HG.x, HG.y * 2, 0.2, doorMat, 1.2);
  hangarRight.position.set(HG.x / 2, 0, HG.z0);
  add(hangarLeft); add(hangarRight);
  for (const d of [hangarLeft, hangarRight]) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(HG.x - 0.4, 0.3), new THREE.MeshStandardMaterial({ map: labelTexture(['◢◤◢◤◢◤◢◤◢◤◢◤'], { bg: '#facc15', fg: '#111', w: 512, h: 48, font: 30 }), roughness: 0.6 }));
    stripe.position.set(0, -HG.y + 0.5, 0.11);
    d.add(stripe);
    for (let y = -HG.y + 1.5; y < HG.y; y += 2.2) { const rib = boxPBR(HG.x - 0.3, 0.12, 0.08, hubFrame, 0.5); rib.position.set(0, y, 0.14); d.add(rib); }
  }

  target = interior;

  // ---------- mission patches ----------
  const patchMat = new THREE.MeshStandardMaterial({ map: patchTexture(), transparent: true, roughness: 0.7 });
  for (const [pos, rotY] of [[V(2.83, 1.25, 0), Math.PI / 2], [V(13.0, 1.5, -OS + 0.03), 0]] as const) {
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
    const walk = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.4, 32), mliMat);
    walk.rotation.z = Math.PI / 2; walk.position.set(1.6, 0, 0);
    hull.add(walk);
    const obs = new THREE.Mesh(new THREE.CylinderGeometry(OS * 1.45, OS * 1.45, 6, 48, 1, false, 0, Math.PI * 2), mliMat);
    obs.rotation.z = Math.PI / 2;
    obs.position.set(14.6, 0, 0);
    hull.add(obs);
    const hangarShell = new THREE.Mesh(new THREE.BoxGeometry(HG.z1 - HG.z0, HG.y * 2 + 0.4, HG.x * 2 + 0.4), mliMat);
    hangarShell.position.set((HG.z0 + HG.z1) / 2 + 5.6, 0, 0);
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
    for (const x of [-18, -12, 18, 24]) for (const z of [-1, 1]) {
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
    // (Exterior handrails and EVA routes went with the airlock.)
    // Exterior patch.
    const extPatch = plane(2.2, 2.2, patchMat);
    extPatch.position.set(7, 0, 2.17);
    hull.add(extPatch);
  }

  const anchors: Anchors = {
    spawn: V(5.0, 0.1, 0.5),
    telescopeBase: V(15.4, -0.7, 0),
    telescopeEye: V(14.3, 0.35, 0),
    workstation: V(8.2, -0.25, -1.2),
    workstationSeat: V(8.2, 0.05, -0.35),
    hangarConsole: V(0, 0.6, 1.4),
    shuttleDock: V(-5.9, -0.6, 0),
  };

  return {
    interior, exterior, space, rails, anchors, wallSpots, glass,
    doors: { hangarLeft, hangarRight },
    hull,
  };
}
