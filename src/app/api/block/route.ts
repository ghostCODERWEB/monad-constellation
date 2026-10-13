// The chain's heartbeat: the latest Monad block number, read from the public RPC.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const r = await fetch(process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const j = (await r.json()) as { result?: string };
    if (!j.result) throw new Error('no result');
    return NextResponse.json({ block: parseInt(j.result, 16), at: Date.now() }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
