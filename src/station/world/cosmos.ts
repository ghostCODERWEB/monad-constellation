// The deep sky for the telescope: Monad token worlds, stars, nebulae, clusters,
// galaxies, a deep field, a galaxy cluster, supernova remnants and a
// simulated black hole. Each sits at its own direction on the sky with its
// real angular size, drawn by a shader whose detail keeps growing as you zoom,
// so going from 1× to thousands of times is continuous, not a flat image
// blown up. Directions are in the station's inertial frame (the same frame
// that turns the starfield and the Sun once per orbit).
import * as THREE from 'three';
import { NOISE, buildWorld, buildMoon, type World } from '@/components/worlds';
import { worldStyle } from '@/lib/worldStyle';
import { moonsOf } from '@/lib/moons';
import type { Galaxy } from '@/lib/galaxy';
import type { FieldInfo, FieldWorld } from './galaxyField';

export type TargetKind = 'universe' | 'token' | 'planet' | 'star' | 'nebula' | 'dark-nebula' | 'open-cluster' | 'globular' | 'spiral' | 'elliptical'
  | 'interacting' | 'group' | 'cluster' | 'deep-field' | 'black-hole' | 'remnant' | 'earth' | 'moon' | 'sun';

export interface Target {
  id: string;
  name: string;
  kind: TargetKind;
  /** Inertial longitude and latitude, degrees. */
  lon: number;
  lat: number;
  /** Apparent angular diameter, degrees. */
  size: number;
  distance: string;
  /** Where the focus knob is sharp for this object (0..1). */
  focus: number;
  facts: string[];
  simulated?: boolean;
  /** A Monad token world: its address and symbol. */
  token?: { address: string; symbol: string; planet: number; universe?: string };
}

const as = (arcsec: number) => arcsec / 3600;

