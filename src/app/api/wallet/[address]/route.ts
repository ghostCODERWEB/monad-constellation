import { NextResponse } from 'next/server';
import { walletProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: 'bad_address' }, { status: 400 });
  return NextResponse.json(await walletProfile(address.toLowerCase()), { headers: { 'cache-control': 'public, s-maxage=900' } });
}
