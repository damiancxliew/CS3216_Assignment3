# Kickoff prompts

One prompt per owner. Paste yours into a **fresh Devin session** (your own, so it runs on your own
quota) and it will start on your slice without needing the meeting context re-explained.

Each prompt is self-contained: it points at the specs in this repo, names the tasks you own with
their validation, and states the boundary you must not cross so four sessions can run in parallel
without colliding.

How to use them:

1. Start a session on `github.com/damiancxliew/CS3216_Assignment3`.
2. Paste your prompt verbatim; edit the two placeholders (`<your branch>` and anything in `TODO:`).
3. Let it read `docs/PRD.md`, `docs/TEAM_PLAN.md` and `docs/EXECUTION_SPEC.md` **before** it writes
   code — the prompts already instruct this.
4. One PR per task group, not one giant PR. Small PRs are how four people stay unblocked.

**Before anyone starts feature work, C0 must be done** (the four frozen contracts and their stubs on
`main` — see `EXECUTION_SPEC.md` §2). C0 is a joint task; the contract-author prompts below carry it.

---

## Kevin — Resolver, agents, safety

```text
You are working on github.com/damiancxliew/CS3216_Assignment3, a CS3216 Assignment 3 project due
Fri 25 Sep 2026 23:59. Read docs/PRD.md, docs/TEAM_PLAN.md and docs/EXECUTION_SPEC.md first; they
are the source of truth and I do not want them re-litigated. Also read AGENTS.md and src/core.ts on
the PoC branch to understand the existing pure-core design.

I own the AI orchestration slice: the Resolver/Orchestrator, the character-agent runtime, and the
safety rails. My tasks are K1-K11 in EXECUTION_SPEC.md §3.1. A task is done when its validation in
that table passes, not when the code is written — write the test alongside the code.

Start with, in this order:
1. K1 — a deterministic fake Resolver behind the I4 resolution payload contract, no LLM involved.
   This is on the C0 critical path tonight: everyone else builds against it.
2. The action allow-list (EXECUTION_SPEC §2) — the complete closed set of agent actions the world
   can execute. It is a frozen interface, so get it right before others encode it.
3. K2 — one character agent answering in-room, using only the shared historical context plus its
   own private context.

Non-negotiable constraints, from the PRD:
- Server authority: private agent context, probability rolls and Resolver rationale must never
  appear in any client payload (FR-21). Assert it in a test, do not assume it.
- Agents are autonomous but budgeted (FR-12a/b): capped actions per stage, only stage-relevant
  agents ticked, idle agents yield. Build the rails in from the start; they are not a later
  optimisation.
- Decisions are options-only (D18/FR-14). Free text is conversation and may change which options
  exist; it never becomes an action.
- Outcomes are probabilistic, actions are not (D10), and consequences are never previewed (D11).
- Every LLM call uses OpenAI structured outputs with schema validation and a bounded repair retry
  (D14). Record the repair rate — M11/M12 need the number.
- The Resolver emits effects[] only from the frozen catalogue in PRD FR-15b; an unknown id is
  dropped by the allow-list rather than failing the turn.

Do not touch: the Phaser renderer, the map compiler, the ingest pipeline, or the Supabase schema —
other people own those. Stub anything you need from them behind the frozen interfaces in
EXECUTION_SPEC §2 rather than waiting or reaching into their code. Do not modify specs.md.

Work on a branch off main, open a PR per task group (not one giant PR), and keep CI green. Ask me
before changing any of the four frozen contracts — everyone else is already building against them.
```

---

## Yi Hao — Game client, compiler, atmosphere

