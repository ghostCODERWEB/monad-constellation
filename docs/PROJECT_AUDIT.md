# Monad Constellation — engineering and product audit

Date: 14 October 2026. Scope: local working tree, including the uncommitted cockpit/repair work. This is a source-level audit with build and test evidence, not a penetration test, financial-model validation, or completed visual acceptance test.

## Verdict

An ambitious interactive research prototype, not yet a dependable flight experience or production-grade research product. The strongest asset is the station-to-data-world concept. The weakest habit is treating a visual metaphor, a comment, or a successful compile as proof that the underlying feature works.

The shuttle has a flight computer costume; its instruments are static. The arrival has an orbit label; its physics does not maintain an orbit. The token worlds have confident weather reports even when the underlying flow value is missing. This is how a promising demo becomes an unreliable product: presentation outruns truth.

## Verification and limits

- `npm run build`: passed on the current code after the repair pass. Next reports `/galaxy` at 303 kB first-load JS; this is not the full runtime asset/GPU footprint.
- `npm run typecheck`: passed.
- `npm test`: 4 passed, all in `src/lib/flight.test.ts`. These test destination/phase helpers, not WebGL, keyboard dispatch, or a complete trip.
- `npm run contract:test`: 36 passed against the existing compiled contract artifacts. Contracts were not freshly rebuilt in this audit; this is not an independent security review.
- `git diff --check`: passed.
- Production preview was started on port 3301. Browser inspection reached the station loading screen, but subsequent inspection lost its tab binding. No fresh complete cockpit/launch/return screenshot or frame-time measurement was obtained. Earlier user screenshots establish prior problems, not proof that the current build still renders identically.
- No paid-agent requests, deployment, publication, or contract transactions were performed for this audit.
- Existing untracked handoff/prompt documents were preserved. Current source changes remain uncommitted.

## Repairs made before this audit

The preceding repair pass corrected reversed-edge shader `smoothstep` calls; restored the sixth cockpit pane; moved instrument screens in front of their bezels; adjusted wheel contact height; removed idle engine-light glow at zero thrust; reduced cockpit near clipping; cleared flight input on blur/visibility changes; corrected approach velocity sampling; removed duplicate thrust updates; added a single-owner launch Escape path; prevented free-flight/unknown destinations from waiting forever for an approach; cleared obsolete transition state on universe changes; and added cockpit return/docking routing for free flight.

These changes compile and the helper tests pass. They still need end-to-end visual acceptance. Some were defects in the newly added cockpit work itself; they are not all inherited bugs.

## P1 — fix before presenting this as reliable

### 1. Paid-agent protection is a process counter, not a spending boundary

`src/app/api/agent/route.ts:16–55`: `day` and `asked` live in process memory. Restarting or scaling creates a fresh allowance; callers do not authenticate here; fast and expert calls consume one identical counter slot despite different configured costs. A failed request spanning midnight can decrement the next day's counter.

Fix: authenticated access, per-user throttling, shared atomic daily credit reservations, concurrency limits, and usage reconciliation. Verify deployment-level controls before public exposure. The server-side key handling is good; it does not make the endpoint abuse-resistant.

### 2. “Ring” detection does not detect rings

`src/lib/clusters.ts:140–163`: union-find groups connected transfer participants. A single A→B transfer can qualify; there is no directed-cycle requirement. Calling every connected component a trading ring materially overstates what the algorithm establishes.

Fix: call them transfer-connected groups, or implement and test an actual cycle criterion. Include sample window, coverage, and evidence. Do not imply coordination from connectivity alone.

### 3. Heuristics become wallet character judgments

`src/lib/reputation.ts:35–67`: shared-funder and transfer clusters produce insider flags, large penalties, and labels such as Trusted/Proven. Shared funding is evidence of a relationship, not proof of misconduct. Classification errors propagate beyond the visualization into publishable reputation.

Fix: separate observed relationships from inferred risk; preserve uncertainty and coverage; explain labels; calibrate before representing these scores as trust. Add review and correction paths before on-chain use.

### 4. Missing data is dressed up as measured reality

`src/lib/worldStyle.ts:85–108`: missing liquidity becomes 1, then "$1 of liquidity"; missing net flow becomes zero, then "flows were quiet". A fallback biome claims a token is young and Monad-native without checking age or origin.

Fix: keep visual defaults but label unavailable evidence explicitly. Unknown must remain unknown in every tooltip and dossier.

### 5. Risk-score edge cases contradict the model's explanation

