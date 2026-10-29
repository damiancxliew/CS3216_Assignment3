# Repo cleanup and restructure plan (MVP → production)

Status: **proposal, for team discussion.** Nothing in this document has been carried out yet.
Audited against `main` at `34770a08`.

## 1. Summary

The repo grew fast through the MVP and now holds three things at once:

1. **The current product (v3):** teacher authoring, generation, publishing, student play and class summary.
2. **The previous product (v2):** rooms + turn loop + resolver, still routable and still sharing code with v3.
3. **Non-product material:** promo videos, generated screenshots, PR evidence, one-off build plans and team process docs.

The proposal:

- **Clean up first:** delete non-product material, then untangle v3 from v2, then remove v2.
- **Restructure next:** organise folders by *what the code does* (frontend / backend / AI) instead of *when it was written* (`v3`, `spec-v3`).
- **Prepare for more subjects:** literature, philosophy and geography are planned. They are all humanities and reuse today's activities, so we add **subject packs** and make the history-only spec rules **subject-aware**, without rebuilding the engine.

## 2. Why this is needed

| # | Problem | Evidence |
|---|---|---|
| P1 | **Two products in one app.** v2 is still routable next to v3. | `/play/[attemptId]`, `/teacher/[id]`, `/api/attempt/*` (6 routes), `/api/brief/turn`, `/join/[token]`. `/library` still lists v2 adventures and the `start_adventure` RPC creates v2 attempts. `/teacher` still links v2 adventures to the v2 editor. |
| P2 | **v3 depends on v2 code by accident**, so v2 can't simply be deleted. | `api/v3/attempts/[id]/actions` → `lib/play/http.ts` → `lib/play/service.ts` (v2 turn loop) and `lib/turn-api/contract.ts`. `app/admin/actions.ts` → `app/teacher/actions.ts` (v2 generation). Root layout → `lib/analytics/posthog.tsx` → `lib/demo/*`. |
| P3 | **Packages named after history, not purpose.** | `spec-v3`; `game-integration` (v2-only glue); `generation` and `orchestration` each half v2, half v3. Two LLM clients (`generation/llm`, `orchestration/llm`). From `@adventure/orchestration`'s root, v3 only uses `callStructured`, `createOpenAiClient`, `createRng`, `LlmClient`. |
| P4 | **"v3" everywhere in names.** | `/v3/...` routes, `lib/v3`, `lib/play/v3`, `components/play/v3`, `*_v3` tables, 60+ `v3-*` test files. Once v2 is gone, "v3" is noise. |
| P5 | **Folders by file type, not by feature.** | `apps/web/src/lib` has 17 sub-folders mixing teacher, student, admin, v2 and v3 code. |
| P6 | **Outdated docs mislead people and AI agents.** | `docs/EXECUTION_SPEC.md`, `TEAM_PLAN.md`, `KICKOFF_PROMPTS.md`, `specs.md`, `PLATFORM.md` and `gameplay-review.md` are v2-era. `packages/generation/README.md` documents "Adventure Spec v2". `packages/orchestration/README.md` documents the v2 resolver. `infra/aws/README.md` says to set `V3_ENABLED`/`V3_SCHOOL_IDS`, which no longer exist in code. |
| P7 | **~45 MB of non-product media.** | `trailer/` 23 MB, `output/` 20 MB, `docs/screenshots` 3.3 MB, `docs/standalone-demo` 4.4 MB, `docs/pr` 1.4 MB, `apps/preview-video`. |
| P8 | **Duplicated CI and tooling.** | 7 workflows; 4 workspace packages carry their own `package-lock.json` and run separate `npm ci`. |
| P9 | **Tests are far from the code.** | One root `tests/` with v2 tests (`turn-api*`, `spatial-*`, `dialogue-*`, `mint-wiring`, ...) mixed with v3 tests, and demo tests loose at the root. |
| P10 | **History is hard-coded in the spec**, which blocks the planned subjects. | `endings[].type: 'historical' \| 'alternative' \| 'secret'`, `outcomes[].historical`, `readingLevel: 'sec' \| 'jc'`, and the checks `historical-missing / -unreachable / -outcome / -uncited / -diverted` in `packages/spec-v3/src/check`. Every defining moment must have exactly one `historical` outcome, which philosophy cannot satisfy. |

