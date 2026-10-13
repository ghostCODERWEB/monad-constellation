// Pieces of the Monad Constellation shared by the galaxy page and the station's sky:
// the universe's scale, the wallet-star shaders, the seeded generator and orbit maths.
import * as THREE from 'three';

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

