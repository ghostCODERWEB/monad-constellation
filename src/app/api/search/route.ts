import { NextResponse } from 'next/server';
import { getTokenIndex } from '@/lib/galaxy';
import { nansen } from '@/lib/nansen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Found { address: string; symbol: string; name: string; marketCap: number | null; universe: string | null; priceUsd: number | null }

/** Search Monad tokens: the station's own list first (all ~70 Monad tokens Nansen tracks), then Nansen's token search (free), Monad only. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 1) return NextResponse.json({ results: [] });
  const needle = q.toLowerCase().replace(/^\$/, '');
  const index = await getTokenIndex();
  const out: Found[] = index
    .filter((t) => t.symbol.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle) || t.address.startsWith(needle))
    .slice(0, 12)
    .map((t) => ({ address: t.address, symbol: t.symbol, name: t.name, marketCap: t.marketCap, universe: t.category, priceUsd: null }));
  if (needle.length >= 2) {
    const r = await nansen<{ tokens?: { name: string; symbol: string; chain: string; address: string; price?: number; market_cap?: number }[] }>('search/general', { search_query: q, result_type: 'token', chain: 'monad' });
    for (const t of r.body?.tokens ?? []) {
      if (t.chain !== 'monad' || out.some((o) => o.address === t.address.toLowerCase())) continue;
      out.push({ address: t.address.toLowerCase(), symbol: t.symbol, name: t.name, marketCap: t.market_cap ?? null, universe: null, priceUsd: t.price ?? null });
    }
  }
  return NextResponse.json({ results: out.slice(0, 14) }, { headers: { 'cache-control': 'public, s-maxage=60' } });
}
