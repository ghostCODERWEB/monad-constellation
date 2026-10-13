// The hangar shuttle, on show through the gallery windows in mission control.
// Boarding it (or pressing B anywhere) opens the flight planner: every Monad
// token world is a destination, and launching flies the shuttle there in the
// Monad Constellation (/galaxy?fly=<token address>).
import * as THREE from 'three';
import type { Engine } from '../engine';
import { buildShuttle } from '@/components/shuttle';
import { labelTexture } from '../world/textures';
import { pbrSet, recolouredPaint, scaleUV } from '../world/pbr';
import { shuttleMaterials } from '../world/shuttlePbr';
import { addPanelMode, hotkey } from './panel';

const LENGTH = 10.5;

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
  const dock = new THREE.Vector3(0, -0.6, -11.5);
  const ship = buildShuttle(shuttleMaterials());
  const box = new THREE.Box3().setFromObject(ship.group);
  const size = box.getSize(new THREE.Vector3());
  const k = LENGTH / Math.max(size.z, 0.001);
  ship.group.scale.setScalar(k);
  ship.group.position.copy(dock).add(new THREE.Vector3(0, -0.8, 0));
  // Parked broadside to the gallery, so its whole length fills the windows.
  ship.group.rotation.y = -Math.PI / 2;
  ship.light.intensity = 6; ship.light.distance = 6; ship.light.decay = 2;
  for (const p of ship.plumes) p.scale.z = 0.001;
  bay.add(ship.group);

  // Docking cradle under the hull and a destination board on the wall.
  const steel = pbrSet('brushed-aluminium', { color: 0xaab0ba, normal: 0.8, roughness: 0.85 });
  const plate = pbrSet('diamond-plate', { color: 0x9aa0aa, normal: 0.9 });
  const yellow = pbrSet('painted-metal', { albedo: recolouredPaint(0xe9b60f), normal: 0.8, roughness: 0.9, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const rubber = pbrSet('rubber', { color: 0x1b1d21, normal: 1.4 });
  const cradle = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(6, 0.25, 3.2), 3, 2), plate);
  cradle.position.set(dock.x, -3.85, dock.z);
  bay.add(cradle);
  for (const x of [-2, 2]) for (const z of [-1, 1]) {
    const strut = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.06, 0.08, 2.1, 24), 2, 3), yellow);
    strut.position.set(dock.x + x, -2.75, dock.z + z);
    bay.add(strut);
    const pad = new THREE.Mesh(scaleUV(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 32), 2, 1), rubber); // rubber hull pad
    pad.position.set(dock.x + x, -1.66, dock.z + z);
    bay.add(pad);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.05, 32), steel);
    foot.position.set(dock.x + x, -3.68, dock.z + z);
    bay.add(foot);
  }
  // Fuel and power umbilicals: rubber hoses from a wall port to the hull, wheel chocks on the deck.
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
  hose(new THREE.Vector3(-5.72, -1.2, dock.z + 0.5), new THREE.Vector3(dock.x - 1.2, dock.y - 1.4, dock.z + 0.9), 0x1f2937);
  hose(new THREE.Vector3(-5.72, -2.0, dock.z - 0.5), new THREE.Vector3(dock.x + 1.8, dock.y - 1.3, dock.z - 0.9), 0x7c2d12);
  for (const x of [-2.4, 2.4]) {
    const chock = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(0.22, 0.2, 0.5), 1, 1), yellow);
    chock.position.set(dock.x + x, -3.65, dock.z + 2.0); bay.add(chock);
  }
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1), new THREE.MeshBasicMaterial({ map: labelTexture(['SHUTTLE · MONAD CONSTELLATION RUN', 'BOARD AT THE HATCH OR PRESS B'], { bg: '#0b0618', fg: '#c4b5fd', w: 1024, h: 284, font: 46, border: '#836ef9' }) }));
  board.position.set(-5.9, 1.6, -15);
  board.rotation.y = Math.PI / 2;
  bay.add(board);

  // ---------- launch ----------
  // Stages, in seconds from the command, each with a visible cause:
  //   0.0  checks        the bay beacon pulses; the umbilicals disconnect and reel back into the ground-support panel
  //   1.5  doors         the bay doors begin to open
  //   3.0  cradle        reaction-control pulses lift the hull off its pads
  //   5.0  turn          RCS pulses swing the nose from broadside round to the doors
  //   8.0  main engines  the three engines light
  //   8.3  launch        it accelerates down the bay, out through the doors, and away
  const STAGES: [number, string][] = [[0, 'Pre-launch checks'], [1.5, 'Bay doors opening'], [3, 'Cradle release'], [5, 'Turning to the doors'], [8, 'Main engines'], [8.6, 'Launch']];
  const DONE_AT = 16;
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
  // shuttle flies in through open doors, swings broadside and settles on its
  // cradle, the doors close, and you are at the hangar glass to watch.
  const { from, sym } = arrival();
  let arriving = -1;
  if (from && /^0x[0-9a-fA-F]{40}$/.test(from)) {
    const label = sym && /^[\w.-]{1,20}$/.test(sym) ? `$${sym}` : `${from.slice(0, 6)}…`;
    e.setSubject({ kind: 'token', address: from, label, source: 'flight' });
    e.log.add(`flight-back-${from}-${new Date().toISOString().slice(0, 13)}`, 'flight', `Back from ${label}`, `The shuttle docked after a run to ${label} in the Monad Constellation.`);
    e.say(`Welcome back from ${label}. Docking…`, 5);
    arriving = 0;
    hangarLeft.position.x = -doorX - 5.5; hangarRight.position.x = doorX + 5.5;
    e.walker.pos.copy(bay.localToWorld(new THREE.Vector3(0, 0.4, -6.0)));
    e.walker.quat.setFromEuler(new THREE.Euler(-0.08, Math.PI / 2, 0)); // looking into the bay (world −x)
    window.history.replaceState(null, '', '/');
  }
  const parked = ship.group.position.clone();
  const ARRIVE = 5;

  e.tickers.push((dt, t) => {
    for (const b of ship.blinkers) b.mesh.visible = Math.sin(t * 4 + b.phase) > 0.6;
    if (arriving >= 0 && !ignited) {
      arriving += dt;
      const k = Math.min(1, arriving / ARRIVE);
      // In along the hangar axis, decelerating; the last third swings and lowers.
      const approach = Math.min(1, k / 0.65), settle = Math.max(0, (k - 0.65) / 0.35);
      const a2 = 1 - Math.pow(1 - approach, 3), s2 = settle * settle * (3 - 2 * settle);
      ship.group.position.set(parked.x, parked.y + 1.2 * (1 - s2), THREE.MathUtils.lerp(-30, parked.z, a2));
      ship.group.rotation.y = THREE.MathUtils.lerp(Math.PI, parkedYaw, s2);
      const thr = 1 - a2 * 0.85;
      for (const p of ship.plumes) p.scale.z = 0.001 + thr * (0.9 + Math.random() * 0.2);
      if (k >= 1) {
        arriving = -1;
        for (const p of ship.plumes) p.scale.z = 0.001;
        e.say('Shuttle docked. Hangar doors closing.');
      }
      return;
    }
    // The parked hull is solid: a capsule along its length.
    if (e.mode.id === 'walk' && !ignited) {
      const w = e.walker;
      const half = LENGTH * 0.42, r = 1.1;
      const c = ship.group.getWorldPosition(new THREE.Vector3());
      // Parked broadside, the hull runs along the world z axis.
      const z = THREE.MathUtils.clamp(w.pos.z, c.z - half, c.z + half);
      const near = new THREE.Vector3(c.x, c.y + 0.3, z);
      const d = w.pos.distanceTo(near), min = r + w.radius;
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
      launchT += dt;
      const T = launchT;
      // 0–: checks. The beacon pulses; the umbilicals reel in.
      if (beacon) (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + 0.9 * Math.abs(Math.sin(T * 5));
      const reel = ease((T - 0.4) / 1.1);
      for (const h of hoses) { h.scale.setScalar(Math.max(0.001, 1 - reel)); h.visible = reel < 1; }
      // 1.5–5.5: the doors part.
      const door = ease((T - 1.5) / 4);
      hangarLeft.position.x = -doorX - door * 5.5; hangarRight.position.x = doorX + door * 5.5;
      // 3–5.2: lift off the pads on RCS pulses, with a slight settle.
      const lift = ease((T - 3) / 2.2);
      if (T > 3 && T < 5.2) pulseRcs(dt, lower);
      // 5–8: swing the nose to the doors: nose thrusters one way, tail thrusters the other; reversed to stop the spin.
      const turn = ease((T - 5) / 3);
      if (T > 5 && T < 8) pulseRcs(dt, T < 6.5 ? [...noseSide(1), ...tailSide(-1)] : [...noseSide(-1), ...tailSide(1)]);
      ship.group.rotation.y = parkedYaw * (1 - turn);
      // 8–: main engines light and the thrust builds.
      const burn = ease((T - 8) / 1.4);
      if (T > 8 && !igniteSfx) { igniteSfx = true; e.sfx?.('ignite'); }
      for (const p of ship.plumes) p.scale.z = 0.001 + burn * (1.2 + Math.random() * 0.25);
      for (const m of ship.engineMats) m.color.setScalar(0.6 + burn * 0.9);
      ship.light.intensity = 6 + burn * 10;
      if (T > 8.3) {
        const inBay = ship.group.position.z > -22;
        speed += (inBay ? 2.4 : 9) * dt;
        ship.group.position.z -= speed * dt;
      }
      ship.group.position.y = base.y + lift * 0.8 + (T > 8.3 ? Math.min(1, (T - 8.3) / 3) * 0.2 : 0);
      ship.setControl(T > 10 ? 0.12 : 0, 0, 0);
      if (T > DONE_AT && !finished) { finished = true; onDone?.(); }
      return;
    }
    ship.group.position.y = dock.y - 0.8 + Math.sin(t * 0.5) * 0.02;
  });

  // Framed from the gallery side with the ship on the left, clear of the planner panel.
  const eyeLocal = new THREE.Vector3(dock.x + 1.0, dock.y + 2.0, dock.z + 5.6); // just inside the hangar, near the doorway wall
  const aimLocal = new THREE.Vector3(dock.x + 3.2, dock.y - 0.5, dock.z);
  const eye = new THREE.Vector3(), aim = new THREE.Vector3();
  const cleanup = addPanelMode(e, 'shuttle', 'Shuttle', () => {
    bay.localToWorld(eye.copy(eyeLocal));
    if (ignited) ship.group.getWorldPosition(aim); else bay.localToWorld(aim.copy(aimLocal));
    return { eye, target: aim };
  });
  hotkey(e, 'KeyB', 'shuttle');
  e.interactions.add({ id: 'shuttle', label: 'board the shuttle', position: bay.localToWorld(parked.clone().add(new THREE.Vector3(0, 0.6, 2))), reach: 4, enabled: () => arriving < 0 && !ignited, use: () => e.setMode('shuttle') });
  e.interactions.add({ id: 'hangar-console', label: 'plan a shuttle flight', position: e.station.anchors.hangarConsole.clone(), reach: 1.8, use: () => e.setMode('shuttle') });
  return cleanup;
}
