'use client';

// Overview: the Monad market in one screen. Peregrine's overview, cut to what Monad has:
// who is being accumulated and distributed, the universes as sectors, movers, new tokens,
// the best Alpha scores, and what changed since the desk last looked.
import type { Desk, DeskToken } from '@/lib/desk';
import { Card, Chip, SortTable, Spark, pct, price, signedUsd, tone, usd, type Col } from './shared';

export function Overview({ desk, open }: { desk: Desk; open: (address: string) => void }) {
  const { buying, selling } = desk.hero;
  const t = desk.totals;
  const sectorCols: Col<Desk['sectors'][number]>[] = [
    { key: 'name', label: 'Universe', align: 'left', get: (s) => s.name, render: (s) => <span className="dk-name"><i className="dk-dot" style={{ background: s.color }} />{s.name}</span> },
    { key: 'tokens', label: 'Tokens', get: (s) => s.tokens },
    { key: 'active', label: 'Traded 24h', get: (s) => s.active },
    { key: 'mcap', label: 'Market cap', get: (s) => s.marketCap, render: (s) => usd(s.marketCap) },
    { key: 'vol', label: 'Volume 24h', get: (s) => s.volume24h, render: (s) => usd(s.volume24h) },
    { key: 'net', label: 'Net flow 24h', get: (s) => s.netflow24h, render: (s) => <b className={tone(s.netflow24h)}>{signedUsd(s.netflow24h)}</b> },
    { key: 'in', label: 'Buying most', get: (s) => s.topIn, render: (s) => (s.topIn ? `$${s.topIn}` : 'n/a') },
    { key: 'out', label: 'Selling most', get: (s) => s.topOut, render: (s) => (s.topOut ? `$${s.topOut}` : 'n/a') },
    { key: 'trend', label: 'Net flow trend', get: () => null, render: (s) => <Spark values={s.trend} zero color={s.color} /> },
  ];
  const mover = (x: DeskToken) => (
    <li key={x.address} onClick={() => open(x.address)}><Chip symbol={x.symbol} universe={x.universe} /><b>${x.symbol}</b><em>{price(x.priceUsd)}</em><span className={tone(x.change24h)}>{pct(x.change24h)}</span></li>
  );
  const alphaTop = [...desk.tokens].filter((x) => (x.volume24h ?? 0) >= 500).sort((a, b) => b.alpha - a.alpha).slice(0, 6);
  return (
    <div className="dk-page">
      <div className="dk-hero">
        {buying && selling ? (
          <h2>Accumulating <a onClick={() => open(buying.address)}>${buying.symbol}</a>. Distributing <a onClick={() => open(selling.address)}>${selling.symbol}</a>.</h2>
        ) : <h2>Monad market, last 24 hours</h2>}
        <p>Chosen by dollar net flow over 24 hours among traded tokens, stablecoins left out (Nansen token screener, Monad only).{buying && <> ${buying.symbol}: <b className="up">{signedUsd(buying.netflow24h)}</b>.</>}{selling && <> ${selling.symbol}: <b className="down">{signedUsd(selling.netflow24h)}</b>.</>}</p>
      </div>
      <div className="dk-stats">
        <div><span>Volume 24h</span><b>{usd(t.volume24h)}</b></div>
        <div><span>Net flow 24h</span><b className={tone(t.netflow24h)}>{signedUsd(t.netflow24h)}</b></div>
        <div><span>Market cap</span><b>{usd(t.marketCap)}</b></div>
        <div><span>DEX liquidity</span><b>{usd(t.liquidity)}</b></div>
        <div><span>Tokens traded</span><b>{t.active} of {t.tokens}</b></div>
        <div><span>Smart Money holds</span><b>{usd(desk.smart.valueUsd)}</b></div>
      </div>
      <Card title="Universes" sub="the five categories as sectors · click a header to sort" wide>
        <SortTable rows={desk.sectors} cols={sectorCols} rowKey={(s) => s.id} initial={{ key: 'vol', dir: 'desc' }} />
      </Card>
      <div className="dk-grid">
        <Card title="Biggest risers" sub="24h price, liquid tokens"><ul className="dk-list">{desk.movers.up.map(mover)}</ul></Card>
        <Card title="Biggest fallers" sub="24h price, liquid tokens"><ul className="dk-list">{desk.movers.down.map(mover)}</ul></Card>
        <Card title="Highest Alpha scores" sub="what to look at, not a forecast">
          <ul className="dk-list">{alphaTop.map((x) => (
            <li key={x.address} onClick={() => open(x.address)} title={x.alphaParts.map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}: ${p.detail}`).join('\n')}>
              <Chip symbol={x.symbol} universe={x.universe} /><b>${x.symbol}</b><em>{x.alphaParts[0]?.label ?? 'nothing to see'}</em><span className="up">{x.alpha}</span>
            </li>
          ))}</ul>
        </Card>
        <Card title="Newest tokens" sub="by deployment age">
          <ul className="dk-list">{desk.newest.map((x) => (
            <li key={x.address} onClick={() => open(x.address)}><Chip symbol={x.symbol} universe={x.universe} /><b>${x.symbol}</b><em>{usd(x.marketCap)}</em><span>{x.ageDays != null ? `${x.ageDays}d` : 'n/a'}</span></li>
          ))}</ul>
        </Card>
      </div>
      <Card title="What changed" sub={desk.changes.since ? `since ${new Date(desk.changes.since).toUTCString().slice(5, 22)} UTC` : 'needs a snapshot to compare with'} wide>
        {desk.changes.since ? (
          desk.changes.rows.length ? (
            <ul className="dk-changes">{desk.changes.rows.map((r) => (
              <li key={r.address + r.metric} onClick={() => open(r.address)}><b>${r.symbol}</b> {r.metric}: {usd(r.from)} → {usd(r.to)} <span className={r.pct >= 0 ? 'up' : 'down'}>{pct(r.pct * 100, 0)}</span></li>
            ))}</ul>
          ) : <p className="dk-empty">Nothing moved more than 5% on a token above $1K.</p>
        ) : <p className="dk-empty">The desk keeps a snapshot every three hours and compares today with yesterday. This is its first look: come back later for changes. Nothing is invented in the meantime.</p>}
      </Card>
    </div>
  );
}
