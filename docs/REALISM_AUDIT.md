# Realism audit: station, shuttle and flight

14 October 2026. Audit only: no project code was changed. The evidence comes from:
- source inspection, with file and line references;
- floor-height calculations using the station's own `groundAt` (`station.ts:715–725`);
- runtime measurements taken in the browser;
- 11 screenshots in `docs/audit/`, taken at walking eye height with quality pinned (`?q=3`).

The findings in `docs/PROJECT_AUDIT.md` were treated as hypotheses. Each one below is marked **confirmed**, **refuted** or **already fixed**.

---

## A. Verdict

This is a zero-g station layout that was converted to walking without being redesigned, then dressed in good material scans that are lit mainly by a fake room.

Root cause in one sentence: every module is a cylinder or box centred on the same axis (y = 0), as in a microgravity station, and the hatches are square holes centred on that axis. Walking mode then added gravity and set each room's floor at minus that room's radius. As a result:
- floors sit at three different heights (−1.05, −1.5, −2.2);
- every hatch becomes a waist-to-chest-high window you walk through;
- an invisible, smoothed floor function papers over the differences;
- a vertically eased camera hides the result.

Everything else (concrete in a spacecraft, slab doors, typographic hazard stripes, a decorative cockpit) is secondary to that.

The shuttle is a stylised toy at 6.1 m. Its cockpit has no shell, and the flank livery is buried in the hull. The launch sequence is well intended (no main burn inside, pushback before ignition), but it opens a hangar that is connected to every room through permanently open hatches, with the player standing in it.

---

## B. Prioritised issues

Severity levels:
- **S1:** breaks believability or correctness everywhere.
- **S2:** clearly wrong where seen.
- **S3:** polish or design weakness.

