# PRD — AI-Generated Historical Adventures (v2, post-design-meeting)

Status: draft for team sign-off. Supersedes nothing: `docs/specs.md` remains the product-level
requirements document; this file records the **concrete system design and scope decisions** made in
the 20 Sep design meeting and turns them into buildable requirements.

Sources: meeting transcript (Kevin, Yi Hao, Di Heng, Damian), the Excalidraw architecture diagram,
`specs.md`, and the `PoC` branch (`AGENTS.md`, `MAP_GENERATION_PLAN.md`, `src/core.ts`).

Deadline: **Fri 25 Sep 2026, 23:59** (CS3216 Assignment 3). Everything below is scoped against that.

---

## 1. Product in one line

A teacher drops in historical source material; the system generates a small, playable 2D world where
a student roams rooms, talks to LLM-driven historical stakeholders who each have private motivations,
and makes decisions whose consequences are resolved probabilistically and carried forward.

## 2. What the meeting decided (design deltas vs `specs.md`)

| # | Decision | Rationale from the meeting |
| --- | --- | --- |
| D1 | **Desktop web, 2D top-down tile map.** Both click-to-travel and WASD/arrow movement. | Secondary-school students have laptops in class, phones are locked away. Movement is kept because "it's cooler" and cheap — the PoC already does both. |
| D2 | **Single player in the MVP.** The player is modelled as just another agent, so multiplayer stays possible later. | Multiplayer adds decision-resolution complexity and breaks historical grounding ("I'm Hitler but I play nice"). Excluded in `specs.md` §8 too. |
| D3 | **The LLM generates a *spec*, not the map.** A deterministic, seeded compiler turns the spec + predefined tiles into the map. | Guarantees playability/reachability; already proven by `PoC/src/core.ts`. |
| D4 | **Hybrid assets:** predefined tileset (grass, wall, floor, water, path) + on-the-fly image-generated landmarks/portraits (e.g. a Merlion, a period building). | Cheap, cohesive, and demonstrates multimodal I/O for Milestone 7/10. |
| D5 | **Stages, not days.** An adventure has **at most 3 stages**; each stage is one map + one decision point; stages can branch. Stages are proposed by the LLM at ingest and are **editable by the teacher**. | "This whole stage is one event… after you make the decision you progress to the next stage." |
| D6 | **A round = one decision, not one chat.** Unlimited chat within a stage; the stage ends when the decision is made, the objective is met, or the stage timer expires. | "One round is one decision, not one chat." Real-time pressure is not the point (`specs.md` §5.6). |
| D7 | **Rooms with doors.** Everyone in a room shares one chat and one shared context. NPC agents can move between rooms and talk to each other. Any occupant may close the door to exclude others. | Parliament analogy: conversations are not always 1-on-1, and some must be private. |
| D8 | **Compartmentalised context.** One shared historical context for everyone + one private context per agent (persona, motivations, hidden interests, knowledge horizon). Private context is never sent to the client. | "They all know what led up to this point, but not what the other person is thinking." |
| D9 | **A Resolver/Orchestrator LLM** sits above the agents: it watches each conversation, updates the decision options available to the player, resolves the round once all parties have decided, writes the new world state, and advances/branches the stage. | Diagram: agents → decisions → Resolver → shared context/state → game engine. |
| D10 | **Outcomes are probabilistic, actions are not.** The player chooses *what they do*; whether it works is resolved by the Resolver against context (a peace treaty can be backstabbed; an attack can fail). | "Stochastic… it is probabilistic. Because we want to highlight the complexity of history." |
| D11 | **Consequences are not previewed.** No repercussion preview before committing; learning happens in the post-game debrief. | "They should learn from their mistakes." |
| D12 | **Timer on by default, per stage, teacher-configurable.** Each stage has its own countdown whose length the host sets in adventure settings; on expiry the player passes, the Resolver resolves the stage without their decision, and play advances to the next stage. | Decided 20 Sep (Damian). Keeps a class period bounded (D15) while letting the teacher lengthen a research-heavy stage; "not deciding is a decision" was explicit in the meeting. |
| D13 | **Elimination → spectator mode.** If the player's faction is destroyed, they keep watching the world resolve instead of being kicked out. | Diagram has a `Spectator` node. |
| D14 | **OpenAI as the single provider, tiered per use case:** strongest model for the Resolver/Orchestrator and ingest planning, mid-tier for character agents, cheapest for incidental text, plus an OpenAI image model for assets. Schema-validated (typesafe) structured output everywhere. | Decided 20 Sep (Yi Hao). One SDK, one key, one billing view, and native structured outputs — no time in a 6-day sprint for a provider abstraction. Cost control comes from tiering, not from shopping around. Caches are per-model, so tier deliberately per call, not per request path. |
| D15 | **Target session length:** ~15 min in class, ~30 min self-directed. | Classroom periods are short. |
| D16 | **Phaser 3 for the game view.** The PoC's Canvas renderer is replaced; `core.ts` stays the authority for movement, pathfinding and collision, and Phaser only renders and tweens what it returns. | Decided 20 Sep (Yi Hao), resolving the meeting's assumption. Buys sprite atlases, tweened walking, camera follow and a scene manager for the ≤3 stages; the cost is ~1 day of porting plus e2e rework (see §7.1). |
| D17 | **NPC agents act autonomously between player turns.** Each is modelled exactly like the player — own private context, own goals, free movement between rooms, same door mechanic for privacy, no shared state or information — differing only in that the stage decision belongs to the player. | Decided 20 Sep (Kevin). Symmetry is the point: the world must keep moving whether or not the student is in the room, and an NPC who can scheme behind a closed door is what makes the debrief interesting. Costs more tokens than reactive agents; FR-12b holds the budget controls that keep it affordable. |
| D18 | **Decisions are options-only; free text clarifies, it does not propose.** The player picks from the Resolver-maintained option list; free text is conversation with stakeholders and may cause the Resolver to add, remove or reword options, but never becomes an action directly. | Decided 20 Sep (Kevin). Removes the interpret-then-confirm round trip and the whole class of "the model invented an action the world cannot execute" failures, which also shrinks the action allow-list attack surface (FR-20). Free-text *proposals* move to the stretch list. |