`src/lib/tokenScore.ts`: `normalizedHhi([1])` returns 0 despite the comment saying a single holder should read 1. `windShearScore` decreases as smart-money selling grows with fresh buying held constant, although the UI describes that joint pattern as risk. These need explicit mathematical specifications and fixtures, not aesthetic tuning.

Fix: document intended monotonic behavior and input population; test zero, one-holder, partial samples, missing values, and extreme flows. Changing weights alone is not validation.

### 6. Token symbols influence risk discounts

`src/lib/tokenScore.ts:sizeFactor`: names matching major wrapped assets receive a risk multiplier. A symbol is not verified identity. The stablecoin verdict also returns before considering failed checks.

Fix: use verified chain/address classification. Separate asset category from risk verdict. Test a spoofed symbol and a stablecoin with failing checks.

### 7. “Orbit” is not an orbital mode

`src/components/GalaxyScene.tsx:856–887`: the approach ends with tangent velocity, then ordinary drag/steering takes over. There is no orbit hold or orbital integrator. The page labels the completed state `orbit` regardless.

Fix: implement an explicit assisted orbit mode with target/radius/exit controls, or honestly call this free flight near a world. A tangent vector is not an orbit.

### 8. Cinematic duration depends on frame rate

`src/station/engine.ts:193`, `src/components/GalaxyScene.tsx:1053`, `src/station/features/hangar.ts:241`: simulation delta is capped at 50 ms, and cinematics accumulate that delta. At 14 fps, one real second advances at most about 0.7 simulation seconds. A launch multiplier hides the symptom on one machine, not the timing defect.

Fix: wall-clock cinematic timelines, bounded physics steps, and a stated hidden-tab policy. Test durations at throttled frame rates. Keep Esc available throughout.

### 9. Galaxy GPU ownership is incomplete

`src/components/GalaxyScene.tsx:1278–1295`: cleanup disposes renderer/composer/controls, but does not explicitly release the scene's geometries, materials, textures and every owned render target. Universe changes rebuild the scene, amplifying the risk.

Fix: explicit ownership/disposal with deduplication for shared assets, including replaced/removed resources. Verify memory plateaus across repeated universe changes; do not claim a measured leak size yet.

### 10. Async materials can outlive their scene

`src/components/GalaxyScene.tsx:745`: the dynamic material import has no disposed-generation guard and silently swallows failure. It can generate expensive textures and apply them after navigation teardown.

Fix: guard stale completions, release abandoned assets, expose recoverable loading failures, and avoid recreating identical procedural assets unnecessarily.

### 11. Renderer failure has no useful recovery path

`src/station/StationView.tsx:14`: engine construction/setup is unguarded here. Unsupported/lost WebGL needs a deliberate fallback, not a permanently loading or crashed experience.

Fix: initialization error UI, context-lost/restored policy, retry, and a lightweight research access path independent of the 3D station.

## P2 — core experience and engineering debt

12. **Cockpit instruments are decorative.** `src/components/shuttle.ts:196,296` paints static NAV/RCS/CLAMPS text. Bind live telemetry, target, phase and faults; redraw only when values change. The dashboard currently performs aviation rather than assisting the pilot.

13. **Boarding is a camera mode, not a completed hatch sequence.** `src/station/features/hangar.ts:277` glides the camera to cockpit anchors. Distinguish wall planning, walking to the hatch, boarding, seating, and launching. Keep a quick-board option for repeat visits.

14. **The cockpit is not a properly modeled interior shell.** Exterior front-face culling is not a substitute for window openings, wall thickness, trim and a clean camera envelope. Inspect from inside and outside with bloom disabled. Validate every pane and bulkhead against clipping.

15. **Livery placement needs geometry-based verification.** `src/components/shuttle.ts:316` still places flank decals at ±0.298 despite the remodeled hull. Treat burial/intersection as a concrete inspection target, not a verified current screenshot result. Fit decals to the surface and validate at actual gangway distance; 4096-pixel texture size alone proves nothing about readability.

16. **Exhaust effects remain partial.** The new shader and ignition lighting are a start, not the requested complete heat shimmer/smoke/RCS system. The plume's cone UV treatment needs inspection; “radial” UV is not necessarily physical radius. Set explicit thermal/ignition states and verify zero main burn inside the hangar.

17. **Universe traversal is a portal scene swap.** `GalaxyScene.tsx:908` triggers on spherical proximity, then the page recreates the scene. It does permit menu-free travel, but does not preserve a continuous flight frame. Use ring-plane crossing, a preload corridor, and retained velocity/orientation with safe destination placement.

