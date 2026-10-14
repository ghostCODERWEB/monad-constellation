import { NextResponse } from 'next/server';
import { getHoldingsOn } from '@/lib/desk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Date.parse(date) > Date.now()) return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  return NextResponse.json(await getHoldingsOn(date), { headers: { 'cache-control': 'public, s-maxage=900' } });
}
