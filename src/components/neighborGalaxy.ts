// A neighbouring universe, drawn in the same space as the active one: its sun,
// its token worlds, its wallets as a star cloud and its arm dust, all with the
// exact layout the full scene uses. Fly into it and that universe becomes the
// active one with nothing moving, so the cosmos reads as one open world.
// It is a view, not an interactive galaxy: picking, dossiers and trade comets
// belong to the active universe.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Galaxy, StarKind } from '@/lib/galaxy';
import type { UniverseDef } from '@/lib/universes';
import { worldStyle, type WorldStyle } from '@/lib/worldStyle';
import { S, STAR_FS, STAR_VS, dustDisc, layoutPlanets, layoutStarOrbits } from './galaxyShared';
import { buildSun, buildWorld, type Sun, type World } from './worlds';

export interface Neighbor {
  id: string;
  root: THREE.Group;
  /** Sun position in the active scene's frame. */
  center: THREE.Vector3;
  update(time: number, dt: number, reduced: boolean): void;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

export function buildNeighbor(
  galaxy: Galaxy, def: UniverseDef, offset: THREE.Vector3, opts: { soft: THREE.Texture; pixelRatio: number; kindColor: (k: StarKind) => string },
): Neighbor {
  const root = new THREE.Group();
  root.name = `neighbor-${def.id}`;
  const sunPos = { value: offset.clone() };

  const sun: Sun = buildSun(30);
  sun.group.position.copy(offset);
  root.add(sun.group);

  // Worlds are lit in world space, so they are built at absolute positions.
  const { pos, radius } = layoutPlanets(galaxy);
  const worlds: World[] = [], styles: WorldStyle[] = [];
  galaxy.planets.forEach((p, i) => {
    const style = worldStyle(p);
    const w = buildWorld(style, radius[i], pos[i].clone().add(offset), sunPos, p.smartHolders > 0);
    worlds.push(w); styles.push(style);
    root.add(w.group);
  });

  // Wallets: the same orbits as the full scene, as a lighter star cloud.
  const orbits = layoutStarOrbits(galaxy, pos, radius);
  const N = galaxy.stars.length;
  const geo = new THREE.BufferGeometry();
  const aCenter = new Float32Array(N * 3), aRadius = new Float32Array(N), aTilt = new Float32Array(N * 2), aPhase = new Float32Array(N);
  const aSpeed = new Float32Array(N), aSize = new Float32Array(N), aColor = new Float32Array(N * 3), aBright = new Float32Array(N), aHome = new Float32Array(N * 2);
  const col = new THREE.Color();
  galaxy.stars.forEach((s, i) => {
    const { orbit: o, home, second } = orbits[i];
    aCenter.set([o.center.x + offset.x, o.center.y + offset.y, o.center.z + offset.z], i * 3);
    aRadius[i] = o.radius; aTilt.set([o.tiltX, o.tiltY], i * 2); aPhase[i] = o.phase; aSpeed[i] = o.speed;
    aSize[i] = 0.9 + s.brightness * 2.6 + (s.kind === 'smart' ? 1.5 : 0);
    col.set(opts.kindColor(s.kind)); aColor.set([col.r, col.g, col.b], i * 3);
    aBright[i] = s.kind === 'contract' ? 0.5 : 0.7 + s.brightness * 0.9;
    aHome.set([home, second], i * 2);
  });
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const attr = (n: string, a: Float32Array, k: number) => geo.setAttribute(n, new THREE.BufferAttribute(a, k));
  attr('aCenter', aCenter, 3); attr('aRadius', aRadius, 1); attr('aTilt', aTilt, 2); attr('aPhase', aPhase, 1);
  attr('aSpeed', aSpeed, 1); attr('aSize', aSize, 1); attr('aColor', aColor, 3); attr('aBright', aBright, 1); attr('aHome', aHome, 2);
  const uniforms = { uTime: { value: 0 }, uPixel: { value: opts.pixelRatio }, uFocus: { value: -1 }, uScale: { value: S } };
  const stars = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  stars.frustumCulled = false;
  root.add(stars);

  // Arm dust, lighter than the active galaxy's, in the universe's own colour.
  const { pos: dPos, col: dCol } = dustDisc(9000, 7 + def.id.length * 13);
  const tint = new THREE.Color(def.color);
  for (let i = 0; i < dCol.length; i += 3) {
    dCol[i] = dCol[i] * 0.6 + tint.r * 0.4; dCol[i + 1] = dCol[i + 1] * 0.6 + tint.g * 0.4; dCol[i + 2] = dCol[i + 2] * 0.6 + tint.b * 0.4;
  }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3));
  const dust = new THREE.Points(dGeo, new THREE.PointsMaterial({ size: 0.6 * S, map: opts.soft, vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }));
  dust.position.copy(offset);
  root.add(dust);

  // One label for the universe, above its sun.
  const div = document.createElement('div');
  div.className = 'slabel universe-label';
  div.innerHTML = `<i style="background:${def.color}"></i><b>${esc(def.name)}</b><span>${galaxy.planets.length} worlds · fly in</span>`;
  const label = new CSS2DObject(div);
  label.position.copy(offset).add(new THREE.Vector3(0, 30 * 2.2, 0));
  root.add(label);

  return {
    id: def.id, root, center: offset.clone(),
    update(time, dt, reduced) {
      uniforms.uTime.value = time;
      sun.mat.uniforms.uTime.value = time;
      dust.rotation.y += dt * 0.004;
      for (let i = 0; i < worlds.length; i++) {
        const w = worlds[i];
        if (!reduced) { w.spinner.rotation.y += dt * styles[i].spin; w.clouds.rotation.y += dt * 0.006; }
        w.surfaceMat.uniforms.uTime.value = time;
        w.cloudMat.uniforms.uTime.value = time;
      }
    },
  };
}
