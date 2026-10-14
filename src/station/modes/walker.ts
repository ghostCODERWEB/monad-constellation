// Zero-g movement: six degrees of freedom, real inertia, push-offs,
// hand-over-hand on rails, grabbing and throwing. The suit's micro-thrusters
// give a little translation so it is playable without a wall nearby; a
// stabiliser assist (V) damps drift and levels the horizon for comfort.
//
// Keys: WASD move, Space / Ctrl up and down, Q/R roll, mouse look,
// Shift push off the nearest wall, G or right mouse grab rail or object,
// left click or T throw, X brake, V assist, E interact.
// Gamepad: left stick move, right stick look, LB/RB roll, LT/RT down/up,
// A push off, X grab, B brake, Y interact.
import * as THREE from 'three';
import type { Input } from '../core/input';
import { PAD } from '../core/input';
import type { Space } from '../core/space';
import type { Rail } from '../world/station';
import type { Bodies, Body } from '../core/bodies';

export interface Walker {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  radius: number;
  assist: boolean;
  grip: { rail: Rail; t: number } | null;
  holding: Body | null;
  /** Hand animation: 0 rest, 1 reaching. */
  reach: { left: number; right: number };
  contact: number;
  /** Walk: feet on the floor, move like on the ground. Float: zero-g drift in six degrees of freedom. */
  moveMode: MoveMode;
  /** First person (through the visor) or third person (chase camera on the astronaut). */
  view: ViewMode;
  /** Heading and tilt while walking (the quaternion is rebuilt from them). */
  yaw: number; pitch: number;
  /** How far the astronaut has stridden: drives the walking animation. */
  stride: number;
}

export type MoveMode = 'walk' | 'float';
export type ViewMode = 'first' | 'third';

/** Eye height above the floor when walking, in metres. */
export const EYE_HEIGHT = 1.55;

export interface WalkerEvents {
  pushOff?: (strength: number) => void;
  grab?: () => void;
  release?: () => void;
  bump?: (speed: number) => void;
}

const THRUST = 2.4;   // m/s² from the suit's micro-thrusters: brisk enough to cross a module in seconds
const MAX = 3.8;      // a sensible indoor top speed, m/s
const LOOK = 0.0022;

export function createWalker(spawn: THREE.Vector3): Walker {
  return {
    pos: spawn.clone(), vel: new THREE.Vector3(), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)),
    radius: 0.32, assist: true, grip: null, holding: null, reach: { left: 0, right: 0 }, contact: 0,
    moveMode: 'walk', view: 'first', yaw: -Math.PI / 2, pitch: 0, stride: 0,
  };
}

const tmp = new THREE.Vector3(), tq = new THREE.Quaternion(), ax = new THREE.Vector3();

function nearestOnRail(rail: Rail, p: THREE.Vector3) {
  const ab = tmp.subVectors(rail.b, rail.a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, rail.a).dot(ab) / ab.lengthSq(), 0, 1);
  return { t, point: rail.a.clone().lerp(rail.b, t) };
}

/** Switch between walking and floating, carrying heading over so the view doesn't jump. */
export function setMoveMode(w: Walker, mode: MoveMode) {
  if (w.moveMode === mode) return;
  w.moveMode = mode;
  w.grip = null;
  if (mode === 'walk') {
    const e = new THREE.Euler().setFromQuaternion(w.quat, 'YXZ');
    w.yaw = e.y; w.pitch = THREE.MathUtils.clamp(e.x, -1.3, 1.3);
    w.quat.setFromEuler(new THREE.Euler(w.pitch, w.yaw, 0, 'YXZ'));
  }
  w.vel.set(0, 0, 0);
}

const fwdFlat = new THREE.Vector3(), rightFlat = new THREE.Vector3(), want = new THREE.Vector3();

/**
 * Walking: feet on the floor (artificial gravity), so movement is the ordinary kind. Look turns the
 * heading and tilts the head, WASD walks relative to the heading, Shift runs, you stop when you let go.
 * The floor height comes from the station (`groundAt`), so the walkway ramps, steps and gangway work.
 */
