// Deep dossiers, fetched when a player opens a wallet or a planet.
// A wallet costs about 16 credits across seven profiler endpoints and a
// token two more; both are remembered for an hour, in memory and on disk.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cached, nansen } from './nansen';
import { clean } from './galaxy';

export interface Holding { symbol: string; address: string; amount: number; usd: number }
export interface Point { t: string; usd: number }
export interface Counterparty { address: string; name: string; interactions: number; volumeUsd: number; inUsd: number; outUsd: number }
export interface Related { address: string; name: string; relation: string; at: string | null }
export interface Tx { at: string; hash: string; method: string; sent: string; received: string; usd: number | null }
export interface TokenPnl { symbol: string; address: string; realisedUsd: number; roi: number | null }

export interface WalletProfile {
  address: string;
  fetchedAt: string;
  balances: Holding[];
  totalUsd: number;
  history: Point[];
  counterparties: Counterparty[];
  related: Related[];
  transactions: Tx[];
  summary: { realisedUsd: number | null; realisedPct: number | null; winRate: number | null; tokens: number | null; trades: number | null; top: TokenPnl[] } | null;
  positions: { symbol: string; address: string; realisedUsd: number | null; unrealisedUsd: number | null; holdingUsd: number | null }[];
  credits: number;
  endpoints: string[];
}

export interface TokenProfile {
  address: string;
  fetchedAt: string;
  name: string | null;
  logo: string | null;
  details: Record<string, unknown> | null;
  candles: { t: string; close: number; volumeUsd: number }[];
  credits: number;
}

const DIR = process.env.GALAXY_CACHE_DIR ?? (process.env.VERCEL ? '/tmp' : '.cache');
const TTL = 60 * 60_000;