```text
You are working on github.com/damiancxliew/CS3216_Assignment3, a CS3216 Assignment 3 project due
Fri 25 Sep 2026 23:59. Read docs/PRD.md (especially §7.1), docs/TEAM_PLAN.md and
docs/EXECUTION_SPEC.md first; they are the source of truth. I wrote the PoC on the PoC branch —
read AGENTS.md, MAP_GENERATION_PLAN.md, src/core.ts and src/render.ts there before changing
anything.

I own the game client, the map compiler and the atmosphere layer. My tasks are Y1-Y8 in
EXECUTION_SPEC.md §3.2. A task is done when its validation in that table passes.

Start with, in this order:
1. Y1 — extract src/core.ts from the PoC into a shared package that imports cleanly in both browser
   and Node. The existing Vitest suite must pass unchanged from the new path; that is the proof.
2. The I2 map artifact schema and the frozen overlay/effect id list (EXECUTION_SPEC §2). Both are
   on the C0 critical path tonight — Kevin's resolution payload encodes the effect ids, so the list
   has to be closed before he writes it.
3. Y2 — port the renderer to Phaser 3 under the constraints in PRD §7.1.

Non-negotiable constraints, from the PRD:
- core.ts stays pure and authoritative for tile occupancy, findPath, collision, interaction range
  and save identity. Phaser renders and tweens toward the positions core.ts returns; Phaser arcade
  physics is NOT used for movement or collision. If the renderer owns a rule, the server stops
  being authoritative and FR-7-FR-9 break.
- Determinism: same spec + seed + generator version produces an identical artifact, in Node and in
  the browser. Test it by hash equality.
- The chat, decision, journal and accessible interaction panels stay DOM, outside the Phaser
  canvas, and remain a keyboard-complete path — a full adventure must be completable keyboard-only
  with the canvas ignored.
- Playwright cannot see inside the canvas: assert through the DOM panels plus a GameState test
  hook. Do not rewrite the e2e suite as coordinate clicks.
- Atmosphere (D19/FR-15a-c) is cosmetic only. The stage advances whether or not an effect played;
  honour prefers-reduced-motion and give every effect a text equivalent in the transcript.

Timebox the Phaser port to one day. If it is not rendering the PoC map by tonight, say so — the
agreed fallback is that Monday's vertical slice ships on the existing Canvas renderer and the port
lands after. The port is renderer-only, so core.ts, the compiler and their tests are untouched
either way.

Do not touch: the Resolver/agent runtime, the ingest pipeline, or the Supabase schema. Stub what you
need behind the frozen interfaces in EXECUTION_SPEC §2. Do not modify specs.md.

Work on a branch off main, open a PR per task group, keep CI green.
```

---

## Di Heng — Ingest, generation, evals

```text
You are working on github.com/damiancxliew/CS3216_Assignment3, a CS3216 Assignment 3 project due
Fri 25 Sep 2026 23:59. Read docs/PRD.md, docs/TEAM_PLAN.md and docs/EXECUTION_SPEC.md first; they
are the source of truth. Also read MAP_GENERATION_PLAN.md on the PoC branch — it already describes
the ingest-to-publish pipeline this slice implements.

I own ingest, the generation pipeline and the evals. My tasks are D1-D8 in EXECUTION_SPEC.md §3.3.
A task is done when its validation in that table passes.

Start with, in this order:
1. The I1 adventure spec v2 schema — the PoC's Blueprint v1 extended with stages[], rooms[],
   agents[].privateContext, decisionOptions[].branchTarget, assetEligibility[] and ambientOverlay.
   This is the C0 critical path tonight: Kevin, Yi Hao and Damian all build against it. Commit one
   hand-authored valid spec as a fixture alongside it.
2. D1 — PDF/text upload and server-side extraction with page-accurate source spans.
3. D3 — the planner prompt turning documents into a schema-valid spec.

Non-negotiable constraints, from the PRD:
- The LLM generates a spec, never map coordinates, geometry or executable game code (D3). The
  deterministic compiler owns all of that.
- Every generated claim carries a source span back to a real page. Documented history and
  simulated assumption must stay distinguishable all the way to the debrief screen.
- Invalid planner output is repaired within a bounded retry or reported as missing information. It
  is never silently accepted and never published.
- Image generation (D4/FR-6) is for scene/story-specific entities ONLY — character portraits, named
  landmarks, story props. Terrain, structural and UI art is curated and must fail validation if
  requested. Cap 8 generated images per adventure, cache by prompt hash.
- Generation never blocks publish (FR-6a): pending, failed or content-filtered images fall back to
  the curated placeholder and the adventure stays playable. Prove it by stubbing the image service
  to fail and completing a full playthrough.
- Source documents are untrusted input. They are delimited data, never promoted to instructions.

The eval harness (D7) is worth real marks (M11) and is easy to leave until Thursday — do not. Get a
runnable harness over 3 documents up by Tuesday, even a crude one, and grow it. Record validity
rate, repair rate, latency, tokens and cost per adventure (D8); the M12 write-up must use these
real numbers, not estimates.

Do not touch: the Phaser renderer, the Resolver/agent runtime, or the Supabase schema. Stub what
you need behind the frozen interfaces in EXECUTION_SPEC §2. Do not modify specs.md.

Work on a branch off main, open a PR per task group, keep CI green.
```