18. **Return is still a route handoff.** `src/app/galaxy/page.tsx:184` navigates the page; the new docking view does not create a complete reverse warp/approach ride. Preserve destination/context and implement a defined return transition rather than selling a URL change as a seamless journey.

19. **Travel state is scattered.** React phase state, URL flags, imperative scene state, station modes and module-level arrival caching all participate. Replace this with a typed travel state machine and centralized URL serialization. Define every abort, skip, re-entry and reload transition.

20. **Travel links do not share one contract.** `src/station/ui/AgentPanel.tsx:39` emits only `?fly=`, while shuttle launch includes flight/cockpit/arrival flags. Decide whether links mean inspect, autopilot, or launch and use a shared helper. Do not make identical “fly” copy mean different experiences.

21. **Search results can arrive out of order.** `src/station/ui/desk/Checker.tsx:79–89` cancels the debounce timer but not an already-started fetch; an older query can overwrite a newer result. Add cancellation plus generation checks, including clear-query handling.

22. **Ancillary requests run whether their UI is wanted or not.** `src/app/galaxy/page.tsx:78–80` fetches clusters, timeline and reputation after each universe load. Lazy-load these by feature use, share requests and cancel obsolete ones. Quantify cost before claiming this is cheap.

23. **Search always reaches upstream for longer queries.** `src/app/api/search/route.ts` makes an upstream call for two or more characters even when local results suffice. Add bounded queries, request deduplication, a sensible fallback policy and server-side rate protection. Its comment calls the endpoint free; this audit did not verify current provider pricing.

24. **Cache TTL is not cache capacity management.** `src/lib/nansen.ts:30–44` retains entries in an unbounded Map; expiry is checked only on access. Add maximum size, eviction and metrics. In-flight deduplication is useful but process-local, not deployment-wide.

25. **Disk persistence is best effort and non-atomic.** `src/lib/profile.ts:44–52` and cluster caches write JSON directly and suppress write errors. Define behavior for serverless/read-only disks, interrupted writes and multiple processes; use atomic replacement or shared storage. Label stale results if served as fallback.

26. **Upstream JSON is trusted by TypeScript assertion.** `src/lib/nansen.ts:22` casts parsed JSON without runtime validation. Validate boundaries and distinguish upstream schema failure from legitimate empty data. Never let malformed input quietly become reassuring zeros.

27. **World “population” double-counts overlapping concepts.** `worldStyle.ts:98` adds holders and daily traders; one wallet can be both. Either deduplicate a known population or label this an activity proxy. City lights should not pretend to be a unique wallet census.

28. **Missing PnL disappears into aggregation.** `src/lib/galaxy.ts:240` sums null link PnL as zero, and reputation uses the aggregate. Retain observation counts, scope, time windows and coverage; distinguish observed flat performance from unobserved performance.

29. **Reputation scope is not universal identity.** `src/lib/reputation.ts` builds from the selected universe's sampled stars/links. Scores can differ by coverage and universe. Make that scope explicit in the UI, dataset and publication semantics; reconcile duplicates before claiming a universal wallet score.

30. **Contract trust semantics are inconsistent.** `contracts/MonadReputation.sol:isTrusted` does not enforce freshness/current epoch or reject the funder flag; the demo collateral consumer does enforce freshness. These may be intended policies, but consumers must not mistake them for the same guarantee. Add tests and explicit API documentation; consider two-step ownership transfer and separate attester revocation policy.

31. **Performance has no acceptance budget.** Galaxy renders at up to DPR 2 with postprocessing, labels and procedural materials. No fresh CPU/GPU frame-time, texture-memory or draw-call budget was measured here. Define target devices, p50/p95 frame times, and quality tiers; separately profile cold start, launch and sustained flight. “The preview is slow” is context, not a performance strategy.

32. **The main scene is a maintenance bottleneck.** `GalaxyScene.tsx` is about 1,300 lines mixing rendering, data overlays, flight, replay, input, collisions and resource lifecycle. Split by ownership boundaries, not arbitrary line count: renderer lifecycle, flight controller, travel transitions, worlds, and overlays. Keep a narrow typed interface.

33. **Visual hierarchy needs acceptance tests.** Earlier supplied screenshots show competing labels/panels and overbearing exhaust. Establish screen-space label collision handling, distance tiers, bloom/exposure limits and cockpit-safe HUD margins. Recheck current output at small and large viewports; previous screenshots are not fresh proof.

