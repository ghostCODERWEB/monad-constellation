'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Galaxy, StarKind } from '@/lib/galaxy';
import { buildShuttle } from './shuttle';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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
export interface Tie { star: number; kind: 'counterparty' | 'related'; weight: number }

export interface FlightHud {
  speed: number;
  boost: boolean;
  nearest: { name: string; distance: number } | null;
  target: { focus: Focus; name: string; kind: string; distance: number } | null;
}

export interface GalaxyHandle { flyTo(f: Focus): void; setFlying(on: boolean): void; scan(): void }

interface Props {
  galaxy: Galaxy;
  focus: Focus;
  /** Lines from the focused star to the wallets it deals with. */
  ties?: Tie[];
  onHover: (f: Focus) => void;
  onSelect: (f: Focus) => void;
  onFlight?: (h: FlightHud | null) => void;
}

interface Orbit { center: THREE.Vector3; radius: number; tiltX: number; tiltY: number; phase: number; speed: number }

const STAR_VS = /* glsl */ `
  attribute vec3 aCenter; attribute float aRadius; attribute vec2 aTilt; attribute float aPhase;
  attribute float aSpeed; attribute float aSize; attribute vec3 aColor; attribute float aBright;
  attribute vec2 aHome;
  uniform float uTime; uniform float uPixel; uniform float uFocus;
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
    gl_PointSize = max(3.0 * uPixel, aSize * uPixel * (260.0 / -mv.z) * (0.9 + 0.1 * tw));
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

const PLANET_VS = /* glsl */ `
  varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    vPos = position;
    gl_Position = projectionMatrix * mv;
  }`;

const PLANET_FS = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uRim; uniform float uTime; uniform float uSeed; uniform float uPulse;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(vec3 x) {
    vec3 p = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + p.z * 113.0;
    return mix(mix(mix(hash(n), hash(n + 1.0), f.x), mix(hash(n + 57.0), hash(n + 58.0), f.x), f.y),
               mix(mix(hash(n + 113.0), hash(n + 114.0), f.x), mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y), f.z);
  }
  void main() {
    vec3 n = normalize(vPos);
    float bands = sin(n.y * 9.0 + noise(n * 3.0 + uSeed + uTime * 0.05) * 4.0) * 0.5 + 0.5;
    float detail = noise(n * 8.0 + uSeed);
    vec3 base = mix(uColor * 0.35, uColor, bands * 0.7 + detail * 0.3);
    float light = max(0.15, dot(vNormal, normalize(vec3(0.4, 0.6, 0.7))));
    float rim = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.6);
    gl_FragColor = vec4(base * light * 0.8 + uRim * rim * (0.55 + uPulse), 1.0);
  }`;

const ATMO_FS = /* glsl */ `
  uniform vec3 uRim; varying vec3 vNormal; varying vec3 vView;
  void main() {
    float i = pow(0.75 - dot(vNormal, vView), 3.0);
    gl_FragColor = vec4(uRim, 1.0) * max(0.0, i) * 0.7;
  }`;

