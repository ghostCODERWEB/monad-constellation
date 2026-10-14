import { NextResponse } from 'next/server';
import { getDesk } from '@/lib/desk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET() {
  try {
    const d = await getDesk();
    if (!d.tokens.length) return NextResponse.json({ error: 'no_data', message: 'Nansen returned no Monad tokens.' }, { status: 503 });
    return NextResponse.json(d, { headers: { 'cache-control': 'public, s-maxage=300' } });
  } catch (e) {
    return NextResponse.json({ error: 'build_failed', message: (e as Error).message }, { status: 502 });
  }
}
