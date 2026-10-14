'use client';

// Token Checker: search any Monad token (results appear as you type), then read one report:
// Token Score, a six-line safety checklist, price candles, buyers against sellers, holders,
// insider clusters, flows and Nansen's risk indicators. Peregrine's Token Checker on Monad.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Desk } from '@/lib/desk';
import type { TokenCheck } from '@/lib/check';
import { Card, Chip, Spark, nansenToken, nansenWallet, pct, price, tone, usd } from './shared';

type Found = { address: string; symbol: string; name: string; marketCap: number | null; universe: string | null };

const BAND_COLOR = { clear: '#4ade80', cloudy: '#facc15', watch: '#fb923c', warning: '#f87171' } as const;
const VERDICT: Record<string, { text: string; color: string }> = {
  low: { text: 'Low risk', color: '#4ade80' }, moderate: { text: 'Moderate risk', color: '#facc15' }, high: { text: 'High risk', color: '#fb923c' },
  critical: { text: 'Critical risk', color: '#f87171' }, stablecoin: { text: 'Stablecoin', color: '#34d399' }, unknown: { text: 'Not enough data', color: '#9ca3af' },
};
const SUB_LABEL: Record<string, string> = { concentration: 'Concentration', insider: 'Insider clusters', windShear: 'Wind shear', exitLiquidity: 'Exit liquidity', sellPressure: 'Sell pressure', nansenRisk: 'Nansen risk indicators' };
const SUB_WHY: Record<string, string> = {
  concentration: 'How few wallets hold the supply (HHI, Gini, top 10, Nakamoto).',
  insider: 'Top holders first funded by the same wallet.',
  windShear: 'Fresh wallets buying while smart money sells.',
  exitLiquidity: 'DEX liquidity against market cap and against the biggest cluster.',
  sellPressure: 'Biggest sellers against biggest buyers over 7 days.',
  nansenRisk: 'Nansen’s own liquidity, supply, exchange-flow indicators.',
};
const FLOW_LABEL: Record<string, string> = { smart_trader: 'Smart traders', whale: 'Whales', top_pnl: 'Top PnL', public_figure: 'Public figures', exchange: 'Exchanges', fresh_wallets: 'Fresh wallets' };

function Candles({ c }: { c: TokenCheck['candles'] }) {
  if (c.length < 2) return <p className="dk-empty">Nansen returned no price history.</p>;
  const W = 640, H = 230, vh = 44, ph = H - vh - 14;
  const hi = Math.max(...c.map((x) => x.high)), lo = Math.min(...c.map((x) => x.low)), span = hi - lo || hi || 1;
  const maxV = Math.max(...c.map((x) => x.volumeUsd), 1);
  const bw = (W - 40) / c.length;
  const Y = (v: number) => 8 + (1 - (v - lo) / span) * (ph - 8);
  const ma = (n: number) => c.map((_, i) => (i + 1 < n ? null : c.slice(i + 1 - n, i + 1).reduce((s, x) => s + x.close, 0) / n));
  const line = (vals: (number | null)[]) => vals.map((v, i) => (v == null ? null : `${20 + i * bw + bw / 2},${Y(v)}`)).filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="dk-candles" role="img" aria-label="Price candles with 20 and 50 day averages">
      {c.map((x, i) => {
        const up = x.close >= x.open, col = up ? '#4ade80' : '#f87171', cx = 20 + i * bw + bw / 2;
        return (
          <g key={x.t}>
            <line x1={cx} x2={cx} y1={Y(x.high)} y2={Y(x.low)} stroke={col} strokeWidth="1" />
            <rect x={cx - bw * 0.35} y={Math.min(Y(x.open), Y(x.close))} width={bw * 0.7} height={Math.max(1, Math.abs(Y(x.open) - Y(x.close)))} fill={col} />
            <rect x={cx - bw * 0.35} y={H - 14 - (x.volumeUsd / maxV) * vh} width={bw * 0.7} height={(x.volumeUsd / maxV) * vh} fill="rgba(131,110,249,0.5)" />
          </g>
        );
      })}
      <polyline points={line(ma(20))} fill="none" stroke="#22d3ee" strokeWidth="1.3" />
      <polyline points={line(ma(50))} fill="none" stroke="#f5c542" strokeWidth="1.3" />
      <text x="24" y="14" className="ax">{price(hi)}</text><text x="24" y={ph} className="ax">{price(lo)}</text>
      <text x={W - 24} y="14" textAnchor="end" className="ax"><tspan fill="#22d3ee">MA20</tspan> <tspan fill="#f5c542">MA50</tspan></text>
      <text x="20" y={H - 2} className="ax">{c[0].t.slice(5, 10)}</text><text x={W - 20} y={H - 2} textAnchor="end" className="ax">{c.at(-1)!.t.slice(5, 10)}</text>
    </svg>
  );
}

