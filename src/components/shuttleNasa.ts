// The real orbiter. NASA's public "Space Shuttle" model (NASA Headquarters, via
// github.com/nasa/NASA-3D-Resources, Draco-compressed GLB, public/models/shuttle-nasa.glb)
// holds the whole launch stack: orbiter, external tank and boosters. This keeps the
// orbiter only, bakes it into our ship's coordinate frame (nose along −Z, wheels at
// the belly) and splits it by surface so it can be shaded properly:
//   paint   white upper skin           tiles   black belly, nose cap and wing leading edges
//   glass   the six cockpit windows    metal   engine bells and nozzle hardware
// The source has no textures, so the look is built from geometry plus these materials.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** Source model is in metres (orbiter ≈ 28 units long here); the ship is ≈ 2.1 units long. */
export const NASA_SCALE = 0.075;
const ORIGIN = new THREE.Vector3(0.1, 0.1, -2.06); // model point that maps to the ship's (0, −0.16, −1.1)
const OFFSET = new THREE.Vector3(0, -0.16, -1.1);

/** Model-space point to ship space. */
export const toShip = (x: number, y: number, z: number, out = new THREE.Vector3()) =>
  out.set((x - ORIGIN.x) * NASA_SCALE + OFFSET.x, (y - ORIGIN.y) * NASA_SCALE + OFFSET.y, (z - ORIGIN.z) * NASA_SCALE + OFFSET.z);

export interface NasaParts { hull: THREE.BufferGeometry; glass: THREE.BufferGeometry; metal: THREE.BufferGeometry }

let cache: Promise<NasaParts> | null = null;

/** Loads and bakes the orbiter once; every shuttle shares the geometry. */
export function loadNasaOrbiter(): Promise<NasaParts> {
  if (!cache) {
    cache = new Promise<NasaParts>((resolve, reject) => {
      const draco = new DRACOLoader(); draco.setDecoderPath('/draco/');
      const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
      loader.load('/models/shuttle-nasa.glb', (gltf) => { try { resolve(bake(gltf.scene)); } catch (e) { reject(e); } draco.dispose(); }, undefined, reject);
    });
    cache.catch(() => { cache = null; }); // allow a retry next time
  }
  return cache;
}

type Bucket = { pos: number[]; nor: number[] };
const bucket = (): Bucket => ({ pos: [], nor: [] });

function bake(scene: THREE.Object3D): NasaParts {
  scene.updateMatrixWorld(true);
  const b = { hull: bucket(), glass: bucket(), metal: bucket() };
  const a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  const nm = new THREE.Matrix3();

  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.geometry;
    src.computeBoundingBox();
    const bb = src.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    if (bb.min.y < -0.7) return; // the tank and boosters hang below the orbiter's belly
    const matName = (m.material as THREE.Material).name;
    const isEngine = /^(group13_|polySurfac|group25)/.test(m.name);
    const g = src.index ? src.toNonIndexed() : src;
    const P = g.attributes.position, N = g.attributes.normal;
    nm.getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(P, i + 1).applyMatrix4(m.matrixWorld);
      d.fromBufferAttribute(P, i + 2).applyMatrix4(m.matrixWorld);
      let target: Bucket;
      if (matName === 'anisotropic1SG') target = b.glass;
      else if (isEngine) target = b.metal;
      else target = b.hull; // the paint and tile pattern is drawn per pixel by hullMaterial()
      const vs = [a, c, d];
      for (let k = 0; k < 3; k++) {
        target.pos.push((vs[k].x - ORIGIN.x) * NASA_SCALE + OFFSET.x, (vs[k].y - ORIGIN.y) * NASA_SCALE + OFFSET.y, (vs[k].z - ORIGIN.z) * NASA_SCALE + OFFSET.z);
        // Keep the model's smooth vertex normals, brought into world orientation.
        const vn = new THREE.Vector3().fromBufferAttribute(N, i + k).applyMatrix3(nm).normalize();
        target.nor.push(vn.x, vn.y, vn.z);
      }
    }
  });
  const geo = (k: Bucket) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(k.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(k.nor, 3));
    g.computeBoundingSphere();
    return g;
  };
  return { hull: geo(b.hull), glass: geo(b.glass), metal: geo(b.metal) };
}

/**
 * The orbiter's skin: white thermal paint above, black reinforced-carbon nose cap, black tiles on the
 * belly, lower fuselage and wing undersides and leading edges. The pattern is a per-pixel mask over the
 * object-space position and normal, so every seam is crisp at any distance and costs no extra mesh.
 */
function hullMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.04, clearcoat: 0.3, clearcoatRoughness: 0.35, side: THREE.DoubleSide });
  const y = (m: number) => (m - ORIGIN.y) * NASA_SCALE + OFFSET.y, z = (m: number) => (m + 2.06) * NASA_SCALE + OFFSET.z;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position; vON = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOP; varying vec3 vON;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 on = normalize(vON);
        float ax = abs(vOP.x);
        float fus = 1.0 - smoothstep(0.158, 0.172, ax);                       // inside the fuselage width
        float cap = 1.0 - smoothstep(${z(-0.62).toFixed(4)}, ${z(-0.5).toFixed(4)}, vOP.z); // nose cap
        float belly = fus * (1.0 - smoothstep(${y(0.78).toFixed(4)}, ${(y(0.78) + 0.006).toFixed(4)}, vOP.y)); // lower fuselage
        float under = (1.0 - fus) * (1.0 - smoothstep(-0.45, -0.25, on.y));  // wing undersides
        float edge = (1.0 - fus) * (1.0 - smoothstep(-0.45, -0.2, on.z)) * (1.0 - smoothstep(${z(21).toFixed(4)}, ${z(22).toFixed(4)}, vOP.z)); // wing leading edges
        float tile = clamp(max(max(cap, belly), max(under, edge)), 0.0, 1.0);
        float speck = fract(sin(dot(floor(vOP.xz * 140.0), vec2(12.9898, 78.233))) * 43758.5453);
        // Panel seams in the paint (every ~11 cm of model length and round the hull) and a tile grid in the black areas.
        vec3 an = abs(on);
        vec2 gp = an.y > an.x ? vOP.xz : vOP.zy;
        float seamZ = smoothstep(0.47, 0.5, abs(fract(vOP.z * 9.0) - 0.5));
        float seamR = smoothstep(0.47, 0.5, abs(fract((an.y > an.x ? vOP.x : vOP.y) * 11.0) - 0.5)) * 0.6;
        float grid = smoothstep(0.42, 0.5, max(abs(fract(gp.x * 150.0) - 0.5), abs(fract(gp.y * 150.0) - 0.5)));
        vec3 white = vec3(0.88, 0.88, 0.9) * (0.96 + 0.04 * speck) * (1.0 - 0.16 * max(seamZ, seamR));
        vec3 black = vec3(0.03, 0.031, 0.036) * (0.7 + 0.6 * speck) * (1.0 - 0.55 * grid);
        diffuseColor.rgb = mix(white, black, tile);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.85, tile);');
  };
  mat.customProgramCacheKey = () => 'nasa-hull-v2';
  return mat;
}

/** Surfaces for the real orbiter, built once and shared. */
export function nasaMaterials() {
  const mk = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
  return {
    hull: hullMaterial(),
    glass: mk({ color: 0x050b16, roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2, side: THREE.DoubleSide }),
    metal: mk({ color: 0x8a8d96, roughness: 0.38, metalness: 0.95, side: THREE.DoubleSide }),
  };
}
