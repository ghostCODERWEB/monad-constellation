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

/** Hardware that a texture can't carry: RCS thrusters, the dorsal handrail, a docking probe, blade antennas. Units are the shuttle's local ones. */
function addShipHardware(g: THREE.Group) {
  const bronze = new THREE.MeshPhysicalMaterial({ color: 0x6b4a2a, metalness: 1, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.7, metalness: 0.4 });
  const gold = pbrSet('brushed-aluminium', { color: 0xe3b94a, normal: 0.6, roughness: 0.85 });
  const alu = pbrSet('brushed-aluminium', { color: 0xdfe3e8, normal: 0.6, roughness: 0.7 });
  const R = 0.19;
  // Reaction-control thrusters in clusters of four around the nose and mid-body.
  for (const [z, r] of [[-0.84, 0.12], [-0.55, 0.155], [0.28, 0.185]] as const) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.sin(a) * r, y = Math.cos(a) * r * 0.72;
      const nz = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 16, 1, true), bronze);
      nz.position.set(x, y, z);
      nz.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(a), Math.cos(a), 0).normalize());
      nz.material = Object.assign((bronze as THREE.MeshPhysicalMaterial).clone(), { side: THREE.DoubleSide });
      g.add(nz);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0095, 16), dark);
      hole.position.set(x * 1.12, y * 1.12, z); hole.lookAt(x * 3, y * 3, z); g.add(hole);
    }
  }
  // Dorsal handrail along the livery stripe.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.34, 12), gold);
  bar.rotation.x = Math.PI / 2; bar.position.set(0, R * 0.72 + 0.034, 0.15); g.add(bar);
  for (const z of [-0.01, 0.15, 0.31]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 8), alu);
    post.position.set(0, R * 0.72 + 0.016, z); g.add(post);
  }
  // Docking probe on the nose, and two blade antennas.
  const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.012, 0.16, 16), alu);
  probe.rotation.x = Math.PI / 2; probe.position.set(0, 0, -1.12); g.add(probe);
  const probeTip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), bronze);
  probeTip.position.set(0, 0, -1.2); g.add(probeTip);
  for (const [z, up] of [[0.0, 1], [0.4, -1]] as const) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.05, 0.05), alu);
    blade.position.set(0.05, up * (R * 0.72 + 0.02), z); blade.rotation.z = up * 0.1; g.add(blade);
  }
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
  addShipHardware(ship.group);
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
  const hose = (from: THREE.Vector3, to: THREE.Vector3, color: number) => {
    const mid = from.clone().lerp(to, 0.5); mid.y -= 0.8;
    const m = pbrSet('rubber', { color, normal: 1.5 });
    bay.add(new THREE.Mesh(scaleUV(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, mid, to]), 48, 0.06, 12, false), 24, 1), m));
    for (const t of [0.0, 1.0]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.14, 24), steel);
      c.position.copy(t ? to : from); bay.add(c);
    }
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
  const eyeLocal = new THREE.Vector3(dock.x + 0.5, dock.y + 1.6, dock.z + 8);
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