function stepWalking(w: Walker, input: Input, dt: number, space: Space | null, groundAt: (x: number, z: number) => number) {
  w.yaw += -input.mouseDX * LOOK - input.axis(2) * 2.2 * dt;
  w.pitch = THREE.MathUtils.clamp(w.pitch - input.mouseDY * LOOK - input.axis(3) * 2.2 * dt, -1.35, 1.35);
  w.quat.setFromEuler(new THREE.Euler(w.pitch, w.yaw, 0, 'YXZ'));

  fwdFlat.set(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
  rightFlat.set(Math.cos(w.yaw), 0, -Math.sin(w.yaw));
  const mx = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) + input.axis(0);
  const mz = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0) - input.axis(1);
  const run = input.down('ShiftLeft', 'ShiftRight') || input.padDown(PAD.A);
  want.set(0, 0, 0).addScaledVector(fwdFlat, mz).addScaledVector(rightFlat, mx);
  if (want.lengthSq() > 1) want.normalize();
  want.multiplyScalar(run ? 4.4 : 2.4);
  // Quick to start and stop, like feet on a deck: no drifting.
  const k = 1 - Math.exp(-(want.lengthSq() > 0 ? 12 : 18) * dt);
  w.vel.x += (want.x - w.vel.x) * k;
  w.vel.z += (want.z - w.vel.z) * k;
  w.vel.y = 0;
  w.pos.x += w.vel.x * dt;
  w.pos.z += w.vel.z * dt;
  // Walls: keep the body inside the station, sliding along them.
  if (space) {
    const before = Math.hypot(w.vel.x, w.vel.z);
    space.resolve(w.pos, w.vel, w.radius, 0);
    w.vel.y = 0;
    w.contact = Math.hypot(w.vel.x, w.vel.z) < before * 0.8 ? 1 : w.contact * Math.exp(-6 * dt);
  }
  // Feet follow the floor.
  const targetY = groundAt(w.pos.x, w.pos.z) + EYE_HEIGHT;
  w.pos.y += (targetY - w.pos.y) * (1 - Math.exp(-12 * dt));
  if (space) {
    space.resolve(w.pos, w.vel, w.radius, 0);
    // Furniture is solid: slide around it, then make sure that didn't push a wall through you.
    if (space.resolveProps(w.pos, w.vel, w.radius, EYE_HEIGHT, 0.2)) { space.resolve(w.pos, w.vel, w.radius, 0); w.contact = 1; }
  }
  w.stride += Math.hypot(w.vel.x, w.vel.z) * dt;
  w.reach.left *= Math.exp(-4 * dt); w.reach.right *= Math.exp(-4 * dt);
}

