'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Galaxy, StarKind } from '@/lib/galaxy';
import type { Cluster } from '@/lib/clusters';
import { worldStyle, type WorldStyle } from '@/lib/worldStyle';
import { moonsOf } from '@/lib/moons';
import { buildShuttle } from './shuttle';
import { buildMoon, buildSun, buildWorld, nebula, type World } from './worlds';

export const KIND: Record<StarKind, { color: string; name: string }> = {
  smart: { color: '#f5c542', name: 'Smart trader' },
  fund: { color: '#22d3ee', name: 'Fund' },
  whale: { color: '#60a5fa', name: 'Whale' },
  exchange: { color: '#f472b6', name: 'Exchange' },
  trader: { color: '#fb923c', name: 'Active trader' },
  named: { color: '#4ade80', name: 'Named wallet' },
  contract: { color: '#6b7280', name: 'Contract / bot' },
  anon: { color: '#d8d0ff', name: 'Unlabelled' },
};

export type Focus = { type: 'planet'; index: number } | { type: 'star'; index: number } | null;

/** A line drawn from the selected star to another star: a counterparty or a related wallet. */
export interface Tie { star: number; kind: 'counterparty' | 'related' | 'cluster'; weight: number }

export interface ExpeditionHud {
  planet: number;
  name: string;
  biome: string;
  /** Kilometres, as if the world had Earth's radius. */
  altitudeKm: number;
  zone: 'Orbit' | 'Upper sky' | 'Low flight';
  local: 'Day' | 'Twilight' | 'Night';
  weather: string;
  ocean: number;
  settlements: number;
}

export interface FlightHud {
  speed: number;
  boost: boolean;
  nearest: { name: string; distance: number } | null;
  target: { focus: Focus; name: string; kind: string; distance: number } | null;
  world: ExpeditionHud | null;
}

export interface GalaxyHandle { flyTo(f: Focus): void; setFlying(on: boolean): void; scan(): void }

interface Props {
  galaxy: Galaxy;
  focus: Focus;
  /** Lines from the focused star to the wallets it deals with. */
  ties?: Tie[];
  /** Insider clusters: drawn as red tethers from the shared funder. */
  clusters?: Cluster[];
  onHover: (f: Focus) => void;
  onSelect: (f: Focus) => void;
  onFlight?: (h: FlightHud | null) => void;
}

interface Orbit { center: THREE.Vector3; radius: number; tiltX: number; tiltY: number; phase: number; speed: number }

interface Moon {
  star: number; planet: number; mesh: THREE.Mesh; r: number;
  orbitR: number; tilt: number; node: number; phase: number; speed: number;
  label: CSS2DObject;
}

/** The universe's scale: every distance is this many times the first galaxy's. */
const S = 6;
const EARTH_KM = 6371;

const STAR_VS = /* glsl */ `
  attribute vec3 aCenter; attribute float aRadius; attribute vec2 aTilt; attribute float aPhase;
  attribute float aSpeed; attribute float aSize; attribute vec3 aColor; attribute float aBright;
  attribute vec2 aHome;
  uniform float uTime; uniform float uPixel; uniform float uFocus; uniform float uScale;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float a = aPhase + uTime * aSpeed;
    vec3 p = vec3(cos(a) * aRadius, 0.0, sin(a) * aRadius);
    float cx = cos(aTilt.x), sx = sin(aTilt.x);
    p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
    float cy = cos(aTilt.y), sy = sin(aTilt.y);
    p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
    vec4 mv = modelViewMatrix * vec4(aCenter + p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.82 + 0.18 * sin(uTime * 2.3 + aPhase * 11.0);
    // Never smaller than a couple of pixels, so a distant wallet still reads.
    gl_PointSize = aSize <= 0.0 ? 0.0 : max(3.0 * uPixel, aSize * uPixel * (260.0 * uScale / -mv.z) * (0.9 + 0.1 * tw));
    vColor = aColor;
    vAlpha = aBright * tw;
    if (uFocus >= 0.0 && abs(aHome.x - uFocus) > 0.5 && abs(aHome.y - uFocus) > 0.5) vAlpha *= 0.12;
  }`;

const STAR_FS = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.18, 0.0, d);
    float glow = exp(-d * d * 22.0);
    gl_FragColor = vec4(vColor * (0.9 + core * 1.6), (glow * 0.9 + core) * vAlpha);
  }`;

const money = (x: number) => {
  const a = Math.abs(x);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a)}`;
  return x < 0 ? `−${s}` : s;
};
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function orbitPos(o: Orbit, t: number, out: THREE.Vector3) {
  const a = o.phase + t * o.speed;
  let x = Math.cos(a) * o.radius, y = 0, z = Math.sin(a) * o.radius;
  const cx = Math.cos(o.tiltX), sx = Math.sin(o.tiltX);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const cy = Math.cos(o.tiltY), sy = Math.sin(o.tiltY);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return out.set(o.center.x + x, o.center.y + y, o.center.z + z);
}