## 3. Users and core flows

Unchanged from `specs.md` §3/§6. Concretely for the MVP:

**Teacher:** sign in → create adventure → upload PDF/paste text + setting + learning objectives +
student role → review the LLM-proposed **stage plan, stakeholders and personas** → edit/regenerate any
element → preview as player → publish (immutable version) → share link → review attempts.

**Student:** open link → sign in → read role brief → spawn in stage 1 map → walk/click between rooms →
chat with stakeholders (shared room chat; close the door for privacy) → collect evidence into the
journal → make the stage decision (pick from the current option list) → watch the Resolver
apply consequences → stages 2–3 → ending + debrief.

## 4. System architecture (MVC as drawn)

```
VIEW            game canvas (tiles, sprites, chat bubbles) | chat panel | decision panel | journal
                teacher console (upload, stage editor, preview, publish)
   ^ update view                                        | player chat / decisions
   |                                                    v
MODEL           game engine + authoritative world state  <-- API -->  LOGIC
                Postgres: adventures, stages, agents,                 Resolver/Orchestrator LLM
                contexts, attempts, chat logs, journals               N character agents (own context)
                object storage: sources, generated assets             player agent (the student)
```

Hard rules:

- **Server-authoritative.** Private agent context, hidden knowledge, gates, decision resolution and
  probability rolls live on the server. The browser only ever receives public projections.
- **LLM output is a proposal, never an effect.** Every agent/Resolver output is parsed against a
  versioned schema and validated against current state before it can change the world
  (`MAP_GENERATION_PLAN.md` §8.8).
- **Deterministic compiler owns geometry.** Coordinates, collision, reachability and asset choice come
  from the seeded compiler, not from the model.

## 5. Functional requirements

### 5.1 Ingest & generation (teacher)

- FR-1 Accept pasted text and text-based PDF; extract server-side, chunk with page references, store a
  content hash. Enforce size/token limits. Treat source text as untrusted data, not instructions.
- FR-2 Planner LLM returns a **structured adventure spec**: setting summary, shared historical context,
  1–3 stages, 3–4 stakeholders with public position + private motivation + knowledge horizon, rooms per
  stage, evidence items with source spans, objectives, and per-stage decision options with branch targets.
- FR-3 Every factual claim carries a source span; every invented detail is recorded as an explicit
  simulation assumption. Missing information is reported, not invented silently.
- FR-4 Schema validation + up to two bounded repair round-trips. An invalid spec is never published.
- FR-5 Teacher edits any field, regenerates a single element by ID, and sees which objectives/decisions
  are affected. Publish freezes an immutable version.
- FR-6 Asset pipeline: map tiles come from the curated set; up to N landmark/portrait images are
  generated per adventure, cached by prompt hash, and reviewed by the teacher before publish.

### 5.2 Map compilation

- FR-7 Seeded compiler turns each stage's spec into a validated map: rooms as rectangles with a door
  tile, corridors, spawn, NPC/evidence/decision entity placement.
- FR-8 Independent validator proves: all rooms reachable, every required NPC/evidence has a reachable
  adjacent tile, no entity in a blocked tile, objective graph acyclic and satisfiable, ending reachable.
- FR-9 Same spec + seed + generator version ⇒ identical map and identical save identity.

### 5.3 Gameplay

- FR-10 Movement: WASD/arrows while the canvas has focus, click-to-travel via shortest path, and an
  equivalent accessible location/interaction list with identical gameplay effects.
