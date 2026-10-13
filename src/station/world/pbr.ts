// Physically based surfaces for the station. Two sources:
//   · CC0 photo scans from public/textures (ambientCG, see LICENSE.txt there),
//     loaded as full PBR sets: albedo, normal (GL), roughness, metalness, AO;
//   · procedural maps built once on canvas for things no scan covers: quilted
//     beta-cloth wall blankets, glass smudges, light diffusers.
// Normal maps for procedural surfaces come from a height field via a Sobel pass.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

function file(url: string, srgb: boolean) {
  const hit = cache.get(url);
  if (hit) return hit;
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(url, t);
  return t;
}

export type SetName = 'brushed-aluminium' | 'carbon-weave' | 'painted-metal' | 'fabric-weave' | 'diamond-plate' | 'hangar-floor' | 'rubber';
const HAS_METAL: SetName[] = ['brushed-aluminium', 'carbon-weave', 'painted-metal', 'diamond-plate'];
const HAS_AO: SetName[] = ['fabric-weave', 'diamond-plate'];

export interface SetOpts {
  /** Multiplies the albedo; leave white to keep the scan's colour. */
  color?: THREE.ColorRepresentation;
  normal?: number;
  roughness?: number;
  /** Used only for sets that ship no metalness map. */
  metalness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** Replace the albedo map (for recoloured scans). */
  albedo?: THREE.Texture;
}

/**
 * A scan as a physical material. Each scan loads once and is shared; scale the
 * mesh's UVs with `scaleUV` to set how often it repeats (a texture clone made
 * before the image arrives would stay empty).
 */
export function pbrSet(name: SetName, o: SetOpts = {}) {
  const base = `/textures/${name}/`;
  const m = new THREE.MeshPhysicalMaterial({
    map: o.albedo ?? file(base + 'albedo.jpg', true),
    normalMap: file(base + 'normal.jpg', false),
    normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1),
    roughnessMap: file(base + 'roughness.jpg', false),
    roughness: o.roughness ?? 1,
    color: o.color ?? 0xffffff,
    clearcoat: o.clearcoat ?? 0,
    clearcoatRoughness: o.clearcoatRoughness ?? 0.2,
  });
  if (HAS_METAL.includes(name)) { m.metalnessMap = file(base + 'metalness.jpg', false); m.metalness = 1; }
  else m.metalness = o.metalness ?? 0;
  if (HAS_AO.includes(name)) { m.aoMap = file(base + 'ao.jpg', false); m.aoMapIntensity = 0.9; }
  return m;
}

/** Multiplies a geometry's UVs: `u`/`v` are repeat counts across its 0..1 range. */
export function scaleUV(geo: THREE.BufferGeometry, u: number, v: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  uv.needsUpdate = true;
  return geo;
}

/**
 * The red chipped-paint scan, recoloured: painted pixels take `hex`, keeping
 * the scan's light/dark mottling; worn-through pixels stay bare metal grey.
 * Returns a texture that fills in once the scan has loaded.
 */
