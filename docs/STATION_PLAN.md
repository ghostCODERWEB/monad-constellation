# Monad × Nansen Orbital Research Station: implementation plan

## Phase 0 findings

**Engine and stack.** Next.js 15 (App Router) + Three.js 0.18x, no game engine, no physics engine,
no asset pipeline: every visual is procedural (shaders, canvas textures, primitives). Post-processing
is EffectComposer + UnrealBloom; labels are CSS2D. One scene component (`GalaxyScene.tsx`) owns the
renderer, an imperative handle carries commands from React, and React owns all HUD. The existing
flight controls are keyboard + mouse drag; there is no gamepad support today (the station adds it,
through one input layer, without changing the galaxy's controls).

**Existing features to preserve.** `/` is the galaxy: worlds, stars, moons, shuttle flight and
expeditions, deep dossiers, insider radar, 24h replay, heartbeat, reputation registry. None of its files
are restructured; the station is added beside it at `/station`, and the two link to each other (the
shuttle's long-range destination is the Constellation itself).

**Nansen client.** `src/lib/nansen.ts` is this project's single Nansen client (POST helper with metered
credits, TTL cache, in-flight de-dup). Peregrine's client is bound to Peregrine's database, credit
ledger and x402 payment layer, so importing it would pull those in; its *logic* is ported instead:
`src/lib/rug.ts`'s six-check report (liquidity, concentration, insider clusters, age, sell pressure,
Nansen risk) with its thresholds and "a failed check is never hidden" rule.

**Nansen on Monad** (measured in this project and in MONAD GOD MODE's coverage sweep): works:
token-screener, tgm/token-information, tgm/indicators, tgm/token-ohlcv, tgm/holders, tgm/flow-intelligence,
tgm/who-bought-sold, tgm/dex-trades, tgm/transfers, tgm/pnl-leaderboard, smart-money/holdings,
smart-money/dex-trades, profiler current-balance, historical-balances, counterparties, related-wallets,
transactions, pnl, pnl-summary, search/general. Rejects Monad: profiler/address/first-funder,
v1beta1 historical endpoints. Empty on Monad: smart-money/netflow. Most memecoins have no holder list.

**Sponsors and others, checked for Monad.**

| Provider | Monad | Key | Use here |
| --- | --- | --- | --- |
| Kuru | yes (on-chain CLOB, public REST + getL2Book) | none | order-book price, depth, slippage for paper fills |
| Perpl | yes (public context API) | none | perps panel in telemetry |
| Chainlink | yes (102 feeds, latestRoundData) | none | independent MON/USD and major prices |
| Monad RPC (public endpoint) | yes | none | block height/time, bytecode, supply, eth_simulateV1 (honeypot/sell sim), deployer bisection |
| BlockVision | yes (Monad Indexing API) | needed | holders and account tokens when Nansen is empty |
| Zerion | yes (Monad positions/transactions) | needed | wallet portfolio fallback |
| Envio HyperSync | yes (monad.hypersync.xyz) | needed | indexed transfers, deployer history |
| Tenderly | Monad supported; simulation API not confirmed | needed | not used: paper fills use Kuru depth and RPC simulation instead |
| DexScreener / GeckoTerminal | yes | none | **other API**, used last: price, pairs and liquidity for fresh memecoins that Nansen and Kuru do not list, and no keyless sponsor covers |

Configured today: Nansen and the Monad RPC. BlockVision, Zerion and Envio adapters report
"not connected" until `BLOCKVISION_API_KEY`, `ZERION_API_KEY`, `ENVIO_API_TOKEN` are set.

## Architecture

```
src/app/station/page.tsx            the station route (client)
src/station/core/                   input (mode stack, keyboard/mouse/gamepad), interaction registry,
                                    collision volumes, floating-body physics, audio (WebAudio, procedural),
                                    mission log (persisted)
src/station/world/                  station modules and props, Earth/Moon/Sun sky, telescope targets
src/station/modes/                  zero-g walker, telescope, workstation, airlock + EVA, shuttle pilot
src/station/ui/                     HUDs and the workstation desktop (apps A, B, C)
src/lib/providers/                  one adapter per provider; every value is Sourced<T> {value, source, at}
src/app/api/research/*              backend proxy: keys stay server-side, Monad only, cached
```

**Modes** are exclusive: the input layer routes events to exactly one active mode; every mode
exits with Esc or E back to zero-g movement.

## Panels: provider, endpoint, fallback

| Panel | Primary | Fallback order |
| --- | --- | --- |
| Token search | Nansen search/general (chain monad) + token-screener | GeckoTerminal search (Monad network) |
| Price history | Nansen tgm/token-ohlcv | GeckoTerminal OHLCV |
| Liquidity / pairs | Nansen screener liquidity | Kuru markets, then DexScreener pairs (shown side by side when they disagree) |
| Holders + labels | Nansen tgm/holders | BlockVision token holders (labelled "BlockVision, no Nansen labels"), then RPC transfer-log sample |
| Flows | Nansen tgm/flow-intelligence | none (honest empty state) |
| Notable transfers | Nansen tgm/transfers | Envio HyperSync, then RPC getLogs (100-block window) |
| Wallet labels | Nansen (holders/trades labels, related-wallets) | none: unlabeled shown as unlabeled |
| Wallet holdings | Nansen profiler current-balance | Zerion positions, then BlockVision account tokens |
| Wallet history | Nansen profiler transactions | Envio, then explorer link |
| Smart money | Nansen smart-money/holdings + dex-trades | none |
| Rug checker | Peregrine's six checks on Nansen data | on-chain: RPC sell simulation, deployer, LP lock, Kuru depth, DexScreener liquidity |
| Copy lab PnL | Nansen pnl-summary, pnl, pnl-leaderboard | Zerion PnL |
| Paper fills | Kuru order book (depth-walked) | Chainlink feed for majors, then Nansen price |
| Telemetry | Monad RPC (block, block time) | Nansen screener totals, Perpl context |

## Credits

Every research route goes through the existing TTL cache plus a per-route disk cache; token reports
5 min, wallets 15 min, smart money 10 min, search 10 min. The workstation only calls on explicit
user action, never on hover or idle.

## Stages

1. Interaction system + station interior · 2. Zero-g + floating physics · 3. Telescope ·
4. Living details, audio, Easter eggs · 5. Desktop shell + data layer · 6. Intelligence app ·
7. Rug checker · 8. Copy lab + paper trading · 9. Airlock + EVA · 10. Shuttle · 11. Testing.
