'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Galaxy, Planet, Star } from '@/lib/galaxy';
import { KIND, type Focus, type GalaxyHandle } from '@/components/GalaxyScene';

const GalaxyScene = dynamic(() => import('@/components/GalaxyScene'), { ssr: false });

const money = (x: number | null | undefined) => {
  if (x == null) return '—';
  const a = Math.abs(x);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}k` : `$${a.toFixed(a < 10 ? 2 : 0)}`;
  return x < 0 ? `−${s}` : s;
};
const signed = (x: number | null | undefined) => (x == null ? '—' : (x > 0 ? '+' : '') + money(x));
const pct = (x: number | null | undefined) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}%`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const COHORT_NAME: Record<string, string> = {
  smart_trader: 'Smart traders', whale: 'Whales', top_pnl: 'Top PnL traders',
  public_figure: 'Public figures', exchange: 'Exchanges', fresh_wallets: 'Fresh wallets',
};

export default function Page() {
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Focus>(null);
  const [selected, setSelected] = useState<Focus>(null);
  const [query, setQuery] = useState('');
  const [introDone, setIntroDone] = useState(false);
  const scene = useRef<GalaxyHandle>(null);

  useEffect(() => {
    fetch('/api/galaxy').then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'The galaxy could not be built.');
      setGalaxy(j);
      setTimeout(() => setIntroDone(true), 3800);
    }).catch((e) => setError(e.message));
  }, []);

  const select = useCallback((f: Focus) => {
    setSelected(f);
    scene.current?.flyTo(f);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') select(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  const results = useMemo(() => {
    if (!galaxy || query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    const planets = galaxy.planets.map((p, i) => ({ f: { type: 'planet', index: i } as Focus, label: `$${p.symbol}`, sub: 'token', hay: `${p.symbol} ${p.address}` }));
    const stars = galaxy.stars.map((s, i) => ({ f: { type: 'star', index: i } as Focus, label: s.name, sub: KIND[s.kind].name, hay: `${s.name} ${s.address} ${s.labels.join(' ')}` }));
    return [...planets, ...stars].filter((x) => x.hay.toLowerCase().includes(q)).slice(0, 8);
  }, [galaxy, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of galaxy?.stars ?? []) c[s.kind] = (c[s.kind] ?? 0) + 1;
    return c;
  }, [galaxy]);

  const shown = selected ?? hover;

  return (
    <main>
      {galaxy && <GalaxyScene ref={scene} galaxy={galaxy} focus={selected ?? hover} onHover={setHover} onSelect={select} />}

      <header className={`title ${introDone ? 'small' : ''}`}>
        <h1>MONAD<span>CONSTELLATION</span></h1>
        {!introDone && <p>Every wallet a star. Every token a planet. Built from Nansen.</p>}
      </header>

      {!galaxy && (
        <div className="loading">
          {error ? <p className="err">{error}</p> : <p>Charting Monad from Nansen…</p>}
        </div>
      )}

      {galaxy && introDone && (
        <>
          <div className="search">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a token, wallet, ENS or label…" aria-label="Search the galaxy" />
            {results.length > 0 && (
              <ul>
                {results.map((r, i) => (
                  <li key={i}><button onClick={() => { select(r.f); setQuery(''); }}><b>{r.label}</b><span>{r.sub}</span></button></li>
                ))}
              </ul>
            )}
          </div>

          {shown && (
            <aside className="dossier" key={`${shown.type}${shown.index}`}>
              {shown.type === 'planet'
                ? <PlanetView p={galaxy.planets[shown.index]} galaxy={galaxy} onStar={(i) => select({ type: 'star', index: i })} />
                : <StarView s={galaxy.stars[shown.index]} galaxy={galaxy} onPlanet={(i) => select({ type: 'planet', index: i })} />}
              {selected && <button className="close" onClick={() => select(null)} aria-label="Back to the galaxy">✕</button>}
            </aside>
          )}

          <ul className="legend">
            {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
              <li key={k}><i style={{ background: KIND[k].color, boxShadow: `0 0 10px ${KIND[k].color}` }} />{KIND[k].name}<em>{(counts[k] ?? 0).toLocaleString()}</em></li>
            ))}
            <li className="hint">Brightness = proven profit, Nansen labels and size</li>
          </ul>

          <footer className="sources">
            {galaxy.planets.length} planets · {galaxy.stars.length.toLocaleString()} stars · {galaxy.trails.length.toLocaleString()} transfers in flight ·
            {' '}{Object.keys(galaxy.endpoints).length} Nansen endpoints, {Object.values(galaxy.endpoints).reduce((a, b) => a + b, 0)} calls
          </footer>
        </>
      )}
    </main>
  );
}

