// The telescope: a physical instrument in the observation module and a mode
// that looks through it. The view is its own render of the cosmos and the
// near sky (Earth, Moon, Sun) at the eyepiece's field of view, with focus
// blur, a little chromatic fringing and a round eyepiece edge.
//
// Keys: mouse aim, wheel or +/- zoom, [ ] focus, T track, F solar filter,
// C catalog, E or Esc back to zero-g. Gamepad: sticks aim, triggers zoom,
// bumpers focus, X track, Y exit.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glassSmudge, normalFromHeight, pbrSet, scaleUV } from '../world/pbr';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Engine } from '../engine';
import { PAD } from '../core/input';
import { buildCosmos, CATALOG, dirOf, type Target } from '../world/cosmos';
import { EARTH_R, ALTITUDE } from '../world/sky';
import { liveScreen } from '../world/textures';

const BASE_FOV = 50;            // degrees at 1×
const MAX_MAG = 18000;

const EYEPIECE = {
  uniforms: { tDiffuse: { value: null }, uBlur: { value: 0 }, uAspect: { value: 1 }, uGlare: { value: 0 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uBlur; uniform float uAspect; uniform float uGlare; uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      vec2 cc = vec2(c.x * uAspect, c.y);
      float r = length(cc);
      // Focus: a disc kernel, wider the further off focus.
      vec3 col = vec3(0.0);
      float rad = uBlur * 0.012;
      for (int i = 0; i < 16; i++) {
        float a = float(i) * 2.39996;
        float d = sqrt(float(i) / 16.0) * rad;
        vec2 o = vec2(cos(a), sin(a)) * d;
        col += texture2D(tDiffuse, vUv + o / vec2(uAspect, 1.0)).rgb;
      }
      col /= 16.0;
      // A touch of lateral colour toward the edge of the field.
      vec2 dir = c * r * 0.006;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + dir).r, 0.5);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - dir).b, 0.5);
      // The eyepiece: a round field stop with a soft edge, black outside.
      float stop = 1.0 - smoothstep(0.44, 0.47, r);
      col *= stop;
      col += vec3(1.0, 0.97, 0.9) * uGlare * stop;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export interface TelescopeHud {
  mag: number;
  fov: number;
  ra: string;
  dec: string;
  focus: number;
  tracking: boolean;
  filter: boolean;
  target: { id: string; name: string; distance: string; facts: string[]; kind: string; simulated?: boolean; token?: { address: string; symbol: string }; resolved: boolean } | null;
  hint: string | null;
  warning: string | null;
  slewing: boolean;
  catalog: { id: string; name: string; kind: string; found: boolean; hidden: boolean }[];
  /** Whether the Monad token worlds have loaded (they come from the galaxy's Nansen data). */
  tokens: 'loading' | 'ready' | 'unavailable';
}

export interface Telescope {
  slewTo(id: string): void;
  catalogOpen: boolean;
}

