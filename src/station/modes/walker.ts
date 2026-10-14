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
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { bearing, buildGlove, suitMaterials } from '../world/suit';
import { scaleUV } from '../world/pbr';
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
  /** How far the astronaut has stridden. */
  stride: number;
  /** Gait phase in radians: one full cycle (two steps) per 2π. Legs, hands and head-bob all read it. */
  phase: number;
  /** Floating: the suit thrusters' current acceleration (world, m/s²), for the jets and the limbs' inertia. */
  thrust: THREE.Vector3;
  /** Floating: a brief knock from hitting a wall (world, m/s²): the limbs feel it, the thrusters do not fire. */
  jolt: THREE.Vector3;
  /** Floating: 1 at the moment of a push-off, fading: the legs extend through it. */
  push: number;
  /** Floating while holding a rail: the point the hand is on. */
  gripPoint: THREE.Vector3 | null;
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

/** Walking speeds on the deck, m/s: a brisk walk and a run (Shift). */
export const WALK_SPEED = 2.6, WALK_RUN = 5.2;
const THRUST = 2.4;   // m/s² from the suit's micro-thrusters: brisk enough to cross a module in seconds
const MAX = 3.8;      // a sensible indoor top speed, m/s
const LOOK = 0.0022;

export function createWalker(spawn: THREE.Vector3): Walker {
  return {
    pos: spawn.clone(), vel: new THREE.Vector3(), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)),
    radius: 0.32, assist: true, grip: null, holding: null, reach: { left: 0, right: 0 }, contact: 0,
    moveMode: 'walk', view: 'first', yaw: -Math.PI / 2, pitch: 0, stride: 0, phase: 0, thrust: new THREE.Vector3(), jolt: new THREE.Vector3(), push: 0, gripPoint: null,
  };
}

const tmp = new THREE.Vector3(), tq = new THREE.Quaternion(), ax = new THREE.Vector3();
const knee = new THREE.Vector3(), kneeWas = new THREE.Vector3();

function nearestOnRail(rail: Rail, p: THREE.Vector3) {
  const ab = tmp.subVectors(rail.b, rail.a);
  const t = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(p, rail.a).dot(ab) / ab.lengthSq(), 0, 1);
  return { t, point: rail.a.clone().lerp(rail.b, t) };
}

