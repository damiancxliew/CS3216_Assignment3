# Handoff: Kevin's local session (14–16 Oct 2026)

What this session achieved for the v3 build, as of `main` at `bc8af9d` (after #205). It records results only, not next steps.

## 1. Kevin's brief (`kevin.md`): all engineering items built and merged

| Item | Where | PR |
|---|---|---|
| Docs: brief fixes, spec-field list for Yi Hao, checkpoint runbooks and cut lists | `docs/v3-build/{kevin,yihao,damian}.md`, `engine-spec-needs.md`, `checkpoints.md` | #164 |
| `play-contract` zod types (`Action`, `PlayerView`, `GameEvent`, `ClassSummary`) | `packages/play-contract` | #165 |
| `@adventure/engine/mock` (scripted views for Damian's screens) and the `v3.yml` CI job | `packages/engine/src/mock`, `.github/workflows/v3.yml` | #165 |
| Character persona prompt and post-turn check (`{ conveyed, assertedUndiscovered, moderation }`) | `packages/orchestration/src/v3` | #166 |
| Engine core (`createState`, `step`, `project`) and the rules: discoveries, stance triggers, `insertNote` challenges, the defining moment's act → outcome rules, closing endings, the timer and final call | `packages/engine/src` | #167 |
| `fixtures/golden-1819.json`, its build script, the history review sheet, and reachability and leak tests | `fixtures/`, `packages/engine/scripts/golden-1819.ts`, `packages/engine/tests` | #167, #182 |
| `summarise(spec, attempts) → ClassSummary` | `packages/engine/src/summary` | #168 |
| Simulated-student harness (6 profiles, real models) | `packages/engine/evals/sim.ts` | #179 |
| History check for generated adventures (citation, word-for-word quote, second-opinion model) | `packages/engine/evals/history-check.ts` | #179 |
| End-to-end smoke test of golden-1819 against the local app | `scripts/v3-smoke.ts` | #191 |

**Engine and fixture facts:**
- `EngineSpec` is another name for spec-v3's `AdventureSpec`, so the engine reads Yi Hao's schema directly.
- `project` never sends undiscovered or hidden content. A leak test checks every view the explorer reaches.
- Once the defining moment opens or the final call fires, students can no longer walk between rooms, pick up documents or select passages. Re-reading a document they hold still works.
- Golden-1819:
  - Ahmad the interpreter; 2 stages, 6 characters, 16 discoveries, 5 documents, 4 endings (one secret).
  - The real document quotes the treaty of 6 February 1819 word for word. The saved source is `fixtures/sources/treaty-1819-wikisource.txt`.
  - Core claims carry word-for-word citations to the handout, the treaty and NLB.
  - It passes `validateSpec` and `checkSpec` with no errors. The explorer reaches all 4 endings and keeps at least 2 open at the final decision.
- Persona and check eval, on 28 hand-labelled exchanges:
  - conveyed: precision 1.0, recall 0.875;
  - unearned-claim detection: F1 0.889;
  - every abusive message flagged, nothing else.
  - Transcripts are in `packages/orchestration/evals/results/v3-persona/`.
- Simulated students: all 6 profiles reached the reveal, with no crashes and no leaks. Replies took about 1.7 s, and model cost was about US$0.0024 per attempt.
  - **The bug they found:** in stage 2, a character hinted at a stage-1 fact the student never uncovered. Fixed in #179.
- The second-opinion model in the history check judged all 9 of golden's core claims accurate (`fixtures/golden-1819.history-check.md`). That's advisory only; Kevin hasn't signed off yet.

## 2. Decisions recorded

- **Vercel:** Fluid compute is on, so functions can run 300 s.
- **Hosting:** the move to the EC2 host in `infra/aws` is formal, and written into all three briefs.
  - Until the switch, `main` deploys Vercel previews and AWS staging, and `production` deploys Vercel prod and runs the hosted Supabase migrations.
  - Every request and job step must stay under 300 s.
  - The every-minute safety net for jobs is Damian's `jobs-tick` systemd timer, not `pg_cron`.
- **Contract additions:**
  - The `Action` union gained `tick`, `continue`, `enterRoom`, `openDocument` and `closeDocument`.
  - `summarise` takes `(spec, attempts: { attemptId, events }[])`.
- **Fields the engine needed, recorded in `engine-spec-needs.md`:** discovery `topic`, outcome `historical`, `trustNotice`, ending `title`, `reveal`, `teacherQuestions`.

## 3. Reviews, fixes and merges on teammates' PRs

Every review ran through subagents. Small issues were fixed on the author's branch and merged; problems that needed a migration or a product decision became issues.

**Yi Hao:**
- **#175, skeleton pass.**
  - Source ids and titles are cleaned, and teacher notes are delimited, so neither can inject instructions.
  - Core claims need a quote.
  - The pass has a 270 s overall budget.
  - Size limits are reported as warnings.
  - **Import cycle:** `spec-v3`'s `index.ts` and `skeleton.ts` imported each other, which broke `next build`. `Role` and `DOCUMENT_KINDS` moved to `spec-v3/src/shared.ts`.
- **#178, stage details and personas.**
  - **Real documents:** a document marked `real` must cite a source and match it paragraph by paragraph (G13.2).
  - Repair calls count in the metrics.
  - Every piece of an elided quote must be at least 12 characters.
- **#195, hint angles:** merged without changes.
- **#196, endings pass:** a moment with no conditional rule gets a `rules-unconditional` warning (G6).
- **#203, reveal pass.**
  - The secret-leak check matches only whole strings of 8+ characters.
  - The teacher-only interpretations warning may name sources.
  - A draft that already fails `checkSpec` fails before the model call.
  - The `--draft` script warns when it recovers no slanted documents.
  - **Landing:** #203 merged into `feat/v3-endings`, not `main`, because its base wasn't retargeted after #196 merged. #205 brought it onto `main`.

**Damian:**
- **#185, follow-ups to his already-merged PRs.**
  - The job lease is 285 s, and the tick route returns a clean 500 when a claim fails.
  - Polling for the post-turn check backs off for about 50 s.
  - Narration and notices stay visible after a room change.
  - The `findQuote` check is tighter.
- **#181, hints and story events:** merged without changes. A suggested change to the stuck-time calculation was reverted, because it contradicted Damian's tests and P5.1.1 is ambiguous.
- **#183, end-of-game screens.**
  - A double click on the Interview form could close the Interview early; fixed.
  - Merging `main` left two "ready to decide" buttons, so the one from #185 was removed.
  - Passage selection is off once the defining moment opens.
  - Continue buttons ignore clicks while saving.
- **#184, Interview voice and reveal:** slant corrections are phrased as the character's view, not "X told you".
- **#200, stance portraits.**
  - Portraits go through `createAssetStore`, and their URLs use the S3 base when `ASSET_BUCKET` is set.
  - No image call starts after 120 s, with a 60 s image timeout and 6 attempts that resume from the cache.
  - A failed image no longer hides later stances' portraits.

**Merged by Damian himself during the session:** #172, #174, #176, #177, #180, #192, #193, #194, #197, #198, #199, #201.

**Issues filed:**
- #186: job dependants stuck as `pending`. Fixed by #192.
- #187: DNS rebinding in the sources fetch. Fixed by #193.
- #188: the school move in #157 isn't transactional.
- #189: no job safety net on Vercel.
- #190: the cost ceiling ignores reasoning tokens, and the rate limiter is per instance.

## 4. Verified end to end (local)

- Golden-1819 plays from briefing to reveal through the real local API, engine and models (`scripts/v3-smoke.ts`). The last run on today's `main` had:
  - 32 actions and 0 failures;
  - 7 notes, including all 6 core discoveries;
  - both stages on the historical outcome, a story event, the Interview push-back in the interviewer's voice, and 5 corrections in the reveal;
  - replies taking about 5–7 s with the check, and Interview answers about 7–8 s.
- **Test counts on `main`:**

  | Package | Tests |
  |---|---|
  | `play-contract` | 9 |
  | `spec-v3` | 58 |
  | `engine` | 73 |
  | `generation` | 201 (1 skipped) |
  | `orchestration` | 224 |
  | v3 API tests | 50 |

  Typecheck is clean.

## 5. Findings reported to Kevin (not acted on)

- **Game feel in golden-1819:** stage 2's rules are one-to-one, so "recognise Hussein" always gives the treaty whatever the student did. Nothing in stage 1 closes the historical ending, and the historical act is listed first.
  - Three fixes were discussed: (a) stage-2 outcomes conditional on stances and notes, (b) the stage-1 deception closing history, (c) shuffled act order.
  - The PRD reading (G6, V37, V38, P9.2, V55) supports (a) most directly.
- **The map:** `MapCanvas` isn't mounted in the v3 play screens; rooms are a dropdown. #198 added the no-doors option to the compiler and renderer.
- **Hydration warning in the browser preview:** caused by the preview's injected `cascade-browser-integration.js`, not by app code.

## 6. Local environment at handoff (this machine only)

- **Local Supabase** on `127.0.0.1:54321`, with all migrations applied up to `20261016100700`. Nothing was reset.
- **Seeds:**
  - golden-1819 seeded as adventure `00000000-0000-4000-8000-000000005c02` in the Testing School (`00000000-0000-4000-8000-000000005c01`);
  - throwaway `v3-smoke-*@local.test` students from the smoke runs.
- **Dev server:** `npm run dev` with `V3_ENABLED=1` and `V3_SCHOOL_IDS=00000000-0000-4000-8000-000000005c01`.
- **Accounts** (password `password123!`):
  - `kevin-student@local.test`: student;
  - `kevin-teacher@local.test`: Testing School admin, which the preview and summary pages require;
  - `kevin-play@local.test` and `v3-student@local.test`: students with existing attempts.
- **Re-seeding:** `npx vitest run --config scripts/vitest.v3-seed.config.ts`.
- **Smoke run:** `npx vite-node scripts/v3-smoke.ts`.

## 7. State of the repo at handoff

- **Open PRs:**
  - #154: Yi Hao's PRD architecture draft;
  - #157: bhavinaa's admin access page;
  - #161: Yi Hao's preview-video app.
- **Open issues:**
  - #202: a reason per rule, assigned to Kevin and undecided;
  - #186 and #187: fixed but still open;
  - #188, #189 and #190.
- **Pieces of the teacher flow with no PR yet:**
  - generation steps registered in `jobSteps` (only portraits is registered);
  - any `/v3/teacher` create, review or publish page;
  - a v3 library listing or share link.
- **Production:** the v3 migrations aren't on the `production` branch.
