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
  const W = h.width, H = h.height;
  const src = h.getContext('2d')!.getImageData(0, 0, W, H).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const og = out.getContext('2d')!;
  const dst = og.createImageData(W, H);
  const at = (x: number, y: number) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * W + x) * 4;
    dst.data[i] = (nx * 0.5 + 0.5) * 255; dst.data[i + 1] = (ny * 0.5 + 0.5) * 255; dst.data[i + 2] = (nz * 0.5 + 0.5) * 255; dst.data[i + 3] = 255;
  }
  og.putImageData(dst, 0, 0);
  return out;
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
    map: b.map, normalMap: b.normalMap, normalScale: new THREE.Vector2(0.45, 0.45),
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


// ---------- rack modules ----------

export const RACK_MODULES = 8;
export const RACK_MODULE_ASPECT = 1024 / 560; // width : height, a 1.0 × 0.55 m face
const rackCache = new Map<number, { map: THREE.Texture; normalMap: THREE.Texture }>();

/**
 * One 1.0 × 0.55 m rack module face at 1024 px/m: albedo plus a normal map
 * baked from a height canvas (screws, recessed panels, engraved text).
 * Stacked five high they make an ISS rack front; each kind is built once.
 */
export function rackModule(kind: number) {
  const hit = rackCache.get(kind);
  if (hit) return hit;
  const W = 1024, H = 560;
  const A = document.createElement('canvas'); A.width = W; A.height = H;
  const B = document.createElement('canvas'); B.width = W; B.height = H;
  const a = A.getContext('2d')!, h = B.getContext('2d')!;
  const r = rng(900 + kind * 37);
  // Anodised off-white with a warm yellowing, flat in height.
  a.fillStyle = '#cdcac2'; a.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  const rect = (x: number, y: number, w: number, hh: number, fill: string, hv: number, line?: string, lw = 3) => {
    a.fillStyle = fill; a.fillRect(x, y, w, hh);
    h.fillStyle = `rgb(${hv},${hv},${hv})`; h.fillRect(x, y, w, hh);
    if (line) { a.strokeStyle = line; a.lineWidth = lw; a.strokeRect(x, y, w, hh); h.strokeStyle = '#3a3a3a'; h.lineWidth = lw; h.strokeRect(x, y, w, hh); }
  };
  const screw = (x: number, y: number, rad = 9) => {
    a.fillStyle = '#9a9ca4'; a.beginPath(); a.arc(x, y, rad, 0, 7); a.fill();
    a.strokeStyle = '#2f3037'; a.lineWidth = 2; a.beginPath(); a.arc(x, y, rad, 0, 7); a.stroke();
    a.beginPath(); a.moveTo(x - rad * 0.6, y); a.lineTo(x + rad * 0.6, y); a.stroke();
    h.fillStyle = '#c8c8c8'; h.beginPath(); h.arc(x, y, rad, 0, 7); h.fill();
    h.strokeStyle = '#303030'; h.lineWidth = 3; h.beginPath(); h.moveTo(x - rad * 0.6, y); h.lineTo(x + rad * 0.6, y); h.stroke();
  };
  const text = (t: string, x: number, y: number, px: number, col = '#18181d', align: CanvasTextAlign = 'left', bold = true) => {
    for (const g of [a, h]) {
      g.font = `${bold ? 700 : 500} ${px}px "Helvetica Neue", Arial, sans-serif`; g.textAlign = align;
    }
    a.fillStyle = col; a.fillText(t, x, y);
    h.fillStyle = '#5a5a5a'; h.fillText(t, x, y);
  };
  const led = (x: number, y: number, col: string) => {
    a.fillStyle = '#17181c'; a.beginPath(); a.arc(x, y, 14, 0, 7); a.fill();
    a.fillStyle = col; a.beginPath(); a.arc(x, y, 9, 0, 7); a.fill();
    h.fillStyle = '#505050'; h.beginPath(); h.arc(x, y, 14, 0, 7); h.fill();
    h.fillStyle = '#9a9a9a'; h.beginPath(); h.arc(x, y, 9, 0, 7); h.fill();
  };
  const handle = (x: number, y: number, w: number) => {
    rect(x, y, w, 26, '#3b3d45', 205, '#1e1f24', 2);
    a.fillStyle = 'rgba(255,255,255,0.25)'; a.fillRect(x + 4, y + 3, w - 8, 5);
  };
  // Module frame: border seam and corner screws on every kind.
  const frame = () => {
    rect(0, 0, W, 8, '#a9a69d', 110); rect(0, H - 8, W, 8, '#a9a69d', 110);
    rect(0, 0, 8, H, '#a9a69d', 110); rect(W - 8, 0, 8, H, '#a9a69d', 110);
    for (const [x, y] of [[28, 28], [W - 28, 28], [28, H - 28], [W - 28, H - 28]]) screw(x, y);
  };
  const palette = ['#2f7bd6', '#b3261e', '#e0a60f', '#2b8a3e'];
  switch (kind % RACK_MODULES) {
    case 0: // two stowage drawers
      for (let i = 0; i < 2; i++) {
        const y = 40 + i * 255;
        rect(48, y, W - 96, 230, '#dbd8d0', 140, '#6a6b72', 4);
        rect(60, y + 12, W - 120, 206, '#d3d0c8', 126, '#8a8b92', 2);
        handle(W / 2 - 90, y + 96, 180);
        text(`M${100 + Math.floor(r() * 899)}`, 80, y + 52, 38, '#1c4fa8');
        text(['CREW PROVISIONS', 'SPARE FILTERS', 'MED SUPPLIES', 'CABLES · ETHERNET', 'MAINT KIT'][Math.floor(r() * 5)], 80, y + 200, 28, '#2b2b32');
        for (const [x, yy] of [[W - 90, y + 30], [W - 90, y + 200]]) screw(x, yy, 8);
        rect(W - 190, y + 40, 80, 40, '#f3f1ea', 150, '#44454c', 2); text('LOCK', W - 150, y + 70, 20, '#222', 'center');
      }
      break;
    case 1: { // breaker / switch panel with LEDs
      rect(40, 40, W - 80, 480, '#d6d3cb', 135, '#6a6b72', 4);
      rect(70, 70, 420, 150, '#17181c', 70, '#44454c', 3);
      for (let i = 0; i < 14; i++) led(100 + (i % 7) * 58, 108 + Math.floor(i / 7) * 58, r() < 0.7 ? '#2fdc6b' : r() < 0.5 ? '#f2a516' : '#6b8cff');
      text('PWR BUS 2A', 520, 110, 34, '#17181c'); text('28.1 V · 14.2 A', 520, 160, 28, '#2b2b32', 'left', false);
      for (let i = 0; i < 9; i++) { // breaker row
        const x = 70 + i * 100;
        rect(x, 270, 74, 120, '#2c2d33', 190, '#17181c', 3);
        rect(x + 14, r() < 0.5 ? 282 : 330, 46, 52, '#c9ccd2', 215, '#17181c', 2);
        text(String(i + 1), x + 37, 420, 24, '#2b2b32', 'center');
      }
      rect(70, 440, 320, 54, '#b3261e', 150, '#600', 3); text('CAUTION', 230, 480, 36, '#fff', 'center');
      text('DO NOT OPEN IN FLIGHT', 420, 480, 24, '#2b2b32', 'left', false);
      break;
    }
    case 2: // standby display panel (nothing is live here)
      rect(50, 50, W - 100, 460, '#d6d3cb', 135, '#6a6b72', 4);
      rect(90, 90, W - 180, 320, '#07090c', 60, '#3b3d45', 6);
      a.fillStyle = 'rgba(80,200,150,0.07)'; for (let y = 96; y < 404; y += 5) a.fillRect(98, y, W - 196, 1);
      text('STANDBY', W / 2, 270, 52, '#1f6f55', 'center');
      text('NO DATA LINK', W / 2, 320, 26, '#175040', 'center', false);
      for (let i = 0; i < 6; i++) { rect(110 + i * 140, 430, 110, 50, '#2c2d33', 190, '#17181c', 3); text(['MENU', '◀', '▶', 'SEL', 'BRT', 'PWR'][i], 165 + i * 140, 465, 22, '#d4d6dc', 'center'); }
      break;
    case 3: // louvre vent
      rect(50, 50, W - 100, 460, '#c4c1b9', 130, '#6a6b72', 4);
      for (let y = 80; y < 480; y += 20) { rect(80, y, W - 160, 12, '#26272c', 60); a.fillStyle = 'rgba(255,255,255,0.12)'; a.fillRect(80, y + 10, W - 160, 2); }
      rect(W / 2 - 200, 470, 400, 36, '#e9c11b', 160, '#444', 2); text('KEEP CLEAR · AIRFLOW', W / 2, 498, 22, '#111', 'center');
      break;
    case 4: // cargo transfer bag strapped on
      rect(40, 36, W - 80, 490, '#bdb9ae', 118);
      a.fillStyle = '#e4dcc4'; a.beginPath(); a.roundRect(80, 70, W - 160, 420, 46); a.fill();
      h.fillStyle = '#a0a0a0'; h.beginPath(); h.roundRect(80, 70, W - 160, 420, 46); h.fill();
      a.strokeStyle = '#8f866e'; a.lineWidth = 4; a.setLineDash([16, 10]); a.beginPath(); a.roundRect(104, 94, W - 208, 372, 34); a.stroke(); a.setLineDash([]);
      for (const y of [140, 400]) { rect(60, y, W - 120, 56, '#1c1c22', 190); a.fillStyle = '#34343c'; for (let x = 70; x < W - 70; x += 12) a.fillRect(x, y + 6, 6, 44); }
      rect(W / 2 - 150, 235, 300, 100, '#f6f6f2', 150, '#222', 3); text(`CTB ${1000 + Math.floor(r() * 8999)}`, W / 2, 292, 44, '#111', 'center'); text('WATER · FOOD · MISC', W / 2, 322, 20, '#444', 'center', false);
      break;
    case 5: // science locker with quarter-turn fasteners and a patch
      rect(40, 40, W - 80, 480, '#dad7cf', 138, '#6a6b72', 4);
      for (let i = 0; i < 4; i++) { const x = 90 + i * 215; a.fillStyle = '#3b3d45'; a.beginPath(); a.arc(x + 20, 120, 34, 0, 7); a.fill(); rect(x - 4, 112, 48, 16, '#d6d8de', 190, '#111', 2); h.fillStyle = '#5a5a5a'; h.beginPath(); h.arc(x + 20, 120, 34, 0, 7); h.fill(); h.fillStyle = '#b0b0b0'; h.fillRect(x - 4, 112, 48, 16); }
      rect(90, 200, 380, 250, '#e9e6de', 150, '#44454c', 3);
      text('EXPRESS RACK 4', 110, 250, 34, '#17181c'); text('PLANT HABITAT · MICROBIOME', 110, 292, 22, '#333', 'left', false);
      for (let i = 0; i < 4; i++) { led(130 + i * 56, 360, palette[i]); }
      a.fillStyle = '#0b0618'; a.beginPath(); a.arc(750, 330, 120, 0, 7); a.fill(); a.strokeStyle = '#836ef9'; a.lineWidth = 12; a.stroke();
      a.fillStyle = '#836ef9'; a.beginPath(); a.moveTo(750, 240); a.lineTo(790, 330); a.lineTo(750, 312); a.lineTo(710, 330); a.closePath(); a.fill();
      text('MONAD × NANSEN', 750, 400, 20, '#efeaff', 'center');
      h.fillStyle = '#9a9a9a'; h.beginPath(); h.arc(750, 330, 120, 0, 7); h.fill();
      break;
    case 6: // quick-disconnect fluid panel
      rect(40, 40, W - 80, 480, '#d2cfc7', 134, '#6a6b72', 4);
      for (let i = 0; i < 4; i++) {
        const x = 150 + i * 235;
        a.fillStyle = palette[i]; a.beginPath(); a.arc(x, 220, 62, 0, 7); a.fill();
        a.fillStyle = '#17181c'; a.beginPath(); a.arc(x, 220, 40, 0, 7); a.fill();
        a.fillStyle = '#9a9ca4'; a.beginPath(); a.arc(x, 220, 20, 0, 7); a.fill();
        h.fillStyle = '#b0b0b0'; h.beginPath(); h.arc(x, 220, 62, 0, 7); h.fill(); h.fillStyle = '#404040'; h.beginPath(); h.arc(x, 220, 40, 0, 7); h.fill(); h.fillStyle = '#909090'; h.beginPath(); h.arc(x, 220, 20, 0, 7); h.fill();
        text(['H₂O IN', 'H₂O OUT', 'N₂', 'VAC'][i], x, 340, 30, '#17181c', 'center');
        rect(x - 52, 365, 104, 22, '#f2d24b', 155, '#333', 2);
        for (const dx of [-80, 80]) screw(x + dx, 220, 8);
      }
      text('FLUIDS · QD PANEL 6', 80, 470, 30, '#2b2b32');
      break;
    default: // stencilled stowage with velcro and a tape label
      rect(40, 40, W - 80, 480, '#d8d5cd', 136, '#6a6b72', 4);
      text('STOWAGE', W / 2, 190, 96, '#8b8b93', 'center');
      for (let i = 0; i < 3; i++) { rect(120 + i * 290, 250, 240, 190, '#1c1c22', 190); a.fillStyle = '#30303a'; for (let x = 128 + i * 290; x < 352 + i * 290; x += 10) a.fillRect(x, 258, 5, 174); }
      a.save(); a.translate(240, 470); a.rotate(-0.04); a.fillStyle = '#f1e7a8'; a.fillRect(-110, -26, 220, 52); a.fillStyle = '#2a2a2a'; a.font = '22px "Marker Felt", "Comic Sans MS", sans-serif'; a.textAlign = 'center'; a.fillText('spare socks (mine)', 0, 8); a.restore();
  }
  frame();
  // Wear: scuffs, grime along the seams, fingerprints and a faint yellowing.
  for (let i = 0; i < 160; i++) {
    a.fillStyle = `rgba(${r() < 0.7 ? '40,38,30' : '255,252,240'},${0.03 + r() * 0.06})`;
    a.fillRect(r() * W, r() * H, 3 + r() * 70, 1 + r() * 4);
  }
  const gr = a.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,240,200,0.05)'); gr.addColorStop(1, 'rgba(60,50,30,0.12)');
  a.fillStyle = gr; a.fillRect(0, 0, W, H);
  for (let i = 0; i < 18; i++) { a.fillStyle = 'rgba(70,64,50,0.07)'; a.beginPath(); a.ellipse(r() * W, r() * H, 14 + r() * 8, 20 + r() * 8, r() * 3, 0, 7); a.fill(); }

  const map = new THREE.CanvasTexture(A); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(B, 3)); normalMap.anisotropy = 16;
  const out = { map, normalMap };
  rackCache.set(kind, out);
  return out;
}