34. **Accessibility is unproven.** Reduced-motion branches exist, but shorter animation is not automatically reduced motion. Validate keyboard-only use, focus return, screen-reader descriptions, contrast, remapping, non-color cues and a non-3D route to core research. Do not claim all of these are broken; they have not been accepted against a test matrix.

35. **Test coverage is wildly smaller than the feature surface.** Four new helper tests and 36 contract-artifact checks do not cover the station. Add travel-state tests, input ownership, repeated Esc, free/token flights, gates, return, stale requests, missing data, reduced motion and renderer teardown. Add browser smoke tests and screenshot baselines. No CI quality gate was demonstrated in this audit.

36. **Working-tree and documentation status invite false completion.** Current cockpit work is uncommitted and the handoff docs describe ambitious unfinished behavior. Keep a single acceptance checklist with implemented/verified/unverified status, commit coherent verified stages, and preserve the user's untracked documents. Do not make the next session reverse-engineer which prose is a requirement and which is reality.

## Recommended order

1. Freeze new spectacle. Protect paid endpoints and correct misleading labels/data semantics.
2. Specify and test one complete loop: station → cockpit → departure → Majors → another universe → token approach → return → walk.
3. Centralize travel state and timing; fix teardown and async lifetimes.
4. Finish the actual cockpit/interior/gear/livery, then effects. Inspect geometry with neutral lighting before bloom.
5. Add automated regressions, low-end quality modes, accessibility acceptance and measured performance budgets.
6. Only then expand worlds, cinematic flourishes or reputation integrations.

## Release acceptance checklist

- Every trip works with and without a token destination; Majors is the default.
- MON is the native-token sun only in Majors; other centers are distinctly named and explained.
- Universe gates work by flight without menu clicks and preserve a predictable flight state.
- Esc skips every cinematic exactly once; no stuck input after blur, chat typing, return or repeated launch.
- Real elapsed cinematic duration stays within the declared budget at 14/30/60 fps; hidden-tab policy is explicit.
- No main burn inside the hangar; wheels contact the ground; livery is readable from the gangway.
- Cockpit UI reflects real state and chosen Nansen dossier; an assisted orbit either exists or is not advertised.
- Missing/partial/stale data is visibly labeled; group heuristics are not presented as established wrongdoing.
- Paid usage is bounded across restarts and instances, not just one process.
- Repeated trips have stable resource use; browser errors/context loss have useful fallback UI.
- Tests, production build, current screenshots and measured frame-time evidence accompany the release.

## The roast

Right now the architecture has the confidence of a space program and the coordination of five URL parameters arguing in a trench coat. A static canvas says the clamps are safe, a variable says you're in orbit, and a missing flow value says the weather is lovely. None of those statements makes the underlying thing true.

The next improvement is not another glowing cone. It is making the same trip work twice, making the data admit what it does not know, and making every polished label earn its confidence. The project is worth tightening precisely because the idea is good enough that these shortcuts are now holding it back.

## Station realism addendum — floors, surfaces, construction and lighting

Requested visual target: a believable, manufactured, maintained spacecraft interior, not a generic sci-fi texture showcase. This section extends the audit to 52 findings. It is based on station/material source inspection and direct viewing of the hangar-floor albedo. No current live station screenshot was available in this follow-up: the browser inventory had no open preview tab. Render-dependent judgments below are acceptance targets or risks, not claimed fresh visual observations.

### 37. The hangar floor is literally concrete wearing a space-station name

**Confirmed:** `public/textures/LICENSE.txt` identifies `hangar-floor` as ambientCG Concrete034. The inspected albedo has mottled concrete, trowel-like marks and circular blemishes. `station.ts:533–540` tints this scan grey, strengthens its normal map to 1.2, repeats it every 3 m and puts it on a single 12 × 16.8 m deck face.

**Roast:** renaming concrete to “hangar-floor” does not launch a warehouse into orbit. It gives the shuttle a garage slab with better branding.

**Fix:** choose a coherent deck system: coated removable structural panels, restrained anti-slip finish, recessed service covers, flush fasteners, believable joints and tie-down points. Keep the broad surface quiet. Put wear where wheels, boots, tools and service equipment actually touch. This is an art-direction requirement for this spacecraft, not a claim that every fictional station must use the same floor.

### 38. One continuous plane cannot explain how the deck is built

**Confirmed:** the main hangar deck is one `face(...)`; its texture does not create real panel thickness or service-access construction.

