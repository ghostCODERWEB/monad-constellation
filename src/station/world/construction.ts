// Spacecraft construction surfaces, generated once on canvas as full PBR sets
// (albedo, height-derived normal, roughness, metalness) at a known physical
// scale, so a 1.2 m deck panel is 1.2 m wherever it is used:
//   · deckPanels: coated structural deck plates on a 1.2 m grid, recessed seams,
//     countersunk fasteners every 0.3 m, one lift-out access cover per 2×2 bay,
//     anti-slip grit in the coating and wear where traffic polishes it;
//   · paintedPanels: enclosure panels 1.2 × 2.4 m in a dielectric paint coat,
//     riveted seams, chips that show bare aluminium (metal only there);
//   · hazardStripes: 45° yellow/black bands 100 mm wide, a geometric pattern
//     rather than text, with scuffs where boots and trolleys hit them.
import * as THREE from 'three';
import { normalFromHeight, rng, surface, toTexture } from './pbr';

export interface ConstructionSet { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; metalnessMap: THREE.Texture; /** Metres one repeat covers. */ tile: number }

const cache = new Map<string, ConstructionSet>();

/** Smooth value noise on a wrapped grid (cells per tile = `f`), 0..1. */
function noise(seed: number, f: number) {
  const r = rng(seed);
  const g = Array.from({ length: f * f }, () => r());
  const at = (i: number, j: number) => g[((j % f) + f) % f * f + ((i % f) + f) % f];
  return (u: number, v: number) => {
    const x = u * f, y = v * f, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
  };
}
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function finish(N: number, fill: (x: number, y: number, out: { a: [number, number, number]; h: number; r: number; m: number }) => void, tile: number, normal: number): ConstructionSet {
  const A = surface(N), H = surface(N), R = surface(N), M = surface(N);
  const ad = A.g.createImageData(N, N), hd = H.g.createImageData(N, N), rd = R.g.createImageData(N, N), md = M.g.createImageData(N, N);
  const out = { a: [0, 0, 0] as [number, number, number], h: 0.5, r: 0.7, m: 0 };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    out.h = 0.5; out.r = 0.7; out.m = 0;
    fill(x, y, out);
    const i = (y * N + x) * 4;
    ad.data[i] = out.a[0]; ad.data[i + 1] = out.a[1]; ad.data[i + 2] = out.a[2]; ad.data[i + 3] = 255;
    const hv = Math.max(0, Math.min(1, out.h)) * 255;
    hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;
    // three.js reads roughness from G and metalness from B.
    rd.data[i] = 0; rd.data[i + 1] = Math.max(0, Math.min(1, out.r)) * 255; rd.data[i + 2] = 0; rd.data[i + 3] = 255;
    md.data[i] = 0; md.data[i + 1] = 0; md.data[i + 2] = out.m * 255; md.data[i + 3] = 255;
  }
  A.g.putImageData(ad, 0, 0); H.g.putImageData(hd, 0, 0); R.g.putImageData(rd, 0, 0); M.g.putImageData(md, 0, 0);
  return { map: toTexture(A.c, true), normalMap: toTexture(normalFromHeight(H.c, normal), false), roughnessMap: toTexture(R.c, false), metalnessMap: toTexture(M.c, false), tile };
}

const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mixc = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

