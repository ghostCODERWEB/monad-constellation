// Insider clusters: holders of one token who were funded by the same wallet,
// or who pass the token between themselves. Funded-together is the classic
// insider pattern (one deployer seeds many "independent" wallets); a shared
// exchange hot wallet or an airdrop distributor is not, so those are ignored.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cached, nansen, pool } from './nansen';
import { clean, getGalaxy, type Galaxy } from './galaxy';
import type { UniverseId } from './universes';

export interface Cluster {
  id: string;
  planet: number;
  /** Star indexes of the member wallets. */
  members: number[];
  kind: 'funded' | 'ring';
  /** The shared first funder, for funded clusters. */
  funder: { address: string; name: string; star: number | null } | null;
  /** Combined share of the token's supply. */
  share: number;
  holdingUsd: number;
  /** Transfers between members in the last day (tgm/transfers). */
  transfers: number;
  severity: 'high' | 'medium';
  evidence: string;
  /** Other worlds where the same funder seeded top holders. */
  alsoIn: number[];
}

export interface ClusterReport {
  builtAt: string;
  galaxyBuiltAt: string;
  clusters: Cluster[];
  checked: number;
  credits: number;
}

interface Related { address: string; address_label: string | null; relation: string }

const PER_PLANET = 12;
const DIR = process.env.GALAXY_CACHE_DIR ?? (process.env.VERCEL ? '/tmp' : '.cache');
const FUNDERS_FILE = path.join(DIR, 'funders.json');
const FUNDER_TTL = 24 * 60 * 60_000;
const TTL = 3 * 60 * 60_000;

// A shared funder that is an exchange, bridge, distributor or router says
// nothing about who controls the wallets it funded.
const NEUTRAL = /🏦|🤖|exchange|hot wallet|binance|coinbase|bybit|okx|kraken|bitget|kucoin|gate|mexc|htx|distributor|airdrop|bridge|router|relay|li\.fi|cctp|faucet|deployer: monad/i;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type FunderCache = Record<string, { at: number; funder: { address: string; label: string } | null }>;

async function loadFunders(): Promise<FunderCache> {
  try { return JSON.parse(await readFile(FUNDERS_FILE, 'utf8')) as FunderCache; } catch { return {}; }
}