**If we don't do this:**
- Every new subject edits history prompts and rules in place.
- v2 code keeps breaking v3 through shared files.
- New teammates (and AI agents) keep following stale specs.

## 3. Proposed structure

Principles:
1. Name things by what they do.
2. One place per concern.
3. UI never imports AI or database code directly.
4. Packages are framework-free and testable on their own.
5. Tests sit next to the code.
6. No version numbers in names, except schema versions.

```
<repo>/
├─ apps/
│   └─ web/                          FRONTEND + thin HTTP layer (Next.js)
│       └─ src/
│           ├─ app/                  routes only; each file calls into a feature
│           │   ├─ (marketing)/      /, /share, /demo
│           │   ├─ (teacher)/teacher/...    was /v3/teacher/...
│           │   ├─ (student)/play/...       was /v3/play/... and /v3/join/...
│           │   ├─ (school)/  (admin)/
│           │   └─ api/              route handlers, no business logic
│           ├─ features/             UI + server code per product area
│           │   ├─ authoring/        brief chat, editor, review, media, publish
│           │   ├─ play/             stage screen, map, journal, interview
│           │   ├─ class-summary/
│           │   ├─ school/  admin/  auth/
│           │   └─ demo/             landing-page demo
│           └─ shared/               UI kit, Supabase clients, analytics, theme
│
├─ packages/
│   ├─ adventure-spec/               BACKEND: was spec-v3; schema, checks (subject-aware), versions, upgrades
│   ├─ engine/                       BACKEND: deterministic game rules (unchanged)
│   ├─ contracts/                    BACKEND: was play-contract (actions, events, views)
│   ├─ jobs/                         BACKEND: job runner
│   ├─ ai/                           AI: all model calls live here
│   │   ├─ llm/                      ONE client (merge generation/llm + orchestration/llm), cost metering
│   │   ├─ generation/               v3 passes only: skeleton, details, endings, reveal, final check
│   │   ├─ sources/                  ingest, fetch, chunk, search, quotes (policy comes from the subject)
│   │   ├─ characters/               was orchestration/v3: persona, reply checks
│   │   ├─ images/                   was generation/assets
│   │   └─ evals/
│   ├─ subjects/                     CONTENT CONFIG per subject (see section 4)
│   │   ├─ history/  literature/  geography/  philosophy/
│   └─ map/
│       ├─ compiler/                 was game-core
│       └─ renderer/                 was game-client (Phaser)
│
├─ supabase/migrations/              database (table renames deferred)
├─ tests/e2e/                        cross-app browser tests only
├─ scripts/                          seed, grant-sysadmin, measure
└─ docs/
    ├─ product/                      PRD v3, rationale, glossary
    ├─ architecture/                 overview, data model, schema-upgrades, import/export, this plan
    ├─ runbooks/                     local setup, deploy, migrations, key rotation
    ├─ adr/                          short decision records
    └─ archive/                      graded write-ups, v2 PRD
```

How "frontend / backend / AI" maps:
- **Frontend:** `apps/web/src/app` and `features/*` UI.
- **Backend:** `features/*` server code, `adventure-spec`, `engine`, `contracts`, `jobs` and `supabase`.
- **AI:** `packages/ai`.

We keep one Next.js app rather than splitting frontend and backend into two deployables. Server actions and route handlers already are the backend; a split would add an API layer and a second deploy for no product gain.

Dependency direction (enforced by an import-boundary lint): `apps/web → features → packages`; `subjects → ai, adventure-spec`; `engine → contracts, adventure-spec`; UI never imports `packages/ai`.

## 4. Supporting literature, philosophy and geography

All three are humanities and mostly reuse today's activities: character conversations, documents and reading checks, defining moments, Interview and the reveal.

| Subject | Reuses | Needs |
|---|---|---|
| Literature | conversation/interview with characters from the text, documents + reading checks, reveal "interpretations" | source = the text itself (copyright/source policy); "author's ending" instead of "historical" ending |
| Geography | map renderer, source-grounded case studies, defining moments with real outcomes | a new data/graph-reading activity |
| Philosophy | conversations, dilemmas and choices | no single correct outcome; judging argument quality instead of source grounding |