/** Coated structural deck plates: a 2 × 2 bay of 1.2 m panels per 2.4 m tile. */
export function deckPanels(coat = 0x6c7078, seed = 11): ConstructionSet {
  const key = `deck-${coat}-${seed}`;
  const hit = cache.get(key); if (hit) return hit;
  const N = 2048, P = N / 2, PX = N / 2.4; // px per metre
  const base = rgb(coat), seamC = rgb(0x1f2125), steel = rgb(0x9da3ab), grit = rgb(0x8b9098);
  const wear = noise(seed, 6), mott = noise(seed + 1, 24), scuff = noise(seed + 2, 48);
  const tone = [0.97, 1.03, 1.0, 0.95].map((k, i) => k + (rng(seed + i * 7)() - 0.5) * 0.04);
  const SW = 0.006 * PX;            // seam half-width: 6 mm
  const FAST = 0.3 * PX, INSET = 0.028 * PX, HEAD = 0.011 * PX, SOCK = 0.0045 * PX;
  // The access cover sits in panel (1, 0): 0.8 × 0.5 m, with two finger slots.
  const CX0 = P + 0.2 * PX, CX1 = 2 * P - 0.2 * PX, CY0 = 0.35 * PX, CY1 = 0.85 * PX;
  const set = finish(N, (x, y, o) => {
    const px = x % P, py = y % P, ix = Math.floor(x / P), iy = Math.floor(y / P);
    const u = x / N, v = y / N;
    let a = shade(base, tone[iy * 2 + ix] * (0.98 + mott(u, v) * 0.04));
    let h = 0.5 + (hash(x, y) - 0.5) * 0.05, r = 0.74 + (hash(y, x) - 0.5) * 0.12, m = 0;
    // Anti-slip grit: sparse lighter specks in the coating.
    if (hash(x * 3, y * 5) > 0.985) { a = mixc(a, grit, 0.55); h += 0.05; r -= 0.08; }
    // Traffic wear: polished, slightly lighter, smoother patches.
    const w = wear(u, v);
    if (w > 0.62) { const k = Math.min(1, (w - 0.62) / 0.25); a = mixc(a, shade(base, 1.12), k * 0.35); r -= k * 0.16; }
    if (scuff(u, v) > 0.84 && hash(x >> 2, y) > 0.6) { a = shade(a, 0.94); }
    // Seams: a recessed joint with a small chamfer either side.
    const d = Math.min(px, py, P - 1 - px, P - 1 - py);
    if (d < SW) { a = seamC; h = 0.18; r = 0.92; }
    else if (d < SW + 5) { h -= (SW + 5 - d) / 5 * 0.12; a = shade(a, 0.9); }
    // Countersunk fasteners every 0.3 m along each panel edge.
    const along = (t: number) => Math.abs(((t - FAST / 2) % FAST + FAST) % FAST - FAST / 2);
    const fx = Math.min(Math.hypot(px - INSET, along(py)), Math.hypot(P - 1 - px - INSET, along(py)), Math.hypot(py - INSET, along(px)), Math.hypot(P - 1 - py - INSET, along(px)));
    if (fx < HEAD) {
      const k = fx / HEAD;
      a = shade(steel, 0.8 + k * 0.25); h = 0.46 + k * 0.06; r = 0.38; m = 1;
      if (fx < SOCK) { a = rgb(0x15161a); h = 0.36; r = 0.6; m = 0.4; }
    }
    // Access cover: a thin groove round it, two recessed finger slots.
    if (x >= CX0 - 3 && x <= CX1 + 3 && y >= CY0 - 3 && y <= CY1 + 3) {
      const e = Math.min(x - CX0, CX1 - x, y - CY0, CY1 - y);
      if (Math.abs(e) < 3) { a = seamC; h = 0.25; r = 0.9; }
      else if (e > 0) {
        a = shade(a, 1.03);
        const cy = (CY0 + CY1) / 2;
        for (const sx of [CX0 + 0.18 * PX, CX1 - 0.18 * PX]) {
          const dx = Math.abs(x - sx) - 0.035 * PX, dy = Math.abs(y - cy) - 0.008 * PX;
          if (dx < 0 && dy < 0) { a = shade(seamC, 1.3); h = 0.22; r = 0.85; }
        }
      }
    }
    o.a = a; o.h = h; o.r = r; o.m = m;
  }, 2.4, 6);
  cache.set(key, set);
  return set;
}

