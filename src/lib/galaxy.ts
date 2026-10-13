// Builds the galaxy from Nansen. Planets are Monad tokens, stars are the
// wallets around them, trails are money moving between those wallets.
// Each layer names the endpoint it came from, so nothing on screen is
// decoration pretending to be data (the background dust is the one
// exception, and it is only ever drawn faint).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cached, nansen, pool } from './nansen';

export type StarKind = 'smart' | 'fund' | 'whale' | 'exchange' | 'trader' | 'named' | 'contract' | 'anon';

export interface Cohort { key: string; netFlowUsd: number; wallets: number | null }

export interface Planet {
  address: string;
  symbol: string;
  marketCap: number | null;
  liquidity: number | null;
  volume24h: number | null;
  netflow24h: number | null;
  change24h: number | null;
  change7d: number | null;
  /** Nansen's size class from tgm/indicators: largecap, midcap, lowcap… */
  capGroup: string | null;
  risk: { type: string; score: string | null }[];
  reward: { type: string; score: string | null }[];
  smartHolders: number;
  smartValueUsd: number;
  cohorts: Cohort[];
  state: 'stable' | 'falling' | 'flagged';
  holders: number;
  traders24h: number;
  topPnl: { address: string; name: string; pnlUsd: number } | null;
}

export interface Link {
  /** Index into planets. */
  p: number;
  /** Share of supply held, 0..1, from tgm/holders. */
  share: number;
  holdingUsd: number;
  pnlUsd: number | null;
  roi: number | null;
  trades: number | null;
  boughtUsd: number;
  soldUsd: number;
}

export interface Star {
  address: string;
  name: string;
  kind: StarKind;
  labels: string[];
  links: Link[];
  holdingUsd: number;
  pnlUsd: number;
  volume24hUsd: number;
  /** 0..1. How brightly the star burns: proven profit, labels, size. */
  brightness: number;
  /** Index into planets of the token this wallet is most tied to. */
  home: number;
}

export interface Trail { from: number; to: number; usd: number; p: number; at: string; tx: string }

export interface Galaxy {
  builtAt: string;
  planets: Planet[];
  stars: Star[];
  trails: Trail[];
  credits: number;
  endpoints: Record<string, number>;
  errors: string[];
}

const STABLE = /usd|^eur|^gho$|^dai$|^frax/i;
const EXCHANGES = /binance|coinbase|okx|bybit|kraken|bitget|gate\.io|mexc|kucoin|htx|huobi|crypto\.com|upbit|bithumb/i;
const PLANETS = 18;

export function kindOf(labels: string[], usd: number, smart: boolean): StarKind {
  const all = labels.join(' | ');
  if (smart || /smart (trader|money)|🤓/i.test(all)) return 'smart';
  if (/liquidity pool|token contract|router|aggregator|🤖|\bbot\b|mev|bridge|vault|li\.fi|relay protocol/i.test(all)) return 'contract';
  if (/🏦|\bfund\b|capital|ventures|partners/i.test(all)) return 'fund';
  if (EXCHANGES.test(all)) return 'exchange';
  if (/🐳|whale|millionaire|high balance/i.test(all) || usd >= 50_000) return 'whale';
  if (/perps|trader|high activity|shark/i.test(all)) return 'trader';
  if (labels.some((l) => l.trim() && !/^\s*\[0x[0-9a-f]+\]\s*$/i.test(l))) return 'named';
  return 'anon';
}

export const clean = (label: string) => label.replace(/\s*\[0x[0-9a-f]+\]\s*$/i, '').replace(/[*​]/g, '').trim();

