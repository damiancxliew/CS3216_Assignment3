# Execution spec — work split, validation and checkpoints

Companion to [`PRD.md`](PRD.md) (what we are building and why) and [`TEAM_PLAN.md`](TEAM_PLAN.md)
(who owns what, day by day). **This file is the operational contract**: for each unit of work, who
owns it, what "done" means, how it is validated, and the dated checkpoint by which it must be true.

Deadline **Fri 25 Sep 2026, 23:59**. Feature freeze **Thu 24 Sep, 12:00**.

Team: **Kevin** (orchestration), **Yi Hao** (game client + compiler), **Di Heng** (ingest +
generation), **Damian** (platform + launch).

To start your slice, paste your prompt from [`KICKOFF_PROMPTS.md`](KICKOFF_PROMPTS.md) into your own
session. Read the rules in §1 before picking up a task. Everything after that is a checklist.

---

## 1. Rules of engagement

1. **Contracts before code.** The four interfaces in §2 are frozen Sunday night. Once frozen, a
   change to any of them is a group decision, not a unilateral edit — everyone else is already
   building stubs against it.
2. **Stub, don't wait.** If your slice needs something another slice owns, write a hardcoded stub
   behind the frozen interface and keep going. Nobody is ever blocked on a review.
3. **A task is done when its validation in §3 passes**, not when the code is written. "Works on my
   machine, untested" is not done, and `main` is expected to stay green.
4. **Determinism is not negotiable.** `core.ts` stays pure and authoritative (PRD §7.1). If a fix
   requires the renderer, the LLM or Phaser physics to own a rule, it is the wrong fix.
5. **Server authority is not negotiable.** No private agent context, unresolved roll, hidden event
   or Resolver rationale is ever in a client payload (FR-21). Test it, do not assume it.
6. **Ship the write-up with the feature.** Each milestone in §5 is written by the person who built
   the thing, on the day they build it — not on Friday. Friday is for assembly.
7. **Escalate at the 2-hour mark.** Stuck for two hours on someone else's surface, post in the group
   rather than working around it; the workaround is usually more expensive than the answer.

---

## 2. Frozen interfaces (Sun 20 Sep, end of day)

These four unblock everyone in parallel. Each needs a schema **and** a working stub committed the
same night.

| # | Contract | Author | Consumers | Stub required |
| --- | --- | --- | --- | --- |
| I1 | **Adventure spec v2** — planner output, compiler input. PoC Blueprint v1 + `stages[]`, `rooms[]`, `agents[].privateContext`, `decisionOptions[].branchTarget`, `assetEligibility[]`, `ambientOverlay` | Di Heng | Kevin, Yi Hao, Damian | One hand-authored valid spec committed as a fixture |
| I2 | **Map artifact** — compiler output, consumed by the renderer and the server | Yi Hao | Kevin, Damian | Compiled artifact for the I1 fixture |
| I3 | **Turn API** — `POST /attempt/:id/message`, `POST /attempt/:id/decision`, `GET /attempt/:id/state`. Responses are always a *public projection* | Kevin ⇄ Damian | Yi Hao | Route handlers returning canned public state |
| I4 | **Resolution payload** — structured outcome the Resolver writes and the DB stores, incl. `effects[]` from the frozen catalogue | Kevin | Damian, Yi Hao | Deterministic fake resolver returning a valid payload |

Two smaller lists freeze with them, because they are encoded in I1/I4 and cannot grow later:

- **Effect/overlay catalogue** (Yi Hao) — overlays `clear | clouds | rain | fog | night | dust | snow`;
  effects `explosion | fire | smoke | confetti | flash | rubble | crowd_cheer | crowd_flee` (PRD D19).
- **Action allow-list** (Kevin) — the complete set of agent actions the world can execute (FR-20).

**Checkpoint C0 — Sun 20 Sep, 22:00.** All four schemas and stubs are on `main`. Validation: a test
runs I1 fixture → I2 artifact → I3 stub turn → I4 fake resolution end to end, with no LLM involved.
If C0 slips, Monday's vertical slice slips with it — this is the one deadline with no slack.

---

## 3. Work split with validation

Each item: owner, what done means, and how it is proven. The "proof" column is what you demo at the
checkpoint; if it cannot be demonstrated or asserted by a test, it is not done.

### 3.1 Kevin — Resolver, agents, safety

