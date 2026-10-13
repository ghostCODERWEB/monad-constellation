// Small things that float: each a few primitives with a canvas texture,
// sized like the real object. Built once, cloned per instance.
import * as THREE from 'three';
import { labelTexture } from './textures';

const mat = (color: number, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export function pen(color = 0x1d4ed8) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.14, 10), mat(color, 0.4));
  body.rotation.z = Math.PI / 2;
  g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.018, 10), mat(0xc0c0c0, 0.3, 0.8));
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 0.079;
  g.add(tip);
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.002, 0.004), mat(0xd4d4d8, 0.3, 0.8));
  clip.position.set(-0.045, 0.007, 0);
  g.add(clip);
  return g;
}

export function notebook(title = 'MISSION NOTES') {
  const g = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.21), [
    mat(0x1f2937), mat(0x1f2937), new THREE.MeshStandardMaterial({ map: labelTexture([title, '', 'Expedition 70'], { bg: '#1f2937', fg: '#e5e7eb', w: 256, h: 360, font: 20 }) }),
    mat(0xf5f5f0), mat(0xf5f5f0), mat(0xf5f5f0),
  ]);
  g.add(cover);
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.0125, 0.21), mat(0xb91c1c));
  band.position.x = 0.06;
  g.add(band);
  return g;
}

export function tablet() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.009, 0.17), mat(0x2b2b33, 0.3, 0.6));
  g.add(body);
  const c = document.createElement('canvas'); c.width = 512; c.height = 340;
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 512, 340); gr.addColorStop(0, '#120a2e'); gr.addColorStop(1, '#2a1f5c');
  x.fillStyle = gr; x.fillRect(0, 0, 512, 340);
  x.fillStyle = '#c4b5fd'; x.font = 'bold 28px system-ui'; x.fillText('Procedure 2.3.1', 28, 52);
  x.fillStyle = '#e9e5ff'; x.font = '20px system-ui';
  ['☑ Check CO₂ scrubber', '☑ Water recovery log', '☐ Find the missing screwdriver', '☑ Calibrate telescope'].forEach((t, i) => x.fillText(t, 28, 110 + i * 46));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.155), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.55 }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.0046;
  g.add(screen);
  return g;
}

export function wrench() {
  const g = new THREE.Group();
  const steel = mat(0xa1a1aa, 0.25, 0.9);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.008, 0.018), steel);
  g.add(handle);
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.007, 8, 16, Math.PI * 1.5), steel);
  head.position.x = 0.1;
  g.add(head);
  return g;
}

export function screwdriver() {
  const g = new THREE.Group();
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10), mat(0xf59e0b, 0.5));
  grip.rotation.z = Math.PI / 2;
  g.add(grip);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.09, 8), mat(0xd4d4d8, 0.2, 0.9));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.09;
  g.add(shaft);
  return g;
}

/** A food or drink pouch with a printed label. */
export function pouch(lines: string[], color = '#e5e7eb', drink = false) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, drink ? 0.14 : 0.16, 0.025), [
    mat(0xd6d3cc), mat(0xd6d3cc), mat(0xd6d3cc), mat(0xd6d3cc),
    new THREE.MeshStandardMaterial({ map: labelTexture(lines, { bg: color, fg: '#111827', w: 256, h: 320, font: 26 }), roughness: 0.55, metalness: 0.2 }),
    mat(0xc9c5bd, 0.5, 0.3),
  ]);
  g.add(body);
  if (drink) {
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 8), mat(0x2563eb, 0.4));
    straw.position.set(0.03, 0.09, 0);
    g.add(straw);
  }
  return g;
}

export function cable() {
  const pts = [];
  for (let i = 0; i < 10; i++) pts.push(new THREE.Vector3(Math.sin(i * 0.9) * 0.06, i * 0.03 - 0.14, Math.cos(i * 1.4) * 0.05));
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.005, 6, false), mat(0x111827, 0.7));
}

export function banana() {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const a = -0.9 + i * 0.18; pts.push(new THREE.Vector3(Math.sin(a) * 0.1, Math.cos(a) * 0.1 - 0.1, 0)); }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.017, 10, false), mat(0xfde047, 0.55));
  g.add(body);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.025, 6), mat(0x4d3b1f));
  stem.position.set(-0.08, -0.03, 0);
  stem.rotation.z = 1;
  g.add(stem);
  return g;
}

export function duck() {
  const g = new THREE.Group();
  const yellow = mat(0xfacc15, 0.35);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), yellow);
  body.scale.set(1.3, 0.9, 1);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), yellow);
  head.position.set(0.03, 0.035, 0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 8), mat(0xf97316, 0.4));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.056, 0.032, 0);
  g.add(beak);
  for (const z of [-0.009, 0.009]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 6, 6), mat(0x111111, 0.2));
    eye.position.set(0.045, 0.042, z);
    g.add(eye);
  }
  return g;
}

/** A plush cat in a tiny helmet. */
export function spaceCat() {
  const g = new THREE.Group();
  const fur = mat(0xf2a65a, 0.95);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), fur);
  body.scale.set(1, 1.15, 0.9);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), fur);
  head.position.y = 0.09;
  g.add(head);
  for (const x of [-0.025, 0.025]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.03, 4), fur);
    ear.position.set(x, 0.13, 0);
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), mat(0x111111, 0.2));
    eye.position.set(x * 0.7, 0.095, 0.04);
    g.add(eye);
  }
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.25, roughness: 0.05, clearcoat: 1 }));
  helmet.position.y = 0.095;
  g.add(helmet);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 20), mat(0x836ef9, 0.4, 0.3));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.045;
  g.add(ring);
  return g;
}

export function sock() {
  const g = new THREE.Group();
  const knit = mat(0xe11d48, 0.95);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.12, 12), knit);
  g.add(leg);
  const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.06, 6, 10), knit);
  foot.rotation.z = Math.PI / 2;
  foot.position.set(0.035, -0.07, 0);
  g.add(foot);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0285, 0.0285, 0.015, 12), mat(0xffffff, 0.9));
  stripe.position.y = 0.045;
  g.add(stripe);
  return g;
}

export function ufo() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 8), mat(0x9ca3af, 0.3, 0.8));
  disc.scale.set(1, 0.25, 1);
  g.add(disc);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x86efac, transparent: true, opacity: 0.6, roughness: 0.1 }));
  dome.position.y = 0.01;
  g.add(dome);
  return g;
}

export function toyRocket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 12), mat(0xf5f5f5, 0.4));
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 12), mat(0xdc2626, 0.4));
  nose.position.y = 0.055;
  g.add(nose);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.016), mat(0x836ef9, 0.4));
    fin.position.set(Math.cos(i * 2.1) * 0.014, -0.035, Math.sin(i * 2.1) * 0.014);
    fin.rotation.y = -i * 2.1;
    g.add(fin);
  }
  return g;
}

/** A free-floating blob of water: wobbles, refracts a little. */
export function waterBlob(r = 0.05) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshPhysicalMaterial({
    color: 0xcfe8ff, transparent: true, opacity: 0.45, roughness: 0.02, metalness: 0, clearcoat: 1, transmission: 0.6, thickness: 0.05, ior: 1.33,
  }));
}

export function helmet() {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 18), mat(0xf4f4f2, 0.5));
  g.add(shell);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.162, 24, 18, -0.9, 1.8, 0.7, 1.1), new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.05, metalness: 1 }));
  g.add(visor);
  const lights = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.03), mat(0x333333, 0.4, 0.6));
  lights.position.set(0.12, 0.08, 0.06);
  g.add(lights);
  return g;
}
