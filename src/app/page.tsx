'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Galaxy } from '@/lib/galaxy';
import type { TokenProfile, WalletProfile } from '@/lib/profile';
import type { ClusterReport } from '@/lib/clusters';
import { PlanetView, StarView } from '@/components/Dossier';
import { KIND, type FlightHud, type Focus, type GalaxyHandle, type Tie } from '@/components/GalaxyScene';

const GalaxyScene = dynamic(() => import('@/components/GalaxyScene'), { ssr: false });


export default function Page() {
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Focus>(null);
  const [selected, setSelected] = useState<Focus>(null);
  const [query, setQuery] = useState('');
  const [introDone, setIntroDone] = useState(false);
  const [flying, setFlying] = useState(false);
  const [hud, setHud] = useState<FlightHud | null>(null);
  const [report, setReport] = useState<ClusterReport | null>(null);
  const [radarOpen, setRadarOpen] = useState(true);
  const scene = useRef<GalaxyHandle>(null);
  // Deep dossiers, keyed by address. undefined = loading, null = failed.
  const [wallets, setWallets] = useState<Record<string, WalletProfile | null | undefined>>({});
  const [tokens, setTokens] = useState<Record<string, TokenProfile | null | undefined>>({});

  useEffect(() => {
    fetch('/api/galaxy').then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'The galaxy could not be built.');
      setGalaxy(j);
      setTimeout(() => setIntroDone(true), 3800);
      // Tracing first funders is slower than the galaxy, so it follows it.
      fetch('/api/clusters').then((r) => r.ok ? r.json() : null).then((c) => c && setReport(c)).catch(() => {});
    }).catch((e) => setError(e.message));
  }, []);

  // Selecting flies to it; closing a dossier leaves the camera where it is.
  const select = useCallback((f: Focus) => {
    setSelected(f);
    if (f) scene.current?.flyTo(f);
  }, []);
  const home = useCallback(() => { setSelected(null); scene.current?.flyTo(null); }, []);

  const toggleFlight = useCallback((on: boolean) => {
    setFlying(on);
    scene.current?.setFlying(on);
    if (on) setHover(null);
    else setHud(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') { if (selected) select(null); else if (flying) toggleFlight(false); }
      else if (e.code === 'KeyF' && galaxy && introDone) toggleFlight(!flying);
      else if (e.code === 'KeyR' && flying) scene.current?.scan();
      else if (e.code === 'KeyH' && !flying && galaxy) home();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, home, toggleFlight, flying, selected, galaxy, introDone]);

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

  const starIndex = useMemo(() => new Map((galaxy?.stars ?? []).map((s, i) => [s.address, i])), [galaxy]);
  const planetIndex = useMemo(() => new Map((galaxy?.planets ?? []).map((p, i) => [p.address, i])), [galaxy]);

  // Scan what the player selects (never what they merely hover: each scan costs credits).
  const selAddr = galaxy && selected ? (selected.type === 'star' ? galaxy.stars[selected.index].address : galaxy.planets[selected.index].address) : null;
  useEffect(() => {
    if (!selAddr || !selected) return;
    if (selected.type === 'star') {
      if (selAddr in wallets) return;
      setWallets((w) => ({ ...w, [selAddr]: undefined }));
      fetch(`/api/wallet/${selAddr}`).then((r) => r.ok ? r.json() : null).then((j) => setWallets((w) => ({ ...w, [selAddr]: j }))).catch(() => setWallets((w) => ({ ...w, [selAddr]: null })));
    } else {
      if (selAddr in tokens) return;
      setTokens((t) => ({ ...t, [selAddr]: undefined }));
      fetch(`/api/token/${selAddr}`).then((r) => r.ok ? r.json() : null).then((j) => setTokens((t) => ({ ...t, [selAddr]: j }))).catch(() => setTokens((t) => ({ ...t, [selAddr]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selAddr]);

  // Lines in the galaxy from the selected wallet to the wallets it deals with,
  // and to the rest of any insider cluster it belongs to.
  const ties = useMemo<Tie[]>(() => {
    if (selected?.type !== 'star' || !selAddr) return [];
    const out: Tie[] = [];
    for (const c of report?.clusters ?? []) {
      if (!c.members.includes(selected.index)) continue;
      for (const m of c.members) if (m !== selected.index) out.push({ star: m, kind: 'cluster', weight: 1 });
      if (c.funder?.star != null && c.funder.star !== selected.index) out.push({ star: c.funder.star, kind: 'cluster', weight: 1 });
    }
    const w = wallets[selAddr];
    if (!w) return out;
    const maxV = Math.max(1, ...w.counterparties.map((c) => c.volumeUsd));
    for (const r of w.related) { const i = starIndex.get(r.address); if (i != null) out.push({ star: i, kind: 'related', weight: 1 }); }
    for (const c of w.counterparties) { const i = starIndex.get(c.address); if (i != null && i !== selected.index) out.push({ star: i, kind: 'counterparty', weight: Math.sqrt(c.volumeUsd / maxV) }); }
    return out;
  }, [selected, selAddr, wallets, starIndex, report]);

  return (
    <main>
      {galaxy && <GalaxyScene ref={scene} galaxy={galaxy} focus={selected ?? hover} onHover={setHover} onSelect={select} onFlight={setHud} ties={ties} clusters={report?.clusters} />}

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
          {!flying && (
            <section className={`radar ${radarOpen ? '' : 'closed'}`} aria-label="Insider radar">
              <button className="radar-head" onClick={() => setRadarOpen((o) => !o)} aria-expanded={radarOpen}>
                <b>Insider radar</b>
                <span>{report ? `${report.clusters.length} clusters · ${report.checked} holders traced` : 'Tracing first funders…'}</span>
              </button>
              {radarOpen && report && (
                <ul>
                  {report.clusters.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => select({ type: 'planet', index: c.planet })}>
                        <i className={c.severity} />
                        <b>${galaxy.planets[c.planet].symbol}</b>
                        <span>{(c.share * 100).toFixed(1)}%</span>
                        <em>{c.kind === 'funded' ? `${c.members.length} wallets, one funder` : `${c.members.length} wallets trading in a ring`}{c.alsoIn.length ? ` · also in ${c.alsoIn.length} more` : ''}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

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
                ? <PlanetView p={galaxy.planets[shown.index]} galaxy={galaxy} token={tokens[galaxy.planets[shown.index].address]} clusters={report?.clusters ?? []} onStar={(i) => select({ type: 'star', index: i })} />
                : <StarView s={galaxy.stars[shown.index]} galaxy={galaxy} wallet={wallets[galaxy.stars[shown.index].address]}
                    deep={!!selected && selected.type === 'star' && selected.index === shown.index}
                    starIndex={starIndex} planetIndex={planetIndex} clusters={report?.clusters ?? []}
                    onPlanet={(i) => select({ type: 'planet', index: i })} onStar={(i) => select({ type: 'star', index: i })} />}
              {selected && <button className="close" onClick={() => select(null)} aria-label="Back to the galaxy">✕</button>}
            </aside>
          )}

          <ul className={`legend ${flying ? 'hidden' : ''}`}>
            {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
              <li key={k}><i style={{ background: KIND[k].color, boxShadow: `0 0 10px ${KIND[k].color}` }} />{KIND[k].name}<em>{(counts[k] ?? 0).toLocaleString()}</em></li>
            ))}
            <li className="hint">Brightness = proven profit, Nansen labels and size</li>
            <li className="hint"><kbd>H</kbd> back to the whole galaxy</li>
          </ul>

          {!flying && (
            <button className="flybtn" onClick={() => toggleFlight(true)}>
              <span>Fly the shuttle</span><kbd>F</kbd>
            </button>
          )}

          {flying && (
            <div className="cockpit" aria-live="polite">
              <div className="reticle"><i /><i /><i /><i /></div>
              {hud?.world && (
                <div className="expedition">
                  <span className="eyebrow">Expedition · {hud.world.zone}</span>
                  <b>{hud.world.name}</b>
                  <span className="biome">{hud.world.biome}</span>
                  <dl>
                    <dt>Altitude</dt><dd>{Math.round(hud.world.altitudeKm).toLocaleString()} km</dd>
                    <dt>Local time</dt><dd>{hud.world.local}</dd>
                    <dt>Oceans</dt><dd>≈ {hud.world.ocean}%</dd>
                    <dt>Settlements</dt><dd>{hud.world.settlements}</dd>
                  </dl>
                  <p>{hud.world.weather}</p>
                  <button className="survey-btn" onClick={() => select({ type: 'planet', index: hud.world!.planet })}>Survey with Nansen</button>
                </div>
              )}
              {hud?.target && (
                <div className="lock">
                  <span className="eyebrow">Target locked · {hud.target.kind}</span>
                  <b>{hud.target.name}</b>
                  <span>{hud.target.distance.toFixed(1)} u · press <kbd>R</kbd> to scan</span>
                </div>
              )}
              <div className="gauges">
                <div className={`speed ${hud?.boost ? 'boost' : ''}`}>
                  <b>{Math.round((hud?.speed ?? 0) * 10)}</b><span>{hud?.boost ? 'BOOST' : 'speed'}</span>
                  <i style={{ width: `${Math.min(100, ((hud?.speed ?? 0) / 75) * 100)}%` }} />
                </div>
                {hud?.nearest && <div className="near"><span className="eyebrow">Nearest planet</span><b>{hud.nearest.name}</b><span>{hud.nearest.distance.toFixed(1)} u</span></div>}
              </div>
              <ul className="keys">
                <li><kbd>W</kbd><kbd>S</kbd> thrust</li>
                <li><kbd>A</kbd><kbd>D</kbd> turn</li>
                <li><kbd>↑</kbd><kbd>↓</kbd> pitch</li>
                <li><kbd>←</kbd><kbd>→</kbd> roll</li>
                <li><kbd>Shift</kbd> boost</li>
                <li><kbd>Space</kbd> brake</li>
                <li>drag to steer</li>
                <li>fly low over a world for an expedition</li>
                <li><kbd>Esc</kbd> back to orbit view</li>
              </ul>
            </div>
          )}

          <footer className="sources">
            {galaxy.planets.length} planets · {galaxy.stars.length.toLocaleString()} stars · {galaxy.trails.length.toLocaleString()} transfers in flight ·
            {' '}{Object.keys(galaxy.endpoints).length} Nansen endpoints, {Object.values(galaxy.endpoints).reduce((a, b) => a + b, 0)} calls
          </footer>
        </>
      )}
    </main>
  );
}
