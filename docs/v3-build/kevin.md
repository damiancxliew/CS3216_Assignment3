# v3 build: Kevin: Gameplay engine and manager

> Start here in a fresh session. This file is self-contained: the shared context is repeated in every
> person's file. Branch off `main`; the PRD lives in `docs/`.

## Your area
The game's brain: the rules that decide what characters reveal and how they react, the characters' voice, and the
recorded events. Plus managing the build: decisions, integration and historical accuracy.

**You own:** `packages/play-contract`, `packages/engine` (except `src/hints`, `src/events`, `src/interview` and
`src/reveal`, which are Damian's), and the v3 modules in `packages/orchestration`.
**You depend on:** `spec-v3` and the fixture skeleton from Yi Hao (D1 11:00).
**Others depend on you:** the `play-contract` and `@adventure/engine/mock` (Damian, D1 11:00); `engine.step` (Damian, Checkpoint 1);
`ClassSummary` (Damian, Checkpoint 2).

**Reuse:** the LLM client in `packages/orchestration/src/llm`. **Leave in place** the v2 resolver, minting, autonomous turns
and stage runtime (`orchestration/src/resolver`, `stage`, `agent`), because v2 games still use them.

## To-do
**By D1 11:00**
- [ ] **L** Confirm the Vercel plan's maximum function duration; tell Yi Hao and Damian if it's under 300 s
- [ ] **M** `packages/play-contract`: zod types for `Action`, `PlayerView`, `GameEvent` and `ClassSummary`
- [ ] **L** `@adventure/engine/mock`, returning scripted `PlayerView`s

**By Checkpoint 1 (D1 19:00)**
- [ ] **M** `engine.createState(spec, seed)`
- [ ] **M** `engine.step({ spec, state, action }, { llm, now, rng }) → { state, view, events }`
- [ ] **M** `engine.project(spec, state) → PlayerView` (no hidden content)
- [ ] **H** Discovery conditions → notes [G5, P8]
- [ ] **H** Stance triggers [G4, P13]
- [ ] **H** `insertNote`, including challenges to made-up claims [P13.4–P13.6]
- [ ] **H** Defining moment: act → outcome rules [P9]
- [ ] **M** Closing off endings [G6]
- [ ] **M** Timer and final call [P1.1, P1.2]
- [ ] **H** Character persona prompt [G7]
- [ ] **H** Post-turn check: one structured call → `{ conveyed, assertedUndiscovered, moderation }` [P16, P17]
- [ ] **H** `fixtures/golden-1819.json` content, by 15:00 (on Yi Hao's schema)
- [ ] **L** Fixture tests: every ending is reachable in `golden-1819`

**By Checkpoint 2 (D2 13:00)**
- [ ] **L** `summarise(spec, attempts) → ClassSummary`
- [ ] **M** Simulated-student runs on `golden-1819`, with failures logged
- [ ] **H** History check of the core discoveries in generated skeletons

**Manager**
- [ ] Run both checkpoints; decide what gets cut if a checkpoint fails
- [ ] Spend your judgement on three things: game feel in the rules, the characters' voice, historical accuracy

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
- We stay on **Vercel and Supabase**. `main` deploys previews; `production` deploys to prod and applies the hosted Supabase migrations (`apps/web/vercel.json`, the `migrate` job in `ci.yml`). Vercel functions are capped at 300 s (`maxDuration`), which every plan allows with Fluid compute on.

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
