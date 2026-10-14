// The station: modules, racks, doors, windows, exterior. Units are metres;
// +Y points away from Earth. The station spins for gravity, so every pressurised
// room shares one deck (DECK) and every doorway starts at that deck: walking
// height, door openings, collision and the floor meshes all come from the same
// numbers, so what you see is what you walk on and bump into.
//
//   hangar ─[H-1]─ glass walkway ─[R-1]─ research room ─[R-2]─ observation room
//   x −16.4…0.4       0.6…5.4            5.6…11.2               11.6…17.6
//   (each doorway's sliding leaf runs in the gap between the two walls it joins)
import * as THREE from 'three';
import { Space, box, cyl } from '../core/space';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { labelTexture, panelBump, panelTexture, patchTexture, rackTexture, type RackKind } from './textures';
import { RACK_MODULES, blanketMaterial, glassSmudge, lightDiffuser, pbrSet, plateTexture, rackModule, recolouredPaint, scaleUV, tileUV } from './pbr';
import { buildWorkstation } from './workstation';
import { mergeStatic } from './mergeStatic';
import { constructionMaterial, deckPanels, hazardStripes, paintedPanels } from './construction';
import type { Volume } from '../core/space';

/** The one deck every room shares. Floors are here; a standing eye is 1.55 m above. */
export const DECK = -1.5;
/** Clear doorway opening: 1.0 m wide, 2.05 m tall, from the deck. */
export const DOOR_W = 1.0, DOOR_H = 2.05;