export const CATALOG: Target[] = [
  { id: 'earth', name: 'Earth', kind: 'earth', lon: 0, lat: 0, size: 140, distance: '420 km below', focus: 0.15, facts: ['Home. 71% ocean, one thin film of atmosphere.', 'From 420 km the horizon is about 2,300 km away.', 'The station circles it every 92 minutes; here, every 20.'] },
  { id: 'moon', name: 'The Moon', kind: 'moon', lon: 0, lat: 0, size: 0.52, distance: '384,400 km', focus: 0.35, facts: ['Craters, maria and mountains, lit sharply at the terminator.', 'Tidally locked: it always shows Earth the same face.', 'Its shadows are longest near the terminator; zoom there.'] },
  { id: 'sun', name: 'The Sun', kind: 'sun', lon: 0, lat: 0, size: 0.53, distance: '1 AU · 149.6 million km', focus: 0.4, facts: ['Never observe without the solar filter.', 'Granulation cells are convection columns the size of countries.', 'Light from its surface left 8 minutes 20 seconds ago.'] },
  { id: 'betelgeuse', name: 'Betelgeuse', kind: 'star', lon: 88, lat: 18, size: as(0.05), distance: '~550 light-years', focus: 0.7, facts: ['A red supergiant: placed where the Sun is, it would swallow Mars.', 'Dimmed sharply in 2019–20 behind its own dust.', 'One day it will go supernova.'] },
  { id: 'rigel', name: 'Rigel', kind: 'star', lon: 78, lat: -12, size: as(0.05), distance: '~860 light-years', focus: 0.7, facts: ['A blue supergiant, about 120,000 times the Sun\'s luminosity.', 'Colour is temperature: blue stars run hottest.'] },
  { id: 'sirius', name: 'Sirius', kind: 'star', lon: 101, lat: -17, size: as(0.05), distance: '8.6 light-years', focus: 0.7, facts: ['The brightest star in the night sky.', 'It has a white-dwarf companion, Sirius B.'] },
  { id: 'antares', name: 'Antares', kind: 'star', lon: 247, lat: -26, size: as(0.05), distance: '~550 light-years', focus: 0.7, facts: ['"Rival of Mars": a red supergiant in Scorpius.', 'Roughly 700 times the Sun\'s radius.'] },
  { id: 'orion', name: 'Orion Nebula (M42)', kind: 'nebula', lon: 84, lat: -5, size: 1.1, distance: '1,344 light-years', focus: 0.8, facts: ['A stellar nursery lit by the Trapezium\'s young, hot stars.', 'Visible to the naked eye as the middle "star" of Orion\'s sword.', 'The glow is hydrogen ionised by ultraviolet light.'] },
  { id: 'lagoon', name: 'Lagoon Nebula (M8)', kind: 'nebula', lon: 271, lat: -24, size: 1.4, distance: '~4,100 light-years', focus: 0.8, facts: ['An emission nebula threaded with dark dust lanes.', 'Contains Bok globules: dark clouds collapsing into stars.'] },
  { id: 'horsehead', name: 'Horsehead Nebula', kind: 'dark-nebula', lon: 85, lat: -3, size: 0.13, distance: '~1,375 light-years', focus: 0.8, facts: ['A dark nebula: dust silhouetted against glowing hydrogen.', 'Its shape is temporary on cosmic time: a few million years.'] },
  { id: 'pleiades', name: 'Pleiades (M45)', kind: 'open-cluster', lon: 56, lat: 4, size: 1.8, distance: '444 light-years', focus: 0.78, facts: ['An open cluster of young, hot blue stars about 100 million years old.', 'The blue haze is dust reflecting starlight, not part of their birth cloud.', 'Most eyes see six or seven stars; it has over a thousand.'] },
  { id: 'omegacen', name: 'Omega Centauri', kind: 'globular', lon: 202, lat: -36, size: 0.6, distance: '17,000 light-years', focus: 0.8, facts: ['A globular cluster of about ten million stars.', 'Possibly the core of a dwarf galaxy the Milky Way absorbed.'] },
  { id: 'andromeda', name: 'Andromeda Galaxy (M31)', kind: 'spiral', lon: 10, lat: 41, size: 3.1, distance: '2.5 million light-years', focus: 0.86, facts: ['The nearest large galaxy: about a trillion stars.', 'It is approaching at 110 km/s and will merge with the Milky Way.', 'Its light left before modern humans existed.'] },
  { id: 'whirlpool', name: 'Whirlpool Galaxy (M51)', kind: 'interacting', lon: 202, lat: 47, size: 0.19, distance: '23 million light-years', focus: 0.86, facts: ['A face-on spiral pulling at a smaller companion, NGC 5195.', 'The interaction drives its sharply defined arms and star formation.'] },
  { id: 'sombrero', name: 'Sombrero Galaxy (M104)', kind: 'spiral', lon: 190, lat: -12, size: 0.15, distance: '31 million light-years', focus: 0.86, facts: ['Seen nearly edge-on, with a dramatic dust lane.', 'A bright bulge holds about 2,000 globular clusters.'] },
  { id: 'm87', name: 'M87', kind: 'elliptical', lon: 188, lat: 12, size: 0.12, distance: '54 million light-years', focus: 0.86, facts: ['A giant elliptical galaxy: old, red, nearly featureless.', 'Its central black hole, M87*, was the first ever imaged (2019).'] },
  { id: 'quintet', name: 'Stephan\'s Quintet', kind: 'group', lon: 339, lat: 34, size: 0.06, distance: '~290 million light-years', focus: 0.88, facts: ['A compact galaxy group; four of the five are interacting.', 'Shock waves between them heat gas to millions of degrees.'] },
  { id: 'coma', name: 'Coma Cluster (Abell 1656)', kind: 'cluster', lon: 195, lat: 28, size: 1.2, distance: '~320 million light-years', focus: 0.9, facts: ['Over a thousand galaxies bound by gravity.', 'Its motions were the first evidence for dark matter (Zwicky, 1933).', 'Arcs near the core are background galaxies bent by gravitational lensing.'] },
  { id: 'deepfield', name: 'Deep Field', kind: 'deep-field', lon: 189, lat: 62, size: 0.04, distance: 'up to ~13 billion light-years', focus: 0.92, facts: ['A patch of "empty" sky the size of a grain of sand at arm\'s length.', 'Nearly every point of light is a galaxy.', 'The reddest ones are seen as they were when the universe was young.'] },
  { id: 'crab', name: 'Crab Nebula (M1)', kind: 'remnant', lon: 84, lat: 22, size: 0.12, distance: '6,500 light-years', focus: 0.84, facts: ['The remains of a supernova recorded by astronomers in 1054.', 'A pulsar at its heart spins 30 times a second.'] },
  { id: 'veil', name: 'Veil Nebula', kind: 'remnant', lon: 312, lat: 31, size: 3, distance: '~2,400 light-years', focus: 0.84, facts: ['Filaments of a supernova blast wave about 10,000 years old.', 'The shell is still expanding at hundreds of km/s.'] },
  { id: 'blackhole', name: 'Black hole (simulated)', kind: 'black-hole', lon: 266, lat: -29, size: 0.05, distance: '26,000 light-years (Sagittarius A*)', focus: 0.95, simulated: true, facts: ['Simulated view, scale greatly exaggerated: the real shadow of Sagittarius A* is about 50 micro-arcseconds.', 'The bright ring is light orbiting just outside the event horizon.', 'Background stars are bent into arcs: gravitational lensing.'] },
];

export function dirOf(lon: number, lat: number) {
  const l = THREE.MathUtils.degToRad(lon), b = THREE.MathUtils.degToRad(lat);
  return new THREE.Vector3(Math.cos(b) * Math.cos(l), Math.sin(b), -Math.cos(b) * Math.sin(l));
}

const D = 20000;

const PLANE_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const COMMON = /* glsl */ `
  ${NOISE}
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // Point stars at a given density: each grid cell may hold one.
  vec3 starfield(vec2 p, float scale, float density, float seed) {
    vec2 c = floor(p * scale), f = fract(p * scale);
    float h = hash2(c + seed);
    if (h > density) return vec3(0.0);
    vec2 o = vec2(hash2(c + seed + 3.1), hash2(c + seed + 7.7)) * 0.6 + 0.2;
    float d = length(f - o) * 2.0;
    float b = pow(hash2(c + seed + 11.0), 3.0);
    vec3 tint = mix(vec3(1.0, 0.75, 0.55), vec3(0.65, 0.8, 1.0), hash2(c + seed + 19.0));
    return tint * exp(-d * d * 60.0) * (0.4 + b * 3.0);
  }
`;

