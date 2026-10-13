'use client';

// The shuttle's flight planner: every Monad token world in the Constellation
// (from /api/galaxy, built from Nansen data) is a destination. Launching
// ignites the hangar shuttle and flies it to that world in /galaxy.
import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../engine';
import type { Galaxy, Planet } from '@/lib/galaxy';
import { worldStyle } from '@/lib/worldStyle';

const usd = (n: number | null) => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`;
const pct = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function ShuttlePanel({ engine }: { engine: Engine }) {
  const [planets, setPlanets] = useState<Planet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [launching, setLaunching] = useState<Planet | 'free' | null>(null);
  const [stage, setStage] = useState('Pre-launch checks');

  useEffect(() => {
    fetch('/api/galaxy').then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'The Constellation is unreachable.');
      setPlanets((j as Galaxy).planets);
    }).catch((e) => setError(e.message));
  }, []);

  // The world the crew is researching is the suggested destination.
  const subject = engine.subject?.kind === 'token' ? engine.subject.address.toLowerCase() : null;
  const seen = (p: Planet) => engine.log.has(`seen-token-${p.address}`);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^\$/, '');
    return (planets ?? [])
      .filter((p) => !s || p.symbol.toLowerCase().includes(s) || p.address.toLowerCase().includes(s))
      .sort((a, b) => Number(b.address.toLowerCase() === subject) - Number(a.address.toLowerCase() === subject) || (b.marketCap ?? 0) - (a.marketCap ?? 0));
  }, [planets, q, subject]);
  const observed = (planets ?? []).filter(seen).length;

  // While the shuttle launches, follow its stage names.
  useEffect(() => {
    if (!launching) return;
    const hangar = (engine as unknown as { hangar?: { stage(): { label: string } } }).hangar;
    const id = setInterval(() => setStage(hangar?.stage().label ?? ''), 150);
    return () => clearInterval(id);
  }, [launching, engine]);

  const launch = (to: Planet | 'free') => {
    setLaunching(to);
    // The shuttle runs its launch sequence; when it has cleared the station, the flight continues in the galaxy.
    (engine as unknown as { hangar?: { ignite(done?: () => void): void } }).hangar?.ignite(() => {
      window.location.href = to === 'free' ? '/galaxy' : `/galaxy?fly=${to.address}`;
    });
    engine.log.add(`flight-${to === 'free' ? 'free' : to.address}`, 'flight', to === 'free' ? 'Free flight' : `Flight to $${to.symbol}`, 'The shuttle left the hangar for the Monad Constellation.');
  };

  return (
    <section className={`shuttle ${launching ? 'launching' : ''}`} aria-label="Shuttle flight planner">
      <header>
        <div><b>Shuttle</b><span>Flight planner · the Monad Constellation</span></div>
        <button className="agent-x" onClick={() => engine.setMode('walk')} aria-label="Close">✕</button>
      </header>
      {launching ? (
        <div className="shuttle-launch">
          <span>{launching === 'free' ? 'Free flight' : `Destination $${launching.symbol}`}</span>
          <b>{stage}</b>
        </div>
      ) : (
        <>
          <div className="shuttle-top">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a token world…" autoFocus />
            <button onClick={() => launch('free')}>Free flight</button>
          </div>
          {error && <p className="agent-err">Token worlds unavailable: {error}</p>}
          {!planets && !error && <p className="agent-wait">Charting the Monad Constellation from Nansen…</p>}
          {planets && <p className="shuttle-count">{planets.length} token worlds · {observed} observed through the telescope</p>}
          <ul>
            {list.map((p) => {
              const st = worldStyle(p);
              return (
                <li key={p.address} className={p.address.toLowerCase() === subject ? 'subject' : ''}>
                  {p.address.toLowerCase() === subject && <span className="shuttle-why">Researching now ({engine.subject?.source === 'telescope' ? 'from the telescope' : engine.subject?.source === 'flight' ? 'your last flight' : 'from the PC'})</span>}
                  <button onClick={() => launch(p)}>
                    <i style={{ background: `radial-gradient(circle at 35% 35%, ${st.palette.low}, ${st.palette.deep})`, boxShadow: `0 0 10px ${st.palette.rim}66` }} />
                    <span className="sym">${p.symbol}<em>{st.biomeName}{seen(p) ? ' · ✦ observed' : ''}</em></span>
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
