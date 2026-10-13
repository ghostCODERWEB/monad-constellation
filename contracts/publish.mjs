// Publishes the current reputation set to MonadReputation: opens an epoch
// with the dataset hash, then writes every score in batches. Monad's cheap,
// fast blocks make a few thousand writes a handful of transactions.
//
//   ATTESTER_KEY=0x... REGISTRY=0x... node publish.mjs
//   ATTESTER_KEY=0x... REGISTRY=0x... NETWORK=testnet SOURCE=http://localhost:3300/api/reputation node publish.mjs
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import fs from 'node:fs';

const NETS = {
  mainnet: { rpc: 'https://rpc.monad.xyz', chainId: 143, explorer: 'https://monadscan.com' },
  testnet: { rpc: 'https://testnet-rpc.monad.xyz', chainId: 10143, explorer: 'https://testnet.monadscan.com' },
};
const net = NETS[process.env.NETWORK ?? 'mainnet'];
const { ATTESTER_KEY, REGISTRY } = process.env;
if (!ATTESTER_KEY || !REGISTRY) throw new Error('Set ATTESTER_KEY and REGISTRY in your shell.');
const SOURCE = process.env.SOURCE ?? 'http://localhost:3300/api/reputation';
const BATCH = Number(process.env.BATCH ?? 200);

const set = await (await fetch(SOURCE)).json();
if (!set.wallets?.length) throw new Error(`No wallets from ${SOURCE}`);
console.log(`${set.wallets.length} wallets · ${set.methodology} · dataset ${set.datasetHash}`);

const abi = JSON.parse(fs.readFileSync(new URL('./out/MonadReputation.json', import.meta.url))).abi;
const wallet = new Wallet(ATTESTER_KEY, new JsonRpcProvider(net.rpc, net.chainId));
const reg = new Contract(REGISTRY, abi, wallet);

const tx0 = await reg.startEpoch(set.datasetHash, set.methodology);
await tx0.wait();
console.log(`epoch opened: ${net.explorer}/tx/${tx0.hash}`);

for (let i = 0; i < set.wallets.length; i += BATCH) {
  const chunk = set.wallets.slice(i, i + BATCH);
  const tx = await reg.attest(chunk.map((w) => w.address), chunk.map((w) => w.score), chunk.map((w) => w.flags));
  await tx.wait();
  console.log(`  ${i + chunk.length}/${set.wallets.length}  ${net.explorer}/tx/${tx.hash}`);
}
console.log(`\nDone. ${Number(await reg.walletCount())} wallets on chain, epoch ${Number(await reg.epoch())}.`);
