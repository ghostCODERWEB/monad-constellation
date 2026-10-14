import { NextResponse } from 'next/server';
import { checkToken } from '@/lib/check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: 'bad_address' }, { status: 400 });
  try {
    return NextResponse.json(await checkToken(address.toLowerCase()), { headers: { 'cache-control': 'public, s-maxage=600' } });
  } catch (e) {
    return NextResponse.json({ error: 'check_failed', message: (e as Error).message }, { status: 502 });
  }
}
