// Releasing GPU memory: three.js frees nothing until told to. One traversal
// frees every geometry, material and texture under a root once, including
// textures held in shader uniforms, and skips anything already freed (shared
// resources are common).
import * as THREE from 'three';

export function disposeTree(root: THREE.Object3D, freed = new Set<unknown>()) {
  const tex = (v: unknown) => {
    if (v && (v as THREE.Texture).isTexture && !freed.has(v)) { freed.add(v); (v as THREE.Texture).dispose(); }
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !freed.has(m.geometry)) { freed.add(m.geometry); m.geometry.dispose(); }
    for (const mat of (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[]) {
      if (freed.has(mat)) continue;
      freed.add(mat);
      for (const v of Object.values(mat)) tex(v);
      const uniforms = (mat as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) { tex(u?.value); if (Array.isArray(u?.value)) u.value.forEach(tex); }
      mat.dispose();
    }
  });
  const scene = root as THREE.Scene;
  if (scene.isScene) { tex(scene.environment); tex(scene.background); }
  return freed;
}
