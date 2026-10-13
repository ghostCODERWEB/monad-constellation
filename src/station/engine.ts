// The station engine: renderer, the two layered scenes (sky in kilometres,
// station in metres), the mode stack, interactions, bodies and the HUD feed.
// Exactly one mode updates per frame; every mode returns to "walk" on Esc.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Input } from './core/input';
import { Interactions, type Interactable } from './core/interact';
import { MissionLog } from './core/log';
import { Bodies } from './core/bodies';
import { buildStation, type Station } from './world/station';
import { buildSky, type Sky } from './world/sky';
import { animateHands, buildHands, createWalker, stepWalker, type Walker } from './modes/walker';

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

export interface EngineState {
  mode: string;
  modeTitle: string;
  prompt: string | null;
  zone: string | null;
  speed: number;
  assist: boolean;
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
  private clock = new THREE.Clock();
  private toast: { text: string; until: number } | null = null;
  private el: HTMLElement;
  /** Per-frame hooks for features: telescope motors, screens, eggs. */
  tickers: ((dt: number, t: number) => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.autoClear = false;
    el.appendChild(this.renderer.domElement);
    this.input = new Input(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(72, el.clientWidth / el.clientHeight, 0.03, 4000);
    this.scene.add(this.camera);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;

    this.sky = buildSky();
    this.station = buildStation();
    this.scene.add(this.station.interior, this.station.exterior);
    this.bodies = new Bodies(this.station.space);
    this.walker = createWalker(this.station.anchors.spawn);
    this.hands = buildHands();
    this.camera.add(this.hands.group);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this.scene.add(this.sun, this.sun.target);
    this.earthlight = new THREE.HemisphereLight(0x1a1630, 0x5d8ad6, 0.45);
    this.scene.add(this.earthlight);
    this.scene.add(new THREE.AmbientLight(0x2a2440, 0.25));

    this.composer = new EffectComposer(this.renderer);
    const skyPass = new RenderPass(this.sky.scene, this.sky.camera);
    const worldPass = new RenderPass(this.scene, this.camera);
    worldPass.clear = false;
    worldPass.clearDepth = true;
    this.composer.addPass(skyPass);
    this.composer.addPass(worldPass);
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

  say(text: string, seconds = 3.5) { this.toast = { text, until: this.t + seconds }; this.emit(true); }

  on(f: (s: EngineState) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  start() { this.clock.start(); this.loop(); }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
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
    stepWalker(w, this.input, dt, this.station.space, this.station.rails, this.bodies, {
      pushOff: () => this.sfx?.('push'),
      grab: () => this.sfx?.('grab'),
      bump: (s) => this.sfx?.('bump', s),
    });
    this.camera.position.copy(w.pos);
    this.camera.quaternion.copy(w.quat);
    this.hands.group.visible = true;
    animateHands(this.hands, w, t);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(w.quat);
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

  /** Sound hook, installed by the audio module. */
  sfx?: (name: string, amount?: number) => void;

  private render(dt: number) {
    const el = this.el;
    // Aboard, the hull's outside faces would wall off every hatch; outside, it is the station.
    this.station.hull.visible = !this.station.space.contains(this.camera.position, 0);
    this.sky.update(this.t, this.camera.getWorldQuaternion(new THREE.Quaternion()), el.clientWidth / el.clientHeight, this.camera.fov);
    // Sunlight through the windows follows the orbit and dies in Earth's shadow.
    this.sun.position.copy(this.camera.position).addScaledVector(this.sky.sunDir, 30);
    this.sun.target.position.copy(this.camera.position);
    this.sun.intensity = 1.6 * this.sky.sunlit;
    this.earthlight.intensity = 0.25 + 0.45 * this.sky.earthDay;
    this.composer.render(dt);
  }

  private emit(force = false) {
    if (!force && this.listeners.size === 0) return;
    this.lastEmit = this.t;
    const w = this.walker;
    const s: EngineState = {
      mode: this.mode.id,
      modeTitle: this.mode.title,
      prompt: this.mode.id === 'walk' && this.focus ? `Press E to ${Interactions.text(this.focus)}` : null,
      zone: this.station.space.zoneOf(w.pos),
      speed: w.vel.length(),
      assist: w.assist,
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private onClick = () => { if (this.mode.id === 'walk' || this.modes.get(this.mode.id)?.id !== 'workstation') this.input.lock(); };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('click', this.onClick);
    this.input.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.el.removeChild(this.renderer.domElement);
  }
}
