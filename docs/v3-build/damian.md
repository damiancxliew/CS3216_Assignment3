# v3 build: Damian: Play and platform

> Start here in a fresh session. This file is self-contained: the shared context is repeated in every
> person's file. Branch off `main`; the PRD lives in `docs/`.

## Your area
Everything a student touches, the end of the game (Interview and reveal), and the plumbing: data, sessions, background
jobs and outside sources.

**You own:** `supabase/` (the only migration owner), `packages/jobs`, `packages/engine/src/{hints,events,interview,reveal}`,
`packages/generation/src/sources`, `apps/web/src/app/api/v3`, `apps/web/src/lib/play` (v3 parts), `apps/web/src/app/v3/play`,
`apps/web/src/app/v3/teacher/{preview,summary}`, `components/play` (v3 parts), and the v3 options in `packages/game-client`
and `packages/game-core`.
**You depend on:** `play-contract` and `@adventure/engine/mock` from Kevin (D1 11:00); `engine.step` (Checkpoint 1); `ClassSummary`
(Checkpoint 2).
**Others depend on you:** the `packages/jobs` interface (Yi Hao, D1 11:00) and a working runner (Checkpoint 1); the
sources step (Yi Hao, Checkpoint 1); the session API (Checkpoint 1).

**Reuse:** the v2 save pattern (optimistic revisions, pinned versions) in `apps/web/src/lib/play/store.ts`; the map compiler
in `packages/game-core/src/compiler.ts`; the renderer in `packages/game-client/src/tiled-view.ts`; image generation in
`packages/generation/src/assets`; the quote verification in `packages/generation/src/ingest`. Next's `after()` is already
used for background work (`apps/web/src/app/teacher/actions.ts`).

**Job runner design:** a `job_steps` table; `claim_job_step()` using `FOR UPDATE SKIP LOCKED`; a route
`POST /api/v3/jobs/tick` (`maxDuration` 300) that runs one step, marks its dependants ready and re-triggers itself once
per ready step; on AWS, the `jobs-tick.timer` systemd timer calls the route every minute as a safety net.
`pg_cron`/`pg_net` are only for hosted Supabase if ever needed; a shared-secret header guards the route. It must not
depend on the teacher's browser tab.

## To-do
**By D1 11:00**
- [x] **M** `packages/jobs` interface: `defineStep`, `enqueue`, `getProgress`
- [x] **M** Migration: `adventures_v3` (id, school_id, status, spec jsonb, spec_version)
- [x] **M** Migration: `job_steps`
- [x] **M** Migration: `attempts_v3` (id, adventure_id, spec_version, student_id, state jsonb, revision)
- [x] **L** Migration: `attempt_events_v3` (attempt_id, seq, type, payload jsonb)
- [x] **L** Migration: `flags_v3`

**By Checkpoint 1 (D1 19:00)**
- [x] **M** `claim_job_step()`, using `FOR UPDATE SKIP LOCKED`
- [x] **M** `POST /api/v3/jobs/tick`
- [x] **L** On AWS, `jobs-tick.timer` calls the route every minute; use `pg_cron`/`pg_net` only for hosted Supabase if ever needed
- [x] **L** `POST /api/v3/attempts`
- [x] **L** `GET /api/v3/attempts/:id` → `PlayerView`
- [x] **M** `POST /api/v3/attempts/:id/actions`: optimistic revision, `engine.step`, save `state` and `events`
- [x] **L** Rate limit and per-attempt cost ceiling [C5–C7]
- [ ] **M** Sources step: allowlisted web search and excerpt extraction [G13, T7]
- [ ] **M** Sources step: word-for-word quote check and source labels [G13.2, G1.2]
- [ ] **L** Screen: role briefing [P18]
- [ ] **H** Screens: chat, notes panel, inserting a note into chat [P8, P13]
- [ ] **H** Screen: document reader with passage selection [P11]
- [ ] **L** Portraits by stance id [G4.2]
- [ ] **L** Play route picks v2 or v3 by the adventure's version (v2 attempts keep working)
- [x] **L** Switch from `@adventure/engine/mock` to `@adventure/engine`

**By Checkpoint 2 (D2 13:00)**
- [ ] **M** Hints that escalate with time left [P5, P5.1.1]
- [ ] **M** Story events [P12]
- [ ] **H** Interview: push-back prompt and logic [E2]
- [ ] **M** Reveal assembly, including source labels [E3]
- [ ] **H** Screens: defining moment, acts and one-tap prediction [P9, P3]
- [ ] **L** Screen: epilogue [E1]
- [ ] **M** Screen: Interview
- [ ] **M** Screen: reveal
- [ ] **L** `/v3/teacher/:id/preview`: play screens without saving an attempt [T4.8]
- [ ] **L** `/v3/teacher/:id/summary`: class summary tabs [T2]
- [ ] **L** v3 maps without doors: an option in the map compiler and renderer (v2 unchanged)
- [ ] **L** Moderation results → `flags_v3` [T5]
- [ ] **L** Per-stance portrait generation step [G4.2]

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
