# Diagram notes

Explanations for the nodes in each diagram, for use as captions or body text next to the PNGs in `png/`. Paths are relative to the repository root.

## D1 · System overview (`d1-system-overview`)

| Node | Notes |
| --- | --- |
| Teacher console | Browser UI where teachers write a brief, follow generation, review and edit drafts, publish, and read class summaries. |
| Student play client | Browser UI where students chat with characters, take notes, read documents and move around the Phaser map. |
| Pages and server actions | Next.js routes and server actions in `apps/web` used by the teacher console, including the review chat. |
| Generation service | `apps/web/src/lib/v3/generation/service.ts`. Turns a confirmed brief into queued generation steps and handles guided-mode pauses. |
| Job tick | `/api/v3/jobs/tick`. An authorised route that claims queued jobs and runs them. |
| Turn API | `apps/web/src/lib/play/v3/service.ts`. Receives student actions as JSON, applies them through the engine and saves the result. |
| generation | `packages/generation`. LLM generation passes, asset generation and the `DecisionClient` used for review-chat targeting. |
| jobs | `packages/jobs`. Job queue stored in Postgres. |
| engine | `packages/engine`. Pure rules engine: `step()` for play, `summarise()` for class summaries. The LLM is injected, never imported. |
| orchestration | `packages/orchestration`. The play-time LLM client (`createOpenAiClient`, with `complete` and `decide`) and the post-turn check `checkExchange`. |
| spec-v3, play-contract | Shared libraries (faded, dashed boxes): imported rather than called, so no arrows lead to them. `spec-v3` is the adventure schema (zod) and `validateSpec()`, imported by `engine`, `generation` and the teacher pages. `play-contract` holds the `Action`, `PlayerView`, `GameEvent` and `ClassSummary` types shared by the Turn API, `engine` and the student client. |
| game-core, game-client | Shared libraries (faded, dashed boxes). `game-core` is the deterministic settlement-map compiler and navigation functions; `game-client` is the Phaser map component. Both are bundled into the student play client, and `game-core` is also used by `orchestration`. |
| LLM providers | External text, image and web-search models. |
| OpenAI Decisions API | External service that answers yes/no questions as probabilities (model `gpt-6-luna`). Used to locate the fields a teacher wants to edit, and for the post-turn check during play. |
| Asset bucket | S3-compatible storage for generated portraits and stage art. |
| Postgres | Application data, the job queue and each attempt's event log. |
| Supabase Auth | Sign-in for teachers and students via Google OAuth. |
| Key | Blue: browser UI. White: runtime component. Faded dashed: shared library, imported rather than called. Yellow: data store. Purple: external service. Solid arrows are runtime calls; the dotted arrow is sign-in. |

## D2 · Generation pipeline (`d2-generation-pipeline`)

Sources: `apps/web/src/lib/v3/generation/steps.ts`, `service.ts`.

| Node | Notes |
| --- | --- |
| Brief confirmed | The teacher confirms the brief; generation starts. |
| Enqueue | `enqueueGeneration` queues steps by mode. Quick queues all seven steps. Standard queues `sources` and `skeleton`, then the rest after skeleton approval. Guided queues `sources` and then one pass at a time. |
| sources | Allowlisted web search; the pages used are saved as source snapshots so quotes can be checked later. |
| skeleton | One LLM call for the adventure outline, followed by `validateSkeleton`, `checkSkeleton` and `quoteIssues`. Found issues are sent back for a repair turn, up to `MAX_REPAIRS = 2`. |
| Review gate | Standard and guided modes stop here for the teacher to review and approve the skeleton (`approveSkeleton` queues the remaining steps). Quick mode skips it. |
| details | `packages/generation/src/v3/details/generate.ts`, `calls.ts`. One call per stage, one persona call per major character and one call for minor characters run in parallel; a final link call joins them. |
| endings | Defining moments, endings and the closing interview. |
| reveal | The reveal, built from the adventure's slanted documents. |
| check | Validates the assembled adventure. |
| final repair | `packages/generation/src/v3/final/repair.ts`. Regenerates each blamed part once and keeps a repair only if it does not increase the error count. |
| save draft | `validateSpec`, then a new draft version of the adventure; portrait jobs are queued. |
| Asset jobs | Portrait jobs run after save; stage-art jobs are queued on request. |
| Teacher review | The review screen where the teacher reads and edits the draft. |
| Publish | Makes the draft playable; blocked while errors remain. |
| guided mode pauses after this pass | Passes drawn with a dashed amber border (sources, skeleton, details, endings, reveal). In guided mode the pipeline pauses after each of them so the teacher can review and edit it before continuing. |

