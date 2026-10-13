// A panel mode: the camera glides to look at something (the robot, the
// shuttle, the research PC) and a DOM panel takes the input. The 3D world
// hears nothing while it is open; Esc or the panel's close button returns to
// walking, and the camera hands back to the walker where it left off.
import * as THREE from 'three';
import type { Engine } from '../engine';

export function addPanelMode(e: Engine, id: string, title: string, view: () => { eye: THREE.Vector3; target: THREE.Vector3; fov?: number }) {
  const from = new THREE.Vector3(), fromQ = new THREE.Quaternion();
  const toQ = new THREE.Quaternion(), m = new THREE.Matrix4();
  let k = 0, fov0 = e.camera.fov;
  e.addMode({
    id, title, eExits: false,
    enter: () => {
      from.copy(e.camera.position); fromQ.copy(e.camera.quaternion); k = 0; fov0 = e.camera.fov;
      e.hands.group.visible = false;
      e.input.suspend(true);
    },
    exit: () => {
      e.input.suspend(false);
      e.hands.group.visible = true;
      if (e.camera.fov !== fov0) { e.camera.fov = fov0; e.camera.updateProjectionMatrix(); }
    },
    update: (dt) => {
      const { eye, target, fov } = view();
      k = Math.min(1, k + dt * 1.6);
      const s = k * k * (3 - 2 * k);
      m.lookAt(eye, target, new THREE.Vector3(0, 1, 0));
      toQ.setFromRotationMatrix(m);
      e.camera.position.lerpVectors(from, eye, s);
      e.camera.quaternion.slerpQuaternions(fromQ, toQ, s);
      if (fov !== undefined) { e.camera.fov = THREE.MathUtils.lerp(fov0, fov, s); e.camera.updateProjectionMatrix(); }
    },
  });
  // Esc reaches the DOM, not the suspended 3D input: close from here.
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && e.mode.id === id) { ev.preventDefault(); e.setMode('walk'); } };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** A walk-mode hotkey that opens a mode from anywhere aboard. */
export function hotkey(e: Engine, code: string, mode: string) {
  e.tickers.push(() => { if (e.mode.id === 'walk' && e.input.hit(code)) e.setMode(mode); });
}