export function recolouredPaint(hex: number) {
  const key = `paint-${hex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d')!;
  g.fillStyle = '#' + hex.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 2048, 2048);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  cache.set(key, t);
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, 2048, 2048);
    const d = g.getImageData(0, 0, 2048, 2048), p = d.data;
    const tr = (hex >> 16) & 255, tg = (hex >> 8) & 255, tb = hex & 255;
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], gg = p[i + 1];
      const paint = Math.min(1, Math.max(0, (r - gg + 25) / 55)); // mostly intact paint; only the deepest chips show metal
      const lum = 0.78 + 0.3 * (r / 255);
      p[i] = tr * lum * paint + gg * 0.95 * (1 - paint);
      p[i + 1] = tg * lum * paint + gg * 0.95 * (1 - paint);
      p[i + 2] = tb * lum * paint + p[i + 2] * 0.95 * (1 - paint);
    }
    g.putImageData(d, 0, 0);
    t.needsUpdate = true;
  };
  img.src = '/textures/painted-metal/albedo.jpg';
  return t;
}

// ---------- procedural helpers ----------

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function surface(n: number) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return { c, g: c.getContext('2d')!, n };
}

/** Height canvas (grey = flat, bright = high) to a tangent-space normal map. */
export function normalFromHeight(h: HTMLCanvasElement, strength: number) {
  const n = h.width;
  const src = h.getContext('2d')!.getImageData(0, 0, n, n).data;
  const out = surface(n);
  const dst = out.g.createImageData(n, n);
  const at = (x: number, y: number) => src[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * n + x) * 4;
    dst.data[i] = (nx * 0.5 + 0.5) * 255; dst.data[i + 1] = (ny * 0.5 + 0.5) * 255; dst.data[i + 2] = (nz * 0.5 + 0.5) * 255; dst.data[i + 3] = 255;
  }
  out.g.putImageData(dst, 0, 0);
  return out.c;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Blanket { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture; metalnessMap: THREE.Texture; aoMap: THREE.Texture; /** Metres the tile covers. */ tile: number }

let blanketCache: Blanket | null = null;

/**
 * Quilted beta-cloth/Nomex wall blankets, 4×4 pillows (0.4 m each) per 1.6 m tile
 * (about 1280 px/m). Woven cloth, taped binding at the seams, stitch rows, brass
 * snap grommets, grime gathered in the seams, scuffs and fingerprints.
 */
export function quiltedBlanket(): Blanket {
  if (blanketCache) return blanketCache;
  const N = 2048, PIL = 4, CELL = N / PIL, BIND = 30;
  const r = rng(4242);
  const A = surface(N), Hh = surface(N), R = surface(N), M = surface(N), O = surface(N);
  const ad = A.g.createImageData(N, N), hd = Hh.g.createImageData(N, N);
  const rd = R.g.createImageData(N, N), md = M.g.createImageData(N, N), od = O.g.createImageData(N, N);
  // Cheap value noise for mottling, wrapped so the tile stays seamless.
  const G = 64, grid = new Float32Array(G * G).map(() => r());
  const vnoise = (x: number, y: number) => {
    const fx = (x / N) * G, fy = (y / N) * G;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const v = (a: number, b: number) => grid[((b % G + G) % G) * G + ((a % G + G) % G)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // Distance to the nearest pillow edge (cells wrap, so seams tile).
    const cx = x % CELL, cy = y % CELL;
    const d = Math.min(cx, cy, CELL - 1 - cx, CELL - 1 - cy);
    const dome = smooth(BIND * 0.6, CELL * 0.3, d);              // pillow puff
    const bind = smooth(BIND, BIND - 6, d);                        // taped edge band
    // Cloth weave: two thread directions, 4 px pitch.
    const wv = (Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2)) * 0.5 + 0.5;
    const weave = 0.5 + 0.5 * Math.sin(x * Math.PI / 2 + Math.sin(y * 0.5) * 0.6) * Math.cos(y * Math.PI / 2);
    const mott = vnoise(x, y) * 0.6 + vnoise(x * 3.1 + 17, y * 3.1 + 9) * 0.4;
    const i = (y * N + x) * 4;
    // Height: dome + binding step + weave.
    const hgt = 0.18 + dome * 0.5 + (1 - bind) * 0.0 + bind * 0.06 + weave * 0.05 * (1 - bind * 0.5) + (mott - 0.5) * 0.04;
    const hv = Math.max(0, Math.min(1, hgt)) * 255;
    hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;
    // Albedo: warm off-white cloth, tape slightly greyer, dirt collects in seams.
    const grime = (1 - smooth(0, BIND * 1.6, d)) * 0.18 + (mott - 0.5) * 0.16;
    const shade = (0.8 + dome * 0.2) * (0.96 + weave * 0.06) * (1 - grime);
    const tape = bind;
    ad.data[i] = (206 * (1 - tape) + 184 * tape) * shade;
    ad.data[i + 1] = (203 * (1 - tape) + 182 * tape) * shade;
    ad.data[i + 2] = (192 * (1 - tape) + 172 * tape) * shade;
    ad.data[i + 3] = 255;
    // Roughness: cloth is very matte; the tape and worn spots slightly less.
    const rough = 0.86 + (weave - 0.5) * 0.06 - bind * 0.1 - (mott > 0.78 ? 0.08 : 0);
    rd.data[i] = rd.data[i + 2] = 0; rd.data[i + 1] = rough * 255; rd.data[i + 3] = 255;
    md.data[i] = md.data[i + 1] = md.data[i + 2] = 0; md.data[i + 3] = 255;
    const ao = 0.55 + 0.45 * smooth(0, BIND * 1.4, d) * (0.9 + dome * 0.1);
    od.data[i] = od.data[i + 1] = od.data[i + 2] = ao * 255; od.data[i + 3] = 255;
  }
  A.g.putImageData(ad, 0, 0); Hh.g.putImageData(hd, 0, 0); R.g.putImageData(rd, 0, 0); M.g.putImageData(md, 0, 0); O.g.putImageData(od, 0, 0);

  // Stitch rows run just inside the binding on every pillow (dashes pressed into the cloth).
  const stitch = (g: CanvasRenderingContext2D, col: string, w: number) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    for (let gx = 0; gx < PIL; gx++) for (let gy = 0; gy < PIL; gy++) {
      const x0 = gx * CELL, y0 = gy * CELL, o = BIND + 10, e = CELL - BIND - 10;
      g.beginPath();
      for (let s = o + 6; s < e; s += 14) {
        g.moveTo(x0 + s, y0 + o); g.lineTo(x0 + s + 8, y0 + o);
        g.moveTo(x0 + s, y0 + e); g.lineTo(x0 + s + 8, y0 + e);
        g.moveTo(x0 + o, y0 + s); g.lineTo(x0 + o, y0 + s + 8);
        g.moveTo(x0 + e, y0 + s); g.lineTo(x0 + e, y0 + s + 8);
      }
      g.stroke();
    }
  };
  stitch(A.g, 'rgba(70,64,52,0.55)', 3.2);
  stitch(Hh.g, 'rgba(20,20,20,0.9)', 4);
  // Brass snap grommets at pillow corners, and a few scuffs / fingerprints.
  for (let gx = 0; gx < PIL; gx++) for (let gy = 0; gy < PIL; gy++) {
    for (const [ox, oy] of [[BIND * 1.9, BIND * 1.9], [CELL - BIND * 1.9, BIND * 1.9], [BIND * 1.9, CELL - BIND * 1.9], [CELL - BIND * 1.9, CELL - BIND * 1.9]]) {
      const px = gx * CELL + ox, py = gy * CELL + oy;
      for (const [cv, fill] of [[A.g, '#b79b55'], [M.g, '#ffffff'], [R.g, 'rgb(0,90,0)']] as const) {
        cv.fillStyle = fill; cv.beginPath(); cv.arc(px, py, 10, 0, 7); cv.fill();
      }
      Hh.g.fillStyle = '#d0d0d0'; Hh.g.beginPath(); Hh.g.arc(px, py, 10, 0, 7); Hh.g.fill();
      Hh.g.fillStyle = '#707070'; Hh.g.beginPath(); Hh.g.arc(px, py, 5, 0, 7); Hh.g.fill();
      A.g.fillStyle = '#6b5a2e'; A.g.beginPath(); A.g.arc(px, py, 4, 0, 7); A.g.fill();
    }
  }
  for (let k = 0; k < 90; k++) {
    const x = r() * N, y = r() * N, len = 20 + r() * 140, a = r() * Math.PI;
    A.g.strokeStyle = `rgba(${r() < 0.6 ? '60,56,48' : '255,252,240'},${0.04 + r() * 0.08})`;
    A.g.lineWidth = 2 + r() * 6;
    A.g.beginPath(); A.g.moveTo(x, y); A.g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); A.g.stroke();
  }
  for (let k = 0; k < 40; k++) { // fingerprints: slightly shinier, slightly greasy ovals
    const x = r() * N, y = r() * N;
    R.g.fillStyle = 'rgba(0,70,0,0.35)'; R.g.beginPath(); R.g.ellipse(x, y, 16 + r() * 8, 22 + r() * 8, r() * 3, 0, 7); R.g.fill();
    A.g.fillStyle = 'rgba(80,72,56,0.07)'; A.g.beginPath(); A.g.ellipse(x, y, 16 + r() * 8, 22 + r() * 8, r() * 3, 0, 7); A.g.fill();
  }

  // Pack: AO in R, roughness in G, metalness in B, so one ORM-style read feeds all three.
  const orm = surface(N), od2 = orm.g.createImageData(N, N);
  const ao = O.g.getImageData(0, 0, N, N).data, ro = R.g.getImageData(0, 0, N, N).data, me = M.g.getImageData(0, 0, N, N).data;
  for (let i = 0; i < od2.data.length; i += 4) { od2.data[i] = ao[i]; od2.data[i + 1] = ro[i + 1]; od2.data[i + 2] = me[i]; od2.data[i + 3] = 255; }
  orm.g.putImageData(od2, 0, 0);

  const ormTex = toTexture(orm.c, false);
  blanketCache = {
    map: toTexture(A.c, true),
    normalMap: toTexture(normalFromHeight(Hh.c, 4), false),
    roughnessMap: ormTex, metalnessMap: ormTex, aoMap: ormTex, tile: 1.6,
  };
  return blanketCache;
}

/** Wall blanket material; UVs must be in tiles (use `tileUV`). */
export function blanketMaterial() {
  const b = quiltedBlanket();
  const m = new THREE.MeshPhysicalMaterial({
    map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: b.roughnessMap, roughness: 1, metalnessMap: b.metalnessMap, metalness: 1,
    aoMap: b.aoMap, aoMapIntensity: 0.85, sheen: 0.5, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xfff6e6),
  });
  m.userData.tile = b.tile;
  return m;
}

/** Rewrites a geometry's 0..1 UVs into metres/tile, offset by `(u0, v0)` metres. */
export function tileUV(geo: THREE.BufferGeometry, w: number, h: number, tile: number, u0 = 0, v0 = 0) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + uv.getX(i) * w) / tile, (v0 + uv.getY(i) * h) / tile);
  uv.needsUpdate = true;
}

let smudgeTex: THREE.Texture | null = null;
/** Glass roughness: clean at the middle, greasy hand-prints and wiped streaks. */
export function glassSmudge() {
  if (smudgeTex) return smudgeTex;
  const { c, g, n } = surface(1024);
  const r = rng(77);
  g.fillStyle = 'rgb(0,18,0)'; g.fillRect(0, 0, n, n); // G channel is roughness
  for (let k = 0; k < 70; k++) {
    const x = r() * n, y = r() * n, rad = 18 + r() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(0,${90 + r() * 90},0,${0.25 + r() * 0.35})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.lineCap = 'round';
  for (let k = 0; k < 26; k++) { // wipe arcs
    const x = r() * n, y = r() * n;
    g.strokeStyle = `rgba(0,${60 + r() * 60},0,0.22)`; g.lineWidth = 14 + r() * 30;
    g.beginPath(); g.arc(x, y, 60 + r() * 180, r() * 6, r() * 6 + 1.2); g.stroke();
  }
  smudgeTex = toTexture(c, false);
  return smudgeTex;
}

let diffuserTex: THREE.Texture | null = null;
/** An emissive light-panel diffuser: soft prisms, a bright core and dim edges. */
export function lightDiffuser() {
  if (diffuserTex) return diffuserTex;
  const { c, g, n } = surface(512);
  g.fillStyle = '#fff8ec'; g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(180,170,150,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < n; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, n); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(n, i); g.stroke(); }
  const v = g.createRadialGradient(n / 2, n / 2, n * 0.2, n / 2, n / 2, n * 0.75);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(1, 'rgba(90,80,60,0.55)');
  g.fillStyle = v; g.fillRect(0, 0, n, n);
  g.strokeStyle = '#2c2c32'; g.lineWidth = 14; g.strokeRect(0, 0, n, n);
  diffuserTex = toTexture(c, true);
  return diffuserTex;
}

/** A printed label plate: engraved or screen-printed text on a coloured ground. */
export function plateTexture(lines: string[], opts: { bg?: string; fg?: string; w?: number; h?: number; font?: number } = {}) {
  const { bg = '#e9e6de', fg = '#16161b', w = 512, h = 256, font = 54 } = opts;
  const key = `plate-${lines.join('|')}-${bg}-${w}x${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { c, g } = surface(Math.max(w, h));
  c.width = w; c.height = h;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg; g.textAlign = 'center'; g.font = `700 ${font}px "Helvetica Neue", Arial, sans-serif`;
  const lh = font * 1.18, y0 = h / 2 - ((lines.length - 1) * lh) / 2 + font * 0.34;
  lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));
  for (const [x, y] of [[26, 26], [w - 26, 26], [26, h - 26], [w - 26, h - 26]]) { g.fillStyle = '#8c8c94'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
  const t = toTexture(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}