const money = (x: number) => {
  const a = Math.abs(x);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a)}`;
  return x < 0 ? `−${s}` : s;
};

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

const GalaxyScene = forwardRef<GalaxyHandle, Props>(function GalaxyScene({ galaxy, focus, ties, onHover, onSelect, onFlight }, ref) {
  const mount = useRef<HTMLDivElement>(null);
  const cb = useRef({ onHover, onSelect, onFlight });
  cb.current = { onHover, onSelect, onFlight };
  const api = useRef<{ flyTo(f: Focus): void; setFocus(f: Focus): void; setTies(t: Tie[]): void; setFlying(on: boolean): void; scan(): void }>({
    flyTo: () => {}, setFocus: () => {}, setTies: () => {}, setFlying: () => {}, scan: () => {},
  });
  useImperativeHandle(ref, () => ({
    flyTo: (f) => api.current.flyTo(f),
    setFlying: (on) => api.current.setFlying(on),
    scan: () => api.current.scan(),
  }));

  useEffect(() => { api.current.setFocus(focus); }, [focus]);
  useEffect(() => { api.current.setTies(ties ?? []); }, [ties]);

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
    scene.background = new THREE.Color(0x05030d);
    const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.1, 2000);
    camera.position.set(0, 95, 165);

    const controls = new OrbitControls(camera, labels.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 6;
    controls.maxDistance = 420;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.18;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.7, 0.45, 0.32);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // --- background: dust in two arms, and a far starfield. Decoration only,
    // drawn faint so it never reads as data.
    const soft = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    const dustN = 26000;
    const dustPos = new Float32Array(dustN * 3);
    const dustCol = new Float32Array(dustN * 3);
    const r0 = rng(7);
    const purple = new THREE.Color('#6d5bd0'), gold = new THREE.Color('#b08a3a'), c = new THREE.Color();
    for (let i = 0; i < dustN; i++) {
      const arm = i % 2;
      const t = Math.pow(r0(), 0.7);
      const rad = 8 + t * 150;
      const ang = arm * Math.PI + t * 4.2 + (r0() - 0.5) * (0.9 - t * 0.4);
      const spread = 3 + t * 14;
      dustPos[i * 3] = Math.cos(ang) * rad + (r0() - 0.5) * spread;
      dustPos[i * 3 + 1] = (r0() - 0.5) * (6 - t * 3) * (r0() < 0.1 ? 3 : 1);
      dustPos[i * 3 + 2] = Math.sin(ang) * rad + (r0() - 0.5) * spread;
      c.copy(purple).lerp(gold, r0() * 0.35 * (1 - t));
      dustCol.set([c.r, c.g, c.b], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.6, map: soft, vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(dust);

    const farN = 4000;
    const farPos = new Float32Array(farN * 3);
    for (let i = 0; i < farN; i++) {
      const v = new THREE.Vector3(r0() - 0.5, r0() - 0.5, r0() - 0.5).normalize().multiplyScalar(600 + r0() * 300);
      farPos.set([v.x, v.y, v.z], i * 3);
    }
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute('position', new THREE.BufferAttribute(farPos, 3));
    scene.add(new THREE.Points(farGeo, new THREE.PointsMaterial({ size: 2.2, map: soft, color: 0x9a90c8, transparent: true, opacity: 0.6, depthWrite: false })));

    // A soft core glow at the galaxy's heart.
    const coreTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const g = cv.getContext('2d')!;
      const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(255,235,190,0.9)'); gr.addColorStop(0.25, 'rgba(160,130,255,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(cv);
    })();
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: coreTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    core.scale.set(46, 46, 1);
    core.material.opacity = 0.55;
    scene.add(core);

    // --- planets on a two-armed spiral, biggest market caps nearest the core.
    const order = galaxy.planets.map((p, i) => i).sort((a, b) => (galaxy.planets[b].marketCap ?? 0) - (galaxy.planets[a].marketCap ?? 0));
    const planetPos: THREE.Vector3[] = new Array(galaxy.planets.length);
    const planetR: number[] = new Array(galaxy.planets.length);
    const planetMats: THREE.ShaderMaterial[] = [];
    const planetMeshes: THREE.Mesh[] = [];
    const rp = rng(42);
    order.forEach((pi, rank) => {
      const p = galaxy.planets[pi];
      const t = (rank + 1) / (order.length + 1);
      const arm = rank % 2;
      const rad = 22 + t * 118;
      const ang = arm * Math.PI + t * 4.2;
      planetPos[pi] = new THREE.Vector3(Math.cos(ang) * rad, (rp() - 0.5) * 8, Math.sin(ang) * rad);
      planetR[pi] = 1.3 + Math.max(0, Math.log10(Math.max(1e4, p.marketCap ?? 1e4)) - 4) * 0.72;

      const tone = p.state !== 'stable' ? '#ef4444' : p.smartHolders ? '#f5c542' : (p.netflow24h ?? 0) >= 0 ? '#8b7cf6' : '#6366f1';
      const rim = p.state !== 'stable' ? '#ff6b6b' : p.smartHolders ? '#ffd76a' : '#a78bfa';
      const mat = new THREE.ShaderMaterial({
        vertexShader: PLANET_VS, fragmentShader: PLANET_FS,
        uniforms: { uColor: { value: new THREE.Color(tone) }, uRim: { value: new THREE.Color(rim) }, uTime: { value: 0 }, uSeed: { value: pi * 3.7 }, uPulse: { value: 0 } },
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(planetR[pi], 48, 32), mat);
      mesh.position.copy(planetPos[pi]);
      mesh.userData.planet = pi;
      scene.add(mesh);
      planetMats.push(mat);
      planetMeshes.push(mesh);

      const atmo = new THREE.Mesh(new THREE.SphereGeometry(planetR[pi] * 1.28, 32, 24), new THREE.ShaderMaterial({
        vertexShader: PLANET_VS, fragmentShader: ATMO_FS, uniforms: { uRim: { value: new THREE.Color(rim) } },
        side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      atmo.position.copy(planetPos[pi]);
      scene.add(atmo);

      if (p.smartHolders > 0) {
        // A ring: Nansen's smart money cohort holds this token.
        const ring = new THREE.Mesh(new THREE.RingGeometry(planetR[pi] * 1.6, planetR[pi] * 1.6 + 0.25 + p.smartHolders * 0.12, 96),
          new THREE.MeshBasicMaterial({ color: 0xf5c542, side: THREE.DoubleSide, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.position.copy(planetPos[pi]);
        ring.rotation.x = Math.PI / 2 - 0.35;
        ring.rotation.y = (rp() - 0.5) * 0.6;
        scene.add(ring);
      }

      const div = document.createElement('div');
      div.className = `plabel ${p.state !== 'stable' ? 'warn' : p.smartHolders ? 'gold' : ''}`;
      div.innerHTML = `<b>$${p.symbol}</b><span>${p.marketCap ? money(p.marketCap) : ''}</span>`;
      div.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onSelect({ type: 'planet', index: pi }); });
      const lbl = new CSS2DObject(div);
      lbl.position.set(0, planetR[pi] * 1.5 + 1.2, 0);
      mesh.add(lbl);
    });

    // --- stars: every wallet, orbiting the token it is most tied to. A
    // wallet tied to two tokens orbits the space between them, so shared
    // holders draw bridges across the galaxy.
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
        center.y += (rs() - 0.5) * 4;
        radius = 1.5 + rs() * 4;
      } else {
        center = planetPos[home].clone();
        const share = links[0]?.share ?? 0;
        // Big holders orbit close; the long tail spreads into a halo.
        radius = planetR[home] * 1.9 + (1 - Math.min(1, Math.sqrt(share) * 3)) * (6 + rs() * 10) + rs() * 2;
      }
      const o: Orbit = { center, radius, tiltX: (rs() - 0.5) * 1.1, tiltY: rs() * Math.PI * 2, phase: rs() * Math.PI * 2, speed: (0.6 / Math.sqrt(radius)) * (rs() < 0.5 ? 1 : -1) * 0.25 };
      orbits[i] = o;
      aCenter.set([center.x, center.y, center.z], i * 3);
      aRadius[i] = radius; aTilt.set([o.tiltX, o.tiltY], i * 2);
      aPhase[i] = o.phase; aSpeed[i] = o.speed;
      aSize[i] = 0.9 + s.brightness * 2.6 + (s.kind === 'smart' ? 1.5 : 0);
      const col = new THREE.Color(KIND[s.kind].color);
      aColor.set([col.r, col.g, col.b], i * 3);
      aBright[i] = s.kind === 'contract' ? 0.5 : 0.7 + s.brightness * 0.9;
      aHome.set([home, second], i * 2);
    });
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const attr = (n: string, a: Float32Array, k: number) => starGeo.setAttribute(n, new THREE.BufferAttribute(a, k));
    attr('aCenter', aCenter, 3); attr('aRadius', aRadius, 1); attr('aTilt', aTilt, 2); attr('aPhase', aPhase, 1);
    attr('aSpeed', aSpeed, 1); attr('aSize', aSize, 1); attr('aColor', aColor, 3); attr('aBright', aBright, 1); attr('aHome', aHome, 2);
    const starUniforms = { uTime: { value: 0 }, uPixel: { value: renderer.getPixelRatio() }, uFocus: { value: -1 } };
    const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: starUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    stars.frustumCulled = false;
    scene.add(stars);

    // --- comets: real transfers between wallets, flying from star to star.
    const CMAX = 70;
    const cometHead = new Float32Array(CMAX * 3), cometCol = new Float32Array(CMAX * 3);
    const tailPos = new Float32Array(CMAX * 6), tailCol = new Float32Array(CMAX * 6);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute('position', new THREE.BufferAttribute(cometHead, 3));
    headGeo.setAttribute('color', new THREE.BufferAttribute(cometCol, 3));
    const heads = new THREE.Points(headGeo, new THREE.PointsMaterial({ size: 1.4, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
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
    scene.add(marker);
    let focusNow: Focus = null;
    let fly: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t0: number; follow: Focus } | null = null;
    let follow: Focus = null;

    const clock = new THREE.Clock();
    let time = 0;
    const tmp = new THREE.Vector3();
    const positionOf = (f: Focus, out: THREE.Vector3) => f?.type === 'planet' ? out.copy(planetPos[f.index]) : f?.type === 'star' ? orbitPos(orbits[f.index], time, out) : out.set(0, 0, 0);

    api.current.flyTo = (f) => {
      if (flight.on) return; // the pilot is flying the camera
      const to = positionOf(f, new THREE.Vector3());
      const dist = f?.type === 'planet' ? planetR[f.index] * 9 + 14 : f?.type === 'star' ? 9 : 190;
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (!f) dir.set(0, 0.5, 0.86).normalize();
      fly = { from: controls.target.clone(), to, camFrom: camera.position.clone(), camTo: to.clone().add(dir.multiplyScalar(dist)), t0: time, follow: f };
      controls.autoRotate = false;
    };
    api.current.setFocus = (f) => {
      focusNow = f;
      starUniforms.uFocus.value = f?.type === 'planet' ? f.index : -1;
    };

    // --- picking: planets by ray, stars by nearest projected point.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent): Focus => {
      const r = labels.domElement.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      ndc.set((mx / r.width) * 2 - 1, -(my / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(planetMeshes)[0];
      let best: Focus = hit ? { type: 'planet', index: hit.object.userData.planet } : null;
      let bestD = hit ? hit.distance : Infinity;
      let bestPx = 9;
      for (let i = 0; i < N; i++) {
        orbitPos(orbits[i], time, tmp);
        const d = tmp.distanceTo(camera.position);
        if (d > bestD) continue;
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
      const f = pick(e);
      cb.current.onSelect(f);
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
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.22;
    const ship = buildShuttle();
    ship.group.visible = false;
    scene.add(ship.group);
    const flight = {
      on: false,
      vel: new THREE.Vector3(),
      spin: new THREE.Vector3(), // pitch, yaw, roll rates
      keys: new Set<string>(),
      drag: null as { x: number; y: number } | null,
      lastHud: 0,
      lastScan: 0,
      target: null as Focus,
      boost: false,
    };
    const fwd = new THREE.Vector3(), up = new THREE.Vector3(), tq = new THREE.Quaternion(), axis = new THREE.Vector3();

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
    const kindOf = (f: Focus) => f?.type === 'planet' ? 'token' : f?.type === 'star' ? KIND[galaxy.stars[f.index].kind].name : '';

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

      fwd.set(0, 0, -1).applyQuaternion(q);
      up.set(0, 1, 0).applyQuaternion(q);
      const throttle = (has('KeyW') ? 1 : 0) - (has('KeyS') ? 0.6 : 0);
      const maxSpeed = flight.boost ? 150 : 48;
      flight.vel.addScaledVector(fwd, throttle * (flight.boost ? 140 : 45) * dt);
      // Steering also bends the velocity toward the nose, so turns carve.
      const sp = flight.vel.length();
      if (sp > 0.5 && flight.vel.dot(fwd) > 0) flight.vel.lerp(vb.copy(fwd).multiplyScalar(sp), 1 - Math.exp(-2.5 * dt));
      flight.vel.multiplyScalar(Math.exp(-(has('Space') ? 3.5 : 0.35) * dt));
      if (flight.vel.length() > maxSpeed) flight.vel.setLength(maxSpeed);
      ship.group.position.addScaledVector(flight.vel, dt);

      // Planets are solid: slide off the atmosphere instead of passing through.
      let nearest = -1, nearestD = Infinity;
      planetPos.forEach((pp, i) => {
        const d = ship.group.position.distanceTo(pp);
        if (d - planetR[i] < nearestD) { nearestD = d - planetR[i]; nearest = i; }
        const min = planetR[i] * 1.18 + 0.4;
        if (d < min) {
          const n = tmp.copy(ship.group.position).sub(pp).normalize();
          ship.group.position.copy(pp).addScaledVector(n, min);
          const into = flight.vel.dot(n);
          if (into < 0) flight.vel.addScaledVector(n, -into);
        }
      });

      // Chase camera, banking with the ship.
      const speedK = Math.min(1, flight.vel.length() / 150);
      const desired = tmp.set(0, 0.62 + speedK * 0.15, 2.7 + speedK * 1.4).applyQuaternion(q).add(ship.group.position);
      camera.position.lerp(desired, 1 - Math.exp(-11 * dt));
      if (flight.boost && throttle > 0 && !reduced) {
        camera.position.x += (Math.random() - 0.5) * 0.03 * speedK;
        camera.position.y += (Math.random() - 0.5) * 0.03 * speedK;
      }
      camera.up.lerp(up, 1 - Math.exp(-6 * dt)).normalize();
      camera.lookAt(vh.copy(ship.group.position).addScaledVector(fwd, 7));
      const fov = 58 + speedK * 32;
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-4 * dt));
      camera.updateProjectionMatrix();

      // Plumes stretch with throttle and flicker; nav lights blink.
      const burn = Math.max(0.12, throttle) * (flight.boost ? 1 : 0.55);
      ship.plumes.forEach((pl, j) => {
        const flick = 0.9 + Math.sin(now * 40 + j * 2) * 0.06 + Math.random() * 0.06;
        pl.scale.set(1 + burn * 0.4, 1 + burn * 0.4, (0.25 + burn * (flight.boost ? 2.6 : 1.4)) * flick);
        (pl.material as THREE.MeshBasicMaterial).color.setHSL(0.72 - burn * 0.12, 0.85, 0.5 + burn * 0.3);
      });
      for (const b of ship.blinkers) b.mesh.visible = ((now + b.phase) % 1.2) < 0.18;

      // Streaks: anchored to the camera, rushing backwards faster with speed.
      streaks.visible = speedK > 0.18;
      if (streaks.visible) {
        const len = 0.5 + speedK * 6;
        for (let i = 0; i < SN; i++) {
          const o = streakOff[i];
          o.z += flight.vel.length() * dt * 0.9;
          if (o.z > 4) { o.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10, -40); }
          va.copy(o).applyQuaternion(camera.quaternion).add(camera.position);
          vb.set(o.x, o.y, o.z - len).applyQuaternion(camera.quaternion).add(camera.position);
          streakPos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], i * 6);
          const a = (speedK - 0.18) * 1.2;
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
          vt.copy(nz).applyQuaternion(q).add(ship.group.position);
          exPos.set([vt.x, vt.y, vt.z], i * 3);
          exVel[i].copy(fwd).multiplyScalar(-(3 + Math.random() * 3)).add(flight.vel.clone().multiplyScalar(0.6))
            .add(va.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
          exLife[i] = 0.55;
        }
      }
      for (let i = 0; i < EX; i++) {
        if (exLife[i] <= 0) { exPos[i * 3 + 1] = -9999; continue; }
        exLife[i] -= dt;
        exPos[i * 3] += exVel[i].x * dt; exPos[i * 3 + 1] += exVel[i].y * dt; exPos[i * 3 + 2] += exVel[i].z * dt;
        const l = Math.max(0, exLife[i] / 0.55);
        exCol.set(flight.boost ? [l, l * 0.85, l * 1.0] : [l * 0.65, l * 0.55, l], i * 3);
      }
      exGeo.attributes.position.needsUpdate = true;
      exGeo.attributes.color.needsUpdate = true;

      // Scanner and target lock, five times a second.
      if (now - flight.lastScan > 0.2) {
        flight.lastScan = now;
        const pos = ship.group.position;
        const close: { i: number; d: number }[] = [];
        let best: Focus = null, bestScore = Infinity;
        for (let i = 0; i < N; i++) {
          orbitPos(orbits[i], time, va);
          const d = va.distanceTo(pos);
          if (d < 16) close.push({ i, d });
          if (d < 45) {
            const ang = vb.copy(va).sub(pos).normalize().angleTo(fwd);
            if (ang < 0.16) { const sc = ang * 30 + d; if (sc < bestScore) { bestScore = sc; best = { type: 'star', index: i }; } }
          }
        }
        planetPos.forEach((pp, i) => {
          const d = pp.distanceTo(pos) - planetR[i];
          const ang = vb.copy(pp).sub(pos).normalize().angleTo(fwd);
          if (d < 120 && ang < 0.22) { const sc = ang * 30 + d * 0.5; if (sc < bestScore) { bestScore = sc; best = { type: 'planet', index: i }; } }
        });
        flight.target = best;
        close.sort((a, b) => a.d - b.d);
        // Prefer labelled wallets when the neighbourhood is crowded.
        const shown = close.filter((c) => galaxy.stars[c.i].kind !== 'anon').concat(close.filter((c) => galaxy.stars[c.i].kind === 'anon')).slice(0, SCAN_N);
        scanTags.forEach((t, j) => {
          const c = shown[j];
          if (!c) { t.o.visible = false; t.star = -1; return; }
          if (t.star !== c.i) {
            const st = galaxy.stars[c.i];
            t.star = c.i;
            t.div.innerHTML = `<i style="background:${KIND[st.kind].color}"></i><b>${st.name.replace(/</g, '&lt;')}</b>${st.pnlUsd ? `<span class="${st.pnlUsd > 0 ? 'up' : 'down'}">${money(st.pnlUsd)}</span>` : st.holdingUsd ? `<span>${money(st.holdingUsd)}</span>` : ''}`;
          }
          t.o.visible = true;
        });

        if (now - flight.lastHud > 0.1) {
          flight.lastHud = now;
          const tp = best ? positionOf(best, va) : null;
          cb.current.onFlight?.({
            speed: flight.vel.length(),
            boost: flight.boost,
            nearest: nearest >= 0 ? { name: `$${galaxy.planets[nearest].symbol}`, distance: Math.max(0, nearestD) } : null,
            target: best && tp ? { focus: best, name: nameOf(best), kind: kindOf(best), distance: tp.distanceTo(pos) } : null,
          });
        }
      }
      for (const t of scanTags) if (t.star >= 0) orbitPos(orbits[t.star], time, t.o.position).y += 0.5;
    };

    // The first view: arrive from deep space.
    const intro = { t0: 0, from: new THREE.Vector3(0, 260, 420), to: camera.position.clone() };
    camera.position.copy(intro.from);

    let raf = 0;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, clock.getDelta());
      time += reduced ? 0 : dt;
      starUniforms.uTime.value = time;
      for (const m of planetMats) m.uniforms.uTime.value = time;
      dust.rotation.y += dt * 0.006;

      if (flight.on) pilot(dt, time);
      if (!flight.on && time - intro.t0 < 3.5 && !fly && !reduced) {
        camera.position.lerpVectors(intro.from, intro.to, ease(Math.min(1, (time - intro.t0) / 3.5)));
      }
      if (flight.on) { /* the pilot owns the camera */ } else if (fly) {
        const k = ease(Math.min(1, (time - fly.t0) / 1.4));
        if (fly.follow) positionOf(fly.follow, fly.to);
        controls.target.lerpVectors(fly.from, fly.to, k);
        camera.position.lerpVectors(fly.camFrom, fly.camTo, k);
        if (k >= 1) { follow = fly.follow; fly = null; }
      } else if (follow?.type === 'star') {
        // Ride along with an orbiting star.
        const before = controls.target.clone();
        positionOf(follow, controls.target);
        camera.position.add(tmp.copy(controls.target).sub(before));
      }

      if (focusNow) {
        positionOf(focusNow, marker.position);
        const s = focusNow.type === 'planet' ? planetR[focusNow.index] * 3.4 : 1.6;
        marker.scale.set(s, s, 1);
        marker.visible = true;
        marker.material.opacity = 0.65 + Math.sin(time * 4) * 0.25;
      } else marker.visible = false;
      // Ties follow both stars along their orbits, and pulse.
      tieGeo.setDrawRange(0, focusNow?.type === 'star' ? tieList.length * 2 : 0);
      if (focusNow?.type === 'star' && tieList.length) {
        orbitPos(orbits[focusNow.index], time, va);
        tieList.forEach((t, i) => {
          orbitPos(orbits[t.star], time, vb);
          tiePos.set([va.x, va.y, va.z, vb.x, vb.y, vb.z], i * 6);
          const pulse = 0.55 + 0.45 * Math.sin(time * 3 - i * 0.7);
          const w = (0.35 + t.weight * 0.65) * pulse;
          const c = t.kind === 'related' ? [0.13, 0.83, 0.93] : [0.96, 0.77, 0.26];
          tieCol.set([c[0] * w, c[1] * w, c[2] * w, c[0] * w * 0.5, c[1] * w * 0.5, c[2] * w * 0.5], i * 6);
        });
        tieGeo.attributes.position.needsUpdate = true;
        tieGeo.attributes.color.needsUpdate = true;
      }
      planetMats.forEach((m, i) => { m.uniforms.uPulse.value = focusNow?.type === 'planet' && focusNow.index === planetMeshes[i].userData.planet ? 0.8 : 0; });

      // Comets.
      comets.forEach((cm, i) => {
        let k = (time - cm.t0) / cm.dur;
        if (k >= 1 || k < 0 && cm.t0 > time + 5) {
          cm.trail = nextTrail++ % trails.length; cm.t0 = time + rs() * 1.5; cm.dur = 1.8 + rs() * 1.6; k = -1;
        }
        const tr = trails[cm.trail];
        if (!tr || k < 0) {
          cometHead.set([0, -9999, 0], i * 3); tailPos.set([0, -9999, 0, 0, -9999, 0], i * 6);
          return;
        }
        orbitPos(orbits[tr.from], time, va); orbitPos(orbits[tr.to], time, vb);
        vm.lerpVectors(va, vb, 0.5); vm.y += va.distanceTo(vb) * 0.25 + 2;
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

      if (!flight.on) controls.update();
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
      renderer.dispose();
      el.removeChild(renderer.domElement);
      el.removeChild(labels.domElement);
    };
  }, [galaxy]);

  return <div ref={mount} style={{ position: 'absolute', inset: 0 }} />;
});

export default GalaxyScene;
