// The Monad desk: the market read from Nansen, for the station's research PC.
// Ported from Peregrine's Overview, Smart Money, Alpha, Sectors and History pages
// and cut down to what Nansen actually serves for Monad: the token screener (all
// ~70 Monad tokens), Smart Money holdings, trades, leaderboard and 7-day holdings
// history. Where Nansen has little (it tracks only a handful of Smart Money
// wallets on Monad) the numbers are small and the page says so.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cached, nansen } from './nansen';
import { getTokenIndex } from './galaxy';
import { UNIVERSES, type UniverseId } from './universes';

export interface DeskToken {
  address: string; symbol: string; name: string; universe: UniverseId;
  priceUsd: number | null; marketCap: number | null; liquidity: number | null;
  volume24h: number | null; buyVolume24h: number | null; sellVolume24h: number | null; netflow24h: number | null;
  change24h: number | null; change7d: number | null; change30d: number | null; ageDays: number | null;
  smartHolders: number; smartValueUsd: number; smartChange24h: number | null;
  /** Alpha score 0 to 100 (50 = nothing to see) and the parts behind it. */
  alpha: number; alphaParts: { id: string; label: string; points: number; detail: string }[];
}

export interface SectorRow { id: UniverseId; name: string; color: string; tokens: number; active: number; marketCap: number; volume24h: number; netflow24h: number; topIn: string | null; topOut: string | null; trend: number[] }
export interface SmartHolding { address: string; symbol: string; valueUsd: number; holders: number; share: number; change24h: number | null; labels: string[] }
export interface SmartTrade { at: string; wallet: string; label: string; bought: string; sold: string; valueUsd: number | null; tx: string }
export interface SmartLeader { address: string; label: string; realizedUsd: number; unrealizedUsd: number; totalUsd: number; winRate: number | null; trades: number; tokens: number; held: string[] }
export interface HistoryPoint { date: string; symbol: string; valueUsd: number; holders: number }

export interface Desk {
  builtAt: string;
  tokens: DeskToken[];
  sectors: SectorRow[];
  hero: { buying: DeskToken | null; selling: DeskToken | null };
  totals: { volume24h: number; netflow24h: number; marketCap: number; active: number; tokens: number; liquidity: number };
  movers: { up: DeskToken[]; down: DeskToken[] };
  newest: DeskToken[];
  smart: { holdings: SmartHolding[]; trades: SmartTrade[]; leaders: SmartLeader[]; history: HistoryPoint[]; valueUsd: number };
  changes: { since: string | null; rows: { symbol: string; address: string; metric: string; from: number; to: number; pct: number }[] };
  credits: number;
}

const DIR = process.env.GALAXY_CACHE_DIR ?? (process.env.VERCEL ? '/tmp' : '.cache');
const TTL = 20 * 60_000;
const HIST_FILE = path.join(DIR, 'desk-history.json');

interface Row {
  token_address: string; token_symbol: string; token_age_days?: number | null; market_cap_usd?: number | null; liquidity?: number | null; price_usd?: number | null;
  price_change?: number | null; volume?: number | null; buy_volume?: number | null; sell_volume?: number | null; netflow?: number | null;
}
interface Snapshot { at: string; tokens: Record<string, { mc: number | null; vol: number | null; net: number | null; price: number | null; liq: number | null }> }