/** A sliding door between two rooms. `doors.ts` opens it as people approach unless it is locked. */
export interface Hatch {
  id: string;
  /** Centre of the opening at deck height. */
  center: THREE.Vector3;
  leaf: THREE.Object3D;
  /** Where the leaf sits shut, and the direction it slides to open. */
  shut: THREE.Vector3; slide: THREE.Vector3; travel: number;
  /** The doorway's collision volume: closed while the leaf is not fully open. */
  volume: Volume;
  lamp: THREE.MeshStandardMaterial;
  /** 0 = shut, 1 = open. */
  open: number;
  /** Locked shut (the hangar door while the bay is open to space). */
  locked: boolean;
}

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
  /** Sliding pressure doors between rooms: H-1 (hangar), R-1 (walkway–research), R-2 (research–observation). */
  hatches: Hatch[];
  /** The bay control screen by H-1: redrawn with the bay's real state. */
  bayScreen: { draw(lines: string[], tone: 'ok' | 'warn' | 'alert'): void };
  /** The pressure hull seen from outside: hidden while the camera is aboard, or its end caps would wall off every hatch. */
  hull: THREE.Group;
  /** Spots where props can be placed (wall position + inward normal). */
  wallSpots: { zone: string; pos: THREE.Vector3; normal: THREE.Vector3 }[];
  glass: THREE.Material;
  /** Floor height under a point (world x, z), for walking. One shared deck: no hidden ramps or steps. */
  groundAt(x: number, z: number): number;
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
  const egressMat = new THREE.MeshStandardMaterial({ color: 0x8cffb0, emissive: 0x2fe07a, emissiveIntensity: 0.55, roughness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide });
  const mliMat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.75, metalness: 0.05, map: panelTexture([4, 2]) });

  // Mission control's own PBR set: quilted beta-cloth blankets, brushed anodised trim, diamond-plate kick floor.
  const hubWall = blanketMaterial();
  const hubFrame = pbrSet('brushed-aluminium', { color: 0xd4d7dd, normal: 0.7, roughness: 0.9 });
  hubFrame.userData.tile = 0.5;
  const hubRail = pbrSet('brushed-aluminium', { color: 0xe3b94a, normal: 0.6, roughness: 0.85, clearcoat: 0.3 });
  const hubGrip = pbrSet('rubber', { color: 0x2b2c31, normal: 1.2 });
  const hubFloor = pbrSet('diamond-plate', { color: 0xc9ccd2, normal: 0.9 });
  // Decks are coated structural plates, walls stay quilted blankets: two materials, two jobs.
  const deckMat = constructionMaterial(deckPanels(0x70747c, 11));
  const hangarDeck = constructionMaterial(deckPanels(0x5b5f66, 17), { clearcoat: 0.15 });
  const hangarWall = constructionMaterial(paintedPanels(0xc2c6cb, 21));
  const hangarCeil = constructionMaterial(paintedPanels(0x9ca1a8, 23));
  const hazard = constructionMaterial(hazardStripes(31));
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

  /** A hatch: a thick frame round a square opening with a seal, four latch blocks, a status lamp and a label. Hatches stay open. */
  const hatch = (c: THREE.Vector3, n: THREE.Vector3, half: number, label = 'HATCH', frame: THREE.Material = frameMat) => {
    const g = new THREE.Group();
    const t = 0.14, d = 0.2;
    const parts: [number, number, number, number][] = [[0, half + t / 2, half * 2 + t * 2, t], [0, -half - t / 2, half * 2 + t * 2, t], [half + t / 2, 0, t, half * 2], [-half - t / 2, 0, t, half * 2]];
    for (const [x, y, w, h] of parts) { const b = boxPBR(w, h, d, frame); b.position.set(x, y, 0); g.add(b); }
    // Rubber seal just inside the frame.
    const seal = pbrSet('rubber', { color: 0x1b1d21, normal: 1.3 });
    for (const [x, y, w, h] of [[0, half - 0.012, half * 2, 0.024], [0, -half + 0.012, half * 2, 0.024], [half - 0.012, 0, 0.024, half * 2], [-half + 0.012, 0, 0.024, half * 2]] as const) {
      const sl = boxPBR(w, h, d * 0.9, seal, 0.2); sl.position.set(x, y, 0); g.add(sl);
    }
    // Latch blocks and bolts on the frame's face.
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const lb = boxPBR(0.1, 0.1, 0.05, frame, 0.2); lb.position.set(x * (half + t / 2), y * (half + t / 2), d / 2 + 0.02); g.add(lb);
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12), frame); bolt.rotation.x = Math.PI / 2; bolt.position.set(x * (half + t / 2), y * (half + t / 2), d / 2 + 0.055); g.add(bolt);
    }
    // Label tape and a green "open and clear" lamp.
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(half * 1.2, 0.08), new THREE.MeshStandardMaterial({ map: labelTexture([label], { bg: '#facc15', fg: '#111', w: 256, h: 32, font: 18 }), roughness: 0.6 }));
    tag.position.set(0, half + t + 0.05, d / 2 + 0.001); g.add(tag);
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16), hubLed); lamp.position.set(half + t / 2, half + t + 0.05, d / 2 + 0.002); g.add(lamp);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    g.position.copy(c);
    add(g);
    return g;
  };

  // Rack columns: 0 drawers · 1 power breakers · 2 status display · 3 air vent · 4 server shelf · 5 network patch panel · 6 comms unit · 7 blanking panel.
  const RACK_TEMPLATES = [[2, 4, 4, 5, 3], [2, 6, 5, 6, 3], [1, 1, 3, 0, 7], [0, 0, 0, 0, 7]];
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
      face(c, n, uAxis, len, s * 2, undefined, P && wi === 0 ? deckMat : wm);
      if (opts.racks === false) return;
      // The racks stand on the two side walls only; floor and ceiling stay clear for the light panels and air ducts.
      if (P && (wi === 0 || wi === 1)) return;
      // Racks: about a metre each, inset slightly, faces of varied kinds.
      const count = Math.max(1, Math.floor(len / 1.05));
      for (let i = 0; i < count; i++) {
        const kind = RACKS[(i + wi * 3 + (opts.seed ?? 0)) % RACKS.length];
        const rx = x0 + (i + 0.5) * (len / count);
        if (P) {
          // Each rack is five stacked 1 × 0.55 m modules at 1024 px/m, chosen to belong together:
          // compute racks, comms racks, power racks and storage racks.
          if (wi === 2 && opts.clear && rx > opts.clear[0] && rx < opts.clear[1]) continue;
          const rw = len / count - 0.08, rh = s * 2 - 0.25, mh = rh / 5;
          const vv = new THREE.Vector3().crossVectors(n, uAxis).normalize();
          const q4 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(uAxis, vv, n));
          const template = RACK_TEMPLATES[(i + (wi === 3 ? 2 : 0)) % RACK_TEMPLATES.length];
          for (let j = 0; j < 5; j++) {
            const m = new THREE.Mesh(rackGeo(rw, mh), rackMat(template[j]));
            m.quaternion.copy(q4);
            m.position.copy(c).setX(rx).addScaledVector(vv, -rh / 2 + mh * (j + 0.5)).addScaledVector(n, 0.04);
            add(m);
          }
          for (const sx of [-1, 1]) {
            const rail = boxPBR(0.04, rh, 0.06, hubFrame);
            rail.position.copy(c).setX(rx).addScaledVector(uAxis, sx * (rw / 2 + 0.02)).addScaledVector(n, 0.05);
            add(rail);
          }
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
      const a = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.012, 0.03), egressMat); // emergency egress strip along the floor
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
    // Ceiling air duct with louvred outlets, and a smoke detector.
    if (P) {
      const duct = boxPBR(len - 1.2, 0.18, 0.3, hubFrame, 0.5);
      duct.position.set(cx, s - 0.1, 0);
      add(duct);
      for (let x = x0 + 1.2; x < x1 - 0.8; x += 1.5) {
        const outlet = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), rackMat(3));
        outlet.rotation.x = Math.PI / 2; outlet.position.set(x, s - 0.1 - 0.092, 0); add(outlet);
      }
      const det = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 24), hubFrame);
      det.position.set(x0 + 0.7, s - 0.02, 0.6); add(det);
      const detLed = new THREE.Mesh(new THREE.CircleGeometry(0.008, 10), hubLed); detLed.rotation.x = Math.PI / 2; detLed.position.set(x0 + 0.7, s - 0.037, 0.6); add(detLed);
    }
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
  // ---------- doorways ----------
  // Every doorway sits in the gap between the two walls it joins: an opening 1.0 × 2.05 m from the deck,
  // a lined reveal through the wall pair, a flush threshold plate, raised casings on both faces with a
  // label and a status lamp, and a sliding leaf with a vision panel that runs into a pocket in the gap.
  const hatches: Hatch[] = [];
  const leafPaint = constructionMaterial(paintedPanels(0xd3d6da, 41));
  const sealMat = pbrSet('rubber', { color: 0x1b1d21, normal: 1.3 });
  const doorway = (id: string, zone: string, xa: number, xb: number, label: string) => {
    const volume = box(`${id} doorway`, zone, [xa - 0.7, DECK, -DOOR_W / 2], [xb + 0.7, DECK + DOOR_H, DOOR_W / 2]);
    volume.closed = true;
    space.add(volume);
    const mid = (xa + xb) / 2, gap = xb - xa, cy = DECK + DOOR_H / 2;
    // Reveal through the wall pair and a flush threshold.
    for (const sz of [-1, 1]) { const j = boxPBR(gap, DOOR_H, 0.03, hubFrame, 0.4); j.position.set(mid, cy, sz * (DOOR_W / 2 + 0.015)); add(j); }
    const head = boxPBR(gap, 0.03, DOOR_W, hubFrame, 0.4); head.position.set(mid, DECK + DOOR_H + 0.015, 0); add(head);
    const sill = boxPBR(gap + 0.26, 0.012, DOOR_W, hubFloor, 0.8); sill.position.set(mid, DECK + 0.006, 0); add(sill);
    const lamp = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: 0x35ff9b, emissiveIntensity: 1.2, roughness: 0.4 });
    for (const [x, nx] of [[xa, -1], [xb, 1]] as const) {
      const t = 0.09, d = 0.05;
      for (const [z, y, w, h] of [[-(DOOR_W / 2 + t / 2), cy + t / 2, t, DOOR_H + t], [DOOR_W / 2 + t / 2, cy + t / 2, t, DOOR_H + t], [0, DECK + DOOR_H + t / 2, DOOR_W + 2 * t, t]] as const) {
        const c = boxPBR(d, h, w, hubFrame, 0.4); c.position.set(x + nx * d / 2, y, z); add(c);
      }
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.09), new THREE.MeshStandardMaterial({ map: labelTexture([label], { bg: '#facc15', fg: '#111', w: 512, h: 70, font: 30 }), roughness: 0.6 }));
      tag.rotation.y = nx > 0 ? Math.PI / 2 : -Math.PI / 2; tag.position.set(x + nx * (d + 0.003), DECK + DOOR_H + 0.22, 0); add(tag);
      const lmp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), lamp);
      lmp.rotation.z = Math.PI / 2; lmp.position.set(x + nx * (d + 0.01), DECK + DOOR_H + 0.22, 0.45); add(lmp);
      // Door control at hand height beside the opening.
      const pad = boxPBR(0.03, 0.16, 0.1, hubFrame, 0.2); pad.position.set(x + nx * 0.015, DECK + 1.1, -0.68); add(pad);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 20), lamp); btn.rotation.z = Math.PI / 2; btn.position.set(x + nx * 0.035, DECK + 1.12, -0.68); add(btn);
    }
    // The leaf: four panels round a vision window, a rubber seal on the closing edge, recessed pulls.
    const leaf = new THREE.Group();
    const LW = DOOR_W + 0.08, LH = DOOR_H + 0.06, LT = 0.04;
    const wz0 = -0.13, wz1 = 0.13, wy0 = 0.315, wy1 = 0.735; // window, relative to the leaf centre
    const part = (z0: number, z1: number, y0: number, y1: number) => { const b = boxPBR(LT, y1 - y0, z1 - z0, leafPaint, 2.4); b.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2); leaf.add(b); };
    part(-LW / 2, LW / 2, -LH / 2, wy0); part(-LW / 2, LW / 2, wy1, LH / 2); part(-LW / 2, wz0, wy0, wy1); part(wz1, LW / 2, wy0, wy1);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(wz1 - wz0, wy1 - wy0), hubGlass); pane.rotation.y = Math.PI / 2; pane.position.set(0, (wy0 + wy1) / 2, 0); leaf.add(pane);
    for (const [z, y, w, h] of [[0, wy0, wz1 - wz0 + 0.02, 0.01], [0, wy1, wz1 - wz0 + 0.02, 0.01], [wz0, (wy0 + wy1) / 2, 0.01, wy1 - wy0], [wz1, (wy0 + wy1) / 2, 0.01, wy1 - wy0]] as const) {
      const g = boxPBR(LT + 0.012, h, w, sealMat, 0.2); g.position.set(0, y, z); leaf.add(g);
    }
    const seal = boxPBR(LT + 0.01, LH, 0.03, sealMat, 0.2); seal.position.set(0, 0, -LW / 2 + 0.015); leaf.add(seal);
    for (const sx of [-1, 1]) { const pull = boxPBR(0.012, 0.2, 0.05, darkMat, 0.2); pull.position.set(sx * (LT / 2 + 0.004), -0.02, -LW / 2 + 0.16); leaf.add(pull); }
    leaf.position.set(mid, cy + 0.03, 0);
    leaf.userData.keep = true;
    add(leaf);
    const h: Hatch = { id, center: V(mid, DECK, 0), leaf, shut: leaf.position.clone(), slide: V(0, 0, 1), travel: LW, volume, lamp, open: 0, locked: false };
    hatches.push(h);
    return h;
  };
  /** The door opening as a rect in an end wall's (u, v) frame, for a wall centred at height cy. */
  const doorRect = (cy: number): { r: [number, number, number, number]; open: boolean } => ({ r: [-DOOR_W / 2, DECK - cy, DOOR_W / 2, DECK + DOOR_H - cy], open: true });

  // ---------- research room ----------
  // A compact 5.6 m lab: rack walls, the workstation and the robot's post. The glass walkway makes up the rest.
  const RX0 = 5.6;
  moduleX('Research module', RX0, 11.2, 1.5, { seed: 1, pbr: true, clear: [7.4, 9.0] });
  // End walls run 5 cm below the deck so the door openings sit inside them.
  windowFace(V(RX0, -0.025, 0), V(1, 0, 0), V(0, 0, -1), 3, 3.05, [doorRect(-0.025)], hubWall);
  windowFace(V(11.2, -0.025, 0), V(-1, 0, 0), V(0, 0, 1), 3, 3.05, [doorRect(-0.025)], hubWall);
  add(buildWorkstation(V(8.2, -0.25, -1.5)));
  // Emergency kit by the walkway door: a portable extinguisher on its bracket, with a placard.
  {
    const ex = new THREE.Group();
    ex.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.3, 8, 24), hubExt));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.05, 16), hubFrame); head.position.y = 0.22; ex.add(head);
    for (const y of [-0.08, 0.1]) { const strap = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.007, 8, 24), velcroMat); strap.position.y = y; strap.rotation.x = Math.PI / 2; ex.add(strap); }
    ex.position.set(RX0 + 0.15, DECK + 1.0, 1.2);
    add(ex);
    const placard = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), new THREE.MeshStandardMaterial({ map: plateTexture(['PFE', 'CO₂ · 2 kg'], { bg: '#f5f5f5', w: 256, h: 160, font: 54 }), roughness: 0.5 }));
    placard.rotation.y = Math.PI / 2; placard.position.set(RX0 + 0.02, DECK + 1.45, 1.2); add(placard);
  }
  doorway('R-1', 'Research module', RX0 - 0.2, RX0, 'R-1 · WALKWAY');
  doorway('R-2', 'Observation module', 11.2, 11.6, 'R-2 · OBSERVATION');

  // ---------- observation room ----------
  // A larger module on the same deck. A walk-on glass panel in the deck looks straight down at Earth through a
  // second pane in the hull below; the great window is centred at eye height, clear of the deck.
  const OS = 2.2;
  const WIN_Y = 0.35, WIN_R = 1.6;
  space.add(box('Observation module', 'Observation module', [11.6, DECK, -OS], [17.6, OS, OS]));
  {
    const len = 6, cx = 14.6, oy = (DECK - 0.05 + OS) / 2, oh = OS - DECK + 0.05;
    face(V(cx, OS, 0), V(0, -1, 0), V(1, 0, 0), len, OS * 2, undefined, hubWall);
    face(V(cx, 0, -OS), V(0, 0, 1), V(1, 0, 0), len, OS * 2, undefined, hubWall);
    face(V(cx, 0, OS), V(0, 0, -1), V(1, 0, 0), len, OS * 2, undefined, hubWall);
    windowFace(V(11.6, oy, 0), V(1, 0, 0), V(0, 0, -1), OS * 2, oh, [doorRect(oy)], hubWall);
    // Deck with the glass inset (x 12.3–14.3, z ±0.9), framed flush; the hull pane 0.7 m below.
    const gx0 = 12.3, gx1 = 14.3;
    windowFace(V(cx, DECK, 0), V(0, 1, 0), V(1, 0, 0), len, OS * 2, [{ r: [gx0 - cx, -0.9, gx1 - cx, 0.9] }], deckMat, hubGlass, hubFrame);
    const hullPane = new THREE.Mesh(new THREE.PlaneGeometry(gx1 - gx0, 1.8), hubGlass);
    hullPane.rotation.x = -Math.PI / 2; hullPane.position.set((gx0 + gx1) / 2, -OS - 0.02, 0); add(hullPane);
    for (const z of [-0.95, 0.95]) { const j = boxPBR(gx1 - gx0 + 0.1, 0.68, 0.06, hubFrame, 0.4); j.position.set((gx0 + gx1) / 2, DECK - 0.36, z); add(j); }
    // The great window: annulus wall, double glazing, a thick bezel and a bolt ring, all at eye height.
    const ring = new THREE.Mesh(scaleUV(new THREE.RingGeometry(WIN_R, OS * 1.42, 96, 1), 6, 6), hubWall);
    ring.rotation.y = -Math.PI / 2; ring.position.set(17.6, WIN_Y, 0); add(ring);
    for (const dx of [0.02, 0.1]) { const pane = new THREE.Mesh(new THREE.CircleGeometry(WIN_R, 96), hubGlass); pane.rotation.y = -Math.PI / 2; pane.position.set(17.6 + dx, WIN_Y, 0); add(pane); }
    const bezel = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(WIN_R + 0.05, 0.1, 24, 128), 60, 3), hubFrame);
    bezel.rotation.y = Math.PI / 2; bezel.position.set(17.57, WIN_Y, 0); add(bezel);
    const lip = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(WIN_R + 0.01, WIN_R + 0.01, 0.22, 96, 1, true), 40, 1), Object.assign(hubFrame.clone(), { side: THREE.DoubleSide }));
    lip.rotation.z = Math.PI / 2; lip.position.set(17.5, WIN_Y, 0); add(lip);
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), hubFrame, 32);
    const bm = new THREE.Matrix4(), bq = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI / 2);
    for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; bolts.setMatrixAt(i, bm.compose(V(17.56, WIN_Y + Math.sin(a) * (WIN_R + 0.18), Math.cos(a) * (WIN_R + 0.18)), bq, V(1, 1, 1))); }
    add(bolts);
    for (const z of [-OS + 0.25, OS - 0.25]) { const l = new THREE.Mesh(new THREE.BoxGeometry(len - 0.6, 0.04, 0.14), hubLamp); l.position.set(cx, OS - 0.25, z); add(l); }
    const light = new THREE.PointLight(0xe8e0ff, 2.6, 14, 2); light.position.set(cx - 1, OS * 0.6, 0); add(light);
    // Guard rails along the side walls at hand height (it is a gravity room now).
    for (const z of [-OS + 0.1, OS - 0.1]) {
      const a = V(12.1, DECK + 1.0, z), b = V(17.1, DECK + 1.0, z);
      rails.push({ a, b });
      const rod = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.022, 0.022, 5, 24), 1, 15), hubRail); rod.rotation.z = Math.PI / 2; rod.position.set(14.6, DECK + 1.0, z); add(rod);
      for (const x of [12.4, 14.6, 16.8]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 16), hubFrame); st.rotation.x = Math.PI / 2; st.position.set(x, DECK + 1.0, z + (z < 0 ? -0.05 : 0.05)); add(st); }
    }
    oru(V(12.9, 1.0, -OS), V(0, 0, 1), 0.55, 0.7, ['STAR TRACKER', 'ST-2 · NOMINAL'], '#e9e6de');
    oru(V(16.2, 1.0, -OS), V(0, 0, 1), 0.5, 0.6, ['THERMAL', 'LOOP B'], '#f2d24b');
    oru(V(12.9, -0.3, OS), V(0, 0, -1), 0.6, 0.6, ['OPTICS', 'PWR 28V'], '#e9e6de');
    bag(V(16.0, 0.6, OS), V(0, 0, -1), 0.5, 0.34, hubBagAlt, 'EYEPIECES');
    bag(V(16.0, 0.1, OS), V(0, 0, -1), 0.46, 0.3, hubBag, 'FILTERS');
    const cables: THREE.Vector3[][] = [];
    for (let j = 0; j < 4; j++) { const pts = []; for (let i = 0; i <= 14; i++) pts.push(V(12 + 5 * (i / 14), OS - 0.14 - (j % 2) * 0.022 + Math.sin(i * 0.8 + j) * 0.006, -OS + 0.12 + Math.floor(j / 2) * 0.022)); cables.push(pts); }
    cables.forEach((pts, j) => add(new THREE.Mesh(scaleUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.011, 10, false), 18, 1), rubberCables[j % rubberCables.length])));
    for (let i = 1; i < 14; i += 2) { const tie = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.0035, 6, 14), new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.55 })); tie.position.set(12 + 5 * (i / 14), OS - 0.145, -OS + 0.13); tie.rotation.y = Math.PI / 2; add(tie); }
  }

  // ---------- glass walkway ----------
  // A pressurised glass bridge between the hangar bulkhead and the research room: three portal frames,
  // tread plates on the deck, glass sides and roof, handrails at 1.0 m, and a gallery window into the bay.
  const WW = 1.8, WH = 2.6, wx0 = 0.6, wx1 = RX0 - 0.2, wcx = (wx0 + wx1) / 2, wlen = wx1 - wx0, wtop = DECK + WH;
  space.add(box('Walkway', 'Walkway', [wx0, DECK, -WW], [wx1, wtop, WW]));
  {
    const tread = boxPBR(wlen, 0.05, WW * 2, hubFloor, 0.8); tread.position.set(wcx, DECK - 0.025, 0); add(tread);
    const frames = Math.round(wlen / 1.2);
    for (let i = 0; i <= frames; i++) {
      const x = THREE.MathUtils.lerp(wx0 + 0.05, wx1 - 0.05, i / frames);
      for (const sz of [-1, 1]) { const post = boxPBR(0.1, WH, 0.1, hubFrame, 0.4); post.position.set(x, DECK + WH / 2, sz * (WW - 0.05)); add(post); }
      const beam = boxPBR(0.1, 0.12, WW * 2, hubFrame, 0.4); beam.position.set(x, wtop - 0.06, 0); add(beam);
    }
    for (const sz of [-1, 1]) {
      const kick = boxPBR(wlen, 0.18, 0.1, hubFrame, 0.4); kick.position.set(wcx, DECK + 0.09, sz * (WW - 0.05)); add(kick);
      const eave = boxPBR(wlen, 0.1, 0.1, hubFrame, 0.4); eave.position.set(wcx, wtop - 0.05, sz * (WW - 0.05)); add(eave);
      const side = new THREE.Mesh(new THREE.PlaneGeometry(wlen, WH - 0.28), hubGlass); side.position.set(wcx, DECK + 0.18 + (WH - 0.28) / 2, sz * WW); add(side);
      const y = DECK + 1.0, z = sz * (WW - 0.17);
      rails.push({ a: V(wx0 + 0.25, y, z), b: V(wx1 - 0.25, y, z) });
      const rod = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.022, 0.022, wlen - 0.4, 24), 1, 6), hubRail); rod.rotation.z = Math.PI / 2; rod.position.set(wcx, y, z); add(rod);
      for (let i = 0; i <= frames; i++) { const x = THREE.MathUtils.lerp(wx0 + 0.3, wx1 - 0.3, i / frames); const br = boxPBR(0.03, 0.03, 0.12, hubFrame, 0.2); br.position.set(x, y, z + sz * 0.07); add(br); }
      const strip = new THREE.Mesh(new THREE.BoxGeometry(wlen - 0.3, 0.03, 0.05), hubLamp); strip.position.set(wcx, wtop - 0.13, sz * (WW - 0.14)); add(strip);
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(wlen, WW * 2), hubGlass); roof.rotation.x = Math.PI / 2; roof.position.set(wcx, wtop, 0); add(roof);
    // Bulkheads at both ends: H-1 and the gallery window at the hangar end, R-1 at the research end.
    const wy = (DECK - 0.05 + wtop) / 2, wh = WH + 0.05;
    const gallery: { r: [number, number, number, number] } = { r: [0.7, DECK + 0.9 - wy, 1.7, DECK + 2.3 - wy] };
    windowFace(V(wx0, wy, 0), V(1, 0, 0), V(0, 0, -1), WW * 2, wh, [doorRect(wy), gallery], hangarWall, hubGlass, hubFrame);
    windowFace(V(wx1, wy, 0), V(-1, 0, 0), V(0, 0, 1), WW * 2, wh, [doorRect(wy)], hangarWall);
    // Gallery reveal through the wall pair (x 0.4–0.6).
    for (const [y, h, z, d] of [[DECK + 0.9, 0.02, -1.2, 1.0], [DECK + 2.3, 0.02, -1.2, 1.0]] as const) { const r = boxPBR(0.2, h, d, hubFrame, 0.4); r.position.set(0.5, y, z); add(r); }
    for (const z of [-0.7, -1.7]) { const r = boxPBR(0.2, 1.4, 0.02, hubFrame, 0.4); r.position.set(0.5, DECK + 1.6, z); add(r); }
    for (const x of [wx0 + wlen * 0.25, wx0 + wlen * 0.75]) { const light = new THREE.PointLight(0xfff1e0, 1.6, 6, 2); light.position.set(x, wtop - 0.4, 0); add(light); }
  }
  doorway('H-1', 'Walkway', 0.4, 0.6, 'H-1 · BAY · PRESSURE DOOR');

  // ---------- hangar bay ----------
  // Built in its own frame (shuttle bay along −z, bulkhead at z = −5.2, doors at the far end) and turned onto
  // the corridor axis: bay (x, z) → world (z + 5.6, −x). Same deck as every other room.
  const bay = new THREE.Group();
  bay.name = 'bay';
  bay.rotation.y = Math.PI / 2;
  bay.position.set(5.6, 0, 0);
  bay.updateMatrix();
  interior.add(bay);
  target = bay;
  const HG = { x: 6, z0: -22, z1: -5.2 }, FLOOR = DECK, HH = 8, CEIL = FLOOR + HH;
  space.add(box('Hangar', 'Hangar', [HG.z0 + 5.6, FLOOR, -HG.x], [HG.z1 + 5.6, CEIL, HG.x]));
  let bayScreenMesh: THREE.Mesh;
  const bayCanvas = document.createElement('canvas'); bayCanvas.width = 1024; bayCanvas.height = 640;
  const bayTex = new THREE.CanvasTexture(bayCanvas); bayTex.colorSpace = THREE.SRGBColorSpace;
  const bayScreen = {
    draw(lines: string[], tone: 'ok' | 'warn' | 'alert') {
      const g = bayCanvas.getContext('2d')!;
      const col = tone === 'ok' ? '#5ff0b0' : tone === 'warn' ? '#ffc23d' : '#ff5a4f';
      g.fillStyle = '#071210'; g.fillRect(0, 0, 1024, 640);
      g.fillStyle = col; g.fillRect(0, 0, 1024, 14);
      g.font = '700 54px "Helvetica Neue", Arial, sans-serif'; g.fillText('BAY CONTROL · H-1', 48, 96);
      g.font = '600 64px "Helvetica Neue", Arial, sans-serif';
      lines.forEach((l, i) => g.fillText(l, 48, 220 + i * 110));
      bayTex.needsUpdate = true;
    },
  };
  bayScreen.draw(['DOORS CLOSED', 'BAY PRESSURISED'], 'ok');
  {
    const len = HG.z1 - HG.z0, cz = (HG.z0 + HG.z1) / 2, cy = FLOOR + HH / 2;
    face(V(0, FLOOR, cz), V(0, 1, 0), V(1, 0, 0), HG.x * 2, len, undefined, hangarDeck);
    face(V(0, CEIL, cz), V(0, -1, 0), V(1, 0, 0), HG.x * 2, len, undefined, hangarCeil);
    // Side walls stop 0.3 m short of the door line, where the leaves pass into their pockets.
    face(V(-HG.x, cy, cz + 0.15), V(1, 0, 0), V(0, 0, 1), len - 0.3, HH, undefined, hangarWall);
    face(V(HG.x, cy, cz + 0.15), V(-1, 0, 0), V(0, 0, -1), len - 0.3, HH, undefined, hangarWall);
    // Bulkhead with H-1 and the gallery window (u = world z here).
    const by = cy - 0.025;
    windowFace(V(0, by, HG.z1), V(0, 0, -1), V(-1, 0, 0), HG.x * 2, HH + 0.05,
      [{ r: [-DOOR_W / 2, FLOOR - by, DOOR_W / 2, FLOOR + DOOR_H - by], open: true }, { r: [-1.7, FLOOR + 0.9 - by, -0.7, FLOOR + 2.3 - by] }], hangarWall, hubGlass, hubFrame);
    // Exposed structure every 3 m: wall posts and ceiling beams in bare aluminium.
    for (let z = HG.z0 + 1.5; z < HG.z1 - 0.4; z += 3) {
      for (const sx of [-1, 1]) { const p = boxPBR(0.14, HH, 0.26, hubFrame, 0.6); p.position.set(sx * (HG.x - 0.07), cy, z); add(p); }
      const beam = boxPBR(HG.x * 2, 0.3, 0.26, hubFrame, 0.6); beam.position.set(0, CEIL - 0.15, z); add(beam);
    }
    // Door jambs where the leaves leave the room, the head track and a floor guide.
    for (const sx of [-1, 1]) { const j = boxPBR(0.3, HH, 0.3, hubFrame, 0.6); j.position.set(sx * (HG.x - 0.15), cy, HG.z0 + 0.45); add(j); }
    const track = boxPBR(HG.x * 4.1, 0.3, 0.3, hubFrame, 0.6); track.position.set(0, CEIL - 0.15, HG.z0); add(track);
    const guide = new THREE.Mesh(new THREE.PlaneGeometry(HG.x * 2, 0.08), darkMat); guide.rotation.x = -Math.PI / 2; guide.position.set(0, FLOOR + 0.002, HG.z0); add(guide);
    // Hazard bands: kick plates along both walls and the door sweep zone on the deck.
    for (const sx of [-1, 1]) {
      const kp = plane(len - 0.3, 0.3, hazard); kp.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; kp.position.set(sx * (HG.x - 0.02), FLOOR + 0.15, cz + 0.15); add(kp);
    }
    const sweep = plane(HG.x * 2 - 0.6, 0.8, hazard); sweep.rotation.x = -Math.PI / 2; sweep.position.set(0, FLOOR + 0.003, HG.z0 + 0.7);
    (sweep.material as THREE.Material).polygonOffset = true; (sweep.material as THREE.Material).polygonOffsetFactor = -2; add(sweep);
    // A painted pedestrian lane from H-1 into the bay, and the bay stencil.
    const paintLine = new THREE.MeshStandardMaterial({ color: 0xe8b60f, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const lx of [-0.75, 0.75]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 6), paintLine); m.rotation.x = -Math.PI / 2; m.position.set(lx, FLOOR + 0.002, HG.z1 - 3.1); add(m); }
    const stencil = (() => { const c = document.createElement('canvas'); c.width = 2048; c.height = 400; const g = c.getContext('2d')!; g.fillStyle = '#e8b60f'; g.font = '900 250px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.fillText('BAY 01', 1024, 300); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.7), new THREE.MeshStandardMaterial({ map: stencil, transparent: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
    decal.rotation.x = -Math.PI / 2; decal.rotation.z = Math.PI; decal.position.set(-3.2, FLOOR + 0.003, HG.z1 - 2.4); add(decal);
    // Caged work lights high on both walls.
    for (const x of [-HG.x + 0.3, HG.x - 0.3]) for (let z = HG.z0 + 2; z < HG.z1; z += 3) {
      const housing = boxPBR(0.3, 0.4, 0.7, hubFrame, 0.4); housing.position.set(x, CEIL - 0.9, z); add(housing);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.6), hubLamp); lens.rotation.x = Math.PI / 2; lens.position.set(x, CEIL - 1.105, z); add(lens);
      for (let k = -2; k <= 2; k++) { const bar = boxPBR(0.01, 0.015, 0.7, hubFrame, 0.3); bar.position.set(x + k * 0.055, CEIL - 1.12, z); add(bar); }
    }
    for (const [x, z] of [[-3, cz - 4], [3, cz - 4], [0, cz + 4]] as const) { const l = new THREE.PointLight(0xe0e8ff, 9, 22, 2); l.position.set(x, CEIL - 1.4, z); add(l); }
    const sign = plane(3.4, 0.5, new THREE.MeshStandardMaterial({ map: labelTexture(['BAY 01 · KEEP CLEAR OF THE DOORS'], { bg: '#1f2937', fg: '#facc15', w: 1024, h: 150, font: 40 }), roughness: 0.5 }));
    sign.position.set(0, FLOOR + 3.0, HG.z1 - 0.05); sign.rotation.y = Math.PI; add(sign);
    // Ground support panel at the stand, the bay control console by H-1, fire main and cabinet, door beacon.
    const gse = boxPBR(0.14, 1.5, 1.9, hubFrame, 0.5); gse.position.set(HG.x - 0.1, FLOOR + 1.3, -16.0); add(gse);
    const gsePlate = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.3), new THREE.MeshStandardMaterial({ map: plateTexture(['GROUND SUPPORT', 'FUEL · POWER · DATA', 'STAND 01'], { bg: '#e9e6de', w: 1024, h: 768, font: 92 }), roughness: 0.55 }));
    gsePlate.rotation.y = -Math.PI / 2; gsePlate.position.set(HG.x - 0.18, FLOOR + 1.3, -16.0); add(gsePlate);
    const ctl = boxPBR(0.9, 0.62, 0.12, hubFrame, 0.5); ctl.position.set(-1.6, FLOOR + 1.45, HG.z1 - 0.1); add(ctl);
    bayScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: bayTex, toneMapped: false }));
    bayScreenMesh.rotation.y = Math.PI; bayScreenMesh.position.set(-1.6, FLOOR + 1.45, HG.z1 - 0.17); add(bayScreenMesh);
    const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 24), new THREE.MeshPhysicalMaterial({ color: 0xc81e1e, roughness: 0.3, clearcoat: 1 }));
    estop.rotation.x = Math.PI / 2; estop.position.set(-1.0, FLOOR + 1.2, HG.z1 - 0.2); add(estop);
    const fireMat = new THREE.MeshPhysicalMaterial({ color: 0xb3121c, metalness: 0.5, roughness: 0.35, clearcoat: 0.8 });
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len - 1, 24), fireMat); main.rotation.x = Math.PI / 2; main.position.set(2.6, CEIL - 0.42, cz); add(main);
    for (let z = HG.z0 + 2.5; z < HG.z1 - 1; z += 3.2) { const nz = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 16), fireMat); nz.rotation.x = Math.PI; nz.position.set(2.6, CEIL - 0.54, z); add(nz); }
    const cab = boxPBR(0.5, 0.8, 0.16, fireMat as THREE.Material, 0.5); cab.position.set(HG.x - 0.1, FLOOR + 1.2, HG.z1 - 1.2); add(cab);
    const cabPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshStandardMaterial({ map: plateTexture(['FIRE', 'EXTINGUISHER'], { bg: '#f5f5f5', w: 512, h: 256, font: 70 }), roughness: 0.5 }));
    cabPlate.rotation.y = -Math.PI / 2; cabPlate.position.set(HG.x - 0.19, FLOOR + 1.45, HG.z1 - 1.2); add(cabPlate);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 24), new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff8a00, emissiveIntensity: 0.9, roughness: 0.3 }));
    beacon.name = 'bay-beacon'; beacon.position.set(0, CEIL - 0.6, HG.z0 + 0.8); add(beacon);
  }
  // Bay doors: two painted leaves hung from the head track, stiffened, with a hazard band and a rubber meeting
  // seal. Opened, each slides 6 m into a pocket outside its side wall (inside the hull).
  const doorPaint = constructionMaterial(paintedPanels(0xb3b8bf, 27));
  const LEAF_H = HH - 0.3;
  const makeLeaf = (side: -1 | 1) => {
    const g = new THREE.Group();
    const body = boxPBR(HG.x, LEAF_H, 0.2, doorPaint, 2.4); g.add(body);
    for (let y = -LEAF_H / 2 + 1.4; y < LEAF_H / 2; y += 1.6) { const rib = boxPBR(HG.x - 0.3, 0.14, 0.08, hubFrame, 0.5); rib.position.set(0, y, 0.14); g.add(rib); }
    const band = plane(HG.x - 0.2, 0.4, hazard); band.position.set(0, -LEAF_H / 2 + 0.35, 0.181); g.add(band);
    const seal = boxPBR(0.06, LEAF_H, 0.22, sealMat, 0.2); seal.position.set(-side * (HG.x / 2 - 0.03), 0, 0); g.add(seal);
    g.position.set(side * HG.x / 2, FLOOR + LEAF_H / 2, HG.z0);
    g.userData.keep = true;
    add(g);
    return g;
  };
  const hangarLeft = makeLeaf(-1), hangarRight = makeLeaf(1);

  target = interior;

  // ---------- mission patches ----------
  const patchMat = new THREE.MeshStandardMaterial({ map: patchTexture(), transparent: true, roughness: 0.7 });
  for (const [pos, rotY] of [[V(RX0 + 0.03, 0.9, -1.0), Math.PI / 2], [V(13.0, 1.6, -OS + 0.03), 0]] as const) {
    const p = plane(0.6, 0.6, patchMat);
    p.position.copy(pos);
    p.rotation.y = rotY;
    add(p);
  }

  // ---------- exterior ----------
  // Two layers. `hull`: the closed shells, shown only when the camera is outside. `skin`: outward-facing
  // surfaces that stay visible from inside the glass walkway (their backs are culled from inside the rooms),
  // with the doorways cut through them so they never wall off a door.
  const hull = new THREE.Group();
  hull.name = 'hull';
  exterior.add(hull);
  const skin = new THREE.Group();
  skin.name = 'skin';
  exterior.add(skin);
  {
    const doorHole = (cy: number) => new THREE.Path([new THREE.Vector2(-DOOR_W / 2, DECK - cy), new THREE.Vector2(-DOOR_W / 2, DECK + DOOR_H - cy), new THREE.Vector2(DOOR_W / 2, DECK + DOOR_H - cy), new THREE.Vector2(DOOR_W / 2, DECK - cy)]);
    // Research module: an open-ended MLI cylinder and two end caps with the doorway cut out.
    const rs = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 11.2 - RX0, 48, 1, true), mliMat);
    rs.rotation.z = Math.PI / 2; rs.position.set((RX0 + 11.2) / 2, 0, 0); skin.add(rs);
    for (const [x, rot] of [[RX0 - 0.01, -Math.PI / 2], [11.21, Math.PI / 2]] as const) {
      const sh = new THREE.Shape(); sh.absarc(0, 0, 2.15, 0, Math.PI * 2, false); sh.holes.push(doorHole(0));
      const cap = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), mliMat); cap.rotation.y = rot; cap.position.set(x, 0, 0); skin.add(cap);
    }
    // Hangar: the bulkhead face (with H-1 and the gallery cut out), roof, floor and the door-pocket housings.
    const bayOut = new THREE.Group(); bayOut.rotation.y = Math.PI / 2; bayOut.position.set(5.6, 0, 0); skin.add(bayOut);
    const W = 12.6, by = DECK + HH / 2;
    const bh = new THREE.Shape([new THREE.Vector2(-W, DECK - 0.25 - by), new THREE.Vector2(W, DECK - 0.25 - by), new THREE.Vector2(W, DECK + HH + 0.25 - by), new THREE.Vector2(-W, DECK + HH + 0.25 - by)]);
    bh.holes.push(doorHole(by));
    bh.holes.push(new THREE.Path([new THREE.Vector2(0.7, DECK + 0.9 - by), new THREE.Vector2(0.7, DECK + 2.3 - by), new THREE.Vector2(1.7, DECK + 2.3 - by), new THREE.Vector2(1.7, DECK + 0.9 - by)]));
    const bulk = new THREE.Mesh(new THREE.ShapeGeometry(bh), mliMat); bulk.position.set(0, by, HG.z1 + 0.012); bayOut.add(bulk);
    const shell = (w: number, h: number, d: number, x: number, y: number, z: number) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mliMat); b.position.set(x, y, z); bayOut.add(b); };
    shell(W * 2, 0.2, HG.z1 - HG.z0, 0, DECK - 0.15, (HG.z0 + HG.z1) / 2);          // floor
    shell(W * 2, 0.2, HG.z1 - HG.z0, 0, DECK + HH + 0.15, (HG.z0 + HG.z1) / 2);     // roof
    for (const sx of [-1, 1]) {
      shell(0.2, HH + 0.5, HG.z1 - HG.z0 - 0.6, sx * (HG.x + 0.12), by, (HG.z0 + HG.z1) / 2 + 0.3); // side walls
      shell(HG.x + 0.5, HH + 0.5, 0.6, sx * (HG.x * 1.5 + 0.35), by, HG.z0 + 0.05);           // door pockets
    }
    // Closed shells for the view from outside.
    const obs = new THREE.Mesh(new THREE.CylinderGeometry(OS * 1.45, OS * 1.45, 6, 48), mliMat);
    obs.rotation.z = Math.PI / 2; obs.position.set(14.6, 0, 0); hull.add(obs);
    // Truss above the station, clear of the 8 m bay, carrying solar wings and radiators.
    const TY = 2.6; // lift over the old layout
    const truss = new THREE.Group();
    const trussMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.4, metalness: 0.7 });
    for (let x = -28; x <= 28; x += 2) {
      for (const [y, z] of [[5.6, -0.7], [5.6, 0.7], [7.0, -0.7], [7.0, 0.7]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 0.08), trussMat); b.position.set(x, y + TY, z); truss.add(b); }
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.06), trussMat); d.position.set(x - 1, 6.3 + TY, 0); d.rotation.x = 0.5; truss.add(d);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6.0, 12), trussMat); mast.position.set(7, 4.5, 0); truss.add(mast);
    const cellTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 512;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0a1a3a'; g.fillRect(0, 0, 256, 512);
      for (let y = 0; y < 512; y += 16) for (let x = 0; x < 256; x += 16) { g.fillStyle = `rgb(${18 + (x + y) % 9},${40 + (x * y) % 13},${110 + (y % 30)})`; g.fillRect(x + 1, y + 1, 14, 14); }
      g.strokeStyle = '#c0a060'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 510);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const cellMat = new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.25, metalness: 0.6, side: THREE.DoubleSide });
    for (const x of [-18, -12, 18, 24]) for (const z of [-1, 1]) { const wing = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 16), cellMat); wing.rotation.x = -Math.PI / 2; wing.position.set(x, 6.3 + TY, z * 9.2); truss.add(wing); }
    const radMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide });
    for (const x of [-8, 8]) { const r = new THREE.Mesh(new THREE.PlaneGeometry(3, 9), radMat); r.position.set(x, 9.5 + TY, 0); truss.add(r); }
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3.2), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
    dish.position.set(4, 8.2 + TY, 2); dish.rotation.x = -0.6; truss.add(dish);
    for (const [x, h] of [[-4, 2.4], [6, 1.6], [-12, 2.0]]) { const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 6), trussMat); ant.position.set(x, 7.0 + TY + h / 2, -0.6); truss.add(ant); }
    exterior.add(truss);
    const extPatch = plane(2.2, 2.2, patchMat);
    extPatch.position.set((RX0 + 11.2) / 2, 0, 2.17);
    skin.add(extPatch);
  }

  // Walking: one deck everywhere, so the floor under any point is the deck. No hidden ramps, no steps.
  const groundAt = () => DECK;

  const anchors: Anchors = {
    spawn: V(6.8, DECK + 1.55, 0.5),
    telescopeBase: V(15.4, -0.7, 0),
    telescopeEye: V(14.3, 0.35, 0),
    workstation: V(8.2, -0.25, -1.2),
    workstationSeat: V(8.2, 0.05, -0.35),
    hangarConsole: V(0.3, DECK + 1.45, 1.6),
    shuttleDock: V(-10.8, DECK, -2.35),
  };

  // Static walls, racks, frames and fittings become one mesh per material; the doors, leaves, beacon and workstation stay live.
  const merge = mergeStatic(interior, [hangarLeft, hangarRight, ...hatches.map((h) => h.leaf)]);
  interior.userData.merge = merge;
  void bayScreenMesh!;

  return {
    interior, exterior, space, rails, anchors, wallSpots, glass, groundAt,
    doors: { hangarLeft, hangarRight },
    hatches, bayScreen,
    hull,
  };
}
