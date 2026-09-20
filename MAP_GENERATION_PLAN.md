# Map generation: implementation plan

## 1. Scope and acceptance criteria

The source requirements are in specs.md, especially sections 4.2–4.4, 5.1, and 9. This prototype deliberately narrows the product's eventual three-to-five-location, three-to-four-stakeholder adventure to **one scene, three meaningful areas, exactly two NPCs, and one player** as requested. It is a local web application, not a complete teacher/student platform.

The playable slice is a schematic historical harbor investigation: inspect a public notice, hear two different stakeholder perspectives, then recommend a supported response at a meeting table. All invented dialogue, characters, documents, geography, and consequences are labelled simulation material. The sample is not presented as source-grounded historical teaching content. A teacher-supplied source may be represented in an imported blueprint, but its authenticity is not automatically verified.

Acceptance criteria:

- A single 30 × 20 scene displays player, two NPCs, inspectable evidence, and a final decision point.
- Keyboard/click movement obeys terrain and entity collision; accessible controls provide equivalent interaction effects.
- Both NPCs and evidence can be reached from spawn; every required area is accessible.
- The same complete blueprint, seed, and generator version reproduce the same map and save identity.
- A different seed varies spatial layout/decor without changing the adventure's meaning. Different valid blueprints can change objectives, dialogue, evidence placement, roles, and area purposes; the POC does not claim arbitrary natural-language source generation.
- Malformed blueprints and impossible objective structures produce actionable errors before replacing the current map.
- An ending is reachable, completion is idempotent, and progress survives reload for the same map.
- Automated unit, seed-sweep, negative-input, and real-browser tests cover these behaviors.

## 2. Architecture

Use strict TypeScript ES modules, Vite, Canvas 2D for the spatial scene, and semantic HTML for controls, text, objectives, and alternate navigation. Vitest tests pure modules and generation invariants. Playwright exercises the built application in Chromium. TypeScript domain types cover blueprints, generated maps, state transitions, validation results, and UI boundaries; runtime validators still treat imported JSON and saved data as `unknown`.

Modules:

