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
import { addPanelMode, hotkey } from './panel';

export interface Robot { talking: boolean; thinking: boolean }

// Just right of the research hatch: the first thing you see when you wake up aboard.
const HOME = new THREE.Vector3(1.5, 0.05, -1.3);

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

  const shell = new THREE.MeshPhysicalMaterial({ color: NANSEN_GREEN_FOCUSED, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15, emissive: 0x053d2a, emissiveIntensity: 0.25 });
  const dark = new THREE.MeshPhysicalMaterial({ color: NANSEN_DARK, metalness: 0.7, roughness: 0.35, clearcoat: 0.8 });
  const glow = new THREE.MeshBasicMaterial({ color: NANSEN_GREEN });

  const group = new THREE.Group();
  group.position.copy(HOME);
  const body = new THREE.Group(); // bobs and leans; group turns to face the player
  group.add(body);

  // Torso: a rounded capsule with a dark waist band and the animated emblem.
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.22, 8, 24), shell);
  torso.scale.set(1, 1, 0.82);
  body.add(torso);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 10, 40), dark);
  band.rotation.x = Math.PI / 2; band.position.y = -0.12; band.scale.set(1, 0.82, 1);
  body.add(band);
  const emblem = canvasTex(256, 256);
  const chest = new THREE.Mesh(new THREE.CircleGeometry(0.115, 48), new THREE.MeshBasicMaterial({ map: emblem.tex, transparent: true }));
  chest.position.set(0, 0.03, 0.168);
  body.add(chest);
  const chestRim = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.008, 8, 48), glow);
  chestRim.position.copy(chest.position);
  body.add(chestRim);

  // Head: a flattened sphere with a dark visor showing the face.
  const head = new THREE.Group();
  head.position.y = 0.36;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), shell);
  skull.scale.set(1.15, 0.9, 1);
  head.add(skull);
  const face = canvasTex(256, 128);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 32, 16, -0.95 + Math.PI / 2, 1.9, Math.PI / 2 - 0.42, 0.84), new THREE.MeshBasicMaterial({ map: face.tex }));
  visor.scale.copy(skull.scale);
  head.add(visor);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), dark);
    ear.rotation.z = Math.PI / 2; ear.position.x = s * 0.2;
    head.add(ear);
    const light = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), glow);
    light.position.x = s * 0.226; light.rotation.y = s * Math.PI / 2;
    head.add(light);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), dark);
  antenna.position.set(0.06, 0.2, 0);
  head.add(antenna);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10), glow);
  tip.position.set(0.06, 0.265, 0);
  head.add(tip);

  // Arms: shoulder balls and two-part capsules that gesture while it talks.
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.25, 0.12, 0);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), dark);
    arm.add(shoulder);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 6, 12), shell);
    upper.position.y = -0.11;
    arm.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), dark);
    hand.position.y = -0.23;
    arm.add(hand);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.007, 6, 20), glow);
    cuff.rotation.x = Math.PI / 2; cuff.position.y = -0.19;
    arm.add(cuff);
    arm.rotation.z = s * 0.25;
    body.add(arm);
    arms.push(arm);
  }

  // Thruster ring underneath: it lives in zero-g like everyone else.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 10, 40), glow);
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.33;
  body.add(ring);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 24, 1, true), new THREE.MeshBasicMaterial({ color: NANSEN_GREEN, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  jet.rotation.x = Math.PI; jet.position.y = -0.45;
  body.add(jet);
  const lamp = new THREE.PointLight(NANSEN_GREEN, 0.3, 1.6, 2);
  lamp.position.set(0, -0.2, 0.25);
  body.add(lamp);

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
    // Face the robot from in front, and aim to its right so it sits in the
    // left of the frame, clear of the chat panel on the right.
    const fwd = new THREE.Vector3(Math.sin(group.rotation.y), 0, Math.cos(group.rotation.y));
    eye.copy(group.position).addScaledVector(fwd, 1.25).add(new THREE.Vector3(0, 0.2, 0));
    const camRight = new THREE.Vector3().crossVectors(fwd.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize();
    return { eye, target: group.position.clone().addScaledVector(camRight, 0.42).add(new THREE.Vector3(0, 0.12, 0)) };
  });
  hotkey(e, 'KeyN', 'agent');
  e.interactions.add({ id: 'robot', label: 'talk to Nansen AI', position: group.position, reach: 2.6, use: () => e.setMode('agent') });
  e.log.add('robot-boot', 'system', 'Nansen AI aboard', 'The crew robot answers through Nansen’s Research Agent. Press N anywhere, or float up to it and press E.');
  return cleanup;
}