/** Switch between walking and floating, carrying heading over so the view doesn't jump. */
export function setMoveMode(w: Walker, mode: MoveMode) {
  if (w.moveMode === mode) return;
  w.moveMode = mode;
  w.grip = null; w.gripPoint = null;
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
  // A brisk walk and a real run; sidesteps and backing up are slower, as on foot.
  want.set(0, 0, 0).addScaledVector(fwdFlat, mz * (mz < 0 ? 0.7 : 1)).addScaledVector(rightFlat, mx * 0.85);
  if (want.lengthSq() > 1) want.normalize();
  want.multiplyScalar(run ? WALK_RUN : WALK_SPEED);
  // Quick to start and stop, like feet on a deck: about a quarter-second to full pace, no drifting.
  const k = 1 - Math.exp(-(want.lengthSq() > 0 ? 10 : 16) * dt);
  w.vel.x += (want.x - w.vel.x) * k;
  w.vel.z += (want.z - w.vel.z) * k;
  w.vel.y = 0;
  // Move in short collision-checked steps, so a slow frame covers the full distance without passing a wall.
  const steps = Math.max(1, Math.ceil(dt / 0.035));
  for (let i = 0; i < steps; i++) {
    w.pos.x += w.vel.x * (dt / steps);
    w.pos.z += w.vel.z * (dt / steps);
    // Walls: keep the body inside the station, sliding along them.
    if (space) {
      const before = Math.hypot(w.vel.x, w.vel.z);
      space.resolve(w.pos, w.vel, w.radius, 0);
      w.vel.y = 0;
      w.contact = Math.hypot(w.vel.x, w.vel.z) < before * 0.8 ? 1 : w.contact * Math.exp(-6 * (dt / steps));
    }
  }
  // Feet follow the floor.
  const targetY = groundAt(w.pos.x, w.pos.z) + EYE_HEIGHT;
  w.pos.y += (targetY - w.pos.y) * (1 - Math.exp(-12 * dt));
  if (space) {
    space.resolve(w.pos, w.vel, w.radius, 0);
    // The body, not just the eye: a point at knee height must be in the air too, so legs never
    // pass through a wall under a window or a shut door.
    knee.copy(w.pos); knee.y -= EYE_HEIGHT - 0.4;
    kneeWas.copy(knee);
    if (space.resolve(knee, w.vel, w.radius, 0)) { w.pos.x += knee.x - kneeWas.x; w.pos.z += knee.z - kneeWas.z; }
    // Furniture is solid: slide around it, then make sure that didn't push a wall through you.
    if (space.resolveProps(w.pos, w.vel, w.radius, EYE_HEIGHT, 0.2)) { space.resolve(w.pos, w.vel, w.radius, 0); w.contact = 1; }
  }
  const sp = Math.hypot(w.vel.x, w.vel.z);
  w.stride += sp * dt;
  // Longer strides at speed, as people do: a 1.5 m cycle at an amble, about 1.9 m at a brisk walk, 2.8 m running.
  w.phase += (sp / (1.0 + 0.35 * sp)) * Math.PI * 2 * dt;
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
      w.grip = null; w.gripPoint = null;
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
    w.gripPoint = point.clone();
    w.thrust.multiplyScalar(Math.exp(-10 * dt));
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
      w.grip = null; w.gripPoint = null;
      w.gripPoint = null;
      w.push = 1;
      ev.pushOff?.(2.0);
    }
  } else {
    // Micro-thrusters: gentle, so walls and rails are the real way to move.
    const acc = fwd.clone().multiplyScalar(mz).addScaledVector(right, mx).addScaledVector(up, my);
    if (acc.lengthSq() > 1) acc.normalize();
    w.vel.addScaledVector(acc, THRUST * dt);
    w.thrust.lerp(acc.multiplyScalar(THRUST), 1 - Math.exp(-12 * dt));
    w.gripPoint = null;
    // Push off: a strong shove away from whatever wall is at hand.
    if (input.hit('ShiftLeft', 'ShiftRight') || input.padHit(PAD.A)) {
      const wall = space?.nearWall(w.pos, w.radius, w.radius + 0.35);
      if (wall) {
        const dir = wall.clone().multiplyScalar(0.55).addScaledVector(fwd, 0.85).normalize();
        w.vel.addScaledVector(dir, 2.2);
        w.reach.right = 1;
        w.push = 1;
        ev.pushOff?.(2.2);
      }
    }
    w.reach.left *= Math.exp(-4 * dt);
    w.reach.right *= Math.exp(-4 * dt);
  }

  w.push *= Math.exp(-2.2 * dt);
  w.jolt.multiplyScalar(Math.exp(-5 * dt));
  // Brake: grab the air (or, honestly, the thrusters fire against drift).
  // The suit's thrusters fire against the drift: the jets show it.
  if (input.down('KeyX') || input.padDown(PAD.B)) {
    if (w.vel.lengthSq() > 1e-4) w.thrust.lerp(tmp.copy(w.vel).normalize().multiplyScalar(-THRUST), 1 - Math.exp(-12 * dt));
    w.vel.multiplyScalar(Math.exp(-3.5 * dt));
  }
  if (w.assist && !w.grip && !mx && !my && !mz) w.vel.multiplyScalar(Math.exp(-0.9 * dt));
  if (w.vel.length() > MAX && !w.grip) w.vel.setLength(THREE.MathUtils.lerp(w.vel.length(), MAX, 1 - Math.exp(-2 * dt)));

  if (input.hit('KeyV') || input.padHit(PAD.BACK)) w.assist = !w.assist;

  // Drift in short collision-checked steps (a slow frame must not carry you through a door).
  const steps = Math.max(1, Math.ceil(dt / 0.035));
  let bumped = 0;
  for (let i = 0; i < steps; i++) {
    if (!w.grip) w.pos.addScaledVector(w.vel, dt / steps);
    if (!space) continue;
    const before = w.vel.length();
    if (space.resolveProps(w.pos, w.vel, w.radius, 0.5, 0.5)) w.contact = 1;
    const n = space.resolve(w.pos, w.vel, w.radius, 0.12);
    if (n) {
      bumped = Math.max(bumped, before - w.vel.length());
      w.contact = 1;
      // A wall knocks the limbs too: a brief jolt the other way, read by the animation.
      w.jolt.addScaledVector(n, Math.min(8, (before - w.vel.length()) * 8));
    } else w.contact *= Math.exp(-6 * (dt / steps));
  }
  if (bumped > 0.4) ev.bump?.(bumped);

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
/**
 * First-person arms: suited forearms rising from the bottom of the view into articulated EVA gloves, held low
 * and relaxed with the palms turned in. The same glove as the third-person astronaut.
 */
