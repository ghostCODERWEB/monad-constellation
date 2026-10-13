// One interaction system for every console, hatch, switch, telescope and
// seat. An interactable has a position, a reach and a prompt; the walker asks
// for the best one in front of it each frame and the HUD shows its prompt.
import * as THREE from 'three';

export interface Interactable {
  id: string;
  /** Prompt verb phrase: "use telescope" becomes "Press E to use telescope". */
  label: string | (() => string);
  position: THREE.Vector3;
  reach: number;
  /** Optional gate: hidden from prompts while false. */
  enabled?: () => boolean;
  use: () => void;
}

export class Interactions {
  items: Interactable[] = [];
  private dir = new THREE.Vector3();

  add(i: Interactable) { this.items.push(i); return i; }
  remove(id: string) { this.items = this.items.filter((i) => i.id !== id); }

  /** The interactable the player is looking at and can reach, if any. */
  focus(eye: THREE.Vector3, look: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null, bestScore = Infinity;
    for (const it of this.items) {
      if (it.enabled && !it.enabled()) continue;
      this.dir.subVectors(it.position, eye);
      const d = this.dir.length();
      if (d > it.reach) continue;
      const facing = d < 0.6 ? 1 : this.dir.divideScalar(d).dot(look);
      if (facing < 0.72) continue;
      const score = d * (2 - facing);
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  static text(i: Interactable) { return typeof i.label === 'function' ? i.label() : i.label; }
}
