// Reputation: a 0..1000 score per wallet, from what Nansen says about it and
// what it has done. Published on Monad by MonadReputation so any contract can
// ask the chain whether a wallet has a track record.
//
// Every point is attributable. Methodology "nansen-rep-v1":
//   base       100   everyone starts somewhere
//   profit    ±400   realised + open PnL from tgm/pnl-leaderboard, log-scaled;
//                    a loser loses up to 150
//   labels    0–250  Nansen's own read: smart trader 250, fund 200, active
//                    trader 110, named 90, whale 70
//   breadth   0–100  tokens it holds or trades in this galaxy, past the first
//   size      0–150  holdings plus today's volume, log-scaled
//   insider  −300    member of an insider cluster (shared first funder or
//                    a transfer ring among top holders); −200 for the funder
// Contracts, pools, routers and exchanges are infrastructure, not people,
// and are not scored.
import { keccak256, toUtf8Bytes } from 'ethers';
import { cached } from './nansen';
import { getGalaxy, type StarKind } from './galaxy';
import { getClusters } from './clusters';
import type { UniverseId } from './universes';

export const METHODOLOGY = 'nansen-rep-v1';

export { FLAG, FLAG_NAMES, type Reputation, type ReputationSet, type Tier } from './repFlags';
import { FLAG, type Reputation, type ReputationSet, type Tier } from './repFlags';

const LABEL_POINTS: Partial<Record<StarKind, number>> = { smart: 250, fund: 200, trader: 110, named: 90, whale: 70 };
const KIND_FLAG: Partial<Record<StarKind, number>> = { smart: FLAG.SMART, fund: FLAG.FUND, whale: FLAG.WHALE, named: FLAG.NAMED, trader: FLAG.TRADER };

export function tierOf(score: number, flags: number): Tier {
  if (flags & (FLAG.INSIDER | FLAG.FUNDER)) return 'Insider-linked';
  return score >= 750 ? 'Proven' : score >= 550 ? 'Trusted' : score >= 300 ? 'Known' : 'Unproven';
}

async function build(universe: UniverseId): Promise<ReputationSet> {
  const [galaxy, clusters] = await Promise.all([getGalaxy(universe), getClusters(universe)]);
  const insiders = new Set<number>();
  const funders = new Set<number>();
  for (const c of clusters.clusters) {
    c.members.forEach((m) => insiders.add(m));
    if (c.funder?.star != null && !c.members.includes(c.funder.star)) funders.add(c.funder.star);
  }

  let skipped = 0;
  const wallets: Reputation[] = [];
  galaxy.stars.forEach((s, i) => {
    if (s.kind === 'contract' || s.kind === 'exchange') { skipped++; return; }
    const pnl = s.pnlUsd;
    const profit = pnl > 0 ? Math.min(400, 80 * Math.log10(1 + pnl)) : pnl < 0 ? -Math.min(150, 30 * Math.log10(1 - pnl)) : 0;
    const labels = LABEL_POINTS[s.kind] ?? 0;
    const breadth = Math.min(100, Math.max(0, s.links.length - 1) * 35);
    const size = Math.min(150, 25 * Math.log10(1 + s.holdingUsd + s.volume24hUsd));
    const insider = insiders.has(i) ? -300 : funders.has(i) ? -200 : 0;
    const raw = 100 + profit + labels + breadth + size + insider;
    const score = Math.round(Math.max(0, Math.min(1000, raw)));
    let flags = KIND_FLAG[s.kind] ?? 0;
    if (pnl > 0) flags |= FLAG.PROFITABLE;
    if (insiders.has(i)) flags |= FLAG.INSIDER;
    if (funders.has(i)) flags |= FLAG.FUNDER;
    const r = (x: number) => Math.round(x);
    wallets.push({
      address: s.address, star: i, score, flags, tier: tierOf(score, flags),
      parts: { base: 100, profit: r(profit), labels, breadth: r(breadth), size: r(size), insider },
    });
  });
  wallets.sort((a, b) => b.score - a.score);

  const lines = [...wallets].sort((a, b) => a.address.localeCompare(b.address)).map((w) => `${w.address},${w.score},${w.flags}`).join('\n');
  return {
    builtAt: new Date().toISOString(),
    methodology: METHODOLOGY,
    datasetHash: keccak256(toUtf8Bytes(lines)),
    wallets,
    stats: {
      scored: wallets.length, skipped,
      proven: wallets.filter((w) => w.tier === 'Proven').length,
      trusted: wallets.filter((w) => w.tier === 'Trusted').length,
      insiders: wallets.filter((w) => w.tier === 'Insider-linked').length,
    },
  };
}

export const getReputation = (universe: UniverseId = 'majors') => cached(`reputation-${universe}`, 30 * 60_000, () => build(universe));