function Ring({ score, band }: { score: number; band: keyof typeof BAND_COLOR }) {
  const r = 46, C = 2 * Math.PI * r;
  return (
    <svg width="116" height="116" viewBox="0 0 116 116" aria-label={`Token Score ${Math.round(score)}`}>
      <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="9" />
      <circle cx="58" cy="58" r={r} fill="none" stroke={BAND_COLOR[band]} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(Math.min(100, score) / 100) * C} ${C}`} transform="rotate(-90 58 58)" />
      <text x="58" y="62" textAnchor="middle" className="ring">{Math.round(score)}</text>
      <text x="58" y="80" textAnchor="middle" className="ax">of 100</text>
    </svg>
  );
}

export function Checker({ desk, address, setAddress, dossier }: { desk: Desk; address: string | null; setAddress: (a: string | null) => void; dossier: (address: string, universe: string | null) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [report, setReport] = useState<TokenCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  // Results appear 350 ms after you stop typing: no Check button.
  useEffect(() => {
    const text = q.trim();
    if (!text) { setFound(null); return; }
    if (/^0x[0-9a-fA-F]{40}$/.test(text)) { setAddress(text.toLowerCase()); return; }
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(text)}`).then((r) => r.json()).then((j) => setFound(j.results ?? [])).catch(() => setFound([]));
    }, 350);
    return () => clearTimeout(id);
  }, [q, setAddress]);

  useEffect(() => {
    if (!address) { setReport(null); return; }
    const mine = ++seq.current;
    setLoading(true); setError(null); setReport(null);
    fetch(`/api/check/${address}`).then(async (r) => {
      const j = await r.json();
      if (mine !== seq.current) return;
      if (!r.ok) throw new Error(j.message ?? 'Nansen could not check this token.');
      setReport(j);
    }).catch((e) => mine === seq.current && setError(e.message)).finally(() => mine === seq.current && setLoading(false));
  }, [address]);

  const picks = useMemo(() => [...desk.tokens].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 14), [desk]);
  const r = report;
  const v = r ? VERDICT[r.verdict] : null;
  return (
    <div className="dk-page">
      <div className="dk-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a Monad token by name, symbol or contract address…" autoFocus />
        {found && (
          <ul className="dk-found">{found.length ? found.map((f) => (
            <li key={f.address} onClick={() => { setAddress(f.address); setQ(''); setFound(null); }}><Chip symbol={f.symbol} universe={f.universe} /><b>${f.symbol}</b><em>{f.name}</em><span>{usd(f.marketCap)}</span></li>
          )) : <li className="none">No Monad token matches “{q}”. Paste its contract address to check it anyway.</li>}</ul>
        )}
      </div>
      {!address && (
        <Card title="Most traded on Monad" sub="24h volume · click to check" wide>
          <ul className="dk-picks">{picks.map((t) => <li key={t.address} onClick={() => setAddress(t.address)}><Chip symbol={t.symbol} universe={t.universe} /><b>${t.symbol}</b><em>{usd(t.volume24h)}</em></li>)}</ul>
        </Card>
      )}
      {loading && <p className="dk-empty">Checking {address?.slice(0, 8)}… (holders, flows, traders, price history, first funders: about 18 Nansen credits, kept for 30 minutes)</p>}
      {error && <p className="dk-empty">{error}</p>}
      {r && v && (
        <>
          <div className="dk-token">
            <Chip symbol={r.symbol} universe={r.universe} logo={r.logo} size={46} />
            <div><h2>{r.name} <small>${r.symbol}</small></h2><span>{r.universeName ? `${r.universeName} universe` : 'Monad token'} · {price(r.priceUsd)} · mcap {usd(r.marketCap)} · liquidity {usd(r.liquidityUsd)} · {r.holdersTotal?.toLocaleString() ?? 'n/a'} holders · {r.ageDays != null ? `${r.ageDays} days old` : 'age n/a'}</span></div>
            <div className="dk-links">
              <a href={nansenToken(r.address)} target="_blank" rel="noreferrer">Open in Nansen ↗</a>
              <button onClick={() => dossier(r.address, r.universe)}>Open its world dossier</button>
              <button onClick={() => setAddress(null)}>New check</button>
            </div>
          </div>
          <div className="dk-grid two">
            <Card title="Token Score" sub="dump risk, 0 clear to 100 warning">
              <div className="dk-score">
                <Ring score={r.score.score} band={r.score.band} />
                <div><b style={{ color: v.color }}>{v.text}</b>
                  <p>Nansen half {r.score.nansen != null ? Math.round(r.score.nansen) : 'n/a'} · on-chain model half {r.score.model != null ? Math.round(r.score.model) : 'n/a'} · confidence {Math.round(r.score.confidence * 100)}%</p>
                  <p className="dim">Half Nansen’s risk indicators, half a weighted model of the five on-chain readings, scaled by market-cap tier. The weights are expert priors, not fitted to history.</p></div>
              </div>
              <ul className="dk-subs">{(Object.keys(SUB_LABEL) as (keyof typeof SUB_LABEL)[]).map((k) => {
                const val = r.score.subScores[k as keyof TokenCheck['score']['subScores']];
                return <li key={k} title={SUB_WHY[k]}><span>{SUB_LABEL[k]}</span><i><u style={{ width: `${val ?? 0}%`, background: val == null ? 'transparent' : val >= 70 ? '#f87171' : val >= 45 ? '#facc15' : '#4ade80' }} /></i><em>{val == null ? 'n/a' : Math.round(val)}</em></li>;
              })}</ul>
            </Card>
            <Card title="Safety checklist" sub={`${r.fails} failed · each check is one number against stated thresholds`}>
              <ul className="dk-checks">{r.checks.map((c) => (
                <li key={c.id} className={c.status} title={c.detail}><i /><b>{c.title}</b><span>{c.value}</span></li>
              ))}</ul>
              <p className="dk-note">Hover a row for its threshold. A failed check is never hidden behind a calm score: one fail means at least Moderate, two at least High.</p>
            </Card>
          </div>
          <div className="dk-grid two">
            <Card title="Price, 60 days" sub="candles with MA20 / MA50 and volume · tgm/token-ohlcv"><Candles c={r.candles} /></Card>
            <Card title="Buyers against sellers" sub={r.spot ? `24h · ${r.spot.buys} buys, ${r.spot.sells} sells` : 'last 7 days, top 20 each'}>
              {r.spot && (
                <div className="dk-bs"><i><u style={{ width: `${(r.spot.buyUsd / Math.max(1, r.spot.buyUsd + r.spot.sellUsd)) * 100}%` }} /></i>
                  <p><b className="up">{usd(r.spot.buyUsd)} bought</b> · {r.spot.uniqueBuyers} buyers <span>·</span> <b className="down">{usd(r.spot.sellUsd)} sold</b> · {r.spot.uniqueSellers} sellers</p></div>
              )}
              <div className="dk-two">
                <ul className="dk-list">{r.top.buyers.slice(0, 5).map((t) => <li key={t.address} onClick={() => window.open(nansenWallet(t.address), '_blank')}><b>{t.name}</b><span className="up">{usd(t.boughtUsd)}</span></li>)}</ul>
                <ul className="dk-list">{r.top.sellers.slice(0, 5).map((t) => <li key={t.address} onClick={() => window.open(nansenWallet(t.address), '_blank')}><b>{t.name}</b><span className="down">{usd(t.soldUsd)}</span></li>)}</ul>
              </div>
              <p className="dk-note">Top buyers and sellers over 7 days (tgm/who-bought-sold); 24h totals from tgm/token-information.</p>
            </Card>
          </div>
          <div className="dk-grid two">
            <Card title="Holders" sub={`${r.holders.counted} wallet holders counted · top 10 hold ${(r.holders.top10 * 100).toFixed(0)}% · ${r.holders.nakamoto} reach 51% · Gini ${r.holders.gini.toFixed(2)}`}>
              <div className="dk-holders">
                <ul className="dk-list">{r.holders.rows.slice(0, 10).map((h) => (
                  <li key={h.address} onClick={() => window.open(nansenWallet(h.address), '_blank')}><b>{h.name}</b><em>{h.kind}</em><span>{(h.share * 100).toFixed(2)}% · {usd(h.usd)}</span></li>
                ))}</ul>
                {r.holders.lorenz.length > 2 && (
                  <svg viewBox="0 0 100 100" className="dk-lorenz" role="img" aria-label="Lorenz curve of holder concentration">
                    <line x1="0" y1="100" x2="100" y2="0" stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
                    <polyline points={r.holders.lorenz.map((p) => `${p.pop * 100},${100 - p.supply * 100}`).join(' ')} fill="rgba(131,110,249,0.18)" stroke="#836ef9" strokeWidth="1.4" />
                    <text x="50" y="96" textAnchor="middle" className="ax">holders →</text>
                  </svg>
                )}
              </div>
              {r.clusters.length > 0 && <p className="dk-note"><b>Insider clusters:</b> {r.clusters.map((c) => `${c.members} wallets first funded by ${c.funder} hold ${(c.share * 100).toFixed(1)}%`).join('; ')}.</p>}
            </Card>
            <Card title="Flows and signals" sub="tgm/flow-intelligence, tgm/flows, tgm/indicators">
              <ul className="dk-flows">{r.flows.map((f) => <li key={f.key}><span>{FLOW_LABEL[f.key] ?? f.key}</span><b className={tone(f.netUsd)}>{f.netUsd === 0 ? '$0' : `${f.netUsd > 0 ? '+' : ''}${usd(f.netUsd)}`}</b><em>{f.wallets != null ? `${f.wallets} wallets` : ''}</em></li>)}</ul>
              <p className="dk-note">Net flow by cohort, 24h. A cohort at $0 simply had no activity on this token.</p>
              <div className="dk-trend"><span>Holders, 30 days</span><Spark values={r.trend.map((t) => t.holders)} w={220} /></div>
              <ul className="dk-inds">{r.indicators.map((i) => <li key={i.type + i.kind} className={i.kind}><b>{i.type.replace(/-/g, ' ')}</b><span>{i.level ?? 'n/a'}{i.percentile != null ? ` · ${Math.round(i.percentile)}th pct` : ''}</span></li>)}</ul>
            </Card>
          </div>
          <p className="dk-note">Sources: {r.sources.join(', ')} · {r.credits} Nansen credits · checked {new Date(r.fetchedAt).toUTCString().slice(17, 22)} UTC.</p>
        </>
      )}
    </div>
  );
}
