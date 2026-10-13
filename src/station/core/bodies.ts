// Floating objects: pens, tools, food packets, tablets. Each is a sphere for
// collision with a slow tumble; it drifts until a wall, another body or a
// hand changes its mind. Nothing here pretends to be rigid-body physics.
import * as THREE from 'three';
import type { Space } from './space';

export interface Body {
  id: string;
  name: string;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  radius: number;
  grabbable: boolean;
  /** Easter eggs and jokes: called when someone tries to grab it. */
  onGrab?: (b: Body) => boolean | void;
  /** Called the first time it is seen up close. */
  onNotice?: () => void;
  noticed?: boolean;
  held?: boolean;
  /** Stays where it is until disturbed (stuck behind a monitor, strapped down). */
  anchored?: boolean;
}

export class Bodies {
  list: Body[] = [];
  constructor(private space: Space) {}

  add(b: Omit<Body, 'pos' | 'vel' | 'spin'> & { pos: THREE.Vector3; vel?: THREE.Vector3; spin?: THREE.Vector3 }) {
    const body: Body = { vel: new THREE.Vector3(), spin: new THREE.Vector3(), ...b } as Body;
    body.mesh.position.copy(body.pos);
    this.list.push(body);
    return body;
  }

  step(dt: number, player: { pos: THREE.Vector3; vel: THREE.Vector3; radius: number } | null) {
    for (const b of this.list) {
      if (b.held || b.anchored) { b.mesh.position.copy(b.pos); continue; }
      b.pos.addScaledVector(b.vel, dt);
      // Air in the cabin damps drift very slightly.
      b.vel.multiplyScalar(Math.exp(-0.02 * dt));
      const n = this.space.resolve(b.pos, b.vel, b.radius, 0.45);
      if (n) b.spin.multiplyScalar(0.8).add(new THREE.Vector3(n.z, n.x, n.y).multiplyScalar(b.vel.length() * 0.6));
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
    }
    // Body against body, and the player nudging bodies aside.
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (a.held || b.held) continue;
        const d = a.pos.distanceTo(b.pos), min = a.radius + b.radius;
        if (d > 0 && d < min) {
          const n = new THREE.Vector3().subVectors(b.pos, a.pos).divideScalar(d);
          const push = (min - d) / 2;
          if (!a.anchored) a.pos.addScaledVector(n, -push);
          if (!b.anchored) b.pos.addScaledVector(n, push);
          const rel = new THREE.Vector3().subVectors(b.vel, a.vel).dot(n);
          if (rel < 0) {
            if (!a.anchored) a.vel.addScaledVector(n, rel * 0.5);
            if (!b.anchored) b.vel.addScaledVector(n, -rel * 0.5);
          }
        }
      }
      if (player && !a.held) {
        const d = a.pos.distanceTo(player.pos), min = a.radius + player.radius;
        if (d > 0 && d < min) {
          const n = new THREE.Vector3().subVectors(a.pos, player.pos).divideScalar(d);
          a.anchored = false;
          a.pos.addScaledVector(n, min - d);
          const rel = player.vel.dot(n) - a.vel.dot(n);
          if (rel > 0) a.vel.addScaledVector(n, rel * 1.2);
        }
      }
    }
  }

  /** The grabbable body nearest the aim ray within reach. */
  aimed(eye: THREE.Vector3, look: THREE.Vector3, reach = 1.7): Body | null {
    let best: Body | null = null, bestD = Infinity;
    const to = new THREE.Vector3();
    for (const b of this.list) {
      if (!b.grabbable || b.held) continue;
      to.subVectors(b.pos, eye);
      const along = to.dot(look);
      if (along < 0 || along > reach) continue;
      const off = to.addScaledVector(look, -along).length();
      if (off > b.radius + 0.18) continue;
      if (along < bestD) { bestD = along; best = b; }
    }
    return best;
  }
}
