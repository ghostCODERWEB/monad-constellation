// Spacecraft-grade surfaces for the hangar shuttle (components/shuttle.ts takes
// them as optional overrides; the galaxy keeps its own look). All procedural:
//   hull    painted pearl aluminium, panel lines and rivets, black thermal tiles
//           on the belly, reinforced-carbon nose, livery stripe and decals;
//           4096 × 2048 albedo + baked normal + roughness;
//   wing    tiled pearl panels;
//   foil    gold Kapton/MLI blanket, crumpled, on the engine nacelles;
//   bell    scorched, heat-tempered steel nozzle with soot streaks.
import * as THREE from 'three';
import { NANSEN_MARK_PATH, NANSEN_MARK_VIEWBOX } from './nansenMark';
import { normalFromHeight, pbrSet, recolouredPaint } from './pbr';
import type { ShuttleMaterials } from '@/components/shuttle';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d')! }; };
function tex(c: HTMLCanvasElement, srgb: boolean, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Loft stations of the fuselage, as in components/shuttle.ts: v runs nose to tail.
const PROFILE_Z = [-1.18, -1.10, -0.92, -0.66, -0.28, 0.18, 0.55, 0.78, 0.86];
const vOfZ = (z: number) => {
  for (let i = 0; i < PROFILE_Z.length - 1; i++) {
    if (z >= PROFILE_Z[i] && z <= PROFILE_Z[i + 1]) return (i + (z - PROFILE_Z[i]) / Math.max(1e-6, PROFILE_Z[i + 1] - PROFILE_Z[i])) / (PROFILE_Z.length - 1);
  }
  return z < PROFILE_Z[0] ? 0 : 1;
};

export function hullMaterial() {
  const W = 4096, H = 2048;
  const A = mk(W, H), B = mk(2048, 1024), R = mk(2048, 1024);
  const a = A.g, h = B.g, r = R.g;
  r.scale(0.5, 0.5);
  h.scale(0.5, 0.5);
  const rand = rng(31337);
  // Canvas y is flipped against v: v = 0 (nose) is the bottom of the canvas.
  const Y = (z: number) => (1 - vOfZ(z)) * H;
  const X = (deg: number) => (deg / 360) * W; // 0° starboard, 90° dorsal, 180° port, 270° belly
  const rough = (g: number) => `rgb(${g},${g},${g})`;
  const fillAll = (x: number, y: number, w: number, hh: number, col: string, hv: number, rv: number) => {
    a.fillStyle = col; a.fillRect(x, y, w, hh);
    h.fillStyle = rough(hv); h.fillRect(x, y, w, hh);
    r.fillStyle = rough(rv); r.fillRect(x, y, w, hh);
  };
  // Pearl base with a faint lavender gradient: lighter on the dorsal side.
  const base = a.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, '#cfcbe0'); base.addColorStop(0.5, '#f1eefc'); base.addColorStop(1, '#cfcbe0');
  a.fillStyle = base; a.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  r.fillStyle = rough(100); r.fillRect(0, 0, W, H);

  // Reinforced carbon-carbon nose cone: dark grey, lightly textured.
  const noseY = Y(-0.8);
  const nose = a.createLinearGradient(0, H, 0, noseY);
  nose.addColorStop(0, '#15161a'); nose.addColorStop(1, '#2a2b31');
  a.fillStyle = nose; a.fillRect(0, noseY, W, H - noseY);
  r.fillStyle = rough(150); r.fillRect(0, noseY, W, H - noseY);
  h.fillStyle = '#707070'; h.fillRect(0, noseY, W, H - noseY);

  // Thermal protection tiles: the belly (±36° about 0°) from the nose cone to the tail.
  const tileY0 = Y(0.62), tileY1 = Y(-0.78);
  const belly: [number, number][] = [[X(234), X(306)]];
  const T = 26;
  for (const [x0, x1] of belly) {
    for (let y = tileY0; y < tileY1; y += T) {
      for (let x = x0; x < x1; x += T) {
        // A scalloped upper edge, where the paint meets the tiles.
        const edge = Math.sin((y / 90) + rand() * 0.1) * 0 ;
        const tone = 16 + Math.floor(rand() * 20);
        const heat = Math.max(0, (y - tileY0) / (tileY1 - tileY0)); // 0 tail → 1 nose; tail runs hotter
        const wear = rand() < 0.04 ? 40 : 0;
        a.fillStyle = `rgb(${tone + wear},${tone + wear + 1},${tone + wear + 4})`;
        a.fillRect(x + 1.5, y + 1.5 + edge, T - 3, T - 3);
        h.fillStyle = rough(150 + Math.floor(rand() * 18)); h.fillRect(x + 2, y + 2, T - 4, T - 4);
        h.fillStyle = '#404040'; h.fillRect(x, y, T, 2); h.fillRect(x, y, 2, T);
        r.fillStyle = rough(215 + Math.floor(rand() * 20)); r.fillRect(x, y, T, T);
        a.fillStyle = `rgba(90,70,50,${0.05 * (1 - heat)})`; a.fillRect(x + 1.5, y + 1.5, T - 3, T - 3);
      }
    }
  }
  // Gap shadows between tile rows.
  a.fillStyle = 'rgba(0,0,0,0.5)';
  for (let y = tileY0; y < tileY1; y += T) a.fillRect(X(234), y, X(72), 2);

  // Panel lines: rings every 0.22 units, longitudinal seams, drawn into albedo, height and roughness.
  const groove = (x0: number, y0: number, x1: number, y1: number, alpha = 0.55) => {
    a.strokeStyle = `rgba(48,40,88,${alpha})`; a.lineWidth = 2.4; a.beginPath(); a.moveTo(x0, y0); a.lineTo(x1, y1); a.stroke();
    h.strokeStyle = '#2a2a2a'; h.lineWidth = 4; h.beginPath(); h.moveTo(x0, y0); h.lineTo(x1, y1); h.stroke();
    h.strokeStyle = '#a0a0a0'; h.lineWidth = 2; h.beginPath(); h.moveTo(x0 + 3, y0 + 3); h.lineTo(x1 + 3, y1 + 3); h.stroke();
    r.strokeStyle = rough(160); r.lineWidth = 3; r.beginPath(); r.moveTo(x0, y0); r.lineTo(x1, y1); r.stroke();
  };
  const paintTop = Y(-0.78), paintBottom = Y(0.62);
  for (let z = -0.74; z < 0.62; z += 0.22) groove(0, Y(z), W, Y(z));
  for (const deg of [30, 55, 80, 105, 130, 160, 200, 230, 255, 280, 305, 330]) {
    if (deg > 38 && deg < 322) groove(X(deg), paintBottom, X(deg), paintTop, 0.4);
  }
  // Rivet rows along every ring seam.
  for (let z = -0.74; z < 0.62; z += 0.22) {
    for (let x = 6; x < W; x += 20) {
      for (const dy of [-9, 9]) {
        a.fillStyle = 'rgba(60,52,110,0.4)'; a.beginPath(); a.arc(x, Y(z) + dy, 2.2, 0, 7); a.fill();
        h.fillStyle = '#bcbcbc'; h.beginPath(); h.arc(x, Y(z) + dy, 2.6, 0, 7); h.fill();
      }
    }
  }
  // Access panels with corner screws.
  for (let i = 0; i < 26; i++) {
    const deg = [60, 120, 150, 210, 240, 300][i % 6] + (rand() * 10 - 5), z = -0.6 + rand() * 1.1;
    const w = 90 + rand() * 90, hh = 60 + rand() * 70, x = X(deg), y = Y(z);
    a.strokeStyle = 'rgba(48,40,88,0.6)'; a.lineWidth = 2.4; a.strokeRect(x, y, w, hh);
    h.strokeStyle = '#2a2a2a'; h.lineWidth = 4; h.strokeRect(x, y, w, hh);
    for (const [sx, sy] of [[8, 8], [w - 8, 8], [8, hh - 8], [w - 8, hh - 8]]) {
      a.fillStyle = '#9a9ca6'; a.beginPath(); a.arc(x + sx, y + sy, 4.5, 0, 7); a.fill();
      h.fillStyle = '#d0d0d0'; h.beginPath(); h.arc(x + sx, y + sy, 4.5, 0, 7); h.fill();
    }
  }

  // Livery: a violet spine stripe with gold pinstripes, over the dorsal seams.
  const stripeX = X(90), sw = 220;
  const sTop = Y(-0.5), sBot = Y(0.62);
  a.fillStyle = '#836ef9'; a.fillRect(stripeX - sw / 2, sBot, sw, sTop - sBot);
  a.fillStyle = '#f5c542'; a.fillRect(stripeX - sw / 2 - 22, sBot, 8, sTop - sBot); a.fillRect(stripeX + sw / 2 + 14, sBot, 8, sTop - sBot);
  r.fillStyle = rough(70); r.fillRect((stripeX - sw / 2) / 2, sBot / 2, sw / 2, (sTop - sBot) / 2);
  for (let z = -0.5; z < 0.62; z += 0.22) { a.fillStyle = 'rgba(30,20,80,0.45)'; a.fillRect(stripeX - sw / 2, Y(z) - 1, sw, 2.4); }

  // Decals on both flanks, drawn to read nose-forward from outside.
  const mark = new Path2D(NANSEN_MARK_PATH);
  for (const [deg, flip] of [[3, 1], [180, -1]] as const) {
    a.save();
    a.translate(X(deg), Y(-0.1));
    a.rotate(flip * Math.PI / 2);
    // Wordmark.
    a.fillStyle = '#2a1f66'; a.font = '900 430px "Helvetica Neue", Arial, sans-serif'; a.textAlign = 'center';
    a.fillText('MONAD', 0, 40);
    a.font = '700 92px "Helvetica Neue", Arial, sans-serif'; a.fillStyle = '#3b3270';
    a.fillText('ORBITAL RESEARCH SHUTTLE', 0, 205);
    // Nansen roundel.
    a.save(); a.translate(-620, -20); a.fillStyle = '#122927'; a.beginPath(); a.arc(0, 0, 105, 0, 7); a.fill();
    a.strokeStyle = '#09c385'; a.lineWidth = 8; a.stroke();
    a.scale(150 / NANSEN_MARK_VIEWBOX, 150 / NANSEN_MARK_VIEWBOX); a.translate(-NANSEN_MARK_VIEWBOX / 2, -NANSEN_MARK_VIEWBOX / 2);
    a.fillStyle = '#00ffa7'; a.fill(mark); a.restore();
    // Registration and keep-out marks.
    a.fillStyle = '#17171c'; a.font = '800 110px "Helvetica Neue", Arial, sans-serif'; a.fillText('NX-1001', 620, 25);
    a.strokeStyle = '#c0392b'; a.lineWidth = 8; a.strokeRect(-150, 300, 300, 90);
    a.fillStyle = '#c0392b'; a.font = '800 54px "Helvetica Neue", Arial, sans-serif'; a.fillText('NO STEP', 0, 365);
    a.restore();
    // Engrave the decal's edges lightly into the height map and keep it glossier.
    h.save(); h.translate(X(deg), Y(-0.1)); h.rotate(flip * Math.PI / 2);
    h.fillStyle = '#909090'; h.font = '900 430px "Helvetica Neue", Arial, sans-serif'; h.textAlign = 'center'; h.fillText('MONAD', 0, 40);
    h.fillText('', 0, 0); h.restore();
  }
  // Nose mark on the dorsal side near the canopy, and a lettered panel under the canopy.
  a.save(); a.translate(stripeX, Y(-0.7)); a.rotate(Math.PI); a.fillStyle = '#e8e4ff'; a.font = '700 36px "Helvetica Neue", Arial, sans-serif'; a.textAlign = 'center'; a.fillText('MONAD ✕ NANSEN', 0, 0); a.restore();

  // Weathering: soot and exhaust-stained streaks from the engine end, scuffs, handling smudges.
  for (let i = 0; i < 220; i++) {
    const x = rand() * W, y = rand() * H * 0.45, len = 80 + rand() * 600;
    const dark = rand() < 0.8;
    const g = a.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, dark ? 'rgba(50,40,40,0.0)' : 'rgba(255,255,255,0)');
    g.addColorStop(0.3, dark ? `rgba(60,48,48,${0.025 + rand() * 0.05})` : `rgba(255,255,255,${0.03 + rand() * 0.04})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    a.fillStyle = g; a.fillRect(x, y, 4 + rand() * 18, len);
  }
  for (let i = 0; i < 400; i++) {
    a.fillStyle = `rgba(${rand() < 0.7 ? '40,34,50' : '255,252,255'},${0.03 + rand() * 0.08})`;
    a.fillRect(rand() * W, rand() * H, 3 + rand() * 60, 1 + rand() * 4);
  }

  const map = tex(A.c, true);
  const normalMap = tex(normalFromHeight(B.c, 2.6), false);
  const roughnessMap = tex(R.c, false);
  return new THREE.MeshPhysicalMaterial({
    map, normalMap, normalScale: new THREE.Vector2(1, 1), roughnessMap, roughness: 1, metalness: 0.18,
    clearcoat: 0.55, clearcoatRoughness: 0.2, envMapIntensity: 1.05, side: THREE.FrontSide,
    transparent: false, opacity: 1, depthWrite: true,
  });
}

/** Wing panels: a 1024 tile of pearl skin with seams, rivets and scuffs, repeated. */
export function wingMaterial() {
  const N = 1024;
  const A = mk(N, N), B = mk(N, N);
  const a = A.g, h = B.g, rand = rng(555);
  a.fillStyle = '#ecebf6'; a.fillRect(0, 0, N, N); h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
  for (const p of [0, N / 2]) {
    for (const [x0, y0, x1, y1] of [[p, 0, p, N], [0, p, N, p]]) {
      a.strokeStyle = 'rgba(48,40,88,0.5)'; a.lineWidth = 3; a.beginPath(); a.moveTo(x0, y0); a.lineTo(x1, y1); a.stroke();
      h.strokeStyle = '#2a2a2a'; h.lineWidth = 5; h.beginPath(); h.moveTo(x0, y0); h.lineTo(x1, y1); h.stroke();
    }
  }
  for (let t = 0; t < N; t += 22) for (const k of [8, N / 2 + 8, N / 2 - 8, N - 8]) {
    for (const [x, y] of [[t, k], [k, t]]) { a.fillStyle = 'rgba(60,52,110,0.35)'; a.beginPath(); a.arc(x, y, 2.4, 0, 7); a.fill(); h.fillStyle = '#c4c4c4'; h.beginPath(); h.arc(x, y, 2.8, 0, 7); h.fill(); }
  }
  for (let i = 0; i < 160; i++) { a.fillStyle = `rgba(${rand() < 0.7 ? '50,44,60' : '255,255,255'},${0.03 + rand() * 0.07})`; a.fillRect(rand() * N, rand() * N, 4 + rand() * 80, 1 + rand() * 4); }
  const map = tex(A.c, true, true), normalMap = tex(normalFromHeight(B.c, 3), false, true);
  for (const t of [map, normalMap]) t.repeat.set(1.35, 1.6);
  return new THREE.MeshPhysicalMaterial({ map, normalMap, roughness: 0.42, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
}

/** Wing undersides: black thermal tiles in a grid, each a slightly different tone, with dark gaps. */
export function wingUnderMaterial() {
  const N = 1024, T = 64;
  const A = mk(N, N), B = mk(N, N), R = mk(N, N);
  const a = A.g, h = B.g, r = R.g, rand = rng(1717);
  a.fillStyle = '#050506'; a.fillRect(0, 0, N, N); h.fillStyle = '#2a2a2a'; h.fillRect(0, 0, N, N); r.fillStyle = 'rgb(225,225,225)'; r.fillRect(0, 0, N, N);
  for (let y = 0; y < N; y += T) for (let x = 0; x < N; x += T) {
    const tone = 18 + Math.floor(rand() * 20), scorch = rand() < 0.05 ? 30 : 0;
    a.fillStyle = `rgb(${tone + scorch},${tone + scorch},${tone + scorch + 4})`; a.fillRect(x + 3, y + 3, T - 6, T - 6);
    h.fillStyle = `rgb(${150 + Math.floor(rand() * 20)},150,150)`; h.fillRect(x + 4, y + 4, T - 8, T - 8);
    r.fillStyle = `rgb(${200 + Math.floor(rand() * 40)},${200 + Math.floor(rand() * 40)},210)`; r.fillRect(x + 3, y + 3, T - 6, T - 6);
  }
  const map = tex(A.c, true, true), normalMap = tex(normalFromHeight(B.c, 3), false, true), roughnessMap = tex(R.c, false, true);
  for (const t of [map, normalMap, roughnessMap]) t.repeat.set(2, 5);
  return new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0.05, clearcoat: 0.1 });
}

/** Gold Kapton blanket: crumpled foil with aluminium-tape seams. */
export function foilMaterial() {
  const N = 1024;
  const A = mk(N, N), B = mk(N, N);
  const a = A.g, h = B.g, rand = rng(9090);
  a.fillStyle = '#b3862c'; a.fillRect(0, 0, N, N); h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
  // Random facets, drawn with wrap-around copies so the tile is seamless.
  for (let i = 0; i < 700; i++) {
    const x = rand() * N, y = rand() * N, s = 40 + rand() * 120;
    const p = [[0, 0], [s * (0.6 + rand() * 0.8), s * (rand() - 0.3)], [s * (rand() - 0.2), s * (0.6 + rand() * 0.8)]];
    const gray = Math.floor(rand() * 255);
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      a.fillStyle = `rgba(${gray < 128 ? '90,50,10' : '255,225,140'},${Math.abs(gray - 128) / 128 * 0.2})`;
      h.fillStyle = `rgb(${gray},${gray},${gray})`;
      for (const g of [a, h]) { g.beginPath(); g.moveTo(x + dx + p[0][0], y + dy + p[0][1]); g.lineTo(x + dx + p[1][0], y + dy + p[1][1]); g.lineTo(x + dx + p[2][0], y + dy + p[2][1]); g.closePath(); g.fill(); }
    }
  }
  const map = tex(A.c, true, true), normalMap = tex(normalFromHeight(B.c, 3.5), false, true);
  for (const t of [map, normalMap]) t.repeat.set(1.5, 1.5);
  return new THREE.MeshPhysicalMaterial({ map, normalMap, normalScale: new THREE.Vector2(1, 1), metalness: 1, roughness: 0.3, color: 0xffffff, envMapIntensity: 1.8, clearcoat: 0.2 });
}

/** Rocket nozzle: tempered-steel bands from throat to lip, soot streaks, burnt edge. */
export function bellMaterial() {
  const W = 512, H = 512;
  const A = mk(W, H), B = mk(W, H), R = mk(W, H);
  const a = A.g, h = B.g, r = R.g, rand = rng(2468);
  // Cylinder v runs bottom→top; the throat (narrow) end is v = 0, the lip v = 1.
  const g = a.createLinearGradient(0, H, 0, 0);
  for (const [t, c] of [[0, '#2c2a2e'], [0.12, '#4a4854'], [0.28, '#7b5a2a'], [0.42, '#a58a3a'], [0.55, '#3b4c8f'], [0.75, '#6e707a'], [1, '#9a9ca6']] as const) g.addColorStop(t, c);
  a.fillStyle = g; a.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  r.fillStyle = 'rgb(115,115,115)'; r.fillRect(0, 0, W, H);
  for (let i = 0; i < 160; i++) { // soot streaks running down the bell
    const x = rand() * W, w = 2 + rand() * 12, y = rand() * H * 0.5;
    const s = a.createLinearGradient(0, y, 0, y + H * 0.6);
    s.addColorStop(0, 'rgba(8,6,6,0)'); s.addColorStop(0.2, `rgba(8,6,6,${0.18 + rand() * 0.3})`); s.addColorStop(1, 'rgba(8,6,6,0)');
    a.fillStyle = s; a.fillRect(x, y, w, H * 0.6);
    r.fillStyle = 'rgba(210,210,210,0.35)'; r.fillRect(x, y, w, H * 0.5);
  }
  for (let y = 0; y < H; y += 3) { h.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; h.fillRect(0, y, W, 1); }
  for (let x = 0; x < W; x += 32) { h.fillStyle = '#d0d0d0'; h.fillRect(x, 0, 3, H); } // cooling-tube ribs
  const map = tex(A.c, true, true), normalMap = tex(normalFromHeight(B.c, 4), false, true), roughnessMap = tex(R.c, false, true);
  return new THREE.MeshPhysicalMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0.95, side: THREE.DoubleSide, envMapIntensity: 1.5 });
}

export function shuttleMaterials(): ShuttleMaterials {
  const violet = pbrSet('painted-metal', { albedo: recolouredPaint(0x6d5bd0), normal: 0.7, roughness: 0.8, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  violet.metalness = 0.4;
  const chrome = pbrSet('brushed-aluminium', { color: 0xe8e4f4, normal: 0.6, roughness: 0.55 });
  const canopy = new THREE.MeshPhysicalMaterial({ color: 0x030914, metalness: 0.2, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3.4, ior: 1.55, transparent: false, opacity: 1, depthWrite: true, emissive: 0x092f45, emissiveIntensity: 0.16 });
  return { paint: hullMaterial(), wing: wingMaterial(), wingBottom: wingUnderMaterial(), violet, nacelle: foilMaterial(), bell: bellMaterial(), chrome, canopy };
}