const NEBULA_FS = /* glsl */ `
  uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uSeed; uniform float uDust;
  varying vec2 vUv;
  ${COMMON}
  void main() {
    vec2 p = vUv; float r = length(p);
    vec3 q = vec3(p * 2.1, uSeed);
    float w = fbm(q * 1.2 + 3.0, 5);
    float n = fbm(q + w * 1.3, 10) * 0.5 + 0.5;
    float fil = pow(1.0 - abs(snoise(vec3(p * 5.0 + w * 2.0, uSeed * 2.0))), 7.0);
    float mask = ss(1.0, 0.15, r + (fbm(q * 0.8, 3)) * 0.25);
    vec3 col = mix(uA, uB, ss(0.35, 0.8, n)) * pow(n, 2.4) * 2.6 + uC * fil * 0.9 * n;
    float dust = ss(0.5, 0.72, fbm(q * 1.7 + 7.0, 7) * 0.5 + 0.5);
    col *= 1.0 - dust * uDust;
    col += vec3(1.0, 0.95, 0.9) * exp(-r * r * 400.0) * 1.2;  // the young stars at its heart
    col += starfield(p, 60.0, 0.06, uSeed) + starfield(p, 420.0, 0.05, uSeed + 1.0);
    gl_FragColor = vec4(col * mask, 1.0);
  }`;

const DARK_FS = /* glsl */ `
  uniform float uSeed;
  varying vec2 vUv;
  ${COMMON}
  void main() {
    vec2 p = vUv;
    vec3 q = vec3(p * 2.0, uSeed);
    float glow = fbm(q + fbm(q * 1.4, 4), 9) * 0.5 + 0.5;
    vec3 bg = vec3(0.95, 0.22, 0.28) * pow(glow, 1.8) * 1.6;
    // The silhouette: a column rising from below with a head, edges frayed by noise.
    vec2 h = p - vec2(0.05, 0.05);
    float column = ss(0.18, 0.12, abs(p.x + 0.1 * sin(p.y * 3.0)) ) * step(p.y, 0.1);
    float head = ss(0.32, 0.22, length(vec2(h.x * 1.3 - h.y * 0.5, h.y * 1.1)));
    float snout = ss(0.12, 0.05, length(h - vec2(-0.22, 0.12)));
    float body = max(max(column, head), snout);
    float fray = fbm(vec3(p * 9.0, uSeed + 4.0), 7) * 0.5 + 0.5;
    float dark = ss(0.35, 0.6, body + (fray - 0.5) * 0.35);
    vec3 rim = vec3(1.0, 0.55, 0.45) * ss(0.3, 0.55, body) * (1.0 - dark) * 0.9;
    vec3 col = bg * (1.0 - dark * 0.96) + rim + starfield(p, 80.0, 0.05, uSeed) * (1.0 - dark);
    float mask = ss(1.0, 0.5, length(p));
    gl_FragColor = vec4(col * mask, 1.0);
  }`;

const GALAXY_FS = /* glsl */ `
  uniform float uSeed; uniform float uInc; uniform float uPA; uniform float uArms; uniform float uPitch;
  uniform vec3 uBulge; uniform vec3 uDisk; uniform float uKind; // 0 spiral, 1 elliptical, 2 interacting, 3 group
  varying vec2 vUv;
  ${COMMON}
  vec3 spiral(vec2 p, float inc, float pa, float arms, float pitch, float seed, vec3 bulgeC, vec3 diskC) {
    float c = cos(pa), s = sin(pa);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    p.y /= max(cos(inc), 0.08);
    float r = length(p), th = atan(p.y, p.x);
    vec3 q = vec3(p * 3.0, seed);
    float clumps = fbm(q * 2.0, 8) * 0.5 + 0.5;
    float phase = arms * (th - log(r + 0.02) / pitch) + clumps * 1.6;
    float arm = ss(0.1, 0.95, cos(phase) * 0.5 + 0.5);
    float disk = exp(-r * 3.4);
    float bulge = exp(-r * r * 55.0) * 1.8;
    float lanes = ss(0.65, 0.95, cos(phase - 0.7) * 0.5 + 0.5) * disk;
    vec3 col = bulgeC * bulge + diskC * disk * (0.25 + arm * 0.95 * (0.55 + 0.45 * clumps));
    col += vec3(1.0, 0.45, 0.7) * pow(clumps, 6.0) * arm * disk * 1.4;   // star-forming regions
    col *= 1.0 - lanes * 0.6 * ss(0.0, 0.25, r);
    // An edge-on dust lane cuts across tilted galaxies.
    col *= 1.0 - ss(0.035, 0.0, abs(p.y * cos(inc))) * ss(0.7, 1.5, inc) * 0.85 * step(0.04, r);
    return col;
  }
  vec3 ellip(vec2 p, float e, float pa, vec3 colr) {
    float c = cos(pa), s = sin(pa);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    p.y /= e;
    float r = length(p);
    return colr * (exp(-pow(r * 6.0, 0.6) * 2.2) * 2.4);
  }
  void main() {
    vec2 p = vUv;
    vec3 col;
    if (uKind < 0.5) col = spiral(p, uInc, uPA, uArms, uPitch, uSeed, uBulge, uDisk);
    else if (uKind < 1.5) {
      col = ellip(p, 0.82, uPA, uBulge);
      // A swarm of globular clusters around it.
      col += starfield(p, 90.0, 0.08, uSeed) * ss(1.0, 0.2, length(p)) * vec3(1.0, 0.9, 0.7);
    } else if (uKind < 2.5) {
      col = spiral(p * 1.15 + vec2(0.1, 0.05), 0.35, uPA, 2.0, 0.28, uSeed, uBulge, uDisk);
      col += ellip((p - vec2(0.55, 0.42)) * 1.6, 0.8, 0.3, vec3(1.0, 0.82, 0.6)) * 0.9;
      // The tidal bridge.
      float bridge = exp(-pow(length((p - vec2(0.35, 0.3)) * vec2(1.0, 3.0)), 2.0) * 6.0) * (fbm(vec3(p * 4.0, uSeed), 6) * 0.5 + 0.5);
      col += uDisk * bridge * 0.5;
    } else {
      // A compact group of five.
      col = vec3(0.0);
      col += spiral((p - vec2(-0.3, 0.2)) * 2.6, 0.5, 0.8, 2.0, 0.3, uSeed, uBulge, uDisk);
      col += spiral((p - vec2(0.25, 0.3)) * 2.8, 0.9, -0.4, 2.0, 0.25, uSeed + 1.0, uBulge, uDisk);
      col += ellip((p - vec2(0.05, -0.05)) * 2.4, 0.7, 1.0, vec3(1.0, 0.85, 0.65));
      col += ellip((p - vec2(0.1, -0.35)) * 2.6, 0.8, 0.2, vec3(1.0, 0.82, 0.62));
      col += spiral((p - vec2(-0.45, -0.4)) * 2.2, 0.3, 2.0, 2.0, 0.3, uSeed + 2.0, vec3(0.8, 0.85, 1.0), vec3(0.55, 0.65, 1.0)) * 0.9;
      col += vec3(0.5, 0.6, 1.0) * pow(fbm(vec3(p * 3.0, uSeed + 9.0), 7) * 0.5 + 0.5, 6.0) * 0.6;
    }
    col += starfield(p, 70.0, 0.02, uSeed + 5.0) * 0.6;
    float mask = ss(1.0, 0.75, length(p));
    gl_FragColor = vec4(col * mask, 1.0);
  }`;

