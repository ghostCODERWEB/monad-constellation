// The hangar shuttle, on show through the gallery windows in mission control.
// Boarding it or using the wall console opens the flight planner: every Monad
// token world is a destination, and launching flies the shuttle there in the
// Monad Constellation (/galaxy?fly=<token address>).
import * as THREE from 'three';
import type { Engine } from '../engine';
import { buildShuttle } from '@/components/shuttle';
import { labelTexture } from '../world/textures';
import { pbrSet, recolouredPaint, scaleUV } from '../world/pbr';
import { shuttleMaterials } from '../world/shuttlePbr';
import { addPanelMode } from './panel';

const LENGTH = 8.8;
const DECK_Y = -4;

/** The ?from= return-flight parameters, read once per page load: React may mount the station twice in development. */
let arrivalOnce: { from: string | null; sym: string | null } | null = null;
function arrival() {
  if (!arrivalOnce) {
    const p = new URLSearchParams(window.location.search);
    arrivalOnce = { from: p.get('from'), sym: p.get('sym') };
  }
  return arrivalOnce;
}

export function installHangar(e: Engine) {
  // Everything here lives in the hangar bay's own frame (the bay is turned onto the corridor axis: bay (x, z) → world (z + 5.6, −x)).
  const bay = e.station.interior.getObjectByName('bay')!;
  bay.updateMatrixWorld(true);
  // Nose points towards the gangway (+bay Z) so the flight deck is what visitors see.
  // The stand sits to starboard of the centreline and leaves the ramp completely clear.
  const dock = new THREE.Vector3(2.35, 0, -16.4);
  const ship = buildShuttle(shuttleMaterials());
  ship.setGear(1);
  const box = new THREE.Box3().setFromObject(ship.group);
  const size = box.getSize(new THREE.Vector3());
  const k = LENGTH / Math.max(size.z, 0.001);
  ship.group.scale.setScalar(k);
  ship.group.position.copy(dock); ship.group.position.y = DECK_Y + ship.gearDrop * k;
  ship.group.rotation.y = Math.PI;
  ship.light.intensity = 6; ship.light.distance = 6; ship.light.decay = 2;
  for (const p of ship.plumes) p.scale.z = 0.001;
  bay.add(ship.group);

  // A marked stand on the deck replaces the old raised cradle. The ship carries
  // its own weight on three wheels; the bay only supplies chocks and low clamps.
  const steel = pbrSet('brushed-aluminium', { color: 0xaab0ba, normal: 0.8, roughness: 0.85 });
  const plate = pbrSet('diamond-plate', { color: 0x9aa0aa, normal: 0.9 });
  const yellow = pbrSet('painted-metal', { albedo: recolouredPaint(0xe9b60f), normal: 0.8, roughness: 0.9, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const rubber = pbrSet('rubber', { color: 0x1b1d21, normal: 1.4 });
  const stripe = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(w, 0.018, d), Math.max(1, w), Math.max(1, d)), yellow);
    m.position.set(x, DECK_Y + 0.018, z); bay.add(m); return m;
  };
  stripe(3.7, 0.10, dock.x, dock.z - 4.55); stripe(3.7, 0.10, dock.x, dock.z + 4.55);
  stripe(0.10, 9.2, dock.x - 1.85, dock.z); stripe(0.10, 9.2, dock.x + 1.85, dock.z);
  stripe(0.08, 8.7, dock.x, dock.z);
  const standLabel = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.7), new THREE.MeshBasicMaterial({ map: labelTexture(['STAND 01', 'NX-1001'], { bg: '#242934', fg: '#facc15', w: 1024, h: 320, font: 110 }), transparent: true }));
  standLabel.rotation.x = -Math.PI / 2; standLabel.position.set(dock.x, DECK_Y + 0.025, dock.z + 3.65); bay.add(standLabel);

  const mainWheelZ = dock.z - 0.28 * k;
  const mainWheelX = 0.43 * k;
  // Clamp status lamps: red while free, amber while capturing/releasing, green when secured.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x35ff9b, emissiveIntensity: 1.2, roughness: 0.4 });
  const setLamps = (c: number, i = 1.2) => { lampMat.emissive.setHex(c); lampMat.emissiveIntensity = i; };
  for (const x of [-1, 1]) {
    const clamp = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(0.38, 0.12, 0.52), 1, 1), steel);
    clamp.position.set(dock.x + x * mainWheelX, DECK_Y + 0.06, mainWheelZ); bay.add(clamp);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), lampMat);
    lamp.position.set(dock.x + x * mainWheelX, DECK_Y + 0.14, mainWheelZ + 0.24); bay.add(lamp);
  }
  // Fuel and power umbilicals from the nearby wall, plus chocks at the main tyres.
  const hoses: THREE.Group[] = [];
  const hose = (from: THREE.Vector3, to: THREE.Vector3, color: number) => {
    // Built about its wall end so it can reel back into the panel by scaling to nothing.
    const g = new THREE.Group(); g.position.copy(from);
    const a = new THREE.Vector3(), b = to.clone().sub(from), mid = b.clone().multiplyScalar(0.5); mid.y -= 0.8;
    const m = pbrSet('rubber', { color, normal: 1.5 });
    g.add(new THREE.Mesh(scaleUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 48, 0.06, 12, false), 24, 1), m));
    for (const p of [a, b]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 24), steel); c.position.copy(p); g.add(c); }
    bay.add(g); hoses.push(g);
  };
  hose(new THREE.Vector3(5.72, -1.3, dock.z + 0.8), new THREE.Vector3(dock.x + 0.30 * k, ship.group.position.y + 0.05 * k, dock.z + 0.15 * k), 0x1f2937);
  hose(new THREE.Vector3(5.72, -2.1, dock.z - 0.4), new THREE.Vector3(dock.x + 0.31 * k, ship.group.position.y - 0.08 * k, dock.z - 0.24 * k), 0x7c2d12);
  for (const x of [-1, 1]) for (const dz of [-0.34, 0.34]) {
    const chock = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(0.34, 0.20, 0.25), 1, 1), yellow);
    chock.rotation.x = dz > 0 ? 0.25 : -0.25;
    chock.position.set(dock.x + x * mainWheelX, DECK_Y + 0.10, mainWheelZ + dz); bay.add(chock);
  }
  // Compact electric tug and tow bar, parked clear of the stand.
  const tug = new THREE.Group(); tug.position.set(-3.55, DECK_Y + 0.34, -15.0); bay.add(tug);
  const tugBody = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(1.45, 0.48, 0.78), 2, 1), plate); tug.add(tugBody);
  const tugCab = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(0.62, 0.52, 0.68), 1, 1), yellow); tugCab.position.set(0.22, 0.45, 0); tug.add(tugCab);
  const wheels = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 18), rubber, 4);
  const wm = new THREE.Matrix4(); let wi = 0;
  for (const x of [-0.5, 0.5]) for (const z of [-0.43, 0.43]) { wm.makeRotationZ(Math.PI / 2).setPosition(x, -0.25, z); wheels.setMatrixAt(wi++, wm); }
  tug.add(wheels);
  const tow = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 14), steel); tow.rotation.x = Math.PI / 2; tow.position.set(-2.6, DECK_Y + 0.14, -14.5); bay.add(tow);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1), new THREE.MeshBasicMaterial({ map: labelTexture(['FLIGHT CONTROL · UNIVERSE / TOKEN', 'USE WALL CONSOLE · DEFAULT: MAJORS'], { bg: '#0b0618', fg: '#c4b5fd', w: 1024, h: 284, font: 42, border: '#836ef9' }) }));
  board.position.set(-5.9, 1.6, -16.2);
  board.rotation.y = Math.PI / 2;
  bay.add(board);

  // ---------- launch ----------
  // A pushback, not a runway launch: disconnect, open, lift, retract the gear,
  // back through the doors tail-first, turn outside, then light the mains.
  const STAGES: [number, string][] = [[0, 'Pre-launch checks'], [0.3, 'Umbilicals released'], [0.7, 'Bay doors opening'], [1.8, 'RCS liftoff'], [2.6, 'Tail-first pushback'], [4.7, 'Turning outside the bay'], [5.6, 'Main engines'], [6.5, 'Departing']];
  const DONE_AT = 7.2;
  let ignited = false, launchT = 0, speed = 0, onDone: (() => void) | null = null, finished = false, igniteSfx = false;
  const base = new THREE.Vector3(), parkedYaw = ship.group.rotation.y;
  const ease = (x: number) => { const c = THREE.MathUtils.clamp(x, 0, 1); return c * c * (3 - 2 * c); };
  (e as unknown as { hangar: { ignite(done?: () => void): void; stage(): { label: string; t: number } } }).hangar = {
    ignite: (done) => { if (!ignited) { ignited = true; onDone = done ?? null; base.copy(ship.group.position); } },
    stage: () => ({ label: ignited ? [...STAGES].reverse().find(([t0]) => launchT >= t0)![1] : 'Ready', t: launchT }),
  };
  const { hangarLeft, hangarRight } = e.station.doors;
  const doorX = hangarRight.position.x;
  const beacon = bay.getObjectByName('bay-beacon') as THREE.Mesh | undefined;

  // Reaction-control puffs: short-lived additive sprites shot out of the thrusters along their firing direction.
  const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.4, 'rgba(190,210,255,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const puffs = Array.from({ length: 60 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    sp.visible = false; bay.add(sp);
    return { sp, vel: new THREE.Vector3(), life: 0 };
  });
  let puffAt = 0;
  const firePuff = (i: number) => {
    const th = ship.rcs[i], p = puffs[puffAt++ % puffs.length];
    p.sp.position.copy(ship.group.localToWorld(th.pos.clone().multiplyScalar(1.12)).applyMatrix4(bay.matrixWorld.clone().invert()));
    p.vel.copy(th.dir).applyQuaternion(ship.group.quaternion).multiplyScalar(5);
    p.life = 0.45; p.sp.visible = true;
  };
  const stepPuffs = (dt: number) => {
    for (const p of puffs) {
      if (p.life <= 0) { p.sp.visible = false; continue; }
      p.life -= dt;
      p.sp.position.addScaledVector(p.vel, dt);
      const k = Math.max(0, p.life / 0.45);
      p.sp.scale.setScalar(0.18 + (1 - k) * 0.45);
      (p.sp.material as THREE.SpriteMaterial).opacity = k * 0.45;
    }
  };
  // Which thrusters fire: indices into ship.rcs (nose ring 0–3, mid 4–7, tail 8–11; ring order is NE, SE, SW, NW).
  const lower = [2, 3, 6, 7, 10, 11], noseSide = (sgn: number) => [0, 1, 2, 3].filter((i) => Math.sign(ship.rcs[i].dir.x) === sgn), tailSide = (sgn: number) => [8, 9, 10, 11].filter((i) => Math.sign(ship.rcs[i].dir.x) === sgn);
  let pulse = 0;
  const pulseRcs = (dt: number, set: number[]) => { pulse -= dt; if (pulse <= 0 && set.length) { pulse = 0.07; firePuff(set[Math.floor(Math.random() * set.length)]); } };

  // Coming home from the Constellation (/?from=<token>&sym=<symbol>): the
  // shuttle enters nose-first without yawing, extends its gear, translates to
  // the offset stand on RCS, lands, settles, clamps and connects.
  const { from, sym } = arrival();
  let arriving = -1;
  if (from && /^0x[0-9a-fA-F]{40}$/.test(from)) {
    const label = sym && /^[\w.-]{1,20}$/.test(sym) ? `$${sym}` : `${from.slice(0, 6)}…`;
    e.setSubject({ kind: 'token', address: from, label, source: 'flight' });
    e.log.add(`flight-back-${from}-${new Date().toISOString().slice(0, 13)}`, 'flight', `Back from ${label}`, `The shuttle docked after a run to ${label} in the Monad Constellation.`);
    e.say(`Welcome back from ${label}. Docking…`, 5);
    arriving = 0;
    hangarLeft.position.x = -doorX - 5.5; hangarRight.position.x = doorX + 5.5;
    const watch = bay.localToWorld(new THREE.Vector3(-4.4, DECK_Y + 1.55, -13.4));
    e.walker.pos.copy(watch);
    e.walker.quat.setFromEuler(new THREE.Euler(-0.05, Math.PI / 2, 0)); // on the deck, looking towards the doors
    e.walker.yaw = Math.PI / 2; e.walker.pitch = -0.08;
    window.history.replaceState(null, '', '/');
  }
  const parked = ship.group.position.clone();
  const FLY = 9, DOORS_AT = 10.8, DOORS_FOR = 3.0, END = 14.2;
  const arriveStages: [number, string][] = [[0, 'Approaching nose-first'], [3.5, 'Landing gear extending'], [5, 'RCS stand alignment'], [7, 'Touchdown'], [9.2, 'Clamps engaged, umbilicals connected'], [DOORS_AT, 'Bay doors closing'], [13.5, 'Bay pressurised']];
  let arrStage = -1;
  if (arriving >= 0) { ship.setGear(0); setLamps(0xff3030, 1.6); for (const h of hoses) { h.scale.setScalar(0.001); h.visible = false; } }

  e.tickers.push((dt, t) => {
    for (const b of ship.blinkers) b.mesh.visible = Math.sin(t * 4 + b.phase) > 0.6;
    if (arriving >= 0 && !ignited) {
      arriving += dt;
      const T = arriving;
      const stage = arriveStages.reduce((n, [t0], i) => (T >= t0 ? i : n), 0);
      if (stage !== arrStage) {
        arrStage = stage;
        e.say(arriveStages[stage][1] + (stage === arriveStages.length - 1 ? '. Welcome aboard.' : '…'), 3);
        if (stage === 2 || stage === 3) setLamps(0xffb020, 1.6);
        if (stage === 4) { setLamps(0x35ff9b, 1.4); e.sfx?.('grab'); }
      }
      const approach = ease(T / 7.4), align = ease((T - 4.7) / 2.5), touchdown = ease((T - 6.4) / 2.4);
      ship.group.position.set(THREE.MathUtils.lerp(0, parked.x, align), parked.y + 1.35 * (1 - touchdown), THREE.MathUtils.lerp(-30, parked.z, approach));
      // A restrained aerodynamic flare; yaw remains fixed for the entire arrival.
      ship.group.rotation.set(0.10 * (ease((T - 4.2) / 1.3) - touchdown), parkedYaw, 0);
      ship.setGear(ease((T - 3.5) / 2.2));
      const thr = Math.max(0, 1 - ease((T - 0.5) / 5.0));
      for (const p of ship.plumes) p.scale.z = 0.001 + thr * (0.9 + Math.random() * 0.2);
      if (T > 4.7 && T < 7.4) pulseRcs(dt, noseSide(1));
      if (T > 6.1 && T < 9) pulseRcs(dt, lower);
      stepPuffs(dt);
      // Umbilicals run out from the ground-support panel and connect.
      const reach = ease((T - 9.2) / 1.3);
      for (const h of hoses) { h.visible = reach > 0; h.scale.setScalar(Math.max(0.001, reach)); }
      // Then the doors close, on a smooth curve rather than a chase.
      const shut = ease((T - DOORS_AT) / DOORS_FOR);
      hangarLeft.position.x = -doorX - (1 - shut) * 5.5; hangarRight.position.x = doorX + (1 - shut) * 5.5;
      if (beacon) (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = T < 13 ? 0.4 + 0.9 * Math.abs(Math.sin(T * 5)) : 0.9;
      if (T >= END) {
        arriving = -1;
        for (const p of ship.plumes) p.scale.z = 0.001;
        hangarLeft.position.x = -doorX; hangarRight.position.x = doorX;
        for (const h of hoses) { h.visible = true; h.scale.setScalar(1); }
      }
      return;
    }
    // The parked hull is solid: a capsule derived from the actual model axis,
    // so it remains correct if the parking transform changes again.
    if (e.mode.id === 'walk' && !ignited) {
      const w = e.walker;
      const r = 0.72 + w.radius;
      const a = ship.group.localToWorld(new THREE.Vector3(0, 0.02, -0.72));
      const b = ship.group.localToWorld(new THREE.Vector3(0, 0.02, 0.66));
      const ab = new THREE.Vector3().subVectors(b, a);
      const q = THREE.MathUtils.clamp(new THREE.Vector3().subVectors(w.pos, a).dot(ab) / ab.lengthSq(), 0, 1);
      const near = a.clone().addScaledVector(ab, q);
      const d = w.pos.distanceTo(near), min = r;
      if (d > 0 && d < min) {
        const n = new THREE.Vector3().subVectors(w.pos, near).divideScalar(d);
        w.pos.addScaledVector(n, min - d);
        const into = -w.vel.dot(n);
        if (into > 0) w.vel.addScaledVector(n, into * 1.3);
      }
    }
    stepPuffs(dt);
    // Doors close once the ship is home.
    if (!ignited && Math.abs(hangarRight.position.x - doorX) > 0.01) {
      hangarRight.position.x = THREE.MathUtils.lerp(hangarRight.position.x, doorX, 1 - Math.exp(-1.2 * dt));
      hangarLeft.position.x = -hangarRight.position.x;
    }
    if (ignited) {
      // Keep the cinematic brisk even in the throttled preview pane.
      launchT += dt * 1.35;
      const T = launchT;
      // 0–: checks. The beacon pulses; the umbilicals reel in.
      if (beacon) (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + 0.9 * Math.abs(Math.sin(T * 5));
      if (T > 0.25) setLamps(0xffb020, 1.6 * (0.6 + 0.4 * Math.sin(T * 8)));
      const reel = ease((T - 0.25) / 0.55);
      for (const h of hoses) { h.scale.setScalar(Math.max(0.001, 1 - reel)); h.visible = reel < 1; }
      const door = ease((T - 0.65) / 1.25);
      hangarLeft.position.x = -doorX - door * 5.5; hangarRight.position.x = doorX + door * 5.5;
      // The ship rises vertically before any undercarriage retracts.
      const lift = ease((T - 1.7) / 0.8);
      if (T > 1.7 && T < 2.8) pulseRcs(dt, lower);
      ship.setGear(1 - ease((T - 2.25) / 0.65));
      // Tail-first pushback on RCS, holding the parking heading until clear.
      const push = ease((T - 2.45) / 2.15);
      ship.group.position.z = THREE.MathUtils.lerp(base.z, -26.2, push);
      const turn = ease((T - 4.55) / 0.95);
      ship.group.rotation.y = THREE.MathUtils.lerp(parkedYaw, Math.PI / 2, turn);
      if (T > 2.45 && T < 4.7) pulseRcs(dt, noseSide(-1));
      if (T > 4.55 && T < 5.65) pulseRcs(dt, T < 5.1 ? [...noseSide(1), ...tailSide(-1)] : [...noseSide(-1), ...tailSide(1)]);
      // Main engines light only after the ship has cleared the pressure doors.
      const burn = ease((T - 5.55) / 0.45);
      if (T > 5.55 && !igniteSfx) { igniteSfx = true; e.sfx?.('ignite'); }
      for (const p of ship.plumes) p.scale.z = 0.001 + burn * (1.2 + Math.random() * 0.25);
      for (const m of ship.engineMats) m.color.setScalar(0.6 + burn * 0.9);
      ship.light.intensity = 6 + burn * 10;
      if (T > 5.75) { speed += 13 * dt; ship.group.position.x -= speed * dt; ship.group.position.z -= speed * dt * 0.25; }
      ship.group.position.y = base.y + lift * 0.78 + (T > 5.7 ? Math.min(0.4, (T - 5.7) * 0.25) : 0);
      ship.setControl(T > 4.55 ? 0.10 : 0, 0, turn * 0.18);
      if (T > DONE_AT && !finished) { finished = true; onDone?.(); }
      return;
    }
    ship.group.position.copy(parked);
    ship.group.rotation.set(0, parkedYaw, 0);
    ship.setGear(1);
  });

  // Framed from the gangway side: nose, windows, landing gear and livery all read clearly.
  const eyeLocal = new THREE.Vector3(-2.4, -1.5, -12.6);
  const aimLocal = new THREE.Vector3(dock.x, ship.group.position.y + 0.25, dock.z + 0.4);
  const eye = new THREE.Vector3(), aim = new THREE.Vector3();
  const cleanup = addPanelMode(e, 'shuttle', 'Shuttle', () => {
    bay.localToWorld(eye.copy(eyeLocal));
    if (ignited) ship.group.getWorldPosition(aim); else bay.localToWorld(aim.copy(aimLocal));
    return { eye, target: aim };
  });
  e.interactions.add({ id: 'shuttle', label: 'board the shuttle', position: bay.localToWorld(new THREE.Vector3(dock.x - 1.35, DECK_Y + 1.0, dock.z + 2.8)), reach: 3.2, enabled: () => arriving < 0 && !ignited, use: () => e.setMode('shuttle') });
  e.interactions.add({ id: 'hangar-console', label: 'plan a shuttle flight', position: e.station.anchors.hangarConsole.clone(), reach: 1.8, use: () => e.setMode('shuttle') });
  return cleanup;
}
