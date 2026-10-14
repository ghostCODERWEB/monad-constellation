// The spacesuit kit shared by the third-person astronaut and the first-person
// hands: materials (woven outer layer, hard composite, brushed bearing rings,
// rubber grip, gold sun visor) and an articulated EVA glove whose fingers curl.
//
// Glove frame (as on a hanging arm): fingers point −y, the palm faces −side·x
// (towards the body), the back of the hand +side·x, the thumb forwards (−z).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { pbrSet, scaleUV } from './pbr';

export interface SuitMats {
  fabric: THREE.Material; hard: THREE.Material; metal: THREE.Material; rubber: THREE.Material;
  accent: THREE.Material; visor: THREE.Material; glass: THREE.Material; dark: THREE.Material;
}

let mats: SuitMats | null = null;
export function suitMaterials(): SuitMats {
  if (mats) return mats;
  mats = {
    // Ortho-fabric outer layer: woven, matte, faintly warm white.
    fabric: pbrSet('fabric-weave', { color: 0xf3f1ea, normal: 1.1, roughness: 1 }),
    // Hard upper torso, helmet shell and boot shells: painted composite, satin clearcoat.
    hard: new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    metal: pbrSet('brushed-aluminium', { color: 0xd8dce2, normal: 0.6, roughness: 0.7 }),
    rubber: pbrSet('rubber', { color: 0x2a2c31, normal: 1.4 }),
    accent: new THREE.MeshPhysicalMaterial({ color: 0x836ef9, roughness: 0.5, metalness: 0, clearcoat: 0.3 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0xd4a94a, metalness: 1, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.18, roughness: 0.03, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x1d2026, roughness: 0.55, metalness: 0.2, clearcoat: 0.4 }),
  };
  return mats;
}

export interface Glove { group: THREE.Group; setCurl(k: number, thumb?: number): void }

/** An EVA glove: palm with rubber grip pads, knuckle guard, three-segment fingers, a thumb, wrist bearing and gauntlet. */
export function buildGlove(side: 1 | -1, scale = 1): Glove {
  const m = suitMaterials();
  const G = <T extends THREE.BufferGeometry>(g: T, u = 1, v = 1) => scaleUV(g, u, v);
  const group = new THREE.Group();
  const s = scale;
  // Gauntlet and the wrist disconnect bearing.
  const gaunt = new THREE.Mesh(G(new THREE.CylinderGeometry(0.047 * s, 0.054 * s, 0.07 * s, 24), 2, 1), m.fabric); gaunt.position.y = 0.05 * s; group.add(gaunt);
  const ring = new THREE.Mesh(G(new THREE.TorusGeometry(0.046 * s, 0.009 * s, 10, 32), 6, 1), m.metal); ring.rotation.x = Math.PI / 2; ring.position.y = 0.012 * s; group.add(ring);
  const lockTab = new THREE.Mesh(new THREE.BoxGeometry(0.012 * s, 0.014 * s, 0.02 * s), m.accent); lockTab.position.set(side * 0.05 * s, 0.012 * s, 0); group.add(lockTab);
  // The hand: a padded mitt body, the palm grip pad on the inside, a knuckle guard on the back.
  const hand = new THREE.Mesh(G(new RoundedBoxGeometry(0.036 * s, 0.092 * s, 0.084 * s, 4, 0.014 * s), 2, 2), m.fabric); hand.position.y = -0.042 * s; group.add(hand);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.008 * s, 0.07 * s, 0.07 * s, 3, 0.003 * s), m.rubber); pad.position.set(-side * 0.018 * s, -0.045 * s, 0); group.add(pad);
  const guard = new THREE.Mesh(new RoundedBoxGeometry(0.01 * s, 0.03 * s, 0.08 * s, 3, 0.004 * s), m.hard); guard.position.set(side * 0.019 * s, -0.075 * s, 0); group.add(guard);
  // Fingers: index (front) to little (back), each three phalanges with pads at the tips.
  const joints: THREE.Group[][] = [];
  const lens = [[0.032, 0.022, 0.018], [0.035, 0.024, 0.019], [0.033, 0.022, 0.018], [0.026, 0.018, 0.015]];
  [-0.029, -0.0095, 0.0095, 0.028].forEach((z, fi) => {
    let parent: THREE.Object3D = group;
    let y = -0.088 * s;
    const chain: THREE.Group[] = [];
    lens[fi].forEach((len, k) => {
      const j = new THREE.Group(); j.position.set(0, y, z * s); parent.add(j);
      const r = (0.0098 - k * 0.0008) * s;
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len * s - r * 1.2), 4, 10), m.fabric); seg.position.y = -len * s / 2 + r * 0.3; j.add(seg);
      if (k === 2) { const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 10, 8), m.rubber); tip.scale.set(0.6, 1, 1); tip.position.set(-side * r * 0.55, -len * s * 0.55, 0); j.add(tip); }
      chain.push(j);
      parent = j; y = -len * s; z = 0;
    });
    joints.push(chain);
  });
  // Thumb: from the base of the palm, forwards and down, two segments.
  const t0 = new THREE.Group(); t0.position.set(-side * 0.006 * s, -0.02 * s, -0.04 * s); t0.rotation.set(0.6, 0, -side * 0.25); group.add(t0);
  const tA = new THREE.Mesh(new THREE.CapsuleGeometry(0.011 * s, 0.022 * s, 4, 10), m.fabric); tA.position.y = -0.016 * s; t0.add(tA);
  const t1 = new THREE.Group(); t1.position.y = -0.032 * s; t0.add(t1);
  const tB = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105 * s, 0.016 * s, 4, 10), m.fabric); tB.position.y = -0.013 * s; t1.add(tB);
  const setCurl = (k: number, thumb = k) => {
    // Fingers curl towards the palm (−side·x): a rotation about z.
    for (const chain of joints) chain.forEach((j, i) => { j.rotation.z = -side * k * [0.75, 0.95, 0.7][i]; });
    t0.rotation.set(0.6 + thumb * 0.2, 0, -side * (0.25 + thumb * 0.45));
    t1.rotation.z = -side * thumb * 0.6;
  };
  setCurl(0.35);
  return { group, setCurl };
}

/** Accordion convolutes at a soft-suit joint: a short stack of tori. */
export function convolute(r: number, len: number, n = 4) {
  const m = suitMaterials();
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(r, len / n * 0.55, 10, 28), 6, 1), m.fabric);
    t.rotation.x = Math.PI / 2; t.position.y = -i * (len / n); g.add(t);
  }
  return g;
}

/** A bearing ring (shoulder, wrist, waist, hip): brushed metal with a purple index line. */
export function bearing(r: number, tube = 0.012) {
  const m = suitMaterials();
  const g = new THREE.Group();
  const ring = new THREE.Mesh(scaleUV(new THREE.TorusGeometry(r, tube, 12, 40), 8, 1), m.metal); ring.rotation.x = Math.PI / 2; g.add(ring);
  const idx = new THREE.Mesh(new THREE.BoxGeometry(tube * 1.4, tube * 1.4, tube * 2.5), m.accent); idx.position.set(0, 0, -r); g.add(idx);
  return g;
}
