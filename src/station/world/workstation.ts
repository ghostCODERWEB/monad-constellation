// The research workstation: a rack bay with a fold-out shelf, three monitors on
// articulated arms, a velcroed keyboard and trackball, foot restraints, cable
// runs with zip ties. Local frame: the wall is z = 0, the room is +z, and the
// shelf surface is y = 0. Screens are canvases the PC feature redraws; they
// only ever show what the station really knows (the research subject, the
// clock, and standby text where nothing is connected).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glassSmudge, normalFromHeight, pbrSet, plateTexture, scaleUV } from './pbr';

export interface WorkstationScreens {
  /** Redraws the monitors. `subject` is the live research subject, if any. */
  update(t: number, subject: { label: string; address: string; kind: string; source: string } | null, mode: string): void;
}

function box(w: number, h: number, d: number, mat: THREE.Material, tile = 0.4) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile); }
  return new THREE.Mesh(geo, mat);
}

/** A keyboard top: backlit legends on dark keys, with raised key caps in the normal map. */
function keyboardTextures() {
  const W = 1024, H = 352;
  const A = document.createElement('canvas'); A.width = W; A.height = H;
  const B = document.createElement('canvas'); B.width = W; B.height = H;
  const a = A.getContext('2d')!, h = B.getContext('2d')!;
  a.fillStyle = '#0c0d10'; a.fillRect(0, 0, W, H);
  h.fillStyle = '#505050'; h.fillRect(0, 0, W, H);
  const rows = ['` 1 2 3 4 5 6 7 8 9 0 - = ⌫', 'Tab Q W E R T Y U I O P [ ] \\', 'Caps A S D F G H J K L ; \' Enter', 'Shift Z X C V B N M , . / Shift', 'Ctrl Alt Space Alt Ctrl'];
  const key = 62, gap = 8;
  rows.forEach((row, ri) => {
    const keys = row.split(' ');
    const wide = (k: string) => (k === 'Space' ? 5.2 : k.length > 2 && k !== '⌫' ? 1.6 : k === '⌫' ? 1.8 : 1);
    const total = keys.reduce((s, k) => s + wide(k) * (key + gap), 0);
    let x = (W - total) / 2;
    const y = 22 + ri * (key + gap + 6);
    for (const k of keys) {
      const w = wide(k) * (key + gap) - gap;
      a.fillStyle = '#1b1d22'; a.beginPath(); a.roundRect(x, y, w, key, 9); a.fill();
      a.fillStyle = '#24272e'; a.beginPath(); a.roundRect(x + 3, y + 3, w - 6, key - 10, 7); a.fill();
      a.fillStyle = '#9feccf'; a.font = `600 ${k.length > 2 ? 17 : 26}px "Helvetica Neue", Arial, sans-serif`; a.textAlign = 'center';
      if (k !== 'Space') a.fillText(k, x + w / 2, y + key / 2 + 6);
      h.fillStyle = '#b8b8b8'; h.beginPath(); h.roundRect(x + 2, y + 2, w - 4, key - 4, 9); h.fill();
      h.fillStyle = '#d0d0d0'; h.beginPath(); h.roundRect(x + 6, y + 6, w - 12, key - 14, 7); h.fill();
      x += w + gap;
    }
  });
  const map = new THREE.CanvasTexture(A); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(B, 3)); normalMap.anisotropy = 16;
  return { map, normalMap };
}

