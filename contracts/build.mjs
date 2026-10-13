// Compiles MonadReputation and ReputationCollateral into out/*.json (ABI + bytecode).
import solc from 'solc';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('./MonadReputation.sol', import.meta.url), 'utf8');
const out = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'MonadReputation.sol': { content: src } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
})));
const errs = (out.errors || []).filter((e) => e.severity === 'error');
const warns = (out.errors || []).filter((e) => e.severity === 'warning');
console.log('errors:', errs.length, '| warnings:', warns.length);
[...errs, ...warns].forEach((e) => console.log(' ', e.formattedMessage.split('\n')[0]));
if (errs.length) process.exit(1);
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
for (const name of ['MonadReputation', 'ReputationCollateral']) {
  const c = out.contracts['MonadReputation.sol'][name];
  console.log(`${name}: ${c.evm.deployedBytecode.object.length / 2} bytes`);
  fs.writeFileSync(new URL(`./out/${name}.json`, import.meta.url), JSON.stringify({ abi: c.abi, bytecode: c.evm.bytecode.object }, null, 1));
}
