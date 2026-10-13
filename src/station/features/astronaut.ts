// The player's body: a Monad astronaut in a white suit with purple trim, a gold
// visor, a life-support backpack and the Monad × Nansen patch on the chest. It is
// seen in third person and walks, floats and turns with you. Also home of the
// two player controls:
//   M    movement: Walk (feet on the floor) or Float (zero gravity)
//   Tab  camera:   First person or Third person
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Engine } from '../engine';
import { patchTexture } from '../world/textures';
import { pbrSet, scaleUV } from '../world/pbr';

export function buildAstronaut() {
  const suit = pbrSet('fabric-weave', { color: 0xf1eff8, normal: 0.9, roughness: 0.95 });
  const dark = pbrSet('carbon-weave', { color: 0xa8aeb8, normal: 1, roughness: 0.9, clearcoat: 0.5 });
  const metal = pbrSet('brushed-aluminium', { color: 0xdde1e6, normal: 0.6, roughness: 0.8 });
  const purple = new THREE.MeshPhysicalMaterial({ color: 0x836ef9, roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const visorMat = new THREE.MeshPhysicalMaterial({ color: 0xd0a645, metalness: 1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.6 });
  const led = new THREE.MeshBasicMaterial({ color: 0x35ff9b });
  const G = <T extends THREE.BufferGeometry>(g: T, u = 1, v = 1) => scaleUV(g, u, v);

  const root = new THREE.Group();
  root.name = 'astronaut';
  const body = new THREE.Group(); // leans for the walk cycle
  root.add(body);

  // Helmet: a shell with a gold visor, a metal neck ring and a small lamp.
  const head = new THREE.Group(); body.add(head);
  const helmet = new THREE.Mesh(G(new THREE.SphereGeometry(0.2, 40, 28), 3, 2), suit); head.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.205, 40, 24, Math.PI * 0.88, Math.PI * 1.24, Math.PI * 0.22, Math.PI * 0.46), visorMat); // faces −z, the way the astronaut looks
  head.add(visor);
  const neck = new THREE.Mesh(G(new THREE.TorusGeometry(0.15, 0.03, 16, 40), 8, 1), metal); neck.rotation.x = Math.PI / 2; neck.position.y = -0.2; head.add(neck);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 16), metal); lamp.rotation.x = Math.PI / 2; lamp.position.set(0.17, 0.06, -0.07); head.add(lamp);
  const lampLens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), new THREE.MeshBasicMaterial({ color: 0xfff6dd })); lampLens.position.set(0.17, 0.06, -0.087); head.add(lampLens);
  const stripe = new THREE.Mesh(G(new THREE.TorusGeometry(0.2, 0.012, 10, 40), 8, 1), purple); stripe.rotation.x = Math.PI / 2; stripe.position.y = 0.09; stripe.scale.set(0.97, 0.97, 1); head.add(stripe);

  // Torso: hard upper torso, belt, purple chest panel with the mission patch, a backpack.
  const torso = new THREE.Mesh(G(new RoundedBoxGeometry(0.44, 0.54, 0.27, 6, 0.07), 3, 3), suit); torso.position.y = -0.5; body.add(torso);
  const chestPanel = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.14, 0.03, 3, 0.012), dark); chestPanel.position.set(0.1, -0.38, -0.14); body.add(chestPanel);
  for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.008, 10), led); l.position.set(0.04 + i * 0.05, -0.37, -0.157); body.add(l); }
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), new THREE.MeshStandardMaterial({ map: patchTexture(), transparent: true, roughness: 0.7 }));
  patch.position.set(-0.1, -0.4, -0.141); body.add(patch);
  const sash = new THREE.Mesh(G(new RoundedBoxGeometry(0.46, 0.05, 0.285, 3, 0.02), 3, 1), purple); sash.position.y = -0.72; body.add(sash);
  const pelvis = new THREE.Mesh(G(new RoundedBoxGeometry(0.4, 0.2, 0.25, 5, 0.06), 3, 1), suit); pelvis.position.y = -0.84; body.add(pelvis);
  const pack = new THREE.Mesh(G(new RoundedBoxGeometry(0.36, 0.52, 0.17, 5, 0.04), 3, 3), metal); pack.position.set(0, -0.46, 0.22); body.add(pack);
  const packCap = new THREE.Mesh(G(new RoundedBoxGeometry(0.34, 0.08, 0.18, 3, 0.02), 3, 1), purple); packCap.position.set(0, -0.2, 0.22); body.add(packCap);
  for (const x of [-0.09, 0.09]) { const tank = new THREE.Mesh(G(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 20), 2, 2), dark); tank.position.set(x, -0.5, 0.32); body.add(tank); }
  const packLed = new THREE.Mesh(new THREE.CircleGeometry(0.01, 10), led); packLed.position.set(0.12, -0.28, 0.307); packLed.rotation.y = Math.PI; body.add(packLed);

  // Limbs: pivoting upper and lower segments so the walk cycle and the float pose bend at hip, knee, shoulder and elbow.
  const limb = (len: number, r: number, mat: THREE.Material, bandMat?: THREE.Material) => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(G(new THREE.CapsuleGeometry(r, len - 2 * r, 8, 18), 2, 2), mat); m.position.y = -len / 2; g.add(m);
    if (bandMat) { const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.04, 20), bandMat); b.position.y = -len * 0.55; g.add(b); }
    return g;
  };
  const arms: { sh: THREE.Group; el: THREE.Group }[] = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.29, -0.33, 0); body.add(sh);
    const shoulder = new THREE.Mesh(G(new THREE.SphereGeometry(0.085, 20, 14), 2, 2), purple); sh.add(shoulder);
    sh.add(limb(0.3, 0.06, suit, purple));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    el.add(limb(0.27, 0.052, suit));
    const cuff = new THREE.Mesh(G(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 20), 4, 1), purple); cuff.position.y = -0.25; el.add(cuff);
    const glove = new THREE.Mesh(G(new THREE.SphereGeometry(0.062, 18, 14), 2, 2), suit); glove.scale.set(1, 1.25, 0.9); glove.position.y = -0.32; el.add(glove);
    arms.push({ sh, el });
  }
  const legs: { hip: THREE.Group; knee: THREE.Group }[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.115, -0.88, 0); body.add(hip);
    hip.add(limb(0.34, 0.085, suit, purple));
    const knee = new THREE.Group(); knee.position.y = -0.34; hip.add(knee);
    const pad = new THREE.Mesh(G(new THREE.SphereGeometry(0.075, 16, 12), 2, 2), dark); pad.position.set(0, 0, -0.03); knee.add(pad);
    knee.add(limb(0.32, 0.075, suit));
    const boot = new THREE.Mesh(G(new RoundedBoxGeometry(0.15, 0.1, 0.3, 4, 0.04), 2, 2), purple); boot.position.set(0, -0.28, -0.04); knee.add(boot);
    const sole = new THREE.Mesh(G(new THREE.BoxGeometry(0.155, 0.025, 0.31), 2, 2), dark); sole.position.set(0, -0.335, -0.04); knee.add(sole);
    legs.push({ hip, knee });
  }
  // The soles land 1.55 m below the eye, the height walking uses (see EYE_HEIGHT).

  /** Pose the figure: `speed` m/s on the ground, or floating. */
  const pose = (floating: boolean, speed: number, stride: number, t: number, pitch: number) => {
    const swing = Math.min(1, speed / 2.4);
    if (floating) {
      const sway = Math.sin(t * 0.9) * 0.08;
      legs[0].hip.rotation.x = -0.35 + sway; legs[1].hip.rotation.x = -0.15 - sway;
      legs[0].knee.rotation.x = 0.7; legs[1].knee.rotation.x = 0.45;
      arms[0].sh.rotation.set(-0.3 + sway, 0, -0.35); arms[1].sh.rotation.set(-0.5 - sway, 0, 0.35);
      arms[0].el.rotation.x = -0.5; arms[1].el.rotation.x = -0.6;
      body.rotation.x = 0.08; body.position.y = Math.sin(t * 1.1) * 0.02;
      head.rotation.x = 0;
    } else {
      const ph = stride * 2.4, a = Math.sin(ph) * 0.75 * swing, b = Math.sin(ph + Math.PI) * 0.75 * swing;
      legs[0].hip.rotation.x = a; legs[1].hip.rotation.x = b;
      legs[0].knee.rotation.x = Math.max(0, -Math.cos(ph)) * 0.9 * swing; legs[1].knee.rotation.x = Math.max(0, Math.cos(ph)) * 0.9 * swing;
      arms[0].sh.rotation.set(b * 0.7, 0, -0.1); arms[1].sh.rotation.set(a * 0.7, 0, 0.1);
      arms[0].el.rotation.x = -0.25 - swing * 0.3; arms[1].el.rotation.x = -0.25 - swing * 0.3;
      body.rotation.x = swing * 0.1; body.position.y = Math.abs(Math.sin(ph)) * 0.025 * swing + Math.sin(t * 1.6) * 0.004;
      head.rotation.x = pitch; // the head tilts to where you look; the body stays upright
    }
  };

  return { root, pose };
}

export function installAstronaut(e: Engine) {
  const { root, pose } = buildAstronaut();
  root.visible = false;
  e.scene.add(root);
  const up = new THREE.Vector3(0, 1, 0), yawQ = new THREE.Quaternion();

  e.tickers.push((_dt, t) => {
    const w = e.walker, active = e.mode.id === 'walk';
    if (active) {
      if (e.input.hit('KeyM')) e.setMoveMode(w.moveMode === 'walk' ? 'float' : 'walk');
      if (e.input.hit('Tab')) e.setView(w.view === 'first' ? 'third' : 'first');
    }
    // Only drawn when the camera isn't inside it.
    root.visible = active && w.view === 'third';
    if (!root.visible) return;
    root.position.copy(w.pos);
    if (w.moveMode === 'walk') {
      root.quaternion.copy(yawQ.setFromAxisAngle(up, w.yaw));
      pose(false, Math.hypot(w.vel.x, w.vel.z), w.stride, t, -w.pitch * 0.6);
    } else {
      root.quaternion.copy(w.quat);
      pose(true, w.vel.length(), w.stride, t, 0);
    }
  });
  // Tab would move focus out of the scene.
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Tab' && e.mode.id === 'walk' && !e.input.suspended) ev.preventDefault(); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
