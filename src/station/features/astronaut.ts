// The player's body: a Monad astronaut in an EVA-style suit (hard upper torso,
// soft limbs with bearings and accordion joints, articulated gloves, a pressure
// helmet with a gold sun visor, a life-support backpack, Monad and Nansen
// patches). Seen in third person, it walks with a distance-driven gait, floats,
// and turns with you. Also home of the
// two player controls:
//   M    movement: Walk (feet on the floor) or Float (zero gravity)
//   Tab  camera:   First person or Third person
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Engine } from '../engine';
import { patchTexture } from '../world/textures';
import { scaleUV } from '../world/pbr';
import { bearing, buildGlove, convolute, suitMaterials } from '../world/suit';
import { NANSEN_MARK_PATH, NANSEN_MARK_VIEWBOX } from '../world/nansenMark';

/** A small canvas texture: text or the Nansen mark on a patch. */
function patchCanvas(draw: (g: CanvasRenderingContext2D, n: number) => void, n = 256) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  draw(c.getContext('2d')!, n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildAstronaut() {
  const m = suitMaterials();
  const G = <T extends THREE.BufferGeometry>(g: T, u = 1, v = 1) => scaleUV(g, u, v);
  const led = new THREE.MeshBasicMaterial({ color: 0x35ff9b });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent?: THREE.Object3D) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); parent?.add(o); return o; };

  // Heights are relative to the eye (y = 0); the soles land 1.55 m below it, the height walking uses (EYE_HEIGHT).
  const SH_Y = -0.24, HIP_Y = -0.66, WAIST_Y = -0.6;
  const root = new THREE.Group();
  root.name = 'astronaut';
  const body = new THREE.Group(); root.add(body);              // bob and sway
  const chest = new THREE.Group(); chest.position.y = WAIST_Y; body.add(chest); // leans and twists about the waist
  const hips = new THREE.Group(); hips.position.y = WAIST_Y; body.add(hips);    // pelvis twist
  const up = (y: number) => y - WAIST_Y; // body height → chest/hips local

  // ---- helmet: hard shell, clear pressure bubble, gold sun visor half down, lights, camera, neck bearing ----
  const head = new THREE.Group(); head.position.y = up(0); chest.add(head);
  const shell = mesh(G(new THREE.SphereGeometry(0.185, 48, 32), 2, 2), m.hard, 0, 0.02, 0.01, head); shell.scale.set(1, 1.04, 1.06);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.19, 48, 28, Math.PI * 0.86, Math.PI * 1.28, Math.PI * 0.2, Math.PI * 0.52), m.glass); bubble.position.y = 0.015; head.add(bubble);
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.193, 48, 24, Math.PI * 0.9, Math.PI * 1.2, Math.PI * 0.24, Math.PI * 0.3), m.visor); sun.position.y = 0.02; head.add(sun);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.192, 0.01, 10, 48, Math.PI * 1.25), m.dark); frame.rotation.set(0, Math.PI / 2, Math.PI * 0.125 + Math.PI / 2); frame.position.y = 0.02; head.add(frame);
  for (const sx of [-1, 1]) {
    const lamp = mesh(new RoundedBoxGeometry(0.05, 0.035, 0.07, 3, 0.008), m.hard, sx * 0.175, 0.07, -0.02, head);
    mesh(new THREE.PlaneGeometry(0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff4dc }), 0, 0, -0.036, lamp);
  }
  const cam = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 16), m.dark, -0.13, 0.13, -0.08, head); cam.rotation.x = Math.PI / 2;
  const neck = bearing(0.15, 0.022); neck.position.y = -0.17; head.add(neck);

  // ---- hard upper torso, chest control module with a live display, hoses, name tag ----
  const hut = mesh(G(new RoundedBoxGeometry(0.46, 0.44, 0.3, 6, 0.09), 2, 2), m.hard, 0, up(-0.38), 0, chest);
  void hut;
  for (const sx of [-1, 1]) mesh(G(new THREE.SphereGeometry(0.1, 24, 16), 2, 2), m.hard, sx * 0.25, up(SH_Y + 0.02), 0, chest);
  const dcm = new THREE.Group(); dcm.position.set(0, up(-0.44), -0.17); chest.add(dcm);
  mesh(new RoundedBoxGeometry(0.24, 0.11, 0.08, 3, 0.015), m.dark, 0, 0, 0, dcm);
  const screen = patchCanvas((g, n) => { g.fillStyle = '#08130f'; g.fillRect(0, 0, n, n); g.fillStyle = '#5ff0b0'; g.font = '700 46px monospace'; g.fillText('O2 98%', 16, 80); g.fillText('P 4.3', 16, 150); g.fillText('T 21C', 16, 220); });
  mesh(new THREE.PlaneGeometry(0.07, 0.07), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }), -0.06, 0.005, -0.041, dcm);
  for (let i = 0; i < 4; i++) { const k = mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.015, 14), i === 3 ? m.accent : m.metal, 0.02 + i * 0.03, 0.02, -0.045, dcm); k.rotation.x = Math.PI / 2; }
  mesh(new THREE.CircleGeometry(0.006, 10), led, 0.1, -0.03, -0.0405, dcm);
  for (const sx of [-1, 1]) {
    const pts = [new THREE.Vector3(sx * 0.12, up(-0.45), -0.17), new THREE.Vector3(sx * 0.2, up(-0.5), -0.12), new THREE.Vector3(sx * 0.24, up(-0.48), 0.02), new THREE.Vector3(sx * 0.2, up(-0.42), 0.16)];
    chest.add(new THREE.Mesh(G(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.013, 8, false), 8, 1), sx > 0 ? m.accent : m.rubber));
  }
  const tag = patchCanvas((g, n) => { g.fillStyle = '#1b1d22'; g.fillRect(0, 0, n, n / 3); g.fillStyle = '#f3f1ea'; g.font = '800 52px "Helvetica Neue", Arial'; g.textAlign = 'center'; g.fillText('MONAD · 1', n / 2, 58); }, 256);
  const tagMesh = mesh(new THREE.PlaneGeometry(0.12, 0.04), new THREE.MeshStandardMaterial({ map: tag, roughness: 0.9 }), 0.12, up(-0.27), -0.152, chest);
  tag.repeat.set(1, 1 / 3); tag.offset.set(0, 2 / 3); void tagMesh;
  mesh(new THREE.CircleGeometry(0.05, 32), new THREE.MeshStandardMaterial({ map: patchTexture(), transparent: true, roughness: 0.75 }), -0.12, up(-0.29), -0.152, chest);

  // ---- life-support backpack: shell, top cap, vents, handles, antenna, tanks ----
  const pack = new THREE.Group(); pack.position.set(0, up(-0.42), 0.25); chest.add(pack);
  mesh(G(new RoundedBoxGeometry(0.42, 0.56, 0.2, 5, 0.04), 2, 2), m.hard, 0, 0, 0, pack);
  mesh(G(new RoundedBoxGeometry(0.4, 0.07, 0.21, 3, 0.02), 2, 1), m.accent, 0, 0.26, 0, pack);
  for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(0.22, 0.012, 0.01), m.dark, 0, -0.16 + i * 0.03, 0.103, pack);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.009, 8, 20, Math.PI), m.metal); h.rotation.y = Math.PI / 2; h.position.set(sx * 0.215, 0.05, 0); pack.add(h);
    const tank = mesh(G(new THREE.CylinderGeometry(0.045, 0.045, 0.4, 20), 2, 2), m.metal, sx * 0.13, 0.02, 0.11, pack); void tank;
  }
  mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.22, 6), m.dark, 0.16, 0.38, 0.05, pack);
  mesh(new THREE.CircleGeometry(0.008, 10), led, 0.15, 0.2, 0.101, pack);

  // ---- waist bearing and the lower torso ----
  const waist = bearing(0.2, 0.016); waist.position.y = 0; chest.add(waist);
  mesh(G(new RoundedBoxGeometry(0.4, 0.17, 0.27, 5, 0.06), 2, 1), m.fabric, 0, -0.07, 0, hips);

  // ---- arms: shoulder bearing, upper arm, elbow convolutes, forearm, wrist bearing, glove ----
  const nansenPatch = patchCanvas((g, n) => {
    g.fillStyle = '#122927'; g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#09c385'; g.lineWidth = 8; g.stroke();
    g.save(); g.translate(n / 2, n / 2); const k = (n * 0.7) / NANSEN_MARK_VIEWBOX; g.scale(k, k); g.translate(-NANSEN_MARK_VIEWBOX / 2, -NANSEN_MARK_VIEWBOX / 2);
    g.fillStyle = '#00ffa7'; g.fill(new Path2D(NANSEN_MARK_PATH)); g.restore();
  });
  const arms: { sh: THREE.Group; el: THREE.Group; glove: ReturnType<typeof buildGlove> }[] = [];
  for (const s of [-1, 1] as const) {
    const sh = new THREE.Group(); sh.position.set(s * 0.29, up(SH_Y), 0); chest.add(sh);
    const sb = bearing(0.075, 0.014); sb.rotation.z = Math.PI / 2; sh.add(sb);
    mesh(G(new THREE.CapsuleGeometry(0.068, 0.17, 8, 18), 2, 2), m.fabric, 0, -0.14, 0, sh);
    const pt = mesh(new THREE.CircleGeometry(0.045, 28), new THREE.MeshStandardMaterial({ map: s < 0 ? patchTexture() : nansenPatch, transparent: true, roughness: 0.8 }), s * 0.069, -0.1, 0, sh);
    pt.rotation.y = s * Math.PI / 2;
    const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
    const cv = convolute(0.06, 0.08, 4); cv.position.y = 0.04; el.add(cv);
    mesh(G(new THREE.CapsuleGeometry(0.056, 0.14, 8, 18), 2, 2), m.fabric, 0, -0.12, 0, el);
    const wb = bearing(0.05, 0.011); wb.position.y = -0.25; el.add(wb);
    if (s < 0) { // wrist checklist on the left forearm
      const cl = mesh(new RoundedBoxGeometry(0.07, 0.09, 0.02, 2, 0.005), m.dark, 0, -0.15, -0.06, el); void cl;
      mesh(new THREE.PlaneGeometry(0.058, 0.076), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }), 0, -0.15, -0.0705, el);
    }
    const glove = buildGlove(s); glove.group.position.y = -0.27; el.add(glove.group);
    arms.push({ sh, el, glove });
  }

  // ---- legs: hip bearing, thigh with pocket, knee convolutes, shin, ankle bearing, boot with toe cap and tread ----
  const legs: { hip: THREE.Group; knee: THREE.Group; foot: THREE.Group }[] = [];
  for (const s of [-1, 1] as const) {
    const hip = new THREE.Group(); hip.position.set(s * 0.11, up(HIP_Y), 0); hips.add(hip);
    const hb = bearing(0.088, 0.013); hb.position.y = -0.02; hip.add(hb);
    mesh(G(new THREE.CapsuleGeometry(0.088, 0.24, 8, 18), 2, 2), m.fabric, 0, -0.2, 0, hip);
    mesh(new RoundedBoxGeometry(0.03, 0.12, 0.11, 2, 0.01), m.fabric, s * 0.088, -0.2, 0, hip); // thigh pocket
    const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
    const kc = convolute(0.08, 0.09, 4); kc.position.y = 0.045; knee.add(kc);
    mesh(G(new THREE.SphereGeometry(0.07, 16, 12), 2, 2), m.hard, 0, 0, -0.05, knee).scale.set(1, 0.9, 0.5);
    mesh(G(new THREE.CapsuleGeometry(0.075, 0.22, 8, 18), 2, 2), m.fabric, 0, -0.18, 0, knee);
    const foot = new THREE.Group(); foot.position.y = -0.37; knee.add(foot);
    const ab = bearing(0.075, 0.012); foot.add(ab);
    mesh(G(new RoundedBoxGeometry(0.15, 0.1, 0.28, 4, 0.035), 2, 2), m.hard, 0, -0.04, -0.04, foot);
    mesh(new RoundedBoxGeometry(0.15, 0.05, 0.08, 3, 0.02), m.accent, 0, -0.04, -0.16, foot); // toe cap
    mesh(G(new THREE.BoxGeometry(0.16, 0.03, 0.3), 2, 4), m.rubber, 0, -0.085, -0.04, foot);   // tread sole
    legs.push({ hip, knee, foot });
  }

  // ---- suit thrusters: six nozzles on the backpack; each fires along its axis, pushing the other way ----
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xd6e8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const jets: { cone: THREE.Mesh; dir: THREE.Vector3 }[] = [];
  const jet = (pos: THREE.Vector3, dir: THREE.Vector3) => {
    const g = new THREE.Group(); g.position.copy(pos); chest.add(g);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.03, 12), m.metal, 0, 0.0, 0, g);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.28, 14, 1, true), jetMat.clone());
    cone.rotation.x = Math.PI; cone.position.y = 0.15; g.add(cone);
    jets.push({ cone, dir: dir.clone() });
  };
  jet(new THREE.Vector3(0, up(-0.42), 0.36), new THREE.Vector3(0, 0, 1));      // back: drives you forward
  for (const sx of [-1, 1]) jet(new THREE.Vector3(sx * 0.2, up(-0.15), 0.12), new THREE.Vector3(0, 0, -1)); // over the shoulders: backwards
  jet(new THREE.Vector3(0, up(-0.12), 0.26), new THREE.Vector3(0, 1, 0));      // top: down
  jet(new THREE.Vector3(0, up(-0.72), 0.26), new THREE.Vector3(0, -1, 0));     // bottom: up
  for (const sx of [-1, 1]) jet(new THREE.Vector3(sx * 0.23, up(-0.42), 0.25), new THREE.Vector3(sx, 0, 0)); // sides

  // ---- animation ----
  // Walking: one shared gait phase (two steps per cycle, longer strides at speed). Hips swing, the knee
  // folds in the swing phase, the boot stays level, the pelvis bobs, sways and twists, the chest
  // counter-twists, arms swing against the legs, the head stays steady, and a run leans and pumps the arms.
  // Floating: NASA's neutral body posture, limbs as damped masses that trail every acceleration, legs
  // driving straight through a push-off, a hand reaching for and closing on the rail, thrusters firing
  // against the acceleration.
  let gait = 0, breath = 0;
  const lag = new THREE.Vector3(), lagV = new THREE.Vector3(), lagT = new THREE.Vector3(), tmpV = new THREE.Vector3();
  const qRest = new THREE.Quaternion(), qAim = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0), eul = new THREE.Euler();
  interface PoseIn { floating: boolean; speed: number; phase: number; t: number; pitch: number; dt: number; acc: THREE.Vector3; jolt: THREE.Vector3; push: number; grip: THREE.Vector3 | null; reach: [number, number] }
  const pose = (o: PoseIn) => {
    const { t, dt } = o;
    breath = Math.sin(t * 1.5);
    const floatK = o.floating ? 1 : 0;
    for (const j of jets) {
      const k = floatK * THREE.MathUtils.clamp(-j.dir.dot(o.acc) / 2.4, 0, 1);
      const mat = j.cone.material as THREE.MeshBasicMaterial;
      mat.opacity += (k * (0.55 + 0.2 * Math.random()) - mat.opacity) * (1 - Math.exp(-20 * dt));
      j.cone.scale.set(1, 0.4 + k * (0.8 + 0.25 * Math.random()), 1);
      j.cone.visible = mat.opacity > 0.02;
    }
    if (o.floating) {
      gait = 0;
      // Limbs trail the acceleration: a spring-damper on the suit's own thrust (and wall bumps).
      lagT.copy(o.acc).add(o.jolt).multiplyScalar(-0.11);
      lagV.addScaledVector(tmpV.subVectors(lagT, lag), 45 * dt).multiplyScalar(Math.exp(-6 * dt));
      lag.addScaledVector(lagV, dt);
      const P = o.push, d1 = Math.sin(t * 0.7) * 0.05, d2 = Math.sin(t * 0.53 + 1.3) * 0.05;
      legs.forEach((l, i) => {
        const sd = i ? 1 : -1, dr = i ? d1 : d2;
        l.hip.rotation.set(THREE.MathUtils.lerp(0.85, 0.08, P) + dr - lag.z * 1.1 + lag.y * 0.4, 0, sd * 0.09 + lag.x * 0.7);
        l.knee.rotation.x = -THREE.MathUtils.lerp(0.9, 0.04, P) - dr * 0.6;
        l.foot.rotation.x = -0.35 * (1 - P) - 0.15 * P;
      });
      root.updateMatrixWorld(true);
      arms.forEach((a, i) => {
        const sd = i ? 1 : -1, dr = i ? d2 : d1;
        // Neutral posture: shoulders forward and out, elbows bent, drifting a little.
        eul.set(0.65 + dr - lag.z * 1.0 - P * 0.6, 0, sd * (0.38 + 0.03 * breath) + lag.x * 0.8);
        qRest.setFromEuler(eul);
        const reach = o.grip ? o.reach[i] : 0;
        if (o.grip && reach > 0.01) {
          // Aim the arm (which hangs along −y) at the rail point, in the chest's frame.
          tmpV.copy(o.grip); chest.worldToLocal(tmpV).sub(a.sh.position).normalize();
          qAim.setFromUnitVectors(DOWN, tmpV);
          a.sh.quaternion.slerpQuaternions(qRest, qAim, Math.min(1, reach * 1.2));
          a.el.rotation.x = THREE.MathUtils.lerp(1.0, 0.15, reach);
          a.glove.setCurl(THREE.MathUtils.lerp(0.3, 0.95, reach), THREE.MathUtils.lerp(0.3, 0.8, reach));
        } else {
          a.sh.quaternion.copy(qRest);
          a.el.rotation.x = 1.0 + dr * 0.5 - P * 0.6;
          a.glove.setCurl(0.3);
        }
      });
      chest.rotation.set(-0.12 + lag.z * 0.25, 0, 0); hips.rotation.set(0.05, 0, 0);
      chest.scale.set(1, 1 + breath * 0.006, 1);
      body.position.set(Math.sin(t * 0.4) * 0.01, Math.sin(t * 0.9) * 0.012, 0);
      head.rotation.set(o.pitch - 0.12, 0, 0);
      return;
    }
    lag.set(0, 0, 0); lagV.set(0, 0, 0);
    const target = Math.min(1.6, o.speed / 1.6);
    gait += (target - gait) * (1 - Math.exp(-7 * dt));
    const w = Math.min(1, gait), run = Math.max(0, gait - 1) / 0.6;
    const phi = o.phase;
    const A = 0.42 * w + 0.16 * run;
    legs.forEach((l, i) => {
      const psi = phi + i * Math.PI;
      const hipA = A * Math.sin(psi);
      const knee = w * (0.06 + (0.85 + run * 0.55) * Math.pow(Math.max(0, Math.cos(psi)), 1.5)) + run * 0.12;
      l.hip.rotation.set(hipA, 0, (i ? 1 : -1) * 0.025);
      l.knee.rotation.x = -knee;
      l.foot.rotation.x = -(hipA - knee) * 0.85;
    });
    arms.forEach((a, i) => {
      const psi = phi + i * Math.PI;
      const fwd = -Math.sin(psi);
      a.sh.rotation.set(0.04 + (0.32 * w + 0.25 * run) * fwd, 0, (i ? 1 : -1) * (0.1 + 0.02 * breath));
      a.el.rotation.x = 0.22 + w * (0.12 + 0.38 * Math.max(0, fwd)) + run * 0.75;
      a.glove.setCurl(0.4 + 0.15 * w + 0.25 * run, 0.4);
    });
    body.position.set(0.016 * w * Math.sin(phi) + 0.004 * Math.sin(t * 0.5) * (1 - w), (0.016 + 0.02 * run) * w * Math.cos(phi * 2) - 0.012 * w - 0.03 * run, 0);
    hips.rotation.set(0, 0.09 * w * Math.sin(phi), 0);
    chest.rotation.set(-0.04 * w - run * 0.16, -0.06 * w * Math.sin(phi), 0);
    chest.scale.set(1, 1 + breath * 0.006 * (1 - w), 1);
    head.rotation.set(o.pitch + 0.04 * w + run * 0.13, 0.05 * w * Math.sin(phi), 0); // the head stays on the horizon
  };

  return { root, pose };
}

