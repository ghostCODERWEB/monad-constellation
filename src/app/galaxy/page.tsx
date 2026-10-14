'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Galaxy } from '@/lib/galaxy';
import type { TokenProfile, WalletProfile } from '@/lib/profile';
import type { ClusterReport } from '@/lib/clusters';
import type { Timeline, TradeEvent } from '@/lib/timeline';
import { money } from '@/components/Dossier';
import { PlanetView, RegistryPanel, ReputationCard, StarView, type OnChain } from '@/components/Dossier';
import type { ReputationSet } from '@/lib/repFlags';
import { UNIVERSES, universeDef, type UniverseId } from '@/lib/universes';
import { KIND, type FlightHud, type Focus, type GalaxyHandle, type ReplayState, type Tie } from '@/components/GalaxyScene';

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
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [rep, setRep] = useState<ReplayState>({ t: 0, playing: false });
  const [speed, setSpeed] = useState(360_000);
  const [feed, setFeed] = useState<(TradeEvent & { id: number; n: number })[]>([]);
  const [block, setBlock] = useState<number | null>(null);
  const feedId = useRef(0);
  const [repSet, setRepSet] = useState<ReputationSet | null>(null);
  const [registryOpen, setRegistryOpen] = useState(false);
  const [chain, setChain] = useState<Record<string, OnChain | null | undefined>>({});
  const scene = useRef<GalaxyHandle>(null);
  // Deep dossiers, keyed by address. undefined = loading, null = failed.
  const [wallets, setWallets] = useState<Record<string, WalletProfile | null | undefined>>({});
  const [tokens, setTokens] = useState<Record<string, TokenProfile | null | undefined>>({});

  // Which universe: ?universe=, else the one a ?fly=<token> belongs to, else Majors. Counts come from /api/universes.
  const [universe, setUniverse] = useState<UniverseId | null>(null);
  const [tokenCounts, setTokenCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const asked = q.get('universe'), fly = q.get('fly')?.toLowerCase();
    setFlying(q.get('flight') === '1');
    const valid = (x: string | null | undefined): x is UniverseId => !!x && UNIVERSES.some((u) => u.id === x);
    fetch('/api/universes').then((r) => r.ok ? r.json() : null).then((idx: { universes: { id: UniverseId; tokens: { address: string }[] }[] } | null) => {
      if (idx) setTokenCounts(Object.fromEntries(idx.universes.map((u) => [u.id, u.tokens.length])));
      const home = valid(asked) ? asked : fly ? idx?.universes.find((u) => u.tokens.some((t) => t.address === fly))?.id : undefined;
      setUniverse(home ?? 'majors');
    }).catch(() => setUniverse(valid(asked) ? asked : 'majors'));
  }, []);

  // Each universe is its own galaxy, built from its tokens.
  useEffect(() => {
    if (!universe) return;
    let dead = false;
    setGalaxy(null); setError(null); setSelected(null); setHover(null); setReport(null); setTimeline(null); setRepSet(null); setWallets({}); setTokens({});
    fetch(`/api/galaxy?u=${universe}`).then(async (r) => {
      const j = await r.json();
      if (dead) return;
      if (!r.ok) throw new Error(j.message ?? 'The galaxy could not be built.');
      setGalaxy(j);
      if (new URLSearchParams(window.location.search).get('flight') === '1') setIntroDone(true);
      else setTimeout(() => !dead && setIntroDone(true), 3800);
      // Tracing first funders is slower than the galaxy, so it follows it.
      fetch(`/api/clusters?u=${universe}`).then((r) => r.ok ? r.json() : null).then((c) => !dead && c && setReport(c)).catch(() => {});
      fetch(`/api/timeline?u=${universe}`).then((r) => r.ok ? r.json() : null).then((t) => !dead && t && setTimeline(t)).catch(() => {});
      fetch(`/api/reputation?u=${universe}`).then((r) => r.ok ? r.json() : null).then((x) => !dead && x && setRepSet(x)).catch(() => {});
    }).catch((e) => !dead && setError(e.message));
    return () => { dead = true; };
  }, [universe]);
  const switchUniverse = useCallback((u: UniverseId) => {
    if (u === universe) return;
    setHud(null);
    window.history.replaceState(null, '', `/galaxy?universe=${u}${flying ? '&flight=1' : ''}`);
    setUniverse(u);
  }, [universe, flying]);

  // Selecting flies to it; closing a dossier leaves the camera where it is.
  const select = useCallback((f: Focus) => {
    setSelected(f);
    if (f) setRegistryOpen(false);
    if (f) scene.current?.flyTo(f);
  }, []);
  const home = useCallback(() => { setSelected(null); scene.current?.flyTo(null); }, []);

  const toggleFlight = useCallback((on: boolean) => {
    setFlying(on);
    scene.current?.setFlying(on);
    if (on) setHover(null);
    else setHud(null);
  }, []);

  // Arriving from the station's shuttle: ?fly=<token address> heads straight there.
  const arrived = useRef(false);
  useEffect(() => {
    if (!galaxy || !introDone || arrived.current) return;
    arrived.current = true;
    const want = new URLSearchParams(window.location.search).get('fly')?.toLowerCase();
    if (!want) return;
    if (new URLSearchParams(window.location.search).get('flight') === '1') return;
    const index = galaxy.planets.findIndex((p) => p.address.toLowerCase() === want);
    if (index >= 0) select({ type: 'planet', index });
    else setNotFound(want);
  }, [galaxy, introDone, select]);
  const [notFound, setNotFound] = useState<string | null>(null);
  // Flying home reports the last world you were at, so the station can log the trip.
  const lastWorld = galaxy && selected?.type === 'planet' ? galaxy.planets[selected.index] : null;
  // While flying, remember the last world you were over, so docking can log the trip.
  const lastFlown = useRef<{ address: string; symbol: string } | null>(null);
  if (hud?.world && galaxy) { const p = galaxy.planets[hud.world.planet]; lastFlown.current = { address: p.address, symbol: p.symbol }; }
  const homeHref = flying && lastFlown.current ? `/?from=${lastFlown.current.address}&sym=${encodeURIComponent(lastFlown.current.symbol)}` : lastWorld ? `/?from=${lastWorld.address}&sym=${encodeURIComponent(lastWorld.symbol)}` : '/';

  // The heartbeat: poll the chain head; the scene interpolates between polls.
  useEffect(() => {
    let dead = false;
    const tick = () => fetch('/api/block').then((r) => r.ok ? r.json() : null).then((j) => {
      if (dead || !j?.block) return;
      setBlock(j.block);
      scene.current?.block(j.block, j.at);
    }).catch(() => {});
    tick();
    const id = setInterval(tick, 3000);
    return () => { dead = true; clearInterval(id); };
  }, [galaxy]);

  const play = useCallback((on: boolean) => {
    if (!timeline) return;
    // Pressing play at the end starts the day over.
    if (on && rep.t >= timeline.end - timeline.start - 1) scene.current?.replay({ seek: 0 });
    scene.current?.replay({ playing: on });
  }, [timeline, rep.t]);
  const onTrade = useCallback((e: TradeEvent) => {
    // A wallet hammering one token reads as one line, not six.
    setFeed((f) => {
      const top = f[0];
      if (top && top.name === e.name && top.p === e.p && top.s === e.s) return [{ ...top, usd: top.usd + e.usd, n: top.n + 1, t: e.t }, ...f.slice(1)];
      return [{ ...e, id: feedId.current++, n: 1 }, ...f].slice(0, 6);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') { if (selected) select(null); else if (flying) toggleFlight(false); }
      else if (e.code === 'KeyR' && flying) scene.current?.scan();
      else if (e.code === 'KeyB' && flying && hud?.station.dockable) window.location.assign(homeHref);
      else if (e.code === 'KeyH' && !flying && galaxy) home();
      else if (e.code === 'KeyP' && timeline) play(!rep.playing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, home, toggleFlight, flying, selected, galaxy, introDone, timeline, play, rep.playing, hud?.station.dockable, homeHref]);

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

  const repOf = useMemo(() => new Map((repSet?.wallets ?? []).map((w, i) => [w.star, { w, rank: i + 1 }])), [repSet]);
  // What Monad itself holds for the selected wallet.
  useEffect(() => {
    if (selected?.type !== 'star' || !selAddr || selAddr in chain) return;
    setChain((c) => ({ ...c, [selAddr]: undefined }));
    fetch(`/api/onchain/${selAddr}`).then((r) => r.json()).then((j) => setChain((c) => ({ ...c, [selAddr]: j }))).catch(() => setChain((c) => ({ ...c, [selAddr]: null })));
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
      {galaxy && <GalaxyScene key={galaxy.universe} ref={scene} galaxy={galaxy} focus={selected ?? hover} flying={flying} onHover={setHover} onSelect={select} onFlight={setHud} onUniverseJump={switchUniverse} ties={ties}
        timeline={timeline} onReplay={setRep} onTrade={onTrade} />}

      <a className="to-station" href={homeHref} title="Dock back at the orbital station">← Station</a>
      {notFound && (
        <p className="fly-miss" role="status" onClick={() => setNotFound(null)}>
          That token ({notFound.slice(0, 6)}…{notFound.slice(-4)}) isn’t one of today’s Constellation worlds, so the shuttle has nowhere to land. Showing the galaxy instead.
        </p>
      )}
      <header className={`title ${introDone ? 'small' : ''}`}>
        <h1>MONAD<span>CONSTELLATION</span></h1>
        {!introDone && <p>Every wallet a star. Every token a planet. Built from Nansen.</p>}
      </header>

      <nav className="universes" aria-label="Universes">
        {UNIVERSES.map((u) => (
          <button key={u.id} className={universe === u.id ? 'on' : ''} style={{ ['--u' as string]: u.color }} onClick={() => switchUniverse(u.id)} title={u.blurb}>
            <i /><b>{u.name}</b><em>{tokenCounts[u.id] ?? ''}</em>
          </button>
        ))}
        {universe && <p>{universeDef(universe)?.blurb} <span>Category assigned by this app from each token’s Nansen name; data from Nansen.</span></p>}
      </nav>

      {!galaxy && (
        <div className="loading">
          {error ? <p className="err">{error}</p> : <p>Charting the {universe ? universeDef(universe)?.name : 'Monad'} universe from Nansen…<br /><small>A universe’s first build takes about a minute; after that it is kept for three hours.</small></p>}
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

          {registryOpen && repSet && !flying && (
            <aside className="dossier">
              <RegistryPanel set={repSet} galaxy={galaxy} onStar={(i) => select({ type: 'star', index: i })} />
              <button className="close" onClick={() => setRegistryOpen(false)} aria-label="Close the registry">✕</button>
            </aside>
          )}
          {shown && !registryOpen && (
            <aside className="dossier" key={`${shown.type}${shown.index}`}>
              {shown.type === 'planet'
                ? <PlanetView p={galaxy.planets[shown.index]} galaxy={galaxy} token={tokens[galaxy.planets[shown.index].address]} clusters={report?.clusters ?? []} onStar={(i) => select({ type: 'star', index: i })} />
                : <StarView s={galaxy.stars[shown.index]} galaxy={galaxy} wallet={wallets[galaxy.stars[shown.index].address]}
                    deep={!!selected && selected.type === 'star' && selected.index === shown.index}
                    starIndex={starIndex} planetIndex={planetIndex} clusters={report?.clusters ?? []}
                    reputation={repOf.get(shown.index) ? <ReputationCard r={repOf.get(shown.index)!.w} rank={repOf.get(shown.index)!.rank} total={repSet!.wallets.length}
                      chain={selected?.type === 'star' && selected.index === shown.index ? chain[galaxy.stars[shown.index].address] : null} /> : null}
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

          {!flying && repSet && !shown && !registryOpen && (
            <button className="regbtn" onClick={() => { setRegistryOpen((o) => !o); setSelected(null); }} aria-pressed={registryOpen}>
              ⛓ Reputation registry <span>{repSet.stats.scored.toLocaleString()} wallets</span>
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
                <div className={`near station ${hud?.station.dockable ? 'dock' : ''}`}>
                  <span className="eyebrow">Orbital station</span>
                  <b>{hud ? Math.round(hud.station.distance).toLocaleString() : '—'} u</b>
                  {hud?.station.dockable
                    ? <a className="dock-btn" href={homeHref}>Return to the station <kbd>B</kbd></a>
                    : <span>fly closer to dock</span>}
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
                <li>fly through a jump ring to enter another universe</li>
                <li><kbd>Esc</kbd> back to orbit view</li>
              </ul>
            </div>
          )}

          {timeline && !flying && (
            <TimelineBar tl={timeline} rep={rep} speed={speed} block={block}
              onPlay={play}
              onSeek={(t) => scene.current?.replay({ seek: t })}
              onSpeed={(v) => { setSpeed(v); scene.current?.replay({ speed: v }); }} />
          )}
          {timeline && rep.playing && !shown && feed.length > 0 && (
            <ol className="feed" aria-live="polite">
              {feed.map((f) => (
                <li key={f.id}>
                  <i style={{ background: KIND[f.kind].color }} />
                  <span className="who">{f.name}</span>
                  <span className={f.s > 0 ? 'up' : 'down'}>{f.s > 0 ? 'bought' : 'sold'} {money(f.usd)}{f.n > 1 ? ` ×${f.n}` : ''}</span>
                  <b>${galaxy.planets[f.p].symbol}</b>
                  <em>{new Date(timeline.start + f.t).toISOString().slice(11, 16)}</em>
                </li>
              ))}
            </ol>
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

const SPEEDS: [string, number][] = [['1h / 5s', 720_000], ['1h / 10s', 360_000], ['1h / 30s', 120_000], ['1h / min', 60_000]];

function TimelineBar({ tl, rep, speed, block, onPlay, onSeek, onSpeed }: {
  tl: Timeline; rep: ReplayState; speed: number; block: number | null;
  onPlay: (on: boolean) => void; onSeek: (t: number) => void; onSpeed: (v: number) => void;
}) {
  const span = tl.end - tl.start;
  const max = Math.max(1, ...tl.hours.map((h) => h.buyUsd + h.sellUsd));
  const now = new Date(tl.start + rep.t);
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - r.left) / r.width) * span);
  };
  return (
    <section className="timeline" aria-label="24-hour replay">
      <button className="playbtn" onClick={() => onPlay(!rep.playing)} aria-label={rep.playing ? 'Pause replay' : 'Play the last 24 hours'}>
        {rep.playing ? '❚❚' : '▶'}
      </button>
      <div className="tl-main">
        <div className="tl-head">
          <b>{rep.t > 0 || rep.playing ? now.toISOString().slice(5, 16).replace('T', ' · ') + ' UTC' : 'Replay the last 24 hours'}</b>
          <span>{tl.events.length.toLocaleString()} trades · {tl.transfers.length} transfers · Nansen tgm/dex-trades</span>
        </div>
        <div className="bars" onClick={seekAt} role="slider" aria-label="Replay position" aria-valuemin={0} aria-valuemax={24} aria-valuenow={Math.round(rep.t / 3_600_000)}>
          {tl.hours.map((h, i) => (
            <span key={i} title={`${new Date(tl.start + i * 3_600_000).toISOString().slice(11, 16)} UTC · ${h.trades} trades · ${money(h.buyUsd)} in / ${money(h.sellUsd)} out`}>
              <i className="buy" style={{ height: `${(h.buyUsd / max) * 100}%` }} />
              <i className="sell" style={{ height: `${(h.sellUsd / max) * 100}%` }} />
            </span>
          ))}
          <em className="playhead" style={{ left: `${(rep.t / span) * 100}%` }} />
        </div>
      </div>
      <select value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="Replay speed">
        {SPEEDS.map(([l, v]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div className="heartbeat" title="Live: the latest Monad block, one pulse ring per block">
        <i />
        <span>Monad live</span>
        <b>{block ? `#${block.toLocaleString()}` : '…'}</b>
      </div>
    </section>
  );
}
