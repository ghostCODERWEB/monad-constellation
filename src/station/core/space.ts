// The station's interior as a union of convex volumes. A body is legal while
// its centre (shrunk by its radius) sits inside any volume; modules connect
// through small doorway volumes, so hatches are the only way between them.
// Simple, stable, and exact enough for drifting bodies at walking speeds.
import * as THREE from 'three';

export type Volume =
  | { kind: 'box'; name: string; min: THREE.Vector3; max: THREE.Vector3; zone: string }
  | { kind: 'cyl'; name: string; axis: 'x' | 'y' | 'z'; a: number; b: number; c1: number; c2: number; r: number; zone: string };

const other = (axis: 'x' | 'y' | 'z'): ['x' | 'y' | 'z', 'x' | 'y' | 'z'] => (axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['x', 'z'] : ['x', 'y']);

export function box(name: string, zone: string, min: [number, number, number], max: [number, number, number]): Volume {
  return { kind: 'box', name, zone, min: new THREE.Vector3(...min), max: new THREE.Vector3(...max) };
}
export function cyl(name: string, zone: string, axis: 'x' | 'y' | 'z', a: number, b: number, c1: number, c2: number, r: number): Volume {
  return { kind: 'cyl', name, zone, axis, a: Math.min(a, b), b: Math.max(a, b), c1, c2, r };
}

export function inside(v: Volume, p: THREE.Vector3, pad: number) {
  if (v.kind === 'box') {
    return p.x >= v.min.x + pad && p.x <= v.max.x - pad && p.y >= v.min.y + pad && p.y <= v.max.y - pad && p.z >= v.min.z + pad && p.z <= v.max.z - pad;
  }
  const [u, w] = other(v.axis);
  const t = p[v.axis];
  if (t < v.a + pad || t > v.b - pad) return false;
  return Math.hypot(p[u] - v.c1, p[w] - v.c2) <= v.r - pad;
}

/** Closest point inside `v` (shrunk by pad) to `p`. */
export function clampInto(v: Volume, p: THREE.Vector3, pad: number, out: THREE.Vector3) {
  out.copy(p);
  if (v.kind === 'box') {
    out.x = THREE.MathUtils.clamp(p.x, v.min.x + pad, v.max.x - pad);
    out.y = THREE.MathUtils.clamp(p.y, v.min.y + pad, v.max.y - pad);
    out.z = THREE.MathUtils.clamp(p.z, v.min.z + pad, v.max.z - pad);
    return out;
  }
  const [u, w] = other(v.axis);
  out[v.axis] = THREE.MathUtils.clamp(p[v.axis], v.a + pad, v.b - pad);
  const du = p[u] - v.c1, dw = p[w] - v.c2;
  const d = Math.hypot(du, dw), r = Math.max(0, v.r - pad);
  if (d > r && d > 0) { out[u] = v.c1 + (du / d) * r; out[w] = v.c2 + (dw / d) * r; }
  return out;
}

export class Space {
  volumes: Volume[] = [];
  private tmp = new THREE.Vector3();
  private best = new THREE.Vector3();

  add(...v: Volume[]) { this.volumes.push(...v); return this; }

  contains(p: THREE.Vector3, pad: number) { return this.volumes.some((v) => inside(v, p, pad)); }

  zoneOf(p: THREE.Vector3): string | null {
    for (const v of this.volumes) if (inside(v, p, 0)) return v.zone;
    return null;
  }

  /**
   * Keeps a body inside the station. If `pos` left every volume, it is pulled
   * back to the nearest legal point and its velocity loses the component
   * that carried it into the wall (with `bounce` of it reflected).
   * Returns the contact normal, or null when nothing was hit.
   */
  resolve(pos: THREE.Vector3, vel: THREE.Vector3, pad: number, bounce = 0.1): THREE.Vector3 | null {
    if (this.contains(pos, pad)) return null;
    let bestD = Infinity;
    for (const v of this.volumes) {
      clampInto(v, pos, pad, this.tmp);
      const d = this.tmp.distanceToSquared(pos);
      if (d < bestD) { bestD = d; this.best.copy(this.tmp); }
    }
    if (!Number.isFinite(bestD)) return null;
    const n = new THREE.Vector3().subVectors(this.best, pos);
    const len = n.length();
    pos.copy(this.best);
    if (len < 1e-6) return null;
    n.divideScalar(len);
    const into = vel.dot(n);
    if (into < 0) vel.addScaledVector(n, -into * (1 + bounce));
    return n;
  }

  /** Directions in which a wall is within `reach` of p: used for push-off. */
  nearWall(p: THREE.Vector3, pad: number, reach: number): THREE.Vector3 | null {
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const sum = new THREE.Vector3();
    for (const [x, y, z] of dirs) {
      this.tmp.set(p.x + x * reach, p.y + y * reach, p.z + z * reach);
      if (!this.contains(this.tmp, pad)) sum.add(this.best.set(-x, -y, -z));
    }
    return sum.lengthSq() > 0 ? sum.normalize() : null;
  }
}
