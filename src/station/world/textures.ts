// Procedural surface detail for the station: every texture is drawn on a
// canvas once and shared. Panel seams, screw heads, wear, labels and rack
// faces carry the detail; geometry stays simple and instanced.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(key: string, draw: () => HTMLCanvasElement, srgb = true, repeat?: [number, number]) {
  const k = key + (repeat ? repeat.join('x') : '');
  const hit = cache.get(k);
  if (hit) return hit;
  const t = new THREE.CanvasTexture(draw());
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  cache.set(k, t);
  return t;
}

function rnd(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function screw(g: CanvasRenderingContext2D, x: number, y: number, r = 3) {
  g.fillStyle = '#9a9aa6'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a4a55'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - r * 0.6, y); g.lineTo(x + r * 0.6, y); g.stroke();
}

function wear(g: CanvasRenderingContext2D, w: number, h: number, seed: number, n = 120) {
  const r = rnd(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.04})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 18, 1 + r() * 3);
  }
}

/** Wall panels: off-white anodised plates, seams, screws, scuffs. */
export function panelTexture(repeat: [number, number] = [1, 1]) {
  return tex('panel', () => {
    const { c, g } = canvas(512, 512);
    g.fillStyle = '#d9d7d2'; g.fillRect(0, 0, 512, 512);
    const r = rnd(7);
    for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 256) {
      const tone = 205 + Math.floor(r() * 22);
      g.fillStyle = `rgb(${tone},${tone - 2},${tone - 6})`; g.fillRect(x + 2, y + 2, 252, 124);
      g.strokeStyle = 'rgba(40,40,50,0.55)'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, 254, 126);
      for (const [sx, sy] of [[8, 8], [248, 8], [8, 120], [248, 120], [128, 8], [128, 120]]) screw(g, x + sx, y + sy, 2.6);
    }
    wear(g, 512, 512, 11, 260);
    return c;
  }, true, repeat);
}

export function panelBump(repeat: [number, number] = [1, 1]) {
  return tex('panelbump', () => {
    const { c, g } = canvas(512, 512);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = '#303030'; g.lineWidth = 3;
    for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 256) g.strokeRect(x + 1, y + 1, 254, 126);
    return c;
  }, false, repeat);
}

export type RackKind = 'lockers' | 'equipment' | 'bags' | 'grille' | 'science';

