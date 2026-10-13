import { NextResponse } from 'next/server';
import { getClusters } from '@/lib/clusters';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET() {
  try {
    return NextResponse.json(await getClusters(), { headers: { 'cache-control': 'public, s-maxage=600' } });
  } catch (e) {
    return NextResponse.json({ error: 'build_failed', message: (e as Error).message }, { status: 502 });
  }
}
