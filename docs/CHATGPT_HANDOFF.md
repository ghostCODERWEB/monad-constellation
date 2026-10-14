# Handoff prompt for ChatGPT (paste everything below the line)

---

You are taking over a Three.js project, "Monad Constellation", mid-task. You have not seen it before, so read this fully. I will paste the source files you ask for. Work like a senior graphics engineer: look at the real code, make a plan, then give complete replacement files. Say plainly what you could not verify.

## 1. What the project is

A browser game and research tool for the Monad blockchain, built with Nansen data. Stack: Next 15, React 19, three 0.186, TypeScript, repo at `~/Desktop/nansen/monad-constellation` (branch `main`, no remote, dev server on port 3301).

- `/` is an orbital research station you walk through (first or third person, a purple Monad astronaut avatar).
- You fly a shuttle from the station's hangar to `/galaxy`, a 3D "universe" of Monad tokens in five categories (Majors, RWA, Memecoins, Stablecoins, DeFi). The shuttle model is shared by both pages.
- The research PC in the station is a DOM terminal (Overview, Smart Money, Alpha map, Token Checker, Copy Lab) projected onto a 3D monitor. Do not touch it or the data layer (`src/lib/*`, `src/app/api/*`).

## 2. Station layout (one straight line along +x)

hangar bay (x −16.4…0.4) → glass walkway (0.4…2.8) → research room (2.8…11.2) → observation room (11.6…17.6). +x is the great window, with the Monad universe visible beyond it.

Key files:
- `src/station/engine.ts`: renderer, EffectComposer (sky pass, world pass, GTAO, bloom, output), sun shadow map, adaptive quality (`?q=0..3` pins it), per-frame loop.
- `src/station/world/station.ts`: builds all rooms. `mergeStatic.ts` merges static meshes per material at the end of the build. `core/space.ts` is collision: a union of convex free-space volumes plus `props` boxes.
- `src/station/modes/walker.ts`: walk and float movement. `features/astronaut.ts`: avatar. `features/travel.ts`: autopilot keys 1, 2, 3.
- `src/station/features/hangar.ts`: the parked shuttle, cradle, umbilical hoses, RCS puffs, launch sequence, docking arrival.
- `src/components/shuttle.ts`: the procedural shuttle model, used by the hangar and by `GalaxyScene.tsx`. `src/station/world/shuttlePbr.ts`: its textures and materials, all procedural canvases.
- `src/station/ui/ShuttlePanel.tsx`: flight planner. When the launch sequence completes it navigates to `/galaxy?universe=<id>&fly=<address>`. Coming back, the station opens with `/?from=<address>&sym=<symbol>`, which triggers the docking arrival.
- PBR textures are CC0 ambientCG 2K sets in `public/textures/`, loaded via `src/station/world/pbr.ts` (`pbrSet`, `scaleUV`, `tileUV`). Clone textures only after they load.

Coordinates in the hangar: the bay is built in its own group and rotated 90°. Bay (x, z) maps to world (z + 5.6, −x). The bay is x ±6 wide, y ±4 high, z from −22 (doors) to −5.2 (the wall with the walkway doorway). A diamond-plate gangway ramp (1.3 m wide, on the centreline, world x from 0.4 down to −6.9, i.e. bay z −5.2 down to −12.5) takes the player from the walkway sill to the deck. Floor heights come from `station.groundAt(x, z)`.

## 3. What was already done (do not redo)

- PBR pass on the four areas; the station layout; the astronaut and walk/float modes; telescope with autofocus; five universes.
- Overhaul pass (latest commit): static meshes merged (427 → 34), prop collisions (workstation, telescope, console, robot), sun shadows plus GTAO, adaptive quality, head-bob, full GPU dispose, and a staged 14 s docking sequence (approach, align, clamp lamps red→amber→green, umbilicals, doors close, pressurised).

## 4. The open task: the shuttle, the bay and the arrival look fake

The user's complaints, verbatim in spirit:
1. "The shuttle is low quality. The text on it is not visible and the model is too weak. I need it to look real."
2. "The bay and the arriving must be real-life like, not this random spinning in the air."
3. "I see it appear inside, then it spins 180 and I see it from behind." (The current arrival flies in nose-first, then swings 180° in mid-air to park broadside, which shows the tail and looks arbitrary.)
4. "And it appears on top of the steps." (The player is placed at the top of the gangway during arrival, so the first thing seen is the ship popping up in front of them.)

