// The shuttle: built from primitives, no model file. Points along -Z, so
// "forward" is the object's local (0, 0, -1).
import * as THREE from 'three';

export interface Shuttle {
  group: THREE.Group;
  /** Engine exhaust points in the shuttle's local space. */
  nozzles: THREE.Vector3[];
  engineMats: THREE.MeshBasicMaterial[];
  light: THREE.PointLight;
}

export function buildShuttle(): Shuttle {
  const group = new THREE.Group();

  const hull = new THREE.MeshStandardMaterial({ color: 0xa9a2c8, metalness: 0.7, roughness: 0.38, emissive: 0x120c2e, emissiveIntensity: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x836ef9, metalness: 0.4, roughness: 0.4, emissive: 0x836ef9, emissiveIntensity: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1438, metalness: 0.7, roughness: 0.5 });

  // Fuselage: a capsule body with a tapered nose.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.9, 6, 16), hull);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.42, 16), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.78;
  group.add(nose);

  // Cockpit glass.
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.6, metalness: 0.2, roughness: 0.1 }));
  glass.scale.set(1, 0.8, 1.9);
  glass.position.set(0, 0.1, -0.42);
  group.add(glass);

  // Swept delta wings.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.25); wingShape.lineTo(0.78, -0.32); wingShape.lineTo(0.72, -0.46); wingShape.lineTo(0, -0.36); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.03, bevelEnabled: false });
  wingGeo.rotateX(Math.PI / 2);
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, hull);
    w.scale.x = side;
    w.position.set(0, -0.03, 0.08);
    group.add(w);
    // A Monad-violet stripe along each wing.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.045), trim);
    stripe.position.set(side * 0.38, 0.0, 0.1);
    stripe.rotation.y = side * 0.62;
    group.add(stripe);
    // Wingtip lights.
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: side > 0 ? 0x4ade80 : 0xf87171 }));
    tip.position.set(side * 0.74, 0.0, 0.42);
    group.add(tip);
  }

  // Tail fin.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.32), trim);
  fin.position.set(0, 0.2, 0.42);
  fin.rotation.x = -0.35;
  group.add(fin);

  // Twin engines with glowing nozzles.
  const nozzles: THREE.Vector3[] = [];
  const engineMats: THREE.MeshBasicMaterial[] = [];
  for (const side of [1, -1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.42, 14), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.2, -0.04, 0.42);
    group.add(pod);
    const mat = new THREE.MeshBasicMaterial({ color: 0xb8a6ff });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.07, 18), mat);
    glow.position.set(side * 0.2, -0.04, 0.635);
    group.add(glow);
    engineMats.push(mat);
    nozzles.push(new THREE.Vector3(side * 0.2, -0.04, 0.66));
  }

  const light = new THREE.PointLight(0x9d8cff, 1.5, 3);
  light.position.set(0, 0.2, 0.9);
  group.add(light);

  // Fill light so the hull reads against the dark.
  const fill = new THREE.PointLight(0xffffff, 0.35, 2.5);
  fill.position.set(0, 0.8, -0.2);
  group.add(fill);

  return { group, nozzles, engineMats, light };
}