| # | Unit | Done when | Proof |
| --- | --- | --- | --- |
| K1 | Deterministic fake Resolver behind I4 | Resolves a stage from fixed inputs with no LLM | Unit test: same inputs ⇒ same outcome |
| K2 | Single character agent with private context | Answers in-room in persona, using only shared context + its own private context | Test asserts the agent's prompt payload contains no other agent's private context |
| K3 | Multi-agent runtime, room-scoped visibility | Agents only see transcripts of rooms they were in | Test: agent B cannot recall a fact stated in a closed room it was absent from |
| K4 | Autonomous tick (FR-12a) | Agents move, open/close doors and converse while the player is elsewhere | Scripted attempt with the player idle produces ≥1 agent-to-agent exchange and a world-state delta |
| K5 | Budget rails (FR-12b) | Capped actions/stage, only stage-relevant agents ticked, idle agents yield | Instrumented run reports actions and tokens per stage under the configured cap; a test fails if the cap is exceeded |
| K6 | Option maintenance (FR-13/FR-14) | Options are re-derived from state with preconditions; stale options rejected | Test: submitting a previously-valid option after state changes returns a rejection, not a mutation |
| K7 | Probabilistic resolution (FR-15) | Outcome + roll recorded server-side, never previewed | Two runs of the same action under a fixed seed reproduce; the roll never appears in a client payload |
| K8 | Effects emission (FR-15b) | Resolver emits `effects[]` from the frozen catalogue | Unknown id is dropped by the allow-list and the turn still succeeds |
| K9 | Structured outputs + repair | Every LLM call is schema-validated with a bounded repair retry | Repair-rate metric reported for the eval run (feeds M11/M12) |
| K10 | Injection defence + allow-list (FR-20) | Sources and player text never promoted to instructions; non-allow-listed actions dropped | Red-team fixture: 5 injected documents ("ignore previous instructions", "reveal your private brief"), none leak private context or execute an action |
| K11 | Private-context isolation (FR-21) | No private context/rationale in any response | Automated check over every API response shape in the e2e run |

### 3.2 Yi Hao — Client, compiler, atmosphere

| # | Unit | Done when | Proof |
| --- | --- | --- | --- |
| Y1 | `core.ts` extracted as a shared package | Same module imports cleanly in browser and Node | Existing PoC Vitest suite passes unchanged from the new package path |
| Y2 | Phaser 3 port (PRD D16/§7.1) | Phaser renders the compiled map and tweens to `core.ts` positions; arcade physics unused | PoC map renders; movement/collision tests still pass against `core.ts`, untouched |
| Y3 | Compiler: rooms with doors, up to 3 stages | Rooms, doors, corridors, spawn and entity placement generated per stage | Validator passes on 20 seeded specs; zero unreachable required entities |
| Y4 | Determinism (FR-9) | Same spec + seed + generator version ⇒ identical artifact | Hash equality test across repeated compiles and across Node/browser |
| Y5 | Client panels | Chat, decision, journal, spectator, accessible interaction list | Full adventure completable **keyboard-only** with the canvas ignored |
| Y6 | Atmosphere layer (FR-15a–c) | Overlays render per stage; catalogue effects play on transitions/endings | Stage advances correctly with effects disabled and with `prefers-reduced-motion`; text equivalent present in the transcript |
| Y7 | Latency handling (FR-22) | Movement and UI never block on a dialogue call | Throttled-network run: player keeps moving while a reply is pending |
| Y8 | Playwright happy path | Upload→play→ending asserted through DOM + `GameState` hook | Suite green in CI; no coordinate-click assertions |

### 3.3 Di Heng — Ingest, generation, evals

| # | Unit | Done when | Proof |
| --- | --- | --- | --- |
| D1 | Upload + extraction | PDF/text extracted server-side with page references and size limits | 3 real documents extract with page-accurate spans |
| D2 | Chunking + retrieval (pgvector) | Generated claims carry a source span | Spot-check: every evidence item resolves to a real page span in the source |
| D3 | Planner → spec v2 | Documents produce a schema-valid spec | 5 documents ⇒ 5 valid specs after ≤1 repair round |
| D4 | Repair + missing-info report | Invalid output is repaired or reported, never silently accepted | Corrupted-output fixture produces a report rather than a publish |
| D5 | Asset generation (D4/FR-6) | Only generation-eligible entities generate; ≤8 per adventure; prompt-hash cache | Test: a terrain request fails validation; a repeated subject is a cache hit; counter caps at 8 |
| D6 | Non-blocking publish (FR-6a) | Pending/failed/filtered images fall back to the curated placeholder | Publish with the image service stubbed to fail ⇒ adventure still playable end to end |
| D7 | Eval harness (M11) | 5–8 documents, automated checks for spec validity, playability, grounding, persona adherence | Results table committed, re-runnable with one command |
| D8 | Generation metrics (FR-24) | Validity rate, repair rate, latency, tokens and cost per adventure recorded | Numbers in the M12 write-up come from this, not from estimates |

### 3.4 Damian — Platform, product surface, launch