export function stepWalker(w: Walker, input: Input, dt: number, space: Space | null, rails: Rail[], bodies: Bodies | null, ev: WalkerEvents = {}, groundAt?: (x: number, z: number) => number) {
  if (w.moveMode === 'walk' && groundAt) {
    stepWalking(w, input, dt, space, groundAt);
    // Objects can still be picked up and thrown while walking.
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(w.quat);
    if (input.hit('KeyG') || input.padHit(PAD.X) || input.clicked(2)) {
      if (w.holding) { w.holding.held = false; w.holding.vel.copy(w.vel).addScaledVector(fwd, 0.25); w.holding = null; ev.release?.(); }
      else { const b = bodies?.aimed(w.pos, fwd); if (b && b.onGrab?.(b) !== false) { b.held = true; b.anchored = false; w.holding = b; ev.grab?.(); } }
    }
    if (w.holding) {
      w.holding.pos.lerp(w.pos.clone().addScaledVector(fwd, 0.55).addScaledVector(up, -0.12), 1 - Math.exp(-14 * dt));
      w.holding.vel.copy(w.vel);
      w.reach.right = Math.max(w.reach.right, 0.85);
      if (input.clicked(0) || input.hit('KeyT') || input.padHit(PAD.RB)) {
        w.holding.held = false; w.holding.vel.copy(w.vel).addScaledVector(fwd, 2.4);
        w.holding.spin.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
        w.holding = null; ev.release?.();
      }
    }
    return;
  }
  // --- look: rotate about the camera's own axes (true 6DOF).
  const yaw = -input.mouseDX * LOOK - input.axis(2) * 2.2 * dt;
  const pitch = -input.mouseDY * LOOK - input.axis(3) * 2.2 * dt;
  w.quat.multiply(tq.setFromAxisAngle(ax.set(0, 1, 0), yaw));
  w.quat.multiply(tq.setFromAxisAngle(ax.set(1, 0, 0), pitch));
  // Roll on Q and R (E is reserved for interaction).
  const rollIn = (input.down('KeyQ') || input.padDown(PAD.LB) ? 1 : 0) - (input.down('KeyR') || input.padDown(PAD.RB) ? 1 : 0);
  if (rollIn) w.quat.multiply(tq.setFromAxisAngle(ax.set(0, 0, 1), rollIn * 1.4 * dt));
  w.quat.normalize();

  // Assist: gently bring "up" back toward the station's up, so the horizon
  // never stays tilted. Off, rotation is entirely the player's.
  if (w.assist && !rollIn) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quat);
    if (Math.abs(fwd.y) < 0.97) {
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, new THREE.Vector3(0, 1, 0));
      const level = new THREE.Quaternion().setFromRotationMatrix(m);
      w.quat.slerp(level, 1 - Math.exp(-1.6 * dt));
    }
  }

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quat);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(w.quat);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(w.quat);

  const mx = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) + input.axis(0);
  const mz = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0) - input.axis(1);
  const my = (input.down('Space') ? 1 : 0) - (input.down('ControlLeft', 'ControlRight', 'KeyC') ? 1 : 0) + (input.pad.buttons[PAD.RT] ? 1 : 0) - (input.pad.buttons[PAD.LT] ? 1 : 0);

  // --- grip: a rail in hand. Movement slides along it, hand over hand.
  const grabKey = input.hit('KeyG') || input.padHit(PAD.X) || input.clicked(2);
  if (grabKey) {
    if (w.grip || w.holding) {
      if (w.holding) { w.holding.held = false; w.holding.vel.copy(w.vel).addScaledVector(fwd, 0.25); w.holding = null; }
      w.grip = null;
      ev.release?.();
    } else {
      const b = bodies?.aimed(w.pos, fwd);
      if (b) {
        const refused = b.onGrab?.(b);
        if (refused !== false) { b.held = true; b.anchored = false; w.holding = b; ev.grab?.(); }
      } else {
        let best: Rail | null = null, bestD = 0.95, bestT = 0;
        for (const r of rails) {
          const { t, point } = nearestOnRail(r, w.pos);
          const d = point.distanceTo(w.pos);
          if (d < bestD) { bestD = d; best = r; bestT = t; }
        }
        if (best) { w.grip = { rail: best, t: bestT }; ev.grab?.(); }
      }
    }
  }

  if (w.grip) {
    const dir = new THREE.Vector3().subVectors(w.grip.rail.b, w.grip.rail.a);
    const len = dir.length();
    dir.divideScalar(len);
    // Whatever the player pushes toward, along the rail.
    const want = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx).addScaledVector(up, my);
    const along = want.dot(dir);
    const target = dir.clone().multiplyScalar(along * 1.7);
    w.vel.lerp(target, 1 - Math.exp(-8 * dt));
    w.grip.t = THREE.MathUtils.clamp(w.grip.t + (w.vel.dot(dir) * dt) / len, 0, 1);
    const point = w.grip.rail.a.clone().lerp(w.grip.rail.b, w.grip.t);
    // Hold at arm's length from the rail, toward the cabin.
    const off = new THREE.Vector3().subVectors(w.pos, point);
    off.addScaledVector(dir, -off.dot(dir));
    if (off.length() > 0.55) off.setLength(0.55);
    if (off.length() < 0.35) off.setLength(0.35);
    w.pos.lerp(point.clone().add(off), 1 - Math.exp(-10 * dt));
    // Hand over hand: alternate the hands with the distance travelled.
    const phase = (w.grip.t * len) / 0.45;
    w.reach.left = 0.5 + 0.5 * Math.sin(phase * Math.PI);
    w.reach.right = 0.5 - 0.5 * Math.sin(phase * Math.PI);
    if (input.hit('ShiftLeft', 'ShiftRight') || input.padHit(PAD.A)) {
      // Let go with a shove in the look direction.
      w.vel.addScaledVector(fwd, 2.0);
      w.grip = null;
      ev.pushOff?.(2.0);
    }
  } else {
    // Micro-thrusters: gentle, so walls and rails are the real way to move.
    const acc = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx).addScaledVector(up, my);
    if (acc.lengthSq() > 1) acc.normalize();
    w.vel.addScaledVector(acc, THRUST * dt);
    // Push off: a strong shove away from whatever wall is at hand.
    if (input.hit('ShiftLeft', 'ShiftRight') || input.padHit(PAD.A)) {
      const wall = space?.nearWall(w.pos, w.radius, w.radius + 0.35);
      if (wall) {
        const dir = wall.clone().multiplyScalar(0.55).addScaledVector(fwd, 0.85).normalize();
        w.vel.addScaledVector(dir, 2.2);
        w.reach.right = 1;
        ev.pushOff?.(2.2);
      }
    }
    w.reach.left *= Math.exp(-4 * dt);
    w.reach.right *= Math.exp(-4 * dt);
  }

  // Brake: grab the air (or, honestly, the thrusters fire against drift).
  if (input.down('KeyX') || input.padDown(PAD.B)) w.vel.multiplyScalar(Math.exp(-3.5 * dt));
  if (w.assist && !w.grip && !mx && !my && !mz) w.vel.multiplyScalar(Math.exp(-0.9 * dt));
  if (w.vel.length() > MAX && !w.grip) w.vel.setLength(THREE.MathUtils.lerp(w.vel.length(), MAX, 1 - Math.exp(-2 * dt)));

  if (input.hit('KeyV') || input.padHit(PAD.BACK)) w.assist = !w.assist;

  if (!w.grip) w.pos.addScaledVector(w.vel, dt);
  if (space) {
    const before = w.vel.length();
    if (space.resolveProps(w.pos, w.vel, w.radius, 0.5, 0.5)) w.contact = 1;
    const n = space.resolve(w.pos, w.vel, w.radius, 0.12);
    if (n) {
      const hit = before - w.vel.length();
      if (hit > 0.4) ev.bump?.(hit);
      w.contact = 1;
    } else w.contact *= Math.exp(-6 * dt);
  }

  // A held object rides in front of the hands; a click throws it.
  if (w.holding) {
    const hold = w.pos.clone().addScaledVector(fwd, 0.55).addScaledVector(up, -0.12);
    w.holding.pos.lerp(hold, 1 - Math.exp(-14 * dt));
    w.holding.vel.copy(w.vel);
    w.reach.right = Math.max(w.reach.right, 0.85);
    if (input.clicked(0) || input.hit('KeyT') || input.padHit(PAD.RB)) {
      w.holding.held = false;
      w.holding.vel.copy(w.vel).addScaledVector(fwd, 2.4);
      w.holding.spin.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
      w.holding = null;
      ev.release?.();
    }
  }
}

