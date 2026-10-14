'use client';

// Small pieces the desk tabs share: number formats, a sortable paged table, sparklines, token chips.
import { useMemo, useState, type ReactNode } from 'react';
import { universeDef } from '@/lib/universes';

export const usd = (n: number | null | undefined, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(digits)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(digits)}K` : `${s}$${a.toFixed(a < 1 && a > 0 ? 3 : 0)}`;
};
export const signedUsd = (n: number | null | undefined) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${usd(n)}`);
export const pct = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? 'n/a' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}%`);
export const tone = (n: number | null | undefined) => (n == null || n === 0 ? '' : n > 0 ? 'up' : 'down');
export const price = (n: number | null | undefined) => (n == null ? 'n/a' : n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toPrecision(3)}`);
export const nansenToken = (address: string) => `https://app.nansen.ai/token-god-mode?chain=monad&tokenAddress=${address}`;
export const nansenWallet = (address: string) => `https://app.nansen.ai/profiler?address=${address}&chain=monad`;

export interface Col<T> {
  key: string; label: string;
  get: (r: T) => number | string | null;
  render?: (r: T) => ReactNode;
  align?: 'left' | 'right';
  title?: string;
}

/** A sortable, paged table: click a header to sort, page size 12 / 24 / all. */
export function SortTable<T>({ rows, cols, rowKey, initial, onRow, empty = 'Nothing to show.' }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; initial: { key: string; dir: 'asc' | 'desc' }; onRow?: (r: T) => void; empty?: string;
}) {
  const [sort, setSort] = useState(initial);
  const [size, setSize] = useState(12);
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // missing values always sort last
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, cols, sort]);
  const shown = size === 0 ? sorted : sorted.slice(0, size);
  if (!rows.length) return <p className="dk-empty">{empty}</p>;
  return (
    <div className="dk-table">
      <table>
        <thead><tr>
          {cols.map((c) => (
            <th key={c.key} className={c.align === 'left' ? 'l' : ''} title={c.title} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
              {c.label}{sort.key === c.key ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'click' : ''}>
              {cols.map((c) => <td key={c.key} className={c.align === 'left' ? 'l' : ''}>{c.render ? c.render(r) : (c.get(r) ?? 'n/a')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dk-pager">
        <span>Showing {shown.length} of {rows.length}</span>
        {[12, 24, 0].map((n) => <button key={n} className={size === n ? 'on' : ''} onClick={() => setSize(n)}>{n === 0 ? 'All' : n}</button>)}
      </div>
    </div>
  );
}

/** A coloured chip for a token: its initials on the colour of its universe (Nansen serves real logos only per token). */
export function Chip({ symbol, universe, logo, size = 22 }: { symbol: string; universe?: string | null; logo?: string | null; size?: number }) {
  const c = (universe && universeDef(universe)?.color) || '#836ef9';
  if (logo) return <img className="dk-logo" src={logo} alt="" width={size} height={size} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />;
  return <i className="dk-chip" style={{ width: size, height: size, background: `radial-gradient(circle at 35% 30%, ${c}, #0b0618)`, fontSize: size * 0.4 }}>{symbol.slice(0, 2)}</i>;
}

export function Spark({ values, w = 120, h = 30, color = '#00ffa7', zero = false }: { values: number[]; w?: number; h?: number; color?: string; zero?: boolean }) {
  if (values.length < 2) return <span className="dim">no history yet</span>;
  const min = Math.min(...values, zero ? 0 : Infinity), max = Math.max(...values, zero ? 0 : -Infinity), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(' ');
  const y0 = zero ? h - ((0 - min) / span) * (h - 4) - 2 : null;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      {y0 != null && <line x1="0" x2={w} y1={y0} y2={y0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function Card({ title, sub, children, wide }: { title: string; sub?: string; children: ReactNode; wide?: boolean }) {
  return <section className={`dk-card ${wide ? 'wide' : ''}`}><header><b>{title}</b>{sub && <span>{sub}</span>}</header>{children}</section>;
}
