# Prompt for ChatGPT (paste everything below the line)

---

You are taking over a Three.js project, "Monad Constellation": an orbital research station you can walk through, a hangar with a shuttle you fly to a 3D Monad token universe, and a research PC with live Nansen data. I will attach or paste the source files you ask for. Work like a senior graphics and gameplay engineer: audit first, then fix properly, verify, and report honestly.

## Project facts

- Stack: Next 15, React 19, three 0.186, TypeScript. Home page `/` is the station; `/galaxy` is the flight scene. Branch `main`, no git remote.
- Station layout is one straight line along +x: hangar bay (x −16.4…0.4, built in its own group rotated 90°) → glass walkway (0.4…2.8) → research room (2.8…11.2) → observation room (11.6…17.6). Mission control, hub, habitation and airlock were deleted. +x is the great window.
- Key files: `src/station/world/station.ts` (layout, collision `Space` = union of convex free-space volumes, `groundAt`), `src/station/world/pbr.ts` (PBR loaders and procedural maps), `src/station/world/envInterior.ts` (PMREM interior environment), `src/station/world/workstation.ts`, `src/station/features/{pc,hangar,travel,astronaut}.ts`, `src/station/modes/walker.ts` (walk/float movement), `src/station/engine.ts` (render loop, EffectComposer with sky pass, world pass and bloom), `src/components/shuttle.ts` and `src/station/world/shuttlePbr.ts` (spaceplane model and materials), `src/station/world/galaxyField.ts`, `src/lib/universes.ts` (five token universes).
- PBR: CC0 ambientCG 2K sets in `public/textures/` (brushed aluminium, carbon weave, painted metal, fabric weave, diamond plate, hangar floor, rubber). UVs are in metres via `scaleUV`/`tileUV`. Clone textures only after load (cloning before load leaves them empty).
- Movement: walk and float modes (M), first and third person (Tab), purple Monad astronaut, autopilot keys 1/2/3 between hangar, research room and observation room. Doors must overlap rooms by two body radii (player radius 0.32) or they are impassable.
- Hangar: parked shuttle on a cradle, hoses, RCS puffs, 16 s launch sequence (`STAGES`, `DONE_AT`), then navigates to `/galaxy?universe=<id>&fly=<addr>`; docking arrival via `?from=&sym=`.
- Research PC: a 1280×720 DOM terminal projected onto the 3D monitor's four corners each frame. Tabs: Overview, Smart Money (+ Time Machine), Alpha map, Token Checker (Token Score), Copy Lab (paper only), Token worlds, Wallets, Insider radar, Reputation. Monad only. Nansen credit costs apply (desk about 19 per 20 min; token check 15–18 each), so do not add polling.
- Testing notes: dev server on port 3301 (3300 is taken). The browser pane is software-rendered (about 14 fps), so real FPS must be judged from frame time in code, not that pane.
- Out of scope unless I say so: the Nansen data layer, token scoring, contracts, audio.

## Task

Do a full audit and overhaul of the space station in this Three.js game. It currently looks and feels bad, and I want it properly fixed, not patched.

1. Audit first. Before changing anything, go through every station area and list the problems: low-poly or placeholder geometry, gaps and seams between meshes, z-fighting, clipping, missing or broken animations, inconsistent scale, and flat or inconsistent materials and lighting. Show me the list.
2. Movement inside the station.
   * Replace or fix the current controls with smooth movement: acceleration and damping, delta-time based, no frame-rate dependence.
   * Add proper collision against walls, doors and props. Use a physics library like Rapier or cannon-es, or capsule-vs-mesh collision with `three-mesh-bvh`.
   * Add camera smoothing and head-bob only if it fits. There should be no jitter, no getting stuck in doorways, and no walking through geometry.
3. Shuttle and shuttle bay.
   * Rebuild the shuttle with real detail: hull panels, greebles, cockpit glass, engine nozzles with emissive glow, landing gear and lights. Load it as GLTF if you're modeling externally.
   * Redesign the shuttle bay so it makes physical sense, with docking clamps, an airlock, consoles, warning lights and enough clearance.
   * Redo the docking, launch and landing sequence as a logical, timed animation using `AnimationMixer` or GSAP: approach, align, clamp, pressurize, doors open, and the reverse for launch. Nothing should snap, pop or pass through geometry.
4. Visual quality and style.
   * Use `MeshStandardMaterial` or `MeshPhysicalMaterial` with PBR textures: normal, roughness and metalness maps.
   * Set up proper lighting with an environment map for reflections, shadows where they matter, and emissive panels and strip lights.
   * Add post-processing via `EffectComposer`: bloom for lights and engines, SSAO for depth, and tone mapping (ACES) with the correct sRGB output.
   * Unify the style across the station with consistent materials, signage, props and color palette.
   * Add ambient life: blinking lights, animated screens, moving machinery, and a space view through windows.
5. Performance. Keep it running at a stable 60 FPS. Use instancing for repeated props, merge static geometry, use LOD where needed, and dispose of unused resources.
6. Verify. Walk through every area afterwards and confirm there are no gaps, clipping, broken animations, movement issues or FPS drops left. Report what you changed and what's still pending.

Prioritize quality and coherence over speed. Don't cut corners.

## How to work with me

- Start by listing the files you need me to paste, in priority order, then do the audit (step 1) and wait for my OK before rewriting.
- Give complete replacement files, not fragments, and keep the existing exports and the `Station` / `Engine` interfaces unless you tell me what changes and why.
- Keep the research PC projection, universes, and the `/galaxy` handoff working; list anything you touch that they depend on.
- Say plainly what you could not verify. Do not claim 60 FPS without a measured frame-time budget.