function PlanetView({ p, galaxy, onStar }: { p: Planet; galaxy: Galaxy; onStar: (i: number) => void }) {
  const pi = galaxy.planets.indexOf(p);
  const orbiting = useMemo(() => galaxy.stars
    .map((s, i) => ({ s, i, l: s.links.find((l) => l.p === pi) }))
    .filter((x) => x.l)
    .sort((a, b) => (b.l!.pnlUsd ?? -Infinity) - (a.l!.pnlUsd ?? -Infinity))
    .slice(0, 6), [galaxy, pi]);
  const topIndex = p.topPnl ? galaxy.stars.findIndex((s) => s.address === p.topPnl!.address) : -1;
  const max = Math.max(1, ...p.cohorts.map((c) => Math.abs(c.netFlowUsd)));
  return (
    <>
      <span className="eyebrow">Planet · Monad token</span>
      <h2>${p.symbol}</h2>
      <div className="tags">
        {p.capGroup && <span className="tag">Nansen {p.capGroup}</span>}
        {p.smartHolders > 0 && <span className="tag gold">{p.smartHolders} smart money holder{p.smartHolders > 1 ? 's' : ''} · {money(p.smartValueUsd)}</span>}
        {p.state === 'falling' && <span className="tag red">down {Math.round(-(p.change7d ?? 0))}% this week</span>}
        {p.state === 'flagged' && <span className="tag red">flagged by Nansen</span>}
      </div>
      <dl>
        <dt>Market cap</dt><dd>{money(p.marketCap)}</dd>
        <dt>Liquidity</dt><dd>{money(p.liquidity)}</dd>
        <dt>24h volume</dt><dd>{money(p.volume24h)}</dd>
        <dt>24h netflow</dt><dd className={(p.netflow24h ?? 0) >= 0 ? 'up' : 'down'}>{signed(p.netflow24h)}</dd>
        <dt>Price 24h · 7d</dt><dd>{pct(p.change24h)} · {pct(p.change7d)}</dd>
        <dt>Orbiting wallets</dt><dd>{p.holders} holders · {p.traders24h} traders today</dd>
      </dl>
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

function StarView({ s, galaxy, onPlanet }: { s: Star; galaxy: Galaxy; onPlanet: (i: number) => void }) {
  const links = [...s.links].sort((a, b) => (b.holdingUsd + Math.abs(b.pnlUsd ?? 0)) - (a.holdingUsd + Math.abs(a.pnlUsd ?? 0)));
  const sent = galaxy.trails.filter((t) => galaxy.stars[t.from] === s).length;
  const received = galaxy.trails.filter((t) => galaxy.stars[t.to] === s).length;
  return (
    <>
      <span className="eyebrow" style={{ color: KIND[s.kind].color }}>Star · {KIND[s.kind].name}</span>
      <h2 className="wallet">{s.name}</h2>
      <a className="addr" href={`https://app.nansen.ai/profiler?address=${s.address}&chain=monad`} target="_blank" rel="noreferrer">{short(s.address)} · open in Nansen ↗</a>
      {s.labels.length > 0 && <div className="tags">{[...new Set(s.labels)].slice(0, 6).map((l) => <span key={l} className="tag">{l}</span>)}</div>}
      <div className="meter"><span>Brightness</span><span className="bar"><i style={{ width: `${s.brightness * 100}%`, background: KIND[s.kind].color }} /></span><b>{Math.round(s.brightness * 100)}</b></div>
      <dl>
        <dt>Realised + open PnL</dt><dd className={s.pnlUsd >= 0 ? 'up' : 'down'}>{s.pnlUsd ? signed(s.pnlUsd) : '—'}</dd>
        <dt>Holdings in view</dt><dd>{money(s.holdingUsd)}</dd>
        <dt>Traded today</dt><dd>{money(s.volume24hUsd)}</dd>
        <dt>Transfers in view</dt><dd>{sent} sent · {received} received</dd>
      </dl>
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
