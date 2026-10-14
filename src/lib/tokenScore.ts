// Token Score: how likely a token is to dump, 0 (clear) to 100 (warning).
// Ported from Peregrine's Storm Score model. Five on-chain sub-scores, each 0 to 100,
// plus Nansen's own risk indicators, combined as: half Nansen, half the weighted
// mean of the on-chain sub-scores, then scaled by market-cap tier so a stablecoin or
// a very large asset cannot read "Warning" from DEX-side patterns alone.
// The weights are expert priors, not fitted to history; the UI says so.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// ---------- holder statistics (fractional shares, 0 to 1) ----------
const sortDesc = (s: number[]) => [...s].sort((a, b) => b - a);
export const topNShare = (s: number[], n: number) => sortDesc(s).slice(0, n).reduce((a, b) => a + b, 0);
/** HHI normalised for holder count: N equal holders read 0, one holder reads 1. */
export function normalizedHhi(s: number[]) {
  const n = s.length;
  if (n <= 1) return 0;
  const raw = s.reduce((x, v) => x + v * v, 0), floor = 1 / n;
  return Math.max(0, (raw - floor) / (1 - floor));
}
export function gini(s: number[]) {
  const n = s.length;
  if (n < 2) return 0;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let d = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d += Math.abs(s[i] - s[j]);
  return d / (2 * n * n * mean);
}
/** The smallest number of holders whose combined share passes `threshold`. */
export function nakamoto(s: number[], threshold = 0.51) {
  let c = 0;
  const sorted = sortDesc(s);
  for (let i = 0; i < sorted.length; i++) { c += sorted[i]; if (c > threshold) return i + 1; }
  return sorted.length;
}
/** Lorenz curve points, poorest holders first. */
export function lorenz(s: number[]) {
  const a = [...s].sort((x, y) => x - y), total = a.reduce((x, y) => x + y, 0) || 1;
  let run = 0;
  return [{ pop: 0, supply: 0 }, ...a.map((v, i) => ({ pop: (i + 1) / a.length, supply: (run += v) / total }))];
}

// ---------- sub-scores ----------
export function concentrationScore(shares: number[]) {
  const hhiN = normalizedHhi(shares), g = gini(shares), top10 = topNShare(shares, 10), k = nakamoto(shares);
  const score = 100 * (0.35 * hhiN + 0.25 * g + 0.25 * top10 + 0.15 * (1 - Math.min(k, 20) / 20));
  return { score: clamp(score, 0, 100), hhiN, gini: g, top10, nakamoto: k };
}

export interface HolderCluster { wallets: string[]; share: number; includesDeployer: boolean }
export function insiderScore(clusters: HolderCluster[], clusteredHolders: number) {
  const maxShare = clusters.reduce((m, c) => Math.max(m, c.share), 0);
  const deployer = clusters.some((c) => c.includesDeployer);
  const raw = 1.6 * maxShare + Math.min(0.3, 0.004 * clusteredHolders) + (deployer ? 0.15 : 0);
  return { score: 100 * Math.min(1, raw), maxShare, deployer };
}

/** Informed money selling while fresh wallets buy: the distribution-into-retail pattern. */
export function windShearScore(freshNetUsd: number, smartNetUsd: number, marketCapUsd: number) {
  const smOut = Math.max(0, -smartNetUsd), freshIn = Math.max(0, freshNetUsd);
  return 100 * sigmoid((8 * (freshIn - smOut)) / Math.max(marketCapUsd, 1));
}

export function exitLiquidityScore(liquidityUsd: number, marketCapUsd: number, maxClusterShare: number) {
  const ratio = liquidityUsd > 0 ? liquidityUsd / Math.max(marketCapUsd, 1) : 0;
  const ratioRisk = clamp(1 - ratio / 0.05, 0, 1);
  const absRisk = liquidityUsd > 0 ? clamp(1 - Math.log10(liquidityUsd / 1e5) / 3, 0, 1) : 1;
  const liquidityRisk = 100 * Math.min(ratioRisk, absRisk);
  const clusterToLiquidity = liquidityUsd > 0 ? (maxClusterShare * marketCapUsd) / liquidityUsd : maxClusterShare > 0 ? Infinity : 0;
  const clusterRisk = 100 * clamp(clusterToLiquidity, 0, 1);
  return { score: clamp((0.4 * liquidityRisk + 0.3 * clusterRisk) / 0.7, 0, 100), ratio, clusterToLiquidity };
}

export function sellPressureScore(top20BuyUsd: number, top20SellUsd: number, insiderSellUsd: number) {
  const total = top20BuyUsd + top20SellUsd;
  const skew = total > 0 ? top20SellUsd / total : 0.5;
  const insiderShare = top20SellUsd > 0 ? clamp(insiderSellUsd / top20SellUsd, 0, 1) : 0;
  return { score: clamp(100 * (0.5 * skew + 0.5 * insiderShare), 0, 100), skew, insiderShare };
}

