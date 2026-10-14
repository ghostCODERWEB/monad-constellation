import { NextResponse } from 'next/server';
import { getTokenIndex } from '@/lib/galaxy';
import { UNIVERSES } from '@/lib/universes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** The universes and which Monad tokens belong to each (Nansen's token list, names and market caps; category rules from lib/universes). */
export async function GET() {
  try {
    const tokens = await getTokenIndex();
    if (!tokens.length) return NextResponse.json({ error: 'no_data', message: 'Nansen returned no Monad tokens.' }, { status: 503 });
    return NextResponse.json({
      universes: UNIVERSES.map((u) => ({ ...u, tokens: tokens.filter((t) => t.category === u.id) })),
      total: tokens.length,
    }, { headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch (e) {
    return NextResponse.json({ error: 'build_failed', message: (e as Error).message }, { status: 502 });
  }
}