const FIELD_FS = /* glsl */ `
  uniform float uSeed; uniform float uCluster;
  varying vec2 vUv;
  ${COMMON}
  // One tiny galaxy per occupied cell, at two scales so zooming finds more.
  vec3 galaxies(vec2 p, float scale, float seed) {
    vec2 c = floor(p * scale), f = fract(p * scale) - 0.5;
    float h = hash2(c + seed);
    if (h > 0.55) return vec3(0.0);
    float ang = hash2(c + seed + 2.0) * 6.28, e = 0.35 + hash2(c + seed + 3.0) * 0.6;
    float cs = cos(ang), sn = sin(ang);
    vec2 q = vec2(cs * f.x - sn * f.y, sn * f.x + cs * f.y);
    q.y /= e;
    float r = length(q) * (2.5 + hash2(c + seed + 4.0) * 5.0);
    float z = hash2(c + seed + 5.0);
    vec3 col = mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.45, 0.25), z);
    float spiral = step(0.6, hash2(c + seed + 6.0));
    float arms = spiral * ss(0.2, 0.9, cos(2.0 * (atan(q.y, q.x) - log(r + 0.05) / 0.3)) * 0.5 + 0.5) * exp(-r * 2.0);
    return col * (exp(-r * r * 8.0) * 1.6 + arms * 0.8) * (0.3 + (1.0 - z) * 0.9);
  }
  void main() {
    vec2 p = vUv;
    vec3 col = galaxies(p, 9.0, uSeed) + galaxies(p, 31.0, uSeed + 1.0) * 0.8 + galaxies(p, 110.0, uSeed + 2.0) * 0.6;
    if (uCluster > 0.5) {
      float r = length(p);
      // Two giant ellipticals at the core and a crowd of cluster members.
      col += vec3(1.0, 0.85, 0.65) * (exp(-pow(length(p - vec2(-0.12, 0.05)) * 9.0, 0.6) * 2.5) + exp(-pow(length(p - vec2(0.16, -0.04)) * 9.0, 0.6) * 2.5)) * 2.0;
      col += galaxies(p, 18.0, uSeed + 9.0) * vec3(1.0, 0.85, 0.6) * ss(1.0, 0.0, r) * 1.6;
      // Gravitational lensing: background galaxies stretched into arcs round the core.
      float th = atan(p.y, p.x);
      float arc = exp(-pow((r - 0.33) * 90.0, 2.0)) * ss(0.55, 0.85, fbm(vec3(th * 2.0, uSeed, 1.0), 3) * 0.5 + 0.5);
      arc += exp(-pow((r - 0.52) * 120.0, 2.0)) * ss(0.62, 0.9, fbm(vec3(th * 3.0, uSeed + 4.0, 2.0), 3) * 0.5 + 0.5);
      col += vec3(0.55, 0.75, 1.0) * arc * 1.8;
    }
    // A foreground star with diffraction spikes now and then.
    vec2 s = p - vec2(0.42, -0.31);
    float spike = exp(-abs(s.x) * 400.0) * exp(-abs(s.y) * 8.0) + exp(-abs(s.y) * 400.0) * exp(-abs(s.x) * 8.0);
    col += vec3(1.0, 0.95, 0.85) * (exp(-dot(s, s) * 4000.0) * 3.0 + spike * 0.6);
    float mask = ss(1.0, 0.85, max(abs(p.x), abs(p.y)));
    gl_FragColor = vec4(col * mask, 1.0);
  }`;

