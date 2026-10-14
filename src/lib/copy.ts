// Copy Lab: which Monad wallets have a record that looks copyable, scored the way
// Peregrine's copy-trade score does (return, consistency, size, activity, label),
// from the wallets the five universes already know (Nansen holders, PnL leaderboard
// and 24h trades per token). It rates how copyable a record LOOKS, not whether to
// copy it. Following is paper only: nothing is ever bought or sold.
import { cached } from './nansen';
import { getGalaxy, type Galaxy, type StarKind } from './galaxy';
import { UNIVERSES } from './universes';

export interface CopyPart { id: string; label: string; points: number; detail: string }
export interface CopyCandidate {
  address: string; name: string; kind: StarKind; score: number; parts: CopyPart[];
  pnlUsd: number; roiPct: number | null; trades: number; holdingUsd: number; tokensProfitable: number; tokensTraded: number;
  /** What it holds right now, by token (the weights a paper follow copies). */
  holdings: { address: string; symbol: string; usd: number; pnlUsd: number | null }[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const usd = (x: number) => (Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : Math.abs(x) >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`);

/** score = 50 + Σ parts, clamped 0 to 100:
 *   return      25·tanh(ROI ÷ 10%)            profit against what it put in (Monad ROIs run small)
 *   consistency +15 when profitable on at least two tokens and on most of the tokens it traded; −5 when it lost on most
 *   activity    +5 at 5 or more trades; −5 under 2 (one trade is not a record)
 *   label       +10 Nansen Smart Money; +5 fund or named wallet
 *   size        −10 holding under $1K; −15 when it holds nothing now (nothing to follow) */
function score(c: Omit<CopyCandidate, 'score' | 'parts'>, kind: StarKind): { score: number; parts: CopyPart[] } {
  const parts: CopyPart[] = [];
  if (c.roiPct != null) parts.push({ id: 'roi', label: 'Return', points: Math.round(25 * Math.tanh(c.roiPct / 10)), detail: `${c.roiPct.toFixed(1)}% ROI on the tokens it traded` });
  const frac = c.tokensTraded ? c.tokensProfitable / c.tokensTraded : 0;
  if (c.tokensProfitable >= 2 && frac >= 0.5) parts.push({ id: 'consistency', label: 'Consistent', points: 15, detail: `profitable on ${c.tokensProfitable} of ${c.tokensTraded} tokens` });
  else if (c.tokensTraded >= 2 && frac < 0.5) parts.push({ id: 'consistency', label: 'Uneven', points: -5, detail: `profitable on only ${c.tokensProfitable} of ${c.tokensTraded} tokens` });
  if (c.trades >= 5) parts.push({ id: 'activity', label: 'Active', points: 5, detail: `${c.trades} trades` });
  else if (c.trades < 2) parts.push({ id: 'activity', label: 'Thin record', points: -5, detail: `${c.trades} trade${c.trades === 1 ? '' : 's'}: too few to judge` });
  if (kind === 'smart') parts.push({ id: 'label', label: 'Smart Money', points: 10, detail: 'labelled Smart Money by Nansen' });
  else if (kind === 'fund' || kind === 'named') parts.push({ id: 'label', label: 'Known wallet', points: 5, detail: 'carries a Nansen label' });
  if (c.holdingUsd <= 0) parts.push({ id: 'empty', label: 'Holds nothing now', points: -15, detail: 'nothing to follow today' });
  else if (c.holdingUsd < 1_000) parts.push({ id: 'small', label: 'Small book', points: -10, detail: `${usd(c.holdingUsd)} in view: one trade moves it a lot` });
  return { score: Math.round(clamp(50 + parts.reduce((s, p) => s + p.points, 0), 0, 100)), parts: parts.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)) };
}

export const getCopy = () => cached('copy', 30 * 60_000, async () => {
  const galaxies: Galaxy[] = (await Promise.all(UNIVERSES.map((u) => getGalaxy(u.id)))).filter((g) => g.planets.length);
  const byWallet = new Map<string, CopyCandidate & { _kind: StarKind; _roiWeight: number; _roiSum: number }>();
  for (const g of galaxies) {
    for (const s of g.stars) {
      if (s.kind === 'contract' || s.kind === 'exchange') continue;
      let c = byWallet.get(s.address);
      if (!c) {
        c = { address: s.address, name: s.name, kind: s.kind, score: 0, parts: [], pnlUsd: 0, roiPct: null, trades: 0, holdingUsd: 0, tokensProfitable: 0, tokensTraded: 0, holdings: [], _kind: s.kind, _roiWeight: 0, _roiSum: 0 };
        byWallet.set(s.address, c);
      }
      for (const l of s.links) {
        const p = g.planets[l.p];
        c.holdingUsd += l.holdingUsd;
        if (l.holdingUsd > 0) c.holdings.push({ address: p.address, symbol: p.symbol, usd: l.holdingUsd, pnlUsd: l.pnlUsd });
        if (l.pnlUsd != null) {
          c.tokensTraded++; c.pnlUsd += l.pnlUsd; if (l.pnlUsd > 0) c.tokensProfitable++;
          c.trades += l.trades ?? 0;
          if (l.roi != null) { const w = Math.max(1, Math.abs(l.pnlUsd)); c._roiSum += l.roi * w; c._roiWeight += w; }
        }
      }
    }
  }
  const out: CopyCandidate[] = [];
  for (const c of byWallet.values()) {
    if (c.tokensTraded === 0 || c.pnlUsd <= 0) continue;
    c.roiPct = c._roiWeight ? (c._roiSum / c._roiWeight) * 100 : null; // Nansen gives ROI as a fraction
    c.holdings.sort((a, b) => b.usd - a.usd);
    const { score: sc, parts } = score(c, c._kind);
    out.push({ address: c.address, name: c.name, kind: c.kind, score: sc, parts, pnlUsd: c.pnlUsd, roiPct: c.roiPct, trades: c.trades, holdingUsd: c.holdingUsd, tokensProfitable: c.tokensProfitable, tokensTraded: c.tokensTraded, holdings: c.holdings.slice(0, 8) });
  }
  out.sort((a, b) => b.score - a.score || b.pnlUsd - a.pnlUsd);
  return { builtAt: new Date().toISOString(), wallets: byWallet.size, candidates: out.slice(0, 40) };
});
