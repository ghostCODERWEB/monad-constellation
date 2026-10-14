// Token Checker for any Monad token: one report from Nansen's token-level data
// (token-information, holders, flow-intelligence, who-bought-sold, indicators,
// ohlcv, flows, and the first funders of the top holders), scored with the Token
// Score model and read as a short safety checklist. Ported from Peregrine's Token
// Checker. Every number comes from a named Nansen endpoint; where Nansen has
// nothing, a check says "n/a", never zero.
import { nansen, pool } from './nansen';
import { clean, getTokenIndex } from './galaxy';
import { diskCached } from './profile';
import { NEUTRAL, loadFunders, saveFunders, FUNDER_TTL } from './clusters';
import { universeDef, type UniverseId } from './universes';
import {
  concentrationScore, exitLiquidityScore, insiderScore, lorenz, nansenIndicatorRisk, sellPressureScore,
  tokenScore, verdictOf, windShearScore, type Check, type CheckStatus, type HolderCluster, type TokenScore, type Verdict,
} from './tokenScore';

export interface HolderRow { address: string; name: string; kind: 'wallet' | 'exchange' | 'contract' | 'fund'; share: number; usd: number; change7dPct: number | null }
export interface TraderRow { address: string; name: string; boughtUsd: number; soldUsd: number }

export interface TokenCheck {
  address: string; fetchedAt: string;
  symbol: string; name: string; logo: string | null; universe: UniverseId | null; universeName: string | null;
  priceUsd: number | null; marketCap: number | null; fdv: number | null; liquidityUsd: number | null;
  holdersTotal: number | null; deployedAt: string | null; ageDays: number | null; website: string | null; x: string | null; isStablecoin: boolean;
  spot: { volumeUsd: number; buyUsd: number; sellUsd: number; buys: number; sells: number; uniqueBuyers: number; uniqueSellers: number } | null;
  score: TokenScore; verdict: Verdict; checks: Check[]; fails: number;
  holders: { rows: HolderRow[]; top10: number; nakamoto: number; gini: number; lorenz: { pop: number; supply: number }[]; counted: number };
  clusters: { members: number; share: number; funder: string; includesDeployer: boolean }[];
  flows: { key: string; netUsd: number; wallets: number | null }[];
  trend: { t: string; holders: number; priceUsd: number | null }[];
  candles: { t: string; open: number; high: number; low: number; close: number; volumeUsd: number }[];
  top: { buyers: TraderRow[]; sellers: TraderRow[]; buyUsd: number; sellUsd: number };
  indicators: { type: string; kind: 'risk' | 'reward'; level: string | null; percentile: number | null }[];
  credits: number; sources: string[];
}

interface Holder { address: string; address_label: string | null; ownership_percentage: number | null; value_usd: number | null; balance_change_7d: number | null; token_amount: number | null }
interface Trader { address: string; address_label: string | null; bought_volume_usd: number | null; sold_volume_usd: number | null }
interface Related { address: string; address_label: string | null; relation: string }
interface Candle { interval_start: string; open: number; high: number; low: number; close: number; volume_usd: number }
interface FlowBucket { date: string; price_usd: number | null; holders_count: number | null }

