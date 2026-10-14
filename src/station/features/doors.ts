// The sliding doors between rooms. A door opens when someone comes within reach
// of it and closes behind them; a locked door (H-1 while the bay is open to
// space) stays shut whoever asks. The doorway is only passable while the leaf
// is fully clear, so collision always matches what you see. Lamps: green when
// free, amber while moving, red when locked.
import * as THREE from 'three';
import type { Engine } from '../engine';
import type { Hatch } from '../world/station';

const REACH = 2.3;      // metres from the opening at which a door starts to open
const TRAVEL_S = 0.7;   // seconds for a full stroke

export interface Doors {
  get(id: string): Hatch | undefined;
  /** Lock a door shut (it closes first if open), or release it. */
  lock(id: string, locked: boolean): void;
}

export function installDoors(e: Engine) {
  const hatches = e.station.hatches;
  const tmp = new THREE.Vector3();
  const api: Doors = {
    get: (id) => hatches.find((h) => h.id === id),
    lock: (id, locked) => { const h = api.get(id); if (h) h.locked = locked; },
  };
  (e as unknown as { doors: Doors }).doors = api;

  e.tickers.push(() => {
    const dt = e.cineDt;
    const who = e.walker.pos;
    for (const h of hatches) {
      const near = Math.abs(who.x - h.center.x) < REACH && Math.abs(who.z - h.center.z) < 1.4 && Math.abs(who.y - (h.center.y + 1.55)) < 1.2;
      const want = !h.locked && near ? 1 : 0;
      const before = h.open;
      h.open = THREE.MathUtils.clamp(h.open + Math.sign(want - h.open) * (dt / TRAVEL_S), 0, 1);
      if (Math.abs(want - h.open) < 1e-3) h.open = want;
      const k = h.open * h.open * (3 - 2 * h.open);
      h.leaf.position.copy(h.shut).addScaledVector(tmp.copy(h.slide), k * h.travel);
      h.volume.closed = h.open < 0.98;
      const moving = h.open !== before;
      if (moving && (before === 0 || before === 1)) e.sfx?.(want ? 'door-open' : 'door-close');
      h.lamp.emissive.setHex(h.locked ? 0xff3b30 : moving ? 0xffb020 : 0x35ff9b);
    }
  });
  return () => { delete (e as unknown as { doors?: Doors }).doors; };
}
