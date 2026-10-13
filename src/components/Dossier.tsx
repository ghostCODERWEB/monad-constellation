'use client';

import { useMemo } from 'react';
import type { Galaxy, Planet, Star } from '@/lib/galaxy';
import type { TokenProfile, WalletProfile } from '@/lib/profile';
import { KIND } from './GalaxyScene';

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

export function PlanetView({ p, galaxy, token, onStar }: { p: Planet; galaxy: Galaxy; token: TokenProfile | null | undefined; onStar: (i: number) => void }) {
  const pi = galaxy.planets.indexOf(p);
  const orbiting = useMemo(() => galaxy.stars
    .map((s, i) => ({ s, i, l: s.links.find((l) => l.p === pi) }))
    .filter((x) => x.l)
    .sort((a, b) => (b.l!.pnlUsd ?? -Infinity) - (a.l!.pnlUsd ?? -Infinity))
    .slice(0, 6), [galaxy, pi]);
  const topIndex = p.topPnl ? galaxy.stars.findIndex((s) => s.address === p.topPnl!.address) : -1;
  const max = Math.max(1, ...p.cohorts.map((c) => Math.abs(c.netFlowUsd)));
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

export function StarView({ s, galaxy, wallet, deep, starIndex, planetIndex, onPlanet, onStar }: {
  s: Star; galaxy: Galaxy; wallet: WalletProfile | null | undefined; deep: boolean;
  starIndex: Map<string, number>; planetIndex: Map<string, number>;
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