**Fix:** model the large structural divisions and visible recesses, use normals for small relief, and decals for thin markings. Establish a measured panel module aligned with the bay's ribs and work zones. Do not add thousands of screws merely to compensate for a featureless base.

### 39. Repeating dirt is a pattern, not history

**Confirmed risk:** one 3 m tile repeats approximately four times across and 5.6 times along the deck. Distinctive scan marks repeat with it.

**Fix:** separate tileable micro-surface from large-scale wear masks and localized decals. Author wheel paths, entry traffic, equipment footprints and clean replacement panels. Avoid random dirt everywhere: dirt without a cause makes a room look procedurally neglected, not real.

### 40. Floor paint is laid above the floor instead of integrated with it

**Confirmed:** `station.ts:555–559` places marking planes 12–16 mm above the deck. The lane uses a separate painted-metal texture, while the large bay label uses a rectangular background. The label material's `transparent: true` does not itself remove that background.

**Fix:** define whether each marking is paint, tape, a mat or a plate. Paint should follow the surface with robust depth bias and a wear/roughness mask; a mat needs modeled thickness and edge contact. Ground the designation in the same wear pattern as the surrounding floor. Floating rectangles are not stencils.

### 41. Hazard stripes are typography masquerading as an industrial finish

**Confirmed:** wall and threshold stripes are long strings of triangle glyphs rendered onto stretched label textures (`station.ts:552–556`).

**Fix:** use a geometric stripe pattern with fixed physical width, angle and duty cycle. Clip it to actual protected edges and door-sweep zones. Add restrained damage at contact points, not decorative grunge. Safety markings should explain a hazard, not shout “sci-fi” from every available edge.

### 42. The hangar walls contradict their own material description

**Confirmed:** the comment promises chipped industrial paint; the implementation uses brushed aluminium on walls and ceiling (`station.ts:530–543`). A metalness override of 0.6 then multiplies a scanned metalness map.

**Fix:** distinguish painted enclosure panels from exposed structural aluminium, rubber seals and bare fasteners. Painted metal is not automatically optically metallic at its painted surface. Use a coating/exposed-metal mask where needed and validate under neutral lighting. Pick what the wall is before adjusting sliders until it sparkles.

### 43. Texture scale is partly disciplined and partly ad hoc

**Confirmed:** the project has useful metre-based `tileUV` and per-face `boxPBR` helpers. It also applies one UV scale to all faces of some boxes, such as walkway floor/ramp geometry (`station.ts:491,513`). Those faces have different physical dimensions.

**Fix:** apply consistent per-face physical scale across floors, ramps, thresholds and props. Maintain a material sheet recording tile size, grain direction and intended relief. Check from standing eye height and close range. A diamond tread must not change size when it turns a corner.

### 44. Normal-map strength is being used where construction should do the work

**Confirmed:** the deck uses normal strength 1.2; legacy wall panels use bump scale 0.6 (`station.ts:56`). These settings are not a calibrated description of panel depth.

**Fix:** validate relief under raking light, separating subtle grain from seams and structural steps. Large seams and silhouette changes need geometry; fine grain needs restrained normal detail. Stronger bumps can make coated metal read like hammered stone. Do not dial everything up to prove a normal map exists.

### 45. Razor-edged boxes do not catch light like manufactured objects

**Confirmed:** `boxPBR` constructs ordinary BoxGeometry, used for prominent framing and hardware. Much of the material impression therefore has to come from textures on perfectly sharp edges.

**Fix:** add small, scale-appropriate bevels to the nearby hero edges: doorframes, handrails, deck covers, consoles and support hardware. Keep distant geometry cheap. A tiny bevel often contributes more believable metal than another giant texture.

### 46. Reflections describe a generic room, not each actual room

**Confirmed:** `engine.ts:114–116` uses one PMREM generated from `envInterior.ts`, a synthetic 14 × 6 × 6 room with invented bright panels, windows and a green accent. It is not a capture of the actual hangar/research/observation geometry.

**Fix:** evaluate room-specific probes or baked environments, with controlled transitions and correct orientation. Keep polished surfaces rough enough for the chosen reflection technique. A surface reflecting a light that does not exist nearby undermines realism even when its shader is physically based.

### 47. Visible fixtures and illumination need to agree

**Confirmed:** hangar fixtures are emissive meshes, supplemented by separate point lights. The renderer is not computing general bounced light from those emissive surfaces. Global hemisphere/ambient lighting supplies broad fill.