// ---------- composite ----------
export interface SubScores {
  concentration: number | null; insider: number | null; windShear: number | null;
  exitLiquidity: number | null; sellPressure: number | null; nansenRisk: number | null;
}
export type SubKey = keyof SubScores;
export const SUB_KEYS: SubKey[] = ['concentration', 'insider', 'windShear', 'exitLiquidity', 'sellPressure', 'nansenRisk'];
const W: Record<SubKey, number> = { concentration: 0.9, insider: 1.1, windShear: 0.7, exitLiquidity: 1.0, sellPressure: 0.8, nansenRisk: 0.6 };

export type Band = 'clear' | 'cloudy' | 'watch' | 'warning';
export const bandOf = (s: number): Band => (s <= 25 ? 'clear' : s <= 50 ? 'cloudy' : s <= 75 ? 'watch' : 'warning');

const LEVEL: Record<string, number> = { low: 10, medium: 45, high: 80 };
const IND_WEIGHT: Record<string, number> = { 'liquidity-risk': 1, 'token-supply-inflation': 0.8, 'cex-flows': 0.6, 'btc-reflexivity': 0.25 };
/** Nansen's risk indicators as one 0 to 100 reading. */
export function nansenIndicatorRisk(indicators: { type: string; score: string | null }[], isStablecoin: boolean) {
  let w = 0, sum = 0;
  for (const r of indicators) {
    const v = r.score ? LEVEL[r.score.toLowerCase()] : undefined;
    if (v == null) continue;
    const wt = isStablecoin && r.type === 'token-supply-inflation' ? 0 : IND_WEIGHT[r.type] ?? 0.5;
    w += wt; sum += wt * v;
  }
  return w > 0 ? sum / w : null;
}

const MAJOR_WRAPPED = /^(W?ETH|WSTETH|WEETH|W?BTC|CBBTC|W?MON)$/i;
/** An established asset carries less dump risk than the same on-chain pattern on a small cap. */
export function sizeFactor(marketCapUsd: number | null | undefined, isStablecoin: boolean, symbol: string) {
  if (isStablecoin) return 0.35;
  if (MAJOR_WRAPPED.test(symbol.replace(/[^A-Za-z0-9]/g, ''))) return 0.45;
  const m = marketCapUsd ?? 0;
  return m >= 1e10 ? 0.45 : m >= 1e9 ? 0.7 : m >= 1e8 ? 0.9 : 1;
}

export interface TokenScore { score: number; band: Band; confidence: number; nansen: number | null; model: number | null; subScores: SubScores; missing: SubKey[] }
export function tokenScore(sub: SubScores, ctx: { marketCapUsd: number | null; isStablecoin: boolean; symbol: string }): TokenScore {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const n = ok(sub.nansenRisk) ? sub.nansenRisk : null;
  const own = SUB_KEYS.filter((k) => k !== 'nansenRisk' && ok(sub[k]));
  const ownW = own.reduce((s, k) => s + W[k], 0);
  const model = own.length ? own.reduce((s, k) => s + W[k] * (sub[k] as number), 0) / ownW : null;
  const raw = n != null && model != null ? 0.5 * n + 0.5 * model : (n ?? model ?? 50);
  const score = raw * sizeFactor(ctx.marketCapUsd, ctx.isStablecoin, ctx.symbol);
  const allW = SUB_KEYS.filter((k) => k !== 'nansenRisk').reduce((s, k) => s + W[k], 0);
  return { score, band: bandOf(score), confidence: (n != null ? 0.5 : 0) + 0.5 * (ownW / allW), nansen: n, model, subScores: sub, missing: SUB_KEYS.filter((k) => sub[k] == null) };
}

// ---------- the checklist (Peregrine's Token Checker) ----------
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export interface Check { id: string; title: string; status: CheckStatus; value: string; detail: string }
export type Verdict = 'low' | 'moderate' | 'high' | 'critical' | 'stablecoin' | 'unknown';

/** Raises the model's verdict when checks fail: one fail is at least Moderate, two or more at least High. */
export function verdictOf(band: Band | null, checks: Check[], isStablecoin: boolean): Verdict {
  if (isStablecoin) return 'stablecoin';
  const fails = checks.filter((c) => c.status === 'fail').length;
  let v: Verdict = band === 'clear' ? 'low' : band === 'cloudy' ? 'moderate' : band === 'watch' ? 'high' : band === 'warning' ? 'critical' : 'unknown';
  if (fails >= 2 && (v === 'low' || v === 'moderate' || v === 'unknown')) v = 'high';
  else if (fails === 1 && (v === 'low' || v === 'unknown')) v = 'moderate';
  return v;
}