Step dependencies (`STEP_DEPS`): skeleton ← sources; details ← skeleton; endings ← details; reveal ← details, endings; check ← details, endings, reveal; save ← check.

## D2b-1 · Review-chat routing (`d2b-1-edit-routing`)

Source: `apps/web/src/app/v3/teacher/[id]/chat-actions.ts`.

| Node | Notes |
| --- | --- |
| Teacher message | A message in the review chat, either about a saved draft or about a paused guided pass. |
| findEditTargetsAction | Server action, saved drafts only. Loads the draft and runs `findEditTargets` to pick the fields to change. |
| findEditTargets | Decision passes that choose the target fields (see D2b-2). |
| suggestReviewChangeAction | Server action that asks the LLM for a proposal. For drafts it receives the chosen targets; for paused passes it is called directly. |
| loadReviewChatTarget | `apps/web/src/lib/v3/review-chat/target.ts`. Loads the authoritative base and returns a validator for proposed changes against it. |
| Saved draft | The current draft spec, loaded through `SupabaseV3PlayStore`. |
| Paused pass | The output of the paused guided pass, loaded with `requirePause` and `loadPause`. |
| Postgres | Stores drafts and generation job steps. |
| Propose and apply | Proposal, preview and save (see D2b-3). |

## D2b-2 · Finding edit targets (`d2b-2-find-edit-targets`)

Source: `apps/web/src/lib/v3/review-chat/locate.ts`.

| Node | Notes |
| --- | --- |
| Message + saved draft | Input: the teacher's message, recent chat history and the draft spec. |
| Intent pass | One predicate: does the message ask for a change? |
| Reply only | Score below 0.5: the message is a question; `answerReviewQuestion` replies in plain text and nothing is edited. |
| Item pass | One predicate per item in the `editableItems` outline (up to 400). Keeps items scoring at least 0.5, top three. |
| Field pass | One predicate per text field of the chosen items (up to 400). Keeps fields scoring at least 0.5; falls back to the best field. |
| EditTargets | The selected field paths, shown to the teacher before a proposal is made. |
| OpenAI Decisions API | Each pass calls `DecisionClient.decide` through `OpenAiDecisionClient` (`packages/generation/src/llm/decisions.ts`, model `gpt-6-luna`). |

## D2b-3 · Propose and apply (`d2b-3-propose-apply`)

Sources: `apps/web/src/lib/v3/review-chat/propose.ts`, `apps/web/src/lib/v3/edit/service.ts`, `apps/web/src/lib/v3/generation/service.ts`.

| Node | Notes |
| --- | --- |
| proposeTargetedChanges | Drafts: the LLM rewrites only the targeted fields. Reading-check support quotes are re-derived when a document body is rewritten. |
| proposeRequestedChanges | Paused guided passes: the LLM proposes the requested edits to the pass output. |
| Validate | The validator from `loadReviewChatTarget` (`checkTeacherEdits`, or `skeletonIssues` for the skeleton pass). An invalid proposal is retried once. |
| Preview | The proposal (`changePreview`, grouped changes) is shown to the teacher, who accepts or discards it. |
| applyTeacherEdits | Applies the edits to the draft, then `validateEditedSpec`; rejects edits that introduce new errors (`introducedErrors`). |
| saveAdventureEdits | Saves the new draft via `saveDraft`, refusing the save if `specVersion` changed since the teacher loaded it. |
| savePauseEdits | Saves edits to the paused pass; `continuePause` also resumes generation. |
| Postgres | Draft versions and generation job steps. |

## D3 · Student message sequence (`d3-play-sequence`)

Source: `apps/web/src/lib/play/v3/service.ts`; post-turn work is started with Next.js `after()` in `apps/web/src/app/api/v3/attempts/[id]/actions/route.ts`.