**Fix:** align local light contribution with visible fixtures; use a deliberate baked/probe strategy for indirect light and a small budget of important shadowed sources. Inspect corners, undersides and closed-door states. Neither indiscriminately adding lights nor making the whole room brighter solves grounding.

### 48. Surface AO is not object-to-floor contact

**Confirmed:** the PBR loader supplies AO for fabric and diamond plate, but not the hangar deck. Those maps describe the asset surface, not the contact between the shuttle, gear, crates and floor.

**Fix:** establish contact shadows and local occlusion using a measured mix of shadowing, baked AO or restrained screen-space AO. Confirm tyre contact, support feet, wall/floor junctions and door recesses. Avoid a black halo around everything. Geometry must contact first; shadow tricks cannot repair floating placement.

### 49. Glass needs an explicit rendering strategy

**Confirmed:** station windows are largely thin planes with opacity 0.1 and clearcoat; some use a procedural smudge roughness map. This is a lightweight approximation, not modeled thick glazing.

**Fix:** give windows plausible frames, seals, edge thickness and restrained reflections. Decide whether expensive transmission is actually needed; a well-tuned inexpensive solution may be better. Smudges should live near plausible contact areas, not obscure the view or turn every pane into greasy plastic.

### 50. Rooms need different material identities within one construction language

**Direction:** hangar: durable deck coatings and exposed service hardware. Walkway: controlled anti-slip tread, joints and safe edges. Research: quieter panels, cleanable surfaces and localized hand wear. Observation: restrained framing and glazing that preserves the view. Existing blanket, rubber and scanned-metal assets are useful foundations, not a reason to plaster every finish everywhere.

**Fix:** define a compact approved palette and where each finish belongs. Keep brand colour mostly in signage, upholstery and purposeful accents. “Everything is shiny grey plus purple” is not an industrial design system.

### 51. More pixels will not rescue the wrong material

**Confirmed positive:** the project already loads real scanned albedo/normal/roughness sets, separates colour and data texture colour spaces, and has physical UV helpers. This is not a project with no PBR implementation.

**Fix:** retain good assets, replace inappropriate ones, verify roughness in isolation, and establish texture/GPU budgets. Use consistent texel density based on viewing distance. Do not commission giant textures before correcting scale, geometry, light and surface identity. PBR is a shading model, not a photorealism certificate.

### 52. Realism has no visual acceptance gate yet

**Fix:** approve a neutral-light material board and a single finished floor/wall/door corner before touching the whole station. Capture the same cameras with identical exposure: standing-height hangar, floor close-up, ramp transition, research console, observation glazing and lights-off/door-open variants. Inspect with bloom disabled, then restore restrained postprocessing. Test motion for shimmer, decal depth artifacts and texture repetition.

## Station realism implementation order

1. Specify the deck construction and physical material palette. Replace the concrete choice; keep existing layout/interfaces intact.
2. Build one representative floor-wall junction with panel seams, bevels, hardware and correct UV scale.
3. Calibrate local lighting, shadows, exposure and reflection environment in that corner.
4. Integrate markings and purposeful wear, checking them at real player distance.
5. Apply the validated system to hangar, walkway, research and observation areas without making every room identical.
6. Verify complete-room screenshots, motion, low-quality settings and GPU cost before calling it realistic.

**Final texture roast:** the current hangar material setup is a concrete garage floor, a brushed-metal room and some floating safety graphics auditioning for a spacecraft. It does not need more texture aggression. It needs believable construction. The goal is for a viewer to understand what a surface is made of, how it was assembled, how light interacts with it, and where people have used it—without needing a tooltip that says “PBR.”

## Doors, purposeful detail and AI interaction addendum

This extends the audit to 66 findings. The user reports that floors and doors look awful and the rooms lack detail/items. Those are recorded as user-observed visual problems; the implementation findings below are source-verified. No new live visual acceptance or paid-agent conversation was performed.

### 53. The doors are sliding slabs, not convincing mechanisms

**Confirmed:** `src/station/world/station.ts:604–611` builds the hangar leaves as two 6 × 8 × 0.2 m boxes. `features/hangar.ts` translates them sideways. The leaf construction shown here does not establish a convincing system of tracks, pockets, mating seals or actuators.

**Roast:** two enormous metal rectangles doing a PowerPoint slide transition are not a pressure-door design.

**Fix:** design the opening as an assembly: structural jamb, recessed tracks, plausible leaf storage, meeting seam, seals, locks, maintenance covers and manual override. Add bevels and layered panel depth where players see them. Inspect the full opening stroke for wall intersections and unsupported motion. Make the motion communicate unlock → move → seat → lock, with matching light/sound feedback.

