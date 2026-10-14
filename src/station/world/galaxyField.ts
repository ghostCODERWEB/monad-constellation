// The real Monad universe, seen from the station: the same galaxy you fly through
// in the Constellation, laid out by the same rules from the same Nansen data:
// MON at the heart, every token a world on the two-armed spiral (biggest markets
// nearest the sun) with its real biome, rings and holder-moons, every wallet a
// star orbiting its token, and the dust of the spiral arms. It hangs far off, fixed in the
// station frame, in the great window's direction, and the telescope zooms into the
// very same worlds. Worlds are placed at their true angular sizes (a token a
// fraction of a degree across), so the window shows the galaxy and the eyepiece
// shows each world's surface.
import * as THREE from 'three';
import { buildMoon, buildSun, buildWorld, type World } from '@/components/worlds';
import { dirOf } from './cosmos';
import { KIND } from '@/components/GalaxyScene';
import { S, STAR_FS, STAR_VS, rng, type Orbit } from '@/components/galaxyShared';
import { worldStyle } from '@/lib/worldStyle';
import { moonsOf } from '@/lib/moons';
import type { Galaxy } from '@/lib/galaxy';
import { UNIVERSES, type UniverseId } from '@/lib/universes';

/**
 * Where each universe hangs in the sky (station frame: +x is the great window, longitude turns toward −z).
 * Majors sits dead ahead; the others fan out either side, so the window shows a couple and the telescope can
 * swing round to the rest.
 */
export const UNIVERSE_SKY: Record<UniverseId, { lon: number; lat: number; radius: number }> = {
  majors: { lon: 4.5, lat: 9, radius: 17 },
  rwa: { lon: 42, lat: 5, radius: 17 },
  memes: { lon: -34, lat: 14, radius: 15 },
  stables: { lon: 82, lat: 16, radius: 16 },
  defi: { lon: -76, lat: 4, radius: 17 },
};
export const universeCenter = (u: UniverseId) => dirOf(UNIVERSE_SKY[u].lon, UNIVERSE_SKY[u].lat);

export interface FieldInfo { id: UniverseId; name: string; color: string; dir: THREE.Vector3; angularRadius: number }

export interface FieldWorld {
  universe: UniverseId;
  /** Index into galaxy.planets. */
  index: number;
  /** World-space centre and radius in the sky scene. */
  center: THREE.Vector3;
  radius: number;
  /** Unit direction from the station and apparent diameter, degrees. */
  dir: THREE.Vector3;
  sizeDeg: number;
}

export interface GalaxyField {
  info: FieldInfo;
  group: THREE.Group;
  /** Build the galaxy from the Nansen data; returns where each world sits. Safe to call once. */
  load(galaxy: Galaxy): FieldWorld[];
  update(time: number): void;
}

const GALAXY_RADIUS = 1000;          // the spiral's reach, in galaxy units
const SUN_R = 30;