export function buildHands() {
  const m = suitMaterials();
  const g = new THREE.Group();
  const hand = (side: 1 | -1) => {
    const root = new THREE.Group();
    // Forearm: from the wrist back and down out of the frame, with a purple index stripe and the wrist bearing.
    const fore = new THREE.Group(); fore.rotation.x = 1.98; root.add(fore);
    const sleeve = new THREE.Mesh(scaleUV(new THREE.CapsuleGeometry(0.05, 0.24, 8, 20), 2, 2), m.fabric); sleeve.position.y = 0.17; fore.add(sleeve);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.014, 24), m.accent); stripe.position.y = 0.09; fore.add(stripe);
    const wb = bearing(0.05, 0.011); wb.position.y = 0.03; fore.add(wb);
    if (side < 0) { // the wrist checklist, on the left forearm as on a real suit
      const cl = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.09, 0.018, 2, 0.005), m.dark); cl.position.set(0.0, 0.14, -0.055); fore.add(cl);
      const page = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.076), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 })); page.rotation.y = Math.PI; page.position.set(0, 0.14, -0.0645); fore.add(page);
    }
    // The glove, flexed a little at the wrist so the fingers point forwards and slightly down.
    const glove = buildGlove(side);
    glove.group.rotation.x = 1.32;
    root.add(glove.group);
    root.rotation.z = side * 0.35;
    root.position.set(side * 0.16, -0.2, -0.4);
    root.userData.rest = root.position.clone();
    root.userData.glove = glove;
    return root;
  };
  const left = hand(-1), right = hand(1);
  g.add(left, right);
  return { group: g, left, right };
}

/** Hands move with you: a gentle sway at rest, a counter-swing with each step, a reach and open fingers when you take hold of something. */
const handLag = new THREE.Vector3(), invQ = new THREE.Quaternion();
/**
 * Hands move with you. Walking: a counter-swing with each step on the shared gait phase. Floating: they rise and
 * come forward into the neutral posture, drift slowly, and trail the suit's thrust. Reaching for a rail or an
 * object extends the arm and opens the fingers, which close once you hold on.
 */
export function animateHands(h: ReturnType<typeof buildHands>, w: Walker, t: number) {
  const speed = Math.min(1.6, Math.hypot(w.vel.x, w.vel.z) / 1.6);
  const walking = w.moveMode === 'walk';
  handLag.copy(w.thrust).applyQuaternion(invQ.copy(w.quat).invert()).multiplyScalar(walking ? 0 : -0.007);
  for (const [hand, k, side] of [[h.left, w.reach.left, -1], [h.right, w.reach.right, 1]] as const) {
    const rest = hand.userData.rest as THREE.Vector3;
    const swing = walking ? Math.sin(w.phase + (side > 0 ? 0 : Math.PI)) * 0.03 * Math.min(1, speed) : 0;
    const bob = walking ? Math.abs(Math.cos(w.phase)) * 0.012 * speed : 0;
    const drift = walking ? Math.sin(t * 1.3 + side) * 0.005 : Math.sin(t * 0.7 + side * 1.7) * 0.012;
    const rise = walking ? 0 : 0.07, out = walking ? 0 : 0.03;
    hand.position.set(
      rest.x * (1 - k * 0.3) + side * out + handLag.x,
      rest.y + k * 0.12 + drift - bob + rise + handLag.y,
      rest.z - k * 0.18 + swing - rise * 0.6 + handLag.z,
    );
    hand.rotation.x = -swing * 1.5 - k * 0.25 + (walking ? 0 : -0.22);
    const holding = !!w.gripPoint || !!w.holding;
    const curl = k > 0.3 ? (holding ? 0.9 : 0.12) : walking ? 0.45 + speed * 0.1 : 0.3;
    (hand.userData.glove as ReturnType<typeof buildGlove>).setCurl(curl, k > 0.3 && holding ? 0.8 : 0.35);
  }
}