- FR-11 Room chat: one conversation per room shared by all occupants; the player sees chat bubbles
  above characters plus a transcript panel. Closing the door blocks entry and hides the transcript from
  non-occupants.
- FR-12 Character agents hold their own context window: shared historical context + private persona +
  what they have personally seen/been told. No agent reads another agent's context or any transcript
  it was not present for.
- FR-12a Agents are **autonomous** (D17): on each tick an agent may move to another room, open or
  close a door, start or join a conversation, or act on its goals, whether or not the player is
  present. Agent-to-agent exchanges run behind closed doors as real exchanges, not narration, and the
  player learns of them only through in-world consequences, hearsay, or by being in the room.
- FR-12b Autonomy runs on a budgeted tick, not free-running: at most N agent actions per stage, only
  agents relevant to the current stage are ticked, an agent with nothing to do yields, and the
  per-attempt token budget (FR-23) caps the total. Ticks are server-side and continue while the
  player is elsewhere on the map.
- FR-13 The Resolver observes every exchange — including agent-to-agent ones — and updates the
  player's available decision options after each material development (an angered stakeholder removes
  the cooperative option, a secret deal between two NPCs adds a new one).
- FR-14 Decisions are **options-only** (D18): the player commits by picking from the current option
  list. Free text is for talking to stakeholders; it can change which options exist, but is never
  itself an action. Options carry preconditions and are re-derived from state, so a stale option can
  never be committed.
- FR-15 Resolution: the Resolver takes all parties' actions + full state and produces a structured
  outcome — per-agent state deltas, world/context updates, public announcement, private notes, next
  stage or ending. Outcomes are probabilistic and never previewed to the player.
- FR-16 Each stage has a countdown timer, on by default. Its length is a per-stage setting the teacher
  edits before publishing (with an adventure-wide default and the option to disable it for a stage).
  The remaining time is always visible to the player. On expiry the stage closes to new actions, the
  player's decision is recorded as a pass, the Resolver resolves the stage from the other parties'
  actions, and play advances to the next stage or the ending.
- FR-17 Eliminated players continue as spectators and see the remaining resolution.
- FR-18 Persistence: attempts, journals, chat logs, and context snapshots are saved server-side and
  resumable with a recap.
- FR-19 Ending: decision/consequence summary, evidence encountered, what actually happened historically
  with citations, where the simulation diverged, and reflection questions.

### 5.4 Trust, safety, cost

- FR-20 Prompt-injection defence: source documents and player free text are delimited and never
  promoted to system instructions; agent output is allow-listed against supported actions.
- FR-21 No private NPC context, unrevealed events, or resolver rationale in any client payload.
- FR-22 Rate limits and per-attempt token budget; latency of a dialogue call must not freeze movement
  or other UI.
- FR-23 Age-appropriate conflict handling; content filter on generated dialogue and images.
- FR-24 Telemetry: generation validity/repair rate, latency per stage, tokens and cost per completed
  adventure, completion/abandonment.

## 6. Data model (v2 sketch)

```
adventure(id, owner_id, title, setting, status, published_version, content_hash, default_timer_seconds)
source(id, adventure_id, kind, title, storage_key, page_map)
spec_version(id, adventure_id, version, json, generator_version, created_by)
stage(id, spec_version_id, index, title, shared_context, timer_seconds, branch_map)  -- timer_seconds null = inherit adventure default, 0 = disabled
room(id, stage_id, name, purpose, door_default)
agent(id, stage_id, name, role, public_position, private_context, model_tier, start_room_id)
evidence(id, stage_id, room_id, text, source_span)
objective(id, stage_id, title, requires[], target_id)
decision_option(id, stage_id, label, preconditions, branch_target)
map_artifact(id, stage_id, seed, json)          -- compiler output, immutable
attempt(id, adventure_id, published_version, student_id, current_stage, status, stage_deadline_at)
attempt_state(attempt_id, world_state json, journal json, player_pos, updated_at)
agent_memory(attempt_id, agent_id, transcript json, private_notes json)
message(id, attempt_id, room_id, author_type, author_id, body, visibility, created_at)
resolution(id, attempt_id, stage_id, actions json, outcome json, rolls json, created_at)
```

## 7. Tech stack