const clamp = (n: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, n)));
const pct = (n: number) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const usdShort = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`);

/** Alpha score (Peregrine's model, trimmed to the inputs Monad has): 50 is "nothing to see". */
export function alphaScore(x: { flowShare: number | null; persistence: number[]; liquidityUsd: number | null; change24h: number | null; ageDays: number | null; smartChange24h: number | null }) {
  const parts: DeskToken['alphaParts'] = [];
  if (x.flowShare != null) parts.push({ id: 'flow', label: 'Net buying', points: clamp(25 * Math.tanh(x.flowShare / 0.5), -25, 25), detail: `${pct(x.flowShare)} of volume, 24h` });
  if (x.persistence.length >= 4) {
    const up = x.persistence.filter((h) => h > 0).length / x.persistence.length;
    parts.push({ id: 'persistence', label: 'Persistence', points: clamp((up - 0.5) * 30, -15, 15), detail: `net buying in ${Math.round(up * x.persistence.length)} of the last ${x.persistence.length} snapshots` });
  }
  if (x.smartChange24h != null && x.smartChange24h !== 0) parts.push({ id: 'smart', label: 'Smart Money', points: clamp(20 * Math.tanh(x.smartChange24h / 0.1), -20, 20), detail: `Smart Money balance ${pct(x.smartChange24h)} in 24h` });
  if (x.liquidityUsd != null) {
    const pts = x.liquidityUsd < 50_000 ? -20 : x.liquidityUsd < 250_000 ? -8 : 0;
    if (pts) parts.push({ id: 'liquidity', label: 'Thin liquidity', points: pts, detail: `${usdShort(x.liquidityUsd)} in pools` });
  }
  if (x.change24h != null) {
    if (x.change24h > 0.6) parts.push({ id: 'extended', label: 'Already extended', points: -10, detail: `${pct(x.change24h)} in 24h` });
    else if (x.change24h < -0.35) parts.push({ id: 'falling', label: 'Falling hard', points: -6, detail: `${pct(x.change24h)} in 24h` });
  }
  if (x.ageDays != null && x.ageDays >= 0 && x.ageDays < 2) parts.push({ id: 'new', label: 'Brand new', points: -6, detail: `${(x.ageDays * 24).toFixed(0)}h old` });
  return { score: clamp(50 + parts.reduce((s, p) => s + p.points, 0), 0, 100), parts: parts.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)) };
}

async function readHistory(): Promise<Snapshot[]> {
  try { return JSON.parse(await readFile(HIST_FILE, 'utf8')) as Snapshot[]; } catch { return []; }
}

async function build(): Promise<Desk> {
  let credits = 0;
  const call = async <T,>(p: string, body: unknown): Promise<T | null> => { const r = await nansen<T>(p, body); credits += r.credits; return r.body; };
  const now = new Date();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const screen = (timeframe: string) => ({ chains: ['monad'], timeframe, pagination: { page: 1, per_page: 100 }, filters: { include_stablecoins: true, include_native_tokens: true }, order_by: [{ field: 'market_cap_usd', direction: 'DESC' }] });
  const from7 = day(new Date(now.getTime() - 7 * 86_400_000)), to = day(new Date(now.getTime() - 86_400_000));

  const [index, r24, r7, r30, holdings, trades, leaders, hist, past] = await Promise.all([
    getTokenIndex(),
    call<{ data: Row[] }>('token-screener', screen('24h')),
    call<{ data: Row[] }>('token-screener', screen('7d')),
    call<{ data: Row[] }>('token-screener', screen('30d')),
    call<{ data: { token_address: string; token_symbol: string; value_usd: number; holders_count: number; share_of_holdings_percent: number; balance_24h_percent_change: number | null }[] }>('smart-money/holdings', { chains: ['monad'], pagination: { page: 1, per_page: 50 } }),
    call<{ data: Record<string, unknown>[] }>('smart-money/dex-trades', { chains: ['monad'], pagination: { page: 1, per_page: 100 } }),
    call<{ data: { address: string; address_label: string | null; realized_pnl_usd: number | null; unrealized_pnl_usd: number | null; total_pnl_usd: number | null; win_rate: number | null; n_trades: number | null; n_tokens: number | null; top_traded_tokens_info?: { symbol: string }[] }[] }>('smart-money/pnl-leaderboard', { chains: ['monad'], pagination: { page: 1, per_page: 25 } }),
    call<{ data: { date: string; token_symbol: string; value_usd: number; holders_count: number; smart_money_labels?: string[] }[] }>('smart-money/historical-holdings', { chains: ['monad'], date_range: { from: from7, to }, pagination: { page: 1, per_page: 100 } }),
    readHistory(),
  ]);

  const by = (rows: Row[] | undefined) => new Map((rows ?? []).map((r) => [r.token_address.toLowerCase(), r]));
  const m24 = by(r24?.data), m7 = by(r7?.data), m30 = by(r30?.data);
  const sm = new Map((holdings?.data ?? []).map((h) => [h.token_address.toLowerCase(), h]));
  const snaps = past.slice(-12);

  const tokens: DeskToken[] = index.map((t) => {
    const a = m24.get(t.address), w = m7.get(t.address), m = m30.get(t.address), h = sm.get(t.address);
    const volume = a?.volume ?? null, net = a?.netflow ?? null;
    const persistence = snaps.map((s) => { const x = s.tokens[t.address]; return x && x.vol && x.net != null ? x.net / x.vol : null; }).filter((v): v is number => v != null);
    const al = alphaScore({
      flowShare: volume && net != null ? net / volume : null, persistence, liquidityUsd: m?.liquidity ?? t.liquidity,
      change24h: a?.price_change ?? null, ageDays: m?.token_age_days ?? t.ageDays, smartChange24h: h?.balance_24h_percent_change ?? null,
    });
    return {
      address: t.address, symbol: t.symbol, name: t.name, universe: t.category,
      priceUsd: m?.price_usd ?? a?.price_usd ?? null, marketCap: m?.market_cap_usd ?? t.marketCap, liquidity: m?.liquidity ?? t.liquidity,
      volume24h: volume, buyVolume24h: a?.buy_volume ?? null, sellVolume24h: a?.sell_volume ?? null, netflow24h: net,
      change24h: a?.price_change != null ? a.price_change * 100 : null, change7d: w?.price_change != null ? w.price_change * 100 : null, change30d: m?.price_change != null ? m.price_change * 100 : null,
      ageDays: m?.token_age_days ?? t.ageDays, smartHolders: h?.holders_count ?? 0, smartValueUsd: h?.value_usd ?? 0, smartChange24h: h?.balance_24h_percent_change ?? null,
      alpha: al.score, alphaParts: al.parts,
    };
  });

  const active = tokens.filter((t) => (t.volume24h ?? 0) > 0);
  // The headline skips stablecoins: their mint-and-redeem flows would drown out everything else.
  const real = tokens.filter((t) => (t.volume24h ?? 0) >= 1_000 && t.netflow24h != null && t.universe !== 'stables');
  const buying = [...real].sort((a, b) => (b.netflow24h ?? 0) - (a.netflow24h ?? 0))[0] ?? null;
  const selling = [...real].sort((a, b) => (a.netflow24h ?? 0) - (b.netflow24h ?? 0))[0] ?? null;

  const sectors: SectorRow[] = UNIVERSES.map((u) => {
    const ts = tokens.filter((t) => t.universe === u.id);
    const withNet = ts.filter((t) => t.netflow24h != null && (t.volume24h ?? 0) >= 500);
    return {
      id: u.id, name: u.name, color: u.color, tokens: ts.length, active: ts.filter((t) => (t.volume24h ?? 0) > 0).length,
      marketCap: ts.reduce((s, t) => s + (t.marketCap ?? 0), 0), volume24h: ts.reduce((s, t) => s + (t.volume24h ?? 0), 0), netflow24h: ts.reduce((s, t) => s + (t.netflow24h ?? 0), 0),
      topIn: [...withNet].sort((a, b) => b.netflow24h! - a.netflow24h!)[0]?.symbol ?? null,
      topOut: [...withNet].sort((a, b) => a.netflow24h! - b.netflow24h!)[0]?.symbol ?? null,
      trend: snaps.map((s) => ts.reduce((sum, t) => sum + (s.tokens[t.address]?.net ?? 0), 0)),
    };
  });

  const movable = tokens.filter((t) => t.change24h != null && (t.liquidity ?? 0) >= 10_000 && (t.volume24h ?? 0) >= 500);
  const newest = [...tokens].filter((t) => t.ageDays != null).sort((a, b) => a.ageDays! - b.ageDays!).slice(0, 6);

  // "What changed": compare with the snapshot nearest a day ago (needs the desk to have run before).
  const dayAgo = now.getTime() - 24 * 3_600_000;
  const ref = [...past].reverse().find((s) => Date.parse(s.at) <= dayAgo + 4 * 3_600_000 && Date.parse(s.at) < now.getTime() - 2 * 3_600_000) ?? null;
  const rows: Desk['changes']['rows'] = [];
  if (ref) {
    for (const t of tokens) {
      const o = ref.tokens[t.address];
      if (!o) continue;
      for (const [metric, from, to] of [['market cap', o.mc, t.marketCap], ['liquidity', o.liq, t.liquidity], ['24h volume', o.vol, t.volume24h]] as const) {
        if (from != null && to != null && from > 0 && Math.abs(to - from) / from > 0.05 && from > 1_000) rows.push({ symbol: t.symbol, address: t.address, metric, from, to, pct: (to - from) / from });
      }
    }
    rows.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }

  // Keep a snapshot every three hours so the desk grows a memory.
  const snap: Snapshot = { at: now.toISOString(), tokens: Object.fromEntries(tokens.map((t) => [t.address, { mc: t.marketCap, vol: t.volume24h, net: t.netflow24h, price: t.priceUsd, liq: t.liquidity }])) };
  const last = past.at(-1);
  if (tokens.length && (!last || now.getTime() - Date.parse(last.at) >= 3 * 3_600_000)) {
    try { await mkdir(DIR, { recursive: true }); await writeFile(HIST_FILE, JSON.stringify([...past, snap].slice(-80))); } catch { /* read-only fs */ }
  }

  const symbolOf = new Map(index.map((t) => [t.address, t.symbol]));
  const tradeValue = (r: Record<string, unknown>) => {
    for (const k of ['trade_value_usd', 'value_usd', 'estimated_value_usd']) if (typeof r[k] === 'number') return r[k] as number;
    return null;
  };
  return {
    builtAt: now.toISOString(), tokens, sectors,
    hero: { buying, selling },
    totals: { volume24h: tokens.reduce((s, t) => s + (t.volume24h ?? 0), 0), netflow24h: tokens.reduce((s, t) => s + (t.netflow24h ?? 0), 0), marketCap: tokens.reduce((s, t) => s + (t.marketCap ?? 0), 0), active: active.length, tokens: tokens.length, liquidity: tokens.reduce((s, t) => s + (t.liquidity ?? 0), 0) },
    movers: { up: [...movable].sort((a, b) => b.change24h! - a.change24h!).slice(0, 5), down: [...movable].sort((a, b) => a.change24h! - b.change24h!).slice(0, 5) },
    newest,
    smart: {
      holdings: (holdings?.data ?? []).map((h) => ({ address: h.token_address.toLowerCase(), symbol: h.token_symbol, valueUsd: h.value_usd, holders: h.holders_count, share: h.share_of_holdings_percent, change24h: h.balance_24h_percent_change, labels: [] })).sort((a, b) => b.valueUsd - a.valueUsd),
      trades: (trades?.data ?? []).map((r) => ({
        at: String(r.block_timestamp ?? ''), wallet: String(r.trader_address ?? '').toLowerCase(), label: String(r.trader_address_label ?? ''),
        bought: String(r.token_bought_symbol ?? symbolOf.get(String(r.token_bought_address ?? '').toLowerCase()) ?? '?'), sold: String(r.token_sold_symbol ?? symbolOf.get(String(r.token_sold_address ?? '').toLowerCase()) ?? '?'),
        valueUsd: tradeValue(r), tx: String(r.transaction_hash ?? ''),
      })),
      leaders: (leaders?.data ?? []).map((l) => ({ address: l.address.toLowerCase(), label: l.address_label ?? '', realizedUsd: l.realized_pnl_usd ?? 0, unrealizedUsd: l.unrealized_pnl_usd ?? 0, totalUsd: l.total_pnl_usd ?? 0, winRate: l.win_rate, trades: l.n_trades ?? 0, tokens: l.n_tokens ?? 0, held: (l.top_traded_tokens_info ?? []).map((t) => t.symbol) })),
      history: (hist?.data ?? []).map((h) => ({ date: h.date, symbol: h.token_symbol, valueUsd: h.value_usd, holders: h.holders_count })),
      valueUsd: (holdings?.data ?? []).reduce((s, h) => s + h.value_usd, 0),
    },
    changes: { since: ref?.at ?? null, rows: rows.slice(0, 12) },
    credits,
  };
}

export const getDesk = () => cached('desk', TTL, async () => {
  const file = path.join(DIR, 'desk.json');
  try {
    const d = JSON.parse(await readFile(file, 'utf8')) as Desk;
    if (Date.now() - Date.parse(d.builtAt) < TTL) return d;
  } catch { /* build it */ }
  const d = await build();
  if (d.tokens.length) { try { await mkdir(DIR, { recursive: true }); await writeFile(file, JSON.stringify(d)); } catch { /* read-only fs */ } }
  return d;
});

/** Smart Money holdings on one past day (Nansen's historical holdings do cover Monad). */
export const getHoldingsOn = (date: string) => cached(`holdings-${date}`, 60 * 60_000, async () => {
  const r = await nansen<{ data: { date: string; token_address: string; token_symbol: string; value_usd: number; holders_count: number; balance_24h_percent_change: number | null; share_of_holdings_percent: number }[] }>('smart-money/historical-holdings', { chains: ['monad'], date_range: { from: date, to: date }, pagination: { page: 1, per_page: 100 } });
  return { date, rows: (r.body?.data ?? []).map((h) => ({ address: h.token_address.toLowerCase(), symbol: h.token_symbol, valueUsd: h.value_usd, holders: h.holders_count, share: h.share_of_holdings_percent })).sort((a, b) => b.valueUsd - a.valueUsd), credits: r.credits };
});