/** Painted enclosure panels 1.2 m wide, 2.4 m tall, riveted seams and a few chips to bare metal. */
export function paintedPanels(paint = 0xc9ccd1, seed = 21): ConstructionSet {
  const key = `paint-${paint}-${seed}`;
  const hit = cache.get(key); if (hit) return hit;
  const N = 2048, PX = N / 2.4, PW = N / 2;
  const base = rgb(paint), bare = rgb(0xc4c9cf), seamC = rgb(0x5a5e65);
  const mott = noise(seed, 10), roller = noise(seed + 1, 160), chipN = noise(seed + 2, 40);
  const RIV = 0.1 * PX, RIN = 0.022 * PX, RR = 0.0055 * PX;
  const set = finish(N, (x, y, o) => {
    const u = x / N, v = y / N;
    const px = x % PW;
    let a = shade(base, 0.975 + mott(u, v) * 0.035 + (roller(u, v) - 0.5) * 0.015);
    let h = 0.5 + (roller(u, v) - 0.5) * 0.04, r = 0.52 + (hash(x, y) - 0.5) * 0.06, m = 0;
    // Grime settles towards each panel's lower edge.
    a = shade(a, 1 - Math.max(0, (v - 0.82) / 0.18) * 0.12);
    const dS = Math.min(px, PW - 1 - px, y, N - 1 - y);
    if (dS < 4) { a = seamC; h = 0.3; r = 0.8; }
    // Rivets every 0.1 m along both sides of each seam.
    const along = (t: number) => Math.abs(((t - RIV / 2) % RIV + RIV) % RIV - RIV / 2);
    const rv = Math.min(Math.hypot(px - RIN, along(y)), Math.hypot(PW - 1 - px - RIN, along(y)), Math.hypot(y - RIN, along(px)), Math.hypot(N - 1 - y - RIN, along(px)));
    if (rv < RR) { const k = rv / RR; h = 0.62 - k * 0.1; a = shade(a, 0.92 + (1 - k) * 0.12); r = 0.45; }
    // Chips: paint knocked off, mostly near seams and the lower edge.
    const nearEdge = Math.min(1, dS / (0.15 * PX));
    const chip = chipN(u, v) + hash(x >> 3, y >> 3) * 0.15 - nearEdge * 0.18 - (v > 0.85 ? -0.06 : 0);
    if (chip > 0.95) { a = bare; m = 0.7; r = 0.5; h = 0.47; }
    else if (chip > 0.935) { a = shade(a, 0.9); h = 0.49; }
    o.a = a; o.h = h; o.r = r; o.m = m;
  }, 2.4, 3);
  cache.set(key, set);
  return set;
}

/** 45° hazard bands, 100 mm wide, yellow and black, scuffed at the edges. 0.4 m tile. */
export function hazardStripes(seed = 31): ConstructionSet {
  const key = `hazard-${seed}`;
  const hit = cache.get(key); if (hit) return hit;
  const N = 512, PX = N / 0.4;
  const yellow = rgb(0xe3ad12), black = rgb(0x17181b), bare = rgb(0x8a9098);
  const scuffN = noise(seed, 16);
  const band = 0.1 * PX * Math.SQRT2; // horizontal period of a 100 mm band at 45°
  const set = finish(N, (x, y, o) => {
    const k = Math.floor((x + y) / band) % 2;
    let a = k ? black : yellow;
    let r = 0.6 + (hash(x, y) - 0.5) * 0.1, m = 0, h = 0.5;
    const s = scuffN(x / N, y / N) + (hash(x >> 1, y >> 1) - 0.5) * 0.2;
    if (s > 0.8) { a = bare; m = 1; r = 0.4; h = 0.46; }
    else if (s > 0.72) a = shade(a, 0.8);
    o.a = a; o.h = h; o.r = r; o.m = m;
  }, 0.4, 2);
  cache.set(key, set);
  return set;
}

/** A material from a construction set; set UVs in metres / tile (tileUV, boxPBR). */
export function constructionMaterial(set: ConstructionSet, o: { clearcoat?: number; envIntensity?: number } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1,
    metalnessMap: set.metalnessMap, metalness: 1, clearcoat: o.clearcoat ?? 0, clearcoatRoughness: 0.4,
  });
  m.userData.tile = set.tile;
  return m;
}
