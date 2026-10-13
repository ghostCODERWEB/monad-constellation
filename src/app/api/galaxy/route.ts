import { NextResponse } from 'next/server';
import { getGalaxy } from '@/lib/galaxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  try {
    const g = await getGalaxy();
    if (!g.planets.length) return NextResponse.json({ error: 'no_data', message: g.errors[0] ?? 'Nansen returned no Monad tokens.' }, { status: 503 });
    return NextResponse.json(g, { headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600' } });
  } catch (e) {
    return NextResponse.json({ error: 'build_failed', message: (e as Error).message }, { status: 502 });
  }
}
