# v3 build: Yi Hao: Authoring

> Start here in a fresh session. This file is self-contained: the shared context is repeated in every
> person's file. Branch off `main`; the PRD lives in `docs/`.

## Your area
Turning a teacher's sources into a valid, checked adventure, and the teacher screens for creating and reviewing it.

**You own:** `packages/spec-v3`, `packages/generation` (except `src/sources`, which is Damian's), `apps/web/src/app/v3/teacher`
(except `preview` and `summary`, which are Damian's), and `components/teacher`.
**You depend on:** `packages/jobs` from Damian (D1 11:00 interface, Checkpoint 1 working); the sources step from Damian
(Checkpoint 1).
**Others depend on you:** `spec-v3` and the fixture skeleton (Kevin, D1 11:00); generated specs that pass `checkSpec`
(Kevin and Damian, Checkpoint 1).

**Reuse:** ingest and extraction in `packages/generation/src/ingest`; image generation in `packages/generation/src/assets`.
The v2 spec, planner and pipeline (`generation/src/spec`, `planner`) stay for v2; build v3 next to them.

**Constraints:** each generation step must be idempotent (it may be retried) and finish in under 300 s; split any step
that might not. Steps run in this order: `sources → skeleton → (stageDetails ∥ personas) → endings → reveal → check → repair`
[G12].

## To-do
**By D1 11:00**
- [ ] **H** `packages/spec-v3`: zod `AdventureSpec` and `validateSpec()`
- [ ] **L** `fixtures/golden-1819.json` skeleton matching the schema (Kevin writes the content)

**By Checkpoint 1 (D1 19:00)**
- [ ] **L** `checkSpec()`: every reference resolves
- [ ] **L** `checkSpec()`: the historical ending is reachable
- [ ] **L** `checkSpec()`: at least 2 endings are open at the final decision
- [ ] **L** `checkSpec()`: each core discovery is reachable in its stage
- [ ] **L** `checkSpec()`: every item has a source label
- [ ] **H** Skeleton step [G12.3]
- [ ] **H** Stage-details step
- [ ] **H** Personas step [G7]
- [ ] **H** Endings step [G6]
- [ ] **H** Reveal-content step [E3]
- [ ] **M** Repair step (redoes only the failing parts) [G12.2]
- [ ] **L** `scripts/generate-v3.ts` runs every step locally (until the job runner is ready)

**By Checkpoint 2 (D2 13:00)**
- [ ] **L** Move the steps onto `packages/jobs`
- [ ] **M** `/v3/teacher/new`: create, with Quick or Standard mode and progress [T6, T6.1]
- [ ] **M** Skeleton review and edit, re-running `checkSpec` on each edit [T6.2]
- [ ] **M** Review screen: by stage, character, document and ending, with labels and conflicts [T3, T4.2]
- [ ] **L** Direct edits [T4.3]
- [ ] **M** Plain-language "regenerate this part" [T4.4, T4.1]
- [ ] **L** Teacher library lists v2 and v3 adventures together, with a version badge
- [ ] **L** "New adventure" creates v3 only
- [ ] **M** `scripts/eval-generation.ts` over 5 topics: pass rate, `checkSpec` failures, and whether each spec plays through the engine

## Shared context (identical in all three files)

**What we're building:** Historical Adventures v3, as specified in [`../PRD-v3.md`](../PRD-v3.md), with the reasoning in
[`../PRD-v3-rationale.md`](../PRD-v3-rationale.md). For a quick start, read [`../prd-v3/overview.md`](../prd-v3/overview.md)
and [`../prd-v3/glossary.md`](../prd-v3/glossary.md) first. Requirement IDs in brackets (for example [P13]) refer to the PRD.

**Team:** Kevin (manager, Gameplay engine), Yi Hao (Authoring), Damian (Play and platform). Kevin decides anything not covered here.

**Deadlines:**
| When | Milestone |
|---|---|
| D1 11:00 | Contract packages exist (see below) |
| D1 19:00 | **Checkpoint 1:** `golden-1819` plays from briefing to reveal through the real API, engine and screens |
| D2 13:00 | **Checkpoint 2:** a generated adventure goes create → review → edit → preview → play → reveal → class summary |
| D2 evening | Pilot-ready, behind the flag |

**Decisions already made:**
- v3 is built **beside v2**. **v2 games stay playable**, and all new adventures are v3.
- **v2 behaviour must not change.** Shared packages (`game-core`, `game-client`, `orchestration`, `generation`) get v3 options or modules added; v2 code paths are never altered or removed.
- v3 maps have **no doors** (a map option); v2 maps keep theirs.
- Outside sources: an allowlist by default, which teachers can extend [G13, T7]. The mechanism is the model's built-in web search with an allowed-domains filter (Damian may change this).
- **Hosting is moving to AWS** (the EC2 host in `infra/aws`) once we are off the current Vercel production. Until then, `main` deploys Vercel previews and the AWS staging host (`aws-deploy.yml`), and `production` deploys prod on Vercel and applies the hosted Supabase migrations (the `migrate` job in `ci.yml`). Build for both: keep every request and job step under 300 s (Vercel's `maxDuration`; Fluid compute is on), and don't depend on anything only one host has. The job runner's every-minute safety net is the `jobs-tick` systemd timer on EC2, not `pg_cron`.

**Rules:**
- All v3 code sits behind the `V3_ENABLED` flag plus a test-school allowlist.
- Database changes are additive only (`*_v3` tables, new functions), each with row-level security from its first migration. Only Damian adds migrations.
- Merge your own PRs when CI is green. A PR touching someone else's folder needs their review.
- Contract changes go through Kevin.
- Test with the test school and test accounts, never real teachers' data.
- Commits carry no AI co-author lines.

**Contract packages (the only code everyone imports):**
- `packages/spec-v3` (owner: Yi Hao): `AdventureSpec` zod schema and types; `validateSpec(spec)`; `checkSpec(spec)` (consistency checks [G12.4, G15]). It covers role, stages, rooms, characters (persona, stances, triggers, slants), discoveries (conditions, `core`, source label), documents (key passages, provenance), story events, defining moments (acts, outcome rules), endings (historical, alternative, secret), reveal and source labels [G1–G17].
- `packages/play-contract` (owner: Kevin): zod types for
  - `Action` = `message | insertNote | selectPassage | enterRoom | openDocument | closeDocument | endStage | act | predict | interviewAnswer | continue | tick`. `continue` moves past screens with no choice; `tick` (sent every ~15 s and on load) runs time rules. Slants are confronted by inserting the note from the contradicting passage or account; there is no "show document" action.
  - `PlayerView`: phase (`briefing | stage | epilogue | interview | reveal`), messages, notes, visible characters with their stance id, open documents, available acts, timer
  - `GameEvent`: discovery, stanceChange, challenge, act, outcome, prediction, verdict, hint, storyEvent, flag, phase
  - `ClassSummary` [T2.1–T2.7]
- Engine interface (owner: Kevin), `packages/engine` (`@adventure/engine`):
  - `createState(spec, seed)`
  - `step({ spec, state, action }, { llm, now, rng }) → { state, view, events }`
  - `project(spec, state) → PlayerView`, which never exposes undiscovered or hidden content
  - `runPostTurnCheck(spec, state, messageId, { llm })`: the post-turn check runs off the chat path. The API returns the reply first, then in `after()` runs the check and applies it with the internal `postTurn` action (exported by the engine, never accepted from a client), retrying on a revision conflict.
  - `summarise(spec, attempts: { attemptId, events }[]) → ClassSummary`
  - `@adventure/engine/mock` returns scripted views for UI work.
- Job runner interface (owner: Damian), `packages/jobs`: `defineStep(name, run)`, `enqueue(jobId, steps, deps)`, `getProgress(jobId)`.
- **Golden fixture:** `fixtures/golden-1819.json`, a hand-checked Singapore 1819 adventure valid against `spec-v3`. CI validates it on every PR.

**Review tags on to-do items** (all code is written by AI agents; tags say how much human judgement each needs):
- **H:** check the behaviour: play it, read 10+ outputs, iterate the prompt or rule. Skip reading the diff.
- **M:** review the diff and its tests once (correctness, security, concurrency).
- **L:** merge when CI is green.