| Step | Notes |
| --- | --- |
| POST action | The client sends the action with the revision it last saw. |
| load attempt | Loads the attempt, its state and the pinned adventure spec, and checks access. |
| safeguards | Rate limit, revision check (stale clients are refused) and the per-attempt token ceiling. |
| step(message) | Runs `engine.step` with the student's message. |
| character reply | The engine's injected LLM client writes the character's reply. |
| state, events, view | New state, the `GameEvent`s to append and the projected `PlayerView`; checks that need an LLM are queued as pending. |
| save | Saves state and appends events, guarded by the revision. |
| view, pendingCheckIds | The response returns at once; the client shows the reply. |
| after the response | `runPostTurnChecks` runs the queued checks after the response is sent. |
| post-turn check (Decisions) | `runPostTurnCheck` calls `checkExchange` (`packages/orchestration/src/v3/check.ts`), which sends one `v3_post_turn_check` request to the Decisions API. It asks one question per revealable fact (`conveyed_<i>`), plus `substantive`, `asserted`, and one per moderation category: abusive, threat, hateful, provocative, sexual, self-harm. |
| probabilities | Each answer is a probability; 0.5 or above counts as yes (`CHECK_DECISION_THRESHOLD`), and a missing answer counts as no. If several moderation categories fire, the most severe wins, with ties broken by the higher probability. |
| post-turn check (fallback) | If the client has no `decide`, the Decisions call fails, or the request would exceed 400 questions, the check falls back to one cheap structured LLM completion. `CheckOutcome.via` records which path ran. |
| findings | Discoveries the character conveyed, claims the student challenged, and a moderation flag with its category. |
| step(postTurn) | Applies the findings through the engine as an internal `postTurn` action. |
| events | Discovery, challenge and flag events. |
| save events, flags | Appends the events and writes each flagged message to `flags_v3` (excerpt, character, stage), revision-guarded, with up to three tries. |
| refresh | While a check is pending the client re-fetches the attempt with backoff to pick up new notes. |

## D4 · engine.step (`d4-engine-step`)

Source: `packages/engine/src/step.ts`.

| Node | Notes |
| --- | --- |
| step() | `step(spec, state, action, deps)`; `deps.llm` is the only path to an LLM. |
| Parse action | Accepts a client `Action` or the server-only `postTurn` action. |
| Copy state | Works on a `structuredClone`, so a refused action leaves the input untouched. |
| Time rules | `refreshReadingChecks` and `applyTimer` run first; the timer can force the final call. |
| message, insertNote | Calls the LLM for the character's reply. |
| interviewAnswer | Calls the LLM for interviewer push-back and closing lines. |
| enterRoom, documents | Movement and opening or closing documents. |
| selectPassage, readingCheck | Selecting passages and submitting reading checks. |
| act, predict, endStage | Story choices; narration is fixed spec text, not generated. |
| postTurn, tick | Internal post-turn findings and timer ticks. |
| Rule loop | `settleTriggers` (stance triggers), `refreshReadingChecks`, `refreshActs`, `evaluateStoryEvents`, `applyTimer`. Repeats while state changes, up to `MAX_RULE_ROUNDS = 10`. |
| Hints | `evaluateHints` once the state has settled. |
| state, events, view | Returns the new state, the emitted events and `view = project(spec, state)`. |

## D5 · Teacher insight (`d5-teacher-insight`)

Sources: `packages/engine/src/summary/index.ts`, `apps/web/src/lib/play/v3/summary.ts`, `apps/web/src/app/v3/teacher/[id]/summary/page.tsx`.

| Node | Notes |
| --- | --- |
| flags_v3 | Postgres table holding the text of each flagged message, with its category, character and stage. |
| attempt_event | Postgres log of each attempt's `GameEvent`s: discovery, stanceChange, challenge, act, outcome, prediction, verdict, hint, storyEvent, flag, phase, readingCheck. |
| loadClassSummary | Picks the published version, loads its pinned spec and the class's attempt events, then adds student names to flags. For flagged attempts it reads their `flags_v3` rows (`V3PlayStore.listFlags`) and attaches the flagged messages. |
| summarise() | `summarise(spec, attempts)`: a pure function that counts each attempt once and returns a `ClassSummary`. |
| stuck | Where students got stuck: stage and the discovery they were missing. |
| predictions | How predictions split at each defining moment (last prediction per attempt). |
| verdicts, answers | Interview verdicts before and after push-back (`changedAfterPushBack`) and a seeded sample of anonymised answers. |
| discoveries, readingChecks | Discoveries found or missed, grouped by the character who holds them, and reading-check results per document. |
| endings | How many attempts reached each ending. |
| flags | Attempts flagged by moderation. Each flag's severity follows from its category (`FLAG_SEVERITY` in `packages/play-contract/src/flag.ts`): self-harm and threat are urgent; hateful, sexual and abusive are serious; provocative is for review. |
| Overview, Stuck, Predictions, Interview, Discoveries, Flags | Tabs on the teacher summary page. Overview also shows attempt and completion counts; Overview counts urgent flags. Flags lists flagged students, ordered by their most severe flag and then by flag count, each with a severity badge; each one expands to show the flagged messages (severity, category, character, stage and text), and urgent students start expanded. |
