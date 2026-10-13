// How a token's numbers become a world. Every visual property of a planet is
// derived from Nansen data, and each comes with a sentence saying which number
// set it, so an expedition is a way of reading the token, not decoration.
import type { Planet } from './galaxy';

export type Biome = 'terra' | 'aurum' | 'amethyst' | 'magma' | 'glacier';

export interface Palette {
  deep: string; shallow: string; sand: string; low: string; high: string; peak: string; snow: string;
  lava: string; day: string; dusk: string; rim: string; cloud: string;
}

export interface WorldStyle {
  biome: Biome;
  biomeName: string;
  why: string;
  /** Sea level in noise units; higher means more ocean. */
  sea: number;
  oceanPct: number;
  oceanWhy: string;
  /** Cloud coverage, 0..1. */
  clouds: number;
  weather: string;
  /** Night-side city lights, 0..1. */
  city: number;
  settlements: number;
  /** Terrain roughness, 0.4..1. */
  rough: number;
  lava: number;
  /** Latitude above which ice forms; low for ice worlds. */
  ice: number;
  palette: Palette;
  seed: number;
  spin: number;
  tilt: number;
}

const PALETTES: Record<Biome, Palette> = {
  terra: { deep: '#0b2a5b', shallow: '#1f6fa8', sand: '#c9b27c', low: '#3f7d3a', high: '#6b5a3e', peak: '#9a9087', snow: '#f4f6fb', lava: '#000000', day: '#6fa8ff', dusk: '#ff8a4c', rim: '#8fc4ff', cloud: '#ffffff' },
  aurum: { deep: '#06363d', shallow: '#138a8a', sand: '#f0d48a', low: '#c9963f', high: '#9a6a2b', peak: '#efdcae', snow: '#fff6dc', lava: '#000000', day: '#ffd27a', dusk: '#ff7b3a', rim: '#ffd76a', cloud: '#fff4dc' },
  amethyst: { deep: '#1a0b45', shallow: '#3b2a8c', sand: '#c2b2ff', low: '#7b61d6', high: '#4b3a8f', peak: '#ddd2ff', snow: '#f3eeff', lava: '#000000', day: '#a78bfa', dusk: '#ff6fb5', rim: '#c4b5fd', cloud: '#f1ecff' },
  magma: { deep: '#2a0905', shallow: '#4a140a', sand: '#2b2220', low: '#1c1716', high: '#3a302c', peak: '#5a4a44', snow: '#8f8580', lava: '#ff5a1f', day: '#ff7a4a', dusk: '#ff3b1f', rim: '#ff6b4a', cloud: '#7d6e68' },
  glacier: { deep: '#0b2f4d', shallow: '#2a7fb5', sand: '#cfe8f5', low: '#9fd2ea', high: '#e3f4fb', peak: '#ffffff', snow: '#ffffff', lava: '#000000', day: '#9fe3ff', dusk: '#ffb3d1', rim: '#b8f1ff', cloud: '#ffffff' },
};

const NAMES: Record<Biome, string> = {
  terra: 'Temperate world', aurum: 'Golden world', amethyst: 'Amethyst world', magma: 'Volcanic world', glacier: 'Ice world',
};

// Liquid staking derivatives of MON: staked, so frozen.
const STAKED = /^(s|sh|g|apr|lv|a|st|k|m)mon$/i;

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

const usd = (x: number) => {
  const a = Math.abs(x);
  return a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${Math.round(a)}`;
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function worldStyle(p: Planet): WorldStyle {
  let biome: Biome, why: string;
  if (p.state !== 'stable') {
    biome = 'magma';
    why = p.state === 'flagged' ? 'Nansen flags this token as a risk.' : `Down ${Math.round(-(p.change7d ?? 0))}% this week: the crust is breaking.`;
  } else if (STAKED.test(p.symbol)) {
    biome = 'glacier';
    why = 'A staked form of MON: value locked up, so the world is frozen.';
  } else if (p.smartHolders > 0) {
    biome = 'aurum';
    why = `${p.smartHolders} Nansen smart money wallet${p.smartHolders > 1 ? 's hold' : ' holds'} it.`;
  } else if (p.capGroup === 'largecap' || p.capGroup === 'midcap' || (p.marketCap ?? 0) >= 10_000_000) {
    biome = 'terra';
    why = `An established asset (${p.capGroup ? `Nansen ${p.capGroup}` : usd(p.marketCap ?? 0)}): a settled, temperate world.`;
  } else {
    biome = 'amethyst';
    why = 'A young Monad-native token: an amethyst world.';
  }

  // Oceans are liquidity: $1k of liquidity is a desert, $10M a water world.
  const liq = Math.max(1, p.liquidity ?? 1);
  const t = clamp((Math.log10(liq) - 3) / 4, 0, 1);
  const sea = biome === 'magma' ? 0.32 + t * 0.12 : 0.36 + t * 0.26;
  const oceanPct = Math.round(clamp((sea - 0.3) / 0.35 * 80 + 8, 5, 92));

  // Weather is the day's net flow: money in clears the skies, money out brings storms.
  const nf = p.netflow24h ?? 0;
  let clouds: number, weather: string;
  if (nf > 1000) { clouds = 0.22; weather = `Clear skies: ${usd(nf)} flowed in today.`; }
  else if (nf < -1000) { clouds = clamp(0.5 + Math.log10(-nf) / 25, 0.5, 0.75); weather = `Storm front: ${usd(nf)} flowed out today.`; }
  else { clouds = 0.36; weather = `Scattered clouds: flows were quiet (${nf >= 0 ? '+' : '−'}${usd(nf)}).`; }

  // City lights are its people: holders and today's traders.
  const settlements = p.holders + p.traders24h;
  const city = clamp(settlements / 220, 0.08, 1);

  const vol = Math.abs(p.change7d ?? 0);
  const seed = hash(p.address);
  return {
    biome, biomeName: NAMES[biome], why,
    sea, oceanPct,
    oceanWhy: `${usd(liq)} of liquidity`,
    clouds, weather,
    city, settlements,
    rough: clamp(0.45 + vol / 80, 0.45, 1),
    lava: biome === 'magma' ? 1 : 0,
    ice: biome === 'glacier' ? 0.22 : biome === 'terra' ? 0.76 : biome === 'magma' ? 2 : 0.84,
    palette: PALETTES[biome],
    seed: seed * 100,
    spin: 0.012 + seed * 0.02,
    tilt: (seed - 0.5) * 0.7,
  };
}
