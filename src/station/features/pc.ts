// The research PC at the workstation in the research module: a Nansen
// terminal for Monad (token worlds, wallets, insider radar, reputation).
// Sit down with E at the desk, or press P from anywhere aboard. The camera
// leans in to the main monitor and the terminal is drawn on that monitor's
// screen (ResearchPC tracks the screen's corners), so it is used like a real
// computer: click and type on the screen.
import * as THREE from 'three';
import type { Engine } from '../engine';
import type { WorkstationScreens } from '../world/workstation';
import { addPanelMode, hotkey } from './panel';

export interface MainScreen { mesh: THREE.Mesh; w: number; h: number }

/** The four world-space corners of the main monitor's screen: TL, TR, BR, BL. */
export function mainScreenCorners(e: Engine): THREE.Vector3[] | null {
  const s = e.station.interior.getObjectByName('workstation')?.userData.mainScreen as MainScreen | undefined;
  if (!s) return null;
  s.mesh.updateWorldMatrix(true, false);
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => s.mesh.localToWorld(new THREE.Vector3((x * s.w) / 2, (y * s.h) / 2, 0)));
}

export function installPC(e: Engine) {
  const desk = e.station.anchors.workstation;
  const ws = e.station.interior.getObjectByName('workstation');
  const screens = ws?.userData.screens as WorkstationScreens | undefined;
  const main = ws?.userData.mainScreen as MainScreen | undefined;
  const eye = new THREE.Vector3(), target = new THREE.Vector3(), centre = new THREE.Vector3(), nrm = new THREE.Vector3();
  const cleanup = addPanelMode(e, 'pc', 'Research PC', () => {
    if (!main) { eye.copy(desk).add(new THREE.Vector3(0, 0.6, 1.3)); return { eye, target: desk }; }
    main.mesh.getWorldPosition(centre);
    nrm.set(0, 0, 1).transformDirection(main.mesh.matrixWorld);
    // Sit back far enough that the screen fills about 78% of the frame, bezel and keyboard still in view.
    const d = 0.85;
    eye.copy(centre).addScaledVector(nrm, d);
    target.copy(centre).add(new THREE.Vector3(0, -0.06, 0));
    const need = 0.78;
    const vFov = 2 * Math.atan((main.h / need / 2) / d);
    const hFov = 2 * Math.atan((main.w / need / 2) / d);
    const aspect = e.camera.aspect;
    const fromH = 2 * Math.atan(Math.tan(hFov / 2) / aspect);
    return { eye, target, fov: THREE.MathUtils.radToDeg(Math.max(vFov, fromH)) };
  });
  hotkey(e, 'KeyP', 'pc');
  // The monitors show the live research subject and session state.
  if (screens) e.tickers.push((_dt, t) => screens.update(t, e.subject, e.mode.id));
  e.interactions.add({ id: 'pc', label: 'use the research PC', position: desk.clone().add(new THREE.Vector3(0, 0.4, 0.3)), reach: 2.2, use: () => e.setMode('pc') });
  return cleanup;
}
