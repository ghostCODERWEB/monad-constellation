'use client';

// Copy Lab: wallets whose record looks copyable on Monad (Peregrine's copy score), and a paper
// portfolio to follow them with. Paper only: nothing is ever bought or sold, no wallet is
// connected. A paper follow records today's prices and the wallet's current holdings as
// weights, then tracks what that basket would be worth now, from Nansen's token screener.
import { useEffect, useMemo, useState } from 'react';
import type { CopyCandidate } from '@/lib/copy';
import type { Desk } from '@/lib/desk';
import { Card, Chip, SortTable, nansenWallet, pct, signedUsd, tone, usd, type Col } from './shared';

interface Paper { id: string; address: string; name: string; at: string; amountUsd: number; entries: { address: string; symbol: string; weight: number; entryPrice: number }[] }
const KEY = 'station-paper-follows-v1';

export function CopyLab({ desk }: { desk: Desk }) {
  const [data, setData] = useState<{ candidates: CopyCandidate[]; wallets: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<CopyCandidate | null>(null);
  const [amount, setAmount] = useState(1000);
  const [papers, setPapers] = useState<Paper[]>([]);
  useEffect(() => { try { setPapers(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { /* none yet */ } }, []);
  useEffect(() => {
    fetch('/api/copy').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message ?? 'The copy list could not be built.'); setData(j); }).catch((e) => setError(e.message));
  }, []);
  const save = (next: Paper[]) => { setPapers(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private window */ } };
  const prices = useMemo(() => new Map(desk.tokens.map((t) => [t.address, t.priceUsd])), [desk]);

  const follow = (c: CopyCandidate) => {
    const withPrice = c.holdings.filter((h) => (prices.get(h.address) ?? 0) > 0);
    const total = withPrice.reduce((s, h) => s + h.usd, 0);
    if (!total) return;
    save([{ id: `${c.address}-${Date.now()}`, address: c.address, name: c.name, at: new Date().toISOString(), amountUsd: amount,
      entries: withPrice.map((h) => ({ address: h.address, symbol: h.symbol, weight: h.usd / total, entryPrice: prices.get(h.address)! })) }, ...papers]);
  };
  const worth = (p: Paper) => p.entries.reduce((s, e) => s + p.amountUsd * e.weight * ((prices.get(e.address) ?? e.entryPrice) / e.entryPrice), 0);

  const cols: Col<CopyCandidate>[] = [
    { key: 'name', label: 'Wallet', align: 'left', get: (c) => c.name, render: (c) => <span className="dk-name"><Chip symbol={c.kind.slice(0, 2).toUpperCase()} />{c.name}<em className="dim"> {c.kind}</em></span> },
    { key: 'score', label: 'Copy score', get: (c) => c.score, render: (c) => <b className={c.score >= 65 ? 'up' : c.score <= 45 ? 'down' : ''}>{c.score}</b>, title: '50 is neutral; parts add or subtract' },
    { key: 'why', label: 'Why', align: 'left', get: (c) => c.parts[0]?.label ?? '', render: (c) => c.parts.slice(0, 3).map((p) => `${p.label} ${p.points > 0 ? '+' : ''}${p.points}`).join(' · ') },
    { key: 'pnl', label: 'PnL', get: (c) => c.pnlUsd, render: (c) => <span className={tone(c.pnlUsd)}>{signedUsd(c.pnlUsd)}</span> },
    { key: 'roi', label: 'ROI', get: (c) => c.roiPct, render: (c) => pct(c.roiPct, 1) },
    { key: 'trades', label: 'Trades', get: (c) => c.trades },
    { key: 'tok', label: 'Profitable on', get: (c) => c.tokensProfitable / Math.max(1, c.tokensTraded), render: (c) => `${c.tokensProfitable} of ${c.tokensTraded}` },
    { key: 'hold', label: 'Holds now', get: (c) => c.holdingUsd, render: (c) => usd(c.holdingUsd) },
  ];
  return (
    <div className="dk-page">
      <p className="dk-cover"><b>Paper only.</b> The score rates how copyable a record <i>looks</i> (return, consistency, activity, label, size), from the {data?.wallets.toLocaleString() ?? '…'} wallets the five universes know: Nansen holders, PnL leaderboards and 24h trades. It is not a recommendation, no track record is claimed, and following here never places an order.</p>
      <Card title="Paper portfolio" sub={papers.length ? `${papers.length} paper follow${papers.length === 1 ? '' : 's'} · prices from Nansen’s token screener` : 'follow a wallet below'} wide>
        {papers.length ? (
          <ul className="dk-paper">{papers.map((p) => { const now = worth(p), d = now - p.amountUsd; return (
            <li key={p.id}><b>{p.name}</b><span>${p.amountUsd.toLocaleString()} paper on {new Date(p.at).toUTCString().slice(5, 22)} UTC · {p.entries.slice(0, 4).map((e) => `${e.symbol} ${Math.round(e.weight * 100)}%`).join(', ')}</span>
              <em>now {usd(now)}</em><strong className={tone(d)}>{signedUsd(d)} ({pct((d / p.amountUsd) * 100, 2)})</strong>
              <button onClick={() => save(papers.filter((x) => x.id !== p.id))}>Close</button></li>
          ); })}</ul>
        ) : <p className="dk-empty">No paper follows yet. Pick a wallet, choose a paper amount, and follow it: the lab records today’s prices and tracks the basket from here.</p>}
      </Card>
      {error ? <p className="dk-empty">{error}</p> : !data ? <p className="dk-empty">Scoring wallets from the five universes…</p> : (
        <div className="dk-split">
          <Card title="Copy candidates" sub="profitable wallets, best record first · click one" wide>
            <SortTable rows={data.candidates} cols={cols} rowKey={(c) => c.address} initial={{ key: 'score', dir: 'desc' }} onRow={setPick} />
          </Card>
          {pick && (
            <Card title={pick.name} sub={`${pick.kind} wallet · score ${pick.score}`}>
              <ul className="dk-parts">{pick.parts.map((p) => <li key={p.id} className={p.points >= 0 ? 'up' : 'down'}><b>{p.points > 0 ? '+' : ''}{p.points}</b><span>{p.label}: {p.detail}</span></li>)}</ul>
              <p className="dk-note">Holds now:</p>
              <ul className="dk-list">{pick.holdings.slice(0, 6).map((h) => <li key={h.address}><b>${h.symbol}</b><span>{usd(h.usd)}</span></li>)}</ul>
              <div className="dk-follow">
                <label>Paper amount $<input type="number" min={100} step={100} value={amount} onChange={(e) => setAmount(Math.max(100, Number(e.target.value) || 100))} /></label>
                <button disabled={!pick.holdings.length} onClick={() => follow(pick)}>Follow on paper</button>
                <a href={nansenWallet(pick.address)} target="_blank" rel="noreferrer">Open in Nansen ↗</a>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
