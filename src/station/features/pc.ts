// The research PC at the workstation in the research module: a Nansen
// terminal for Monad (token worlds, wallets, insider radar, reputation).
// Sit down with E at the desk, or press P from anywhere aboard.
import * as THREE from 'three';
import type { Engine } from '../engine';
import type { WorkstationScreens } from '../world/workstation';
import { addPanelMode, hotkey } from './panel';

export function installPC(e: Engine) {
  const desk = e.station.anchors.workstation;
  const seat = e.station.anchors.workstationSeat;
  const eye = seat.clone().add(new THREE.Vector3(0, 0.25, 0.4));
  const cleanup = addPanelMode(e, 'pc', 'Research PC', () => ({ eye, target: desk.clone().add(new THREE.Vector3(0, 0.35, 0)) }));
  hotkey(e, 'KeyP', 'pc');
  // The monitors show the live research subject and session state.
  const screens = e.station.interior.getObjectByName('workstation')?.userData.screens as WorkstationScreens | undefined;
  if (screens) e.tickers.push((_dt, t) => screens.update(t, e.subject, e.mode.id));
  e.interactions.add({ id: 'pc', label: 'use the research PC', position: desk.clone().add(new THREE.Vector3(0, 0.4, 0.3)), reach: 2.2, use: () => e.setMode('pc') });
  return cleanup;
}