/** Gloves and sleeves: two suited hands in front of the camera. */
export function buildHands() {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.8 });
  const glove = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.65 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x836ef9, emissive: 0x3b2a8c, emissiveIntensity: 0.4, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, metalness: 0.8, roughness: 0.3 });
  const hand = (side: 1 | -1) => {
    const root = new THREE.Group();
    // Forearm reaching in from below the frame, glove at its end.
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.34, 14), suit);
    sleeve.rotation.x = Math.PI / 2 - 0.5;
    sleeve.position.set(0, -0.07, 0.12);
    root.add(sleeve);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.018, 14), accent);
    stripe.rotation.x = Math.PI / 2 - 0.5;
    stripe.position.set(0, -0.035, 0.05);
    root.add(stripe);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 14), metal);
    cuff.rotation.x = Math.PI / 2 - 0.5;
    cuff.position.set(0, -0.01, 0.0);
    root.add(cuff);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.085), glove);
    palm.position.set(0, 0.01, -0.06);
    palm.rotation.x = -0.3;
    root.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095, 0.04, 4, 6), glove);
      f.rotation.x = Math.PI / 2 - 0.7;
      f.position.set(-0.027 + i * 0.018, 0.02, -0.115);
      root.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.03, 4, 6), glove);
    thumb.rotation.z = side * 1.0;
    thumb.position.set(side * -0.045, 0.012, -0.06);
    root.add(thumb);
    root.position.set(side * 0.21, -0.26, -0.5);
    root.userData.rest = root.position.clone();
    return root;
  };
  const left = hand(-1), right = hand(1);
  g.add(left, right);
  return { group: g, left, right };
}

export function animateHands(h: ReturnType<typeof buildHands>, w: Walker, t: number) {
  const sway = Math.sin(t * 1.3) * 0.006;
  for (const [hand, k] of [[h.left, w.reach.left], [h.right, w.reach.right]] as const) {
    const rest = hand.userData.rest as THREE.Vector3;
    hand.position.set(rest.x * (1 - k * 0.3), rest.y + k * 0.12 + sway, rest.z - k * 0.18);
  }
}
