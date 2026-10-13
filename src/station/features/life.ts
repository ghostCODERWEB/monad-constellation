// The station is lived in: things float, drift and hide. Every Easter egg is
// optional, quiet, and logged the first time the player notices it.
import * as THREE from 'three';
import type { Engine } from '../engine';
import { labelTexture } from '../world/textures';
import * as P from '../world/props';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function installLife(e: Engine) {
  const scene = e.station.interior;
  const egg = (id: string, title: string, text: string) => () => {
    if (e.log.add(`egg-${id}`, 'egg', title, text)) e.say(`☺ ${title}`);
  };
  const place = (mesh: THREE.Object3D, pos: THREE.Vector3, rot?: THREE.Euler) => {
    mesh.position.copy(pos);
    if (rot) mesh.rotation.copy(rot);
    scene.add(mesh);
    return mesh;
  };
  const drift = (s = 0.03) => V((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  const tumble = (s = 0.3) => V((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);

  // --- everyday drift
  const floaters: [string, THREE.Object3D, THREE.Vector3, number][] = [
    ['pen', P.pen(), V(0.8, 0.5, 0.6), 0.08],
    ['pen', P.pen(0xb91c1c), V(-0.6, -0.4, -0.9), 0.08],
    ['notebook', P.notebook(), V(1.2, -0.6, -0.4), 0.13],
    ['wrench', P.wrench(), V(5.4, 0.6, 0.5), 0.1],
    ['cable', P.cable(), V(4.2, -0.8, 0.9), 0.12],
    ['pen', P.pen(0x111827), V(9.6, 0.2, 0.7), 0.08],
    ['notebook', P.notebook('TELESCOPE LOG'), V(13.4, 0.9, 1.2), 0.13],
    ['food packet', P.pouch(['TORTILLAS', 'shelf-stable'], '#fde68a'), V(-7.6, 0.6, 0.3), 0.1],
    ['food packet', P.pouch(['MAC & CHEESE', 'rehydrate 120 ml'], '#fecaca'), V(-8.8, -0.3, -0.5), 0.1],
    ['drink pouch', P.pouch(['ORANGE', 'DRINK'], '#fdba74', true), V(-9.4, 0.4, 0.6), 0.09],
    ['wrench', P.wrench(), V(-3, -2.8, -12), 0.1],
  ];
  for (const [name, mesh, pos, r] of floaters) {
    place(mesh, pos);
    e.bodies.add({ id: `${name}-${pos.x}`, name, mesh, pos, vel: drift(), spin: tumble(), radius: r, grabbable: true });
  }

  // A tablet drifting slowly when nobody holds it.
  const tab = P.tablet();
  place(tab, V(0.4, 0.1, 1.1));
  e.bodies.add({ id: 'tablet', name: 'tablet', mesh: tab, pos: V(0.4, 0.1, 1.1), vel: V(0.012, 0.004, -0.01), spin: V(0.03, 0.05, 0.02), radius: 0.16, grabbable: true,
    onNotice: () => e.log.add('tablet', 'discovery', 'Procedure tablet', 'Checklist 2.3.1. One item is never ticked: "Find the missing screwdriver".') });

  // --- coffee: one pouch drifting away from the workstation, one "Alpha Returns".
  const espresso = P.pouch(['ZERO-G', 'ESPRESSO', '☕'], '#c4b5fd', true);
  place(espresso, V(8.0, 0.25, -0.7));
  e.bodies.add({ id: 'espresso', name: 'Zero-G Espresso', mesh: espresso, pos: V(8.0, 0.25, -0.7), vel: V(0.05, 0.015, 0.03), spin: V(0.1, 0.2, 0.05), radius: 0.09, grabbable: true,
    onNotice: egg('espresso', 'Zero-G Espresso', 'Drifting away from the workstation, as coffee does up here.') });
  const alpha = P.pouch(['ALPHA', 'RETURNS', 'decaf'], '#fde047', true);
  place(alpha, V(-8.1, 0.9, -1.2));
  e.bodies.add({ id: 'alpha', name: 'Alpha Returns', mesh: alpha, pos: V(-8.1, 0.9, -1.2), radius: 0.09, grabbable: true, anchored: true,
    onNotice: egg('alpha', 'Alpha Returns', 'A coffee pouch labelled "Alpha Returns". The small print says decaf.') });

  // --- the corridor banana
  const ban = P.banana();
  place(ban, V(-5.8, 0.3, 0.2));
  e.bodies.add({ id: 'banana', name: 'banana', mesh: ban, pos: V(-5.8, 0.3, 0.2), vel: V(0.004, 0, 0), spin: V(0.05, 0.35, 0.1), radius: 0.12, grabbable: true,
    onNotice: egg('banana', 'The corridor banana', 'Rotating slowly in the habitation module. Nobody admits to owning it.') });

  // --- plush cats: one strapped to the habitation wall, one in the shuttle pilot seat (placed by the shuttle).
  const cat = P.spaceCat();
  place(cat, V(-4.2, 0.25, 1.38), new THREE.Euler(0, Math.PI, 0));
  e.bodies.add({ id: 'cat', name: 'plush space cat', mesh: cat, pos: V(-4.2, 0.25, 1.38), radius: 0.12, grabbable: false, anchored: true,
    onNotice: egg('cat', 'Plush space cat', 'Strapped to the wall in a tiny helmet. Mission rank: morale officer.') });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.005), new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 1 }));
  place(strap, V(-4.2, 0.24, 1.44));

  // --- water blob near the galley dispenser
  const blob = P.waterBlob(0.05);
  place(blob, V(-8.6, 0.0, 0.0));
  const water = e.bodies.add({ id: 'water', name: 'water blob', mesh: blob, pos: V(-8.6, 0, 0), vel: V(0.01, 0.006, -0.008), spin: V(0, 0.2, 0), radius: 0.06, grabbable: false,
    onNotice: egg('water', 'Drifting water', 'A blob of water from the dispenser, wobbling on its way somewhere. Surface tension is doing its best.') });
  e.tickers.push((dt, t) => { const k = 1 + Math.sin(t * 5) * 0.06; water.mesh.scale.set(k, 2 - k, 1 + Math.cos(t * 4) * 0.05); });

  // --- the snack that always escapes, and the one stuck behind a monitor
  const snack = P.pouch(['CRACKERS', '"for later"'], '#bbf7d0');
  place(snack, V(-9.3, -0.4, -0.9));
  let escapes = 0;
  e.bodies.add({ id: 'snack', name: 'snack packet', mesh: snack, pos: V(-9.3, -0.4, -0.9), vel: drift(0.02), spin: tumble(), radius: 0.09, grabbable: true,
    onGrab: (b) => {
      escapes++;
      // It escapes, every time, with feeling.
      const away = b.pos.clone().sub(e.walker.pos).normalize();
      b.vel.copy(away.multiplyScalar(0.9 + Math.random() * 0.4)).add(V(0, 0.2, 0));
      b.spin.set(3, 2, 4);
      e.sfx?.('boing');
      if (escapes === 1) egg('snack', 'The snack that escapes', 'It slipped out of your glove. Crackers: 1, astronaut: 0.')();
      else if (escapes === 5) e.say('The crackers are winning.');
      return false;
    } });
  const stuck = P.pouch(['PRETZELS', 'lost 3 weeks'], '#fef9c3');
  place(stuck, V(8.75, 0.55, -1.42), new THREE.Euler(0, 0, 0.4));
  e.bodies.add({ id: 'stuck-snack', name: 'pretzels', mesh: stuck, pos: V(8.75, 0.55, -1.42), radius: 0.07, grabbable: true, anchored: true,
    onNotice: egg('pretzels', 'Snack behind the monitor', 'Pretzels, wedged behind the research monitor. Label: "lost 3 weeks".') });

  // --- ducks: on the mission-control panel, and floating in the airlock
  const duck1 = P.duck();
  place(duck1, V(1.5, -0.35, -2.25));
  e.bodies.add({ id: 'duck', name: 'rubber duck', mesh: duck1, pos: V(1.5, -0.35, -2.25), radius: 0.05, grabbable: true, anchored: true,
    onNotice: egg('duck', 'Debugging duck', 'A rubber duck on the mission-control panel. Explain your problem to it; it has seen worse.') });
  const duck2 = P.duck();
  place(duck2, V(0.2, 0.3, 4.4));
  e.bodies.add({ id: 'duck2', name: 'rubber duck', mesh: duck2, pos: V(0.2, 0.3, 4.4), vel: drift(0.015), spin: V(0.1, 0.4, 0.2), radius: 0.05, grabbable: true,
    onNotice: egg('duck2', 'Airlock duck', 'A second rubber duck, floating in the airlock. It has no suit. It seems fine.') });

  // --- the sock in the ventilation, a toy UFO, a toy rocket
  const s = P.sock();
  place(s, V(-3.6, 1.36, -0.6), new THREE.Euler(0.3, 0.2, 1.4));
  e.bodies.add({ id: 'sock', name: 'sock', mesh: s, pos: V(-3.6, 1.36, -0.6), radius: 0.06, grabbable: true, anchored: true,
    onNotice: egg('sock', 'A sock in the vent', 'Caught on the air intake. The filter log lists it as "foreign object, red, single".') });
  const u = P.ufo();
  place(u, V(-10.7, -1.15, 1.1));
  e.bodies.add({ id: 'ufo', name: 'toy UFO', mesh: u, pos: V(-10.7, -1.15, 1.1), radius: 0.06, grabbable: true, anchored: true,
    onNotice: egg('ufo', 'Unidentified', 'A toy UFO behind the storage compartment. Officially unidentified.') });
  const rk = P.toyRocket();
  place(rk, V(7.55, 0.62, -1.38), new THREE.Euler(0, 0, -0.2));
  e.bodies.add({ id: 'rocket', name: 'toy rocket', mesh: rk, pos: V(7.55, 0.62, -1.38), radius: 0.05, grabbable: true, anchored: true,
    onNotice: egg('rocket', 'Velcro rocket', 'A toy rocket velcroed to the monitor bezel. Thrust: inspirational.') });

  // --- the missing screwdriver, which is in the hangar, and the checklist that never updates
  const sd = P.screwdriver();
  place(sd, V(4.5, -3.3, -19));
  e.bodies.add({ id: 'screwdriver', name: 'screwdriver', mesh: sd, pos: V(4.5, -3.3, -19), vel: drift(0.01), spin: tumble(0.2), radius: 0.07, grabbable: true,
    onGrab: () => {
      if (e.log.add('egg-screwdriver', 'egg', 'Found the missing screwdriver', 'It was in the hangar. The checklist still says "incomplete".')) e.say('Checklist updated: "Find the missing screwdriver". Status: incomplete.');
    } });

  // --- sticky notes
  const note = (lines: string[], pos: THREE.Vector3, rotY: number, id: string, title: string) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshStandardMaterial({ map: labelTexture(lines, { font: 19 }), roughness: 0.9 }));
    m.position.copy(pos);
    m.rotation.y = rotY;
    m.rotation.z = (Math.random() - 0.5) * 0.12;
    scene.add(m);
    e.bodies.add({ id: `note-${id}`, name: 'sticky note', mesh: m, pos, radius: 0.08, grabbable: false, anchored: true,
      onNotice: egg(id, title, lines.join(' ')) });
  };
  note(['Have you tried', 'turning the space', 'station off and', 'on again?'], V(-1.2, 0.9, -2.37), 0, 'note-reboot', 'IT support, orbital edition');
  note(['Past performance', 'does not guarantee', 'future moon', 'missions.'], V(8.95, 0.45, -1.43), 0, 'note-moon', 'Disclaimer, handwritten');
  note(['Nansen has no', 'labels for this', 'memecoin.', 'Neither do I.'], V(7.6, 0.2, -1.43), 0, 'note-labels', 'Research honesty');
  note(['TODO:', '☐ Find the missing', '   screwdriver', '(again)'], V(1.2, -1.2, 2.37), Math.PI, 'note-todo', 'The eternal checklist');
}
