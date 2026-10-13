// A wallet's record as Monad itself holds it, read straight from the
// MonadReputation contract, plus what the demo lending contract would ask
// of it as collateral. Reports "not deployed" until the addresses are set.
import { NextResponse } from 'next/server';
import { Interface } from 'ethers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REGISTRY = process.env.NEXT_PUBLIC_REPUTATION_ADDRESS ?? '';
const COLLATERAL = process.env.NEXT_PUBLIC_COLLATERAL_ADDRESS ?? '';
const RPC = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const reg = new Interface(['function reputationOf(address) view returns (uint16 score, uint16 flags, uint40 updatedAt, uint32 epoch)']);
const col = new Interface(['function collateralBps(address) view returns (uint256)']);

async function ethCall(to: string, data: string) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    signal: AbortSignal.timeout(6000), cache: 'no-store',
  });
  const j = (await r.json()) as { result?: string; error?: { message: string } };
  if (!j.result) throw new Error(j.error?.message ?? 'empty result');
  return j.result;
}

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: 'bad_address' }, { status: 400 });
  if (!REGISTRY) return NextResponse.json({ deployed: false });
  try {
    const [score, flags, updatedAt, epoch] = reg.decodeFunctionResult('reputationOf', await ethCall(REGISTRY, reg.encodeFunctionData('reputationOf', [address])));
    const bps = COLLATERAL ? Number(col.decodeFunctionResult('collateralBps', await ethCall(COLLATERAL, col.encodeFunctionData('collateralBps', [address])))[0]) : null;
    return NextResponse.json({
      deployed: true, registry: REGISTRY, collateral: COLLATERAL || null,
      score: Number(score), flags: Number(flags), updatedAt: Number(updatedAt), epoch: Number(epoch), collateralBps: bps,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ deployed: true, registry: REGISTRY, error: (e as Error).message }, { status: 502 });
  }
}