async function diskCached<T extends { fetchedAt: string }>(key: string, make: () => Promise<T>): Promise<T> {
  return cached(key, TTL, async () => {
    const file = path.join(DIR, `${key.replace(/[^a-z0-9:_-]/gi, '_')}.json`);
    try {
      const v = JSON.parse(await readFile(file, 'utf8')) as T;
      if (Date.now() - Date.parse(v.fetchedAt) < TTL) return v;
    } catch { /* not cached yet */ }
    const v = await make();
    try { await mkdir(DIR, { recursive: true }); await writeFile(file, JSON.stringify(v)); } catch { /* read-only fs */ }
    return v;
  });
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const labelOf = (l: string | string[] | null | undefined, a: string) => {
  const s = Array.isArray(l) ? l[0] : l;
  return (s && clean(s)) || short(a);
};

interface RawTokenMove { token_symbol: string | null; token_amount: number | null }

export const walletProfile = (address: string) => diskCached<WalletProfile>(`wallet:${address}`, async () => {
  const now = new Date();
  const date = { from: day(new Date(now.getTime() - 30 * 86_400_000)), to: day(now) };
  const base = { address, chain: 'monad' };
  let credits = 0;
  const endpoints: string[] = [];
  const call = async <T>(p: string, body: unknown) => {
    const r = await nansen<T>(p, body);
    credits += r.credits;
    if (r.body) endpoints.push(p);
    return r.body;
  };

  const [bal, hist, cps, rel, txs, sum, pnl] = await Promise.all([
    call<{ data: { token_symbol: string | null; token_address: string; token_amount: number; value_usd: number | null }[] }>('profiler/address/current-balance', base),
    call<{ data: { block_timestamp: string; value_usd: number | null }[] }>('profiler/address/historical-balances', { ...base, date, pagination: { page: 1, per_page: 500 } }),
    call<{ data: { counterparty_address: string; counterparty_address_label: string[] | string | null; interaction_count: number; total_volume_usd: number; volume_in_usd: number; volume_out_usd: number }[] }>('profiler/address/counterparties', { ...base, date, pagination: { page: 1, per_page: 25 } }),
    call<{ data: { address: string; address_label: string | null; relation: string; block_timestamp: string | null }[] }>('profiler/address/related-wallets', { ...base, pagination: { page: 1, per_page: 25 } }),
    call<{ data: { block_timestamp: string; transaction_hash: string; method: string | null; tokens_sent: RawTokenMove[] | null; tokens_received: RawTokenMove[] | null; volume_usd: number | null }[] }>('profiler/address/transactions', { ...base, date, pagination: { page: 1, per_page: 12 } }),
    call<{ traded_token_count?: number; traded_times?: number; realized_pnl_usd?: number; realized_pnl_percent?: number; win_rate?: number; top5_tokens?: { realized_pnl: number; realized_roi: number | null; token_address: string; token_symbol: string }[] }>('profiler/address/pnl-summary', { ...base, date }),
    call<{ data: { token_symbol: string | null; token_address: string; pnl_usd_realised: number | null; pnl_usd_unrealised: number | null; holding_usd: number | null }[] }>('profiler/address/pnl', { ...base, date, pagination: { page: 1, per_page: 20 } }),
  ]);

  const balances = (bal?.data ?? [])
    .map((b) => ({ symbol: b.token_symbol ?? '?', address: b.token_address, amount: b.token_amount, usd: b.value_usd ?? 0 }))
    .sort((a, b) => b.usd - a.usd);

  // Historical balances come one row per token per day; the portfolio line is their daily sum.
  const byDay = new Map<string, number>();
  for (const h of hist?.data ?? []) {
    const d = h.block_timestamp.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + (h.value_usd ?? 0));
  }
  const history = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([t, usd]) => ({ t, usd }));

  const moves = (m: RawTokenMove[] | null) => (m ?? []).slice(0, 2)
    .map((x) => `${Math.abs(x.token_amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${x.token_symbol ?? '?'}`).join(' + ');

  return {
    address,
    fetchedAt: now.toISOString(),
    balances,
    totalUsd: balances.reduce((s, b) => s + b.usd, 0),
    history,
    counterparties: (cps?.data ?? []).map((c) => ({
      address: c.counterparty_address.toLowerCase(), name: labelOf(c.counterparty_address_label, c.counterparty_address),
      interactions: c.interaction_count, volumeUsd: c.total_volume_usd, inUsd: c.volume_in_usd, outUsd: c.volume_out_usd,
    })),
    related: (rel?.data ?? []).map((r) => ({ address: r.address.toLowerCase(), name: labelOf(r.address_label, r.address), relation: r.relation, at: r.block_timestamp })),
    transactions: (txs?.data ?? []).map((t) => ({
      at: t.block_timestamp, hash: t.transaction_hash,
      method: (t.method ?? '').split('(')[0] || 'transfer',
      sent: moves(t.tokens_sent), received: moves(t.tokens_received), usd: t.volume_usd,
    })),
    summary: sum ? {
      realisedUsd: sum.realized_pnl_usd ?? null, realisedPct: sum.realized_pnl_percent ?? null, winRate: sum.win_rate ?? null,
      tokens: sum.traded_token_count ?? null, trades: sum.traded_times ?? null,
      top: (sum.top5_tokens ?? []).map((t) => ({ symbol: t.token_symbol, address: t.token_address.toLowerCase(), realisedUsd: t.realized_pnl, roi: t.realized_roi })),
    } : null,
    positions: (pnl?.data ?? []).map((p) => ({ symbol: p.token_symbol ?? '?', address: p.token_address, realisedUsd: p.pnl_usd_realised, unrealisedUsd: p.pnl_usd_unrealised, holdingUsd: p.holding_usd })),
    credits,
    endpoints,
  };
});

export const tokenProfile = (address: string) => diskCached<TokenProfile>(`token:${address}`, async () => {
  const now = new Date();
  const date = { from: day(new Date(now.getTime() - 30 * 86_400_000)), to: day(now) };
  const [info, ohlcv] = await Promise.all([
    nansen<{ data: { name?: string; logo?: string; token_details?: Record<string, unknown> } }>('tgm/token-information', { chain: 'monad', token_address: address, timeframe: '1d' }),
    nansen<{ data: { interval_start: string; close: number; volume_usd: number }[] }>('tgm/token-ohlcv', { chain: 'monad', token_address: address, timeframe: '1d', date }),
  ]);
  return {
    address,
    fetchedAt: now.toISOString(),
    name: info.body?.data?.name ?? null,
    logo: info.body?.data?.logo ?? null,
    details: info.body?.data?.token_details ?? null,
    candles: (ohlcv.body?.data ?? []).map((c) => ({ t: c.interval_start, close: c.close, volumeUsd: c.volume_usd })).sort((a, b) => a.t.localeCompare(b.t)),
    credits: info.credits + ohlcv.credits,
  };
});