interface ScreenerRow {
  token_address: string; token_symbol: string; market_cap_usd?: number | null; liquidity?: number | null;
  volume?: number | null; netflow?: number | null; price_change?: number | null;
}
interface Holding { token_address: string; token_symbol: string | null; value_usd: number; holders_count?: number | null }
interface HolderRow { address: string; address_label: string | null; ownership_percentage: number | null; value_usd: number | null }
interface PnlRow { trader_address: string; trader_address_label: string | null; pnl_usd_total: number | null; roi_percent_total: number | null; nof_trades: number | null; holding_usd: number | null }
interface WbsRow { address: string; address_label: string | null; bought_volume_usd: number | null; sold_volume_usd: number | null }
interface TransferRow { from_address: string; to_address: string; from_address_label: string | null; to_address_label: string | null; transfer_value_usd: number | null; block_timestamp: string; transaction_hash: string }
interface Indicators { token_info?: { market_cap_group?: string | null }; risk_indicators?: { indicator_type: string; score: string | null }[]; reward_indicators?: { indicator_type: string; score: string | null }[] }
interface SmartTrade { trader_address: string }

const COHORT_KEYS = ['smart_trader', 'whale', 'top_pnl', 'public_figure', 'exchange', 'fresh_wallets'];

async function build(): Promise<Galaxy> {
  const errors: string[] = [];
  const endpoints: Record<string, number> = {};
  let credits = 0;
  const call = async <T>(p: string, body: unknown): Promise<T | null> => {
    const r = await nansen<T>(p, body);
    credits += r.credits;
    endpoints[p] = (endpoints[p] ?? 0) + 1;
    if (r.error) errors.push(r.error);
    return r.body;
  };

  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const screen = (timeframe: string, field: string, direction: 'ASC' | 'DESC') => ({
    chains: ['monad'], timeframe, pagination: { page: 1, per_page: 100 },
    filters: { include_stablecoins: false, include_native_tokens: false },
    order_by: [{ field, direction }],
  });

  const [day, week, holdings, smartTrades] = await Promise.all([
    call<{ data: ScreenerRow[] }>('token-screener', screen('24h', 'volume', 'DESC')),
    call<{ data: ScreenerRow[] }>('token-screener', screen('7d', 'price_change', 'ASC')),
    call<{ data: Holding[] }>('smart-money/holdings', { chains: ['monad'], pagination: { page: 1, per_page: 50 } }),
    call<{ data: SmartTrade[] }>('smart-money/dex-trades', { chains: ['monad'], pagination: { page: 1, per_page: 100 } }),
  ]);
  const weekly = new Map((week?.data ?? []).map((r) => [r.token_address.toLowerCase(), r.price_change ?? null]));
  const sm = new Map((holdings?.data ?? []).map((h) => [h.token_address.toLowerCase(), h]));
  const smartSet = new Set((smartTrades?.data ?? []).map((t) => t.trader_address.toLowerCase()));

  // The planets: the day's most traded tokens, and every token the smart money cohort holds.
  const rows = (day?.data ?? []).filter((r) => !STABLE.test(r.token_symbol));
  const chosen: ScreenerRow[] = [];
  for (const h of holdings?.data ?? []) {
    const r = rows.find((x) => x.token_address.toLowerCase() === h.token_address.toLowerCase());
    if (r && !chosen.includes(r)) chosen.push(r);
  }
  for (const r of rows) if (chosen.length < PLANETS && !chosen.includes(r)) chosen.push(r);

  // Per planet: holders, PnL leaderboard, 24h buyers and sellers, transfers,
  // cohort flows and Nansen's indicators.
  const perPlanet = await pool(chosen, 4, async (r) => {
    const token = r.token_address.toLowerCase();
    const [hold, pnl, wbs, xfer, flow, ind] = await Promise.all([
      call<{ data: HolderRow[] }>('tgm/holders', { chain: 'monad', token_address: token, pagination: { page: 1, per_page: 100 }, order_by: [{ field: 'token_amount', direction: 'DESC' }] }),
      call<{ data: PnlRow[] }>('tgm/pnl-leaderboard', { chain: 'monad', token_address: token, date: { from: ago(30), to: now.toISOString() }, pagination: { page: 1, per_page: 100 }, order_by: [{ field: 'pnl_usd_total', direction: 'DESC' }] }),
      call<{ data: WbsRow[] }>('tgm/who-bought-sold', { chain: 'monad', token_address: token, date: { from: ago(1), to: now.toISOString() }, pagination: { page: 1, per_page: 100 } }),
      call<{ data: TransferRow[] }>('tgm/transfers', { chain: 'monad', token_address: token, date: { from: ago(1), to: now.toISOString() }, pagination: { page: 1, per_page: 200 }, filters: { non_exchange_transfers: true } }),
      call<{ data: Record<string, number | null>[] }>('tgm/flow-intelligence', { chain: 'monad', token_address: token, timeframe: '1d' }),
      call<Indicators>('tgm/indicators', { chain: 'monad', token_address: token }),
    ]);
    return { hold: hold?.data ?? [], pnl: pnl?.data ?? [], wbs: wbs?.data ?? [], xfer: xfer?.data ?? [], flow: flow?.data?.[0] ?? null, ind };
  });

  // Merge every wallet seen anywhere into one star.
  interface Acc { labels: Set<string>; links: Map<number, Link> }
  const acc = new Map<string, Acc>();
  const touch = (address: string, label: string | null | undefined, p: number) => {
    const a = address.toLowerCase();
    let s = acc.get(a);
    if (!s) { s = { labels: new Set(), links: new Map() }; acc.set(a, s); }
    if (label && label.trim()) s.labels.add(label.trim());
    let l = s.links.get(p);
    if (!l) { l = { p, share: 0, holdingUsd: 0, pnlUsd: null, roi: null, trades: null, boughtUsd: 0, soldUsd: 0 }; s.links.set(p, l); }
    return l;
  };

  perPlanet.forEach((d, p) => {
    for (const h of d.hold) {
      const l = touch(h.address, h.address_label, p);
      l.share = h.ownership_percentage ?? 0;
      l.holdingUsd = Math.max(l.holdingUsd, h.value_usd ?? 0);
    }
    for (const t of d.pnl) {
      const l = touch(t.trader_address, t.trader_address_label, p);
      l.pnlUsd = t.pnl_usd_total ?? null;
      l.roi = t.roi_percent_total ?? null;
      l.trades = t.nof_trades ?? null;
      l.holdingUsd = Math.max(l.holdingUsd, t.holding_usd ?? 0);
    }
    for (const w of d.wbs) {
      const l = touch(w.address, w.address_label, p);
      l.boughtUsd = w.bought_volume_usd ?? 0;
      l.soldUsd = w.sold_volume_usd ?? 0;
    }
  });

  const stars: Star[] = [];
  const index = new Map<string, number>();
  for (const [address, s] of acc) {
    const links = [...s.links.values()];
    const holdingUsd = links.reduce((x, l) => x + l.holdingUsd, 0);
    const pnlUsd = links.reduce((x, l) => x + (l.pnlUsd ?? 0), 0);
    const volume24hUsd = links.reduce((x, l) => x + l.boughtUsd + l.soldUsd, 0);
    const labels = [...s.labels];
    const kind = kindOf(labels, holdingUsd, smartSet.has(address));
    const home = links.reduce((b, l) => (l.holdingUsd + l.boughtUsd + l.soldUsd > b.holdingUsd + b.boughtUsd + b.soldUsd ? l : b), links[0]).p;
    // Brightness: proven profit first, then a Nansen label, then size and activity.
    // A wallet that lost money burns dim whatever it holds.
    const profit = pnlUsd > 0 ? Math.min(1, Math.log10(1 + pnlUsd) / 5) : 0;
    const loss = pnlUsd < 0 ? Math.min(0.5, Math.log10(1 - pnlUsd) / 10) : 0;
    const labelled = kind === 'smart' ? 1 : kind === 'fund' ? 0.8 : ['whale', 'exchange', 'trader', 'named'].includes(kind) ? 0.5 : 0;
    const size = Math.min(1, Math.log10(1 + holdingUsd + volume24hUsd) / 7);
    const brightness = Math.max(0.08, Math.min(1, 0.12 + profit * 0.45 + labelled * 0.25 + size * 0.25 - loss));
    const name = labels.map(clean).find((l) => l) ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
    index.set(address, stars.length);
    stars.push({ address, name, kind, labels: [...new Set(labels.map(clean).filter(Boolean))], links, holdingUsd, pnlUsd, volume24hUsd, brightness, home });
  }

  // Trails between stars the galaxy already knows.
  const trails: Trail[] = [];
  perPlanet.forEach((d, p) => {
    for (const t of d.xfer) {
      const a = index.get(t.from_address.toLowerCase());
      const b = index.get(t.to_address.toLowerCase());
      if (a == null || b == null || a === b) continue;
      trails.push({ from: a, to: b, usd: t.transfer_value_usd ?? 0, p, at: t.block_timestamp, tx: t.transaction_hash });
    }
  });

  const planets: Planet[] = chosen.map((r, p) => {
    const a = r.token_address.toLowerCase();
    const d = perPlanet[p];
    const w = weekly.get(a);
    const change7d = w != null ? w * 100 : null;
    const established = (r.market_cap_usd ?? 0) >= 10_000_000;
    const flagged = /^\s*⚠/.test(r.token_symbol);
    const top = [...d.pnl].sort((x, y) => (y.pnl_usd_total ?? 0) - (x.pnl_usd_total ?? 0))[0];
    const h = sm.get(a);
    return {
      address: a,
      symbol: r.token_symbol.replace(/^\s*⚠️?\s*/, ''),
      marketCap: r.market_cap_usd ?? null,
      liquidity: r.liquidity ?? null,
      volume24h: r.volume ?? null,
      netflow24h: r.netflow ?? null,
      change24h: r.price_change != null ? r.price_change * 100 : null,
      change7d,
      capGroup: d.ind?.token_info?.market_cap_group ?? null,
      risk: (d.ind?.risk_indicators ?? []).map((x) => ({ type: x.indicator_type, score: x.score })),
      reward: (d.ind?.reward_indicators ?? []).map((x) => ({ type: x.indicator_type, score: x.score })),
      smartHolders: h?.holders_count ?? 0,
      smartValueUsd: h?.value_usd ?? 0,
      cohorts: d.flow ? COHORT_KEYS.map((k) => ({
        key: k, netFlowUsd: d.flow![`${k}_net_flow_usd`] ?? 0,
        wallets: k === 'exchange' ? null : d.flow![`${k}_wallet_count`] ?? null,
      })) : [],
      state: flagged ? 'flagged' : !established && change7d != null && change7d <= -40 ? 'falling' : 'stable',
      holders: d.hold.length,
      traders24h: d.wbs.length,
      topPnl: top && (top.pnl_usd_total ?? 0) > 0 ? { address: top.trader_address.toLowerCase(), name: clean(top.trader_address_label ?? '') || `${top.trader_address.slice(0, 6)}…${top.trader_address.slice(-4)}`, pnlUsd: top.pnl_usd_total ?? 0 } : null,
    };
  });

  return { builtAt: now.toISOString(), planets, stars, trails, credits, endpoints, errors };
}

// A galaxy costs a few hundred credits, so it is kept for three hours and
// written to disk: restarting the server does not rebuild it.
const TTL = 3 * 60 * 60_000;
const DIR = process.env.GALAXY_CACHE_DIR ?? (process.env.VERCEL ? '/tmp' : '.cache');
const FILE = path.join(DIR, 'galaxy.json');

async function fromDisk(): Promise<Galaxy | null> {
  try {
    const g = JSON.parse(await readFile(FILE, 'utf8')) as Galaxy;
    return Date.now() - Date.parse(g.builtAt) < TTL ? g : null;
  } catch { return null; }
}

export const getGalaxy = () => cached('galaxy', TTL, async () => {
  const disk = await fromDisk();
  if (disk) return disk;
  const g = await build();
  if (g.planets.length) {
    try { await mkdir(DIR, { recursive: true }); await writeFile(FILE, JSON.stringify(g)); } catch { /* read-only fs */ }
  }
  return g;
});
