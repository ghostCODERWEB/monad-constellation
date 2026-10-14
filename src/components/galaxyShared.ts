// Pieces of the Monad Constellation shared by the galaxy page and the station's sky:
// the universe's scale, the wallet-star shaders, the seeded generator and orbit maths.
import * as THREE from 'three';
import type { UniverseId } from '@/lib/universes';
import type { Galaxy } from '@/lib/galaxy';

export interface Orbit { center: THREE.Vector3; radius: number; tiltX: number; tiltY: number; phase: number; speed: number }

/** The universe's scale: every distance is this many times the first galaxy's. */
export const S = 6;
export const EARTH_KM = 6371;

export const STAR_VS = /* glsl */ `
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
    // Between a couple of pixels and a modest orb: up close a star must not flood the screen.
    gl_PointSize = aSize <= 0.0 ? 0.0 : clamp(aSize * uPixel * (260.0 * uScale / -mv.z) * (0.9 + 0.1 * tw), 3.0 * uPixel, 56.0 * uPixel);
    vColor = aColor;
    vAlpha = aBright * tw;
    if (uFocus >= 0.0 && abs(aHome.x - uFocus) > 0.5 && abs(aHome.y - uFocus) > 0.5) vAlpha *= 0.12;
  }`;

export const STAR_FS = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = 1.0 - smoothstep(0.0, 0.18, d);
    float glow = exp(-d * d * 22.0);
    gl_FragColor = vec4(vColor * (0.9 + core * 1.6), (glow * 0.9 + core) * vAlpha);
  }`;

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function orbitPos(o: Orbit, t: number, out: THREE.Vector3) {
  const a = o.phase + t * o.speed;
  let x = Math.cos(a) * o.radius, y = 0, z = Math.sin(a) * o.radius;
  const cx = Math.cos(o.tiltX), sx = Math.sin(o.tiltX);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const cy = Math.cos(o.tiltY), sy = Math.sin(o.tiltY);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return out.set(o.center.x + x, o.center.y + y, o.center.z + z);
}


// ---------- one open Monad cosmos ----------
// All five universes share one space: the orbital station is the hub at the
// centre, and the galaxies sit on a ring around it, close enough to see each
// other and fly between. Coordinates here are "cosmos" coordinates; a scene
// keeps its active universe at its own origin and places the rest (and the
// station) at offsets from it, so nothing inside a galaxy has to move.

/** Spiral span of a galaxy's worlds, in units of S: inner radius plus arm length. */
export const SPIRAL = { inner: 20, arm: 95 };
/** How far a galaxy's worlds and dust reach from its sun. */
export const GALAXY_EXTENT = (SPIRAL.inner + SPIRAL.arm + 12) * S;
/** Distance from the station hub to each galaxy's sun. */
export const COSMOS_RING = 1500;
const RING_ORDER: UniverseId[] = ['majors', 'rwa', 'memes', 'stables', 'defi'];
// A little height difference, so neighbouring discs are seen slightly from above or below.
const RING_HEIGHT: Record<UniverseId, number> = { majors: 0, rwa: 240, memes: -200, stables: 170, defi: -250 };

/** Where a universe's sun sits in the cosmos (the station is at the origin). */
export function universeCenter(id: UniverseId, out = new THREE.Vector3()) {
  const k = Math.max(0, RING_ORDER.indexOf(id));
  // Majors faces the station's great window direction; the rest go round.
  const a = Math.PI * 0.5 + (k * Math.PI * 2) / RING_ORDER.length;
  return out.set(Math.cos(a) * COSMOS_RING, RING_HEIGHT[id], Math.sin(a) * COSMOS_RING);
}

/** Offset of universe `id`, seen from a scene whose origin is universe `active`. */
export function universeOffset(id: UniverseId, active: UniverseId, out = new THREE.Vector3()) {
  return universeCenter(id, out).sub(universeCenter(active, new THREE.Vector3()));
}

/** The station hub, seen from a scene whose origin is universe `active`. */
export function stationOffset(active: UniverseId, out = new THREE.Vector3()) {
  return universeCenter(active, out).negate();
}

/** Worlds on a two-armed spiral, biggest market caps nearest the sun. Same for every viewer. */
export function layoutPlanets(galaxy: Pick<Galaxy, 'planets'>) {
  const P = galaxy.planets.length;
  const order = galaxy.planets.map((_, i) => i).sort((a, b) => (galaxy.planets[b].marketCap ?? 0) - (galaxy.planets[a].marketCap ?? 0));
  const pos: THREE.Vector3[] = new Array(P);
  const radius: number[] = new Array(P);
  const rp = rng(42);
  order.forEach((pi, rank) => {
    const p = galaxy.planets[pi];
    const t = (rank + 1) / (order.length + 1);
    const arm = rank % 2;
    const rad = (SPIRAL.inner + t * SPIRAL.arm) * S;
    const ang = arm * Math.PI + t * 4.2;
    pos[pi] = new THREE.Vector3(Math.cos(ang) * rad, (rp() - 0.5) * 4 * S, Math.sin(ang) * rad);
    radius[pi] = (1.3 + Math.max(0, Math.log10(Math.max(1e4, p.marketCap ?? 1e4)) - 4) * 0.72) * S;
  });
  return { order, pos, radius };
}

/** Every wallet's orbit: round the token it is most tied to, or the space between two. */
export function layoutStarOrbits(galaxy: Pick<Galaxy, 'stars'>, planetPos: THREE.Vector3[], planetR: number[]) {
  const rs = rng(1234);
  return galaxy.stars.map((s) => {
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
    return { orbit: o, home, second };
  });
}

/** Arm dust for a galaxy disc (decoration only). */
export function dustDisc(count: number, seed = 7) {
  const r0 = rng(seed);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const purple = new THREE.Color('#6d5bd0'), gold = new THREE.Color('#b08a3a'), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const arm = i % 2;
    const t = Math.pow(r0(), 0.7);
    const rad = (8 + t * (SPIRAL.inner + SPIRAL.arm + 4)) * S;
    const ang = arm * Math.PI + t * 4.2 + (r0() - 0.5) * (0.9 - t * 0.4);
    const spread = (3 + t * 14) * S;
    pos[i * 3] = Math.cos(ang) * rad + (r0() - 0.5) * spread;
    pos[i * 3 + 1] = (r0() - 0.5) * (6 - t * 3) * S * (r0() < 0.1 ? 3 : 1);
    pos[i * 3 + 2] = Math.sin(ang) * rad + (r0() - 0.5) * spread;
    c.copy(purple).lerp(gold, r0() * 0.35 * (1 - t));
    col.set([c.r, c.g, c.b], i * 3);
  }
  return { pos, col, rng: r0 };
}