export function installTelescope(e: Engine) {
  const a = e.station.anchors;
  const cosmos = buildCosmos();
  // The catalog: the sky's fixed objects, then Monad's token worlds once the galaxy data arrives.
  const catalog: Target[] = [...CATALOG];
  let tokensState: 'loading' | 'ready' | 'unavailable' = 'loading';
  fetch('/api/galaxy').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((g) => { catalog.push(...cosmos.addTokens(g)); e.sky.monad.set(g.planets); tokensState = 'ready'; })
    .catch(() => { tokensState = 'unavailable'; });
  const scopeCam = new THREE.PerspectiveCamera(BASE_FOV, 1, 1, 1e7);
  const skyCam = new THREE.PerspectiveCamera(BASE_FOV, 1, 1, 2e6);

  // ---------- the instrument ----------
  const rig = new THREE.Group();
  rig.position.copy(a.telescopeBase);
  // Anodised aluminium (pearl white), a carbon-fibre tube, matte black baffles, bare brushed steel.
  const white = pbrSet('brushed-aluminium', { color: 0xf1f0ec, normal: 0.55, roughness: 0.8, clearcoat: 0.35, clearcoatRoughness: 0.25 });
  white.color.setRGB(1.65, 1.65, 1.6); white.metalness = 0.22; // pearl-white anodise, not bare metal
  const carbon = pbrSet('carbon-weave', { color: 0xd9dee6, normal: 1.3, roughness: 0.85, clearcoat: 1, clearcoatRoughness: 0.06 });
  const black = pbrSet('rubber', { color: 0x08090b, normal: 1.6, roughness: 1 });
  const metal = pbrSet('brushed-aluminium', { color: 0xc7ccd4, normal: 0.7, roughness: 0.7 });
  const purple = new THREE.MeshStandardMaterial({ color: 0x836ef9, emissive: 0x836ef9, emissiveIntensity: 0.8 });
  const G = <T extends THREE.BufferGeometry>(geo: T, u = 1, v = 1) => scaleUV(geo, u, v);
  /** Engraved setting circle: tick marks every degree, numbers every 30°, filled with black paint, baked normal. */
  const circleTex = (arc: number, labels: number) => {
    const N = 1024;
    const A = document.createElement('canvas'); A.width = A.height = N;
    const B = document.createElement('canvas'); B.width = B.height = N;
    const a = A.getContext('2d')!, h = B.getContext('2d')!;
    a.fillStyle = '#c9ced6'; a.fillRect(0, 0, N, N); h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
    a.translate(N / 2, N / 2); h.translate(N / 2, N / 2);
    const steps = Math.round(arc);
    for (let i = 0; i <= steps; i++) {
      const ang = (i / steps) * (arc >= 360 ? Math.PI * 2 : (arc * Math.PI) / 180) - Math.PI / 2;
      const big = i % 10 === 0, mid = i % 5 === 0;
      const r1 = N * 0.47, r0 = r1 - (big ? 70 : mid ? 46 : 28);
      for (const [g, col, w] of [[a, '#16171b', big ? 5 : 3], [h, '#202020', big ? 6 : 4]] as const) {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0); g.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1); g.stroke();
      }
      if (i % labels === 0) {
        for (const [g, col] of [[a, '#16171b'], [h, '#303030']] as const) {
          g.save(); g.rotate(ang + Math.PI / 2); g.fillStyle = col; g.font = '700 34px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.fillText(String(arc >= 360 ? i % 360 : i), 0, -(r0 - 24)); g.restore();
        }
      }
    }
    const map = new THREE.CanvasTexture(A); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
    const normalMap = new THREE.CanvasTexture(normalFromHeight(B, 3)); normalMap.anisotropy = 16;
    return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.55, metalness: 0.6 });
  };
  const pedestal = new THREE.Mesh(G(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 48), 4, 3), white);
  pedestal.position.y = -0.8;
  rig.add(pedestal);
  for (const y of [-0.3, -1.3]) { // clamp bands with bolts
    const band = new THREE.Mesh(G(new THREE.TorusGeometry(y > -1 ? 0.18 : 0.215, 0.012, 12, 48), 10, 1), metal);
    band.rotation.x = Math.PI / 2; band.position.y = y - 0.0; rig.add(band);
  }
  const footRing = new THREE.Mesh(G(new THREE.TorusGeometry(0.28, 0.03, 16, 48), 12, 1), metal);
  footRing.rotation.x = Math.PI / 2;
  footRing.position.y = -1.48;
  rig.add(footRing);
  const azimuth = new THREE.Group();
  rig.add(azimuth);
  const azGear = new THREE.Mesh(G(new THREE.CylinderGeometry(0.26, 0.26, 0.08, 96), 6, 1), metal);
  azimuth.add(azGear);
  const azScale = new THREE.Mesh(new THREE.RingGeometry(0.11, 0.255, 96), circleTex(360, 30)); // azimuth setting circle
  azScale.rotation.x = -Math.PI / 2; azScale.position.y = 0.0415; azimuth.add(azScale);
  for (let i = 0; i < 48; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.03), metal);
    tooth.position.set(Math.cos(i / 48 * Math.PI * 2) * 0.27, 0, Math.sin(i / 48 * Math.PI * 2) * 0.27);
    tooth.rotation.y = -i / 48 * Math.PI * 2;
    azimuth.add(tooth);
  }
  const altScale = circleTex(90, 10);
  for (const x of [-0.34, 0.34]) {
    const arm = new THREE.Mesh(G(new RoundedBoxGeometry(0.08, 0.7, 0.16, 4, 0.012), 1, 3), white);
    arm.position.set(x, 0.38, 0);
    azimuth.add(arm);
    const motor = new THREE.Mesh(G(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 40), 4, 1), black);
    motor.rotation.z = Math.PI / 2;
    motor.position.set(x * 1.3, 0.62, 0);
    azimuth.add(motor);
    const cap = new THREE.Mesh(G(new THREE.CylinderGeometry(0.072, 0.072, 0.012, 40), 4, 1), metal); // motor end cap
    cap.rotation.z = Math.PI / 2; cap.position.set(x * 1.3 + Math.sign(x) * 0.066, 0.62, 0); azimuth.add(cap);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.13, 64), altScale); // altitude circle on the arm's inner face
    dial.rotation.y = -Math.sign(x) * Math.PI / 2; dial.position.set(x - Math.sign(x) * 0.0425, 0.62, 0); azimuth.add(dial);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    led.position.set(x * 1.3, 0.62, 0.075);
    led.userData.led = true;
    azimuth.add(led);
    for (let k = 0; k < 4; k++) { // bolts through the arm base
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 10), metal);
      bolt.position.set(x, 0.06 + k * 0.0, (k % 2 ? 1 : -1) * 0.055); bolt.position.y = 0.05 + (k > 1 ? 0.05 : 0);
      bolt.rotation.x = Math.PI / 2; bolt.position.x = x + 0.0; bolt.position.z = 0.0816 * (k % 2 ? 1 : -1);
      azimuth.add(bolt);
    }
  }
  const altitude = new THREE.Group();
  altitude.position.y = 0.62;
  azimuth.add(altitude);
  const tube = new THREE.Group();
  altitude.add(tube);
  const ota = new THREE.Mesh(G(new THREE.CylinderGeometry(0.27, 0.27, 2.0, 96, 1, true), 8, 6), carbon);
  ota.rotation.x = Math.PI / 2;
  tube.add(ota);
  const otaIn = new THREE.Mesh(new THREE.CylinderGeometry(0.268, 0.268, 2.0, 48, 1, true), black); // matte baffle inside
  otaIn.material = Object.assign((black as THREE.MeshPhysicalMaterial).clone(), { side: THREE.BackSide });
  otaIn.rotation.x = Math.PI / 2; tube.add(otaIn);
  const dew = new THREE.Mesh(G(new THREE.CylinderGeometry(0.29, 0.29, 0.5, 64, 1, true), 8, 2), black);
  dew.rotation.x = Math.PI / 2;
  dew.position.z = -1.2;
  tube.add(dew);
  const dewIn = new THREE.Mesh(new THREE.CylinderGeometry(0.288, 0.288, 0.5, 48, 1, true), Object.assign((black as THREE.MeshPhysicalMaterial).clone(), { side: THREE.BackSide }));
  dewIn.rotation.x = Math.PI / 2; dewIn.position.z = -1.2; tube.add(dewIn);
  // Coated objective: a deep violet anti-reflection coating under a hard clearcoat.
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.262, 64), new THREE.MeshPhysicalMaterial({ color: 0x0c0a22, roughness: 0.03, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.01, iridescence: 1, iridescenceIOR: 1.38, iridescenceThicknessRange: [180, 420], envMapIntensity: 2.6 }));
  lens.position.z = -1.0;
  lens.rotation.y = Math.PI;
  tube.add(lens);
  const retainer = new THREE.Mesh(G(new THREE.TorusGeometry(0.262, 0.016, 16, 64), 14, 1), metal);
  retainer.position.z = -1.0; tube.add(retainer);
  for (let i = 0; i < 12; i++) { // retainer set screws
    const a = (i / 12) * Math.PI * 2;
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.012, 10), metal);
    sc.position.set(Math.cos(a) * 0.274, Math.sin(a) * 0.274, -1.0 + 0.01); sc.rotation.x = Math.PI / 2; tube.add(sc);
  }
  for (const z of [-0.6, 0.0, 0.6]) {
    const ring = new THREE.Mesh(G(new THREE.TorusGeometry(0.28, 0.022, 16, 64), 14, 1), metal);
    ring.position.z = z;
    tube.add(ring);
  }
  const back = new THREE.Mesh(G(new THREE.CylinderGeometry(0.27, 0.22, 0.2, 64), 6, 1), black);
  back.rotation.x = Math.PI / 2;
  back.position.z = 1.1;
  tube.add(back);
  const focuser = new THREE.Mesh(G(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 40), 3, 1), metal);
  focuser.rotation.x = Math.PI / 2;
  focuser.position.set(0, 0, 1.3);
  tube.add(focuser);
  const focusKnob = new THREE.Mesh(G(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 40), 6, 1), black); // knurled rubber knob
  focusKnob.rotation.z = Math.PI / 2;
  focusKnob.position.set(0.09, 0, 1.3);
  tube.add(focusKnob);
  const diag = new THREE.Mesh(G(new RoundedBoxGeometry(0.08, 0.08, 0.08, 3, 0.01), 1, 1), black);
  diag.position.set(0, 0, 1.43);
  tube.add(diag);
  const eyepiece = new THREE.Mesh(G(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 32), 3, 1), metal);
  eyepiece.position.set(0, 0.09, 1.43);
  tube.add(eyepiece);
  const eyeCup = new THREE.Mesh(G(new THREE.CylinderGeometry(0.036, 0.032, 0.03, 32), 3, 1), black);
  eyeCup.position.set(0, 0.16, 1.43); tube.add(eyeCup);
  const eyeLens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 32), new THREE.MeshPhysicalMaterial({ color: 0x050514, roughness: 0.02, clearcoat: 1, iridescence: 1, envMapIntensity: 2.4 }));
  eyeLens.rotation.x = -Math.PI / 2; eyeLens.position.set(0, 0.176, 1.43); tube.add(eyeLens);
  const finder = new THREE.Mesh(G(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 40), 3, 2), white);
  finder.rotation.x = Math.PI / 2;
  finder.position.set(0, 0.36, -0.2);
  tube.add(finder);
  for (const z of [-0.38, -0.02]) { // finder rings with thumbscrews
    const fr = new THREE.Mesh(G(new THREE.TorusGeometry(0.05, 0.01, 12, 32), 8, 1), metal);
    fr.position.set(0, 0.36, z); tube.add(fr);
    const post = new THREE.Mesh(G(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 12), 1, 1), metal);
    post.position.set(0, 0.31, z); tube.add(post);
  }
  const finderLens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 32), new THREE.MeshPhysicalMaterial({ color: 0x0c0a22, roughness: 0.03, clearcoat: 1, iridescence: 1, envMapIntensity: 2.4 }));
  finderLens.position.set(0, 0.36, -0.451); finderLens.rotation.y = Math.PI; tube.add(finderLens);
  const dovetail = new THREE.Mesh(G(new THREE.BoxGeometry(0.07, 0.025, 1.3), 1, 6), metal); // dovetail bar under the tube
  dovetail.position.set(0, -0.3, 0.1); tube.add(dovetail);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.272, 0.272, 0.05, 64, 1, true), purple);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.z = -0.3;
  tube.add(stripe);
  const readout = liveScreen(256, 96);
  const readoutMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.083), new THREE.MeshBasicMaterial({ map: readout.texture }));
  readoutMesh.position.set(0.28, 0.12, 0.7);
  readoutMesh.rotation.y = Math.PI / 2;
  tube.add(readoutMesh);
  e.station.interior.add(rig);

  // The console beside it: star map, coordinates, status.
  const consoleScreen = liveScreen(640, 400);
  const consoleGroup = new THREE.Group();
  const stand = new THREE.Mesh(G(new THREE.BoxGeometry(0.08, 1.0, 0.08), 1, 5), white);
  stand.position.y = -0.7;
  consoleGroup.add(stand);
  const base = new THREE.Mesh(G(new THREE.CylinderGeometry(0.16, 0.2, 0.04, 48), 4, 1), metal);
  base.position.y = -1.21; consoleGroup.add(base);
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.56, 0.05, 4, 0.012), new THREE.MeshPhysicalMaterial({ color: 0x15171b, roughness: 0.42, metalness: 0.15, clearcoat: 0.3, clearcoatRoughness: 0.35 }));
  consoleGroup.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: consoleScreen.texture }));
  screen.position.z = 0.026;
  consoleGroup.add(screen);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshPhysicalMaterial({ color: 0xcfe2ff, transparent: true, opacity: 0.1, roughness: 1, roughnessMap: glassSmudge(), clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false }));
  cover.position.z = 0.0275; consoleGroup.add(cover);
  const arm = new THREE.Mesh(G(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 20), 1, 1), metal);
  arm.rotation.x = Math.PI / 2; arm.position.z = -0.12; consoleGroup.add(arm);
  consoleGroup.position.set(13.2, 0.1, -1.55);
  consoleGroup.rotation.y = 0.35;
  e.station.interior.add(consoleGroup);

  // ---------- state ----------
  const aimQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0.25, 0).normalize());
  let mag = 1, magTarget = 1, focus = 0.5, tracking = false, filter = false;
  let slew: { from: THREE.Quaternion; to: THREE.Quaternion; t0: number; dur: number; target: Target } | null = null;
  let lastPhase = 0;
  let current: Target | null = null;
  // Whether the current target is in focus and big enough to see: only then is it "observed".
  let resolved = false;
  let hint: string | null = null, warning: string | null = null;
  let mountAz = 0, mountAlt = 0.2;
  const rotZ = new THREE.Vector3(0, 0, 1);

  /** A target's direction in the station frame, now. */
  const stationDir = (t: Target, out: THREE.Vector3) => {
    if (t.kind === 'earth') return out.set(0, -1, 0);
    if (t.kind === 'sun') return out.copy(e.sky.sunDir);
    if (t.kind === 'moon') return e.sky.moon.getWorldPosition(out).normalize();
    if (t.kind === 'token') return out.copy(dirOf(t.lon, t.lat)); // the Monad universe is fixed in the station frame
    return out.copy(dirOf(t.lon, t.lat)).applyAxisAngle(rotZ, e.sky.phase);
  };

  // ---------- rendering through the eyepiece ----------
  const composer = new EffectComposer(e.renderer);
  const cosmosPass = new RenderPass(cosmos.scene, scopeCam);
  const skyPass = new RenderPass(e.sky.scene, skyCam);
  skyPass.clear = false;
  skyPass.clearDepth = true;
  const eyepass = new ShaderPass(EYEPIECE);
  composer.addPass(cosmosPass);
  composer.addPass(skyPass);
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.4, 0.75));
  composer.addPass(eyepass);
  composer.addPass(new OutputPass());
  const resize = () => {
    const w = e.renderer.domElement.clientWidth, h = e.renderer.domElement.clientHeight;
    composer.setSize(w, h);
  };
  resize();
  window.addEventListener('resize', resize);

  const fovNow = () => BASE_FOV / mag;
  /** An upright orientation looking along `dir`. */
  const aimAt = (dir: THREE.Vector3) => new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)));
  const viewDir = new THREE.Vector3();

  const render = (dt: number) => {
    const el = e.renderer.domElement;
    const aspect = el.clientWidth / el.clientHeight;
    // The sky scene has its own camera handling: give it ours.
    e.sky.update(e.t, aimQ, aspect, fovNow());
    e.sky.monad.setMag(mag);
    skyCam.quaternion.copy(aimQ);
    skyCam.fov = fovNow(); skyCam.aspect = aspect;
    skyCam.near = Math.max(1, Math.min(200, ALTITUDE * 0.2));
    skyCam.updateProjectionMatrix();
    scopeCam.quaternion.copy(aimQ);
    scopeCam.fov = fovNow(); scopeCam.aspect = aspect; scopeCam.updateProjectionMatrix();
    cosmos.update(e.t, e.sky.phase, e.sky.sunBase);
    const off = current ? Math.abs(focus - current.focus) : Math.abs(focus - 0.75);
    eyepass.uniforms.uBlur.value = Math.min(1, off * 6);
    eyepass.uniforms.uAspect.value = aspect;
    // Looking at the Sun without the filter: the field washes out.
    stationDir(CATALOG.find((t) => t.id === 'sun')!, viewDir);
    const sunAngle = THREE.MathUtils.radToDeg(viewDir.angleTo(new THREE.Vector3(0, 0, -1).applyQuaternion(aimQ)));
    const glare = !filter && e.sky.sunlit > 0.2 ? THREE.MathUtils.clamp(1 - (sunAngle - fovNow() * 0.5) / 3, 0, 1) : 0;
    eyepass.uniforms.uGlare.value = glare;
    e.sky.sun.mat.uniforms.uTime.value = e.t;
    // The filter dims the Sun to something you could look at.
    (e.sky.sun.group.children[0] as THREE.Mesh).visible = true;
    e.sky.sun.group.children.slice(1).forEach((c) => { c.visible = !filter; });
    composer.render(dt);
    return true;
  };

  // ---------- the mode ----------
  const look = new THREE.Vector3();
  e.addMode({
    id: 'telescope',
    title: 'Telescope',
    enter: () => {
      e.hands.group.visible = false;
      e.renderOverride = render;
      e.input.lock();
      lastPhase = e.sky.phase;
      e.sfx?.('motor-start');
      if (e.log.add('telescope-first', 'discovery', 'First light', 'The observation telescope is yours. Scroll to zoom, [ and ] to focus, T to track.')) e.say('Telescope online. Scroll to zoom, [ ] to focus.');
    },
    exit: () => {
      e.renderOverride = null;
      e.sky.monad.setMag(1);
      e.sky.sun.group.children.forEach((c) => { c.visible = true; });
      e.hands.group.visible = true;
      e.sfx?.('motor-stop');
    },
    update: (dt, t) => {
      const inp = e.input;
      const fov = fovNow();
      // Aim: sensitivity scales with the field, so fine work stays fine.
      const k = THREE.MathUtils.degToRad(fov) / 700;
      const yaw = -inp.mouseDX * k - inp.axis(0) * fov * 0.02 * dt - inp.axis(2) * fov * 0.02 * dt;
      const pitch = -inp.mouseDY * k - inp.axis(1) * fov * 0.02 * dt - inp.axis(3) * fov * 0.02 * dt;
      const keyYaw = ((inp.down('ArrowLeft', 'KeyA') ? 1 : 0) - (inp.down('ArrowRight', 'KeyD') ? 1 : 0)) * THREE.MathUtils.degToRad(fov) * 0.6 * dt;
      const keyPitch = ((inp.down('ArrowUp', 'KeyW') ? 1 : 0) - (inp.down('ArrowDown', 'KeyS') ? 1 : 0)) * THREE.MathUtils.degToRad(fov) * 0.6 * dt;
      if (yaw || pitch || keyYaw || keyPitch) {
        slew = null;
        aimQ.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + keyYaw));
        aimQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch + keyPitch));
      }
      // Tracking: follow the inertial sky as the station turns.
      const dPhase = e.sky.phase - lastPhase;
      lastPhase = e.sky.phase;
      if (tracking && !slew && current?.kind !== 'token') aimQ.premultiply(new THREE.Quaternion().setFromAxisAngle(rotZ, dPhase));
      // Zoom: damped and logarithmic.
      if (inp.wheel) magTarget *= Math.pow(1.25, -inp.wheel);
      if (inp.down('Equal', 'NumpadAdd') || inp.pad.buttons[PAD.RT]) magTarget *= Math.exp(1.6 * dt);
      if (inp.down('Minus', 'NumpadSubtract') || inp.pad.buttons[PAD.LT]) magTarget *= Math.exp(-1.6 * dt);
      magTarget = THREE.MathUtils.clamp(magTarget, 1, MAX_MAG);
      mag = Math.exp(THREE.MathUtils.lerp(Math.log(mag), Math.log(magTarget), 1 - Math.exp(-5 * dt)));
      if (inp.down('BracketLeft') || inp.padDown(PAD.LB)) focus = Math.max(0, focus - 0.18 * dt);
      if (inp.down('BracketRight') || inp.padDown(PAD.RB)) focus = Math.min(1, focus + 0.18 * dt);
      if (inp.hit('KeyT') || inp.padHit(PAD.X)) { tracking = !tracking; e.sfx?.('click'); }
      if (inp.hit('KeyF')) { filter = !filter; e.sfx?.('click'); }
      if (inp.hit('KeyC')) api.catalogOpen = !api.catalogOpen;
      // The catalog is clicked with a free mouse pointer.
      if (api.catalogOpen && inp.locked) inp.unlock();
      // Slewing: the motors drive toward a catalog target.
      if (slew) {
        // The sky turns while the motors run: chase the target's live position.
        slew.to.copy(aimAt(stationDir(slew.target, new THREE.Vector3())));
        const k2 = Math.min(1, (t - slew.t0) / slew.dur);
        const ease = k2 < 0.5 ? 2 * k2 * k2 : 1 - Math.pow(-2 * k2 + 2, 2) / 2;
        aimQ.slerpQuaternions(slew.from, slew.to, ease);
        if (k2 >= 1) { slew = null; tracking = true; e.sfx?.('motor-stop'); }
      }

      // What is in the middle of the field?
      look.set(0, 0, -1).applyQuaternion(aimQ);
      current = null; hint = null; warning = null; resolved = false;
      let best = Infinity;
      const dir = new THREE.Vector3();
      for (const target of catalog) {
        stationDir(target, dir);
        const ang = THREE.MathUtils.radToDeg(dir.angleTo(look));
        const radius = target.kind === 'earth' ? THREE.MathUtils.radToDeg(Math.asin(EARTH_R / (EARTH_R + ALTITUDE))) : target.size / 2;
        if (ang < Math.max(radius, fov * 0.12) && ang < best) { best = ang; current = target; }
      }
      // Earth stands in front of anything below its limb.
      const earthAngle = THREE.MathUtils.radToDeg(look.angleTo(new THREE.Vector3(0, -1, 0)));
      const earthLimb = THREE.MathUtils.radToDeg(Math.asin(EARTH_R / (EARTH_R + ALTITUDE)));
      if (current && current.kind !== 'earth' && earthAngle < earthLimb) {
        warning = `${current.name} is behind Earth right now. Wait for the orbit to carry it clear.`;
        current = catalog[0];
      }
      if (current) {
        const sizeInField = current.kind === 'earth' ? 1 : current.size / fov;
        const sharp = Math.abs(focus - current.focus) < 0.08;
        if (current.kind === 'sun' && !filter) warning = 'Solar filter required. Press F before looking at the Sun.';
        else if (sizeInField < 0.04 && current.kind !== 'star') hint = `Zoom in on ${current.name}`;
        else if (!sharp) hint = `Adjust focus ([ ]) to resolve ${current.name}`;
        else {
          resolved = true;
          if (e.log.add(`seen-${current.id}`, 'discovery', current.name, current.facts[0])) { e.say(`✦ Discovered: ${current.name}`); e.sfx?.('discover'); }
        }
      }
      // A resolved token world becomes what the crew is researching; from the
      // eyepiece it can go straight to the PC dossier or the flight planner.
      if (resolved && current?.token) {
        const tk = current.token;
        e.setSubject({ kind: 'token', address: tk.address, label: `$${tk.symbol}`, source: 'telescope' });
        if (inp.hit('KeyP')) { e.setMode('pc'); return; }
        if (inp.hit('KeyB')) { e.setMode('shuttle'); return; }
      }

      // The instrument follows the aim, so it visibly slews.
      const local = look.clone();
      const wantAz = Math.atan2(local.x, -local.z) - Math.PI / 2;
      const wantAlt = Math.asin(THREE.MathUtils.clamp(local.y, -1, 1));
      const dAz = Math.atan2(Math.sin(wantAz - mountAz), Math.cos(wantAz - mountAz));
      const speed = Math.abs(dAz) + Math.abs(wantAlt - mountAlt);
      mountAz += dAz * (1 - Math.exp(-3 * dt));
      mountAlt += (THREE.MathUtils.clamp(wantAlt, -0.9, 1.2) - mountAlt) * (1 - Math.exp(-3 * dt));
      if (speed > 0.01) e.sfx?.('motor', speed);
      // Keep the physical camera at the eyepiece.
      e.camera.position.copy(a.telescopeEye);
      void dt;
    },
    hud: (): Record<string, unknown> => {
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(aimQ).applyAxisAngle(rotZ, -e.sky.phase);
      const ra = ((Math.atan2(-lookDir.z, lookDir.x) * 12 / Math.PI) + 24) % 24;
      const dec = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(lookDir.y, -1, 1)));
      const fmt = (h: number) => `${Math.floor(h)}h ${Math.floor((h % 1) * 60).toString().padStart(2, '0')}m`;
      const hud: TelescopeHud = {
        mag, fov: fovNow(), ra: fmt(ra), dec: `${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(2)}°`, focus, tracking, filter,
        target: current ? { id: current.id, name: current.name, distance: current.distance, facts: current.facts, kind: current.kind, simulated: current.simulated, token: current.token ? { address: current.token.address, symbol: current.token.symbol } : undefined, resolved } : null,
        hint, warning, slewing: !!slew,
        catalog: catalog.map((c) => ({ id: c.id, name: c.name, kind: c.kind, found: e.log.has(`seen-${c.id}`), hidden: false })),
        tokens: tokensState,
      };
      return { telescope: hud, catalogOpen: api.catalogOpen };
    },
  });

  const api: Telescope = {
    catalogOpen: false,
    slewTo(id: string) {
      const target = catalog.find((c) => c.id === id);
      if (!target) return;
      const to = aimAt(stationDir(target, new THREE.Vector3()));
      const angle = aimQ.angleTo(to);
      slew = { from: aimQ.clone(), to, t0: e.t, dur: 0.8 + angle * 1.2, target };
      // Pick a magnification that frames it.
      const fit = target.kind === 'earth' ? 1 : THREE.MathUtils.clamp(BASE_FOV / (target.size * 2.2), 1, MAX_MAG);
      magTarget = Math.min(fit, target.kind === 'star' ? 300 : fit);
      api.catalogOpen = false;
      e.sfx?.('motor-start');
    },
  };
  (e as unknown as { telescope: Telescope }).telescope = api;
  if (process.env.NODE_ENV !== 'production') (e as unknown as { telescopeDebug: unknown }).telescopeDebug = { composer, cosmos, scopeCam, skyCam, eyepass, aimQ };

  // ---------- screens and motors, every frame ----------
  let screenT = 0;
  e.tickers.push((dt, t) => {
    azimuth.rotation.y = mountAz;
    altitude.rotation.x = mountAlt;
    for (const c of azimuth.children) if (c.userData.led) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(slew ? 0xf59e0b : tracking ? 0x22c55e : 0x836ef9);
    screenT += dt;
    if (screenT < 0.25) return;
    screenT = 0;
    // The tube's digital readout.
    const r = readout.g;
    r.fillStyle = '#05030d'; r.fillRect(0, 0, 256, 96);
    r.fillStyle = '#c4b5fd'; r.font = 'bold 22px monospace';
    r.fillText(`${Math.round(mag)}×`, 12, 34);
    r.fillStyle = tracking ? '#4ade80' : '#a39cc4'; r.font = '16px monospace';
    r.fillText(tracking ? 'TRACKING' : slew ? 'SLEWING' : 'IDLE', 12, 64);
    r.fillText(`F ${(focus * 100).toFixed(0)}`, 150, 64);
    readout.texture.needsUpdate = true;
    // The console: catalogue map around the current aim.
    const g = consoleScreen.g;
    g.fillStyle = '#07041a'; g.fillRect(0, 0, 640, 400);
    g.strokeStyle = 'rgba(131,110,249,0.35)'; g.lineWidth = 1;
    for (let i = 1; i < 6; i++) { g.beginPath(); g.arc(200, 200, i * 34, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(200, 20); g.lineTo(200, 380); g.moveTo(20, 200); g.lineTo(380, 200); g.stroke();
    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(aimQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aimQ), up = new THREE.Vector3(0, 1, 0).applyQuaternion(aimQ);
    const dir = new THREE.Vector3();
    for (const c of catalog) {
      stationDir(c, dir);
      if (dir.dot(lookDir) < 0.3) continue;
      const x = 200 + dir.dot(right) * 260, y = 200 - dir.dot(up) * 260;
      g.fillStyle = e.log.has(`seen-${c.id}`) ? '#f5c542' : '#c4b5fd';
      g.beginPath(); g.arc(x, y, c.kind === 'sun' ? 7 : 4, 0, Math.PI * 2); g.fill();
      g.font = '12px monospace'; g.fillText(c.name.split(' (')[0], x + 7, y + 4);
    }
    g.strokeStyle = '#f5c542'; g.lineWidth = 2; g.strokeRect(194, 194, 12, 12);
    g.fillStyle = '#efeaff'; g.font = 'bold 18px monospace'; g.fillText('OBSERVATION', 410, 40);
    g.font = '14px monospace'; g.fillStyle = '#a39cc4';
    const h = (api as unknown as { _hud?: TelescopeHud })._hud;
    void h;
    g.fillText(`MAG   ${Math.round(mag)}×`, 410, 80);
    g.fillText(`FOV   ${fovNow() < 1 ? (fovNow() * 60).toFixed(1) + "'" : fovNow().toFixed(1) + '°'}`, 410, 104);
    g.fillText(`FOCUS ${(focus * 100).toFixed(0)}`, 410, 128);
    g.fillText(`TRACK ${tracking ? 'ON' : 'OFF'}`, 410, 152);
    g.fillText(`FILTER ${filter ? 'IN' : 'OUT'}`, 410, 176);
    g.fillStyle = '#f5c542'; g.font = 'bold 15px monospace';
    g.fillText((current?.name ?? 'No target').slice(0, 24), 410, 220);
    g.fillStyle = '#a39cc4'; g.font = '12px monospace';
    g.fillText(`${e.log.entries.filter((x) => x.id.startsWith('seen-')).length}/${catalog.length} catalogued`, 410, 244);
    consoleScreen.texture.needsUpdate = true;
  });

  // ---------- the interaction ----------
  e.interactions.add({ id: 'telescope', label: 'use telescope', position: a.telescopeEye.clone().add(new THREE.Vector3(0.6, -0.2, 0)), reach: 2.4, use: () => e.setMode('telescope') });
  e.interactions.add({ id: 'telescope-console', label: 'use telescope', position: consoleGroup.position.clone(), reach: 1.8, use: () => e.setMode('telescope') });

  return () => { window.removeEventListener('resize', resize); composer.dispose(); };
}
