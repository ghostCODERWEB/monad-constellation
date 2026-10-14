// The station engine: renderer, the two layered scenes (sky in kilometres,
// station in metres), the mode stack, interactions, bodies and the HUD feed.
// Exactly one mode updates per frame; every mode returns to "walk" on Esc.
import * as THREE from 'three';
import { disposeTree } from '@/lib/gpu';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { interiorEnvironment } from './world/envInterior';
import { Input } from './core/input';
import { Interactions, type Interactable } from './core/interact';
import { MissionLog } from './core/log';
import { Bodies } from './core/bodies';
import { buildStation, type Station } from './world/station';
import { buildSky, type Sky } from './world/sky';
import { animateHands, buildHands, createWalker, setMoveMode, stepWalker, type MoveMode, type ViewMode, type Walker } from './modes/walker';

export interface Mode {
  id: string;
  /** Short name shown in the HUD. */
  title: string;
  enter(from: string): void;
  exit(to: string): void;
  update(dt: number, t: number): void;
  /** Whether E also leaves the mode (it does unless the mode uses E itself). */
  eExits?: boolean;
  /** Extra HUD data for this mode. */
  hud?(): Record<string, unknown>;
}

/** What the crew is researching right now: set by the telescope, the PC or a return flight, read by the robot and the shuttle. */
export interface Subject { kind: 'token' | 'wallet'; address: string; label: string; source: 'telescope' | 'pc' | 'flight'; /** The universe a token belongs to, when known. */ universe?: string }

export interface EngineState {
  subject: Subject | null;
  mode: string;
  modeTitle: string;
  prompt: string | null;
  zone: string | null;
  speed: number;
  assist: boolean;
  moveMode: MoveMode;
  view: ViewMode;
  gripping: boolean;
  holding: string | null;
  locked: boolean;
  dragLook: boolean;
  pad: boolean;
  sunlit: number;
  modeHud: Record<string, unknown> | null;
  toast: string | null;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  /** Ambient occlusion: contact shadows in corners, under racks and around props. */
  ao: GTAOPass;
  /** 3 = full (shadows + AO + 2× pixels), 2 = no AO, 1 = no shadows, 0 = native pixels. It steps down by itself when frames run long. */
  quality = 3;
  private slow = 0;
  private smoothDt = 1 / 60;
  private pinned = false;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  input: Input;
  interactions = new Interactions();
  log = new MissionLog();
  station: Station;
  sky: Sky;
  bodies: Bodies;
  walker: Walker;
  hands: ReturnType<typeof buildHands>;
  modes = new Map<string, Mode>();
  mode: Mode;
  t = 0;
  focus: Interactable | null = null;
  sun: THREE.DirectionalLight;
  earthlight: THREE.HemisphereLight;
  private listeners = new Set<(s: EngineState) => void>();
  private lastEmit = 0;
  private raf = 0;
  private bob = 0;
  private clock = new THREE.Timer();
  private toast: { text: string; until: number } | null = null;
  private el: HTMLElement;
  subject: Subject | null = null;
  /** Real elapsed seconds this frame for scripted sequences (see loop). */
  cineDt = 0;
  /** First-person hands: a separate scene that follows the camera (see the constructor). */
  private handScene = new THREE.Scene();
  private handRig = new THREE.Group();
  /** A mode can take over rendering entirely (the telescope eyepiece). */
  renderOverride: ((dt: number) => boolean) | null = null;
  /** Per-frame hooks for features: telescope motors, screens, eggs. */
  tickers: ((dt: number, t: number) => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // ?q=0..3 pins the quality (for screenshots and low-end checks); otherwise it adapts.
    const pin = new URLSearchParams(window.location.search).get('q');
    if (pin !== null && /^[0-3]$/.test(pin)) { this.quality = Number(pin); this.pinned = true; }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.autoClear = false;
    el.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, el.clientWidth / el.clientHeight, 0.03, 4000);
    this.scene.add(this.camera);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(interiorEnvironment(), 0.03).texture;
    // Reflections only: the room's light should come from its own fixtures, not a generic environment.
    this.scene.environmentIntensity = 0.3;

