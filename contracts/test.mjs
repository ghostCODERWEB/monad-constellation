// Behavioural tests for MonadReputation and ReputationCollateral on a real EVM.
//   npm test
import { createVM, runTx } from '@ethereumjs/vm';
import { createBlock } from '@ethereumjs/block';
import { Common, Hardfork, Mainnet } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { hexToBytes, bytesToHex, Account, createAddressFromPrivateKey } from '@ethereumjs/util';
import { Interface, AbiCoder } from 'ethers';
import fs from 'node:fs';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./out/${n}.json`, import.meta.url)));
const REG = load('MonadReputation'), COL = load('ReputationCollateral');
const reg = new Interface(REG.abi), col = new Interface(COL.abi);
const common = new Common({ chain: Mainnet, hardfork: Hardfork.Cancun });
const vm = await createVM({ common });
let NOW = 1_790_000_000n;
const block = () => createBlock({ header: { number: 1n, timestamp: NOW, baseFeePerGas: 7n } }, { common });

const keys = [1, 2, 3].map((i) => hexToBytes('0x' + String(i).padStart(2, '0').repeat(32)));
const who = keys.map((k) => createAddressFromPrivateKey(k));
for (const a of who) await vm.stateManager.putAccount(a, new Account(0n, 10n ** 20n));

async function send(i, to, data) {
  const acct = await vm.stateManager.getAccount(who[i]);
  const tx = createLegacyTx({ nonce: acct.nonce, gasPrice: 10n, gasLimit: 15_000_000n, to, value: 0n, data: hexToBytes(data) }, { common }).sign(keys[i]);
  return runTx(vm, { tx, skipBalance: true, block: block() });
}
async function call(to, iface, fn, args = []) {
  const r = await vm.evm.runCall({ to, data: hexToBytes(iface.encodeFunctionData(fn, args)), block: block() });
  if (r.execResult.exceptionError) throw new Error(`${fn} reverted`);
  return iface.decodeFunctionResult(fn, bytesToHex(r.execResult.returnValue));
}
const ok = (r) => !r.execResult.exceptionError;
const reverted = (r, name) => {
  if (!r.execResult.exceptionError) return false;
  if (!name) return true;
  const data = bytesToHex(r.execResult.returnValue);
  return data.startsWith(reg.getError(name).selector);
};

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? passed++ : failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const deployData = REG.bytecode + AbiCoder.defaultAbiCoder().encode(['string'], ['nansen-v1']).slice(2);
const d = await send(0, undefined, '0x' + deployData);
const R = d.createdAddress;
check('registry deploys', ok(d) && !!R);
check('deployer is owner and attester', (await call(R, reg, 'owner'))[0] === who[0].toString().replace(/^0x/, '0x').toLowerCase() || (await call(R, reg, 'owner'))[0].toLowerCase() === who[0].toString().toLowerCase());
check('deployer is an attester', (await call(R, reg, 'attesters', [who[0].toString()]))[0] === true);
check('methodology stored', (await call(R, reg, 'methodology'))[0] === 'nansen-v1');

const W = ['0x' + 'a1'.repeat(20), '0x' + 'b2'.repeat(20), '0x' + 'c3'.repeat(20)];
let r = await send(0, R, reg.encodeFunctionData('attest', [W, [800, 300, 950], [33, 0, 64]]));
check('attest before any epoch reverts NoEpoch', reverted(r, 'NoEpoch'));

const H = '0x' + 'ab'.repeat(32);
r = await send(0, R, reg.encodeFunctionData('startEpoch', [H, '']));
check('startEpoch opens epoch 1', ok(r) && Number((await call(R, reg, 'epoch'))[0]) === 1);
check('dataset hash recorded', (await call(R, reg, 'datasetHash'))[0] === H);
check('empty methodology keeps the old one', (await call(R, reg, 'methodology'))[0] === 'nansen-v1');

r = await send(0, R, reg.encodeFunctionData('attest', [W, [800, 300, 950], [33, 0, 64]]));
check('batch attest succeeds', ok(r));
check('one Attested event per wallet', r.receipt.logs.length === 3);
let rep = await call(R, reg, 'reputationOf', [W[0]]);
check('reputationOf returns score, flags, time, epoch', Number(rep[0]) === 800 && Number(rep[1]) === 33 && BigInt(rep[2]) === NOW && Number(rep[3]) === 1);
check('walletCount counts new wallets', Number((await call(R, reg, 'walletCount'))[0]) === 3);
check('isTrusted: scored and above threshold', (await call(R, reg, 'isTrusted', [W[0], 700]))[0] === true);
check('isTrusted: below threshold', (await call(R, reg, 'isTrusted', [W[1], 700]))[0] === false);
check('isTrusted: insider is never trusted, whatever the score', (await call(R, reg, 'isTrusted', [W[2], 100]))[0] === false);
check('isTrusted: unknown wallet', (await call(R, reg, 'isTrusted', ['0x' + 'dd'.repeat(20), 0]))[0] === false);
check('hasFlag reads bits', (await call(R, reg, 'hasFlag', [W[0], 32]))[0] === true && (await call(R, reg, 'hasFlag', [W[0], 64]))[0] === false);

r = await send(0, R, reg.encodeFunctionData('attest', [[W[0]], [1001], [0]]));
check('score above 1000 reverts', reverted(r, 'ScoreOutOfRange'));
r = await send(0, R, reg.encodeFunctionData('attest', [[W[0], W[1]], [10], [0, 0]]));
check('length mismatch reverts', reverted(r, 'LengthMismatch'));
r = await send(0, R, reg.encodeFunctionData('attest', [['0x' + '00'.repeat(20)], [10], [0]]));
check('zero address reverts', reverted(r, 'ZeroAddress'));
r = await send(1, R, reg.encodeFunctionData('attest', [[W[0]], [10], [0]]));
check('non-attester cannot attest', reverted(r, 'NotAttester'));
r = await send(1, R, reg.encodeFunctionData('setAttester', [who[1].toString(), true]));
check('non-owner cannot add attesters', reverted(r, 'NotOwner'));

r = await send(0, R, reg.encodeFunctionData('setAttester', [who[1].toString(), true]));
check('owner adds an attester', ok(r));
NOW += 3600n;
r = await send(1, R, reg.encodeFunctionData('startEpoch', ['0x' + 'cd'.repeat(32), 'nansen-v2']));
r = await send(1, R, reg.encodeFunctionData('attest', [[W[0]], [500], [0]]));
rep = await call(R, reg, 'reputationOf', [W[0]]);
check('re-attesting overwrites score, time and epoch', ok(r) && Number(rep[0]) === 500 && BigInt(rep[2]) === NOW && Number(rep[3]) === 2);
check('re-attesting does not double-count wallets', Number((await call(R, reg, 'walletCount'))[0]) === 3);
check('new methodology stored', (await call(R, reg, 'methodology'))[0] === 'nansen-v2');
r = await send(0, R, reg.encodeFunctionData('setAttester', [who[1].toString(), false]));
r = await send(1, R, reg.encodeFunctionData('attest', [[W[0]], [10], [0]]));
check('revoked attester is locked out', reverted(r, 'NotAttester'));
r = await send(0, R, reg.encodeFunctionData('transferOwnership', ['0x' + '00'.repeat(20)]));
check('ownership cannot go to zero', reverted(r, 'ZeroAddress'));

// --- a real-sized publication batch: 200 wallets in one transaction
{
  const ws = Array.from({ length: 200 }, (_, i) => '0x' + (i + 1).toString(16).padStart(40, '0'));
  const r200 = await send(0, R, reg.encodeFunctionData('attest', [ws, ws.map((_, i) => i * 5 % 1001), ws.map(() => 33)]));
  const gas = Number(r200.totalGasSpent);
  check('a 200-wallet batch fits in one transaction', ok(r200) && gas < 10_000_000, `${(gas / 1e6).toFixed(2)}M gas`);
}

// --- the demo consumer
const cd = await send(0, undefined, '0x' + COL.bytecode + AbiCoder.defaultAbiCoder().encode(['address'], [R.toString()]).slice(2));
const C = cd.createdAddress;
check('collateral demo deploys against the registry', ok(cd) && !!C);
const bps = async (w) => Number((await call(C, col, 'collateralBps', [w]))[0]);
check('unknown wallet posts the 150% default', (await bps('0x' + 'ee'.repeat(20))) === 15000);
check('score 500 posts 130%', (await bps(W[0])) === 13000, String(await bps(W[0])));
check('score 300 posts 138%', (await bps(W[1])) === 13800, String(await bps(W[1])));
check('insider posts 200% despite a 950 score', (await bps(W[2])) === 20000);
check('maxBorrow follows the ratio', Number((await call(C, col, 'maxBorrow', [W[0], 13000]))[0]) === 10000);
NOW += 8n * 86400n;
check('a stale record falls back to 150%', (await bps(W[0])) === 15000);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
