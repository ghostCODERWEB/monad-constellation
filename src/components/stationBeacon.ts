// The orbital research station as seen from deep space, for the shuttle's
// return trip: the same layout as the interior (hangar bay, glass walkway,
// research room, observation room with its round window),
// scaled up so it reads from far away, with solar arrays, a radiator, a dish,
// blinking nav lights and a soft beacon glow. Built from primitives.
import * as THREE from 'three';

export interface StationBeacon {
  group: THREE.Group;
  /** Blink nav lights; call every frame. */
  update(t: number, camDistance: number): void;
}

const U = 2.6; // scene units per metre of the interior layout

function panelTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d1b4a'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = 'rgba(150,180,255,0.55)'; g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  const gr = g.createLinearGradient(0, 0, 512, 256); gr.addColorStop(0, 'rgba(120,160,255,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function glow() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.12, 'rgba(190,170,255,0.5)'); gr.addColorStop(0.4, 'rgba(120,90,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export function buildStationBeacon(): StationBeacon {
  const group = new THREE.Group();
  group.name = 'station-beacon';
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xa9a7b8, roughness: 0.6, metalness: 0.25, emissive: 0x1d1c30, emissiveIntensity: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3d4a, roughness: 0.5, metalness: 0.6 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc8, roughness: 0.35, metalness: 0.85 });
  const violet = new THREE.MeshStandardMaterial({ color: 0x836ef9, emissive: 0x836ef9, emissiveIntensity: 0.9 });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x8fc0ff });
  const lit = new THREE.MeshBasicMaterial({ color: 0xfff2d8 });
  const model = new THREE.Group();
  model.scale.setScalar(U);
  group.add(model);

  const cylX = (x0: number, x1: number, r: number, mat = hullMat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 40), mat);
    m.rotation.z = Math.PI / 2; m.position.x = (x0 + x1) / 2; model.add(m);
    for (const x of [x0, x1]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 10, 40), trimMat); ring.rotation.y = Math.PI / 2; ring.position.x = x; model.add(ring); }
    return m;
  };
  // Research room (middle), observation room with its great window (east), the glass walkway and the hangar bay (west).
  cylX(2.8, 11.2, 1.5);
  cylX(11.6, 17.6, 2.2);
  cylX(11.2, 11.6, 1.1, trimMat);
  const win = new THREE.Mesh(new THREE.CircleGeometry(1.75, 48), windowMat); win.rotation.y = Math.PI / 2; win.position.x = 17.65; model.add(win);
  const bez = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.1, 12, 48), trimMat); bez.rotation.y = Math.PI / 2; bez.position.x = 17.62; model.add(bez);
  cylX(0.4, 2.8, 1.2);
  const bay = new THREE.Mesh(new THREE.BoxGeometry(16.8, 8, 12), darkMat); bay.position.x = -8; model.add(bay);
  const bayGlow = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 6.5), lit); bayGlow.position.set(-16.42, 0, 0); bayGlow.rotation.y = -Math.PI / 2; model.add(bayGlow);
  // Violet livery band round the research module.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.52, 0.7, 40, 1, true), violet); band.rotation.z = Math.PI / 2; band.position.x = 7; model.add(band);
  // Solar wings on a truss across the hub, a radiator and a dish.
  const truss = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 40), trimMat); truss.position.set(6, 3.6, 0); model.add(truss);
  const pm = new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.35, metalness: 0.7, emissive: 0x0a1a55, emissiveIntensity: 0.5, side: THREE.DoubleSide });
  for (const z of [-1, 1]) for (const dz of [8, 17]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), pm);
    p.rotation.x = Math.PI / 2; p.rotation.z = Math.PI / 2; p.position.set(6, 3.6, z * dz); model.add(p);
  }
  const rad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 5, 9), new THREE.MeshStandardMaterial({ color: 0xdedce8, roughness: 0.6, metalness: 0.3 }));
  rad.position.set(-4, 7, 0); model.add(rad);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), trimMat);
  dish.position.set(4, 5.8, 2.5); dish.rotation.x = -0.5; model.add(dish);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8), trimMat); mast.position.set(4, 5.0, 2.5); model.add(mast);

  // Nav lights: red port, green starboard, white strobe on the observation end.
  const nav: { m: THREE.Mesh; phase: number }[] = [];
  for (const [p, col, ph] of [[new THREE.Vector3(6, 3.6, -20), 0xf87171, 0], [new THREE.Vector3(6, 3.6, 20), 0x4ade80, 0.5], [new THREE.Vector3(17.7, 2.3, 0), 0xffffff, 0.25], [new THREE.Vector3(-16.4, 4.4, 0), 0xffffff, 0.75]] as const) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), new THREE.MeshBasicMaterial({ color: col }));
    l.position.copy(p); model.add(l); nav.push({ m: l, phase: ph });
  }
  // Soft beacon glow so it reads from a long way off.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color: 0xb9a8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
  halo.scale.setScalar(420);
  group.add(halo);
  const light = new THREE.PointLight(0xd8ccff, 350, 600, 2);
  light.position.set(0, 40, 120);
  group.add(light);
  // (Lights here are point lights with a limited range: a directional or ambient light would relight the whole galaxy.)
  const fill = new THREE.PointLight(0xfff0e0, 300, 600, 2);
  fill.position.set(-90, -50, -120);
  group.add(fill);

  return {
    group,
    update(t, camDistance) {
      // The glow is for finding it from afar; up close it would wash the model out.
      halo.material.opacity = THREE.MathUtils.clamp((camDistance - 120) / 700, 0.05, 0.8);
      for (const n of nav) n.m.visible = ((t * 0.9 + n.phase) % 1) < 0.25;
      model.rotation.y = Math.sin(t * 0.05) * 0.05;
    },
  };
}