const REMNANT_FS = /* glsl */ `
  uniform float uSeed; uniform float uShell;
  varying vec2 vUv;
  ${COMMON}
  void main() {
    vec2 p = vUv; float r = length(p);
    vec3 q = vec3(p * 3.0, uSeed);
    float warp = fbm(q, 5);
    vec3 col;
    if (uShell < 0.5) {
      // The Crab: tangled filaments over a blue synchrotron glow, a pulsar at the heart.
      float body = ss(0.95, 0.3, length(p * vec2(1.0, 1.35)) + warp * 0.2);
      float fil = pow(1.0 - abs(snoise(vec3(p * 7.0 + warp * 2.0, uSeed))), 8.0) + pow(1.0 - abs(snoise(vec3(p * 19.0 + warp, uSeed + 3.0))), 10.0) * 0.6;
      col = vec3(0.35, 0.55, 1.0) * body * 0.6 + mix(vec3(1.0, 0.45, 0.2), vec3(0.4, 1.0, 0.5), ss(-0.3, 0.3, warp)) * fil * body * 1.6;
      col += vec3(0.9, 0.95, 1.0) * exp(-r * r * 9000.0) * 4.0;
    } else {
      // The Veil: thin arcs of a blast wave seen edge-on.
      float th = atan(p.y, p.x);
      float ring = exp(-pow((r + warp * 0.12 - 0.72) * 18.0, 2.0)) * ss(0.35, 0.75, fbm(vec3(th * 2.5, uSeed, 0.0), 4) * 0.5 + 0.5);
      float wisps = pow(1.0 - abs(snoise(vec3(p * 10.0 + warp * 3.0, uSeed + 2.0))), 9.0) * ring;
      col = mix(vec3(0.2, 0.9, 0.85), vec3(1.0, 0.35, 0.35), ss(-0.2, 0.25, warp)) * (ring * 0.8 + wisps * 2.2);
    }
    col += starfield(p, 70.0, 0.05, uSeed + 7.0) + starfield(p, 300.0, 0.04, uSeed + 8.0) * 0.7;
    gl_FragColor = vec4(col * ss(1.0, 0.85, r), 1.0);
  }`;

