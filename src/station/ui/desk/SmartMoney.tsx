'use client';

// Smart Money on Monad, and the Time Machine. Honest about coverage: Nansen labels only a
// handful of Smart Money wallets on Monad, so these tables are short and the page says why.
import { useEffect, useMemo, useState } from 'react';
import type { Desk } from '@/lib/desk';
import { Card, Chip, SortTable, nansenWallet, pct, signedUsd, tone, usd, type Col } from './shared';

type Past = { date: string; rows: { address: string; symbol: string; valueUsd: number; holders: number; share: number }[] };
const COLORS = ['#00ffa7', '#836ef9', '#f5c542', '#22d3ee', '#f472b6', '#fb923c'];

export function SmartMoney({ desk, open }: { desk: Desk; open: (address: string) => void }) {
  const sm = desk.smart;
  const universeOf = useMemo(() => new Map(desk.tokens.map((t) => [t.address, t.universe])), [desk]);

  // 7-day holdings history, the biggest six tokens.
  const series = useMemo(() => {
    const dates = [...new Set(sm.history.map((h) => h.date))].sort();
    const bySym = new Map<string, Map<string, number>>();
    for (const h of sm.history) { const m = bySym.get(h.symbol) ?? new Map(); m.set(h.date, (m.get(h.date) ?? 0) + h.valueUsd); bySym.set(h.symbol, m); }
    const top = [...bySym.entries()].map(([symbol, m]) => ({ symbol, m, last: m.get(dates.at(-1) ?? '') ?? 0 })).sort((a, b) => b.last - a.last).slice(0, 6);
    return { dates, top };
  }, [sm.history]);
  const maxV = Math.max(1, ...series.top.flatMap((s) => [...s.m.values()]));

  // Time Machine: holdings on a past day against now.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(() => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10));
  const [past, setPast] = useState<Past | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    setPast(null); setErr(null);
    fetch(`/api/desk/holdings?date=${date}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('Nansen has no holdings for that day.'))).then((j) => !dead && setPast(j)).catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [date]);
  const compare = useMemo(() => {
    if (!past) return [];
    const now = new Map(sm.holdings.map((h) => [h.address, h]));
    const then = new Map(past.rows.map((h) => [h.address, h]));
    return [...new Set([...now.keys(), ...then.keys()])].map((a) => {
      const n = now.get(a), t = then.get(a);
      return { address: a, symbol: n?.symbol ?? t?.symbol ?? '?', then: t?.valueUsd ?? 0, now: n?.valueUsd ?? 0, holdersThen: t?.holders ?? 0, holdersNow: n?.holders ?? 0 };
    });
  }, [past, sm.holdings]);

  const holdCols: Col<Desk['smart']['holdings'][number]>[] = [
    { key: 'sym', label: 'Token', align: 'left', get: (h) => h.symbol, render: (h) => <span className="dk-name"><Chip symbol={h.symbol} universe={universeOf.get(h.address)} />${h.symbol}</span> },
    { key: 'val', label: 'Smart Money holds', get: (h) => h.valueUsd, render: (h) => usd(h.valueUsd) },
    { key: 'hold', label: 'Wallets', get: (h) => h.holders },
    { key: 'share', label: 'Share of holdings', get: (h) => h.share, render: (h) => pct(h.share * 100, 1) },
    { key: 'chg', label: 'Balance 24h', get: (h) => h.change24h, render: (h) => <span className={tone(h.change24h)}>{pct((h.change24h ?? 0) * 100, 2)}</span> },
  ];
  const cmpCols: Col<(typeof compare)[number]>[] = [
    { key: 'sym', label: 'Token', align: 'left', get: (c) => c.symbol, render: (c) => <span className="dk-name"><Chip symbol={c.symbol} universe={universeOf.get(c.address)} />${c.symbol}</span> },
    { key: 'then', label: `On ${date}`, get: (c) => c.then, render: (c) => usd(c.then) },
    { key: 'now', label: 'Now', get: (c) => c.now, render: (c) => usd(c.now) },
    { key: 'delta', label: 'Change', get: (c) => c.now - c.then, render: (c) => <b className={tone(c.now - c.then)}>{signedUsd(c.now - c.then)}</b> },
    { key: 'hold', label: 'Wallets then → now', get: (c) => c.holdersNow - c.holdersThen, render: (c) => `${c.holdersThen} → ${c.holdersNow}` },
  ];
  return (
    <div className="dk-page">
      <p className="dk-cover"><b>Coverage:</b> Nansen labels Smart Money wallets on Monad, but few: {sm.holdings.length} tokens held, {sm.trades.length} recent DEX trade{sm.trades.length === 1 ? '' : 's'}, {sm.leaders.length} wallet{sm.leaders.length === 1 ? '' : 's'} on the leaderboard. Smart Money net flow returns nothing for Monad. What is below is all there is.</p>
      <Card title="What Smart Money holds on Monad" sub={`${usd(sm.valueUsd)} in ${sm.holdings.length} tokens · Nansen smart-money/holdings`} wide>
        <SortTable rows={sm.holdings} cols={holdCols} rowKey={(h) => h.address} initial={{ key: 'val', dir: 'desc' }} onRow={(h) => open(h.address)} empty="Nansen reports no Smart Money holdings on Monad." />
      </Card>
      <div className="dk-grid two">
        <Card title="Holdings, last 7 days" sub="Smart Money value by token · smart-money/historical-holdings">
          {series.dates.length >= 2 ? (
            <>
              <svg viewBox="0 0 440 180" className="dk-lines" role="img" aria-label="Smart Money holdings over seven days">
                {series.top.map((s, k) => {
                  const pts = series.dates.map((d, i) => `${20 + (i / (series.dates.length - 1)) * 400},${160 - ((s.m.get(d) ?? 0) / maxV) * 140}`).join(' ');
                  return <polyline key={s.symbol} points={pts} fill="none" stroke={COLORS[k]} strokeWidth="1.8" />;
                })}
                {series.dates.map((d, i) => <text key={d} x={20 + (i / (series.dates.length - 1)) * 400} y="176" textAnchor="middle" className="ax">{d.slice(5)}</text>)}
              </svg>
              <p className="dk-legend">{series.top.map((s, k) => <span key={s.symbol}><i style={{ background: COLORS[k] }} />${s.symbol}</span>)}</p>
            </>
          ) : <p className="dk-empty">No holdings history returned.</p>}
        </Card>
        <Card title="Time Machine" sub="Smart Money holdings on a past day, against now">
          <p className="dk-chips"><label>Date <input type="date" value={date} max={yesterday} min="2025-11-24" onChange={(e) => e.target.value && setDate(e.target.value)} /></label></p>
          {err ? <p className="dk-empty">{err}</p> : !past ? <p className="dk-empty">Loading {date}…</p> : <SortTable rows={compare} cols={cmpCols} rowKey={(c) => c.address} initial={{ key: 'delta', dir: 'desc' }} onRow={(c) => open(c.address)} empty={`Nansen has no Smart Money holdings on Monad for ${date}.`} />}
        </Card>
      </div>
      <div className="dk-grid two">
        <Card title="Latest Smart Money DEX trades" sub="smart-money/dex-trades">
          {sm.trades.length ? <ul className="dk-list">{sm.trades.slice(0, 10).map((t) => (
            <li key={t.tx} onClick={() => window.open(nansenWallet(t.wallet), '_blank')}><b>{t.label ? t.label.replace(/\s*\[0x[0-9a-f]+\]/i, '') : `${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}`}</b><em>{t.sold} → {t.bought}</em><span>{t.valueUsd != null ? usd(t.valueUsd) : new Date(t.at).toUTCString().slice(17, 22)}</span></li>
          ))}</ul> : <p className="dk-empty">Nansen shows no Smart Money DEX trades on Monad right now.</p>}
        </Card>
        <Card title="Smart Money leaderboard" sub="smart-money/pnl-leaderboard">
          {sm.leaders.length ? <ul className="dk-list">{sm.leaders.slice(0, 8).map((l) => (
            <li key={l.address} onClick={() => window.open(nansenWallet(l.address), '_blank')}><b>{l.label.replace(/\s*\[0x[0-9a-f]+\]/i, '') || `${l.address.slice(0, 6)}…${l.address.slice(-4)}`}</b><em>{l.trades} trades · {l.tokens} tokens{l.winRate != null ? ` · ${(l.winRate * 100).toFixed(0)}% win` : ''}</em><span className={tone(l.totalUsd)}>{signedUsd(l.totalUsd)}</span></li>
          ))}</ul> : <p className="dk-empty">No Smart Money wallets on the Monad leaderboard.</p>}
        </Card>
      </div>
    </div>
  );
}