| Layer | Proposal | Notes / alternatives considered |
| --- | --- | --- |
| Frontend | Next.js (App Router) + React + TypeScript strict | Needed anyway for the landing page, SEO and OG tags (Milestone 18) |
| Game view | **Phaser 3** (D16), replacing the PoC's Canvas 2D renderer | Alternative considered: keeping plain Canvas, which works today but needs manual tweening, camera and sprite animation. See §7.1 for the porting constraints |
| Game core | Port `PoC/src/core.ts` (pure, synchronous, browser+Node) as a shared package | Runs identically client- and server-side, which is what makes the server authoritative |
| Backend | Next.js route handlers + a job runner for generation | Generation is long-running; needs progress polling |
| DB | Postgres (Supabase) + pgvector for source retrieval | Supabase also covers auth and storage in one dependency |
| Auth | Supabase Auth with Google sign-in (teacher + student identity) | Assignment requires meaningful use of identity |
| LLM | **OpenAI only** (D14), tiered: frontier model for planner/Resolver, mid-tier for character agents, cheapest for incidental text, OpenAI image model for assets | Structured outputs + schema validation (Zod) on every call. Alternatives considered: a multi-provider router (rejected — abstraction cost in a 6-day sprint) and single-model-everywhere (rejected — the Resolver needs the frontier model, the agents do not). Exact model per tier is pinned by Yi Hao with measured latency/cost for Milestone 9 |
| Hosting | Vercel | Preview deploys per PR |
| Testing | Vitest (core + prompt/eval harness), Playwright (browser) | Already set up on `PoC` |
| Analytics | GA4 or PostHog | Milestone 19 requires real data — instrument on day 1 |

### 7.1 Phaser porting constraints (D16)

Phaser wants to own the game loop and the entity lifecycle. It must not also own the rules, or the
server stops being authoritative and the deterministic guarantees in FR-7 – FR-9 are lost.

- `core.ts` stays pure and remains the single source of truth for tile occupancy, `findPath`,
  collision, interaction range and save identity. Phaser's arcade physics is **not** used for
  movement or collision.
- The Phaser scene is a view over the compiled map artifact: it reads tiles and entity positions and
  tweens sprites toward the tile positions `core.ts` returns. Input is captured by Phaser and
  dispatched as the same `movePlayer` / `interact` calls the PoC already uses.
- One Phaser scene per stage; stage transitions are scene swaps, which is most of what D16 buys.
- The accessible interaction list (FR-10) and the chat/decision/journal panels stay DOM, outside the
  Phaser canvas, and remain the keyboard-complete path through the game.
- Playwright cannot see inside the canvas, so e2e assertions go through the DOM panels plus a test
  hook exposing the current `GameState`; do not rewrite the e2e suite as coordinate clicks.
- Budget: ~1 day, and it is on the critical path for nothing but the client — the compiler and core
  tests are unaffected because the port is renderer-only.

## 8. MVP scope (what ships by 25 Sep)

**In:** teacher sign-in, upload/paste → generated spec → stage editor → publish; 1–3 stages;
3–4 stakeholders; rooms with doors and shared chat; autonomous NPC agents with private context,
including agent-to-agent exchanges behind closed doors; free movement; room chat; Resolver-updated
decision options; options-only decisions; probabilistic resolution; per-stage timers; persistence +
resume; ending debrief with source/simulation labelling; landing page; analytics; eval harness.

**Out (say so explicitly in the write-up):** multiplayer, voice, combat, free-text decision
*proposals* (options-only in the MVP — D18), mobile layout, classroom management/grading, arbitrary
historical periods, generated game code.

## 9. Success criteria

Inherits `specs.md` §10, plus meeting-specific ones:

1. Two different uploads produce two structurally different adventures (different rooms, stakeholders,
   decision trees) — not a reskin.
2. 100% of published adventures pass the playability validator; repair rate is reported.
3. Provably different endings: the same adventure played cooperatively vs antagonistically reaches
   different stage branches.
4. A stakeholder who was lied to behaves measurably differently in a later stage (demo-able).
5. A full adventure completes in ≤15 min and under the per-attempt token budget.

## 10. Open decisions (need an owner and an answer before Mon EOD)

1. ~~Phaser 3 vs the existing Canvas renderer.~~ **Resolved 20 Sep — Phaser 3** (D16, §7.1). Owner: Yi Hao.
2. ~~Do NPC agents act autonomously between player turns?~~ **Resolved 20 Sep — fully autonomous,
   symmetric with the player, no shared state** (D17, FR-12a/b). Owner: Kevin.
3. ~~Timer on or off by default, per stage or per adventure?~~ **Resolved 20 Sep — on by default, per
   stage, length set by the teacher in settings** (D12, FR-16). Owner: Damian.
4. **How many generated images per adventure** (cost cap) and are they blocking for publish? Owner: Di Heng.
5. ~~Free-text decisions in the MVP or options-only?~~ **Resolved 20 Sep — options-only, free text
   clarifies only** (D18, FR-14). Owner: Kevin.
6. ~~Provider mix for the model tiers.~~ **Resolved 20 Sep — OpenAI only, tiered per use case**
   (D14). Owner: Yi Hao. Remaining sub-task: pin the exact model per tier with measured latency/cost
   for Milestone 9.

Only item 4 is still open.
