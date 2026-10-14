// The Monad universes: the token set is split into categories and each category is
// its own galaxy. Nansen lists every Monad token it tracks (about seventy) with a
// real name and market data but no category, so the category is assigned here from
// the token's real name and symbol by plain rules; the assignment is this app's,
// not Nansen's, and the UI says so.

export type UniverseId = 'majors' | 'stables' | 'rwa' | 'memes' | 'defi';

export interface UniverseDef {
  id: UniverseId;
  name: string;
  blurb: string;
  color: string;
}

export const UNIVERSES: UniverseDef[] = [
  { id: 'majors', name: 'Majors', blurb: 'Bitcoin and Ether on Monad, MON itself, and the large established tokens.', color: '#60a5fa' },
  { id: 'rwa', name: 'RWA', blurb: 'Real-world assets: tokenised stocks and ETFs, gold, T-bills and fiat.', color: '#f5c542' },
  { id: 'memes', name: 'Memecoins', blurb: 'Community and culture tokens: CHOG, NADS, Molandak and friends.', color: '#f472b6' },
  { id: 'stables', name: 'Stablecoins', blurb: 'Dollar-pegged tokens and the vault wrappers around them.', color: '#34d399' },
  { id: 'defi', name: 'DeFi & ecosystem', blurb: 'Staking, lending, yield and everything else built on Monad.', color: '#a78bfa' },
];

export const universeDef = (id: string): UniverseDef | undefined => UNIVERSES.find((u) => u.id === id);

const MAJORS = new Set(['WBTC', 'CBBTC', 'WSTETH', 'WEETH', 'WETH', 'MON', 'WMON', 'APE', 'PENDLE']);
const RWA = new Set(['XAUT0', 'CETES', 'EURW', 'MEDGE']);
const MEMES = new Set(['CHOG', 'MOLANDAK', 'NADS', 'EGG', 'DUST', 'BOB', 'FLING', 'LONG', '143']);
const STABLES = new Set(['USDC', 'USDE', 'USD1', 'USDT0', 'GHO', 'AUSD', 'USDAT', 'MUSD', 'LVUSD', 'WNUSDT0', 'WNAUSD', 'WNUSDC', 'BLBAUSD']);

/** Which universe a token belongs to, by its symbol and Nansen's token name. */
export function categoryOf(symbol: string, name: string | null | undefined): UniverseId {
  const s = symbol.toUpperCase().replace(/^\s*⚠️?\s*/, '');
  const n = name ?? '';
  if (/aStock\b/i.test(n) || RWA.has(s)) return 'rwa';
  if (STABLES.has(s)) return 'stables';
  if (MAJORS.has(s)) return 'majors';
  if (MEMES.has(s)) return 'memes';
  return 'defi';
}

/** The universe named by a request's `u` parameter; unknown or missing falls back to Majors. */
export function universeFrom(value: string | null | undefined): UniverseId {
  return UNIVERSES.some((u) => u.id === value) ? (value as UniverseId) : 'majors';
}
