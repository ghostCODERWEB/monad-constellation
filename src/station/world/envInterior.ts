// A lit-room image for PMREM: what a module interior looks like from the
// middle. Metals, clearcoats and glass reflect these soft panels and the blue
// glow of Earth through the windows, instead of a generic studio.
import * as THREE from 'three';

export function interiorEnvironment() {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(14, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xc4c2bd, side: THREE.BackSide }),
  );
  scene.add(room);
  const panel = (w: number, h: number, c: number, k: number, pos: [number, number, number], rot: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.set(...rot);
    scene.add(m);
  };
  // Ceiling light panels and long wall strips: the big soft highlights.
  for (const x of [-4, 0, 4]) panel(2.4, 1.2, 0xfff4e6, 9, [x, 2.95, 0], [Math.PI / 2, 0, 0]);
  for (const z of [-2.9, 2.9]) panel(9, 0.12, 0xffffff, 12, [0, 2.2, z], [0, 0, 0]);
  // Earth through a nadir window: a cool blue pool below.
  panel(4, 3, 0x5d8ad6, 0.8, [0, -2.95, 0], [Math.PI / 2, 0, 0]);
  // A sunlit window on one side, a darker rack wall on the other.
  panel(2.5, 2, 0xfff0d0, 6, [6.95, 0.4, 0], [0, -Math.PI / 2, 0]);
  panel(6, 2.4, 0x2a2c33, 1, [-6.95, 0, 0], [0, Math.PI / 2, 0]);
  // A hint of Nansen green from the robot's side.
  panel(1.2, 1.2, 0x00ffa7, 1.4, [-3, -1, 2.95], [0, Math.PI, 0]);
  return scene;
}
