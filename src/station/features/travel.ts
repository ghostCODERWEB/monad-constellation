// Room-to-room travel: keys 1 (hangar), 2 (research room), 3 (observation
// room), or the room buttons. The suit's autopilot flies a smooth line along
// the station's corridor (hangar · glass walkway · research · observation), so
// getting between rooms never depends on lining up a hatch by hand. Any move
// key or Esc cancels it and hands control straight back.
import * as THREE from 'three';
import type { Engine } from '../engine';
import { EYE_HEIGHT } from '../modes/walker';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The corridor, hangar to observation room: every vertex is clear of walls and hatches. */
const LINE = [V(-3.4, 0, 0), V(0.5, 0, 0), V(1.6, 0, 0), V(4.4, 0, 0), V(6.9, 0, 0.1), V(11.4, 0, 0), V(13.6, 0, 0)];
export type Room = 'hangar' | 'research' | 'observation';
const STOP: Record<Room, { i: number; look: THREE.Vector3 }> = {
  hangar: { i: 0, look: V(-8, -0.3, 0) },
  research: { i: 4, look: V(8.2, 0.1, -1.4) },
  observation: { i: 6, look: V(17.6, 0, 0) },
};

const seg = LINE.slice(1).map((p, i) => p.distanceTo(LINE[i]));
const cum = [0, ...seg.reduce<number[]>((a, d) => (a.push((a[a.length - 1] ?? 0) + d), a), [])].slice(0, LINE.length);

function at(s: number) {
  const L = cum[cum.length - 1];
  const c = THREE.MathUtils.clamp(s, 0, L);
  let i = 0;
  while (i < LINE.length - 2 && cum[i + 1] < c) i++;
  const t = (c - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
  return LINE[i].clone().lerp(LINE[i + 1], t);
}

/** Arc-length of the corridor point nearest to `p`. */
function project(p: THREE.Vector3) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < LINE.length - 1; i++) {
    const a = LINE[i], b = LINE[i + 1], ab = b.clone().sub(a);
    const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
    const d = a.clone().addScaledVector(ab, t).distanceTo(p);
    if (d < bestD) { bestD = d; best = cum[i] + t * ab.length(); }
  }
  return best;
}

export function installTravel(e: Engine) {
  let go: { from: number; to: number; s: number; room: Room; lift: THREE.Vector3 } | null = null;
  const fly = (room: Room) => {
    if (e.mode.id !== 'walk') e.setMode('walk');
    const w = e.walker;
    w.grip = null;
    const s0 = project(w.pos);
    go = { from: s0, to: cum[STOP[room].i], s: s0, room, lift: w.pos.clone().sub(at(s0)) };
    w.vel.set(0, 0, 0);
    e.say(`Autopilot → ${room === 'hangar' ? 'hangar' : room === 'research' ? 'research room' : 'observation room'} (any move key cancels)`, 2);
  };
  (e as unknown as { travel: (r: Room) => void }).travel = fly;
  const look = new THREE.Quaternion(), m = new THREE.Matrix4();
  e.tickers.push((dt) => {
    if (e.mode.id !== 'walk') { go = null; return; }
    for (const [key, room] of [['Digit1', 'hangar'], ['Digit2', 'research'], ['Digit3', 'observation']] as const) if (e.input.hit(key)) fly(room);
    if (!go) return;
    const w = e.walker;
    const moved = e.input.down('KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ControlRight', 'KeyX') || e.input.hit('Escape');
    if (moved) { go = null; return; }
    const dir = Math.sign(go.to - go.s) || 1;
    const remaining = Math.abs(go.to - go.s), done = Math.abs(go.s - go.from), span = Math.max(1e-3, Math.abs(go.to - go.from));
    // Ease in and out: 0.8 m/s at the ends up to 5 m/s mid-flight.
    const speed = 0.8 + 4.2 * Math.min(1, Math.min(remaining, done) / 2.5);
    go.s += dir * Math.min(remaining, speed * dt);
    go.lift.multiplyScalar(Math.exp(-3 * dt));
    w.pos.copy(at(go.s)).add(go.lift);
    if (w.moveMode === 'walk') w.pos.y = e.station.groundAt(w.pos.x, w.pos.z) + EYE_HEIGHT; // walking: stay on the floor
    w.vel.set(0, 0, 0);
    // Look along the flight, turning to the destination's view as it arrives.
    const ahead = at(go.s + dir * 1.5).sub(w.pos);
    const toLook = STOP[go.room].look.clone().sub(w.pos);
    const k = THREE.MathUtils.smoothstep(done / span, 0.65, 1);
    const f = ahead.lengthSq() > 1e-4 ? ahead.normalize().lerp(toLook.normalize(), k) : toLook.normalize();
    m.lookAt(V(0, 0, 0), f, V(0, 1, 0));
    look.setFromRotationMatrix(m);
    w.quat.slerp(look, 1 - Math.exp(-5 * dt));
    { const eu = new THREE.Euler().setFromQuaternion(w.quat, 'YXZ'); w.yaw = eu.y; w.pitch = eu.x; } // keep walking in step with the view
    if (remaining < 0.02) go = null;
  });
}