export function installAstronaut(e: Engine) {
  const { root, pose } = buildAstronaut();
  root.visible = false;
  e.scene.add(root);
  const up = new THREE.Vector3(0, 1, 0), yawQ = new THREE.Quaternion(), invQ = new THREE.Quaternion();
  const zero = new THREE.Vector3(), accLocal = new THREE.Vector3(), joltLocal = new THREE.Vector3();

  e.tickers.push((dt, t) => {
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
      pose({ floating: false, speed: Math.hypot(w.vel.x, w.vel.z), phase: w.phase, t, pitch: -w.pitch * 0.6, dt, acc: zero, jolt: zero, push: 0, grip: null, reach: [0, 0] });
    } else {
      root.quaternion.copy(w.quat);
      // The thrust, in the astronaut's own frame, drives the jets and the limbs' inertia.
      invQ.copy(root.quaternion).invert();
      accLocal.copy(w.thrust).applyQuaternion(invQ);
      joltLocal.copy(w.jolt).applyQuaternion(invQ);
      pose({ floating: true, speed: w.vel.length(), phase: w.phase, t, pitch: 0, dt, acc: accLocal, jolt: joltLocal, push: w.push, grip: w.gripPoint, reach: [w.reach.left, w.reach.right] });
    }
  });
  // Tab would move focus out of the scene.
  const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Tab' && e.mode.id === 'walk' && !e.input.suspended) ev.preventDefault(); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
