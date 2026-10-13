// The view from the windows: Earth turning below, the Moon, the Sun and the
// deep sky. Rendered as its own scene in kilometres, behind the station, with
// a camera that shares the player's orientation but not their position, so a
// 6371 km planet and a 2 m corridor never fight over depth precision.
//
// Earth is procedural (no texture assets ship with this project): the same
// terrain, cloud and scattering shaders as the galaxy's worlds, tuned to an
// Earth palette and a thin, realistic atmosphere.
import * as THREE from 'three';
import { buildMoon, buildSun, buildWorld, type World } from '@/components/worlds';
import type { WorldStyle } from '@/lib/worldStyle';
import { buildGalaxyField, type GalaxyField } from './galaxyField';

export const EARTH_R = 6371;
export const ALTITUDE = 420;
/** One orbit in real seconds: accelerated (the real ISS takes 92 minutes) so sunrise comes often. */
export const ORBIT_SECONDS = 20 * 60;

const EARTH_STYLE: WorldStyle = {
  biome: 'terra', biomeName: 'Earth', why: '', sea: 0.53, oceanPct: 71, oceanWhy: '', clouds: 0.44, weather: '',
  city: 0.75, settlements: 0, rough: 0.7, lava: 0, ice: 0.72, seed: 17.3, spin: 0, tilt: 0,
  palette: {
    deep: '#06204a', shallow: '#0f5d8f', sand: '#c8b68a', low: '#3c6b2f', high: '#6e5f45', peak: '#a59f96', snow: '#f4f7fb',
    lava: '#000000', day: '#5d9bff', dusk: '#ff8a4c', rim: '#8fc4ff', cloud: '#ffffff',
  },
};

export interface Sky {
  scene: THREE.Scene;
  /** The inertial frame: stars and the Moon. Turns once per orbit as seen from the station. */
  inertial: THREE.Group;
  /** Orbital phase, radians. */
  phase: number;
  /** The Sun's direction in the inertial frame (fixed). */
  sunBase: THREE.Vector3;
  camera: THREE.PerspectiveCamera;
  earth: World;
  /** The Earth's frame: rotating it carries the ground beneath the station. */
  earthPivot: THREE.Group;
  moon: THREE.Mesh;
  /** The distant Monad universe, fixed in the station frame, in view through the observation room's great window. */
  monad: GalaxyField;
  sun: ReturnType<typeof buildSun>;
  sunPos: { value: THREE.Vector3 };
  /** Unit vector from the station toward the Sun, in station space. */
  sunDir: THREE.Vector3;
  /** 0 in Earth's shadow, 1 in full sun. */
  sunlit: number;
  /** How much of Earth below is day: drives the blue Earthlight. */
  earthDay: number;
  update(t: number, camQuat: THREE.Quaternion, aspect: number, fov: number): void;
}

function soft() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function buildSky(): Sky {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(70, 1, 5, 2_000_000);

  // Stars: colour by temperature, a band of Milky Way along a great circle.
  const N = 14000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const band = new THREE.Vector3(0.3, 0.9, 0.3).normalize();
  for (let i = 0; i < N; i++) {
    let v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    if (i < N * 0.45) v.addScaledVector(band, -v.dot(band) * (0.85 + r() * 0.15)).normalize();
    v = v.multiplyScalar(900_000);
    pos.set([v.x, v.y, v.z], i * 3);
    const t = r();
    c.setHSL(t < 0.15 ? 0.05 : t < 0.3 ? 0.13 : 0.6, t < 0.6 ? 0.55 : 0.15, 0.62 + r() * 0.35);
    const b = 0.25 + Math.pow(r(), 3) * 1.4;
    col.set([c.r * b, c.g * b, c.b * b], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const inertial = new THREE.Group();
  scene.add(inertial);
  inertial.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.8, sizeAttenuation: false, vertexColors: true, map: soft(), transparent: true, depthWrite: false })));

  const monad = buildGalaxyField(120_000);
  scene.add(monad.group);

  // Sun and Moon: placed to show their true apparent sizes (about half a degree).
  const sunPos = { value: new THREE.Vector3() };
  const sun = buildSun(1300);
  sun.light.intensity = 0;
  scene.add(sun.group);
  const moon = buildMoon(270, '#c8c8d0', 7, sunPos);
  inertial.add(moon);
  moon.position.set(-30_000, 22_000, -45_000);

  // Earth hangs below; its frame turns to carry continents under the station.
  const earthPivot = new THREE.Group();
  earthPivot.position.set(0, -(EARTH_R + ALTITUDE), 0);
  scene.add(earthPivot);
  const earth = buildWorld(EARTH_STYLE, EARTH_R, new THREE.Vector3(0, -(EARTH_R + ALTITUDE), 0), sunPos, false, 1.022);
  // buildWorld places its group at the centre; parent it to the pivot instead.
  earth.group.position.set(0, 0, 0);
  earthPivot.add(earth.group);
  earth.spinner.rotation.y = 1.2;

  const sunDir = new THREE.Vector3();
  const sunBase = new THREE.Vector3(0.92, 0, 0.39).normalize();
  const sky: Sky = {
    scene, inertial, phase: 0, sunBase, camera, earth, earthPivot, moon, monad, sun, sunPos, sunDir, sunlit: 1, earthDay: 1,
    update(t, camQuat, aspect, fov) {
      // The orbit: the Sun swings round the station once per orbit, and the
      // ground beneath slides past at the same rate.
      // Start with the Sun overhead and lit; it swings past the great window (and the Monad universe) only late in the orbit.
      const phase = (t / ORBIT_SECONDS) * Math.PI * 2 + Math.PI / 2;
      sky.phase = phase;
      inertial.rotation.z = phase;
      sunDir.copy(sunBase).applyAxisAngle(new THREE.Vector3(0, 0, 1), phase);
      // Keep the Sun overhead-ish at the start so the first view is lit.
      sunPos.value.copy(sunDir).multiplyScalar(140_000);
      sun.group.position.copy(sunPos.value);
      earthPivot.rotation.z = -phase * 0.25;
      earth.spinner.rotation.y = 1.2 + t * 0.002;
      earth.clouds.rotation.y += 0.00002;

      // Eclipse: is the Sun behind Earth, as seen from the station?
      const toEarth = new THREE.Vector3(0, -1, 0);
      const earthAngular = Math.asin(EARTH_R / (EARTH_R + ALTITUDE));
      const ang = Math.acos(THREE.MathUtils.clamp(sunDir.dot(toEarth), -1, 1));
      sky.sunlit = THREE.MathUtils.smoothstep(ang, earthAngular - 0.02, earthAngular + 0.03);
      sky.earthDay = THREE.MathUtils.clamp(0.5 + sunDir.y * 0.8, 0, 1);

      for (const m of [earth.surfaceMat, earth.cloudMat]) m.uniforms.uTime.value = t;
      earth.atmoMat.side = THREE.FrontSide;
      sun.mat.uniforms.uTime.value = t;
      monad.update(t);
      camera.quaternion.copy(camQuat);
      camera.aspect = aspect;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
  // Earth's uniforms need its world centre after re-parenting.
  const centre = new THREE.Vector3(0, -(EARTH_R + ALTITUDE), 0);
  earth.surfaceMat.uniforms.uCenter.value.copy(centre);
  earth.atmoMat.uniforms.uCenter.value.copy(centre);
  return sky;
}