function soft() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function buildGalaxyField(distance: number, universe: UniverseId): GalaxyField {
  const group = new THREE.Group();
  group.name = `universe-${universe}`;
  const place = UNIVERSE_SKY[universe];
  const dir0 = universeCenter(universe);
  const k = (distance * Math.tan(THREE.MathUtils.degToRad(place.radius))) / GALAXY_RADIUS; // metres of sky per galaxy unit
  const C = dir0.clone().multiplyScalar(distance);
  // Turn the galaxy so we look at it from above and in front, as the Constellation's opening view does.
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0.5, 0.87).normalize(), dir0.clone().negate());
  const toSky = (v: THREE.Vector3, out = new THREE.Vector3()) => out.copy(v).multiplyScalar(k).applyQuaternion(q).add(C);

  const sunPos = { value: C.clone() };
  const fixed = new THREE.Group();   // worlds, moons, sun: placed in sky coordinates
  const scaled = new THREE.Group();  // stars and dust: drawn through the galaxy's own transform
  scaled.position.copy(C); scaled.quaternion.copy(q); scaled.scale.setScalar(k);
  group.add(fixed, scaled);
  const sun = buildSun(SUN_R * k);
  sun.group.position.copy(C);
  sun.light.intensity = 0;
  fixed.add(sun.group);

  const worlds: World[] = [];
  const spins: number[] = [];
  const moons: { mesh: THREE.Mesh; planet: number; orbitR: number; tilt: number; node: number; phase: number; speed: number }[] = [];
  const starUniforms = { uTime: { value: 0 }, uPixel: { value: Math.min(window.devicePixelRatio, 2) }, uFocus: { value: -1 }, uScale: { value: (S * distance) / 1140 } };
  let loaded = false;
  let planetPos: THREE.Vector3[] = [];
  let planetR: number[] = [];

  const load = (galaxy: Galaxy): FieldWorld[] => {
    if (loaded) return [];
    loaded = true;
    const P = galaxy.planets.length;
    const order = galaxy.planets.map((_, i) => i).sort((a, b) => (galaxy.planets[b].marketCap ?? 0) - (galaxy.planets[a].marketCap ?? 0));
    planetPos = new Array(P); planetR = new Array(P);
    const rp = rng(42);
    const out: FieldWorld[] = [];
    order.forEach((pi, rank) => {
      const p = galaxy.planets[pi];
      const t = (rank + 1) / (order.length + 1);
      const arm = rank % 2, rad = (24 + t * 140) * S, ang = arm * Math.PI + t * 4.2;
      planetPos[pi] = new THREE.Vector3(Math.cos(ang) * rad, (rp() - 0.5) * 4 * S, Math.sin(ang) * rad);
      planetR[pi] = (1.3 + Math.max(0, Math.log10(Math.max(1e4, p.marketCap ?? 1e4)) - 4) * 0.72) * S;
      const style = worldStyle(p);
      const center = toSky(planetPos[pi]);
      const R = planetR[pi] * k;
      const w = buildWorld(style, R, center, sunPos, p.smartHolders > 0);
      worlds[pi] = w; spins[pi] = style.spin;
      fixed.add(w.group);
      const dir = center.clone().normalize();
      out.push({ universe, index: pi, center, radius: R, dir, sizeDeg: THREE.MathUtils.radToDeg(2 * Math.atan(R / center.length())) });
    });

    // Moons: each world's biggest real holders (same seeds as the Constellation).
    const rm = rng(99);
    const moonOf = new Set<number>();
    for (let pi = 0; pi < P; pi++) {
      moonsOf(galaxy, pi).forEach((m, j) => {
        const s = galaxy.stars[m.star];
        const r = planetR[pi] * Math.min(0.26, 0.07 + Math.sqrt(m.share) * 0.45);
        const mesh = buildMoon(r * k, KIND[s.kind].color, rm() * 50, sunPos);
        fixed.add(mesh);
        moons.push({
          mesh, planet: pi, orbitR: planetR[pi] * (2.9 + j * 1.1 + rm() * 0.3),
          tilt: (rm() - 0.5) * 0.5, node: rm() * Math.PI * 2, phase: rm() * Math.PI * 2, speed: (0.05 + rm() * 0.05) * (rm() < 0.5 ? 1 : -1),
        });
        moonOf.add(m.star);
      });
    }

    // Wallet stars: every wallet orbits the token it is most tied to, exactly as in the Constellation.
    const N = galaxy.stars.length;
    const aCenter = new Float32Array(N * 3), aRadius = new Float32Array(N), aTilt = new Float32Array(N * 2);
    const aPhase = new Float32Array(N), aSpeed = new Float32Array(N), aSize = new Float32Array(N);
    const aColor = new Float32Array(N * 3), aBright = new Float32Array(N), aHome = new Float32Array(N * 2);
    const rs = rng(1234);
    galaxy.stars.forEach((s, i) => {
      const links = [...s.links].sort((a, b) => (b.holdingUsd + b.boughtUsd + b.soldUsd) - (a.holdingUsd + a.boughtUsd + a.soldUsd));
      const home = s.home;
      const second = links.find((l) => l.p !== home)?.p ?? -1;
      let center: THREE.Vector3, radius: number;
      if (second >= 0) {
        const kk = 0.3 + rs() * 0.4;
        center = planetPos[home].clone().lerp(planetPos[second], kk);
        center.y += (rs() - 0.5) * 4 * S;
        radius = (1.5 + rs() * 4) * S;
      } else {
        center = planetPos[home].clone();
        const share = links[0]?.share ?? 0;
        radius = planetR[home] * 2.4 + (1 - Math.min(1, Math.sqrt(share) * 3)) * (6 + rs() * 10) * S * 0.8 + rs() * 2 * S;
      }
      const o: Orbit = { center, radius, tiltX: (rs() - 0.5) * 1.1, tiltY: rs() * Math.PI * 2, phase: rs() * Math.PI * 2, speed: (0.6 / Math.sqrt(radius / S)) * (rs() < 0.5 ? 1 : -1) * 0.2 };
      aCenter.set([center.x, center.y, center.z], i * 3);
      aRadius[i] = radius; aTilt.set([o.tiltX, o.tiltY], i * 2);
      aPhase[i] = o.phase; aSpeed[i] = o.speed;
      const isMoon = moonOf.has(i);
      aSize[i] = isMoon ? 0 : 0.9 + s.brightness * 2.6 + (s.kind === 'smart' ? 1.5 : 0);
      const col = new THREE.Color(KIND[s.kind].color);
      aColor.set([col.r, col.g, col.b], i * 3);
      aBright[i] = isMoon ? 0 : s.kind === 'contract' ? 0.5 : 0.7 + s.brightness * 0.9;
      aHome.set([home, second], i * 2);
    });
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const attr = (n: string, a: Float32Array, kk: number) => starGeo.setAttribute(n, new THREE.BufferAttribute(a, kk));
    attr('aCenter', aCenter, 3); attr('aRadius', aRadius, 1); attr('aTilt', aTilt, 2); attr('aPhase', aPhase, 1);
    attr('aSpeed', aSpeed, 1); attr('aSize', aSize, 1); attr('aColor', aColor, 3); attr('aBright', aBright, 1); attr('aHome', aHome, 2);
    const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    stars.frustumCulled = false;
    scaled.add(stars);

    // Arm dust, as in the Constellation: faint purple and gold along the two spiral arms.
    const r0 = rng(7);
    const dustN = 32000;
    const dustPos = new Float32Array(dustN * 3), dustCol = new Float32Array(dustN * 3);
    const purple = new THREE.Color('#6d5bd0'), gold = new THREE.Color('#b08a3a'), c = new THREE.Color();
    for (let i = 0; i < dustN; i++) {
      const arm = i % 2, t = Math.pow(r0(), 0.7), rad = (8 + t * 160) * S;
      const ang = arm * Math.PI + t * 4.2 + (r0() - 0.5) * (0.9 - t * 0.4);
      const spread = (3 + t * 14) * S;
      dustPos[i * 3] = Math.cos(ang) * rad + (r0() - 0.5) * spread;
      dustPos[i * 3 + 1] = (r0() - 0.5) * (6 - t * 3) * S * (r0() < 0.1 ? 3 : 1);
      dustPos[i * 3 + 2] = Math.sin(ang) * rad + (r0() - 0.5) * spread;
      c.copy(purple).lerp(gold, r0() * 0.35 * (1 - t));
      dustCol.set([c.r, c.g, c.b], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.6 * S * k, map: soft(), vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    dust.frustumCulled = false;
    scaled.add(dust);
    return out;
  };

  const tmp = new THREE.Vector3();
  const update = (time: number) => {
    sun.mat.uniforms.uTime.value = time;
    starUniforms.uTime.value = time;
    worlds.forEach((w, i) => {
      if (!w) return;
      w.spinner.rotation.y = time * spins[i];
      w.surfaceMat.uniforms.uTime.value = time;
      w.cloudMat.uniforms.uTime.value = time;
    });
    for (const m of moons) {
      const a = m.phase + time * m.speed;
      let x = Math.cos(a) * m.orbitR, y = 0, z = Math.sin(a) * m.orbitR;
      const ct = Math.cos(m.tilt), st = Math.sin(m.tilt);
      [y, z] = [y * ct - z * st, y * st + z * ct];
      const cn = Math.cos(m.node), sn = Math.sin(m.node);
      [x, z] = [x * cn + z * sn, -x * sn + z * cn];
      toSky(tmp.set(planetPos[m.planet].x + x, planetPos[m.planet].y + y, planetPos[m.planet].z + z), m.mesh.position);
    }
  };

  const def = UNIVERSES.find((u) => u.id === universe)!;
  return { info: { id: universe, name: def.name, color: def.color, dir: dir0, angularRadius: place.radius }, group, load, update };
}
