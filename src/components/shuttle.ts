// The shuttle: built from primitives and canvas textures, no model file.
// Points along -Z, so "forward" is the object's local (0, 0, -1).
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
}

/** Hull paint: pale pearl with panel seams, a Monad-violet racing stripe and a gold pinstripe. */
function hullTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#f4f1ff'); grd.addColorStop(0.5, '#d9d3f2'); grd.addColorStop(1, '#b9b1dc');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  // Panel seams.
  g.strokeStyle = 'rgba(40, 28, 90, 0.35)'; g.lineWidth = 2;
  for (let x = 64; x < 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 96; y < 512; y += 160) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  // Rivet rows.
  g.fillStyle = 'rgba(40, 28, 90, 0.3)';
  for (let x = 8; x < 1024; x += 16) for (const y of [90, 250, 410]) { g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
  // Racing stripe along the spine, with a gold pinstripe.
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

export function buildShuttle(): Shuttle {
  const group = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    map: hullTexture(), metalness: 0.45, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, color: 0x9a93b8,
    emissive: 0x150d36, emissiveIntensity: 0.08,
  });
  const violet = new THREE.MeshPhysicalMaterial({ color: 0x6d5bd0, metalness: 0.8, roughness: 0.25, clearcoat: 1, emissive: 0x3b2a8c, emissiveIntensity: 0.15 });
  const gunmetal = new THREE.MeshPhysicalMaterial({ color: 0x24203a, metalness: 0.9, roughness: 0.35, clearcoat: 0.6 });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xd8d4ec, metalness: 1, roughness: 0.12 });

  // Fuselage: a lathe profile, needle nose to a broad engine block.
  const profile: THREE.Vector2[] = [];
  const pts: [number, number][] = [
    [0.0, -1.05], [0.035, -0.98], [0.075, -0.86], [0.12, -0.66], [0.155, -0.42], [0.18, -0.15],
    [0.19, 0.12], [0.185, 0.38], [0.17, 0.56], [0.15, 0.64], [0.0, 0.64],
  ];
  for (const [r, z] of pts) profile.push(new THREE.Vector2(r, z));
  const bodyGeo = new THREE.LatheGeometry(profile, 40);
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.scale(1, 0.72, 1); // a flatter, sleeker cross-section
  const body = new THREE.Mesh(bodyGeo, paint);
  group.add(body);

  // Canopy: tinted glass bubble with a chrome frame.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({
    color: 0x0b1a3a, metalness: 0.1, roughness: 0.02, clearcoat: 1, emissive: 0x22d3ee, emissiveIntensity: 0.35, transparent: true, opacity: 0.92,
  }));
  canopy.scale.set(0.95, 0.75, 2.6);
  canopy.position.set(0, 0.1, -0.42);
  group.add(canopy);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.008, 6, 32, Math.PI), chrome);
  frame.position.set(0, 0.1, -0.42);
  frame.scale.set(1, 0.85, 1);
  group.add(frame);

  // Main wings: swept, bevelled, with violet leading edges.
  const wing = new THREE.Shape();
  wing.moveTo(0, -0.25); wing.lineTo(0.95, 0.28); wing.lineTo(0.98, 0.4); wing.lineTo(0.82, 0.42); wing.lineTo(0, 0.36); wing.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wing, { depth: 0.02, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2 });
  wingGeo.rotateX(Math.PI / 2);
  const edge = new THREE.Shape();
  edge.moveTo(0, -0.25); edge.lineTo(0.95, 0.28); edge.lineTo(0.93, 0.31); edge.lineTo(0, -0.2); edge.closePath();
  const edgeGeo = new THREE.ExtrudeGeometry(edge, { depth: 0.024, bevelEnabled: false });
  edgeGeo.rotateX(Math.PI / 2);

  // Canards near the nose.
  const canard = new THREE.Shape();
  canard.moveTo(0, -0.06); canard.lineTo(0.26, 0.06); canard.lineTo(0.25, 0.1); canard.lineTo(0, 0.08); canard.closePath();
  const canardGeo = new THREE.ExtrudeGeometry(canard, { depth: 0.012, bevelEnabled: false });
  canardGeo.rotateX(Math.PI / 2);

  const blinkers: Shuttle['blinkers'] = [];
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, paint);
    w.scale.x = side;
    w.position.set(0, -0.045, 0.02);
    w.rotation.z = side * -0.06; // a touch of anhedral
    group.add(w);
    const e = new THREE.Mesh(edgeGeo, violet);
    e.scale.x = side;
    e.position.set(0, -0.04, 0.02);
    e.rotation.z = side * -0.06;
    group.add(e);
    const cn = new THREE.Mesh(canardGeo, violet);
    cn.scale.x = side;
    cn.position.set(0, -0.01, -0.6);
    group.add(cn);

    // Wingtip pods with navigation lights: red port, green starboard.
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.2, 4, 10), chrome);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.97, -0.1, 0.36);
    group.add(pod);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 10), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x4ade80 : 0xf87171 }));
    nav.position.set(side * 0.97, -0.1, 0.24);
    group.add(nav);
    blinkers.push({ mesh: nav, phase: side > 0 ? 0 : 0.5 });

    // Twin tail fins, canted outward.
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(0.34, 0.3); fin.lineTo(0.42, 0.3); fin.lineTo(0.36, 0); fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.016, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
    const f = new THREE.Mesh(finGeo, violet);
    f.rotation.y = -Math.PI / 2;
    f.rotation.z = 0;
    f.position.set(side * 0.13, 0.08, 0.28);
    f.rotateX(side * 0.32);
    group.add(f);
  }

  // Dorsal strobe.
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.set(0, 0.15, 0.1);
  group.add(strobe);
  blinkers.push({ mesh: strobe, phase: 0.25 });

  // Engine block: two nacelles, chrome bells, glowing cores and thrust plumes.
  const nozzles: THREE.Vector3[] = [];
  const engineMats: THREE.MeshBasicMaterial[] = [];
  const plumes: THREE.Mesh[] = [];
  const plumeTex = glowTexture('rgba(255,255,255,1)', 'rgba(150,120,255,0.6)');
  for (const side of [1, -1]) {
    const x = side * 0.2;
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.5, 20), gunmetal);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(x, -0.03, 0.42);
    group.add(nacelle);
    const intake = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 24), chrome);
    intake.position.set(x, -0.03, 0.17);
    group.add(intake);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.075, 0.1, 20, 1, true), chrome);
    bell.rotation.x = Math.PI / 2;
    bell.position.set(x, -0.03, 0.71);
    group.add(bell);

    const core = new THREE.MeshBasicMaterial({ color: 0xc9bbff });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.078, 24), core);
    disc.position.set(x, -0.03, 0.755);
    group.add(disc);
    engineMats.push(core);

    // Plume: a long additive cone that stretches with throttle.
    const plumeGeo = new THREE.ConeGeometry(0.075, 1, 20, 1, true);
    plumeGeo.translate(0, -0.5, 0);
    plumeGeo.rotateX(-Math.PI / 2); // tip trails backwards (+Z)
    const plume = new THREE.Mesh(plumeGeo, new THREE.MeshBasicMaterial({
      color: 0x9d8cff, map: plumeTex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    plume.position.set(x, -0.03, 0.76);
    group.add(plume);
    plumes.push(plume);

    nozzles.push(new THREE.Vector3(x, -0.03, 0.8));
  }

  const light = new THREE.PointLight(0x9d8cff, 1.5, 3);
  light.position.set(0, 0, 1.0);
  group.add(light);

  // Key and rim lights that travel with the ship, so its paint reads anywhere.
  const key = new THREE.PointLight(0xffffff, 0.45, 4);
  key.position.set(0.8, 1.2, -0.6);
  group.add(key);
  const rim = new THREE.PointLight(0xb8a6ff, 0.35, 4);
  rim.position.set(-1.2, 0.3, 0.8);
  group.add(rim);

  group.scale.setScalar(1.15);
  return { group, nozzles, engineMats, plumes, blinkers, light };
}
