// Makes the furniture solid. The room volumes only know where the air is, so
// each prop that was added after the walls (workstation, telescope and its
// console, the robot) gets a bounding box the walker slides around.
import * as THREE from 'three';
import type { Engine } from '../engine';

export function installColliders(e: Engine) {
  const space = e.station.space;
  const box = new THREE.Box3();
  e.station.interior.updateMatrixWorld(true);
  for (const c of e.station.interior.children) {
    // Props are groups; bare meshes here are walls, glass and hull pieces the room volumes already handle.
    if (c.type !== 'Group' || c.name === 'bay' || !c.visible) continue;
    box.setFromObject(c);
    if (box.isEmpty()) continue;
    // Ignore anything that is really a room-sized helper (lights, halos) rather than a prop.
    const size = box.getSize(new THREE.Vector3());
    if (size.x > 6 || size.z > 6 || size.y < 0.4 || Math.min(size.x, size.z) < 0.25) continue; // not furniture: fittings, strips, thin panels
    space.addProp(c.name || c.type, box.clone());
  }
  if (process.env.NODE_ENV !== 'production') console.info('[colliders]', space.props.map((p) => `${p.name} ${p.box.min.toArray().map((n) => n.toFixed(1))}→${p.box.max.toArray().map((n) => n.toFixed(1))}`));
}

/** Opaque meshes cast and receive the sun's shadows; glass, sprites and emitters do not. */
export function enableShadows(e: Engine) {
  e.station.interior.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const see = mat.transparent || mat.type === 'MeshBasicMaterial';
    m.receiveShadow = !see;
    m.castShadow = !see;
  });
}