| # | Sev | Location | Evidence | Root cause | Proposed fix | Depends on | Acceptance test |
|---|---|---|---|---|---|---|---|
| 1 | S1 | Research to observation transition | `station.ts:723–724`; table C; shots 01–03 | Floor −1.5 to −2.2 has no geometry; hatch R-2 is a 1.9 m square centred on y = 0 (`station.ts:366,381,390`) | One deck datum at y = −1.5 (see G1); door-shaped openings from deck to deck + 2.0 m | none | Walk surface equals mesh top at every sample; legs never intersect walls (shot 02 regression) |
| 2 | S1 | `groundAt` | x = 11.4: invisible 0.35 m cliff; x = 2.8: 0.23 m cliff (branch edge); gangway error ±0.28 m (smoothstep against a straight ramp) | Hand-tuned curve, not derived from the geometry | Author the walk surfaces from the same numbers that build the floors; piecewise-linear; no smoothstep | 1 | Unit test: `groundAt` matches each floor mesh top within 1 cm; no step over 0.2 m except at modelled steps |
| 3 | S1 | `walker.ts:120–123` | Camera eases vertically (`exp(−12·dt)`); collision checks the eye point only | Easing hides cliffs; the body below the eye is never tested | Capsule collision from feet to head against volumes and props; easing only for modelled steps | 2 | Third-person run through each doorway: no limb inside walls |
| 4 | S1 | Hatches and pressure story | `station.ts:158` "Hatches stay open"; the bay opens to space with the player inside (shot 10); `hangar.ts:164–168` puts the player in the open bay on return | No interlock model; hatches are frames without leaves | Operational hatches with leaves and a closed/open state; the bay is depressurised only with the walkway hatch shut, and the player watches from behind glass | 1 | Doors cannot open unless the bay hatch is closed; indicator lamps, console text and toasts read one state |
| 5 | S1 | Telescope reach | `telescopeEye` y = 0.35 (`station.ts:730`); observation walking eye at −0.65 | Floor at −2.2 | Deck datum −1.5 puts the eyepiece 0.3 m above the eye | 1 | Eyepiece within 0.25–0.45 m above standing eye |
| 6 | S1 | Hangar deck | `station.ts:533–539`; `LICENSE.txt`: Concrete034; albedo inspected (trowel swirls); shot 05 | Wrong material; one 12 × 16.8 m face | Coated structural deck panels with recessed service covers, tie-down rails and wear where traffic is (G4) | 1, 9 | Neutral-light close-up reads as coated metal panels, not concrete |
| 7 | S2 | Research floor | `station.ts:199–207`: the floor face uses `hubWall` (quilted beta-cloth blanket); shot 04 reads as bathroom tile | `moduleX` uses one material for all four faces | Separate floor material (anti-slip deck panels) from wall blankets | 1 | Floor and walls are distinct at 2 m and at 0.5 m |
| 8 | S2 | Hangar doors | `station.ts:604–617`: two 6 × 8 × 0.2 boxes; `hangar.ts:250–251` slides them 5.5 m, so leaves end at ±8.5 through walls at ±6 (shot 06, 10) | No jamb, track or pocket design | Door assembly: pockets outside the side walls inside the hull, head track, meeting seal, latch, staged unlock-move-seat-lock motion | 4 | No leaf ever leaves the hull envelope; the motion has four readable phases |
| 9 | S2 | Lighting | Environment off makes the room nearly dark (screenshot pair in section D); `envInterior.ts` is one 14 × 6 × 6 synthetic room (with a blue "nadir window" floor pool) used everywhere at 0.42; plus hemisphere (0.45) and ambient (0.25) fill (`engine.ts:117–140`) | The look is mostly an invented reflection, not local lights | Per-room probe or baked environment from the actual room; local lights matched to visible fixtures; cut flat fill | 6, 7 | Neutral board: materials distinguishable with bloom and AO off |
| 10 | S2 | Shuttle livery | `shuttle.ts:316`: flat decal planes at x = ±0.298; from the gangway it reads "ONAD", with black shards where the plane leaves the hull (shots 07, 08) | Planar decals on a curved, remodelled hull | Project the decals onto the hull (DecalGeometry) or bake them into the paint map | — | "MONAD" fully legible from the gangway, with no z-fighting |
| 11 | S2 | Cockpit | Shot 09: no interior shell (hull culled from inside), screens half hidden by the dash slab, nose RCS cones inside the cabin, static text (`shuttle.ts:296`) | Decorative props placed in the hull | Modelled cabin shell with real window cut-outs; move RCS outside; live displays bound to launch state | 13 | From the eye anchor: no hull back-faces, no foreign geometry, all screens readable |
| 12 | S2 | Boarding | `hangar.ts:287–299`: the camera glides through the hull to the eye point; the ship has no hatch | No boarding path | Side hatch and ladder or airstair; walk, enter, seat; keep quick-board | 11 | Boarding never passes the camera through solid geometry |
| 13 | S2 | Return sequence | `hangar.ts:164`: doors snap open; `:190`: the ship starts 8 m outside the doors at rest; `:173`: "Bay pressurised" at 13.5 s, doors closed at 13.8 s | Timeline authored as separate eases | Continuous approach from far out with velocity carried over; doors open before the ship is visible; pressurise only after the doors seal | 4 | Ship velocity continuous; pressurised message only after the closed state |
| 14 | S2 | Ignition location | `hangar.ts:258,264`: mains light 4.2 m outside the door plane, pointing along the open bay mouth | Short pushback | Cold-gas separation to a stated safe distance (tens of metres), then ignition with the plume pointing away from the station | — | No plume volume within X m of the hull |
| 15 | S2 | Gangway edges | `groundAt`: stepping off the side drops 1.65–2.9 m; no edge colliders (`colliders.ts` only covers props) | Visual handrails only | Guard-rail colliders; stair treads at 30–35° rather than a 21.7° plate ramp | 2 | Cannot leave the gangway except at the ends |
| 16 | S2 | Galaxy hand-off | `ShuttlePanel.tsx:63–65` full page load; free flight spawns at the default camera, not at the station (now at the hub); `page.tsx:216` B "docks" from anywhere in a cockpit ride | Route hand-off, not a travel state | Start galaxy flight at the station hub with carried velocity; dock only within range | travel state (P1 #19) | Launch, galaxy and return keep position and heading continuity |
| 17 | S3 | Hazard and lane markings | `station.ts:552–557`: triangle glyph strings on stretched label textures; lane planes 12–16 mm above the deck; bay decal with a full background rectangle | Typographic shortcut | Geometric stripe shader with physical width and angle, clipped to real hazard zones; decals at surface with polygon offset | 6 | Stripes keep a fixed 100 mm band width at any surface size |
| 18 | S3 | Hangar walls | Comment says chipped paint (`station.ts:530`); actual is brushed aluminium at metalness 0.6 (`:531–532`) | Mismatch between intent and material | Painted enclosure panels (dielectric) with exposed structural aluminium on ribs only | 9 | Wall and ribs read as different materials |
| 19 | S3 | Umbilicals | `hangar.ts:83–84`: hoses arc through head-height air across the deck (shot 08) | Straight Catmull-Rom between the wall and the ship | Run them along the deck in a cable tray, rising at the ship | — | Nothing crosses the walking area above 0.1 m |
| 20 | S3 | Zero-g leftovers | Workstation foot restraints (`workstation.ts:164`); robot hovering on thrusters (`robot.ts:20`) | Zero-g design kept | Replace the foot restraints with a stool or anti-fatigue mat; give the robot a docking cradle | 1 | No zero-g fittings in gravity rooms, unless deliberate |
| 21 | S3 | Reduced motion | `hangar.ts:243`: launch runs 4.5× faster; `page.tsx:133` | "Shorter" treated as "reduced" | Cut to stills with crossfades; no fast motion | — | Reduced motion: no camera translation faster than 1 m/s |
| 22 | S3 | Static status text | Bay control "DOORS CLOSED / SHUTTLE DOCKED" (`station.ts:576`); hatch lamps always green (`:177`) | Textures, not state | Drive them from the bay state (#4) | 4 | Text and lamps change with the state |
| 23 | S3 | Scale | `hangar.ts:13` LENGTH 8.8, but the ship measures 6.1 m (scale ×2.651); 12 × 8 × 16.8 m bay | Bounding box included non-hull parts | Pick a vehicle size, e.g. 9–10 m, and fit the bay to it | 11 | Hull length equals the stated value within 2% |

**Status of earlier PROJECT_AUDIT hypotheses:**
- **Confirmed:** #37 (concrete), #38, #40, #41, #42, #53, #54, #55, #13, #14, #15.
- **Already fixed in the current code:** #8 (cinematic timing now runs on real time via `cineDt`), and wheel contact (measured: all five tyre bottoms at y = −4.000 = deck).
- **Refuted:** normal-map convention. The scans are OpenGL-style (a raised diamond's upper slope is green), which is correct for three.js.

---

## C. Floor heights (world metres; eye = walk + 1.55)

| Room or transition | Rendered floor | Walk floor (`groundAt`) | Eye | Threshold detail | Visible justification |
|---|---|---|---|---|---|
| Hangar deck | −4.000 | −4.000 | −2.45 | — | yes |
| Gangway foot (x −6.9) | −3.947 | −4.000 | −2.45 | 5 cm lip | yes |
| Gangway (x −5.36) | −3.335 | −3.617 | −2.07 | **feet 0.28 m inside ramp** | ramp visible, mismatch |
| Gangway (x −0.83) | −1.536 | −1.269 | 0.28 | **feet 0.27 m above ramp** | — |
| Walkway | −1.03 (plate top) | −1.05 | 0.50 | Hangar doorway sill −0.95: 0.08 m above walkway | partly |
| Walkway into research (R-1, x 2.8) | −1.03 to −1.50 | smoothed −1.05 to −1.5, then **0.23 m cliff at x = 2.8** | 0.50 to 0.05 | Sill −0.95 sits 0.55 m above the research floor; wall below the opening | **none** |
| Research room | −1.50 (quilted blanket) | −1.50 | 0.05 | — | — |
| Research into observation (R-2, x 11.2) | −1.50 to −2.20 | smoothed to −1.85, then **0.35 m cliff at x = 11.4** | 0.05 to −0.65 | Sill −0.95: **0.55 m above research floor, 1.25 m above observation floor**; feet pass through the wall (shot 02) | **none** |
| Observation room | −2.20 (diamond strips and belly glass) | −2.20 | −0.65 | Eyepiece 1.0 m above standing eye | — |

Script: scratchpad `floors.mjs`, which reproduces `station.ts:715–725`.

---

## D. Materials and equipment by room

**Why it looks plastic** (in order of contribution):
1. **Lighting comes mostly from a fake environment.** One synthetic box room (`envInterior.ts`) gives every room the same soft-panel reflections, plus flat hemisphere and ambient fill. Turning the environment off makes the research room nearly dark. The local point lights (2.4–2.6) barely shape anything, so surfaces get even, directionless highlights: the classic plastic look.
2. **Wrong material in the wrong place.** The research floor is the wall blanket, the hangar deck is concrete, and the "chipped paint" walls are brushed metal at metalness 0.6.
3. **Sharp boxes with no edges.** `boxPBR` and `BoxGeometry` are used everywhere, with no bevels to catch highlights.
4. **Scale and repetition.** The 3 m concrete tile repeats about 4 × 5.6 times. The blanket's 4 × 4 pillow grid reads as tile.
5. **Glass is a 10%-opacity plane**: no thickness, frame depth or seal.

Not causes: texture colour spaces (sRGB albedo, linear data, correct), normal convention (OpenGL, correct), resolution (2K is enough).

**Already present** (inventory, not clutter):
- **Research:** five-module racks on both side walls, handrails, corner cable bundles, ceiling duct with outlets, smoke detector, egress strips, workstation (three monitors, keyboard, trackball, foot restraints, work light), extinguisher, mission patch, robot.
- **Observation:** telescope pier and rig with console, star tracker, thermal and optics ORUs, two bags, a tied cable run, handrails, great window with bolt ring, belly window.
- **Walkway:** glass tube, five ribs, eight stringers, floor plate, rails.
- **Hangar:** wall posts and beams, caged work lights, fire main and nozzles, extinguisher cabinet, beacon, ground-support panel, bay control and e-stop, wall handrails, stand markings, clamps with lamps, chocks, two hoses, tug and tow bar, flight board.

**Plan by room.** Three levels each: structure, then function, then close-up.

| Room | Structure | Functional assemblies | Close-up and wear |
|---|---|---|---|
| Hangar | Coated deck panels on a 1.5 m module aligned with the ribs; recessed tie-down rails; door jambs, pockets and head track | Tool cabinet; service cart in a marked bay; hose reel and cable tray to the stand; diagnostics trolley tethered at GSE; airlock vestibule window to watch launches | Tyre marks along the stand lane; scuffed tie-downs; serial plates; door seal wear |
| Walkway | Larger tube radius so the deck is at −1.5 (G1); tread plates with nosings; joint covers at ribs | Lighting along handrails; emergency breathing apparatus box | Hand-polish on rails; edge-protection strips |
| Research | Floor: anti-slip deck panels with access covers over the cable trench; walls stay blanket and racks | Sample freezer rack, glovebox, instrument mounts, task lighting at the desk; robot dock or charge cradle | Fingerprints near latches; label tape on rack fronts |
| Observation | Deck at −1.5 with a guarded viewing well over the belly window; stair down into the well | Optics storage drawer, calibration target, filter carousel, red-light task lamp | Worn grip on the telescope handle; smudges near the window frame only |

---

## E. Shuttle critique

- **Size:** 6.1 m long, 4.3 m wingspan, 3.1 m tall on gear; hull scale ×2.651 (measured). The code believes it is 8.8 m (`hangar.ts:13`). It is dwarfed by the 12 × 8 × 16.8 m bay.
- **Silhouette:** a lifting body with double-delta wings and tail; three bells in a triangle; OMS pods. A readable spaceplane shape, but toy proportions: thick wings and a short body.
- **Cockpit:** no interior shell; screens occluded; RCS nozzles intersect the cabin; displays static (shot 09).
- **Gear:** tyres touch the deck (fixed). The 0.26 m tyre radius is plausible at this size.
- **Boarding:** no hatch, door or ladder.
- **Thermal protection and paint:** materials exist (`shuttlePbr.ts`). The livery is buried and z-fights (shots 07, 08).
- **Engines:** bells 0.7 m long at scale; the burn happens outside the bay (good).
- **Scale consistency:** in the galaxy the same model is about 2 units against worlds of 8–50 units. That's stylised and should be called a "map view", not physical.

---

## F. Launch and return state machine

```
PARKED ──board(E)──▶ COCKPIT(panel: planner) ──Launch──▶ L0 CHECKS 0–0.3
L0 ─▶ L1 UMBILICALS 0.25–0.8 ─▶ L2 DOORS 0.65–1.9 ─▶ L3 LIFT 1.7–2.5 (gear up 2.25–2.9)
 ─▶ L4 PUSHBACK tail-first to z −26.2, 2.45–4.6 ─▶ L5 TURN 4.55–5.5 ─▶ L6 IGNITION 5.55–6.0
 ─▶ L7 DEPART (closed-form accel) ─▶ DONE 7.2 ─▶ page navigation /galaxy?…&arrival=1
GALAXY: JUMP (900 ms overlay) ─▶ APPROACH (5.2 s, token only) ─▶ FREE FLIGHT
RETURN: B or link ─▶ page navigation /?return=1 ─▶ R0 APPEAR at z −30 at rest (doors already open)
 ─▶ approach 0–7.4, gear 3.5–5.7, touchdown 6.4–8.8, clamps 9.2, umbilicals 9.2–10.5,
    doors close 10.8–13.8, "pressurised" 13.5 (!) ─▶ WALK (player placed in the bay)
```

(The L-stage numbers are timeline seconds; the timeline runs 1.35× real time.)

| Phase | Camera | Doors | Gear | Engines | Input | Esc |
|---|---|---|---|---|---|---|
| Planner | Cockpit eye (glides through the hull) | closed | down | off | DOM | back to walk |
| L0–L7 | Cockpit; shake after 5.55 | open from 0.65 | up from 2.25 | mains from 5.55, outside | none | skip, then navigate (single owner) |
| Galaxy jump and approach | Cockpit | n/a | n/a | — | none | skips the approach |
| Return R0 | Cockpit if `cockpit=1`, else player standing in the open bay | **snap open** | down 3.5–5.7 | RCS only | none | jump to END |

Timing critique:
- Durations are now frame-rate independent (`cineDt`, measured: 5.29 s against the declared 5.33 s).
- Problems that remain:
  - the ship appears at rest 8 m outside the bay;
  - the arrival never connects to the galaxy position;
  - "pressurised" comes before "doors closed";
  - with no destination, the ship flies away forever and the doors stay open;
  - reduced motion is a 4.5× fast-forward;
  - a hidden tab pauses the sequence (0.25 s clamp), which is good but undocumented in the UI.
- "Orbit" was renamed to free flight in this session (P1 #7).

---

## G. Staged repair plan

1. **G1 Architecture and movement correctness (first).**
   - Deck datum y = −1.5 for walkway, research and observation.
   - Walkway tube radius goes from 1.17 to about 1.75 (glass), so its deck matches.
   - The observation room gets a raised deck at −1.5, with a guarded, stepped viewing well down to the belly window.
   - All three hatches become door-shaped openings: 0.9 × 2.0 m clear, 0.1 m sill, from the deck.
   - The hangar doorway also starts at the deck; the gangway becomes a stair with landings (30–35°) and guard colliders.
   - `groundAt` is generated from the same floor specs, piecewise-linear, with unit tests.
   - Capsule collision; vertical easing only for steps of 0.2 m or less.
   - Scope: `station.ts` (geometry, volumes, `groundAt`), `walker.ts` (collision), `colliders.ts`.
2. **G2 Doors and the state model:** hatch leaves and states; bay depressurisation interlock; door pockets and track; console, lamps and toasts driven by one bay state; fix the arrival ordering.
3. **G3 Geometry and construction:** deck panels and access covers; bevels on the parts near the player; door assemblies; umbilical tray; real cockpit shell, boarding hatch and ladder; projected livery.
4. **G4 Materials:** replace concrete with coated deck; research floor separate from the blanket; painted walls against bare ribs; geometric hazard stripes; glass with thickness and seals.
5. **G5 Lighting:** per-room probe or baked environment; lights matched to fixtures; remove the flat ambient fill; contact shadows; check on a neutral board with bloom and AO off.
6. **G6 Flight continuity and effects:** continuous launch to galaxy at the station hub, and back; separation distance before ignition; plume and RCS polish; proper reduced-motion variant.
7. **G7 Measurement:** frame-time budgets on real hardware; regression screenshots at fixed cameras.

---

## H. Could not verify

- **Real GPU frame time:** the preview pane is software-rendered; no fps or GPU-memory figures are claimed.
- **The main-engine burn frame:** missed between captures; the plume look is unaudited visually.
- **The galaxy cockpit ride end-to-end:** reviewed by code only.
- **Audio:** none exists to audit.
- **Mobile layouts, gamepad, keyboard-only flow.**
- **Exact hull half-width at the decal:** vertex sampling couldn't separate the hull from the wing roots; the burial is shown visually instead (shots 07, 08).

## Measurable acceptance criteria

- Walk surface equals mesh top within 1 cm everywhere (unit test).
- No unmodelled step; any step is 0.2 m or less, visible, and has collision.
- No body part intersects walls in third person at any doorway.
- Eyepiece 0.25–0.45 m above standing eye.
- Bay doors can open only with the bay hatch closed; all indicators agree.
- Materials distinguishable on the neutral board (bloom, AO and environment off).
- Tyres touch the deck (already passing); ship clears door jambs by at least 0.5 m throughout the motion.
- No main-engine plume within the bay or within the stated safe distance of the hull.
- Cinematic duration within ±5% at 14, 30 and 60 fps (passing at the software-rendered rate: 5.29 s against 5.33 s).
- Esc works exactly once in every phase; outbound and return trips repeat three times without stuck state.
- Frame-time budget measured on named target hardware before claiming performance.