Plan:
1. **Subject packs** in `packages/subjects/<subject>/`: prompts, source policy, wording ("historical" → the subject's term), reading levels, syllabus mapping, evals and fixtures, plus a verifier mode (source grounding, text grounding or argument quality). History is moved there first, with no change in behaviour.
2. **Subject-aware spec rules:** the `historical-*` checks become a per-subject "reference outcome" rule. It is required for history and geography, means the author's ending for literature, and is optional for philosophy. The `historical` fields get a neutral name and the spec gets a `subject` field. **This is a persisted-contract change**: per `AGENTS.md` and `docs/v3-build/schema-upgrades.md` it needs a new SemVer schema version, an upgrade path exposed by both the Upgrade action and teacher chat, a review summary, migration fixtures, tests, and `npm run check:schema-evolution`. Existing history adventures upgrade automatically.
3. **New activities** (geography data/graph, philosophy argument check) are added to the engine the normal way, each in its own clearly named folder.

### Why not a plug-in system now

We considered turning every activity into a self-contained plug-in module on a small shared "kernel", so games could mix activities freely.

- Pros: activities can't break each other; parallel work without conflicts; scales to very different subjects.
- Cons: a large redesign of an engine that works. Activities share a lot of state today: notes feed reading checks, Interview evidence and predictions. Done now, it would be designed around guesses.

All four planned subjects share the same activities, so the cost is not justified yet. **Revisit if maths or science are added**, or if more than two new activities appear. Then the engine's central `switch (action.type)` in `packages/engine/src/step.ts` and the single `EngineState` in `state.ts` are the parts to split.

## 5. What to remove

### 5a. Safe now (not product code, no runtime effect)

| Path | Why |
|---|---|
| `output/` | Generated screenshots and logo drafts (20 MB). |
| `trailer/`, `apps/preview-video/` | Promo videos; move to a separate repo if we want to keep them. |
| `tasks/v3-evidence-preparation-plan.md` | One-off task plan. |
| `docs/EXECUTION_SPEC.md`, `TEAM_PLAN.md`, `KICKOFF_PROMPTS.md`, `specs.md`, `gameplay-review.md` | v2-era process and specs → `docs/archive/` or delete. |
| `docs/v3-build/{README,kevin,yihao,damian,checkpoints,review-handoff,engine-spec-needs}.md` | Two-day build plan and handoffs. Keep `schema-upgrades.md` and `spec-import-export.md`, moved to `docs/architecture/` (update the link in `AGENTS.md`). |
| `docs/pr/`, `docs/screenshots/`, `docs/verification/`, `docs/plans/` | PR evidence that already lives in the PRs. |
| Unreachable files | `app/v3/teacher/[id]/draft-ready.tsx`, `components/play/v3/character-portrait.tsx`, `lib/adventures/ownership.ts`, `lib/play/npc-wander.ts` (+ its test). |
| Next.js template leftovers | `apps/web/public/{file,globe,next,vercel,window}.svg` (confirm no references). |

### 5b. After the team confirms v2 is unused (~6.3k lines in the web app + ~5k in packages)

- **Routes:**
  - `app/play/[attemptId]/**`: keep a redirect for old links.
  - `app/teacher/[id]/**`, `app/api/attempt/**`, `app/api/brief/turn`, `app/join/[token]/**`.
- **Components:**
  - `components/play/{play-client,room-actions,case-board,debrief-*,game-walkthrough,adventure-header,cutscene-*,scene-effects,stage-cutscene,document-reader}.tsx`
  - v2 parts of `components/teacher/`.
- **Lib:**
  - `lib/attempts/*`, `lib/play/{cutscene,transcript}.ts`, `lib/teacher/dossier.ts`.
  - After untangling P2: `lib/play/{service,session,store,...}.ts`, `lib/turn-api/`, `lib/adventures/`, `lib/brief/`, `lib/teacher/edit-spec.ts`.
- **Packages:**
  - `packages/game-integration`.
  - `packages/generation/src/{spec,planner,play,publish,runtime}`: one v3 file imports `@adventure/generation/planner`; check it first.
  - `packages/orchestration/src/{resolver,world,stage,agent,actions.ts,resolution.ts,catalogue.ts,privacy.ts}`.
- **Tests:** the matching v2 tests in `tests/api`, `tests/db` and `tests/unit`.

### 5c. Last, with separate approval: v2 database objects

- **v2-only tables and RPCs:** `adventure`, `attempt`, `attempt_state`, `attempt_runtime`, `agent`, `agent_private_context`, `message`, `resolution`, `stage`, `room`, `objective`, `evidence`, `decision_option`, `stage_commitment`, `generation_job(_state)`, `map_artifact`, `asset`, `asset_cache`, and the `start_adventure` / `join_adventure` / share-link RPCs.
- **Already unused in code:** `agent_memory`, `attempt_telemetry`, `minted_option`, `source_chunk`.
- **Check before dropping:** shared tables such as `spec_version` and `llm_usage`.
- **Approach:** export production data first, then drop the objects in a later migration (expand/contract). This is the only irreversible step.

## 6. Phased plan

Each phase is one or more small PRs, with CI green between them.

| Phase | What | Risk | Size |
|---|---|---|---|
| 0. Safety net | Tag `pre-cleanup`; check production for v2 usage in the last 30 days; confirm CI is green; agree this plan. | none | small |
| 1. Delete clutter | Section 5a; rewrite the root README layout; fix stale package READMEs. | none | small |
| 2. Untangle v3 from v2 | Move what v3 needs out of v2 files (`findForbiddenKeys`/`ApiError` from `lib/turn-api`, the OpenAI client + cost meter from `lib/play/http.ts`, `ActionResult` from `app/teacher/actions.ts`, demo analytics off the root layout path). No behaviour change. | low | medium |
| 3. Remove v2 | Section 5b, with redirects for old links. | medium | large |
| 4. Restructure | Section 3 folders as pure moves, one package or feature per PR; merge the two LLM clients; drop `/v3/` from URLs with permanent redirects; one lockfile and one CI workflow. Needs a short freeze window to avoid conflicts with open PRs. | low–medium | large |
| 5. Subject seam | Move history prompts, source allowlist, wording and evals into `subjects/history`. Golden fixture tests prove output is unchanged. | low | medium |
| 6. Hardening | Docs layout from section 3, ADRs, runbooks, import-boundary lint, dead-code check (knip) in CI. | low | medium |
| 7. New subjects (separate approval) | Subject-aware schema version + upgrade path (section 4, step 2); literature, geography and philosophy packs; data/graph and argument-check activities. | medium | per subject |
| 8. Database cleanup (separate approval) | Section 5c. | high | medium |

## 7. Open decisions

1. Is v2 still used in production by any school? This decides phase 3.
2. Promo videos (`trailer/`, `apps/preview-video/`): delete, or move to their own repo?
3. Hosting: is `infra/aws` still a target, or is it Vercel + Supabase only? If Vercel only, remove `infra/aws` and `aws-deploy.yml`.
4. Graded write-ups (`docs/writeups/`) and lesson materials (`docs/lesson-materials/`): archive in-repo or move out?
5. The landing-page demo (`/demo/lim-bo-seng`): keep as `features/demo`, or retire?
6. URL change `/v3/teacher` → `/teacher` and `/v3/play` → `/play`, with redirects for links already shared with schools: OK?
7. Database cleanup (phase 8): now or later?
8. Which subject comes first: literature, geography or philosophy?
9. A subject-neutral product and package name (instead of the `@adventure/*` scope)? Cheapest to do once, during phase 4.

## Appendix: how the audit was done

- **Reachability:** an import graph (madge) over `apps/web/src`, walked from every Next.js page and route to classify files as v2-only, v3-only, demo-only or shared.
- **Unused files:** knip, treated as candidates only.
- **Database:** table and RPC usage, grepped across code and migrations.
- **Docs and tooling:** every doc, CI workflow and package README, read against the current code.
- **History coupling:** a grep for history-specific terms across the spec, engine, generation, sources and web layers.
