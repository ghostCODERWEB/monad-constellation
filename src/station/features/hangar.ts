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
  let throttle = 0, ignited = false;
  (e as unknown as { hangar: { ignite(): void } }).hangar = { ignite: () => { ignited = true; e.sfx?.('ignite'); } };
  const { hangarLeft, hangarRight } = e.station.doors;
  const doorX = hangarRight.position.x;

  e.tickers.push((dt, t) => {
    for (const b of ship.blinkers) b.mesh.visible = Math.sin(t * 4 + b.phase) > 0.6;
    if (ignited) {
      throttle = Math.min(1, throttle + dt * 0.8);
      for (const p of ship.plumes) p.scale.z = 0.001 + throttle * (1.2 + Math.random() * 0.25);
      for (const m of ship.engineMats) m.color.setScalar(0.6 + throttle * 0.8);
      hangarLeft.position.x = -doorX - throttle * 5.5;
      hangarRight.position.x = doorX + throttle * 5.5;
    }
    ship.group.position.y = dock.y - 0.8 + Math.sin(t * 0.5) * 0.02;
  });

  // Framed from the gallery side with the ship on the left, clear of the planner panel.
  const eye = new THREE.Vector3(dock.x + 0.5, dock.y + 1.6, dock.z + 8);
  const aim = new THREE.Vector3(dock.x + 3.2, dock.y - 0.5, dock.z);
  const cleanup = addPanelMode(e, 'shuttle', 'Shuttle', () => ({ eye, target: aim }));
  hotkey(e, 'KeyB', 'shuttle');
  e.interactions.add({ id: 'shuttle', label: 'board the shuttle', position: ship.group.position.clone().add(new THREE.Vector3(0, 0.6, 2)), reach: 4, use: () => e.setMode('shuttle') });
  e.interactions.add({ id: 'hangar-console', label: 'plan a shuttle flight', position: e.station.anchors.hangarConsole.clone(), reach: 1.8, use: () => e.setMode('shuttle') });
  return cleanup;
}