/** One rack face, about 1 m wide by 2 m tall. */
export function rackTexture(kind: RackKind, seed: number) {
  return tex(`rack-${kind}-${seed}`, () => {
    const { c, g } = canvas(256, 512);
    const r = rnd(seed * 31 + 3);
    g.fillStyle = '#c9c6bf'; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = '#55555f'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 508);
    if (kind === 'lockers') {
      for (let i = 0; i < 4; i++) {
        const y = 12 + i * 124;
        g.fillStyle = '#e4e1da'; g.fillRect(14, y, 228, 112);
        g.strokeStyle = '#6a6a72'; g.strokeRect(14, y, 228, 112);
        g.fillStyle = '#3a3a44'; g.fillRect(110, y + 50, 36, 10);
        g.fillStyle = '#1d4ed8'; g.font = 'bold 13px monospace'; g.fillText(`M${(r() * 900 + 100) | 0}`, 22, y + 22);
        g.fillStyle = '#555'; g.font = '10px monospace'; g.fillText(['CREW PROVISIONS', 'MAINT KIT', 'SPARE FILTERS', 'MED SUPPLIES', 'CABLES · ETHERNET'][(r() * 5) | 0], 22, y + 100);
      }
    } else if (kind === 'equipment') {
      g.fillStyle = '#2a2a33'; g.fillRect(16, 20, 224, 150);
      for (let i = 0; i < 14; i++) { g.fillStyle = r() < 0.7 ? '#22c55e' : r() < 0.5 ? '#f59e0b' : '#836ef9'; g.beginPath(); g.arc(32 + (i % 7) * 30, 46 + Math.floor(i / 7) * 34, 5, 0, 7); g.fill(); }
      g.fillStyle = '#0b1220'; g.fillRect(28, 110, 200, 48);
      g.fillStyle = '#836ef9'; g.font = 'bold 14px monospace'; g.fillText('PWR BUS 2A  28.1V', 36, 140);
      for (let i = 0; i < 10; i++) { g.fillStyle = '#9ca3af'; g.fillRect(28 + i * 20, 200, 10, 26); g.fillStyle = '#111'; g.fillRect(31 + i * 20, 203 + (r() < 0.5 ? 0 : 12), 4, 10); }
      g.fillStyle = '#d4d0c8'; g.fillRect(16, 250, 224, 240); g.strokeStyle = '#666'; g.strokeRect(16, 250, 224, 240);
      g.fillStyle = '#b91c1c'; g.fillRect(24, 262, 90, 18); g.fillStyle = '#fff'; g.font = 'bold 11px monospace'; g.fillText('CAUTION', 34, 275);
      g.fillStyle = '#333'; g.font = '10px monospace'; ['DO NOT OPEN', 'IN FLIGHT', 'ELECTRICAL', 'HAZARD'].forEach((t, i) => g.fillText(t, 26, 300 + i * 14));
    } else if (kind === 'bags') {
      for (let i = 0; i < 3; i++) {
        const y = 20 + i * 160;
        g.fillStyle = ['#e8e2cf', '#d8e2e8', '#e3dccb'][i]; g.beginPath(); g.roundRect(18, y, 220, 140, 18); g.fill();
        g.strokeStyle = '#8a8478'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); g.roundRect(26, y + 8, 204, 124, 14); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#f5f5f5'; g.fillRect(70, y + 50, 110, 34); g.fillStyle = '#222'; g.font = '11px monospace'; g.fillText(`CTB ${(r() * 9000 + 1000) | 0}`, 82, y + 72);
        g.fillStyle = '#6b7280'; g.fillRect(118, y - 4, 20, 14);
      }
    } else if (kind === 'grille') {
      g.fillStyle = '#3f3f47'; g.fillRect(20, 40, 216, 216);
      for (let y = 48; y < 250; y += 9) { g.fillStyle = '#1a1a20'; g.fillRect(28, y, 200, 5); }
      g.fillStyle = '#c9c6bf'; g.fillRect(20, 290, 216, 200);
      g.fillStyle = '#111'; g.font = 'bold 12px monospace'; g.fillText('CABIN FAN · ON', 40, 320);
      g.fillStyle = '#facc15'; g.fillRect(40, 340, 160, 14);
      g.fillStyle = '#111'; g.font = '10px monospace'; g.fillText('KEEP CLEAR · AIRFLOW', 44, 351);
      // A sock lives in at least one of these.
    } else {
      g.fillStyle = '#e8e6e0'; g.fillRect(14, 14, 228, 484);
      g.fillStyle = '#111'; g.font = 'bold 13px monospace'; g.fillText('EXPRESS RACK 4', 28, 40);
      for (let i = 0; i < 8; i++) { g.strokeStyle = '#777'; g.strokeRect(28, 60 + i * 52, 200, 40); g.fillStyle = r() < 0.5 ? '#22c55e' : '#836ef9'; g.fillRect(36, 72 + i * 52, 10, 10); g.fillStyle = '#444'; g.font = '10px monospace'; g.fillText(['FLUIDS EXP', 'CRYSTAL GROWTH', 'PLANT HABITAT', 'COLD STOWAGE', 'MICROBIOME', 'LASER COMMS', 'COMBUSTION', 'MATERIALS'][i], 56, 82 + i * 52); }
    }
    wear(g, 256, 512, seed, 60);
    return c;
  });
}

/** A label, sticky note, patch or sign. */
export function labelTexture(lines: string[], opts: { bg?: string; fg?: string; w?: number; h?: number; font?: number; border?: string } = {}) {
  const { bg = '#fde047', fg = '#1f2937', w = 256, h = 256, font = 22, border } = opts;
  return tex(`label-${lines.join('|')}-${bg}-${w}x${h}`, () => {
    const { c, g } = canvas(w, h);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); }
    g.fillStyle = fg; g.font = `${font}px 'Comic Sans MS', 'Marker Felt', system-ui, sans-serif`;
    const lh = font * 1.25;
    const y0 = h / 2 - (lines.length - 1) * lh / 2 + font / 3;
    g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, w / 2, y0 + i * lh));
    return c;
  });
}

/** The mission patch: Monad × Nansen orbital research. */
export function patchTexture() {
  return tex('patch', () => {
    const { c, g } = canvas(256, 256);
    g.fillStyle = '#0b0618'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill();
    g.strokeStyle = '#836ef9'; g.lineWidth = 10; g.stroke();
    const gr = g.createRadialGradient(128, 150, 10, 128, 150, 90);
    gr.addColorStop(0, '#3b82f6'); gr.addColorStop(1, '#0b2a5b');
    g.fillStyle = gr; g.beginPath(); g.arc(128, 170, 70, Math.PI, 0); g.fill();
    g.fillStyle = '#836ef9'; g.beginPath(); g.moveTo(128, 40); g.lineTo(158, 100); g.lineTo(128, 88); g.lineTo(98, 100); g.closePath(); g.fill();
    g.fillStyle = '#f5c542'; g.beginPath(); g.arc(186, 70, 9, 0, 7); g.fill();
    g.fillStyle = '#efeaff'; g.font = 'bold 18px system-ui'; g.textAlign = 'center';
    g.fillText('MONAD × NANSEN', 128, 216);
    g.font = '11px system-ui'; g.fillText('ORBITAL RESEARCH STATION', 128, 234);
    return c;
  });
}

/** A live screen: the caller draws on `g` and sets `texture.needsUpdate`. */
export function liveScreen(w = 512, h = 288) {
  const { c, g } = canvas(w, h);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, g, texture };
}