const BLACKHOLE_FS = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${COMMON}
  void main() {
    vec2 p = vUv * 1.2;
    float r = length(p);
    float rs = 0.16;
    // Lensing: background sky sampled at the bent position (Einstein deflection).
    vec2 bent = p * (1.0 - (rs * rs * 2.6) / max(r * r, 1e-4));
    vec3 sky = starfield(bent, 30.0, 0.08, 1.0) + starfield(bent, 120.0, 0.06, 2.0) * 0.8;
    sky += vec3(0.25, 0.2, 0.45) * (fbm(vec3(bent * 2.0, 3.0), 5) * 0.5 + 0.5) * 0.25;
    // Accretion disk, inclined: a thin bright band in front, and the far side
    // of the disk lensed up over the top of the shadow.
    float inc = 0.22;
    vec2 d = vec2(p.x, p.y / inc);
    float dr = length(d);
    float band = ss(0.95, 0.25, dr) * ss(0.24, 0.3, dr) * step(-0.0, -p.y * 0.0 + 1.0);
    float swirl = fbm(vec3(atan(d.y, d.x) * 3.0 - uTime * 0.4, dr * 6.0, 1.0), 5) * 0.5 + 0.5;
    float doppler = 1.0 + p.x * 1.6;                 // the approaching side is brighter
    float front = band * step(p.y, 0.02 + 0.0) * (0.6 + swirl * 0.8) * doppler;
    float back = exp(-pow((r - rs * 1.55) * 26.0, 2.0)) * (0.7 + swirl * 0.6) * ss(-0.05, 0.12, p.y) * 1.4;
    float under = exp(-pow((r - rs * 1.35) * 34.0, 2.0)) * ss(0.05, -0.12, p.y) * 0.6;
    float ring = exp(-pow((r - rs * 1.12) * 90.0, 2.0)) * 1.6;   // the photon ring
    vec3 hot = vec3(1.0, 0.72, 0.38);
    vec3 col = sky * ss(rs * 1.0, rs * 1.3, r);
    col += hot * (front * 1.4 + back + under) + vec3(1.0, 0.9, 0.75) * ring;
    col *= ss(rs * 0.98, rs * 1.04, r) + step(rs * 1.04, r) * 0.0;   // the shadow is black
    col *= step(rs * 0.98, r);
    gl_FragColor = vec4(col * ss(1.2, 0.9, r), 1.0);
  }`;

const PLANET_VS = /* glsl */ `
  varying vec3 vObj; varying vec3 vN; varying vec3 vWorld;
  void main() { vObj = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const PLANET_FS = /* glsl */ `
  uniform vec3 uSun; uniform float uType; uniform float uSeed;
  varying vec3 vObj; varying vec3 vN; varying vec3 vWorld;
  ${NOISE}
  vec3 jupiter(vec3 n) {
    float lat = n.y;
    float w = fbm(n * 6.0 + uSeed, 5);
    float b = sin(lat * 22.0 + w * 1.8);
    vec3 col = mix(vec3(0.92, 0.84, 0.72), vec3(0.72, 0.5, 0.35), ss(-0.2, 0.6, b));
    col = mix(col, vec3(0.55, 0.4, 0.32), ss(0.75, 0.95, abs(lat)));
    // The Great Red Spot.
    vec2 g = vec2(atan(n.z, n.x) - 0.6, lat + 0.36);
    float spot = ss(0.16, 0.06, length(g * vec2(0.55, 1.4)));
    col = mix(col, vec3(0.78, 0.33, 0.22), spot * (0.75 + 0.25 * fbm(n * 20.0, 4)));
    return col;
  }
  vec3 saturn(vec3 n) {
    float b = sin(n.y * 18.0 + fbm(n * 4.0 + uSeed, 4) * 0.8);
    return mix(vec3(0.93, 0.85, 0.66), vec3(0.8, 0.68, 0.48), ss(-0.3, 0.7, b));
  }
  vec3 rocky(vec3 n, vec3 a, vec3 b) {
    float h = fbm(n * 4.0 + uSeed, 7) * 0.5 + 0.5;
    float craters = ss(0.6, 0.72, snoise(n * 18.0 + uSeed)) * 0.25;
    return mix(a, b, h) * (1.0 - craters);
  }
  void main() {
    vec3 n = normalize(vObj);
    vec3 col;
    if (uType < 0.5) col = rocky(n, vec3(0.45, 0.43, 0.42), vec3(0.72, 0.7, 0.68));                       // Mercury
    else if (uType < 1.5) col = mix(vec3(0.95, 0.88, 0.7), vec3(0.85, 0.75, 0.55), fbm(n * 3.0 + uSeed, 5) * 0.5 + 0.5); // Venus
    else if (uType < 2.5) { col = rocky(n, vec3(0.45, 0.2, 0.12), vec3(0.82, 0.45, 0.25)); col = mix(col, vec3(0.95), ss(0.82, 0.9, abs(n.y))); } // Mars
    else if (uType < 3.5) col = jupiter(n);
    else if (uType < 4.5) col = saturn(n);
    else if (uType < 5.5) col = vec3(0.62, 0.85, 0.9) * (0.92 + 0.08 * sin(n.y * 10.0));                 // Uranus
    else { col = vec3(0.25, 0.42, 0.9) * (0.9 + 0.1 * sin(n.y * 14.0 + fbm(n * 3.0, 3))); col = mix(col, vec3(0.1, 0.15, 0.45), ss(0.12, 0.05, length(vec2(atan(n.z, n.x) - 1.0, n.y + 0.3) * vec2(0.6, 1.5)))); } // Neptune
    float lit = max(dot(normalize(vN), uSun), 0.0);
    float limb = pow(max(dot(normalize(vN), normalize(cameraPosition - vWorld)), 0.0), 0.35);
    gl_FragColor = vec4(col * (lit * 1.25 + 0.015) * mix(0.7, 1.0, limb), 1.0);
  }`;

const RING_FS = /* glsl */ `
  uniform vec3 uSun; uniform float uInner; uniform float uOuter;
  float ss(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  varying vec2 vUv; varying float vR;
  void main() {
    float t = (vR - uInner) / (uOuter - uInner);
    float bands = 0.55 + 0.45 * sin(t * 90.0) * sin(t * 23.0 + 1.0);
    float cassini = ss(0.6, 0.63, t) * (1.0 - ss(0.66, 0.69, t));
    float a = ss(0.0, 0.05, t) * ss(1.0, 0.92, t) * bands * (1.0 - cassini * 0.92);
    gl_FragColor = vec4(vec3(0.92, 0.84, 0.68) * a * 1.1, a * 0.9);
  }`;

export interface Cosmos {
  /** Catalog entries for the Monad token worlds, which the station sky already draws (world placement comes from the galaxy field). */
  addTokens(galaxy: Galaxy, placed: FieldWorld[], universeName: string): Target[];
  /** The catalog entry for a whole universe, centred on its sun. */
  universeTarget(info: FieldInfo, galaxy: Galaxy): Target;
  scene: THREE.Scene;
  /** Rotates with the inertial frame; everything on the sky is a child. */
  sky: THREE.Group;
  targets: { t: Target; obj: THREE.Object3D; dir: THREE.Vector3 }[];
  update(time: number, phase: number, sunDirInertial: THREE.Vector3): void;
}

function planeAt(dir: THREE.Vector3, sizeDeg: number, mat: THREE.ShaderMaterial) {
  const s = 2 * D * Math.tan(THREE.MathUtils.degToRad(sizeDeg) / 2);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
  m.position.copy(dir).multiplyScalar(D);
  m.lookAt(0, 0, 0);
  return m;
}

const shader = (frag: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
  vertexShader: PLANE_VS, fragmentShader: frag, uniforms,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

function starSprite(color: THREE.Color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.08, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({ map: t, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false });
}

export function buildCosmos(): Cosmos {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const sky = new THREE.Group();
  scene.add(sky);
  // The Monad worlds are fixed in the station frame (they do not wheel with the orbit's stars).
  const fixed = new THREE.Group();
  scene.add(fixed);
  const targets: Cosmos['targets'] = [];
  const sunUniform = { value: new THREE.Vector3(1, 0, 0) };
  const timeUniform = { value: 0 };
  let seed = 1;

  for (const t of CATALOG) {
    if (t.kind === 'earth' || t.kind === 'moon' || t.kind === 'sun') continue;
    const dir = dirOf(t.lon, t.lat);
    let obj: THREE.Object3D;
    const s = seed++ * 3.7;
    switch (t.kind) {
      case 'nebula':
        obj = planeAt(dir, t.size * 1.25, shader(NEBULA_FS, {
          uA: { value: new THREE.Color(t.id === 'lagoon' ? '#ff5577' : '#ff4f6d') }, uB: { value: new THREE.Color(t.id === 'lagoon' ? '#ff9a7a' : '#5ad1c7') },
          uC: { value: new THREE.Color('#ffd0b0') }, uSeed: { value: s }, uDust: { value: 0.85 },
        }));
        break;
      case 'dark-nebula':
        obj = planeAt(dir, t.size * 1.6, shader(DARK_FS, { uSeed: { value: s } }));
        break;
      case 'spiral': {
        const sombrero = t.id === 'sombrero';
        obj = planeAt(dir, t.size * 1.3, shader(GALAXY_FS, {
          uSeed: { value: s }, uInc: { value: sombrero ? 1.45 : 1.34 }, uPA: { value: sombrero ? 0.05 : 0.65 }, uArms: { value: 2 }, uPitch: { value: 0.22 },
          uBulge: { value: new THREE.Color(sombrero ? '#ffe2b0' : '#ffe6c2') }, uDisk: { value: new THREE.Color('#9fb6ff') }, uKind: { value: 0 },
        }));
        break;
      }
      case 'elliptical':
        obj = planeAt(dir, t.size * 1.6, shader(GALAXY_FS, { uSeed: { value: s }, uInc: { value: 0 }, uPA: { value: 0.4 }, uArms: { value: 0 }, uPitch: { value: 1 }, uBulge: { value: new THREE.Color('#ffd9a8') }, uDisk: { value: new THREE.Color('#000000') }, uKind: { value: 1 } }));
        break;
      case 'interacting':
        obj = planeAt(dir, t.size * 1.5, shader(GALAXY_FS, { uSeed: { value: s }, uInc: { value: 0.3 }, uPA: { value: 0 }, uArms: { value: 2 }, uPitch: { value: 0.28 }, uBulge: { value: new THREE.Color('#ffe2b8') }, uDisk: { value: new THREE.Color('#a8bfff') }, uKind: { value: 2 } }));
        break;
      case 'group':
        obj = planeAt(dir, t.size * 1.5, shader(GALAXY_FS, { uSeed: { value: s }, uInc: { value: 0 }, uPA: { value: 0 }, uArms: { value: 2 }, uPitch: { value: 0.3 }, uBulge: { value: new THREE.Color('#ffe0b5') }, uDisk: { value: new THREE.Color('#a8bfff') }, uKind: { value: 3 } }));
        break;
      case 'deep-field':
        obj = planeAt(dir, t.size, shader(FIELD_FS, { uSeed: { value: s }, uCluster: { value: 0 } }));
        break;
      case 'cluster':
        obj = planeAt(dir, t.size, shader(FIELD_FS, { uSeed: { value: s }, uCluster: { value: 1 } }));
        break;
      case 'remnant':
        obj = planeAt(dir, t.size * 1.3, shader(REMNANT_FS, { uSeed: { value: s }, uShell: { value: t.id === 'veil' ? 1 : 0 } }));
        break;
      case 'black-hole':
        obj = planeAt(dir, t.size * 2.5, shader(BLACKHOLE_FS, { uTime: timeUniform }));
        break;
      case 'open-cluster': {
        const g = new THREE.Group();
        g.add(planeAt(dir, t.size * 1.4, shader(NEBULA_FS, { uA: { value: new THREE.Color('#2a4fb8') }, uB: { value: new THREE.Color('#9fc4ff') }, uC: { value: new THREE.Color('#6f9cff') }, uSeed: { value: s }, uDust: { value: 0.2 } })));
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();
        const span = D * Math.tan(THREE.MathUtils.degToRad(t.size) / 2);
        const blue = new THREE.Color('#bcd4ff');
        const offsets = [[0, 0, 1], [-0.35, 0.1, 0.8], [0.3, -0.15, 0.9], [-0.1, -0.45, 0.7], [0.5, 0.35, 0.65], [-0.55, -0.3, 0.6], [0.15, 0.55, 0.75], [0.62, -0.5, 0.5], [-0.7, 0.45, 0.45]];
        offsets.forEach(([x, y, m]) => {
          const sp = new THREE.Sprite(starSprite(blue));
          sp.position.copy(dir).multiplyScalar(D).addScaledVector(right, x * span).addScaledVector(up, y * span);
          sp.scale.setScalar(0.012 + m * 0.02);
          g.add(sp);
        });
        obj = g;
        break;
      }
      case 'globular': {
        const N = 9000;
        const pos = new Float32Array(N * 3);
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        const up = new THREE.Vector3().crossVectors(right, dir).normalize();
        const span = D * Math.tan(THREE.MathUtils.degToRad(t.size) / 2);
        for (let i = 0; i < N; i++) {
          const r = Math.pow(Math.random(), 2.2) * span, a = Math.random() * Math.PI * 2;
          const p = dir.clone().multiplyScalar(D).addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r);
          pos.set([p.x, p.y, p.z], i * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        obj = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe2b0, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
        break;
      }
      case 'star': {
        const colr = t.id === 'betelgeuse' || t.id === 'antares' ? '#ffb27a' : t.id === 'rigel' ? '#a9c6ff' : '#eef4ff';
        const sp = new THREE.Sprite(starSprite(new THREE.Color(colr)));
        sp.position.copy(dir).multiplyScalar(D);
        sp.scale.setScalar(t.id === 'sirius' ? 0.05 : 0.04);
        obj = sp;
        break;
      }
      case 'planet': {
        const type = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].indexOf(t.id);
        const R = D * Math.tan(THREE.MathUtils.degToRad(t.size) / 2);
        const g = new THREE.Group();
        g.position.copy(dir).multiplyScalar(D);
        const mat = new THREE.ShaderMaterial({ vertexShader: PLANET_VS, fragmentShader: PLANET_FS, uniforms: { uSun: sunUniform, uType: { value: type }, uSeed: { value: s } } });
        const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat);
        if (t.id === 'uranus') ball.rotation.z = 1.7;
        g.add(ball);
        if (t.id === 'saturn') {
          const inner = R * 1.25, outer = R * 2.3;
          const ringGeo = new THREE.RingGeometry(inner, outer, 180, 4);
          const ring = new THREE.Mesh(ringGeo, new THREE.ShaderMaterial({
            vertexShader: `varying vec2 vUv; varying float vR; void main(){ vUv = uv; vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: RING_FS, uniforms: { uSun: sunUniform, uInner: { value: inner }, uOuter: { value: outer } },
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
          }));
          ring.rotation.x = Math.PI / 2 - 0.45;
          g.add(ring);
        }
        // Moons: the Galilean four for Jupiter, Titan for Saturn, at true separations (in planet radii).
        const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        const moons: [number, number, string][] = t.id === 'jupiter' ? [[5.9, 0.026, '#e8d36a'], [-9.4, 0.022, '#e7e2d6'], [15, 0.037, '#b8b0a6'], [-26.4, 0.034, '#6d655c']]
          : t.id === 'saturn' ? [[20, 0.04, '#d9a86a']] : [];
        for (const [sep, rr, col] of moons) {
          const mm = new THREE.Mesh(new THREE.SphereGeometry(R * rr * 6, 24, 16), new THREE.MeshBasicMaterial({ color: col }));
          mm.position.copy(right).multiplyScalar(R * sep);
          g.add(mm);
        }
        obj = g;
        break;
      }
      default:
        continue;
    }
    obj.userData.target = t.id;
    sky.add(obj);
    targets.push({ t, obj, dir });
  }

  // Token worlds are lit by the same Sun, placed far along its direction.
  const sunPos = { value: new THREE.Vector3() };
  const worlds: World[] = [];
  const money = (x: number | null) => x == null ? 'n/a' : x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${Math.round(x)}`;

  const universeTarget = (info: FieldInfo, galaxy: Galaxy): Target => ({
    id: `universe-${info.id}`, name: `${info.name} universe`, kind: 'universe',
    lon: THREE.MathUtils.radToDeg(Math.atan2(-info.dir.z, info.dir.x)), lat: THREE.MathUtils.radToDeg(Math.asin(info.dir.y)),
    size: info.angularRadius * 2, distance: `Monad universe · ${galaxy.planets.length} token worlds`, focus: 0.7,
    facts: [
      `${galaxy.planets.length} Monad tokens in the ${info.name} category, each a world; ${galaxy.stars.length.toLocaleString()} wallets orbit them as stars.`,
      'Built from Nansen token and holder data; the category is assigned by this app from each token’s Nansen name.',
      'MON, the chain’s own star, burns at the heart of every universe. Zoom in to resolve the worlds.',
    ],
  });
  const addTokens = (galaxy: Galaxy, placed: FieldWorld[], universeName: string): Target[] => {
    const out: Target[] = [];
    for (const fw of placed) {
      const p = galaxy.planets[fw.index];
      const style = worldStyle(p);
      const lat = THREE.MathUtils.radToDeg(Math.asin(fw.dir.y));
      const lon = THREE.MathUtils.radToDeg(Math.atan2(-fw.dir.z, fw.dir.x));
      const target: Target = {
        id: `token-${p.address}`, name: `$${p.symbol}`, kind: 'token', lon, lat, size: fw.sizeDeg,
        distance: `${universeName} universe · ${style.biomeName} · far beyond the station`, focus: 0.62,
        token: { address: p.address, symbol: p.symbol, planet: fw.index, universe: fw.universe },
        facts: [
          `${style.biomeName}: ${style.why}`,
          `Market cap ${money(p.marketCap)} · liquidity ${money(p.liquidity)} · ${p.holders} holders in view (Nansen).`,
          `Oceans ≈ ${style.oceanPct}%: liquidity is water. ${style.weather}`,
          p.smartHolders > 0 ? `Golden rings: ${p.smartHolders} Nansen smart money holder${p.smartHolders > 1 ? 's' : ''}.` : 'No smart money holders: no rings.',
        ],
      };
      out.push(target);
    }
    return out;
  };

  const tmpC = new THREE.Vector3();
  return {
    scene, sky, targets, addTokens, universeTarget,
    update(time, phase, sunDirInertial) {
      sky.rotation.z = phase;
      sky.updateMatrixWorld();
      timeUniform.value = time;
      sunUniform.value.copy(sunDirInertial).applyAxisAngle(new THREE.Vector3(0, 0, 1), phase).normalize();
      sunPos.value.copy(sunUniform.value).multiplyScalar(1e7);
      for (const w of worlds) {
        w.group.getWorldPosition(tmpC);
        w.surfaceMat.uniforms.uCenter.value.copy(tmpC);
        w.atmoMat.uniforms.uCenter.value.copy(tmpC);
        w.surfaceMat.uniforms.uTime.value = time;
        w.cloudMat.uniforms.uTime.value = time;
        w.spinner.rotation.y += 0.0005;
      }
    },
  };
}