What is wrong in the code today:
- `src/components/shuttle.ts`: the fuselage is a round `LatheGeometry` squashed to 0.72 height, so it looks like a cigar. The wings are flat lofted deltas with a thin look, one fin, no body flap, no landing gear, a small dome canopy, and no real windows. The ship is about 1.7 model units long and the hangar scales it to 10.5 m.
- `src/station/world/shuttlePbr.ts` `hullMaterial()`: one 2048 × 4096 canvas wrapped round the tube. The "MONAD" decal is only 170 px tall in a 4096 px texture, so it is tiny and unreadable. Panel lines, tiles and rivets are drawn, but at a density that reads as flat white. The wing tile repeats 3×3 over the whole wing, so wings look blank and overexposed.
- `hangar.ts`: the hull is parked broadside, floating about 2.3 m above the cradle on four struts with rubber pads. There are no landing gear, so it looks posed in the air. The arrival flies in nose-first along the bay axis, then rotates 180° in the air to broadside (rotation.y from π to −π/2), lowering at the same time.

## 5. What I want (design decisions already thought through)

**A. A real-looking shuttle** (keep the exported `Shuttle` interface in `shuttle.ts` so `GalaxyScene.tsx` keeps working: `group, nozzles, engineMats, plumes, blinkers, light, rcs, setControl, applyMaterials`, nose along −Z, similar overall size; add `setGear(k: 0..1)` and a `gearDrop` value):
- A proper orbiter-like fuselage: a custom lofted body with superellipse cross-sections that change along the length, a blunt rounded nose, a raised cockpit hump, a flat belly, square payload-bay shoulders. Not a lathe.
- Real cockpit windows (six panes: two windscreens, two side, two overhead) built as glass patches that follow the hull surface, with dark frames.
- A double-delta wing (strake plus main panel, real proportions, wingspan about 0.7 of the length), elevons that move, a tall swept fin with a rudder, a body flap under the three engines, OMS pods, three engine bells with emissive cores.
- Landing gear: a nose gear and two main gears with struts, tyres and gear doors, that extend and retract.
- Textures: rewrite the hull texture for the new surface mapping, with huge readable livery (large "MONAD" along both flanks, a Nansen roundel, "NX-1001", wing-top marking, tail marking) at 4096 resolution, dark windows, black heat tiles on the belly and wing undersides, real panel lines, and correct roughness. Wing textures must not look like blank white plastic. Check exposure under the bay's lights.

**B. A real parking and arrival**
- Park nose-in, aligned with the bay axis, on its own landing gear on a marked parking stand, with wheel chocks. No struts, no floating. The player at the gangway sees the nose, windscreens and the large livery head-on.
- It must not block the gangway: the ramp ends on the centreline at bay z −12.5. Park offset to bay x ≈ +2.4 (right of the ramp), with the hull centred around z ≈ −16.5 and the nose about 4 m beyond the ramp end, wings clear of the wall (the bay is 12 m wide). Size the ship to about 8.4–9 m long.
- Arrival: it flies in through the open doors nose-first and keeps that heading all the way, with no yawing in the air. It decelerates along the axis, flares nose-up slightly, extends its gear, hovers over the stand on RCS pulses, lowers onto its wheels, settles on the suspension, then clamps and umbilicals connect, doors close, bay pressurises. The camera and the player are placed at a sensible spot (not popping up on top of the steps), looking at the doors, before it arrives.
- Launch (the reverse): umbilicals release, clamps release, gear retracts only after liftoff, the doors open, it backs out tail-first slowly on RCS and retro thrust like a pushback until clear of the doors, turns with RCS outside, then fires the main engines. Total about 16 s, and `hangar.stage()` must keep returning labelled stages for the planner UI.
- Update the collision capsule in `hangar.ts` (the hull is solid; it currently assumes a broadside hull along world z and must follow the new axis, world x), the panel camera framing (`eyeLocal`/`aimLocal`), the interaction points ("board the shuttle"), the cradle/platform, `groundAt` for the stand, and the ground-support panel and hose ports so the umbilicals reach the new ship.

**C. The bay itself** should read as a real hangar: a marked parking stand with a painted outline and numbers, tow-bar and chocks, a tug or service cart as set dressing, a status board whose text is readable, working door lights and a beacon, and hazard markings at the door threshold. Keep it clutter-free and consistent with the existing PBR style.

## 6. Constraints

- The Browser preview is software-rendered and slow, and stops animating when hidden. Use `?q=0` to speed up tests; use `127.0.0.1:3301` if WebGL gets blocked on `localhost`.
- Keep performance healthy: the interior is merged by `mergeStatic.ts`, but anything the hangar feature adds later (the ship, hoses, clamps, stand) is not. Do not add hundreds of separate meshes; instance or merge the static parts.
- Any decal or label must be legible at the distance seen from the gangway (about 8–12 m). Verify with a screenshot at that distance, not just by reading code.
- Report honestly: what you changed, what you verified in the browser, and what is still pending.

## 7. How to start

First list the files you need pasted, in priority order (I expect: `components/shuttle.ts`, `station/world/shuttlePbr.ts`, `station/features/hangar.ts`, the hangar section of `station/world/station.ts` lines ~500–720, `station/ui/ShuttlePanel.tsx`, and the shuttle-related parts of `components/GalaxyScene.tsx`). Then give a short plan and wait for my OK before rewriting.
