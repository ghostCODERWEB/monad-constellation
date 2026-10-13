// NANSEN AI, the station's crew robot: a Nansen-green droid floating in
// mission control. Talk to it (E, or N from anywhere) and it answers through
// Nansen's own Research Agent (/api/agent → api.nansen.ai/api/v1/agent).
//
// Built from primitives. The chest emblem and the hologram above its head are
// Nansen's official animated mark (public/brand/nansen-mark.gif, from
// nansen.ai), decoded frame by frame with WebCodecs' ImageDecoder. Where that
// API is missing, the static brand-kit path is animated on canvas instead. The visor face blinks, looks at you, and
// its mouth bars move while an answer streams in.
import * as THREE from 'three';
import type { Engine } from '../engine';
import { NANSEN_DARK, NANSEN_GREEN, NANSEN_GREEN_FOCUSED, NANSEN_MARK_PATH, NANSEN_MARK_VIEWBOX } from '../world/nansenMark';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { pbrSet, recolouredPaint, scaleUV } from '../world/pbr';
import { addPanelMode, hotkey } from './panel';

export interface Robot { talking: boolean; thinking: boolean }

// In the research module beside the workstation: the crew's research partner.
const HOME = new THREE.Vector3(6.4, 0.0, -0.45);

/** Nansen's animated mark, decoded into bitmaps; null until ready or where unsupported. */
interface Gif { frames: ImageBitmap[]; times: number[]; length: number }
let gif: Gif | null = null;
async function loadGif(url: string) {
  // ImageDecoder is WebCodecs: Chromium and Safari 17+; elsewhere we keep the fallback.
  const Decoder = (window as unknown as { ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => {
    tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
    decode(o: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void;
  } }).ImageDecoder;
  if (!Decoder) return;
  try {
    const data = await (await fetch(url)).arrayBuffer();
    const dec = new Decoder({ data, type: 'image/gif' });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack?.frameCount ?? 0;
    const frames: ImageBitmap[] = [], times: number[] = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      times.push(at);
      at += (image.duration ?? 40_000) / 1e6;
      frames.push(await createImageBitmap(image));
      image.close();
    }
    dec.close();
    if (frames.length) gif = { frames, times, length: at };
  } catch { /* keep the canvas fallback */ }
}
function gifFrame(t: number) {
  if (!gif) return null;
  const x = t % gif.length;
  let i = 0;
  while (i + 1 < gif.times.length && gif.times[i + 1] <= x) i++;
  return gif.frames[i];
}

