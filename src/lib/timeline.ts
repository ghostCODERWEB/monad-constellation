// The last day on Monad, as a replayable timeline: every meaningful trade on
// each world (tgm/dex-trades) and every wallet-to-wallet transfer the galaxy
// already holds (tgm/transfers), each at its real time.
//
// Busy tokens trade thousands of times a day, and Nansen pages newest first,
// so paging would replay only the last few hours of them. Instead a busy
// token is sampled as the largest trades of each three-hour slice, which
// keeps the whole day represented; a quiet token is fetched whole.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cached, nansen, pool } from './nansen';
import { clean, getGalaxy, kindOf, type StarKind } from './galaxy';

/** One trade: compact keys, because a day is several thousand of them. */
export interface TradeEvent {
  /** Milliseconds after the timeline start. */
  t: number;
  /** Planet index. */
  p: number;
  /** 1 = buy (money into the world), -1 = sell. */
  s: 1 | -1;
  usd: number;
  /** Star index of the trader, when the wallet is in the galaxy. */
  star: number | null;
  name: string;
  kind: StarKind;
  tx: string;
}

export interface Timeline {
  builtAt: string;
  start: number;
  end: number;
  events: TradeEvent[];
  /** Transfers between stars: index into galaxy.trails, with time offset. */
  transfers: { i: number; t: number }[];
  hours: { trades: number; buyUsd: number; sellUsd: number }[];
  sampled: string[];
  credits: number;
}

interface Row {
  block_timestamp: string; transaction_hash: string; trader_address: string; trader_address_label: string | null;
  action: 'BUY' | 'SELL'; estimated_value_usd: number | null;
}

const DIR = process.env.GALAXY_CACHE_DIR ?? (process.env.VERCEL ? '/tmp' : '.cache');
const FILE = path.join(DIR, 'timeline.json');
const TTL = 60 * 60_000;
const HOUR = 3_600_000;
const MIN_USD = 5;

async function build(): Promise<Timeline> {
  const galaxy = await getGalaxy();
  // Nansen's trade index runs a few hours behind; end the day at the newest
  // transfer the galaxy saw so the replay does not trail off into silence.
  const newest = Math.max(...galaxy.trails.map((t) => Date.parse(t.at)).filter(Number.isFinite), Date.now() - 3 * HOUR);
  const end = Math.ceil(Math.min(newest, Date.now()) / HOUR) * HOUR;
  const start = end - 24 * HOUR;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';
  let credits = 0;
  const sampled: string[] = [];

  const ask = async (token: string, from: number, to: number, perPage: number) => {
    const r = await nansen<{ data: Row[] }>('tgm/dex-trades', {
      chain: 'monad', token_address: token, only_smart_money: false,
      date: { from: iso(from), to: iso(to) },
      filters: { estimated_value_usd: { min: MIN_USD } },
      order_by: [{ field: 'estimated_value_usd', direction: 'DESC' }],
      pagination: { page: 1, per_page: perPage },
    });
    credits += r.credits;
    return r.body?.data ?? [];
  };

  const perPlanet = await pool(galaxy.planets, 4, async (p) => {
    const whole = await ask(p.address, start, end, 100);
    if (whole.length < 100) return whole;
    sampled.push(p.symbol);
    const slices = await Promise.all(Array.from({ length: 8 }, (_, k) => ask(p.address, start + k * 3 * HOUR, start + (k + 1) * 3 * HOUR, 60)));
    return slices.flat();
  });

  const starOf = new Map(galaxy.stars.map((s, i) => [s.address, i]));
  const seen = new Set<string>();
  const events: TradeEvent[] = [];
  perPlanet.forEach((rows, p) => {
    for (const r of rows) {
      const key = `${r.transaction_hash}:${p}:${r.trader_address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const at = Date.parse(r.block_timestamp.endsWith('Z') ? r.block_timestamp : `${r.block_timestamp}Z`);
      if (!(at >= start && at < end)) continue;
      const address = r.trader_address.toLowerCase();
      const star = starOf.get(address) ?? null;
      const usd = Math.round((r.estimated_value_usd ?? 0) * 100) / 100;
      const label = r.trader_address_label ?? '';
      events.push({
        t: at - start, p, s: r.action === 'BUY' ? 1 : -1, usd, star,
        name: star != null ? galaxy.stars[star].name : clean(label) || `${address.slice(0, 6)}…${address.slice(-4)}`,
        kind: star != null ? galaxy.stars[star].kind : kindOf(label ? [label] : [], usd, false),
        tx: r.transaction_hash,
      });
    }
  });
  events.sort((a, b) => a.t - b.t);

  const transfers = galaxy.trails
    .map((tr, i) => ({ i, t: Date.parse(tr.at) - start }))
    .filter((x) => x.t >= 0 && x.t < end - start)
    .sort((a, b) => a.t - b.t);

  const hours = Array.from({ length: 24 }, () => ({ trades: 0, buyUsd: 0, sellUsd: 0 }));
  for (const e of events) {
    const h = hours[Math.min(23, Math.floor(e.t / HOUR))];
    h.trades++;
    if (e.s > 0) h.buyUsd += e.usd; else h.sellUsd += e.usd;
  }

  return { builtAt: new Date().toISOString(), start, end, events, transfers, hours, sampled, credits };
}

export const getTimeline = () => cached('timeline', TTL, async () => {
  try {
    const t = JSON.parse(await readFile(FILE, 'utf8')) as Timeline;
    if (Date.now() - Date.parse(t.builtAt) < TTL) return t;
  } catch { /* not cached yet */ }
  const t = await build();
  try { await mkdir(DIR, { recursive: true }); await writeFile(FILE, JSON.stringify(t)); } catch { /* read-only fs */ }
  return t;
});
