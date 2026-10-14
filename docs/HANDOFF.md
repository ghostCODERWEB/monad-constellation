# Handoff: Monad × Nansen Orbital Research Station

Paste everything below the line into a new Claude Code session opened in `~/Desktop/nansen`.

---

You're continuing work on **Monad Constellation**, a Next.js and Three.js project at `~/Desktop/nansen/monad-constellation`. It's a 3D Monad × Nansen experience: an orbital research station is the home page, and a galaxy of Monad tokens and wallets sits behind it. The user (Paul) wants it as visually impressive as possible and as deeply tied to Nansen data as possible. Deadlines don't matter.

Read these before changing anything:
- `docs/STATION_PLAN.md` holds the Phase 0 findings, the architecture, the provider and fallback table per panel, and the stage list.
- `README.md` covers the galaxy.
- The last three commits show the most recent work: `git log --oneline -5`.

## Run it
- The dev server is `npx next dev -p 3300`, run from `monad-constellation`. In the Claude desktop app it's the launch config **`constellation`** in `~/Desktop/nansen/.claude/launch.json`, so use the preview tools and never Bash to start it.
- Routes:
  - `/` is the station.
  - `/galaxy` is the Constellation, which accepts `?fly=<token address>`.
  - `/station` redirects to `/`.
- `.env.local` (gitignored) holds `NANSEN_API_KEY`, `MONAD_RPC_URL`, `NEXT_PUBLIC_SCOREBOARD_ADDRESS` and `NEXT_PUBLIC_CHAIN_ID`. Never print it or commit it.
- Checks: `npm run typecheck`, `npm test` (vitest) and `npm run contract:test` (36/36).
- Git: branch `main`, no remote. Commit with clear messages; don't push anywhere unless asked.

## Stack and rules
- Next 15 App Router, React 19 and three 0.186. Don't add dependencies without a strong reason.
- Everything is procedural: no model files, only canvas textures. The exception is the brand assets in `public/brand/`.
- Rules from the user's original spec, all binding:
  - **No fake functionality, Monad only, Nansen first.** Tag every value with its source.
  - Where data is missing, show an honest empty, "not connected" or demo state. Never fabricate.
  - **Financial safety:** research and paper trading only. Never execute real trades, connect a wallet, approve allowances or move funds. Never handle private keys or seed phrases.
  - API keys stay on the server, never in the client.
  - The player can always exit any mode (Esc), and input never goes to two modes at once.
  - Preserve existing features; make no destructive changes.

## Architecture (`src/station/`)
- **`engine.ts`**
  - Renderer and composer: the sky scene in km rendered first, then the station in metres, then bloom.
  - An exclusive **mode stack**: `walk`, `telescope`, `agent`, `pc`, `shuttle`. `setMode` exists, and Esc universally exits to walk.
  - `tickers`, `interactions`, `bodies`, a `log` (the mission log in localStorage) and `say()` toasts.
  - **`subject`/`setSubject()`** is the shared "what we're researching" (`{kind: token|wallet, address, label, source: telescope|pc|flight}`).
  - The `sfx` hook is optional and NOT implemented yet.
- **`core/`**
  - `input.ts`: keyboard, mouse and gamepad, with `suspend()` for DOM panels. When pointer lock fails in the embedded pane it falls back to drag-to-look.
  - `space.ts`: collision as a union of convex volumes.
  - `interact.ts`, `bodies.ts`, `log.ts`.
- **`world/`**
  - `station.ts` is the modules:
    - hub/mission control at the origin
    - research module at +x, with the workstation at (8.2, −0.25, −1.2)
    - observation module with the telescope
    - habitation at −x
    - airlock at +z
    - a **glass walkway tunnel** to the **hangar** at −z (box x±6, y±4, z −22 to −5.2, with doors at z −22)
  - The hub's south wall and the hangar's north wall are **glass galleries** (the `windowFace` helper).
  - `sky.ts`: Earth, Sun and Moon on an inertial frame, with one orbit every 20 min.
  - `cosmos.ts`: the telescope catalogue plus **Monad token worlds** from `/api/galaxy`, placed round the orbit pole so Earth never hides them.
  - `nansenMark.ts`: the official Nansen icon path and brand colours.