/** The Nansen mark on a canvas, animated by `t`. Transparent background unless `disc`. */
function drawMark(g: CanvasRenderingContext2D, size: number, t: number, disc: boolean) {
  g.clearRect(0, 0, size, size);
  const c = size / 2;
  if (disc) {
    const bg = g.createRadialGradient(c, c, size * 0.1, c, c, size * 0.5);
    bg.addColorStop(0, '#1b3d39'); bg.addColorStop(1, NANSEN_DARK);
    g.fillStyle = bg; g.beginPath(); g.arc(c, c, size * 0.48, 0, Math.PI * 2); g.fill();
    g.strokeStyle = NANSEN_GREEN_FOCUSED; g.lineWidth = size * 0.02; g.stroke();
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
  const frame = gifFrame(t);
  if (frame) {
    const s = size * (disc ? 0.78 : 0.96);
    g.save();
    g.shadowColor = NANSEN_GREEN; g.shadowBlur = (8 + pulse * 18) * (size / 256);
    g.drawImage(frame, c - s / 2, c - s / 2, s, s);
    g.restore();
    return;
  }
  const mark = drawMark.path ??= new Path2D(NANSEN_MARK_PATH);
  g.save();
  g.translate(c, c);
  g.rotate(t * 0.6);
  const k = (size * (disc ? 1.25 : 1.55)) / NANSEN_MARK_VIEWBOX;
  g.scale(k, k);
  g.translate(-NANSEN_MARK_VIEWBOX / 2, -NANSEN_MARK_VIEWBOX / 2);
  g.shadowColor = NANSEN_GREEN; g.shadowBlur = (12 + pulse * 26) / k * (size / 256);
  g.fillStyle = NANSEN_GREEN;
  g.fill(mark);
  g.restore();
  // A sweep of light across the mark.
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const x = ((t * 0.45) % 1.6 - 0.3) * size;
  const sweep = g.createLinearGradient(x - size * 0.15, 0, x + size * 0.15, size * 0.3);
  sweep.addColorStop(0, 'rgba(255,255,255,0)'); sweep.addColorStop(0.5, 'rgba(255,255,255,0.75)'); sweep.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sweep; g.fillRect(0, 0, size, size);
  g.restore();
}
drawMark.path = null as Path2D | null;

function canvasTex(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { g: c.getContext('2d')!, tex };
}

export function installRobot(e: Engine) {
  const robot: Robot = { talking: false, thinking: false };
  if (!gif) loadGif('/brand/nansen-mark.gif');
  (e as unknown as { robot: Robot }).robot = robot;

  // Painted aluminium: the chipped-paint scan recoloured Nansen green (bare metal shows
  // through the chips), under a clearcoat. Dark parts are carbon weave; trim is brushed metal.
  const shell = pbrSet('painted-metal', { albedo: recolouredPaint(0x09c385), normal: 0.85, roughness: 0.9, clearcoat: 1, clearcoatRoughness: 0.07 });
  shell.metalness = 0.55; // chips read as bare metal, not black holes
  const dark = pbrSet('carbon-weave', { color: 0x8fd9c4, normal: 1.1, roughness: 0.85, clearcoat: 1, clearcoatRoughness: 0.12 });
  const metal = pbrSet('brushed-aluminium', { color: 0xdfe5ea, normal: 0.7, roughness: 0.8 });
  const rubber = pbrSet('rubber', { color: 0x1d2327, normal: 1.3 });
  const glow = new THREE.MeshBasicMaterial({ color: NANSEN_GREEN });
  const R = (geo: THREE.BufferGeometry, u = 1, v = 1) => scaleUV(geo, u, v);
  const bolt = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.006, 10), metal, 160);
  let bolts = 0;
  const mat4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
  /** A hex-head fastener lying on a surface: `n` is the surface normal. */
  const addBolt = (parent: THREE.Object3D, p: THREE.Vector3, n: THREE.Vector3) => {
    if (bolts >= 160) return;
    quat.setFromUnitVectors(UP, n.clone().normalize());
    parent.updateMatrixWorld();
    bolt.setMatrixAt(bolts++, mat4.compose(p, quat, new THREE.Vector3(1, 1, 1)));
  };
  /** A thin dark groove ring: a panel seam. */
  const seam = (radius: number, y: number, sx = 1, sz = 0.82) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.0032, 6, 64), seamMat);
    m.rotation.x = Math.PI / 2; m.position.y = y; m.scale.set(sx, sz, 1);
    return m;
  };
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x03100d, roughness: 0.9 });

  const group = new THREE.Group();
  group.position.copy(HOME);
  const body = new THREE.Group(); // bobs and leans; group turns to face the player
  group.add(body);

  // Torso: painted capsule, with seam lines, an access plate, bolts and a rated nameplate.
  const torso = new THREE.Mesh(R(new THREE.CapsuleGeometry(0.2, 0.22, 16, 48), 3, 3), shell);
  torso.scale.set(1, 1, 0.82);
  body.add(torso);
  for (const y of [-0.075, 0.185]) body.add(seam(0.2 * 1.001, y));
  const midSeam = new THREE.Mesh(new THREE.TorusGeometry(0.201, 0.003, 6, 64, Math.PI), seamMat); // vertical split down the back
  midSeam.rotation.y = Math.PI / 2; midSeam.scale.set(0.82, 1.6, 1); midSeam.position.y = 0.055;
  body.add(midSeam);
  const band = new THREE.Mesh(R(new THREE.TorusGeometry(0.2, 0.026, 20, 64), 8, 1), dark);
  band.rotation.x = Math.PI / 2; band.position.y = -0.12; band.scale.set(1, 0.82, 1);
  body.add(band);
  for (let i = 0; i < 20; i++) { // bolts around the waist band
    const a = (i / 20) * Math.PI * 2, rx = 0.2 + 0.002, rz = 0.164 + 0.002;
    addBolt(body, new THREE.Vector3(Math.sin(a) * rx, -0.12 + 0.027, Math.cos(a) * rz), new THREE.Vector3(0, 1, 0));
  }
  const emblem = canvasTex(256, 256);
  // Emblem: a recessed bezel in brushed metal under a glass cover, over the live mark.
  const bezel = new THREE.Mesh(R(new THREE.TorusGeometry(0.128, 0.011, 16, 64), 6, 1), metal);
  bezel.position.set(0, 0.03, 0.168); body.add(bezel);
  const chest = new THREE.Mesh(new THREE.CircleGeometry(0.119, 64), new THREE.MeshBasicMaterial({ map: emblem.tex, transparent: true }));
  chest.position.set(0, 0.03, 0.168);
  body.add(chest);
  const chestGlass = new THREE.Mesh(new THREE.CircleGeometry(0.12, 64), new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }));
  chestGlass.position.set(0, 0.03, 0.172);
  body.add(chestGlass);
  const chestRim = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.006, 8, 64), glow);
  chestRim.position.copy(chest.position);
  body.add(chestRim);
  for (let i = 0; i < 8; i++) { // bezel screws
    const a = (i / 8) * Math.PI * 2 + 0.2;
    addBolt(body, new THREE.Vector3(Math.sin(a) * 0.14, 0.03 + Math.cos(a) * 0.14, 0.166), new THREE.Vector3(0, 0, 1));
  }
  // Nameplate and decals below the emblem, screen-printed (transparent ground).
  const decal = (lines: string[], w: number, h: number, size: number) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * (h / w));
    const g = c.getContext('2d')!;
    g.fillStyle = '#04120e'; g.textAlign = 'center'; g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
    lines.forEach((l, i) => g.fillText(l, 256, size + i * size * 1.2));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  };
  const nameplate = decal(['NANSEN AI', 'CREW UNIT NA-01'], 0.16, 0.05, 68);
  nameplate.position.set(0, -0.085, 0.166); nameplate.rotation.x = 0.22; nameplate.scale.set(1, 1, 1);
  body.add(nameplate);
  const access = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.05, 0.008, 3, 0.004), metal); // access plate, left flank
  access.position.set(-0.19, 0.0, 0.07); access.rotation.y = -1.15; body.add(access);
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const o = new THREE.Vector3(-0.19, 0, 0.07).add(new THREE.Vector3(dx * 0.031 * Math.cos(1.15), dy * 0.019, dx * 0.031 * Math.sin(1.15)));
    addBolt(body, o, new THREE.Vector3(-0.9, 0, 0.4));
  }

  // Head: a painted shell with a recessed carbon visor frame, a glass cover and a green HUD face.
  const head = new THREE.Group();
  head.position.y = 0.36;
  body.add(head);
  const skull = new THREE.Mesh(R(new THREE.SphereGeometry(0.17, 64, 48), 3, 2), shell);
  skull.scale.set(1.15, 0.9, 1);
  head.add(skull);
  head.add(seam(0.17, 0.02, 1.15, 1.0)); // equator seam
  const face = canvasTex(256, 128);
  const vSection = (r: number, phi = 1.9, th = 0.84, t0 = Math.PI / 2 - 0.42, p0 = -0.95 + Math.PI / 2) => new THREE.SphereGeometry(r, 48, 24, p0, phi, t0, th);
  const frame = new THREE.Mesh(vSection(0.1715, 2.1, 1.0, Math.PI / 2 - 0.52, -1.05 + Math.PI / 2), dark); // chunky carbon frame behind the visor
  frame.scale.copy(skull.scale);
  head.add(frame);
  const visor = new THREE.Mesh(vSection(0.1735), new THREE.MeshBasicMaterial({ map: face.tex }));
  visor.scale.copy(skull.scale);
  head.add(visor);
  const visorGlass = new THREE.Mesh(vSection(0.1765), new THREE.MeshPhysicalMaterial({ color: 0x0a1f1a, transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.01, ior: 1.6, envMapIntensity: 2.4, depthWrite: false }));
  visorGlass.scale.copy(skull.scale);
  head.add(visorGlass);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(R(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 32), 4, 1), metal);
    ear.rotation.z = Math.PI / 2; ear.position.x = s * 0.2;
    head.add(ear);
    const cap = new THREE.Mesh(R(new THREE.CylinderGeometry(0.054, 0.054, 0.014, 32), 6, 1), rubber);
    cap.rotation.z = Math.PI / 2; cap.position.x = s * 0.178;
    head.add(cap);
    const light = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), glow);
    light.position.x = s * 0.226; light.rotation.y = s * Math.PI / 2;
    head.add(light);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      addBolt(head, new THREE.Vector3(s * 0.2257, 0.36 + Math.cos(a) * 0.04, Math.sin(a) * 0.04), new THREE.Vector3(s, 0, 0));
    }
  }
  const antenna = new THREE.Mesh(R(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 12), 1, 2), metal);
  antenna.position.set(0.06, 0.2, 0);
  head.add(antenna);
  const base = new THREE.Mesh(R(new THREE.CylinderGeometry(0.016, 0.02, 0.02, 20), 2, 1), dark);
  base.position.set(0.06, 0.148, 0); head.add(base);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 20, 14), glow);
  tip.position.set(0.06, 0.265, 0);
  head.add(tip);

  // Arms: shoulder sockets with collars, painted upper arms, carbon elbows, gripping hands.
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.25, 0.12, 0);
    const shoulder = new THREE.Mesh(R(new THREE.SphereGeometry(0.055, 32, 24), 3, 2), dark);
    arm.add(shoulder);
    const collar = new THREE.Mesh(R(new THREE.TorusGeometry(0.05, 0.007, 10, 40), 6, 1), metal);
    collar.rotation.y = Math.PI / 2; collar.position.x = -s * 0.012; arm.add(collar);
    const upper = new THREE.Mesh(R(new THREE.CapsuleGeometry(0.035, 0.14, 12, 28), 2, 2), shell);
    upper.position.y = -0.11;
    arm.add(upper);
    const elbow = new THREE.Mesh(R(new THREE.TorusGeometry(0.037, 0.008, 10, 32), 6, 1), dark);
    elbow.rotation.x = Math.PI / 2; elbow.position.y = -0.065; arm.add(elbow);
    const hand = new THREE.Mesh(R(new THREE.SphereGeometry(0.042, 32, 24), 3, 2), dark);
    hand.position.y = -0.23;
    arm.add(hand);
    for (let f = 0; f < 3; f++) { // rubber-tipped finger pads
      const a = (f / 3) * Math.PI * 2 + (s > 0 ? 0 : 1);
      const fin = new THREE.Mesh(R(new THREE.CapsuleGeometry(0.009, 0.026, 6, 12), 1, 2), rubber);
      fin.position.set(Math.cos(a) * 0.026, -0.265, Math.sin(a) * 0.026);
      fin.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      arm.add(fin);
    }
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.006, 8, 32), glow);
    cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.19;
    arm.add(cuff);
    arm.rotation.z = s * 0.25;
    body.add(arm);
    arms.push(arm);
  }

  // Thruster module underneath: a carbon cowl with vents, and the glowing ring.
  const cowl = new THREE.Mesh(R(new THREE.CylinderGeometry(0.135, 0.095, 0.05, 40, 1, true), 5, 1), dark);
  cowl.position.y = -0.31; cowl.material = (dark.clone() as THREE.MeshPhysicalMaterial); (cowl.material as THREE.MeshPhysicalMaterial).side = THREE.DoubleSide;
  body.add(cowl);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.003, 0.014), seamMat);
    vent.position.set(Math.sin(a) * 0.118, -0.31, Math.cos(a) * 0.118);
    vent.rotation.y = a; vent.rotation.x = -0.4;
    body.add(vent);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 12, 48), glow);
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.345;
  body.add(ring);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 24, 1, true), new THREE.MeshBasicMaterial({ color: NANSEN_GREEN, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  jet.rotation.x = Math.PI; jet.position.y = -0.45;
  body.add(jet);
  const lamp = new THREE.PointLight(NANSEN_GREEN, 0.5, 1.8, 2);
  lamp.position.set(0, -0.5, 0.6);
  body.add(lamp);

  bolt.count = bolts;
  body.add(bolt);

  // Hologram: the mark spinning above its head, brighter while it thinks.
  const holo = canvasTex(256, 256);
  const hologram = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ map: holo.tex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  hologram.position.y = 0.72;
  body.add(hologram);

  e.station.interior.add(group);

  // ---------- animation ----------
  let blink = 0, nextBlink = 2, redraw = 0;
  const toPlayer = new THREE.Vector3();
  const lookAt = new THREE.Vector2();
  const drawFace = (t: number) => {
    const g = face.g;
    g.fillStyle = '#04110f'; g.fillRect(0, 0, 256, 128);
    // Faint scanlines.
    g.fillStyle = 'rgba(0,255,167,0.05)';
    for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 256, 1);
    g.fillStyle = NANSEN_GREEN; g.shadowColor = NANSEN_GREEN; g.shadowBlur = 14;
    const eyeH = blink > 0 ? 3 : robot.thinking ? 10 : 22;
    for (const s of [-1, 1]) {
      const x = 128 + s * 46 + lookAt.x * 14, y = 52 - lookAt.y * 8;
      g.beginPath(); g.ellipse(x, y, 16, eyeH / 2 + 2, 0, 0, Math.PI * 2); g.fill();
    }
    if (robot.talking) {
      for (let i = 0; i < 7; i++) {
        const h = 4 + Math.abs(Math.sin(t * 13 + i * 1.7)) * 16;
        g.fillRect(100 + i * 8, 96 - h / 2, 5, h);
      }
    } else if (robot.thinking) {
      for (let i = 0; i < 3; i++) { g.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(t * 5 - i)); g.beginPath(); g.arc(112 + i * 16, 96, 4, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    } else {
      g.beginPath(); g.arc(128, 84, 18, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = 4; g.strokeStyle = NANSEN_GREEN; g.stroke();
    }
    g.shadowBlur = 0;
    face.tex.needsUpdate = true;
  };

  // It is solid: bump into it and it gets shoved aside, then its thrusters
  // bring it back to its post (station-keeping), as a free-flyer would.
  const offset = new THREE.Vector3(), drift = new THREE.Vector3();
  const centre = new THREE.Vector3();
  let greeted = false;

  e.tickers.push((dt, t) => {
    if (e.mode.id === 'walk') {
      const w = e.walker;
      centre.copy(group.position).add(new THREE.Vector3(0, 0.1, 0));
      const d = w.pos.distanceTo(centre), min = 0.42 + w.radius;
      if (d > 0 && d < min) {
        const n = new THREE.Vector3().subVectors(w.pos, centre).divideScalar(d);
        w.pos.addScaledVector(n, min - d);
        const into = -w.vel.dot(n);
        if (into > 0) {
          w.vel.addScaledVector(n, into * 1.4);
          drift.addScaledVector(n, -into * 0.6);
          if (into > 0.4) e.say('NANSEN AI: Careful, I’m holding position here!', 2.5);
        }
      }
      // A friendly hello the first time you come close.
      if (!greeted && d < 2.4) {
        const look = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quat);
        if (look.dot(centre.clone().sub(w.pos).normalize()) > 0.8) {
          greeted = true;
          e.say('NANSEN AI: Hi! I answer with Nansen data on Monad. Press E to talk, or N from anywhere.', 5);
        }
      }
    }
    // Station-keeping: a damped spring back to its post.
    drift.addScaledVector(offset, -3 * dt).multiplyScalar(Math.exp(-2.2 * dt));
    offset.addScaledVector(drift, dt);
    group.position.copy(HOME).add(offset);

    // Turn to face whoever is talking to it.
    toPlayer.subVectors(e.camera.position, group.position);
    const yaw = Math.atan2(toPlayer.x, toPlayer.z);
    group.rotation.y += (((yaw - group.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 2);
    const local = toPlayer.clone().applyQuaternion(group.quaternion.clone().invert()).normalize();
    lookAt.set(THREE.MathUtils.clamp(local.x * 2, -1, 1), THREE.MathUtils.clamp(local.y * 2, -1, 1));
    head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, -lookAt.y * 0.3, dt * 3);

    body.position.y = Math.sin(t * 1.1) * 0.04;
    body.rotation.z = Math.sin(t * 0.7) * 0.05;
    const busy = robot.talking ? 1 : robot.thinking ? 0.5 : 0;
    arms[0].rotation.x = Math.sin(t * (busy ? 3.2 : 0.9)) * (0.12 + busy * 0.35);
    arms[1].rotation.x = Math.sin(t * (busy ? 2.7 : 0.8) + 1.4) * (0.12 + busy * 0.3);
    ring.scale.setScalar(1 + Math.sin(t * 6) * 0.04);
    (jet.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.abs(Math.sin(t * 9)) * 0.08 + Math.min(0.5, drift.length() * 2);
    hologram.rotation.y = t * 0.8;
    hologram.position.y = 0.72 + Math.sin(t * 1.6) * 0.02;
    (hologram.material as THREE.MeshBasicMaterial).opacity = robot.thinking ? 1 : 0.7;
    tip.visible = Math.sin(t * (robot.thinking ? 10 : 2.5)) > -0.2;

    nextBlink -= dt;
    if (nextBlink < 0) { blink = 0.12; nextBlink = 2 + Math.random() * 3.5; }
    blink = Math.max(0, blink - dt);
    redraw -= dt;
    if (redraw <= 0) {
      redraw = 1 / 24;
      drawMark(emblem.g, 256, t, true); emblem.tex.needsUpdate = true;
      drawMark(holo.g, 256, t * (robot.thinking ? 3 : 1) + 1.3, false); holo.tex.needsUpdate = true;
      drawFace(t);
    }
  });

  // ---------- talking ----------
  const eye = new THREE.Vector3();
  const cleanup = addPanelMode(e, 'agent', 'Nansen AI', () => {
    // Face the robot from in front (the module is narrow, so the view is fixed, not along its heading),
    // aiming to its right so it sits in the left of the frame, clear of the chat panel.
    eye.copy(group.position).add(new THREE.Vector3(0, 0.2, 1.1));
    return { eye, target: group.position.clone().add(new THREE.Vector3(0.4, 0.12, 0)) };
  });
  hotkey(e, 'KeyN', 'agent');
  e.interactions.add({ id: 'robot', label: 'talk to Nansen AI', position: group.position, reach: 2.6, use: () => e.setMode('agent') });
  e.log.add('robot-boot', 'system', 'Nansen AI aboard', 'The crew robot answers through Nansen’s Research Agent. Press N anywhere, or float up to it and press E.');
  return cleanup;
}
