// Bakes the station's static meshes into one mesh per material, so the interior
// costs tens of draw calls instead of a thousand. Anything that moves, glows on a
// schedule, is looked up by name, or is see-through stays as it was.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MergeReport { before: number; after: number; groups: number }

const KEEP_NAMES = new Set(['workstation', 'bay-beacon']);

/** Merge opaque, static meshes under `root` (whose own transform must be identity) by material. `keep` objects and their subtrees are left alone. */
export function mergeStatic(root: THREE.Object3D, keep: THREE.Object3D[] = []): MergeReport {
  root.updateMatrixWorld(true);
  const skip = new Set<THREE.Object3D>(keep);
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  let before = 0;

  const visit = (o: THREE.Object3D) => {
    if (skip.has(o) || KEEP_NAMES.has(o.name) || o.userData.keep) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) {
      before++;
      const mat = m.material;
      if (!Array.isArray(mat) && !mat.transparent && mat.visible && m.visible && m.frustumCulled && m.geometry.attributes.position && m.geometry.attributes.normal) {
        // Meshes whose ancestors are hidden would flicker into view once baked.
        let vis = true;
        for (let p: THREE.Object3D | null = m.parent; p && p !== root; p = p.parent) if (!p.visible) { vis = false; break; }
        if (vis) {
          const key = `${mat.uuid}|${m.geometry.attributes.uv ? 'u' : '-'}${m.geometry.attributes.uv1 ? '1' : '-'}`;
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = { material: mat, geos: [], meshes: [] }));
          const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
          for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'uv1'].includes(name)) g.deleteAttribute(name);
          g.applyMatrix4(m.matrixWorld);
          if (m.matrixWorld.determinant() < 0) flipWinding(g);
          b.geos.push(g);
          b.meshes.push(m);
        }
      }
    }
    for (const c of o.children.slice()) visit(c);
  };
  visit(root);

  let after = 0;
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) { b.geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    for (const m of b.meshes) { m.parent?.remove(m); m.geometry.dispose(); }
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.name = 'merged-static';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false; // one mesh spans the whole station; the GPU clips what is off screen
    root.add(mesh);
    after++;
  }
  // Empty groups left behind cost matrix updates for nothing.
  const prune = (o: THREE.Object3D): boolean => {
    for (const c of o.children.slice()) if (prune(c)) o.remove(c);
    return o !== root && o.type === 'Group' && o.children.length === 0 && !o.name && Object.keys(o.userData).length === 0;
  };
  prune(root);
  return { before, after: after + (before - [...buckets.values()].reduce((n, b) => n + b.meshes.length, 0)), groups: after };
}

/** A mirrored transform turns triangles inside out; swap two vertices of each to turn them back. */
function flipWinding(g: THREE.BufferGeometry) {
  for (const a of Object.values(g.attributes) as THREE.BufferAttribute[]) {
    const n = a.itemSize;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k, i2 = (t + 2) * n + k;
        const v = a.array[i1]; (a.array as Float32Array)[i1] = a.array[i2]; (a.array as Float32Array)[i2] = v;
      }
    }
    a.needsUpdate = true;
  }
}