### 54. Interior hatches imply functionality they do not have

**Confirmed:** the `hatch` helper at `station.ts:158` explicitly keeps hatches open. It builds frames, seals, latch blocks and a green lamp, not a working door leaf.

**Fix:** decide which openings are permanently open passages and which are operational pressure boundaries. Give operational hatches a visible leaf, handles, hinges or sliding mechanism, state-aware indicator and collision matching their pose. Do not put a permanent “safe/open” lamp on something the simulation never checks.

### 55. Pressure and bay-control copy needs a real shared state

**Confirmed:** the bay-control face is a static texture saying “DOORS CLOSED” and “SHUTTLE DOCKED” (`station.ts:576`), while the sequence later opens the doors and departs. Return-stage copy announces pressurisation, but those status textures are not driven by that sequence.

**Fix:** one bay state must drive door pose, indicator lamps, console copy, launch eligibility and announcements. If realism is the goal, define how occupied modules remain isolated while the bay opens. No need for a full pressure simulator, but the visual and interaction story must agree. A painted status message is not an interlock.

### 56. The floor needs a construction pass, not another texture pass

The user's complaint remains a top-priority visual acceptance failure. Findings 37–44 explain the concrete choice, flat deck, floating markings and inconsistent relief.

**Fix:** finish one walkable section with flush access panels, joined thresholds, restrained anti-slip texture, believable fasteners and grounded equipment. Verify foot-height transitions and the ramp join. A floor that looks assembled, carries weight and meets the door correctly will do more for realism than decorative clutter on every wall.

### 57. “More items” must mean more purpose

**Confirmed positive:** there are already racks, bags, cables, extinguishers, ground-support controls and fire-suppression details in `station.ts`, plus a modeled workstation. The station is not literally empty. The problem is whether these objects make the room feel occupied, maintained and useful at player scale.

**Fix:** establish a room-by-room prop plan. Hangar: secured tool cabinet, wheel chocks, service cart in a marked parking spot, tethered diagnostic equipment, hose reels, tie-downs and labeled service access. Research: sample storage, instrument mounts, restrained notebooks/tablets, cable routing and task lighting. Observation: optics accessories, calibration reference and maintenance access. Reuse existing objects where possible. Keep gangways and landing clearances open.

### 58. Detail needs a hierarchy and a maintenance story

**Direction:** large structure explains the room; medium assemblies explain its function; small hardware explains manufacture and use. The player should see where a panel opens, how a cable is restrained, and what someone services here.

**Fix:** prioritize door hardware, console mounts, deck junctions and frequently touched controls before background greebles. Use deliberate clean/worn areas, repairs and serial labels. Secure loose objects if the room supports zero gravity. Random boxes and noise do not make a place inhabited; they make it cluttered.

### 59. Interactive objects need a consistent language

**Direction:** a detailed switch-looking object that cannot be used is an expectation trap unless it is clearly background equipment.

**Fix:** define a small coherent interaction set: inspect, open/close, use, select destination, ask about this. Use consistent reach, focus indication, input hints, disabled reasons and feedback. Make critical controls functional first; treat background hardware as inspectable or visually secondary. Do not require every screw to be interactive.

### 60. The robot is a research-chat interface, not yet a station-aware assistant

**Confirmed:** `src/station/ui/AgentPanel.tsx` sends text, conversation ID, mode and an optional token/wallet subject. `src/app/api/agent/route.ts` adds Monad framing and that subject. It does not send a structured station/travel state or expose a validated local action protocol.

**Roast:** the robot has a body, a hologram and expressions, but its connection to station operations is mostly a chat window wearing a spacesuit.

**Fix:** separate local station help from paid research. Controls, room directions, door state and current flight phase should come from authoritative local state without consuming a paid research query. For market questions, attach the chosen entity, chain, timeframe, available data timestamp and task intent. Clearly explain what the robot can inspect or do.

### 61. Context removal and conversation memory are not the same thing

**Confirmed:** `about` initializes from `engine.subject` on panel mount. Removing its chip only calls `setAbout(null)`; it does not reset `memory.conversationId` or tell the upstream conversation that the old focus has been cleared. Earlier discussion can therefore still influence ambiguous “it/this” questions. Actual model behavior was not tested.

**Fix:** expose the active subject and timeframe; explicitly handle replace/clear/general context transitions; synchronize relevant local subject changes. Ask one targeted question when “it” is ambiguous. Keep UI-selected focus distinct from historical conversation context rather than pretending history vanished when a chip disappeared.

