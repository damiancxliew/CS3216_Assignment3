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
| D6 | **A round = one decision, not one chat.** Unlimited chat within a stage; the stage ends when the decision is made, the objective is met, or the optional timer expires. | "One round is one decision, not one chat." Real-time pressure is not the point (`specs.md` §5.6). |
| D7 | **Rooms with doors.** Everyone in a room shares one chat and one shared context. NPC agents can move between rooms and talk to each other. Any occupant may close the door to exclude others. | Parliament analogy: conversations are not always 1-on-1, and some must be private. |
| D8 | **Compartmentalised context.** One shared historical context for everyone + one private context per agent (persona, motivations, hidden interests, knowledge horizon). Private context is never sent to the client. | "They all know what led up to this point, but not what the other person is thinking." |
| D9 | **A Resolver/Orchestrator LLM** sits above the agents: it watches each conversation, updates the decision options available to the player, resolves the round once all parties have decided, writes the new world state, and advances/branches the stage. | Diagram: agents → decisions → Resolver → shared context/state → game engine. |
| D10 | **Outcomes are probabilistic, actions are not.** The player chooses *what they do*; whether it works is resolved by the Resolver against context (a peace treaty can be backstabbed; an attack can fail). | "Stochastic… it is probabilistic. Because we want to highlight the complexity of history." |
| D11 | **Consequences are not previewed.** No repercussion preview before committing; learning happens in the post-game debrief. | "They should learn from their mistakes." |
| D12 | **Not deciding is a decision.** On timer expiry the player passes and the world resolves without them. | Explicit in the meeting. |
| D13 | **Elimination → spectator mode.** If the player's faction is destroyed, they keep watching the world resolve instead of being kicked out. | Diagram has a `Spectator` node. |
| D14 | **Model tiering:** strongest model for the Resolver/Orchestrator and ingest planning, mid-tier for character agents, cheapest for incidental text. Schema-validated (typesafe) structured output everywhere. | Cost control; cache is not shared across models, so tiering must be per-call and deliberate. |
| D15 | **Target session length:** ~15 min in class, ~30 min self-directed. | Classroom periods are short. |

## 3. Users and core flows

Unchanged from `specs.md` §3/§6. Concretely for the MVP:

**Teacher:** sign in → create adventure → upload PDF/paste text + setting + learning objectives +
student role → review the LLM-proposed **stage plan, stakeholders and personas** → edit/regenerate any
element → preview as player → publish (immutable version) → share link → review attempts.

**Student:** open link → sign in → read role brief → spawn in stage 1 map → walk/click between rooms →
chat with stakeholders (shared room chat; close the door for privacy) → collect evidence into the
journal → make the stage decision (pick an option or propose in natural language) → watch the Resolver
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
  what they have personally seen/been told. They may move between rooms and talk to each other; the
  player only learns of that through in-world consequences or hearsay.
- FR-13 The Resolver observes every exchange and updates the player's available decision options after
  each material conversation (an angered stakeholder removes the cooperative option, etc.).
- FR-14 Decisions: pick a generated option or type a free-text proposal. Free text is interpreted into
  an allowed action and **the interpretation is shown for confirmation** before commit.
- FR-15 Resolution: the Resolver takes all parties' actions + full state and produces a structured
  outcome — per-agent state deltas, world/context updates, public announcement, private notes, next
  stage or ending. Outcomes are probabilistic and never previewed to the player.
- FR-16 Timer per stage is optional and teacher-set; expiry = pass.
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
adventure(id, owner_id, title, setting, status, published_version, content_hash)
source(id, adventure_id, kind, title, storage_key, page_map)
spec_version(id, adventure_id, version, json, generator_version, created_by)
stage(id, spec_version_id, index, title, shared_context, timer_seconds, branch_map)
room(id, stage_id, name, purpose, door_default)
agent(id, stage_id, name, role, public_position, private_context, model_tier, start_room_id)
evidence(id, stage_id, room_id, text, source_span)
objective(id, stage_id, title, requires[], target_id)
decision_option(id, stage_id, label, preconditions, branch_target)
map_artifact(id, stage_id, seed, json)          -- compiler output, immutable
attempt(id, adventure_id, published_version, student_id, current_stage, status)
attempt_state(attempt_id, world_state json, journal json, player_pos, updated_at)
agent_memory(attempt_id, agent_id, transcript json, private_notes json)
message(id, attempt_id, room_id, author_type, author_id, body, visibility, created_at)
resolution(id, attempt_id, stage_id, actions json, outcome json, rolls json, created_at)
```

## 7. Tech stack (proposal — needs the team's sign-off, see §10)

| Layer | Proposal | Notes / alternatives considered |
| --- | --- | --- |
| Frontend | Next.js (App Router) + React + TypeScript strict | Needed anyway for the landing page, SEO and OG tags (Milestone 18) |
| Game view | Keep the PoC's Canvas 2D renderer, or Phaser 3 | The PoC is **plain Canvas 2D**, not Phaser, despite what was said in the meeting. Decision needed — see §10.1 |
| Game core | Port `PoC/src/core.ts` (pure, synchronous, browser+Node) as a shared package | Runs identically client- and server-side, which is what makes the server authoritative |
| Backend | Next.js route handlers + a job runner for generation | Generation is long-running; needs progress polling |
| DB | Postgres (Supabase) + pgvector for source retrieval | Supabase also covers auth and storage in one dependency |
| Auth | Supabase Auth with Google sign-in (teacher + student identity) | Assignment requires meaningful use of identity |
| LLM | Tiered: frontier model for planner/Resolver, mid-tier for agents, image model for assets | Structured outputs + schema validation (Zod) on every call |
| Hosting | Vercel | Preview deploys per PR |
| Testing | Vitest (core + prompt/eval harness), Playwright (browser) | Already set up on `PoC` |
| Analytics | GA4 or PostHog | Milestone 19 requires real data — instrument on day 1 |

## 8. MVP scope (what ships by 25 Sep)

**In:** teacher sign-in, upload/paste → generated spec → stage editor → publish; 1–3 stages;
3–4 stakeholders; rooms with doors and shared chat; NPC agents with private context; free movement;
room chat; Resolver-updated decision options; probabilistic resolution; persistence + resume; ending
debrief with source/simulation labelling; landing page; analytics; eval harness.

**Out (say so explicitly in the write-up):** multiplayer, voice, combat, agent-vs-agent autonomous
scheming beyond scripted opportunities, mobile layout, classroom management/grading, arbitrary
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

1. **Phaser 3 vs the existing Canvas renderer.** The PoC does not use Phaser. Porting costs a day;
   staying on Canvas costs sprite/animation polish. Owner: Yi Hao.
2. **Do NPC agents act autonomously between player turns**, or only when spoken to plus a scripted
   Resolver-driven "offscreen event"? Full autonomy is the expensive option. Owner: Kevin.
3. **Timer on or off by default**, and is it per stage or per adventure? Owner: Damian.
4. **How many generated images per adventure** (cost cap) and are they blocking for publish? Owner: Di Heng.
5. **Free-text decisions in the MVP** or options-only with free text as the stretch? Owner: Kevin.
6. Provider mix for the model tiers, and whether cross-model prompt caching loss is acceptable. Owner: Yi Hao.
