import { NextResponse } from 'next/server';
import { universeFrom } from '@/lib/universes';
import { getClusters } from '@/lib/clusters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(req: Request) {
  const u = universeFrom(new URL(req.url).searchParams.get('u'));
  try {
    return NextResponse.json(await getClusters(u), { headers: { 'cache-control': 'public, s-maxage=600' } });
  } catch (e) {
    return NextResponse.json({ error: 'build_failed', message: (e as Error).message }, { status: 502 });
  }
}
