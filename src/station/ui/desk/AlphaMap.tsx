'use client';

// Alpha map: every Monad token by price move against net buying, bubble size = market cap.
// Peregrine's Alpha market map, with the flow measured over all DEX traders (Nansen's token
// screener) because Smart Money net flow is empty on Monad.
import { useMemo, useState } from 'react';
import { UNIVERSES } from '@/lib/universes';
import type { Desk, DeskToken } from '@/lib/desk';
import { Card, Chip, SortTable, pct, price, tone, usd, type Col } from './shared';

const W = 920, H = 420, PAD = { l: 52, r: 16, t: 14, b: 34 };

export function AlphaMap({ desk, open }: { desk: Desk; open: (address: string) => void }) {
  const [only, setOnly] = useState<string>('all');
  const [liquid, setLiquid] = useState(true);
  const [hover, setHover] = useState<DeskToken | null>(null);
  const pts = useMemo(() => desk.tokens.filter((t) => (t.volume24h ?? 0) >= 100 && t.netflow24h != null && t.change24h != null && (only === 'all' || t.universe === only) && (!liquid || (t.liquidity ?? 0) >= 50_000)), [desk, only, liquid]);
  // The x axis spans what the tokens actually did (at least ±3%, at most ±30%), so a quiet day isn't a vertical line.
  const xr = useMemo(() => { const m = pts.map((t) => Math.abs(t.change24h ?? 0)).sort((a, b) => a - b); return Math.max(3, Math.min(30, (m[Math.floor(m.length * 0.92)] ?? 3) * 1.15)); }, [pts]);
  const X = (v: number) => PAD.l + ((Math.max(-xr, Math.min(xr, v)) + xr) / (2 * xr)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (Math.max(-1, Math.min(1, v)) + 1) / 2) * (H - PAD.t - PAD.b);
  const color = (u: string) => UNIVERSES.find((x) => x.id === u)?.color ?? '#836ef9';
  const cols: Col<DeskToken>[] = [
    { key: 'sym', label: 'Token', align: 'left', get: (t) => t.symbol, render: (t) => <span className="dk-name"><Chip symbol={t.symbol} universe={t.universe} />${t.symbol}</span> },
    { key: 'alpha', label: 'Alpha', get: (t) => t.alpha, render: (t) => <b className={t.alpha >= 60 ? 'up' : t.alpha <= 40 ? 'down' : ''}>{t.alpha}</b>, title: '50 is nothing to see; points push it up or down' },
    { key: 'why', label: 'Why', align: 'left', get: (t) => t.alphaParts[0]?.label ?? '', render: (t) => t.alphaParts.slice(0, 3).map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}`).join(' · ') || 'nothing to see' },
    { key: 'chg', label: 'Price 24h', get: (t) => t.change24h, render: (t) => <span className={tone(t.change24h)}>{pct(t.change24h)}</span> },
    { key: 'net', label: 'Net / volume', get: (t) => (t.volume24h && t.netflow24h != null ? t.netflow24h / t.volume24h : null), render: (t) => (t.volume24h && t.netflow24h != null ? pct((t.netflow24h / t.volume24h) * 100, 0) : 'n/a') },
    { key: 'liq', label: 'Liquidity', get: (t) => t.liquidity, render: (t) => usd(t.liquidity) },
    { key: 'mc', label: 'Market cap', get: (t) => t.marketCap, render: (t) => usd(t.marketCap) },
  ];
  return (
    <div className="dk-page">
      <Card title="Alpha map" sub="price move against net buying · bubble = market cap · click a token to check it" wide>
        <div className="dk-chips">
          <button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>All universes</button>
          {UNIVERSES.map((u) => <button key={u.id} className={only === u.id ? 'on' : ''} style={{ ['--u' as string]: u.color }} onClick={() => setOnly(u.id)}>{u.name}</button>)}
          <label><input type="checkbox" checked={liquid} onChange={(e) => setLiquid(e.target.checked)} /> liquidity over $50K</label>
          <span className="dim">{pts.length} tokens plotted</span>
        </div>
        <svg className="dk-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Alpha market map">
          <rect x={PAD.l} y={PAD.t} width={(W - PAD.l - PAD.r) / 2} height={(H - PAD.t - PAD.b) / 2} fill="rgba(248,113,113,0.05)" />
          <rect x={W / 2 + (PAD.l - PAD.r) / 2} y={PAD.t} width={(W - PAD.l - PAD.r) / 2} height={(H - PAD.t - PAD.b) / 2} fill="rgba(74,222,128,0.07)" />
          <line x1={X(0)} x2={X(0)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.2)" />
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(0)} y2={Y(0)} stroke="rgba(255,255,255,0.2)" />
          {[-1, -0.5, 0.5, 1].map((f) => { const v = f * xr; return <text key={f} x={X(v)} y={H - 12} textAnchor="middle" className="ax">{v > 0 ? '+' : '−'}{Math.abs(v).toFixed(1)}%</text>; })}
          {[-1, -0.5, 0.5, 1].map((v) => <text key={v} x={PAD.l - 8} y={Y(v) + 4} textAnchor="end" className="ax">{v > 0 ? '+' : '−'}{Math.abs(v) * 100}%</text>)}
          <text x={W - PAD.r - 4} y={PAD.t + 14} textAnchor="end" className="qd up">bought and rising</text>
          <text x={PAD.l + 4} y={PAD.t + 14} className="qd">bought while falling</text>
          <text x={W - PAD.r - 4} y={H - PAD.b - 8} textAnchor="end" className="qd">sold while rising</text>
          <text x={PAD.l + 4} y={H - PAD.b - 8} className="qd down">sold and falling</text>
          <text x={W / 2} y={H - 1} textAnchor="middle" className="ax">price change, 24h</text>
          {pts.map((t) => {
            const r = 5 + Math.max(0, Math.log10(Math.max(t.marketCap ?? 1e4, 1e4) / 1e4)) * 2.6;
            return (
              <g key={t.address} onMouseEnter={() => setHover(t)} onMouseLeave={() => setHover(null)} onClick={() => open(t.address)} className="pt">
                <circle cx={X(t.change24h!)} cy={Y(t.netflow24h! / (t.volume24h || 1))} r={r} fill={color(t.universe)} fillOpacity="0.55" stroke={color(t.universe)} />
                {r > 9 && <text x={X(t.change24h!)} y={Y(t.netflow24h! / (t.volume24h || 1)) + 3.5} textAnchor="middle" className="lb">{t.symbol.slice(0, 5)}</text>}
              </g>
            );
          })}
        </svg>
        <p className="dk-note">{hover ? <><b>${hover.symbol}</b> {hover.name} · price {pct(hover.change24h)} · net buying {pct(((hover.netflow24h ?? 0) / (hover.volume24h || 1)) * 100, 0)} of {usd(hover.volume24h)} volume · liquidity {usd(hover.liquidity)} · mcap {usd(hover.marketCap)} · {price(hover.priceUsd)}</> : 'Net flow here is across all DEX traders (Nansen token screener). Nansen’s Smart Money net flow returns nothing on Monad, so the map says so rather than guess.'}</p>
      </Card>
      <Card title="Alpha ranking" sub="a shortlist of what to look at, with every point shown; not a forecast" wide>
        <SortTable rows={desk.tokens.filter((t) => (t.volume24h ?? 0) >= 100)} cols={cols} rowKey={(t) => t.address} initial={{ key: 'alpha', dir: 'desc' }} onRow={(t) => open(t.address)} />
      </Card>
    </div>
  );
}