export function buildWorkstation(anchor: THREE.Vector3) {
  const g = new THREE.Group();
  g.name = 'workstation';
  g.position.copy(anchor);

  const alu = pbrSet('brushed-aluminium', { color: 0xd6d9de, normal: 0.7, roughness: 0.85 });
  const gold = pbrSet('brushed-aluminium', { color: 0xe3b94a, normal: 0.6, roughness: 0.85, clearcoat: 0.3 });
  const carbon = pbrSet('carbon-weave', { color: 0xb5bcc4, normal: 1, roughness: 0.9, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const rubber = pbrSet('rubber', { color: 0x2a2c31, normal: 1.3 });
  const plastic = new THREE.MeshPhysicalMaterial({ color: 0x15171b, roughness: 0.42, metalness: 0.15, clearcoat: 0.3, clearcoatRoughness: 0.35 });
  const velcro = new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 1 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0.1, roughness: 1, roughnessMap: glassSmudge(), clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false });
  const place = <T extends THREE.Object3D>(m: T, x: number, y: number, z: number) => { m.position.set(x, y, z); g.add(m); return m; };

  // Backplate in carbon composite, framed in brushed aluminium, with fasteners.
  place(box(1.56, 1.42, 0.03, carbon, 0.3), 0, 0.5, 0.025);
  for (const sx of [-1, 1]) place(box(0.05, 1.46, 0.05, alu), sx * 0.8, 0.5, 0.04);
  place(box(1.64, 0.05, 0.05, alu), 0, 1.23, 0.04);
  place(box(1.64, 0.05, 0.05, alu), 0, -0.2, 0.04);
  const screwGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.008, 10);
  const screws = new THREE.InstancedMesh(screwGeo, alu, 40);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  let sc = 0;
  for (const sx of [-0.8, 0.8]) for (let y = -0.1; y <= 1.15; y += 0.25) screws.setMatrixAt(sc++, m4.compose(new THREE.Vector3(sx, y, 0.068), q, new THREE.Vector3(1, 1, 1)));
  screws.count = sc;
  g.add(screws);

  // Nameplate and a laminated checklist.
  const name = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.075), new THREE.MeshStandardMaterial({ map: plateTexture(['NANSEN RESEARCH TERMINAL · MONAD'], { bg: '#e9e6de', w: 1024, h: 128, font: 52 }), roughness: 0.5 }));
  place(name, 0, 1.12, 0.043);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.22), new THREE.MeshStandardMaterial({ map: plateTexture(['CHECKLIST', 'WS-3.1', 'LOG IN', 'SELECT WORLD', 'ASK NANSEN AI'], { bg: '#f3f0e4', w: 256, h: 352, font: 30 }), roughness: 0.3 }));
  place(card, -0.62, 0.85, 0.043);
  for (const [x, y] of [[0.66, 0.9], [0.66, 0.55], [-0.66, 0.5]]) place(box(0.1, 0.05, 0.004, velcro), x, y, 0.045);

  // Shelf: brushed aluminium with a rubber work mat, edge lip, two braces.
  place(box(1.5, 0.04, 0.5, alu), 0, -0.02, 0.27);
  const mat = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(1.42, 0.42), 4, 1.3), rubber);
  mat.rotation.x = -Math.PI / 2; place(mat, 0, 0.0005, 0.28);
  place(box(1.5, 0.03, 0.02, alu), 0, 0.01, 0.52);
  for (const sx of [-0.55, 0.55]) {
    const brace = box(0.03, 0.4, 0.03, alu);
    brace.rotation.x = -0.65;
    place(brace, sx, -0.19, 0.2);
  }

  // Monitors on arms.
  const screens: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; title: string; w: number; h: number }[] = [];
  const monitor = (w: number, h: number, x: number, y: number, z: number, yaw: number, title: string) => {
    const m = new THREE.Group();
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.04, 4, 0.012), plastic);
    m.add(bezel);
    const px = 1024, py = Math.round(1024 * (h - 0.04) / (w - 0.04));
    const c = document.createElement('canvas'); c.width = px; c.height = py;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.95, roughness: 0.25, metalness: 0 }));
    screen.position.z = 0.0205; m.add(screen);
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), glassMat);
    cover.position.z = 0.0215; m.add(cover);
    const chin = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.007), new THREE.MeshStandardMaterial({ map: plateTexture(['NANSEN'], { bg: '#15171b', fg: '#9feccf', w: 256, h: 40, font: 26 }), roughness: 0.4 }));
    chin.position.set(0, -h / 2 + 0.011, 0.0205); m.add(chin);
    const ledDot = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 10), new THREE.MeshBasicMaterial({ color: 0x35ff9b }));
    ledDot.position.set(w / 2 - 0.02, -h / 2 + 0.011, 0.0206); m.add(ledDot);
    // Rear VESA plate and the arm back to the bay.
    const plate = box(0.1, 0.1, 0.012, alu); plate.position.z = -0.026; m.add(plate);
    m.position.set(x, y, z); m.rotation.y = yaw;
    g.add(m);
    const armLen = Math.hypot(z - 0.06, x * 0.3);
    const arm = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.014, 0.014, armLen, 20), 1, 1), alu);
    arm.rotation.x = Math.PI / 2; arm.position.set(x * 0.65, y, 0.06 + (z - 0.06) / 2); g.add(arm);
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 14), alu); knuckle.position.set(x * 0.65, y, 0.065); g.add(knuckle);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14), alu); elbow.position.set(x, y, z - 0.035); g.add(elbow);
    screens.push({ c, g: c.getContext('2d')!, tex, title, w: px, h: py });
    if (title === 'main') g.userData.mainScreen = { mesh: screen, w: w - 0.04, h: h - 0.04 };
  };
  monitor(0.9, 0.5, 0, 0.52, 0.2, 0, 'main');
  monitor(0.34, 0.26, -0.66, 0.5, 0.12, 0.34, 'left');
  monitor(0.34, 0.26, 0.66, 0.5, 0.12, -0.34, 'right');

  // Keyboard and trackball, velcroed to the mat.
  const kb = keyboardTextures();
  const kbBody = box(0.42, 0.016, 0.15, plastic);
  place(kbBody, 0.0, 0.01, 0.3);
  const kbTop = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4 * 352 / 1024 * 1.02), new THREE.MeshStandardMaterial({ map: kb.map, normalMap: kb.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.55, metalness: 0.1 }));
  kbTop.rotation.x = -Math.PI / 2; place(kbTop, 0, 0.0185, 0.3);
  place(box(0.36, 0.004, 0.02, velcro), 0, -0.0005, 0.3);
  const tb = new THREE.Group();
  tb.add(box(0.1, 0.03, 0.09, plastic));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.019, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xb3121c, roughness: 0.2, clearcoat: 1 }));
  ball.position.y = 0.02; tb.add(ball);
  place(tb, 0.32, 0.02, 0.32);
  // Cable runs: monitors and keyboard down to the bay with zip ties.
  const cableMats = [0x1f2937, 0x7c2d12, 0x374151].map((c) => pbrSet('rubber', { color: c, normal: 1.4 }));
  const run = (from: THREE.Vector3, via: THREE.Vector3, to: THREE.Vector3, mi: number) => {
    const curve = new THREE.CatmullRomCurve3([from, via, to]);
    g.add(new THREE.Mesh(scaleUV(new THREE.TubeGeometry(curve, 40, 0.007, 8, false), 8, 1), cableMats[mi % 3]));
    const tieMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.55 });
    for (const t of [0.3, 0.62]) {
      const p = curve.getPoint(t), tan = curve.getTangent(t);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0018, 6, 12), tieMat);
      tie.position.copy(p); tie.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan);
      g.add(tie);
    }
  };
  run(new THREE.Vector3(0, 0.32, 0.17), new THREE.Vector3(0.04, 0.12, 0.07), new THREE.Vector3(0.1, -0.015, 0.07), 0);
  run(new THREE.Vector3(-0.62, 0.35, 0.12), new THREE.Vector3(-0.45, 0.1, 0.07), new THREE.Vector3(-0.2, -0.015, 0.07), 1);
  run(new THREE.Vector3(0.62, 0.35, 0.12), new THREE.Vector3(0.45, 0.1, 0.07), new THREE.Vector3(0.25, -0.015, 0.07), 2);
  run(new THREE.Vector3(0.0, 0.01, 0.23), new THREE.Vector3(-0.05, 0.0, 0.14), new THREE.Vector3(-0.1, -0.012, 0.07), 1);

  // Foot restraints bolted to the floor below, with rubber straps.
  for (const sx of [-0.22, 0.22]) {
    place(box(0.3, 0.02, 0.1, alu), sx, -1.24, 0.4);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 8, 20, Math.PI), rubber);
    strap.rotation.z = 0; strap.position.set(0, 0.01, 0); strap.rotation.y = Math.PI / 2;
    const holder = new THREE.Group(); holder.add(strap); place(holder, sx, -1.23, 0.4);
  }
  // A work light bar over the monitors.
  const bar = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.02, 0.04, 3, 0.008), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dd, emissiveIntensity: 1.1 }));
  place(bar, 0, 0.95, 0.09);
  const lamp = new THREE.PointLight(0xfff0dd, 0.35, 2.2, 2);
  place(lamp, 0, 0.8, 0.7);

  // ---- screens ----
  let last = -1;
  const header = (c: CanvasRenderingContext2D, w: number, title: string, sub: string) => {
    const gr = c.createLinearGradient(0, 0, 0, 90); gr.addColorStop(0, '#0f2a24'); gr.addColorStop(1, '#0a1714');
    c.fillStyle = gr; c.fillRect(0, 0, w, 90);
    c.fillStyle = '#00ffa7'; c.font = '700 34px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'left'; c.fillText(title, 30, 56);
    c.fillStyle = '#7fb5a4'; c.font = '500 22px "Helvetica Neue", Arial, sans-serif'; c.textAlign = 'right'; c.fillText(sub, w - 30, 54);
  };
  const update: WorkstationScreens['update'] = (t, subject, mode) => {
    if (Math.floor(t * 2) === last) return;
    last = Math.floor(t * 2);
    const now = new Date();
    const clock = now.toISOString().slice(11, 19) + ' UTC';
    for (const s of screens) {
      const c = s.g;
      c.fillStyle = '#05090a'; c.fillRect(0, 0, s.w, s.h);
      c.fillStyle = 'rgba(0,255,167,0.035)'; for (let y = 0; y < s.h; y += 4) c.fillRect(0, y, s.w, 1);
      if (s.title === 'main') {
        header(c, s.w, 'NANSEN RESEARCH TERMINAL', clock);
        c.textAlign = 'left';
        c.fillStyle = '#cfeee4'; c.font = '600 30px "Helvetica Neue", Arial, sans-serif';
        c.fillText(mode === 'pc' ? 'Session open' : 'Session idle', 30, 150);
        c.fillStyle = '#7fb5a4'; c.font = '500 24px "Helvetica Neue", Arial, sans-serif';
        c.fillText(mode === 'pc' ? 'Use the terminal panel on screen.' : 'Press E at the desk (or P) to open the terminal.', 30, 190);
        c.fillStyle = '#9feccf'; c.font = '600 26px "Helvetica Neue", Arial, sans-serif';
        c.fillText('RESEARCH SUBJECT', 30, 270);
        c.fillStyle = subject ? '#ffffff' : '#587a70'; c.font = '700 44px "Helvetica Neue", Arial, sans-serif';
        c.fillText(subject ? subject.label : 'none selected', 30, 326);
        c.fillStyle = '#7fb5a4'; c.font = '500 22px ui-monospace, Menlo, monospace';
        c.fillText(subject ? `${subject.kind} · ${subject.address.slice(0, 10)}…${subject.address.slice(-6)} · via ${subject.source}` : 'Pick a world through the telescope, or in the terminal.', 30, 366);
        c.strokeStyle = '#1f4a3f'; c.lineWidth = 2; c.strokeRect(20, 230, s.w - 40, 170);
        c.fillStyle = '#587a70'; c.font = '500 20px "Helvetica Neue", Arial, sans-serif'; c.fillText('Source: Nansen · Monad only · research and paper trading, no live orders', 30, s.h - 24);
      } else {
        header(c, s.w, s.title === 'left' ? 'WALLET RADAR' : 'INSIDER RADAR', clock.slice(0, 5));
        c.textAlign = 'center'; c.fillStyle = '#2b5a4c'; c.font = '700 54px "Helvetica Neue", Arial, sans-serif';
        c.fillText('STANDBY', s.w / 2, s.h / 2 + 30);
        c.fillStyle = '#587a70'; c.font = '500 24px "Helvetica Neue", Arial, sans-serif'; c.fillText('opens in the terminal', s.w / 2, s.h / 2 + 76);
      }
      s.tex.needsUpdate = true;
    }
  };
  g.userData.screens = { update } satisfies WorkstationScreens;
  update(0, null, 'walk');
  return g;
}