- **`modes/`**
  - `walker.ts`: 6DOF zero-g movement, rails, grab and throw.
  - `telescope.ts`: real angular sizes from 1× to 18000×, focus, tracking, solar filter, catalogue (C). A resolved token world sets the subject; **P** opens it on the PC and **B** plans a flight there.
- **`features/`**
  - `panel.ts` (`addPanelMode`: the camera glides to a view and the DOM panel owns input; `hotkey`).
  - `life.ts` (Easter eggs).
  - `hangar.ts`: the shuttle parked broadside behind glass. It is solid, and its board interaction opens the planner. The launch animation lifts the ship, turns it and flies it out; `/?from=<addr>&sym=<SYM>` plays the docking arrival with the player spawned at the hangar glass.
  - `robot.ts`: **NANSEN AI**, the green crew robot. The animated official mark (a GIF decoded with ImageDecoder, with a Path2D fallback) is on its chest and as a hologram. Its visor face blinks and talks, it's solid with station-keeping, and it greets you once.
  - `pc.ts`: the research PC.
- **`ui/`**
  - `HUD.tsx`: status, research-subject chip, dock buttons, help, mission log.
  - `TelescopeHUD.tsx`.
  - `AgentPanel.tsx`: the chat. It streams SSE from `/api/agent` and offers an "About $X" chip that comes from the subject. It shows credits charged and questions left today, and it renders markdown links (Monad token links get a "fly ➤" chip).
  - `ResearchPC.tsx`: a "Nansen Research Terminal" with tabs for token worlds, wallets, insider radar and reputation. It reuses the galaxy's `PlanetView`, `StarView` and `RegistryPanel` from `src/components/Dossier.tsx`, and has "Ask Nansen AI about this" (drafts but doesn't send) and "Fly there".
  - `ShuttlePanel.tsx`: the flight planner over every token world. It suggests the current subject first, marks worlds observed through the telescope, and its countdown leads to `/galaxy?fly=`.
- **Keys:** N robot, P PC, B shuttle, E use, Esc exit, L log, H help.

## Data and APIs (server routes in `src/app/api/`)
- `galaxy`: 28 planets and their stars; about 516 credits per build, cached 3h in `.cache/galaxy.json`.
- `token/[address]`, `wallet/[address]`: dossiers on select, cached 1h.
- `clusters` (insider radar, cached 24h), `timeline`, `block`, `reputation`, `onchain/[address]`.
- **`agent`**: a proxy to Nansen's Research Agent.
  - Calls `POST https://api.nansen.ai/api/v1/agent/fast` (200 credits) or `/expert` (750) with the `apikey` header. The response is SSE: `delta`, `tool_call`, `finish` (with `conversation_id`), `error`, then `[DONE]`.
  - It frames each question to Monad and adds the subject.
  - `AGENT_DAILY_CREDITS` (default 8000) is a per-process daily credit budget, priced per mode, with two questions in flight at most and cross-site calls refused (`src/lib/agentBudget.ts`).
  - The key needed the "account" permission, which it now has; the endpoint works.
- The Nansen client is `src/lib/nansen.ts`. Contracts live in `contracts/` (MonadReputation and ReputationCollateral); they're NOT deployed, because that needs the user's own key.

## Testing gotchas
- The user also uses the same browser pane and tab, and their key presses or navigation will change modes. Test in **your own tab** (`tabs_create`), and switch back afterwards.
- Background tabs throttle `requestAnimationFrame`, so animations and camera glides stall there. Front the tab briefly if you need motion.
- In development, React StrictMode mounts the station twice. Anything consumed once, like URL params, must be read once per page load (see `arrival()` in hangar.ts).
- `window.__station` is the engine in development: `setMode()`, `walker.pos`, `walker.quat`, `subject`.
- GLSL: `smoothstep` with edge0 > edge1 is undefined (it returns 0 on this GPU). Use the `ss()` helper from `NOISE` in `src/components/worlds.ts`.

