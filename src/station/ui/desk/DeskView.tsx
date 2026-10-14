'use client';

// The desk tabs of the research terminal: one data load (/api/desk) shared by Overview,
// Smart Money, Alpha map and Copy Lab, plus the Token Checker.
import { useEffect, useState } from 'react';
import type { Desk } from '@/lib/desk';
import { AlphaMap } from './AlphaMap';
import { Checker } from './Checker';
import { CopyLab } from './CopyLab';
import { Overview } from './Overview';
import { SmartMoney } from './SmartMoney';

export type DeskTab = 'overview' | 'smart' | 'alpha' | 'checker' | 'copy';
export const DESK_TABS: { id: DeskTab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'smart', label: 'Smart Money' }, { id: 'alpha', label: 'Alpha map' }, { id: 'checker', label: 'Token Checker' }, { id: 'copy', label: 'Copy Lab' },
];

export function DeskView({ tab, address, setAddress, check, dossier }: {
  tab: DeskTab; address: string | null; setAddress: (a: string | null) => void; check: (address: string) => void; dossier: (address: string, universe: string | null) => void;
}) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    fetch('/api/desk').then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message ?? 'The desk is unavailable.'); if (!dead) setDesk(j); }).catch((e) => !dead && setError(e.message));
    return () => { dead = true; };
  }, []);
  if (error) return <div className="dk-page"><p className="dk-empty">Nansen data unavailable: {error}</p></div>;
  if (!desk) return <div className="dk-page"><p className="dk-empty">Reading the Monad market from Nansen (about 20 credits, kept for 20 minutes)…</p></div>;
  return (
    <>
      {tab === 'overview' && <Overview desk={desk} open={check} />}
      {tab === 'smart' && <SmartMoney desk={desk} open={check} />}
      {tab === 'alpha' && <AlphaMap desk={desk} open={check} />}
      {tab === 'checker' && <Checker desk={desk} address={address} setAddress={setAddress} dossier={dossier} />}
      {tab === 'copy' && <CopyLab desk={desk} />}
    </>
  );
}
