// Deploys MonadReputation and the ReputationCollateral demo. Run it yourself;
// the key never leaves your shell.
//
//   DEPLOYER_KEY=0x... node deploy.mjs                     # Monad mainnet (143)
//   DEPLOYER_KEY=0x... NETWORK=testnet node deploy.mjs     # Monad testnet (10143)
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';
import fs from 'node:fs';

const NETS = {
  mainnet: { rpc: 'https://rpc.monad.xyz', chainId: 143, explorer: 'https://monadscan.com' },
  testnet: { rpc: 'https://testnet-rpc.monad.xyz', chainId: 10143, explorer: 'https://testnet.monadscan.com' },
};
const net = NETS[process.env.NETWORK ?? 'mainnet'];
if (!net) throw new Error('NETWORK must be mainnet or testnet');
if (!process.env.DEPLOYER_KEY) throw new Error('Set DEPLOYER_KEY in your shell for this one command.');

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./out/${n}.json`, import.meta.url)));
const provider = new JsonRpcProvider(net.rpc, net.chainId);
const wallet = new Wallet(process.env.DEPLOYER_KEY, provider);
console.log(`Deploying from ${wallet.address} to chain ${net.chainId}…`);

const R = load('MonadReputation');
const registry = await new ContractFactory(R.abi, R.bytecode, wallet).deploy('nansen-rep-v1');
await registry.waitForDeployment();
const reg = await registry.getAddress();
console.log('MonadReputation:      ', reg, `${net.explorer}/address/${reg}`);

const C = load('ReputationCollateral');
const demo = await new ContractFactory(C.abi, C.bytecode, wallet).deploy(reg);
await demo.waitForDeployment();
const col = await demo.getAddress();
console.log('ReputationCollateral: ', col, `${net.explorer}/address/${col}`);

console.log(`\nAdd to .env.local:\nNEXT_PUBLIC_REPUTATION_ADDRESS=${reg}\nNEXT_PUBLIC_COLLATERAL_ADDRESS=${col}\nNEXT_PUBLIC_REPUTATION_CHAIN=${net.chainId}`);
console.log(`\nThen publish scores:\nATTESTER_KEY=0x... REGISTRY=${reg}${process.env.NETWORK === 'testnet' ? ' NETWORK=testnet' : ''} node publish.mjs`);