---

## Damian — Platform, product surface, launch

```text
You are working on github.com/damiancxliew/CS3216_Assignment3, a CS3216 Assignment 3 project due
Fri 25 Sep 2026 23:59. Read docs/PRD.md (especially §6 and §7), docs/TEAM_PLAN.md and
docs/EXECUTION_SPEC.md first; they are the source of truth.

I own the platform, the teacher/student product surface and the launch materials. My tasks are
P1-P10 in EXECUTION_SPEC.md §3.4. A task is done when its validation in that table passes.

Start with, TODAY, in this order — my slice gates everyone else's environment:
1. P1 — Supabase project and the schema from PRD §6, applied via migrations so a fresh database can
   be rebuilt with one command. Never by hand.
2. P9 — deploy the (empty) Next.js app to Vercel with the shared OpenAI key in the environment, and
   instrument analytics TODAY. Milestone 19 is graded on real insight from real events, which needs
   days of data, not hours. This is the single most time-sensitive task in the project.
3. I3 with Kevin — the Turn API route handlers (POST /attempt/:id/message, POST
   /attempt/:id/decision, GET /attempt/:id/state) returning canned public state, so the client can
   build against them tonight.

Non-negotiable constraints, from the PRD:
- Every API response is a public projection of state. No private agent context, unrevealed event,
  probability roll or Resolver rationale ever reaches the client (FR-21).
- RLS is not optional: a teacher sees only their own adventures, a student only their own attempts.
  Write a negative test per table using a second account.
- Publishing is immutable (P4): a teacher editing after publish creates a new version and must not
  disturb an in-flight attempt.
- Stage timers (D12/FR-16): adventure-wide default with a per-stage override, null inherits, 0
  disables. The deadline is held server-side on attempt.stage_deadline_at and the client only
  renders the countdown — a refresh or a client clock change must not buy extra time. On expiry the
  player's decision is recorded as a pass and the Resolver resolves without them.
- The ending/debrief must visually separate documented history (with citations) from simulated
  assumption, and show where the simulation diverged.

Do not touch: the Resolver/agent runtime, the Phaser renderer, or the generation pipeline. Stub what
you need behind the frozen interfaces in EXECUTION_SPEC §2. Do not modify specs.md.

Work on a branch off main, open a PR per task group, keep CI green. I also own the M0-M6, M14 and
M18-M20 write-ups; draft each one the day the corresponding feature lands rather than on Friday.
```

---

## Shared session (optional, whoever has spare quota)

```text
You are working on github.com/damiancxliew/CS3216_Assignment3, due Fri 25 Sep 2026 23:59. Read
docs/PRD.md, docs/TEAM_PLAN.md and docs/EXECUTION_SPEC.md.

Do not implement feature slices — four people own those. Your job is the integration seam nobody
owns:

1. Keep AGENTS.md current as the contract between slices as the four frozen interfaces evolve.
2. Build the end-to-end integration test from EXECUTION_SPEC §4.1: fresh database, fresh account,
   upload -> generate -> publish -> play a full 3-stage adventure -> ending. Run it after every
   merge to main and report what broke, to the owner of that slice.
3. Maintain the release-gate checklist in EXECUTION_SPEC §4.1 as a live status in the PR.

Report failures; do not fix another person's slice without asking them first.
```