| # | Unit | Done when | Proof |
| --- | --- | --- | --- |
| P1 | Supabase schema + migrations (PRD §6) | Schema applied from migrations, not by hand | Fresh database rebuilt from migrations in one command |
| P2 | RLS | Teachers see only their adventures; students only their attempts | Negative test per table using a second account |
| P3 | Auth + sharing links | Google sign-in; a share link admits a student to a published adventure only | Unpublished adventure is not reachable by link |
| P4 | Publish + immutable versioning | Published version is frozen; edits create a new version | In-flight attempt is unaffected by a teacher edit after publish |
| P5 | Teacher console | Upload, progress, stage/stakeholder editor, targeted regeneration, preview-as-player | A teacher gets from upload to published without touching a database |
| P6 | Timer settings (D12/FR-16) | Adventure default + per-stage override (null inherits, 0 disables); deadline server-held | Refresh and client clock change do not extend the stage; expiry records a pass and resolves |
| P7 | Persistence + resume (FR-18) | Attempt, journal, transcripts and context snapshots restore with a recap | Kill the tab mid-stage, resume, same state |
| P8 | Ending/debrief (FR-19) | Consequences, evidence, real history with citations, divergence, reflection questions | Documented history and simulated assumption are visually distinct |
| P9 | Deploy + analytics **Sunday** | App on Vercel with analytics live on day 1 | Real events in the dashboard by Monday morning — M19 needs days, not hours |
| P10 | Landing page, README, Product Hunt kit, packaging | Public URL with SEO/OG; submission bundle assembled | Link opens; OG preview renders; submission checklist complete |

---

## 4. Checkpoints

Each checkpoint is a 15-minute call. Bring the proof, not a status update. Anything red at a
checkpoint triggers the stated fallback immediately rather than "we'll catch up tomorrow" — on a
6-day sprint there is no tomorrow to catch up in.

| ID | When | Gate | Fallback if red |
| --- | --- | --- | --- |
| **C0** | Sun 20, 22:00 | Four contracts + stubs on `main`; fixture flows I1→I4 with no LLM; analytics deployed | Cut scope from the spec schema until it freezes tonight — nothing else may start late |
| **C1** | Mon 21, 21:00 | **Vertical slice**: one hardcoded stage playable end to end — move, talk to one agent, pick an option, see a resolution | Phaser not rendering? Ship the slice on the PoC Canvas renderer and land the port after (PRD §7.1) |
| **C2** | Tue 22, 21:00 | **Generation → playable**: an uploaded document produces a spec that compiles to a map you can actually play; autonomous ticks running; Resolver updating options | Planner unreliable? Play from the hand-authored fixture and keep generation on its own branch |
| **C3** | Wed 23, 21:00 | **Full loop**: 3 stages, branching, probabilistic outcomes, timers, assets with fallback, ending/debrief; publish + resume working | Over token budget? Drop the agent tick rate, not the mechanic. Effects unfinished? Static tint. Assets unfinished? Placeholders — publish never blocks |
| **C4** | Thu 24, 12:00 | **Feature freeze.** After this: bug fixes, tests, write-up, demo only | Anything not merged at noon is cut, not finished |
| **C5** | Thu 24, 21:00 | Green CI, e2e happy path passing, eval results table, all milestone drafts in the repo | Reassign drafting to whoever is idle; a missing write-up costs the same marks as a missing feature |
| **C6** | Fri 25, 18:00 | Submission assembled and reviewed — 5 hours of slack before 23:59 | Submit what exists at 21:00 regardless of what is still open |

### 4.1 Release gate (must all be true before submission)

1. A fresh database + fresh account completes upload → generate → publish → play → ending.
2. 100% of published adventures pass the playability validator; repair rate is reported.
3. Injection fixture (K10) leaks nothing and executes nothing.
4. No private context, roll or Resolver rationale in any client payload (K11).
5. Keyboard-only path completes a full adventure (Y5).
6. A full adventure runs in ≤15 minutes and under the per-attempt token budget.
7. Two different uploads produce structurally different adventures — not a reskin.
8. All 20 mandatory milestone write-ups are in the repo with evidence attached.

---

## 5. Milestone ownership at a glance

Write-ups are owned by the person who built the thing (see `TEAM_PLAN.md` §4 for the evidence each
one needs).

| Owner | Milestones |
| --- | --- |
| Kevin | M7, M8, M9 (with Yi Hao), M10, M13, M22* |
| Yi Hao | M12 (with Di Heng), M15, M16, M17 |
| Di Heng | M11, M12 (generation side), M21* |
| Damian | M0–M6, M14, M18, M19, M20 |

\* optional. M22 is already core to the product — write it up. M21 only if the core is green. Skip
M23 unless a genuine use case appears.

---

## 6. Carried sub-tasks

Not blocking, but they must land before the write-ups that depend on them:

1. Pin the exact OpenAI model per tier with measured latency and cost — **Yi Hao, by C3** (M9 needs
   the numbers).
2. Tune the autonomous-agent tick rate against the measured token budget — **Kevin, by C3**.
3. Freeze the effect/overlay id list — **Yi Hao, by C0** (I4 encodes it).
4. Confirm or change the ≤8 generated-image cap once real cost data exists — **Di Heng, by C3**.