## Your scope: only these four areas, all with photoreal detail
The user narrowed the work. Focus **only** on these, and leave everything else alone: airlock, EVA, habitation, the galaxy page, contracts and audio are all out of scope.

1. **Observation room (telescope):** the observation module and the telescope rig and console (`world/station.ts` observation section, `modes/telescope.ts`, `ui/TelescopeHUD.tsx`).
2. **Research room (PC):** the research module, the workstation desk and monitors (`world/station.ts` research section, `features/pc.ts`, `ui/ResearchPC.tsx`).
3. **Mission control (AI robot):** the hub and the NANSEN AI robot (`world/station.ts` hub section, `features/robot.ts`, `ui/AgentPanel.tsx`).
4. **Hangar (shuttle):** the hangar, the glass gallery and walkway, and the shuttle itself (`world/station.ts` tunnel and hangar sections, `features/hangar.ts`, `ui/ShuttlePanel.tsx`; the shuttle mesh is `src/components/shuttle.ts`, which the galaxy also uses, so don't break it there).

### The main goal: super detailed, real-life textures and materials
Everything in these four areas must look like real ISS hardware photographed in orbit, not like a game blockout. That means:

- **Full PBR on every surface:**
  - albedo, normal, roughness, metalness, plus AO where it helps
  - at least 2048px for large surfaces
  - correct texel density, so nothing looks stretched or blurry up close
- **Real ISS references for the hardware:**
  - beta-cloth/Nomex wall panels with quilting and stitching
  - velcro patches, cargo transfer bags, cable bundles and zip ties
  - handrails with worn paint, labelled rack fronts with screws and decals
  - scuffs and fingerprints
  - real-looking monitors with a bezel, screen glow and reflections
- **Robot:**
  - painted metal in Nansen green #00FFA7 / #09C385 with Dark #122927, clearcoat and micro-scratches
  - a glossy visor with reflections
  - panel seams, screws and a decal-quality logo (the official mark is in `public/brand/`)
- **Shuttle:**
  - spacecraft-grade materials: thermal tiles, MLI blanket foil, brushed metal, scorched engine bells
  - decals and panel lines
  - lit by the hangar, with believable reflections
- **Telescope:** anodised aluminium, a carbon-fibre tube, a matte black baffle, optics with coated-glass reflections and engraved scales.
- **Glass:** windows and the walkway are real glass, with thin reflections, slight tint and smudges.
- **Lighting that sells it:**
  - an environment map (PMREM, e.g. `RoomEnvironment` or a captured interior) so metals and glass reflect
  - soft shadows where cheap enough
  - tuned tone mapping and exposure
  - no overexposure (the scene has blown out before, so watch bloom and light intensities)

### How to get the textures
- **Option A (no assets):** high-resolution procedural PBR maps generated on canvas or in shaders. This extends `world/textures.ts`, which currently holds the simple canvas textures.
- **Option B (preferred if it looks clearly better):** CC0 PBR texture sets from **ambientCG** or **Poly Haven**, saved under `public/textures/`. Keep the total size reasonable, use compressed JPG/WebP and KTX2 if you add the loader, and credit the source in `README.md`.
- Downloading files needs the user's explicit OK, so ask once with the list of sets and their sizes.
- Don't add npm dependencies without a strong reason; three's own `examples/jsm` loaders are fine.
- Keep it running smoothly (60 fps on a laptop): reuse materials and textures, use mipmaps and anisotropy, and don't use dozens of shadow-casting lights.

### Keep working
- Interactions, modes, the shared subject, Nansen data, the robot chat, the PC terminal, the launch and docking.
- Verify visually after each area: screenshot each room in your own browser tab, at desktop width and up close.
- Commit after each area.

Before you start, confirm the dev server runs and `npm run typecheck` passes. Then begin with whichever of the four areas the user names, or with mission control and the robot if they don't say.
