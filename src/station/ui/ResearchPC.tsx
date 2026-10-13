'use client';

// The research PC: a Nansen terminal for Monad. Every figure comes from this
// app's Nansen-backed APIs (/api/galaxy, /api/token, /api/wallet,
// /api/clusters, /api/reputation); the dossiers are the same ones the
// Constellation shows. Selecting something scans it (credits); browsing lists
// does not. Research only: no wallet, no trades.
import { useEffect, useMemo, useState } from 'react';
import type { Engine } from '../engine';
import type { Galaxy } from '@/lib/galaxy';
import type { ClusterReport } from '@/lib/clusters';
import type { ReputationSet } from '@/lib/repFlags';
import type { TokenProfile, WalletProfile } from '@/lib/profile';
import { PlanetView, RegistryPanel, ReputationCard, StarView, money, signed } from '@/components/Dossier';
import { KIND } from '@/components/GalaxyScene';
import { askAgent } from './AgentPanel';

type Tab = 'tokens' | 'wallets' | 'radar' | 'reputation';
type Sel = { type: 'planet' | 'star'; index: number } | null;

const pct = (n: number | null) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export function ResearchPC({ engine }: { engine: Engine }) {
  const [galaxy, setGalaxy] = useState<Galaxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ClusterReport | null>(null);
  const [repSet, setRepSet] = useState<ReputationSet | null>(null);
  const [tab, setTab] = useState<Tab>('tokens');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Sel>(null);
  const [tokens, setTokens] = useState<Record<string, TokenProfile | null | undefined>>({});
  const [wallets, setWallets] = useState<Record<string, WalletProfile | null | undefined>>({});

  useEffect(() => {
    fetch('/api/galaxy').then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? 'Galaxy data unavailable.');
      setGalaxy(j);
      // Open on whatever the crew is researching (a world just seen in the telescope, say).
      const subj = engine.subject;
      if (subj) {
        const g = j as Galaxy;
        const pi = g.planets.findIndex((p) => p.address.toLowerCase() === subj.address.toLowerCase());
        const si = pi < 0 ? g.stars.findIndex((w) => w.address.toLowerCase() === subj.address.toLowerCase()) : -1;
        if (pi >= 0) { setTab('tokens'); setSel({ type: 'planet', index: pi }); }
        else if (si >= 0) { setTab('wallets'); setSel({ type: 'star', index: si }); }
      }
    }).catch((e) => setError(e.message));
    fetch('/api/clusters').then((r) => r.ok ? r.json() : null).then(setReport).catch(() => {});
    fetch('/api/reputation').then((r) => r.ok ? r.json() : null).then(setRepSet).catch(() => {});
    // The station subject is read once, when the PC opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addr = galaxy && sel ? (sel.type === 'planet' ? galaxy.planets[sel.index].address : galaxy.stars[sel.index].address) : null;
  useEffect(() => {
    if (!addr || !sel) return;
    if (sel.type === 'planet') {
      if (addr in tokens) return;
      setTokens((t) => ({ ...t, [addr]: undefined }));
      fetch(`/api/token/${addr}`).then((r) => r.ok ? r.json() : null).then((j) => setTokens((t) => ({ ...t, [addr]: j }))).catch(() => setTokens((t) => ({ ...t, [addr]: null })));
    } else {
      if (addr in wallets) return;
      setWallets((w) => ({ ...w, [addr]: undefined }));
      fetch(`/api/wallet/${addr}`).then((r) => r.ok ? r.json() : null).then((j) => setWallets((w) => ({ ...w, [addr]: j }))).catch(() => setWallets((w) => ({ ...w, [addr]: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addr]);

  const starIndex = useMemo(() => new Map((galaxy?.stars ?? []).map((s, i) => [s.address, i])), [galaxy]);
  const planetIndex = useMemo(() => new Map((galaxy?.planets ?? []).map((p, i) => [p.address, i])), [galaxy]);
  const repOf = useMemo(() => new Map((repSet?.wallets ?? []).map((w, i) => [w.star, { w, rank: i + 1 }])), [repSet]);

  const s = q.trim().toLowerCase().replace(/^\$/, '');
  const tokenRows = useMemo(() => (galaxy?.planets ?? []).map((p, i) => ({ p, i }))
    .filter(({ p }) => !s || p.symbol.toLowerCase().includes(s) || p.address.toLowerCase().includes(s))
    .sort((a, b) => (b.p.marketCap ?? 0) - (a.p.marketCap ?? 0)), [galaxy, s]);
  const walletRows = useMemo(() => (galaxy?.stars ?? []).map((w, i) => ({ w, i }))
    .filter(({ w }) => !s || w.name.toLowerCase().includes(s) || w.address.toLowerCase().includes(s) || w.labels.some((l) => l.toLowerCase().includes(s)))
    .sort((a, b) => b.w.brightness - a.w.brightness).slice(0, 300), [galaxy, s]);

  const pick = (t: Sel) => {
    setSel(t);
    if (!galaxy || !t) return;
    if (t.type === 'planet') { const p = galaxy.planets[t.index]; engine.setSubject({ kind: 'token', address: p.address, label: `$${p.symbol}`, source: 'pc' }); }
    else { const w = galaxy.stars[t.index]; engine.setSubject({ kind: 'wallet', address: w.address, label: w.name, source: 'pc' }); }
  };
  const close = () => engine.setMode('walk');
  const ask = () => {
    if (!galaxy || !sel) return;
    const text = sel.type === 'planet'
      ? `Give me a research brief on the Monad token $${galaxy.planets[sel.index].symbol} (${galaxy.planets[sel.index].address}): smart money flows, top holders, and risks.`
      : `Profile the Monad wallet ${galaxy.stars[sel.index].address}: what it trades, how profitable it is, and who it is connected to.`;
    askAgent(engine, text);
  };

  return (
    <section className="pc" aria-label="Research PC">
      <header>
        <img src="/brand/nansen-mark.gif" alt="" />
        <div><b>NANSEN RESEARCH TERMINAL</b><span>Monad · data from Nansen{galaxy ? ` · built ${new Date(galaxy.builtAt).toUTCString().slice(17, 22)} UTC` : ''}</span></div>
        <nav>
          {(['tokens', 'wallets', 'radar', 'reputation'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setSel(null); }}>
              {t === 'tokens' ? 'Token worlds' : t === 'wallets' ? 'Wallets' : t === 'radar' ? 'Insider radar' : 'Reputation'}
            </button>
          ))}
        </nav>
        <button className="agent-x" onClick={close} aria-label="Close">✕</button>
      </header>

      <div className="pc-body">
        <div className="pc-list">
          {(tab === 'tokens' || tab === 'wallets') && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'tokens' ? 'Search tokens…' : 'Search wallets, labels…'} />}
          {error && <p className="agent-err">Nansen data unavailable: {error}</p>}
          {!galaxy && !error && <p className="agent-wait">Loading Monad data from Nansen…</p>}

          {galaxy && tab === 'tokens' && (
            <table>
              <thead><tr><th>Token</th><th>Mcap</th><th>24h</th><th>Netflow 24h</th><th>Smart $</th></tr></thead>
              <tbody>
                {tokenRows.map(({ p, i }) => (
                  <tr key={p.address} className={sel?.type === 'planet' && sel.index === i ? 'on' : ''} onClick={() => pick({ type: 'planet', index: i })}>
                    <td><b>${p.symbol}</b>{p.state !== 'stable' && <em className={p.state}>{p.state}</em>}</td>
                    <td>{money(p.marketCap)}</td>
                    <td className={(p.change24h ?? 0) >= 0 ? 'up' : 'down'}>{pct(p.change24h)}</td>
                    <td className={(p.netflow24h ?? 0) >= 0 ? 'up' : 'down'}>{signed(p.netflow24h)}</td>
                    <td>{p.smartValueUsd ? money(p.smartValueUsd) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {galaxy && tab === 'wallets' && (
            <table>
              <thead><tr><th>Wallet</th><th>Type</th><th>Holding</th><th>PnL</th></tr></thead>
              <tbody>
                {walletRows.map(({ w, i }) => (
                  <tr key={w.address} className={sel?.type === 'star' && sel.index === i ? 'on' : ''} onClick={() => pick({ type: 'star', index: i })}>
                    <td><b>{w.name}</b></td>
                    <td style={{ color: KIND[w.kind].color }}>{KIND[w.kind].name}</td>
                    <td>{money(w.holdingUsd)}</td>
                    <td className={w.pnlUsd >= 0 ? 'up' : 'down'}>{signed(w.pnlUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {galaxy && tab === 'radar' && (
            !report ? <p className="agent-wait">Tracing first funders of top holders (Nansen)…</p> : (
              <ul className="pc-radar">
                <li className="hint">{report.clusters.length} clusters · {report.checked} holders traced</li>
                {report.clusters.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => pick({ type: 'planet', index: c.planet })}>
                      <b>${galaxy.planets[c.planet].symbol}</b>
                      <span className={c.severity}>{c.severity}</span>
                      <em>{c.members.length} wallets · {(c.share * 100).toFixed(1)}% of supply · {c.kind === 'funded' ? `funded by ${c.funder?.name ?? 'one wallet'}` : 'trading ring'}</em>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {galaxy && tab === 'reputation' && (
            repSet ? <RegistryPanel set={repSet} galaxy={galaxy} onStar={(i) => pick({ type: 'star', index: i })} /> : <p className="agent-wait">Scoring wallets…</p>
          )}
        </div>

        <aside className="dossier pc-dossier">
          {!galaxy || !sel ? (
            <div className="pc-empty">
              <p>Select a token world or a wallet to open its Nansen dossier.</p>
              <p className="dim">Token dossiers: TGM (holders, flows, PnL leaderboard, indicators). Wallet dossiers: seven profiler endpoints. Each scan costs Nansen credits and is cached for an hour.</p>
            </div>
          ) : (
            <>
              <div className="pc-actions">
                <button onClick={ask}><img src="/brand/nansen-mark.gif" alt="" />Ask Nansen AI about this</button>
                {sel.type === 'planet' && <a href={`/galaxy?fly=${galaxy.planets[sel.index].address}`}>Fly there ➤</a>}
              </div>
              {sel.type === 'planet'
                ? <PlanetView p={galaxy.planets[sel.index]} galaxy={galaxy} token={tokens[galaxy.planets[sel.index].address]} clusters={report?.clusters ?? []} onStar={(i) => pick({ type: 'star', index: i })} />
                : <StarView s={galaxy.stars[sel.index]} galaxy={galaxy} wallet={wallets[galaxy.stars[sel.index].address]} deep
                    starIndex={starIndex} planetIndex={planetIndex} clusters={report?.clusters ?? []}
                    reputation={repOf.get(sel.index) ? <ReputationCard r={repOf.get(sel.index)!.w} rank={repOf.get(sel.index)!.rank} total={repSet!.wallets.length} chain={undefined} /> : null}
                    onPlanet={(i) => pick({ type: 'planet', index: i })} onStar={(i) => pick({ type: 'star', index: i })} />}
            </>
          )}
        </aside>
      </div>
      <footer>Sources: Nansen API (token screener, TGM, profiler, smart money) via this station’s server · research only, not financial advice · no wallet connection, no trading</footer>
    </section>
  );
}
