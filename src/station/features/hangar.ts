// The hangar shuttle, on show through the gallery windows in mission control.
// Boarding it (or pressing B anywhere) opens the flight planner: every Monad
// token world is a destination, and launching flies the shuttle there in the
// Monad Constellation (/galaxy?fly=<token address>).
import * as THREE from 'three';
import type { Engine } from '../engine';
import { buildShuttle } from '@/components/shuttle';
import { labelTexture } from '../world/textures';
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
  const dock = e.station.anchors.shuttleDock;
  const ship = buildShuttle();
  const box = new THREE.Box3().setFromObject(ship.group);
  const size = box.getSize(new THREE.Vector3());
  const k = LENGTH / Math.max(size.z, 0.001);
  ship.group.scale.setScalar(k);
  ship.group.position.copy(dock).add(new THREE.Vector3(0, -0.8, 0));
  // Parked broadside to the gallery, so its whole length fills the windows.
  ship.group.rotation.y = -Math.PI / 2;
  ship.light.intensity = 6; ship.light.distance = 6; ship.light.decay = 2;
  for (const p of ship.plumes) p.scale.z = 0.001;
  e.station.interior.add(ship.group);

  // Docking cradle under the hull and a destination board on the wall.
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 3.2), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.7, roughness: 0.4 }));
  cradle.position.set(dock.x, -3.85, dock.z);
  e.station.interior.add(cradle);
  for (const x of [-2, 2]) for (const z of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.1, 10), new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.5, roughness: 0.5 }));
    strut.position.set(dock.x + x, -2.75, dock.z + z);
    e.station.interior.add(strut);
  }
  const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1), new THREE.MeshBasicMaterial({ map: labelTexture(['SHUTTLE · MONAD CONSTELLATION RUN', 'BOARD AT THE HATCH OR PRESS B'], { bg: '#0b0618', fg: '#c4b5fd', w: 1024, h: 284, font: 46, border: '#836ef9' }) }));
  board.position.set(-5.9, 1.6, -15);
  board.rotation.y = Math.PI / 2;
  e.station.interior.add(board);

  // Launch: engines light, the hangar doors slide apart.
  // The sequence: engines spool up and the doors part, the ship lifts off the
  // cradle and swings its nose to the doors, then it accelerates out.
  let throttle = 0, ignited = false, launchT = 0, speed = 0;
  const base = new THREE.Vector3(), parkedYaw = ship.group.rotation.y;
  (e as unknown as { hangar: { ignite(): void } }).hangar = { ignite: () => { if (!ignited) { ignited = true; base.copy(ship.group.position); e.sfx?.('ignite'); } } };
  const { hangarLeft, hangarRight } = e.station.doors;
  const doorX = hangarRight.position.x;

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
    e.walker.pos.set(0, 0.4, -6.0);
    e.walker.quat.setFromEuler(new THREE.Euler(-0.08, 0, 0));
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
      const c = ship.group.position;
      const x = THREE.MathUtils.clamp(w.pos.x, c.x - half, c.x + half);
      const near = new THREE.Vector3(x, c.y + 0.3, c.z);
      const d = w.pos.distanceTo(near), min = r + w.radius;
      if (d > 0 && d < min) {
        const n = new THREE.Vector3().subVectors(w.pos, near).divideScalar(d);
        w.pos.addScaledVector(n, min - d);
        const into = -w.vel.dot(n);
        if (into > 0) w.vel.addScaledVector(n, into * 1.3);
      }
    }
    // Doors close once the ship is home.
    if (!ignited && Math.abs(hangarRight.position.x - doorX) > 0.01) {
      hangarRight.position.x = THREE.MathUtils.lerp(hangarRight.position.x, doorX, 1 - Math.exp(-1.2 * dt));
      hangarLeft.position.x = -hangarRight.position.x;
    }
    if (ignited) {
      throttle = Math.min(1, throttle + dt * 0.8);
      for (const p of ship.plumes) p.scale.z = 0.001 + throttle * (1.2 + Math.random() * 0.25);
      for (const m of ship.engineMats) m.color.setScalar(0.6 + throttle * 0.8);
      hangarLeft.position.x = -doorX - throttle * 5.5;
      hangarRight.position.x = doorX + throttle * 5.5;
      launchT += dt;
      const lift = Math.min(1, launchT / 0.9);
      const ease = lift * lift * (3 - 2 * lift);
      ship.group.rotation.y = parkedYaw * (1 - ease);
      ship.group.position.y = base.y + ease * 1.2;
      if (launchT > 0.9) {
        speed += 14 * dt;
        ship.group.position.z -= speed * dt;
      }
      return;
    }
    ship.group.position.y = dock.y - 0.8 + Math.sin(t * 0.5) * 0.02;
  });

  // Framed from the gallery side with the ship on the left, clear of the planner panel.
  const eye = new THREE.Vector3(dock.x + 0.5, dock.y + 1.6, dock.z + 8);
  const aim = new THREE.Vector3(dock.x + 3.2, dock.y - 0.5, dock.z);
  const cleanup = addPanelMode(e, 'shuttle', 'Shuttle', () => ({ eye, target: ignited ? ship.group.position : aim }));
  hotkey(e, 'KeyB', 'shuttle');
  e.interactions.add({ id: 'shuttle', label: 'board the shuttle', position: parked.clone().add(new THREE.Vector3(0, 0.6, 2)), reach: 4, enabled: () => arriving < 0 && !ignited, use: () => e.setMode('shuttle') });
  e.interactions.add({ id: 'hangar-console', label: 'plan a shuttle flight', position: e.station.anchors.hangarConsole.clone(), reach: 1.8, use: () => e.setMode('shuttle') });
  return cleanup;
}