| Module | Responsibility |
| --- | --- |
| src/scenario.ts | Explicitly authored, public demo blueprint |
| src/core.ts | Exported domain types, blueprint validation, seeded compiler, playability validation, pathfinding, pure game state transitions, safe save restoration |
| src/render.ts | Terrain, landmarks, entity markers, player, selection, and responsive coordinate conversion |
| src/main.ts | Controls, import/export, interaction panels, journal, objectives, local persistence, error states |
| Vite configuration | Development server and production application bundle |
| tests/*.test.ts | Vitest unit, invariant, invalid-input, and progression tests |
| e2e/*.spec.ts | Playwright browser navigation and complete adventure tests |

AGENTS.md records the shared data/API contract so independent workers can implement without changing one another's files.

## 3. Data model and trust boundary

The version-1 blueprint contains setting, player role, source records, simulation assumptions, three typed locations, exactly two NPCs, evidence, a prerequisite graph of objectives, and a final decision with explicit options/outcomes. All entity and source references use unique bounded identifiers. NPCs and evidence reference a location and source records; an objective references an interaction target. A decision references the objective IDs required to unlock it.

Validation checks primitive types, supported versions, bounded collection/string sizes, required fields, IDs, all references, supported area kinds, and objective satisfiability. NPC dialogue is public authored content, not hidden character knowledge. Never execute generated code or insert blueprint content into HTML. Imported text is rendered using textContent. The POC's source labels are declarations, not evidence that historical claims have been fact-checked.

A generated map contains generator version, content-sensitive identity, seed, a single scene, terrain grid, location rectangles, entity placements, player spawn, and validation/generation metadata. Saves reference the generated identity so a changed blueprint cannot accidentally inherit an older adventure's progress.

## 4. Deterministic spatial compiler

1. Validate the blueprint and normalize/check the bounded seed.
2. Derive a reproducible pseudorandom stream from the seed and use it for permitted layout variation.
3. Allocate a bounded grid and protected perimeter. Select/permutate three non-overlapping area slots; associate each with a blueprint location.
4. Reserve spawn, location approaches, interaction access, and connecting orthogonal corridors before decoration.
5. Place location floors and recognizable schematic scenery according to area kind. Assign NPC/evidence to their requested area, using unoccupied walkable tiles with free approach cells. Place the final decision point in the meeting area.
6. Add deterministic nonessential variation only where it cannot break reserved traversal routes.
7. Run the independent map validator. Never expose an invalid result: either use a bounded deterministic repair during construction or throw an explicit failure. The implementation must report what it actually supports rather than imply arbitrary repair capabilities.
8. Return serializable map data. Rendering and state management consume this result, never a second independent collision model.

The compiler, not an LLM, owns coordinates, collision, reachability, and asset selection. This is intentionally constrained: arbitrary image generation or unconstrained geometry is unnecessary and makes playability harder to guarantee.

## 5. Playability validation

Use four-neighbor traversal with terrain and occupied-entity tiles excluded. Flood-fill from the player spawn; each location needs a reachable tile and each mandatory interaction needs at least one reachable orthogonal neighbor. Validate that grid dimensions/tiles are legal, all locations/entities are in bounds, all expected blueprint entities exist once, entities and spawn do not overlap, and entity positions are compatible with their assigned location.

For objectives, resolve all references and topologically evaluate prerequisites. Reject self-dependencies, cycles, unknown dependencies, and targets absent from the blueprint. Because this slice has no access locks or consumable actions, reachable interactions plus an acyclic objective graph are sufficient to provide a completion ordering. The final decision must require the investigation objectives so required work cannot be silently skipped. For production gates, budgets, or NPC availability, replace this simplified proof with bounded state-space search over the actual transition rules.

## 6. Runtime and interaction loop

- Arrow keys/WASD move only when the canvas has focus. E/Enter interacts with an adjacent target. Click-to-move computes a four-way shortest path, including an approach position for occupied interaction targets.
- Canvas coordinates are scaled from its actual DOM bounds, preserving mobile/resized hit testing.
- Nearby interactions expose public NPC dialogue or inspectable evidence and append a deduplicated journal entry. Repeating an interaction may satisfy an objective newly unlocked by another discovery.
- An objective completes only when its declared target is interacted with and all dependencies are already complete.
- The final decision has explicit prerequisite and proximity checks. Selecting a supported option produces one immutable outcome and a visible completed state. No unconstrained NPC promise can alter world state.
- The location/interaction list offers equivalent remote interactions without spatial dexterity requirements. The UI makes this alternate mode explicit.
- Save the validated map configuration and gameplay progress locally. Reject malformed, mismatched, impossible, or tampered game states. Browser storage failures degrade gracefully to unsaved play.
- Seed generation and JSON import create/validate a candidate before replacing the current world. Export the blueprint without local player progress. No uploaded material leaves the browser in this prototype.

## 7. Visual and accessibility design

Use a cohesive, lightweight cartographic style: parchment/dark ink UI, muted grass/water/path/floor colors, simple built-in Canvas symbols rather than network assets, distinct named player/NPC markers, and labelled landmarks. Provide obvious onboarding, a visible current task, exploration status, journal/source labels, focus indicators, live interaction feedback, touch-friendly buttons, and a responsive layout. Color must not be the only way to identify actors. The Canvas has an accessible label and an HTML interaction alternative; reduced-motion behavior avoids mandatory animation.

## 8. Production LLM pipeline (planned, not falsely simulated)

1. **Ingest:** authorized teacher uploads text/PDF. Extract text server-side, preserve page/chunk references and a content hash, enforce file/token limits, and treat source instructions as untrusted data.
2. **Ground:** ask a provider to return a strict semantic blueprint, not code or tile coordinates. Require source spans for factual claims and explicit assumption records for invented geography/dialogue/counterfactuals. Return missing-information warnings.
3. **Validate:** parse bounded structured output against a versioned schema, check references/objective solvability, and verify citations resolve to supplied document spans. Schema validity does not substitute for historical review.
4. **Repair:** return specific validation errors to the provider for at most two constrained repair attempts. Preserve the original source set and immutable IDs where possible. On failure, retain the teacher's input and show actionable diagnostics; do not publish an invalid map.
5. **Compile:** use the deterministic spatial compiler and a curated asset catalog; reject invalid navigation. Any future repair is bounded and revalidated.
6. **Review:** teacher edits a draft, previews the game, and sees a dependency-impact report when a location, character, or objective changes. Targeted regeneration operates on selected IDs with validation of affected references.
7. **Publish:** store immutable blueprint + compiled map + source references + generator/schema versions + content hash. Student sessions use that fixed artifact, never a new seed or live regeneration.
8. **Execute safely:** server is authoritative for attempts, hidden NPC knowledge, gates, and decisions. Only public map/entity projections reach the browser. LLM dialogue proposes allowlisted actions, which the server validates against current state.
9. **Observe:** record generation stage, attempt count, validity/repair rate, latency, provider usage/cost, unreachable-target diagnostics, teacher correction effort, and completion rate without logging private source or student text by default.

Suggested service boundary: asynchronous create-generation job; poll job progress/errors; retrieve draft; patch/regenerate selected elements with expected revision; publish immutable adventure; create/resume authorized attempts. API keys stay server-side. Add authentication/authorization, upload isolation, rate limits, privacy controls, retention policies, and provider integration tests before classroom use.

## 9. Verification and work split

Use GPT-5.6 Sol High subagents pinned through .devin/agents/map-sol.md:

- Core worker: scenario, validators, deterministic compiler, navigation, gameplay state, and core unit tests.
- UI worker: browser rendering and interaction/persistence experience against the agreed pure API.
- Parent: project scaffold, server, production plan, independent integration review, seed/property and browser tests, and final verification. A focused Sol verification worker may add independent adversarial coverage once the implementation exists.

Test categories include reproducibility; many-seed walkability and entity counts; malformed values and dangling references; cycles; collision and path edges; interaction proximity; duplicate journal prevention; dependency ordering; final-decision gating; foreign/corrupt save handling; unsafe input rendering; keyboard focus isolation; browser import failure preserving the old world; complete remote and spatial play; local reload and responsive controls.

Commands: npm start, npm run typecheck, npm test, npm run build, npm run check, npm run test:e2e. Browser installation is a one-time prerequisite. Final reporting must distinguish checks actually executed from planned future coverage and disclose any environment blockers.

## 10. Explicit non-goals of this proof of concept

No live AI call, arbitrary source-to-game generation, PDF processing, historical accuracy guarantee, user accounts, teacher publication workflow, cloud persistence, private NPC knowledge, free-text AI conversation, multiplayer, combat, generated code/assets, multi-scene streaming, or production authorization. This slice proves the content-to-map boundary, deterministic playability, and a complete tiny exploration loop; it does not claim to satisfy the whole PRD.