    this.sky = buildSky();
    this.station = buildStation();
    this.scene.add(this.station.interior, this.station.exterior);
    this.bodies = new Bodies(this.station.space);
    this.walker = createWalker(this.station.anchors.spawn);
    this.hands = buildHands();
    // The hands live in their own small scene, drawn after ambient occlusion: screen-space AO reads
    // anything this close to the lens as buried in a corner and paints it black.
    this.handRig.add(this.hands.group);
    this.handScene.add(this.handRig);
    this.handScene.environment = this.scene.environment;
    this.handScene.environmentIntensity = 0.45;
    this.handScene.add(new THREE.HemisphereLight(0xfff6ea, 0x6b7280, 0.9));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.1); key.position.set(0.4, 1, 0.3); this.handRig.add(key, key.target);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    // Sunlight through the windows casts real shadows: a 28 m box that follows the player, so texels stay fine.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 70;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.earthlight = new THREE.HemisphereLight(0x1a1630, 0x5d8ad6, 0.45);
    this.scene.add(this.earthlight);
    this.scene.add(new THREE.AmbientLight(0x2a2440, 0.1));

    this.composer = new EffectComposer(this.renderer);
    const skyPass = new RenderPass(this.sky.scene, this.sky.camera);
    const worldPass = new RenderPass(this.scene, this.camera);
    worldPass.clear = false;
    worldPass.clearDepth = true;
    this.composer.addPass(skyPass);
    this.composer.addPass(worldPass);
    this.ao = new GTAOPass(this.scene, this.camera, el.clientWidth, el.clientHeight);
    this.ao.output = GTAOPass.OUTPUT.Default;
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
    this.composer.addPass(this.ao);
    const handPass = new RenderPass(this.handScene, this.camera);
    handPass.clear = false;
    handPass.clearDepth = true;
    this.composer.addPass(handPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.32, 0.35, 0.95);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    const walk: Mode = { id: 'walk', title: 'Zero-g', enter: () => {}, exit: () => {}, update: (dt, t) => this.walk(dt, t) };
    this.modes.set('walk', walk);
    this.mode = walk;

    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('click', this.onClick);
    this.log.add('boot', 'system', 'Station online', 'Monad × Nansen Orbital Research Station. Mission: watch the Monad network the way the telescope watches the universe.');
  }

  addMode(m: Mode) { this.modes.set(m.id, m); }

  setMode(id: string) {
    const next = this.modes.get(id);
    if (!next || next === this.mode) return;
    const prev = this.mode;
    prev.exit(id);
    this.input.reset();
    this.mode = next;
    next.enter(prev.id);
    this.emit(true);
  }

  setSubject(s: Subject | null) {
    if (s?.address === this.subject?.address && s?.source === this.subject?.source) return;
    this.subject = s;
    this.emit(true);
  }

  say(text: string, seconds = 3.5) { this.toast = { text, until: this.t + seconds }; this.emit(true); }

  on(f: (s: EngineState) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  start() { this.clock.reset(); this.loop(); }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.clock.update();
    const raw = this.clock.getDelta();
    // Physics steps are capped for stability. Scripted sequences (launch,
    // docking) read cineDt instead: real elapsed time, so they keep their
    // declared duration at 14 fps as at 60, capped at 0.25 s so a hidden tab
    // (no frames) pauses a sequence rather than skipping it.
    const dt = Math.min(0.05, raw);
    this.cineDt = Math.min(0.25, raw);
    this.t += dt;
    this.input.poll();
    // Universal exit: Esc (or the pad's B / Start) always returns to walking.
    if (this.mode.id !== 'walk' && (this.input.hit('Escape') || this.input.padHit(9) || (this.mode.eExits !== false && (this.input.hit('KeyE') || this.input.padHit(3))))) {
      this.setMode('walk');
    } else {
      this.mode.update(dt, this.t);
    }
    for (const f of this.tickers) f(dt, this.t);
    this.bodies.step(dt, this.mode.id === 'walk' ? this.walker : null);
    this.render(dt);
    this.input.endFrame();
    if (this.t - this.lastEmit > 0.1) this.emit();
  };

  /** The default mode: float, look, grab, use. */
  private walk(dt: number, t: number) {
    const w = this.walker;
    // Movement runs on real time (sub-stepped inside the walker), so walking pace is the same at 10 fps as at 60.
    dt = Math.min(0.25, Math.max(dt, this.cineDt));
    stepWalker(w, this.input, dt, this.station.space, this.station.rails, this.bodies, {
      pushOff: () => this.sfx?.('push'),
      grab: () => this.sfx?.('grab'),
      bump: (s) => this.sfx?.('bump', s),
    }, this.station.groundAt);
    this.camera.position.copy(w.pos);
    this.camera.quaternion.copy(w.quat);
    if (w.view === 'third') this.chaseCamera(w);
    this.hands.group.visible = w.view === 'first';
    animateHands(this.hands, w, t);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quat);
    // Head-bob: a small vertical sway in step with the stride, only while walking in first person.
    if (w.moveMode === 'walk' && w.view === 'first') {
      const sp = Math.hypot(w.vel.x, w.vel.z);
      this.bob += (Math.min(1.3, sp / 2.4) - this.bob) * (1 - Math.exp(-8 * dt));
      // One bob per step, a side sway once per cycle: the same gait phase that moves the legs.
      this.camera.position.y += Math.sin(w.phase * 2) * 0.022 * this.bob;
      this.camera.position.addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(w.quat), Math.cos(w.phase) * 0.012 * this.bob);
    }
    // A touch more field of view at a run, so speed reads; it eases back to 72° (which also restores it after panels).
    const runK = w.moveMode === 'walk' ? THREE.MathUtils.clamp((Math.hypot(w.vel.x, w.vel.z) - 3) / 2, 0, 1) : 0;
    const fovWant = 72 + 6 * runK;
    if (Math.abs(this.camera.fov - fovWant) > 0.01) { this.camera.fov += (fovWant - this.camera.fov) * (1 - Math.exp(-5 * dt)); this.camera.updateProjectionMatrix(); }
    this.focus = this.interactions.focus(w.pos, look);
    if (this.focus && (this.input.hit('KeyE') || this.input.padHit(3))) this.focus.use();
    // Bodies noticed up close (Easter eggs log themselves).
    for (const b of this.bodies.list) {
      if (!b.noticed && b.onNotice && b.pos.distanceTo(w.pos) < 1.6) {
        const to = b.pos.clone().sub(w.pos).normalize();
        if (to.dot(look) > 0.8) { b.noticed = true; b.onNotice(); }
      }
    }
  }

  /** Walk or drift. */
  setMoveMode(m: MoveMode) {
    if (this.walker.moveMode === m) return;
    setMoveMode(this.walker, m);
    this.say(m === 'walk' ? 'Walking: feet on the floor' : 'Floating: zero gravity', 2.2);
    this.emit(true);
  }

  /** First person or third person. */
  setView(v: ViewMode) {
    if (this.walker.view === v) return;
    this.walker.view = v;
    this.emit(true);
  }

  /** Third person: the camera trails the astronaut and pulls in rather than pass through a wall. */
  private chaseCamera(w: Walker) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(w.quat);
    const cand = new THREE.Vector3();
    const probe = new THREE.Vector3();
    // The camera backs off only as far as it can still see the astronaut: every point on the line
    // from the head to the camera must be inside the rooms, so it never peeks through a wall.
    for (let d = 2.9; d >= 0.45; d -= 0.25) {
      cand.copy(w.pos).addScaledVector(back, d).y += 0.35 * (d / 2.9);
      let clear = true;
      for (let k = 1; k <= 12 && clear; k++) clear = this.station.space.contains(probe.lerpVectors(w.pos, cand, k / 12), 0.1);
      if (clear) break;
    }
    this.camera.position.copy(cand);
  }

  /** Sound hook, installed by the audio module. */
  sfx?: (name: string, amount?: number) => void;

  private render(dt: number) {
    const el = this.el;
    // Aboard, the hull's outside faces would wall off every hatch; outside, it is the station.
    this.station.hull.visible = !this.station.space.contains(this.camera.position, 0);
    if (this.renderOverride?.(dt)) return;
    this.camera.updateMatrixWorld();
    this.camera.matrixWorld.decompose(this.handRig.position, this.handRig.quaternion, this.handRig.scale);
    this.sky.update(this.t, this.camera.getWorldQuaternion(new THREE.Quaternion()), el.clientWidth / el.clientHeight, this.camera.fov);
    // Sunlight through the windows follows the orbit and dies in Earth's shadow.
    this.sun.position.copy(this.camera.position).addScaledVector(this.sky.sunDir, 30);
    this.sun.target.position.copy(this.camera.position);
    // Without shadow maps the sun would shine straight through the hull; aboard, keep only a trace of it.
    const aboard = this.station.space.contains(this.camera.position, 0);
    this.sun.intensity = 1.6 * this.sky.sunlit * (aboard && this.quality < 2 ? 0.25 : 1);
    this.earthlight.intensity = 0.25 + 0.45 * this.sky.earthDay;
    this.adapt(dt);
    this.ao.enabled = this.quality >= 3;
    this.sun.castShadow = this.quality >= 2 && this.sky.sunlit > 0.02;
    this.composer.render(dt);
  }

  /** Steps quality down when frames stay long (above ~28 ms for three seconds), so a weak GPU gets smooth rather than pretty. */
  private adapt(dt: number) {
    if (this.pinned || this.t < 4) return; // shader compiles and texture uploads make the first seconds unrepresentative
    this.smoothDt += (Math.min(dt, 0.2) - this.smoothDt) * 0.05;
    this.slow = this.smoothDt > 0.028 ? this.slow + dt : Math.max(0, this.slow - dt);
    if (this.slow > 3 && this.quality > 0) {
      this.quality--; this.slow = 0;
      if (this.quality === 0) { this.renderer.setPixelRatio(1); this.onResize(); }
      this.log.add('quality', 'system', 'Graphics reduced', `Frames were running long, so quality dropped to level ${this.quality}.`);
    }
  }

  private emit(force = false) {
    if (!force && this.listeners.size === 0) return;
    this.lastEmit = this.t;
    const w = this.walker;
    const s: EngineState = {
      subject: this.subject,
      mode: this.mode.id,
      modeTitle: this.mode.id === 'walk' ? (w.moveMode === 'walk' ? 'Walking' : 'Zero-g') : this.mode.title,
      prompt: this.mode.id === 'walk' && this.focus ? `Press E to ${Interactions.text(this.focus)}` : null,
      zone: this.station.space.zoneOf(w.pos),
      speed: w.vel.length(),
      assist: w.assist,
      moveMode: w.moveMode,
      view: w.view,
      gripping: !!w.grip,
      holding: w.holding?.name ?? null,
      locked: this.input.locked,
      dragLook: this.input.lockFailed,
      pad: this.input.pad.connected,
      sunlit: this.sky.sunlit,
      modeHud: this.mode.hud?.() ?? null,
      toast: this.toast && this.toast.until > this.t ? this.toast.text : null,
    };
    this.listeners.forEach((l) => l(s));
  }

  private onResize = () => {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.ao.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onClick = () => { if (this.mode.id === 'walk' || this.modes.get(this.mode.id)?.id !== 'workstation') this.input.lock(); };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clock.dispose();
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.input.dispose();
    // Free every GPU resource the scenes hold (React remounts and hot reloads would otherwise leak them).
    const freed = disposeTree(this.scene);
    disposeTree(this.sky.scene, freed);
    disposeTree(this.handScene, freed);
    this.ao.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.el.removeChild(this.renderer.domElement);
  }
}