const GalaxyScene = forwardRef<GalaxyHandle, Props>(function GalaxyScene({ galaxy, focus, ties, clusters, onHover, onSelect, onFlight }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const cb = useRef({ onHover, onSelect, onFlight });
  cb.current = { onHover, onSelect, onFlight };
  const api = useRef<{ flyTo(f: Focus): void; setFocus(f: Focus): void; setTies(t: Tie[]): void; setClusters(c: Cluster[]): void; setFlying(on: boolean): void; scan(): void }>({
    flyTo: () => {}, setFocus: () => {}, setTies: () => {}, setClusters: () => {}, setFlying: () => {}, scan: () => {},
  });
  useImperativeHandle(ref, () => ({
    flyTo: (f) => api.current.flyTo(f),
    setFlying: (on) => api.current.setFlying(on),
    scan: () => api.current.scan(),
  }));

  // Props can arrive before the scene exists; the scene reads these once it does.
  const latest = useRef({ focus, ties, clusters });
  latest.current = { focus, ties, clusters };
  useEffect(() => { api.current.setFocus(focus); }, [focus]);
  useEffect(() => { api.current.setTies(ties ?? []); }, [ties]);
  useEffect(() => { api.current.setClusters(clusters ?? []); }, [clusters]);

  useEffect(() => {
    const el = mount.current!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const W = () => el.clientWidth, H = () => el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    labels.setSize(W(), H());
    labels.domElement.className = 'labels';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03020a);
    const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.05, 60000);
    camera.position.set(0, 95 * S, 165 * S);

    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.5;
    controls.maxDistance = 420 * S;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.14;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.7, 0.45, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const soft = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();

    // --- deep space: arm dust, a far starfield and nebulae. Decoration only,
    // drawn faint so it never reads as data.
    const r0 = rng(7);
    const dustN = 32000;
    const dustPos = new Float32Array(dustN * 3), dustCol = new Float32Array(dustN * 3);
    const purple = new THREE.Color('#6d5bd0'), gold = new THREE.Color('#b08a3a'), c = new THREE.Color();
    for (let i = 0; i < dustN; i++) {
      const arm = i % 2;
      const t = Math.pow(r0(), 0.7);
      const rad = (8 + t * 160) * S;
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
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.6 * S, map: soft, vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(dust);

    const farN = 7000;
    const farPos = new Float32Array(farN * 3), farCol = new Float32Array(farN * 3);
    for (let i = 0; i < farN; i++) {
      const v = new THREE.Vector3(r0() - 0.5, r0() - 0.5, r0() - 0.5).normalize().multiplyScalar(14000 + r0() * 6000);
      farPos.set([v.x, v.y, v.z], i * 3);
      c.setHSL(0.6 + r0() * 0.15, 0.4, 0.6 + r0() * 0.35);
      farCol.set([c.r, c.g, c.b], i * 3);
    }
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute('position', new THREE.BufferAttribute(farPos, 3));
    farGeo.setAttribute('color', new THREE.BufferAttribute(farCol, 3));
    scene.add(new THREE.Points(farGeo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, map: soft, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false })));

    const nebulae: [string, number, number][] = [
      ['rgba(131,110,249,0.9)', 9000, 0.16], ['rgba(56,189,248,0.9)', 7000, 0.1], ['rgba(245,197,66,0.9)', 6000, 0.08],
      ['rgba(244,114,182,0.9)', 8000, 0.1], ['rgba(99,102,241,0.9)', 11000, 0.12], ['rgba(34,211,238,0.9)', 6500, 0.07],
    ];
    nebulae.forEach(([col, size, op], i) => {
      const n = nebula(col, size, op);
      const a = i * 1.7 + 0.4, e = (r0() - 0.5) * 1.2;
      n.position.set(Math.cos(a) * Math.cos(e) * 12000, Math.sin(e) * 12000, Math.sin(a) * Math.cos(e) * 12000);
      scene.add(n);
    });

    // --- the sun: MON, the chain's native asset, at the centre of everything.
    const sunPos = { value: new THREE.Vector3(0, 0, 0) };
    const SUN_R = 30;
    const sun = buildSun(SUN_R);
    scene.add(sun.group);
    {
      const div = document.createElement('div');
      div.className = 'plabel sun';
      div.innerHTML = '<b>MON</b><span>native star</span>';
      const lbl = new CSS2DObject(div);
      lbl.position.set(0, SUN_R * 1.6, 0);
      sun.group.add(lbl);
    }

    // --- worlds on a two-armed spiral, biggest market caps nearest the sun.
    const P = galaxy.planets.length;
    const order = galaxy.planets.map((_, i) => i).sort((a, b) => (galaxy.planets[b].marketCap ?? 0) - (galaxy.planets[a].marketCap ?? 0));
    const planetPos: THREE.Vector3[] = new Array(P);
    const planetR: number[] = new Array(P);
    const worlds: World[] = new Array(P);
    const styles: WorldStyle[] = new Array(P);
    const planetLabels: CSS2DObject[] = new Array(P);
    const rp = rng(42);
    order.forEach((pi, rank) => {
      const p = galaxy.planets[pi];
      const t = (rank + 1) / (order.length + 1);
      const arm = rank % 2;
      const rad = (24 + t * 140) * S;
      const ang = arm * Math.PI + t * 4.2;
      planetPos[pi] = new THREE.Vector3(Math.cos(ang) * rad, (rp() - 0.5) * 4 * S, Math.sin(ang) * rad);
      planetR[pi] = (1.3 + Math.max(0, Math.log10(Math.max(1e4, p.marketCap ?? 1e4)) - 4) * 0.72) * S;
      styles[pi] = worldStyle(p);
      const w = buildWorld(styles[pi], planetR[pi], planetPos[pi], sunPos, p.smartHolders > 0);
      w.surface.userData.planet = pi;
      worlds[pi] = w;
      scene.add(w.group);

      const div = document.createElement('div');
      div.className = `plabel ${p.state !== 'stable' ? 'warn' : p.smartHolders ? 'gold' : ''}`;
      div.innerHTML = `<b>$${esc(p.symbol)}</b><span>${styles[pi].biomeName} · ${p.marketCap ? money(p.marketCap) : ''}</span>`;
      div.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onSelect({ type: 'planet', index: pi }); });
      const lbl = new CSS2DObject(div);
      lbl.position.copy(planetPos[pi]).add(new THREE.Vector3(0, planetR[pi] * 1.45 + 2, 0));
      scene.add(lbl);
      planetLabels[pi] = lbl;
    });

    // --- moons: each world's biggest real holders.
    const moons: Moon[] = [];
    const moonOf = new Map<number, Moon>();
    const rm = rng(99);
    for (let pi = 0; pi < P; pi++) {
      moonsOf(galaxy, pi).forEach((m, k) => {
        const s = galaxy.stars[m.star];
        const r = planetR[pi] * Math.min(0.26, 0.07 + Math.sqrt(m.share) * 0.45);
        const mesh = buildMoon(r, KIND[s.kind].color, rm() * 50, sunPos);
        mesh.userData.moonStar = m.star;
        scene.add(mesh);
        const div = document.createElement('div');
        div.className = 'mlabel';
        div.innerHTML = `<i style="background:${KIND[s.kind].color}"></i><b>${esc(s.name)}</b><span>${(m.share * 100).toFixed(1)}% of $${esc(galaxy.planets[pi].symbol)}</span>`;
        const label = new CSS2DObject(div);
        label.visible = false;
        scene.add(label);
        const moon: Moon = {
          star: m.star, planet: pi, mesh, r, label,
          orbitR: planetR[pi] * (2.9 + k * 1.1 + rm() * 0.3),
          tilt: (rm() - 0.5) * 0.5, node: rm() * Math.PI * 2, phase: rm() * Math.PI * 2,
          speed: (0.05 + rm() * 0.05) * (rm() < 0.5 ? 1 : -1),
        };
        moons.push(moon);
        moonOf.set(m.star, moon);
      });
    }
    const moonPos = (m: Moon, t: number, out: THREE.Vector3) => {
      const a = m.phase + t * m.speed;
      let x = Math.cos(a) * m.orbitR, y = 0, z = Math.sin(a) * m.orbitR;
      const ct = Math.cos(m.tilt), st = Math.sin(m.tilt);
      [y, z] = [y * ct - z * st, y * st + z * ct];
      const cn = Math.cos(m.node), sn = Math.sin(m.node);
      [x, z] = [x * cn + z * sn, -x * sn + z * cn];
      return out.set(planetPos[m.planet].x + x, planetPos[m.planet].y + y, planetPos[m.planet].z + z);
    };

    // --- stars: every wallet, orbiting the token it is most tied to. A
    // wallet tied to two tokens orbits the space between them, so shared
    // holders draw bridges across the galaxy. Moon wallets are drawn as moons.
    const N = galaxy.stars.length;
    const orbits: Orbit[] = new Array(N);
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
        const k = 0.3 + rs() * 0.4;
        center = planetPos[home].clone().lerp(planetPos[second], k);
        center.y += (rs() - 0.5) * 4 * S;
        radius = (1.5 + rs() * 4) * S;
      } else {
        center = planetPos[home].clone();
        const share = links[0]?.share ?? 0;
        // Big holders orbit close; the long tail spreads into a halo.
        radius = planetR[home] * 2.4 + (1 - Math.min(1, Math.sqrt(share) * 3)) * (6 + rs() * 10) * S * 0.8 + rs() * 2 * S;
      }
      const o: Orbit = { center, radius, tiltX: (rs() - 0.5) * 1.1, tiltY: rs() * Math.PI * 2, phase: rs() * Math.PI * 2, speed: (0.6 / Math.sqrt(radius / S)) * (rs() < 0.5 ? 1 : -1) * 0.2 };
      orbits[i] = o;
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
    const attr = (n: string, a: Float32Array, k: number) => starGeo.setAttribute(n, new THREE.BufferAttribute(a, k));
    attr('aCenter', aCenter, 3); attr('aRadius', aRadius, 1); attr('aTilt', aTilt, 2); attr('aPhase', aPhase, 1);
    attr('aSpeed', aSpeed, 1); attr('aSize', aSize, 1); attr('aColor', aColor, 3); attr('aBright', aBright, 1); attr('aHome', aHome, 2);
    const starUniforms = { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() }, uFocus: { value: -1 }, uScale: { value: S } };
    const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    stars.frustumCulled = false;
    scene.add(stars);

    let time = 0;
    const starPos = (i: number, out: THREE.Vector3) => {
      const m = moonOf.get(i);
      return m ? out.copy(m.mesh.position) : orbitPos(orbits[i], time, out);
    };

    // --- comets: real transfers between wallets, flying from star to star.
    const CMAX = 70;
    const cometHead = new Float32Array(CMAX * 3), cometCol = new Float32Array(CMAX * 3);
    const tailPos = new Float32Array(CMAX * 6), tailCol = new Float32Array(CMAX * 6);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute('position', new THREE.BufferAttribute(cometHead, 3));
    headGeo.setAttribute('color', new THREE.BufferAttribute(cometCol, 3));
    const heads = new THREE.Points(headGeo, new THREE.PointsMaterial({ size: 1.4 * S * 0.5, map: soft, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    heads.frustumCulled = false;
    scene.add(heads);
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3));
    tailGeo.setAttribute('color', new THREE.BufferAttribute(tailCol, 3));
    const tails = new THREE.LineSegments(tailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    tails.frustumCulled = false;
    scene.add(tails);
    const trails = galaxy.trails.filter((t) => t.usd >= 1).sort((a, b) => b.usd - a.usd);
    const comets = Array.from({ length: Math.min(CMAX, trails.length) }, (_, i) => ({ trail: i % Math.max(1, trails.length), t0: -rs() * 4, dur: 2.5 }));
    let nextTrail = comets.length;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vm = new THREE.Vector3(), vh = new THREE.Vector3(), vt = new THREE.Vector3();
    const bez = (t: number, out: THREE.Vector3) => out.set(
      (1 - t) * (1 - t) * va.x + 2 * (1 - t) * t * vm.x + t * t * vb.x,
      (1 - t) * (1 - t) * va.y + 2 * (1 - t) * t * vm.y + t * t * vb.y,
      (1 - t) * (1 - t) * va.z + 2 * (1 - t) * t * vm.z + t * t * vb.z);

    // --- ties: glowing lines from the selected wallet to its counterparties
    // (gold) and related wallets such as its first funder (cyan).
    const TMAX = 40;
    const tiePos = new Float32Array(TMAX * 6), tieCol = new Float32Array(TMAX * 6);
    const tieGeo = new THREE.BufferGeometry();
    tieGeo.setAttribute('position', new THREE.BufferAttribute(tiePos, 3));
    tieGeo.setAttribute('color', new THREE.BufferAttribute(tieCol, 3));
    const tieLines = new THREE.LineSegments(tieGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    tieLines.frustumCulled = false;
    scene.add(tieLines);
    let tieList: Tie[] = [];
    api.current.setTies = (t) => { tieList = t.slice(0, TMAX); };

    // --- insider clusters: red tethers from each shared funder to the
    // holders it seeded, a pulsing core at the funder, halos on the members.
    interface Knot { c: Cluster; virtual: THREE.Vector3 | null; halo: THREE.Sprite; label: CSS2DObject; color: THREE.Color }
    let knots: Knot[] = [];
    const KMAX = 160;
    const knotPos = new Float32Array(KMAX * 6), knotCol = new Float32Array(KMAX * 6);
    const knotGeo = new THREE.BufferGeometry();
    knotGeo.setAttribute('position', new THREE.BufferAttribute(knotPos, 3));
    knotGeo.setAttribute('color', new THREE.BufferAttribute(knotCol, 3));
    const knotLines = new THREE.LineSegments(knotGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    knotLines.frustumCulled = false;
    knotLines.renderOrder = 15;
    scene.add(knotLines);
    const memberPos = new Float32Array(KMAX * 3), memberCol = new Float32Array(KMAX * 3);
    const memberGeo = new THREE.BufferGeometry();
    memberGeo.setAttribute('position', new THREE.BufferAttribute(memberPos, 3));
    memberGeo.setAttribute('color', new THREE.BufferAttribute(memberCol, 3));
    const memberHalos = new THREE.Points(memberGeo, new THREE.PointsMaterial({ size: 2.4 * S, map: soft, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    memberHalos.frustumCulled = false;
    memberHalos.renderOrder = 15;
    scene.add(memberHalos);
    const knotCore = (k: Knot, out: THREE.Vector3) => k.c.funder?.star != null && !k.c.members.includes(k.c.funder.star) ? starPos(k.c.funder.star, out) : out.copy(k.virtual!);
    api.current.setClusters = (list) => {
      for (const k of knots) { scene.remove(k.halo); scene.remove(k.label); k.halo.material.dispose(); }
      knots = list.map((c, j) => {
        const color = new THREE.Color(c.severity === 'high' ? '#ef4444' : '#f59e0b');
        // Without a known funder star, the core floats above the world it targets.
        const ang = j * 2.4;
        const R = planetR[c.planet];
        const virtual = planetPos[c.planet].clone().add(new THREE.Vector3(Math.cos(ang) * R * 1.4, R * 1.9, Math.sin(ang) * R * 1.4));
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        halo.renderOrder = 16;
        scene.add(halo);
        const div = document.createElement('div');
        div.className = `klabel ${c.severity}`;
        div.innerHTML = `<b>⚠ ${c.kind === 'funded' ? 'Funded together' : 'Transfer ring'}</b><span>${(c.share * 100).toFixed(1)}% of $${esc(galaxy.planets[c.planet].symbol)} · ${c.members.length} wallets</span>`;
        div.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onSelect({ type: 'star', index: c.members[0] }); });
        const label = new CSS2DObject(div);
        label.visible = false;
        scene.add(label);
        return { c, virtual, halo, label, color };
      });
    };

    // --- selection marker and fly-to.
    const markTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const g = cv.getContext('2d')!;
      g.strokeStyle = '#ffffff'; g.lineWidth = 6;
      g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
      return new THREE.CanvasTexture(cv);
    })();
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex, color: 0xf5c542, transparent: true, depthWrite: false, depthTest: false }));
    marker.visible = false;
    marker.renderOrder = 200;
    scene.add(marker);
    let focusNow: Focus = null;
    let fly: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t0: number; follow: Focus } | null = null;
    let follow: Focus = null;

    const clock = new THREE.Clock();
    const tmp = new THREE.Vector3();
    const positionOf = (f: Focus, out: THREE.Vector3) => f?.type === 'planet' ? out.copy(planetPos[f.index]) : f?.type === 'star' ? starPos(f.index, out) : out.set(0, 0, 0);

    api.current.flyTo = (f) => {
      if (flight.on) return; // the pilot is flying the camera
      const to = positionOf(f, new THREE.Vector3());
      const moon = f?.type === 'star' ? moonOf.get(f.index) : undefined;
      const dist = f?.type === 'planet' ? planetR[f.index] * 3.2 + 4 * S : moon ? moon.r * 6 : f?.type === 'star' ? 5.4 * S : 190 * S;
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (!f) dir.set(0, 0.5, 0.86).normalize();
      fly = { from: controls.target.clone(), to, camFrom: camera.position.clone(), camTo: to.clone().add(dir.multiplyScalar(dist)), t0: time, follow: f };
      controls.autoRotate = false;
    };
    api.current.setFocus = (f) => {
      focusNow = f;
      starUniforms.uFocus.value = f?.type === 'planet' ? f.index : -1;
    };

    // --- picking: worlds and moons by ray, stars by nearest projected point.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickables = [...worlds.map((w) => w.surface), ...moons.map((m) => m.mesh)];
    const pick = (e: PointerEvent): Focus => {
      const r = labels.domElement.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      ndc.set((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(pickables, false)[0];
      let best: Focus = hit
        ? (hit.object.userData.moonStar != null ? { type: 'star', index: hit.object.userData.moonStar } : { type: 'planet', index: hit.object.userData.planet })
        : null;
      const bestD = hit ? hit.distance : Infinity;
      let bestPx = 9;
      for (let i = 0; i < N; i++) {
        if (moonOf.has(i)) continue;
        orbitPos(orbits[i], time, tmp);
        if (tmp.distanceTo(camera.position) > bestD) continue;
        tmp.project(camera);
        if (tmp.z > 1) continue;
        const px = Math.hypot((tmp.x * 0.5 + 0.5) * r.width - mx, (-tmp.y * 0.5 + 0.5) * r.height - my);
        if (px < bestPx) { bestPx = px; best = { type: 'star', index: i }; }
      }
      return best;
    };
    let down = { x: 0, y: 0 };
    let hovered: string | null = null;
    let lastMove = 0;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; controls.autoRotate = false; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      // A planet label handles its own click.
      if ((e.target as HTMLElement).closest?.('.plabel')) return;
      cb.current.onSelect(pick(e));
    };
    const onMove = (e: PointerEvent) => {
      if (flight.on) return; // steering, not browsing
      const now = performance.now();
      if (now - lastMove < 50) return;
      lastMove = now;
      const f = pick(e);
      const key = f ? `${f.type}:${f.index}` : null;
      if (key !== hovered) { hovered = key; cb.current.onHover(f); labels.domElement.style.cursor = f ? 'pointer' : 'grab'; }
    };
    labels.domElement.addEventListener('pointerdown', onDown);
    labels.domElement.addEventListener('pointerup', onUp);
    labels.domElement.addEventListener('pointermove', onMove);

    const onResize = () => {
      renderer.setSize(W(), H()); labels.setSize(W(), H()); composer.setSize(W(), H());
      camera.aspect = W() / H(); camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    // --- the shuttle -------------------------------------------------------
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;
    const ship = buildShuttle();
    ship.group.visible = false;
    scene.add(ship.group);
    const flight = {
      on: false,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(), // pitch, yaw, roll rates
      keys: new Set<string>(),
      lastHud: 0,
      lastScan: 0,
      target: null as Focus,
      boost: false,
    };
    const fwd = new THREE.Vector3(), up = new THREE.Vector3(), tq = new THREE.Quaternion(), axis = new THREE.Vector3();
    const levelM = new THREE.Matrix4(), levelQ = new THREE.Quaternion(), ORIGIN = new THREE.Vector3();

    // Exhaust: a pool of glowing particles left behind the engines.
    const EX = 500;
    const exPos = new Float32Array(EX * 3).fill(-9999), exCol = new Float32Array(EX * 3);
    const exVel = Array.from({ length: EX }, () => new THREE.Vector3());
    const exLife = new Float32Array(EX);
    let exNext = 0;
    const exGeo = new THREE.BufferGeometry();
    exGeo.setAttribute('position', new THREE.BufferAttribute(exPos, 3));
    exGeo.setAttribute('color', new THREE.BufferAttribute(exCol, 3));
    const exhaust = new THREE.Points(exGeo, new THREE.PointsMaterial({ size: 0.12, map: soft, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    exhaust.frustumCulled = false;
    exhaust.renderOrder = 20;
    scene.add(exhaust);

    // Speed streaks: short light lines that rush past the camera at speed.
    const SN = 220;
    const streakPos = new Float32Array(SN * 6), streakCol = new Float32Array(SN * 6);
    const streakOff = Array.from({ length: SN }, () => new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, -Math.random() * 40));
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
    const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    streaks.frustumCulled = false;
    streaks.visible = false;
    streaks.renderOrder = 20;
    scene.add(streaks);

    // Scanner: wallet name tags that appear as you pass close by.
    const SCAN_N = 10;
    const scanTags = Array.from({ length: SCAN_N }, () => {
      const div = document.createElement('div');
      div.className = 'slabel';
      const o = new CSS2DObject(div);
      o.visible = false;
      scene.add(o);
      return { o, div, star: -1 };
    });
    const hideScan = () => scanTags.forEach((t) => { t.o.visible = false; t.star = -1; });

    const onKeyDown = (e: KeyboardEvent) => {
      if (!flight.on || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      flight.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => { flight.keys.delete(e.code); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const onFlyDrag = (e: PointerEvent) => {
      if (!flight.on || !(e.buttons & 1)) return;
      // Drag to steer: the mouse nudges pitch and yaw.
      flight.spin.y -= e.movementX * 0.012;
      flight.spin.x -= e.movementY * 0.012;
    };
    labels.domElement.addEventListener('pointermove', onFlyDrag);

    api.current.setFlying = (on) => {
      if (on === flight.on) return;
      flight.on = on;
      flight.keys.clear();
      if (on) {
        // Launch from just in front of the current view, facing the same way.
        camera.getWorldDirection(fwd);
        ship.group.position.copy(camera.position).addScaledVector(fwd, 4);
        ship.group.quaternion.copy(camera.quaternion);
        flight.vel.copy(fwd).multiplyScalar(6);
        flight.spin.set(0, 0, 0);
        ship.group.visible = true;
        controls.enabled = false;
        controls.autoRotate = false;
        fly = null; follow = null;
      } else {
        ship.group.visible = false;
        streaks.visible = false;
        hideScan();
        fwd.set(0, 0, -1).applyQuaternion(ship.group.quaternion);
        controls.target.copy(ship.group.position).addScaledVector(fwd, 6);
        camera.up.set(0, 1, 0);
        camera.fov = 55; camera.updateProjectionMatrix();
        controls.enabled = true;
        cb.current.onFlight?.(null);
      }
    };
    api.current.scan = () => { if (flight.on && flight.target) cb.current.onSelect(flight.target); };

    const nameOf = (f: Focus) => f?.type === 'planet' ? `$${galaxy.planets[f.index].symbol}` : f?.type === 'star' ? galaxy.stars[f.index].name : '';
    const kindOf = (f: Focus) => f?.type === 'planet' ? styles[f.index].biomeName : f?.type === 'star' ? (moonOf.has(f.index) ? `Moon · ${KIND[galaxy.stars[f.index].kind].name}` : KIND[galaxy.stars[f.index].kind].name) : '';

    /** The nearest solid surface to a point: world, moon or the sun. */
    const nearestSurface = (p: THREE.Vector3) => {
      let alt = p.length() - SUN_R, planet = -1;
      for (let i = 0; i < P; i++) {
        const a = p.distanceTo(planetPos[i]) - planetR[i];
        if (a < alt) { alt = a; planet = i; }
      }
      for (const m of moons) alt = Math.min(alt, p.distanceTo(m.mesh.position) - m.r);
      return { alt: Math.max(0, alt), planet };
    };

    /** True when a world or the sun stands between the camera and a point. */
    const occluded = (p: THREE.Vector3, skip = -1) => {
      const dir = vm.copy(p).sub(camera.position);
      const len = dir.length();
      dir.divideScalar(len);
      const hitsSphere = (c: THREE.Vector3, r: number) => {
        const t = tmp.copy(c).sub(camera.position).dot(dir);
        if (t <= 0 || t >= len) return false;
        return tmp.copy(camera.position).addScaledVector(dir, t).distanceTo(c) < r;
      };
      if (hitsSphere(ORIGIN, SUN_R)) return true;
      for (let i = 0; i < P; i++) if (i !== skip && hitsSphere(planetPos[i], planetR[i])) return true;
      return false;
    };

    const pilot = (dt: number, now: number) => {
      const k = flight.keys;
      const has = (...c: string[]) => c.some((x) => k.has(x));
      flight.boost = has('ShiftLeft', 'ShiftRight');
      // Turning: rates ease in and out so the ship feels like it has mass.
      const want = new THREE.Vector3(
        (has('ArrowDown') ? 1 : 0) - (has('ArrowUp') ? 1 : 0),
        (has('KeyA') ? 1 : 0) - (has('KeyD') ? 1 : 0),
        (has('ArrowLeft', 'KeyQ') ? 1 : 0) - (has('ArrowRight', 'KeyE') ? 1 : 0),
      ).multiply(new THREE.Vector3(1.6, 1.8, 2.8));
      flight.spin.lerp(want, 1 - Math.exp(-7 * dt));
      const q = ship.group.quaternion;
      q.multiply(tq.setFromAxisAngle(axis.set(1, 0, 0), flight.spin.x * dt));
      q.multiply(tq.setFromAxisAngle(axis.set(0, 1, 0), flight.spin.y * dt));
      q.multiply(tq.setFromAxisAngle(axis.set(0, 0, 1), flight.spin.z * dt));
      q.normalize();

      const pos = ship.group.position;
      const near = nearestSurface(pos);
      const homeR = near.planet >= 0 ? planetR[near.planet] : 0;
      const inSky = near.planet >= 0 && near.alt < homeR * 0.6;

      // Over a world, the ship levels its wings to the horizon unless you roll.
      if (inSky && Math.abs(flight.spin.z) < 0.4) {
        fwd.set(0, 0, -1).applyQuaternion(q);
        const n = tmp.copy(pos).sub(planetPos[near.planet]).normalize();
        levelM.lookAt(ORIGIN, fwd, n);
        levelQ.setFromRotationMatrix(levelM);
        const strength = (1 - near.alt / (homeR * 0.6)) * 1.8;
        q.slerp(levelQ, 1 - Math.exp(-strength * dt));
      }

      fwd.set(0, 0, -1).applyQuaternion(q);
      up.set(0, 1, 0).applyQuaternion(q);
      const throttle = (has('KeyW') ? 1 : 0) - (has('KeyS') ? 0.6 : 0);
      // Speed scales with clearance: fast between worlds, careful near them.
      const cruise = THREE.MathUtils.clamp(near.alt * 0.9, 5, 260);
      const boostMax = THREE.MathUtils.clamp(near.alt * 3, 9, 1400);
      const maxSpeed = flight.boost ? boostMax : cruise;
      flight.vel.addScaledVector(fwd, throttle * maxSpeed * 1.3 * dt);
      // Steering also bends the velocity toward the nose, so turns carve.
      const sp = flight.vel.length();
      if (sp > 0.5 && flight.vel.dot(fwd) > 0) flight.vel.lerp(vb.copy(fwd).multiplyScalar(sp), 1 - Math.exp(-2.5 * dt));
      flight.vel.multiplyScalar(Math.exp(-(has('Space') ? 3.5 : 0.35) * dt));
      // Approaching a world bleeds off speed smoothly rather than snapping.
      if (flight.vel.length() > maxSpeed) flight.vel.setLength(THREE.MathUtils.lerp(flight.vel.length(), maxSpeed, 1 - Math.exp(-3 * dt)));
      pos.addScaledVector(flight.vel, dt);

      // Worlds and moons are solid: you can skim them, not pass through.
      const solid = (center: THREE.Vector3, min: number) => {
        const d = pos.distanceTo(center);
        if (d < min) {
          const n = tmp.copy(pos).sub(center).normalize();
          pos.copy(center).addScaledVector(n, min);
          const into = flight.vel.dot(n);
          if (into < 0) flight.vel.addScaledVector(n, -into);
        }
      };
      for (let i = 0; i < P; i++) solid(planetPos[i], planetR[i] * 1.013 + 0.3);
      for (const m of moons) solid(m.mesh.position, m.r + 0.4);
      solid(ORIGIN, SUN_R * 1.4);

      // Chase camera, banking with the ship.
      const speedK = Math.min(1, flight.vel.length() / 600);
      const desired = tmp.set(0, 0.62 + speedK * 0.15, 2.7 + speedK * 1.4).applyQuaternion(q).add(pos);
      camera.position.lerp(desired, 1 - Math.exp(-11 * dt));
      if (flight.boost && throttle > 0 && !reduced) {
        camera.position.x += (Math.random() - 0.5) * 0.03 * speedK;
        camera.position.y += (Math.random() - 0.5) * 0.03 * speedK;
      }
      camera.up.lerp(up, 1 - Math.exp(-6 * dt)).normalize();
      camera.lookAt(vh.copy(pos).addScaledVector(fwd, 7));
      const fov = 58 + speedK * 32;
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));

      // Plumes stretch with throttle and flicker; nav lights blink.
      const burn = Math.max(0.12, throttle) * (flight.boost ? 1 : 0.55);
      ship.plumes.forEach((pl, j) => {
        const flick = 0.9 + Math.sin(now * 40 + j * 2) * 0.06 + Math.random() * 0.06;
        pl.scale.set(1 + burn * 0.4, 1 + burn * 0.4, (0.25 + burn * (flight.boost ? 2.6 : 1.4)) * flick);
        (pl.material as THREE.MeshBasicMaterial).color.setHSL(0.72 - burn * 0.12, 0.85, 0.5 + burn * 0.3);
      });
      for (const b of ship.blinkers) b.mesh.visible = ((now + b.phase) % 1.2) < 0.18;

      // Streaks: anchored to the camera, rushing backwards faster with speed.
      streaks.visible = speedK > 0.12;
      if (streaks.visible) {
        const len = 0.5 + speedK * 6;
        for (let i = 0; i < SN; i++) {
          const o = streakOff[i];
          o.z += Math.min(flight.vel.length(), 400) * dt * 0.25;
          if (o.z > 4) { o.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, -40); }
          va.copy(o).applyQuaternion(camera.quaternion).add(camera.position);
          vb.set(o.x, o.y, o.z - len).applyQuaternion(camera.quaternion).add(camera.position);
          streakPos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], i * 6);
          const a = (speedK - 0.12) * 1.2;
          streakCol.set([0.75 * a, 0.7 * a, a, 0, 0, 0], i * 6);
        }
        streakGeo.attributes.position.needsUpdate = true;
        streakGeo.attributes.color.needsUpdate = true;
      }

      // Engines and exhaust.
      const heat = Math.max(0.15, throttle) * (flight.boost ? 1 : 0.6);
      ship.engineMats.forEach((m) => m.color.setHSL(0.72 - heat * 0.2, 0.9, 0.6 + heat * 0.35));
      ship.light.intensity = 0.3 + heat * 1.2;
      const emit = Math.round(heat * (flight.boost ? 9 : 4));
      for (const nz of ship.nozzles) {
        for (let e = 0; e < emit; e++) {
          const i = exNext++ % EX;
          vt.copy(nz).applyQuaternion(q).add(pos);
          exPos.set([vt.x, vt.y, vt.z], i * 3);
          exVel[i].copy(fwd).multiplyScalar(-(3 + Math.random() * 3)).add(flight.vel.clone().multiplyScalar(0.6))
            .add(va.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
          exLife[i] = 0.55;
        }
      }
      for (let i = 0; i < EX; i++) {
        if (exLife[i] <= 0) { exPos[i * 3 + 1] = -99999; continue; }
        exLife[i] -= dt;
        exPos[i * 3] += exVel[i].x * dt; exPos[i * 3 + 1] += exVel[i].y * dt; exPos[i * 3 + 2] += exVel[i].z * dt;
        const l = Math.max(0, exLife[i] / 0.55);
        exCol.set(flight.boost ? [l, l * 0.85, l * 1.0] : [l * 0.65, l * 0.55, l], i * 3);
      }
      exGeo.attributes.position.needsUpdate = true;
      exGeo.attributes.color.needsUpdate = true;

      // Scanner, target lock and expedition readings, five times a second.
      if (now - flight.lastScan > 0.2) {
        flight.lastScan = now;
        const close: { i: number; d: number }[] = [];
        let best: Focus = null, bestScore = Infinity;
        const scanR = 10 * S, lockR = 30 * S;
        for (let i = 0; i < N; i++) {
          starPos(i, va);
          const d = va.distanceTo(pos);
          if (d < scanR && !moonOf.has(i)) close.push({ i, d });
          if (d < lockR) {
            const ang = vb.copy(va).sub(pos).normalize().angleTo(fwd);
            if (ang < 0.16) { const sc = ang * 30 * S + d; if (sc < bestScore) { bestScore = sc; best = { type: 'star', index: i }; } }
          }
        }
        for (let i = 0; i < P; i++) {
          const d = planetPos[i].distanceTo(pos) - planetR[i];
          const ang = vb.copy(planetPos[i]).sub(pos).normalize().angleTo(fwd);
          if (d < 200 * S && ang < 0.22) { const sc = ang * 30 * S + d * 0.5; if (sc < bestScore) { bestScore = sc; best = { type: 'planet', index: i }; } }
        }
        flight.target = best;
        close.sort((a, b) => a.d - b.d);
        // Prefer labelled wallets when the neighbourhood is crowded.
        const shown = close.filter((x) => galaxy.stars[x.i].kind !== 'anon').concat(close.filter((x) => galaxy.stars[x.i].kind === 'anon')).slice(0, SCAN_N);
        scanTags.forEach((t, j) => {
          const x = shown[j];
          if (!x) { t.o.visible = false; t.star = -1; return; }
          if (t.star !== x.i) {
            const st = galaxy.stars[x.i];
            t.star = x.i;
            t.div.innerHTML = `<i style="background:${KIND[st.kind].color}"></i><b>${esc(st.name)}</b>${st.pnlUsd ? `<span class="${st.pnlUsd > 0 ? 'up' : 'down'}">${money(st.pnlUsd)}</span>` : st.holdingUsd ? `<span>${money(st.holdingUsd)}</span>` : ''}`;
          }
          t.o.visible = true;
        });

        if (now - flight.lastHud > 0.1) {
          flight.lastHud = now;
          const tp = best ? positionOf(best, va) : null;
          let world: ExpeditionHud | null = null;
          if (near.planet >= 0 && near.alt < homeR * 2) {
            const pi = near.planet, st = styles[pi], R = planetR[pi];
            const n = vb.copy(pos).sub(planetPos[pi]).normalize();
            const sunUp = n.dot(tmp.copy(planetPos[pi]).negate().normalize());
            world = {
              planet: pi, name: `$${galaxy.planets[pi].symbol}`, biome: st.biomeName,
              altitudeKm: (near.alt / R) * EARTH_KM,
              zone: near.alt < R * 0.03 ? 'Low flight' : near.alt < R * 0.1 ? 'Upper sky' : 'Orbit',
              local: sunUp > 0.12 ? 'Day' : sunUp > -0.08 ? 'Twilight' : 'Night',
              weather: st.weather, ocean: st.oceanPct, settlements: st.settlements,
            };
          }
          cb.current.onFlight?.({
            speed: flight.vel.length(),
            boost: flight.boost,
            nearest: near.planet >= 0 ? { name: `$${galaxy.planets[near.planet].symbol}`, distance: near.alt } : null,
            target: best && tp ? { focus: best, name: nameOf(best), kind: kindOf(best), distance: tp.distanceTo(pos) } : null,
            world,
          });
        }
      }
      for (const t of scanTags) if (t.star >= 0) { starPos(t.star, t.o.position).y += 0.5; t.o.visible = !occluded(t.o.position); }
    };

    // Apply whatever arrived while the scene was being built.
    api.current.setFocus(latest.current.focus);
    api.current.setTies(latest.current.ties ?? []);
    api.current.setClusters(latest.current.clusters ?? []);

    // The first view: arrive from deep space.
    const introFrom = new THREE.Vector3(0, 260 * S, 420 * S), introTo = camera.position.clone();
    camera.position.copy(introFrom);

    let raf = 0;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, clock.getDelta());
      time += reduced ? 0 : dt;
      starUniforms.uTime.value = time;
      sun.mat.uniforms.uTime.value = time;
      dust.rotation.y += dt * 0.004;

      // Worlds turn; clouds drift a little faster than the ground.
      for (let i = 0; i < P; i++) {
        const w = worlds[i];
        if (!reduced) { w.spinner.rotation.y += dt * styles[i].spin; w.clouds.rotation.y += dt * 0.006; }
        w.surfaceMat.uniforms.uTime.value = time;
        w.cloudMat.uniforms.uTime.value = time;
      }
      for (const m of moons) moonPos(m, time, m.mesh.position);

      if (flight.on) pilot(dt, time);
      if (!flight.on && time < 3.5 && !fly && !reduced) camera.position.lerpVectors(introFrom, introTo, ease(Math.min(1, time / 3.5)));
      if (flight.on) { /* the pilot owns the camera */ } else if (fly) {
        const k = ease(Math.min(1, (time - fly.t0) / 1.6));
        if (fly.follow) positionOf(fly.follow, fly.to);
        controls.target.lerpVectors(fly.from, fly.to, k);
        camera.position.lerpVectors(fly.camFrom, fly.camTo, k);
        if (k >= 1) { follow = fly.follow; fly = null; }
      } else if (follow?.type === 'star') {
        // Ride along with an orbiting star or moon.
        const before = controls.target.clone();
        positionOf(follow, controls.target);
        camera.position.add(tmp.copy(controls.target).sub(before));
      }
      if (!flight.on) controls.update();

      // Per-world camera-dependent state: atmosphere seen from inside or
      // outside, labels hidden when the world fills the view, moon names
      // shown when you are in that world's system.
      const camNear = nearestSurface(camera.position);
      let inside = 0;
      for (let i = 0; i < P; i++) {
        const w = worlds[i];
        const d = camera.position.distanceTo(planetPos[i]);
        w.atmoMat.side = d < w.atmoRadius * 0.999 ? THREE.BackSide : THREE.FrontSide;
        planetLabels[i].visible = d > planetR[i] * 3.2 && !occluded(planetLabels[i].position, i);
        if (d < w.atmoRadius) inside = Math.max(inside, 1 - (d - planetR[i]) / (w.atmoRadius - planetR[i]));
        w.surfaceMat.uniforms.uPulse.value = focusNow?.type === 'planet' && focusNow.index === i ? 0.8 : 0;
      }
      for (const m of moons) {
        const d = camera.position.distanceTo(planetPos[m.planet]);
        m.label.visible = d < planetR[m.planet] * 9 && d > planetR[m.planet] * 1.2 && !occluded(m.mesh.position);
        if (m.label.visible) m.label.position.copy(m.mesh.position).add(tmp.set(0, m.r * 1.6, 0));
      }
      // Depth precision: pull the near plane in as surfaces get close.
      camera.near = THREE.MathUtils.clamp(camNear.alt * 0.25, 0.03, 8);
      camera.updateProjectionMatrix();
      bloom.strength = 0.7 - inside * 0.45;

      if (focusNow) {
        positionOf(focusNow, marker.position);
        const moon = focusNow.type === 'star' ? moonOf.get(focusNow.index) : undefined;
        const s = focusNow.type === 'planet' ? planetR[focusNow.index] * 2.9 : moon ? moon.r * 3 : 0.8 * S;
        marker.scale.set(s, s, 1);
        marker.visible = !flight.on || focusNow.type === 'star';
        marker.material.opacity = 0.65 + Math.sin(time * 4) * 0.25;
      } else marker.visible = false;

      // Ties follow both stars along their orbits, and pulse.
      tieGeo.setDrawRange(0, focusNow?.type === 'star' ? tieList.length * 2 : 0);
      if (focusNow?.type === 'star' && tieList.length) {
        starPos(focusNow.index, va);
        tieList.forEach((t, i) => {
          starPos(t.star, vb);
          tiePos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], i * 6);
          const pulse = 0.55 + 0.45 * Math.sin(time * 3 - i * 0.7);
          const w = (0.35 + t.weight * 0.65) * pulse;
          const col = t.kind === 'related' ? [0.13, 0.83, 0.93] : t.kind === 'cluster' ? [0.97, 0.27, 0.27] : [0.96, 0.77, 0.26];
          tieCol.set([col[0] * w, col[1] * w, col[2] * w, col[0] * w * 0.5, col[1] * w * 0.5, col[2] * w * 0.5], i * 6);
        });
        tieGeo.attributes.position.needsUpdate = true;
        tieGeo.attributes.color.needsUpdate = true;
      }

      // Insider clusters.
      {
        let seg = 0, mem = 0;
        const pulse = 0.6 + 0.4 * Math.sin(time * 2.2);
        for (const k of knots) {
          knotCore(k, va);
          const R = planetR[k.c.planet];
          k.halo.position.copy(va);
          k.halo.scale.setScalar(R * (0.5 + 0.12 * pulse));
          const camD = camera.position.distanceTo(planetPos[k.c.planet]);
          const focused = focusNow?.type === 'planet' && focusNow.index === k.c.planet || focusNow?.type === 'star' && k.c.members.includes(focusNow.index);
          k.label.visible = (camD < R * 16 || focused) && !occluded(va);
          k.label.position.copy(va).add(tmp.set(0, R * 0.35, 0));
          for (const m of k.c.members) {
            if (seg >= KMAX || mem >= KMAX) break;
            starPos(m, vb);
            const w = (focused ? 1 : 0.55) * pulse;
            knotPos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], seg * 6);
            knotCol.set([k.color.r * w, k.color.g * w, k.color.b * w, k.color.r * w * 0.6, k.color.g * w * 0.6, k.color.b * w * 0.6], seg * 6);
            seg++;
            memberPos.set([vb.x, vb.y, vb.z], mem * 3);
            memberCol.set([k.color.r * pulse, k.color.g * pulse, k.color.b * pulse], mem * 3);
            mem++;
          }
        }
        knotGeo.setDrawRange(0, seg * 2);
        memberGeo.setDrawRange(0, mem);
        knotGeo.attributes.position.needsUpdate = true; knotGeo.attributes.color.needsUpdate = true;
        memberGeo.attributes.position.needsUpdate = true; memberGeo.attributes.color.needsUpdate = true;
      }

      // Comets.
      comets.forEach((cm, i) => {
        let k = (time - cm.t0) / cm.dur;
        if (k >= 1 || k < 0 && cm.t0 > time + 5) {
          cm.trail = nextTrail++ % trails.length; cm.t0 = time + rs() * 1.5; cm.dur = 1.8 + rs() * 1.6; k = -1;
        }
        const tr = trails[cm.trail];
        if (!tr || k < 0) {
          cometHead.set([0, -99999, 0], i * 3); tailPos.set([0, -99999, 0, 0, -99999, 0], i * 6);
          return;
        }
        starPos(tr.from, va); starPos(tr.to, vb);
        vm.lerpVectors(va, vb, 0.5); vm.y += va.distanceTo(vb) * 0.25 + 2 * S;
        bez(k, vh); bez(Math.max(0, k - 0.12), vt);
        const big = Math.min(1, Math.log10(1 + tr.usd) / 5);
        const from = galaxy.stars[tr.from];
        const col = new THREE.Color(from.kind === 'smart' ? '#f5c542' : big > 0.7 ? '#ffe7a8' : '#b9a8ff');
        cometHead.set([vh.x, vh.y, vh.z], i * 3);
        cometCol.set([col.r, col.g, col.b], i * 3);
        tailPos.set([vh.x, vh.y, vh.z, vt.x, vt.y, vt.z], i * 6);
        tailCol.set([col.r * 0.9, col.g * 0.9, col.b * 0.9, 0, 0, 0], i * 6);
      });
      headGeo.attributes.position.needsUpdate = true; headGeo.attributes.color.needsUpdate = true;
      tailGeo.attributes.position.needsUpdate = true; tailGeo.attributes.color.needsUpdate = true;

      composer.render();
      labels.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      labels.domElement.removeEventListener('pointerdown', onDown);
      labels.domElement.removeEventListener('pointerup', onUp);
      labels.domElement.removeEventListener('pointermove', onMove);
      labels.domElement.removeEventListener('pointermove', onFlyDrag);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      controls.dispose();
      composer.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      el.removeChild(labels.domElement);
    };
  }, [galaxy]);

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />;
});

export default GalaxyScene;