const day = (d: Date) => d.toISOString().slice(0, 10);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const usd = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`);
const kindOf = (label: string): HolderRow['kind'] =>
  /🏦|exchange|binance|coinbase|okx|bybit|kraken|bitget|kucoin|mexc|htx/i.test(label) ? 'exchange'
    : /contract|pool|router|vault|bridge|token contract|🤖|liquidity/i.test(label) ? 'contract'
      : /fund|capital|ventures|🏦/i.test(label) ? 'fund' : 'wallet';

const CHECK_TTL = 30 * 60_000;

export const checkToken = (address: string) => diskCached<TokenCheck>(`check2:${address}`, async () => {
  const now = new Date();
  let credits = 0;
  const sources = new Set<string>();
  const call = async <T,>(p: string, body: unknown): Promise<T | null> => {
    const r = await nansen<T>(p, body);
    credits += r.credits; if (r.body) sources.add(p);
    return r.body;
  };
  const base = { chain: 'monad', token_address: address };
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  type Info = { name?: string; logo?: string; symbol?: string; token_details?: Record<string, unknown>; spot_metrics?: Record<string, number> };
  const [infoRaw, holders, flowInt, wbs, ind, ohlcv, flows, index] = await Promise.all([
    call<Info & { data?: Info }>('tgm/token-information', { ...base, timeframe: '1d' }),
    call<{ data: Holder[] }>('tgm/holders', { ...base, pagination: { page: 1, per_page: 100 }, order_by: [{ field: 'token_amount', direction: 'DESC' }] }),
    call<{ data: Record<string, number | null>[] }>('tgm/flow-intelligence', { ...base, timeframe: '1d' }),
    call<{ data: Trader[] }>('tgm/who-bought-sold', { ...base, date: { from: ago(7), to: now.toISOString() }, pagination: { page: 1, per_page: 100 } }),
    call<{ token_info?: { is_stablecoin?: boolean; market_cap_group?: string }; risk_indicators?: { indicator_type: string; score: string | null; signal_percentile: number | null }[]; reward_indicators?: { indicator_type: string; score: string | null; signal_percentile: number | null }[] }>('tgm/indicators', base),
    call<{ data: Candle[] }>('tgm/token-ohlcv', { ...base, timeframe: '1d', date: { from: day(new Date(now.getTime() - 60 * 86_400_000)), to: day(now) } }),
    call<{ data: FlowBucket[] }>('tgm/flows', { ...base, date: { from: ago(30), to: now.toISOString() }, pagination: { page: 1, per_page: 100 } }),
    getTokenIndex(),
  ]);

  const info: Info | null = infoRaw ? (infoRaw.data ?? infoRaw) : null; // Nansen wraps this one in `data` on some responses
  const meta = index.find((t) => t.address === address);
  const d = info?.token_details ?? {};
  const spotRaw = info?.spot_metrics;
  const symbol = info?.symbol ?? meta?.symbol ?? short(address);
  const isStable = !!ind?.token_info?.is_stablecoin;
  const marketCap = (d.market_cap_usd as number | undefined) ?? meta?.marketCap ?? null;
  const liquidity = spotRaw?.liquidity_usd ?? meta?.liquidity ?? null;
  const deployedAt = typeof d.token_deployment_date === 'string' ? d.token_deployment_date.replace(' ', 'T') + 'Z' : null;
  const ageDays = deployedAt ? Math.max(0, Math.floor((now.getTime() - Date.parse(deployedAt)) / 86_400_000)) : meta?.ageDays ?? null;

  // Holders, with exchanges and contracts set aside: concentration is about wallets that can decide.
  const rawHolders = holders?.data ?? [];
  const rows: HolderRow[] = rawHolders.map((h) => {
    const label = h.address_label ?? '';
    return { address: h.address.toLowerCase(), name: clean(label) || short(h.address), kind: kindOf(label), share: h.ownership_percentage ?? 0, usd: h.value_usd ?? 0, change7dPct: null };
  });
  const real = rows.filter((r) => r.kind === 'wallet' || r.kind === 'fund');
  const shares = real.map((r) => r.share).filter((s) => s > 0);
  const conc = shares.length ? concentrationScore(shares) : null;

  // Insider clusters: top holders that share a first funder.
  const funders = await loadFunders();
  const topWallets = real.slice(0, 15).map((r) => r.address);
  const stale = topWallets.filter((a) => !funders[a] || Date.now() - funders[a].at > FUNDER_TTL);
  await pool(stale, 5, async (a) => {
    const r = await nansen<{ data: Related[] }>('profiler/address/related-wallets', { address: a, chain: 'monad', pagination: { page: 1, per_page: 10 } });
    credits += r.credits;
    if (!r.body) return;
    sources.add('profiler/address/related-wallets');
    const ff = r.body.data.find((x) => /first funder/i.test(x.relation));
    funders[a] = { at: Date.now(), funder: ff ? { address: ff.address.toLowerCase(), label: ff.address_label ?? '' } : null };
  });
  if (stale.length) await saveFunders(funders);
  const byFunder = new Map<string, string[]>();
  for (const a of topWallets) {
    const f = funders[a]?.funder;
    if (!f || NEUTRAL.test(f.label)) continue;
    byFunder.set(f.address, [...(byFunder.get(f.address) ?? []), a]);
  }
  const shareOf = new Map(rows.map((r) => [r.address, r.share]));
  const clusters: HolderCluster[] = [];
  const clusterInfo: TokenCheck['clusters'] = [];
  for (const [funder, members] of byFunder) {
    if (members.length < 2) continue;
    const share = members.reduce((s, a) => s + (shareOf.get(a) ?? 0), 0);
    clusters.push({ wallets: members, share, includesDeployer: false });
    clusterInfo.push({ members: members.length, share, funder: clean(funders[members[0]]?.funder?.label ?? '') || short(funder), includesDeployer: false });
  }
  const clusteredHolders = clusters.reduce((s, c) => s + c.wallets.length, 0);
  const ins = topWallets.length >= 5 ? insiderScore(clusters, clusteredHolders) : null;

  // Smart-money and fresh-wallet flow, and who is selling.
  const fi = flowInt?.data?.[0] ?? null;
  const wind = fi && marketCap ? windShearScore(fi.fresh_wallets_net_flow_usd ?? 0, (fi.smart_trader_net_flow_usd ?? 0) + (fi.top_pnl_net_flow_usd ?? 0), marketCap) : null;
  const traders: TraderRow[] = (wbs?.data ?? []).map((t) => ({ address: t.address.toLowerCase(), name: clean(t.address_label ?? '') || short(t.address), boughtUsd: t.bought_volume_usd ?? 0, soldUsd: t.sold_volume_usd ?? 0 }));
  const topBuyers = [...traders].sort((a, b) => b.boughtUsd - a.boughtUsd).slice(0, 20);
  const topSellers = [...traders].sort((a, b) => b.soldUsd - a.soldUsd).slice(0, 20);
  const buyUsd = topBuyers.reduce((s, t) => s + t.boughtUsd, 0), sellUsd = topSellers.reduce((s, t) => s + t.soldUsd, 0);
  const clustered = new Set(clusters.flatMap((c) => c.wallets));
  const insiderSell = topSellers.filter((t) => clustered.has(t.address)).reduce((s, t) => s + t.soldUsd, 0);
  const sell = traders.length ? sellPressureScore(buyUsd, sellUsd, insiderSell) : null;
  const exit = liquidity != null && marketCap ? exitLiquidityScore(liquidity, marketCap, ins?.maxShare ?? 0) : null;

  const indicators = [
    ...(ind?.risk_indicators ?? []).map((r) => ({ type: r.indicator_type, kind: 'risk' as const, level: r.score, percentile: r.signal_percentile })),
    ...(ind?.reward_indicators ?? []).map((r) => ({ type: r.indicator_type, kind: 'reward' as const, level: r.score, percentile: r.signal_percentile })),
  ];
  const nansenRisk = nansenIndicatorRisk(indicators.filter((i) => i.kind === 'risk').map((i) => ({ type: i.type, score: i.level })), isStable);
  const score = tokenScore({ concentration: conc?.score ?? null, insider: ins?.score ?? null, windShear: wind, exitLiquidity: exit?.score ?? null, sellPressure: sell?.score ?? null, nansenRisk }, { marketCapUsd: marketCap, isStablecoin: isStable, symbol });

  // The checklist: each check is one measured number against stated thresholds.
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  if (liquidity != null && marketCap) {
    const r = liquidity / marketCap;
    add({ id: 'liquidity', title: 'Exit liquidity', status: r < 0.02 || liquidity < 25_000 ? 'fail' : r < 0.05 || liquidity < 100_000 ? 'warn' : 'pass', value: `${usd(liquidity)} · ${pct(r, 1)} of mcap`, detail: 'DEX liquidity against market cap. Under 2% (or $25K) means a large holder can’t sell without crashing the price; under 5% is thin.' });
  } else add({ id: 'liquidity', title: 'Exit liquidity', status: 'unknown', value: 'n/a', detail: 'Nansen returned no liquidity or market cap for this token.' });
  if (conc) add({ id: 'concentration', title: 'Top-10 holders', status: conc.top10 >= 0.6 ? 'fail' : conc.top10 >= 0.35 ? 'warn' : 'pass', value: `${pct(conc.top10)} of supply · ${conc.nakamoto} to reach 51%`, detail: 'Share held by the ten largest non-custodial wallets (exchanges and contracts set aside). Over 60% lets a few wallets decide the price.' });
  else add({ id: 'concentration', title: 'Top-10 holders', status: 'unknown', value: 'n/a', detail: 'No non-custodial holders among the top 100.' });
  if (ins) {
    const status: CheckStatus = ins.maxShare >= 0.3 ? 'fail' : clusters.length && (ins.maxShare >= 0.1) ? 'warn' : 'pass';
    add({ id: 'insiders', title: 'Insider clusters', status, value: clusters.length ? `${pct(clusters.reduce((s, c) => s + c.share, 0))} of supply in ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}` : 'No linked holders', detail: 'Top holders that share a first funder: coordinated wallets can exit together.' });
  } else add({ id: 'insiders', title: 'Insider clusters', status: 'unknown', value: 'n/a', detail: 'Too few wallet holders to trace funders.' });
  if (ageDays != null) add({ id: 'age', title: 'Token age', status: ageDays < 3 ? 'fail' : ageDays < 30 ? 'warn' : 'pass', value: `${ageDays.toLocaleString('en-US')} day${ageDays === 1 ? '' : 's'}`, detail: 'Most rugs happen in a token’s first days. Under 3 days is very new; under 30 is young.' });
  else add({ id: 'age', title: 'Token age', status: 'unknown', value: 'n/a', detail: 'Nansen returned no deployment date.' });
  if (sell) add({ id: 'selling', title: 'Sell pressure', status: sell.score >= 70 ? 'fail' : sell.score >= 50 ? 'warn' : 'pass', value: `${Math.round(sell.score)} / 100`, detail: 'The 20 biggest sellers against the 20 biggest buyers over 7 days, with sells from clustered insiders counted extra.' });
  else add({ id: 'selling', title: 'Sell pressure', status: 'unknown', value: 'n/a', detail: 'Nansen returned no traders for this token.' });
  if (nansenRisk != null) add({ id: 'nansen', title: 'Nansen risk indicators', status: nansenRisk >= 65 ? 'fail' : nansenRisk >= 40 ? 'warn' : 'pass', value: `${Math.round(nansenRisk)} / 100`, detail: `Nansen’s ${indicators.filter((i) => i.kind === 'risk').length} risk indicator${indicators.filter((i) => i.kind === 'risk').length === 1 ? '' : 's'} (${indicators.filter((i) => i.kind === 'risk').map((i) => `${i.type.replace(/-/g, ' ')}: ${i.level}`).join(', ')}).` });
  else add({ id: 'nansen', title: 'Nansen risk indicators', status: 'unknown', value: 'n/a', detail: 'Nansen has not scored this token’s risk indicators.' });
  const fails = checks.filter((c) => c.status === 'fail').length;
  const verdict = verdictOf(score.band, checks, isStable);

  // Price history and the holder trend.
  const candles = (ohlcv?.data ?? []).map((c) => ({ t: c.interval_start, open: c.open, high: c.high, low: c.low, close: c.close, volumeUsd: c.volume_usd })).sort((a, b) => a.t.localeCompare(b.t));
  const byDay = new Map<string, { holders: number; priceUsd: number | null }>();
  for (const f of flows?.data ?? []) byDay.set(f.date.slice(0, 10), { holders: f.holders_count ?? 0, priceUsd: f.price_usd });
  const trend = [...byDay.entries()].sort().map(([t, v]) => ({ t, ...v }));
  const holders7 = rawHolders.reduce<Record<string, number | null>>((o, h) => ({ ...o, [h.address.toLowerCase()]: h.balance_change_7d }), {});
  for (const r of rows) r.change7dPct = holders7[r.address] != null ? holders7[r.address]! * 100 : null;
  const u = meta?.category ?? null;

  return {
    address, fetchedAt: now.toISOString(),
    symbol, name: info?.name ?? meta?.name ?? symbol, logo: info?.logo ?? null, universe: u, universeName: u ? universeDef(u)?.name ?? null : null,
    priceUsd: candles.at(-1)?.close ?? trend.at(-1)?.priceUsd ?? null, marketCap, fdv: (d.fdv_usd as number | undefined) ?? null, liquidityUsd: liquidity,
    holdersTotal: spotRaw?.total_holders ?? null, deployedAt, ageDays, website: (d.website as string) || null, x: (d.x as string) || null, isStablecoin: isStable,
    spot: spotRaw ? { volumeUsd: spotRaw.volume_total_usd ?? 0, buyUsd: spotRaw.buy_volume_usd ?? 0, sellUsd: spotRaw.sell_volume_usd ?? 0, buys: spotRaw.total_buys ?? 0, sells: spotRaw.total_sells ?? 0, uniqueBuyers: spotRaw.unique_buyers ?? 0, uniqueSellers: spotRaw.unique_sellers ?? 0 } : null,
    score, verdict, checks, fails,
    holders: { rows: rows.slice(0, 25), top10: conc?.top10 ?? 0, nakamoto: conc?.nakamoto ?? 0, gini: conc?.gini ?? 0, lorenz: shares.length ? lorenz(shares) : [], counted: shares.length },
    clusters: clusterInfo,
    flows: fi ? ['smart_trader', 'whale', 'top_pnl', 'public_figure', 'exchange', 'fresh_wallets'].map((k) => ({ key: k, netUsd: fi[`${k}_net_flow_usd`] ?? 0, wallets: k === 'exchange' ? null : fi[`${k}_wallet_count`] ?? null })) : [],
    trend, candles,
    top: { buyers: topBuyers.slice(0, 8), sellers: topSellers.slice(0, 8), buyUsd, sellUsd },
    indicators, credits, sources: [...sources],
  };
}, CHECK_TTL);