### 62. Stop can leave an answer looking unfinished forever

**Confirmed:** the `AbortError` path in `AgentPanel.tsx:ask` does not mark the message canceled or done. An empty message without an error still renders “Thinking…”, even after `busy` becomes false. Closing the panel also aborts the stream, with incomplete messages potentially retained in module memory.

**Fix:** use explicit queued/researching/streaming/completed/stopped/failed states. Preserve partial text with a “Stopped” label, clear robot animation, and offer edit/retry without automatically resending a paid request. Test stop before the first token, mid-answer, close/reopen and network interruption.

### 63. The credit gate is inconsistent across send paths

**Confirmed:** the main Ask button checks `outOfQuestions`, but suggestion buttons and Enter call `ask()` without that guard; `ask()` itself checks only empty text and busy. The server still enforces its process cap, so this is not a demonstrated cap bypass—it is inconsistent UI behavior and avoidable failed requests.

**Fix:** centralize readiness, remaining allowance and in-flight guards. Clicking a suggestion should preferably draft the question with visible cost, then let the user send. Keep expert mode explicit; never silently upgrade the price. Distinguish configured estimates from confirmed charged usage.

### 64. The stream parser needs protocol and failure tests

**Confirmed:** the client parses individual newline-delimited `data:` lines and ignores unrecognized/unparseable events. It does not flush a final unterminated buffer or implement full multi-line SSE event assembly. Whether the upstream emits those cases was not verified.

**Fix:** test fragmented UTF-8/chunks, CRLF, multiple data lines, final-buffer handling, error/finish events, disconnects and empty completion against the actual supported provider protocol. Surface an actionable failure rather than silently presenting an empty successful answer. “Streaming text appeared once” is not stream robustness.

### 65. Answers need evidence structure and useful next actions

**Confirmed:** the UI shows tool names, text and a general Nansen source footer. That footer does not itself guarantee claim-level citations, coverage or freshness. The local link renderer derives a fly shortcut from query parameters using a regex; it does not establish token identity by parsing and validating the link's host and structured fields.

**Fix:** present a concise conclusion, evidence/timeframe, limitations and specific next steps. Validate structured entity references before producing actions such as “Open dossier,” “Compare,” or “Set destination.” Navigation should reflect the user's choice; paid requests require explicit submission. Never let generated text directly operate doors, publish reputation, or execute transactions.

### 66. Conversation continuity and recovery need a product contract

**Confirmed:** `memory` is module-local. It preserves a conversation across panel mounts but not a full reload; typed input is not continuously copied to `memory.draft`. New conversation clears history without defining broader research-context semantics. The panel also scrolls to the bottom on every message update, potentially interrupting someone reading earlier evidence.

**Fix:** decide what persists, for how long, and how users clear it. Preserve unsent drafts across ordinary panel closure; label restored/stopped conversations accurately. Only auto-scroll when already near the bottom. Add readable comparisons, copyable answers, accessible status updates and recoverable errors. Do not silently persist sensitive research history indefinitely.

## Proposed logical agent interaction

1. **Orient:** show current room, selected subject and timeframe. Explain whether the request is local help or paid research.
2. **Resolve:** clarify only material ambiguity. Reuse verified local context instead of asking the user to repeat it.
3. **Prepare:** show/edit the question and selected research mode with its cost. Local navigation/help should not require a paid call.
4. **Research:** display meaningful progress, current tools and a reliable Stop control; never fake activity.
5. **Answer:** short conclusion first, then evidence, timestamps, scope and unknowns. Avoid presenting heuristics as established facts.
6. **Act:** offer validated, explicit actions—open dossier, compare entities, set destination or show a station control. Keep research, navigation and consequential actions separate.
7. **Recover:** retain useful partial work, mark stopped/failed states, preserve drafts and make retry costs explicit.

Acceptance scenarios: “Where is the shuttle?”; “Why can't I launch?”; “Explain this token” after changing subjects; “compare it with the previous one”; clear the subject then ask a general question; stop before output; stop mid-stream; close/reopen; exhausted allowance via button/Enter/suggestion; upstream outage; reload; and a generated link containing misleading token parameters.

**Final roast:** the station needs fewer props that merely announce “equipment” and more assemblies that explain a job. The doors must look capable of closing a real opening; the floor must look capable of carrying a real load; the robot must understand the current task instead of relying on a label and a retained conversation ID. More polygons, more chrome and longer AI answers are not substitutes for any of those things.