async function build(universe: UniverseId): Promise<ClusterReport> {
  const galaxy: Galaxy = await getGalaxy(universe);
  const funders = await loadFunders();
  let credits = 0;

  // Candidates: each world's biggest holders, contracts and pools excluded.
  const candidates = new Map<number, number[]>();
  galaxy.planets.forEach((_, p) => {
    const list = galaxy.stars
      .map((s, i) => ({ i, s, l: s.links.find((x) => x.p === p) }))
      .filter((x) => x.l && x.l.share > 0 && x.s.kind !== 'contract')
      .sort((a, b) => b.l!.share - a.l!.share)
      .slice(0, PER_PLANET)
      .map((x) => x.i);
    candidates.set(p, list);
  });

  // First funders, one profiler call per wallet, remembered for a day.
  const wallets = [...new Set([...candidates.values()].flat())].map((i) => galaxy.stars[i].address);
  const stale = wallets.filter((a) => !funders[a] || Date.now() - funders[a].at > FUNDER_TTL);
  await pool(stale, 5, async (address) => {
    const r = await nansen<{ data: Related[] }>('profiler/address/related-wallets', { address, chain: 'monad', pagination: { page: 1, per_page: 10 } });
    credits += r.credits;
    if (!r.body) return;
    const ff = r.body.data.find((x) => /first funder/i.test(x.relation));
    funders[address] = { at: Date.now(), funder: ff ? { address: ff.address.toLowerCase(), label: ff.address_label ?? '' } : null };
  });
  try { await mkdir(DIR, { recursive: true }); await writeFile(FUNDERS_FILE, JSON.stringify(funders)); } catch { /* read-only fs */ }

  const starOf = new Map(galaxy.stars.map((s, i) => [s.address, i]));
  const clusters: Cluster[] = [];

  galaxy.planets.forEach((planet, p) => {
    const ids = candidates.get(p) ?? [];
    // Custodians and bridges of an established asset move coins between
    // themselves all day; that is plumbing, not insiders.
    const established = planet.capGroup === 'largecap' || planet.capGroup === 'midcap' || (planet.marketCap ?? 0) >= 10_000_000;
    const shareOf = (i: number) => galaxy.stars[i].links.find((l) => l.p === p)?.share ?? 0;
    const usdOf = (i: number) => galaxy.stars[i].links.find((l) => l.p === p)?.holdingUsd ?? 0;
    const inPlanet = new Set(ids);
    const trailsHere = galaxy.trails.filter((t) => t.p === p);
    const transfersAmong = (m: number[]) => {
      const set = new Set(m);
      return trailsHere.filter((t) => set.has(t.from) && set.has(t.to)).length;
    };
    const used = new Set<number>();

    // Funded together: two or more holders with the same, non-neutral first funder.
    const byFunder = new Map<string, number[]>();
    for (const i of ids) {
      const f = funders[galaxy.stars[i].address]?.funder;
      if (!f || NEUTRAL.test(f.label)) continue;
      byFunder.set(f.address, [...(byFunder.get(f.address) ?? []), i]);
    }
    // A holder that funded other holders belongs with them.
    for (const [f, members] of byFunder) {
      const fi = starOf.get(f);
      if (fi != null && inPlanet.has(fi) && !members.includes(fi)) members.push(fi);
    }
    for (const [f, members] of byFunder) {
      if (members.length < 2) continue;
      const share = members.reduce((s, i) => s + shareOf(i), 0);
      const fi = starOf.get(f) ?? null;
      const label = funders[galaxy.stars[members[0]].address]?.funder?.label ?? '';
      const name = clean(label) || short(f);
      members.forEach((i) => used.add(i));
      clusters.push({
        id: `${planet.symbol}:${f}`,
        planet: p, members, kind: 'funded',
        funder: { address: f, name, star: fi },
        share, holdingUsd: members.reduce((s, i) => s + usdOf(i), 0),
        transfers: transfersAmong(members),
        severity: share >= 0.05 && !established ? 'high' : 'medium',
        evidence: `${members.length} of the top ${ids.length} holders were first funded by ${name}.`,
        alsoIn: [],
      });
    }

    // Rings: top holders passing the token between themselves today.
    const parent = new Map<number, number>();
    const find = (x: number): number => { const px = parent.get(x) ?? x; if (px === x) return x; const r = find(px); parent.set(x, r); return r; };
    for (const t of established ? [] : trailsHere) {
      if (!inPlanet.has(t.from) || !inPlanet.has(t.to) || used.has(t.from) || used.has(t.to)) continue;
      parent.set(find(t.from), find(t.to));
    }
    const rings = new Map<number, number[]>();
    for (const i of ids) if (parent.has(i) || [...parent.values()].includes(i)) {
      const r = find(i);
      rings.set(r, [...(rings.get(r) ?? []), i]);
    }
    for (const members of rings.values()) {
      if (members.length < 2) continue;
      const share = members.reduce((s, i) => s + shareOf(i), 0);
      const n = transfersAmong(members);
      clusters.push({
        id: `${planet.symbol}:ring:${galaxy.stars[members[0]].address}`,
        planet: p, members, kind: 'ring', funder: null,
        share, holdingUsd: members.reduce((s, i) => s + usdOf(i), 0),
        transfers: n,
        severity: share >= 0.05 ? 'high' : 'medium',
        evidence: `${members.length} top holders moved $${planet.symbol} between each other ${n} time${n > 1 ? 's' : ''} today.`,
        alsoIn: [],
      });
    }
  });

  // A funder seeding top holders on several worlds is the strongest signal of all.
  for (const c of clusters) {
    if (!c.funder) continue;
    c.alsoIn = clusters.filter((o) => o !== c && o.funder?.address === c.funder!.address).map((o) => o.planet);
    if (c.alsoIn.length) c.evidence += ` The same wallet seeded top holders of ${c.alsoIn.map((p) => `$${galaxy.planets[p].symbol}`).join(', ')}.`;
    if (c.alsoIn.length >= 2) c.severity = 'high';
  }
  const kept = clusters.filter((c) => c.share >= 0.005);
  kept.sort((a, b) => (a.severity === b.severity ? b.share - a.share : a.severity === 'high' ? -1 : 1));
  clusters.length = 0;
  clusters.push(...kept);
  return { builtAt: new Date().toISOString(), galaxyBuiltAt: galaxy.builtAt, clusters, checked: wallets.length, credits };
}

export const getClusters = (universe: UniverseId = 'majors') => cached(`clusters-${universe}`, TTL, () => build(universe));
