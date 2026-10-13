# MONAD CONSTELLATION

**Every Monad wallet a star. Every token a world. Built from Nansen, written back to Monad.**

A living 3D galaxy of the Monad economy. Fly a shuttle through it, land on its worlds, watch the
last 24 hours replay as beams of money, see insiders tied together in red, and read a reputation
score for every wallet that any Monad contract can query on chain.

---

## What is in the galaxy

| You see | It is | Nansen source |
| --- | --- | --- |
| **The sun** | MON, the chain's native asset; it lights every world | — |
| **Worlds** | The day's most traded Monad tokens and everything smart money holds (28) | `token-screener` 24h and 7d, `smart-money/holdings`, `tgm/indicators` |
| **Stars** | 2,600+ wallets orbiting the token they are most tied to; brightness is proven profit | `tgm/holders`, `tgm/pnl-leaderboard`, `tgm/who-bought-sold`, `smart-money/dex-trades` |
| **Moons** | Each world's biggest real holders, sized by share of supply | `tgm/holders` |
| **Comets** | Wallet-to-wallet transfers | `tgm/transfers` |
| **Red tethers** | Insider clusters: top holders funded by one wallet | `profiler/address/related-wallets` |
| **Beams** | The last 24 hours of trades, replayed | `tgm/dex-trades` |

### Worlds are made of numbers

Every feature of a world is a reading of its token, explained in the planet's *World survey*:

| Feature | Data |
| --- | --- |
| Ocean coverage | Liquidity: $1k is a desert, $10M a water world |
| Weather | The day's net flow: inflow clears the skies, outflow brings storms |
| City lights on the night side | Holders plus today's traders |
| Volcanic world | Down 40%+ on the week and not established, or flagged by Nansen |
| Ice world | A staked form of MON |
| Golden world with rings | Held by Nansen's smart money cohort |
| Temperate world | An established asset (Nansen large or mid cap, or $10M+) |

Terrain is domain-warped noise with relief, ocean glints and polar ice; the atmosphere is ray-marched,
so it is a glowing limb from space and a blue or dusk-orange sky from inside.

## Things to do

- **Fly** (`F`): W/S thrust, A/D turn, arrows pitch and roll, Shift boost, Space brake, drag to steer.
  Speed scales with clearance: fast between worlds, careful near them.
- **Land on a world:** fly low and the ship levels to the horizon; the expedition panel reads altitude,
  local time, oceans, settlements and weather.
- **Scan** (`R` in flight, or click): a wallet dossier calls seven profiler endpoints: balances, a 30-day
  portfolio chart, counterparties, related wallets, transactions, PnL summary, PnL by token.
  Counterparties and funders that are also stars are drawn as lines in the galaxy.
- **Insider radar:** every cluster, its evidence and its members. A shared funder is a signal, not proof.
- **Replay** (`P`): the last 24 hours as green and red beams, a timeline you can seek by hour, a ticker
  of notable traders, and a live block counter with a pulse ring from the sun on every Monad block.
- **Reputation registry:** the leaderboard, the methodology and the contract.

`H` returns to the whole galaxy; `Esc` closes a panel.

## Reputation on Monad

Each wallet gets a 0–1000 score, methodology `nansen-rep-v1` (`src/lib/reputation.ts`):

| Part | Points | From |
| --- | --- | --- |
| Base | 100 | |
| Proven profit | −150 … +400 | realised + open PnL, log-scaled (`tgm/pnl-leaderboard`) |
| Nansen labels | 0 … 250 | smart trader 250, fund 200, active trader 110, named 90, whale 70 |
| Breadth | 0 … 100 | tokens held or traded beyond the first |
| Size | 0 … 150 | holdings plus today's volume, log-scaled |
| Insider | −300 / −200 | member of an insider cluster / the funder of one |

Contracts, pools, routers and exchanges are infrastructure, not people, and are not scored.

**`contracts/MonadReputation.sol`** stores `score`, `flags` (smart, fund, whale, named, trader,
profitable, insider, funder), `updatedAt` and `epoch` per wallet. Attesters open an epoch with the
keccak256 of the dataset and publish in batches (a 200-wallet batch is 5.5M gas, so the whole set is
about 13 transactions on Monad). Any contract can call:

```solidity
function reputationOf(address wallet) external view returns (uint16 score, uint16 flags, uint40 updatedAt, uint32 epoch);
function isTrusted(address wallet, uint16 minScore) external view returns (bool); // never true for insiders
```

**`ReputationCollateral`** is the demo consumer: a lending market pricing collateral from reputation,
110% for the best wallets, 150% for unknown or stale ones, 200% for insiders. It holds no funds.

**36 of 36 behavioural tests pass** on a real EVM: `cd contracts && npm install && npm test`.

### Deploy and publish (with your own key)

```bash
cd contracts && npm install && npm run build
DEPLOYER_KEY=0x... NETWORK=testnet node deploy.mjs
# put the two printed addresses in .env.local, then with the dev server running:
ATTESTER_KEY=0x... REGISTRY=0x... NETWORK=testnet node publish.mjs
```

Wallet dossiers then show the score Monad holds and the collateral the demo would ask.

## Run

```bash
npm install
cp .env.example .env.local   # NANSEN_API_KEY
npm run dev                  # http://localhost:3300
```

## Nansen usage and cost

Sixteen endpoints. Everything is cached on disk under `.cache/`, so a restart costs nothing:

| Build | Credits | Cached |
| --- | --- | --- |
| Galaxy (9 endpoints × 28 worlds) | ~520 | 3 hours |
| Insider clusters (first funders of top holders) | ~290 first time, then 0 | 24 hours per wallet |
| 24h replay (largest trades per 3-hour slice for busy tokens) | ~85 | 1 hour |
| Wallet dossier (7 profiler endpoints) | ~11–16 | 1 hour, on selection only |
| Token dossier (information + OHLCV) | 2 | 1 hour |

## Stack

Next.js 15 and Three.js, no game engine: GPU-animated orbits for every star, procedural shaders for
the sun, terrain, clouds and atmosphere, CSS2D labels, bloom. Contracts in Solidity 0.8.24, compiled
with solc-js and tested on @ethereumjs/vm.
