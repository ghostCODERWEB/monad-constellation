'use client';

// The shuttle's flight planner: every Monad token world, in every universe
// (from /api/galaxy?u=, built from Nansen data), is a destination. Launching
// runs the hangar launch sequence and flies the shuttle to that world in /galaxy.
import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../engine';
import type { Galaxy, Planet } from '@/lib/galaxy';
import { worldStyle } from '@/lib/worldStyle';
import { UNIVERSES, type UniverseId } from '@/lib/universes';

type Dest = Planet & { universe: UniverseId };

const usd = (n: number | null) => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
const pct = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function ShuttlePanel({ engine }: { engine: Engine }) {
  const [planets, setPlanets] = useState<Dest[] | null>(null);
  const [uni, setUni] = useState<UniverseId | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [launching, setLaunching] = useState<Dest | { free: UniverseId } | null>(null);
  const [stage, setStage] = useState('Pre-launch checks');

  useEffect(() => {
    // Every universe, loaded side by side as each arrives (the server keeps them for three hours).
    let dead = false;
    const all: Dest[] = [];
    let failures = 0;
    Promise.all(UNIVERSES.map((u) => fetch(`/api/galaxy?u=${u.id}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'The Constellation is unreachable.');
      all.push(...(j as Galaxy).planets.map((p) => ({ ...p, universe: u.id })));
      if (!dead) setPlanets([...all]);
    }).catch((e) => { failures++; if (failures === UNIVERSES.length && !dead) setError(e.message); }))).catch(() => {});
    return () => { dead = true; };
  }, []);

  // The world the crew is researching is the suggested destination.
  const subject = engine.subject?.kind === 'token' ? engine.subject.address.toLowerCase() : null;
  const seen = (p: Dest) => engine.log.has(`seen-token-${p.address}`);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^\$/, '');
    return (planets ?? [])
      .filter((p) => uni === 'all' || p.universe === uni)
      .filter((p) => !s || p.symbol.toLowerCase().includes(s) || p.address.toLowerCase().includes(s))
      .sort((a, b) => Number(b.address.toLowerCase() === subject) - Number(a.address.toLowerCase() === subject) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  }, [planets, q, subject, uni]);
  const observed = (planets ?? []).filter(seen).length;

  // While the shuttle launches, follow its stage names.
  useEffect(() => {
    if (!launching) return;
    const hangar = (engine as unknown as { hangar?: { stage(): { label: string } } }).hangar;
    const id = setInterval(() => setStage(hangar?.stage().label ?? ''), 150);
    return () => clearInterval(id);
  }, [launching, engine]);

  const launch = (to: Dest | { free: UniverseId }) => {
    setLaunching(to);
    // The shuttle runs its launch sequence; when it has cleared the station, the flight continues in the galaxy.
    (engine as unknown as { hangar?: { ignite(done?: () => void): void } }).hangar?.ignite(() => {
      window.location.href = 'free' in to ? `/galaxy?universe=${to.free}` : `/galaxy?universe=${to.universe}&fly=${to.address}`;
    });
    engine.log.add(`flight-${'free' in to ? `free-${to.free}` : to.address}`, 'flight', 'free' in to ? `Free flight · ${UNIVERSES.find((u) => u.id === to.free)?.name}` : `Flight to $${to.symbol}`, 'The shuttle left the hangar for the Monad Constellation.');
  };

  return (
    <section className={`shuttle ${launching ? 'launching' : ''}`} aria-label="Shuttle flight planner">
      <header>
        <div><b>Shuttle</b><span>Flight planner · the Monad Constellation</span></div>
        <button className="agent-x" onClick={() => engine.setMode('walk')} aria-label="Close">✕</button>
      </header>
      {launching ? (
        <div className="shuttle-launch">
          <span>{'free' in launching ? `Free flight · ${UNIVERSES.find((u) => u.id === launching.free)?.name}` : `Destination $${launching.symbol} · ${UNIVERSES.find((u) => u.id === launching.universe)?.name}`}</span>
          <b>{stage}</b>
        </div>
      ) : (
        <>
          <div className="shuttle-top">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a token world…" autoFocus />
            <button onClick={() => launch({ free: uni === 'all' ? 'majors' : uni })}>Free flight</button>
          </div>
          <div className="shuttle-unis" role="group" aria-label="Universe">
            <button className={uni === 'all' ? 'on' : ''} onClick={() => setUni('all')}>All</button>
            {UNIVERSES.map((u) => <button key={u.id} className={uni === u.id ? 'on' : ''} style={{ ['--u' as string]: u.color }} onClick={() => setUni(u.id)}>{u.name}</button>)}
          </div>
          {error && <p className="agent-err">Token worlds unavailable: {error}</p>}
          {!planets && !error && <p className="agent-wait">Charting the Monad Constellation from Nansen…</p>}
          {planets && <p className="shuttle-count">{list.length} token worlds{uni === 'all' ? ` in ${new Set(planets.map((p) => p.universe)).size} universes` : ''} · {observed} observed through the telescope</p>}
          <ul>
            {list.map((p) => {
              const st = worldStyle(p);
              return (
                <li key={p.address} className={p.address.toLowerCase() === subject ? 'subject' : ''}>
                  {p.address.toLowerCase() === subject && <span className="shuttle-why">Researching now ({engine.subject?.source === 'telescope' ? 'from the telescope' : engine.subject?.source === 'flight' ? 'your last flight' : 'from the PC'})</span>}
                  <button onClick={() => launch(p)}>
                    <i style={{ background: `radial-gradient(circle at 35% 35%, ${st.palette.low}, ${st.palette.deep})`, boxShadow: `0 0 10px ${st.palette.rim}66` }} />
                    <span className="sym">${p.symbol}<em>{UNIVERSES.find((u) => u.id === p.universe)?.name} · {st.biomeName}{seen(p) ? ' · ✦ observed' : ''}</em></span>
                    <span className="num">{usd(p.marketCap)}<em>mcap</em></span>
                    <span className={`num ${(p.change24h ?? 0) >= 0 ? 'up' : 'down'}`}>{pct(p.change24h)}<em>24h</em></span>
                    <span className="go">Fly ➤</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <footer>Worlds and figures: Nansen (token screener, TGM). Flying is exploration only: no wallet, no trades.</footer>
        </>
      )}
    </section>
  );
}
