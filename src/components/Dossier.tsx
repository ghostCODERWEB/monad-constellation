'use client';

import { useMemo } from 'react';
import type { Galaxy, Planet, Star } from '@/lib/galaxy';
import type { TokenProfile, WalletProfile } from '@/lib/profile';
import type { Cluster } from '@/lib/clusters';
import { FLAG_NAMES, type Reputation, type ReputationSet } from '@/lib/repFlags';
import { KIND } from './GalaxyScene';
import { worldStyle } from '@/lib/worldStyle';
import { moonsOf } from '@/lib/moons';

export const money = (x: number | null | undefined) => {
  if (x == null) return '—';
  const a = Math.abs(x);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${a.toFixed(a < 10 ? 2 : 0)}`;
  return x < 0 ? `−${s}` : s;
};
export const signed = (x: number | null | undefined) => (x == null ? '—' : (x > 0 ? '+' : '') + money(x));
const pct = (x: number | null | undefined) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)) / 60000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const COHORT_NAME: Record<string, string> = {
  smart_trader: 'Smart traders', whale: 'Whales', top_pnl: 'Top PnL traders',
  public_figure: 'Public figures', exchange: 'Exchanges', fresh_wallets: 'Fresh wallets',
};

/** A small area chart: a line with a soft gradient under it. */
function Spark({ values, color, height = 56 }: { values: number[]; color: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 320, h = height;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `g${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Trend from ${money(values[0])} to ${money(values[values.length - 1])}`}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.45" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Win rate as a ring. */
function Ring({ value, label }: { value: number; label: string }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg viewBox="0 0 56 56" aria-hidden>
        <circle cx="28" cy="28" r={r} className="track" />
        <circle cx="28" cy="28" r={r} className="fill" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 28 28)" />
      </svg>
      <b>{Math.round(value * 100)}%</b>
      <span>{label}</span>
    </div>
  );
}

export function PlanetView({ p, galaxy, token, clusters, onStar }: { p: Planet; galaxy: Galaxy; token: TokenProfile | null | undefined; clusters: Cluster[]; onStar: (i: number) => void }) {
  const pi = galaxy.planets.indexOf(p);
  const orbiting = useMemo(() => galaxy.stars
    .map((s, i) => ({ s, i, l: s.links.find((l) => l.p === pi) }))
    .filter((x) => x.l)
    .sort((a, b) => (b.l!.pnlUsd ?? -Infinity) - (a.l!.pnlUsd ?? -Infinity))
    .slice(0, 6), [galaxy, pi]);
  const topIndex = p.topPnl ? galaxy.stars.findIndex((s) => s.address === p.topPnl!.address) : -1;
  const max = Math.max(1, ...p.cohorts.map((c) => Math.abs(c.netFlowUsd)));
  const world = useMemo(() => worldStyle(p), [p]);
  const moons = useMemo(() => moonsOf(galaxy, pi), [galaxy, pi]);
  const closes = token?.candles.map((c) => c.close) ?? [];
  const change30 = closes.length > 1 ? (closes[closes.length - 1] / closes[0] - 1) * 100 : null;
  const d = token?.details as Record<string, string | number | null> | null | undefined;
  return (
    <>
      <span className="eyebrow">Planet · Monad token</span>
      <div className="title-row">
        {token?.logo && <img src={token.logo} alt="" width={36} height={36} />}
        <div><h2>${p.symbol}</h2>{token?.name && <span className="sub">{token.name}</span>}</div>
      </div>
      <div className="tags">
        {p.capGroup && <span className="tag">Nansen {p.capGroup}</span>}
        {p.smartHolders > 0 && <span className="tag gold">{p.smartHolders} smart money holder{p.smartHolders > 1 ? 's' : ''} · {money(p.smartValueUsd)}</span>}
        {p.state === 'falling' && <span className="tag red">down {Math.round(-(p.change7d ?? 0))}% this week</span>}
        {p.state === 'flagged' && <span className="tag red">flagged by Nansen</span>}
      </div>

      {clusters.filter((c) => c.planet === pi).map((c) => <ClusterCard key={c.id} c={c} galaxy={galaxy} onStar={onStar} />)}

      <h4>World survey <small>every feature is a number</small></h4>
      <ul className="survey">
        <li><b>{world.biomeName}</b><span>{world.why}</span></li>
        <li><b>Oceans ≈ {world.oceanPct}%</b><span>Liquidity is water: {world.oceanWhy}.</span></li>
        <li><b>Weather</b><span>{world.weather}</span></li>
        <li><b>{world.settlements} settlements</b><span>Night-side lights: {p.holders} holders and {p.traders24h} of today&apos;s traders.</span></li>
        {p.smartHolders > 0 && <li><b>Golden rings</b><span>{p.smartHolders} smart money holder{p.smartHolders > 1 ? 's' : ''}.</span></li>}
      </ul>
      {moons.length > 0 && (
        <>
          <h4>Moons: the biggest holders <small>tgm/holders</small></h4>
          <ul className="people">
            {moons.map((m) => {
              const s = galaxy.stars[m.star];
              return (
                <li key={m.star}><button onClick={() => onStar(m.star)}>
                  <i style={{ background: KIND[s.kind].color }} /><span>{s.name}</span>
                  <b>{(m.share * 100).toFixed(2)}%</b>
                </button></li>
              );
            })}
          </ul>
        </>
      )}

      <h4>Price, 30 days <small>tgm/token-ohlcv</small></h4>
      {token === undefined ? <p className="note">Asking Nansen…</p> : closes.length > 1 ? (
        <div className="chart">
          <Spark values={closes} color={(change30 ?? 0) >= 0 ? '#4ade80' : '#f87171'} height={70} />
          <div className="chart-foot"><span>{pct(change30)} over 30d</span><span>last ${closes[closes.length - 1].toPrecision(4)}</span></div>
        </div>
      ) : <p className="note">No candles from Nansen for this token.</p>}

      <dl>
        <dt>Market cap</dt><dd>{money(p.marketCap)}</dd>
        <dt>Liquidity</dt><dd>{money(p.liquidity)}</dd>
        <dt>24h volume</dt><dd>{money(p.volume24h)}</dd>
        <dt>24h netflow</dt><dd className={(p.netflow24h ?? 0) >= 0 ? 'up' : 'down'}>{signed(p.netflow24h)}</dd>
        <dt>Price 24h · 7d</dt><dd>{pct(p.change24h)} · {pct(p.change7d)}</dd>
        <dt>Orbiting wallets</dt><dd>{p.holders} holders · {p.traders24h} traders today</dd>
        {d?.token_deployment_date && <><dt>Deployed</dt><dd>{String(d.token_deployment_date).slice(0, 10)}</dd></>}
        {d?.circulating_supply != null && <><dt>Circulating</dt><dd>{Number(d.circulating_supply).toLocaleString('en-US', { maximumFractionDigits: 0 })}</dd></>}
      </dl>
      {(d?.website || d?.x || d?.telegram) && (
        <div className="socials">
          {d?.website && <a href={String(d.website)} target="_blank" rel="noreferrer">Website ↗</a>}
          {d?.x && <a href={String(d.x)} target="_blank" rel="noreferrer">X ↗</a>}
          {d?.telegram && <a href={String(d.telegram)} target="_blank" rel="noreferrer">Telegram ↗</a>}
        </div>
      )}

      {p.cohorts.length > 0 && (
        <>
          <h4>Who moved money, 24h <small>tgm/flow-intelligence</small></h4>
          <ul className="cohorts">
            {p.cohorts.map((c) => (
              <li key={c.key}>
                <span>{COHORT_NAME[c.key]}{c.wallets ? ` · ${c.wallets}` : ''}</span>
                <span className="bar"><i className={c.netFlowUsd >= 0 ? 'in' : 'out'} style={{ width: `${(Math.abs(c.netFlowUsd) / max) * 100}%` }} /></span>
                <b className={c.netFlowUsd > 0 ? 'up' : c.netFlowUsd < 0 ? 'down' : ''}>{c.netFlowUsd ? signed(c.netFlowUsd) : '0'}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      {(p.risk.length > 0 || p.reward.length > 0) && (
        <>
          <h4>Nansen indicators <small>tgm/indicators</small></h4>
          <div className="tags">
            {p.risk.map((r) => <span key={r.type} className={`tag ${r.score === 'high' ? 'red' : ''}`}>risk · {r.type.replace(/-/g, ' ')}: {r.score}</span>)}
            {p.reward.map((r) => <span key={r.type} className={`tag ${r.score === 'high' ? 'green' : ''}`}>reward · {r.type.replace(/-/g, ' ')}: {r.score}</span>)}
          </div>
        </>
      )}
      <h4>Brightest traders here <small>tgm/pnl-leaderboard, 30d</small></h4>
      <ul className="people">
        {orbiting.map(({ s, i, l }) => (
          <li key={s.address}><button onClick={() => onStar(i)}>
            <i style={{ background: KIND[s.kind].color }} /><span>{s.name}</span>
            <b className={(l!.pnlUsd ?? 0) >= 0 ? 'up' : 'down'}>{l!.pnlUsd != null ? signed(l!.pnlUsd) : money(l!.holdingUsd)}</b>
          </button></li>
        ))}
      </ul>
      {topIndex >= 0 && <button className="link" onClick={() => onStar(topIndex)}>Fly to the top trader ({signed(p.topPnl!.pnlUsd)}) →</button>}
    </>
  );
}

export function StarView({ s, galaxy, wallet, deep, starIndex, planetIndex, clusters, reputation, onPlanet, onStar }: {
  s: Star; galaxy: Galaxy; wallet: WalletProfile | null | undefined; deep: boolean;
  starIndex: Map<string, number>; planetIndex: Map<string, number>; clusters: Cluster[]; reputation?: React.ReactNode;
  onPlanet: (i: number) => void; onStar: (i: number) => void;
}) {
  const links = [...s.links].sort((a, b) => (b.holdingUsd + Math.abs(b.pnlUsd ?? 0)) - (a.holdingUsd + Math.abs(a.pnlUsd ?? 0)));
  const maxCp = Math.max(1, ...(wallet?.counterparties ?? []).map((c) => c.volumeUsd));
  return (
    <>
      <span className="eyebrow" style={{ color: KIND[s.kind].color }}>Star · {KIND[s.kind].name}</span>
      <h2 className="wallet">{s.name}</h2>
      <a className="addr" href={`https://app.nansen.ai/profiler?address=${s.address}&chain=monad`} target="_blank" rel="noreferrer">{short(s.address)} · open in Nansen ↗</a>
      {s.labels.length > 0 && <div className="tags">{[...new Set(s.labels)].slice(0, 6).map((l) => <span key={l} className="tag">{l}</span>)}</div>}

      {reputation}
      {clusters.filter((c) => c.members.includes(galaxy.stars.indexOf(s))).map((c) => <ClusterCard key={c.id} c={c} galaxy={galaxy} onStar={onStar} self={galaxy.stars.indexOf(s)} />)}

      {deep && wallet === undefined && <p className="note scanning">Scanning with seven Nansen profiler endpoints…</p>}

      {wallet?.summary && (
        <div className="stats">
          {wallet.summary.winRate != null && <Ring value={wallet.summary.winRate} label="win rate" />}
          <div><b className={(wallet.summary.realisedUsd ?? 0) >= 0 ? 'up' : 'down'}>{signed(wallet.summary.realisedUsd)}</b><span>realised, 30d</span></div>
          <div><b>{wallet.summary.trades ?? '—'}</b><span>trades · {wallet.summary.tokens ?? '—'} tokens</span></div>
        </div>
      )}

      {wallet && (
        <>
          <h4>Portfolio <small>current-balance · historical-balances</small></h4>
          <div className="chart">
            <div className="chart-head"><b>{money(wallet.totalUsd)}</b><span>on Monad now</span></div>
            <Spark values={wallet.history.map((h) => h.usd)} color="#a78bfa" />
          </div>
          <ul className="holdings">
            {wallet.balances.slice(0, 6).map((b) => {
              const pi = planetIndex.get(b.address.toLowerCase());
              return (
                <li key={b.address}>
                  {pi != null ? <button onClick={() => onPlanet(pi)}>{b.symbol} ✦</button> : <span>{b.symbol}</span>}
                  <em>{b.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</em>
                  <b>{money(b.usd)}</b>
                </li>
              );
            })}
          </ul>

          {wallet.summary && wallet.summary.top.length > 0 && (
            <>
              <h4>Best trades, 30d <small>pnl-summary</small></h4>
              <ul className="holdings">
                {wallet.summary.top.map((t) => {
                  const pi = planetIndex.get(t.address);
                  return (
                    <li key={t.address}>
                      {pi != null ? <button onClick={() => onPlanet(pi)}>{t.symbol} ✦</button> : <span>{t.symbol}</span>}
                      <em>{t.roi != null ? `${(t.roi * 100).toFixed(1)}% ROI` : ''}</em>
                      <b className={t.realisedUsd >= 0 ? 'up' : 'down'}>{signed(t.realisedUsd)}</b>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {wallet.related.length > 0 && (
            <>
              <h4>Related wallets <small>related-wallets</small></h4>
              <ul className="people">
                {wallet.related.slice(0, 6).map((r) => {
                  const si = starIndex.get(r.address);
                  return (
                    <li key={r.address + r.relation}><button onClick={() => si != null && onStar(si)} disabled={si == null}>
                      <i style={{ background: '#22d3ee' }} /><span>{r.name}{si != null && ' ✦'}</span>
                      <em>{r.relation}{r.at ? ` · ${ago(r.at)}` : ''}</em>
                    </button></li>
                  );
                })}
              </ul>
            </>
          )}

          {wallet.counterparties.length > 0 && (
            <>
              <h4>Who they deal with, 30d <small>counterparties</small></h4>
              <ul className="cps">
                {wallet.counterparties.slice(0, 8).map((c) => {
                  const si = starIndex.get(c.address);
                  return (
                    <li key={c.address}>
                      <button onClick={() => si != null && onStar(si)} disabled={si == null}>
                        <span>{c.name}{si != null && ' ✦'}</span>
                        <b>{money(c.volumeUsd)}</b>
                      </button>
                      <span className="bar"><i className="in" style={{ width: `${(c.inUsd / maxCp) * 100}%` }} /><i className="out" style={{ width: `${(c.outUsd / maxCp) * 100}%` }} /></span>
                    </li>
                  );
                })}
              </ul>
              <p className="note">✦ in this galaxy: gold lines show them. Green is money in, red is money out.</p>
            </>
          )}

          {wallet.transactions.length > 0 && (
            <>
              <h4>Recent activity <small>transactions</small></h4>
              <ul className="txs">
                {wallet.transactions.slice(0, 6).map((t) => (
                  <li key={t.hash}>
                    <a href={`https://monadscan.com/tx/${t.hash}`} target="_blank" rel="noreferrer">
                      <b>{t.method}</b>
                      <span>{t.sent}{t.received ? ` → ${t.received}` : ''}</span>
                      <em>{t.usd ? money(t.usd) : ''} · {ago(t.at)}</em>
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="note">{wallet.endpoints.length} Nansen profiler endpoints · {wallet.credits} credits · cached 1h</p>
        </>
      )}

      {!deep && (
        <>
          <dl>
            <dt>PnL in view</dt><dd className={s.pnlUsd >= 0 ? 'up' : 'down'}>{s.pnlUsd ? signed(s.pnlUsd) : '—'}</dd>
            <dt>Holdings in view</dt><dd>{money(s.holdingUsd)}</dd>
            <dt>Traded today</dt><dd>{money(s.volume24hUsd)}</dd>
          </dl>
          <p className="note">Click to scan this wallet with Nansen.</p>
        </>
      )}

      <h4>Orbits <small>holders · pnl-leaderboard · who-bought-sold</small></h4>
      <ul className="people">
        {links.map((l) => {
          const p = galaxy.planets[l.p];
          return (
            <li key={l.p}><button onClick={() => onPlanet(l.p)}>
              <i style={{ background: p.smartHolders ? '#f5c542' : '#8b7cf6' }} /><span>${p.symbol}</span>
              <em>
                {l.share > 0 && `${(l.share * 100).toFixed(2)}% of supply · `}
                {l.holdingUsd > 0 && `${money(l.holdingUsd)} · `}
                {l.trades != null && `${l.trades} trades · `}
                {l.boughtUsd + l.soldUsd > 0 && `24h ${money(l.boughtUsd)} in / ${money(l.soldUsd)} out`}
              </em>
              {l.pnlUsd != null && <b className={l.pnlUsd >= 0 ? 'up' : 'down'}>{signed(l.pnlUsd)}{l.roi != null && <small> {Math.round(l.roi * 100)}%</small>}</b>}
            </button></li>
          );
        })}
      </ul>
    </>
  );
}

/** An insider cluster: who, how much of the supply, and the evidence. */
function ClusterCard({ c, galaxy, onStar, self }: { c: Cluster; galaxy: Galaxy; onStar: (i: number) => void; self?: number }) {
  const sym = galaxy.planets[c.planet].symbol;
  return (
    <div className={`cluster ${c.severity}`}>
      <span className="eyebrow">⚠ Insider cluster · {c.kind === 'funded' ? 'funded together' : 'transfer ring'}</span>
      <b>{(c.share * 100).toFixed(1)}% of ${sym} <small>· {money(c.holdingUsd)}</small></b>
      <p>{c.evidence}</p>
      {c.funder && (
        <button className="funder" onClick={() => c.funder!.star != null && onStar(c.funder!.star)} disabled={c.funder.star == null}>
          Funder: {c.funder.name}{c.funder.star != null ? ' ✦' : ''}
        </button>
      )}
      <ul className="people">
        {c.members.map((m) => {
          const st = galaxy.stars[m];
          const share = st.links.find((l) => l.p === c.planet)?.share ?? 0;
          return (
            <li key={m}><button onClick={() => onStar(m)} disabled={m === self}>
              <i style={{ background: KIND[st.kind].color }} /><span>{st.name}{m === self ? ' (this wallet)' : ''}</span>
              <b>{(share * 100).toFixed(2)}%</b>
            </button></li>
          );
        })}
      </ul>
      <p className="note">Source: first funders from Nansen profiler/address/related-wallets; transfers from tgm/transfers. A shared funder is a signal, not proof.</p>
    </div>
  );
}

export interface OnChain { deployed: boolean; registry?: string; collateral?: string | null; score?: number; flags?: number; updatedAt?: number; epoch?: number; collateralBps?: number | null; error?: string }

const PART_LABEL: [keyof Reputation['parts'], string, string][] = [
  ['profit', 'Proven profit', 'tgm/pnl-leaderboard'],
  ['labels', 'Nansen labels', 'holders · trades'],
  ['breadth', 'Breadth', 'tokens touched'],
  ['size', 'Size', 'holdings + volume'],
  ['insider', 'Insider penalty', 'clusters'],
];
const TIER_COLOR: Record<string, string> = { Proven: '#f5c542', Trusted: '#4ade80', Known: '#a78bfa', Unproven: '#6b7280', 'Insider-linked': '#ef4444' };

/** A wallet's reputation: the score, where every point came from, and what Monad holds. */
export function ReputationCard({ r, chain, rank, total }: { r: Reputation; chain: OnChain | null | undefined; rank: number; total: number }) {
  const c = TIER_COLOR[r.tier];
  const R = 30, C = 2 * Math.PI * R;
  const flags = FLAG_NAMES.filter(([bit]) => r.flags & bit).map(([, n]) => n);
  return (
    <div className="rep" style={{ borderColor: `${c}66` }}>
      <div className="rep-head">
        <div className="dial" aria-label={`Reputation ${r.score} of 1000`}>
          <svg viewBox="0 0 72 72" aria-hidden>
            <circle cx="36" cy="36" r={R} className="track" />
            <circle cx="36" cy="36" r={R} fill="none" stroke={c} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(C * r.score) / 1000} ${C}`} transform="rotate(-90 36 36)" style={{ filter: `drop-shadow(0 0 5px ${c})` }} />
          </svg>
          <b>{r.score}</b>
        </div>
        <div>
          <span className="eyebrow">Monad reputation · nansen-rep-v1</span>
          <b className="tier" style={{ color: c }}>{r.tier}</b>
          <span className="sub">#{rank.toLocaleString()} of {total.toLocaleString()} wallets</span>
        </div>
      </div>
      <ul className="parts">
        {PART_LABEL.map(([k, name, src]) => {
          const v = r.parts[k];
          if (k === 'insider' && v === 0) return null;
          return (
            <li key={k}>
              <span>{name} <small>{src}</small></span>
              <span className="bar"><i className={v < 0 ? 'out' : 'in'} style={{ width: `${Math.min(100, Math.abs(v) / 4)}%` }} /></span>
              <b className={v < 0 ? 'down' : ''}>{v > 0 ? '+' : ''}{v}</b>
            </li>
          );
        })}
      </ul>
      {flags.length > 0 && <div className="tags">{flags.map((f) => <span key={f} className={`tag ${f.startsWith('Insider') || f.startsWith('Cluster') ? 'red' : ''}`}>{f}</span>)}</div>}
      <div className="chain">
        {chain === undefined ? <span>Reading Monad…</span>
          : !chain || !chain.deployed ? <span>Not published on Monad yet. Deploy the registry and run <code>publish.mjs</code>.</span>
          : chain.error ? <span>Registry unreachable: {chain.error}</span>
          : chain.updatedAt ? <span>On Monad: <b>{chain.score}</b> (epoch {chain.epoch}, {new Date(chain.updatedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC){chain.collateralBps ? <> · a ReputationCollateral loan needs <b>{chain.collateralBps / 100}%</b> collateral</> : null}</span>
          : <span>Registry live; this wallet is not in the published epoch.</span>}
      </div>
    </div>
  );
}

/** The registry: what it is, who leads, and how another contract uses it. */
export function RegistryPanel({ set, galaxy, onStar }: { set: ReputationSet; galaxy: Galaxy; onStar: (i: number) => void }) {
  const registry = process.env.NEXT_PUBLIC_REPUTATION_ADDRESS;
  return (
    <>
      <span className="eyebrow">On-chain infrastructure</span>
      <h2>Reputation registry</h2>
      <p className="lede-sm">Every wallet in this galaxy scored 0–1000 from Nansen data, published to <b>MonadReputation</b> so any Monad contract can ask whether a wallet has a track record, and refuse insiders.</p>
      <div className="stats reg-stats">
        <div><b>{set.stats.scored.toLocaleString()}</b><span>wallets scored</span></div>
        <div><b style={{ color: '#f5c542' }}>{set.stats.proven + set.stats.trusted}</b><span>proven or trusted</span></div>
        <div><b className="down">{set.stats.insiders}</b><span>insider-linked</span></div>
      </div>
      <h4>Highest reputations</h4>
      <ul className="people">
        {set.wallets.slice(0, 12).map((w) => {
          const s = galaxy.stars[w.star];
          return (
            <li key={w.address}><button onClick={() => onStar(w.star)}>
              <i style={{ background: TIER_COLOR[w.tier] }} /><span>{s.name}</span>
              <em>{w.tier} · {s.links.length} token{s.links.length > 1 ? 's' : ''}</em>
              <b>{w.score}</b>
            </button></li>
          );
        })}
      </ul>
      <h4>Use it from a contract</h4>
      <pre className="code">{`interface IMonadReputation {
  function isTrusted(address wallet, uint16 minScore)
    external view returns (bool);
}

// e.g. a launch allowlist that refuses insider clusters
require(rep.isTrusted(msg.sender, 300), "no track record");`}</pre>
      <dl>
        <dt>Contract</dt><dd>{registry ? <a href={`https://monadscan.com/address/${registry}`} target="_blank" rel="noreferrer">{short(registry)} ↗</a> : 'not deployed yet'}</dd>
        <dt>Methodology</dt><dd>{set.methodology}</dd>
        <dt>Dataset hash</dt><dd title={set.datasetHash}>{short(set.datasetHash)}</dd>
        <dt>Demo consumer</dt><dd>ReputationCollateral: 110–150%, insiders 200%</dd>
      </dl>
      <p className="note">Scores are a reading of public data, not a verdict. The dataset hash lets anyone check a published epoch against this file.</p>
    </>
  );
}
