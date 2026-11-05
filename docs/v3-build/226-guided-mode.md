# #226 Guided mode — backend + Fix-with-AI server (lead-authored spec)

Branch: `feat/226-guided-mode`, stacked on `feat/231-source-allowlist` (PR #281, for its sourcePolicy code). Commit style: `feat(v3): ...`. This document records the original backend specification. The follow-up UI implementation is described under Implementation status below.

Glossary: Pass = sources, skeleton, details (stage details + personas), endings, reveal, checks. Guided = pause after every pass.

## Why changesets
`finalRepair` (packages/generation/src/v3/final/repair.ts) re-assembles the spec from `parts`, so a spec snapshot of teacher edits would be lost. Teacher edits at a pause are stored as `V3Edit[]` (apps/web/src/lib/v3/edit/commands.ts) and re-applied on top of every later pass input and after the check step's repair.

## 1. Mode
- `apps/web/src/lib/v3/brief/schema.ts`: `mode: z.enum(["standard", "quick", "guided"])`; add the quick reply / label "Guided: check after every pass" next to the existing two; the summary label for guided = "Guided (check after every pass)". Follow how standard/quick are parsed in `turn.ts` (code-only).
- `GenerationBrief.mode` (generation/types.ts) gains "guided". restartGeneration keeps it.

## 2. Migration
`supabase/migrations/20261019020000_adventures_v3_pause_draft.sql` (check it sorts after every migration on origin/main and this branch; bump if not):
```sql
-- Guided generation (#226): the teacher's saved edits at a pause after the details,
-- endings or reveal pass, as { pass, edits } where edits are V3Edit commands on that
-- pass's output. Only validated edits are stored. Cleared when the teacher continues.
alter table adventures_v3 add column pause_draft jsonb;
comment on column adventures_v3.pause_draft is 'Guided mode: { pass, edits } saved at a pause while status is needs_review; cleared on continue.';
```
Writes stay service-role (same as skeleton_draft). `V3AdventureWriter` gains `loadPauseDraft(id): Promise<{ pass: string; edits: unknown[] } | null>`, `savePauseDraft(id, draft)`, `clearPauseDraft(id)` (supabase impl + every fake/test double). If the repo keeps generated Supabase types, regenerate/update them the way the repo does. Apply it to the local Supabase (`npx supabase migration up`).

## 3. Shared edit application
In `apps/web/src/lib/v3/edit/service.ts`, extract from `saveAdventureEdits` the part that turns (base, commands, sources) into the edited spec — `applyV3Edits` + `deriveAttribution` + the replaceExcerpt evidence fix-up — into
`export function applyTeacherEdits(base: AdventureSpec, edits: V3Edit[], sources: CapturedSource[]): AdventureSpec` (throws like today). `saveAdventureEdits` uses it (behaviour unchanged except §6). Portrait-version / validationContext handling stays in saveAdventureEdits.
CapturedSource from a v3 adventure's stored sources: reuse whatever `edit-actions.ts` passes as `sources:` (extract it into a shared helper if it's inline) so the generation steps build them identically from `deps.sources.load`.

## 4. "No new errors" validation
In `apps/web/src/lib/v3/edit/validation.ts`:
```ts
/** Errors the edited spec has that the base doesn't (key = code|path|message). */
export function introducedErrors(base: AdventureSpec, edited: AdventureSpec, sources: CapturedSource[], savedErrors: CheckIssue[] = []): CheckIssue[]
```
= `validateEditedSpec(edited, sources, savedErrors).errors` minus keys present in `validateEditedSpec(base, sources, savedErrors).errors`.
And `export function checkTeacherEdits(base, rawEdits: unknown, sources, savedErrors?)` → `{ ok: true; spec; edits: V3Edit[]; warnings } | { ok: false; errors: CheckIssue[] }`: zod-parse `z.array(V3Edit).max(2000)` (failure → one issue code "invalid-edit"), `applyTeacherEdits` (throw → one issue `{ code: "invalid-edit", path: "", message: error.message }`), then `introducedErrors`. Used by pauses, by §6, and by Fix with AI.

## 5. Guided pipeline (apps/web/src/lib/v3/generation)
- `guarded`: `brief = input has "brief" ? input.brief : input` for every step (generalises the details special case; old inputs still work).
- Step inputs after a pause carry `teacherEdits?: { details?: V3Edit[]; endings?: V3Edit[]; reveal?: V3Edit[] }` alongside `brief`.
- sources step: if `brief.mode === "guided"` → `setStatus(needs_review, ["generating"])` at the end.
- skeleton step: pause for `standard` OR `guided`.
- details / endings / reveal steps: pause at the end when guided.
- endings step: `draft = applyTeacherEdits(details.draft, teacherEdits.details ?? [], sources)` when there are edits.
- reveal step: `spec = applyTeacherEdits(endings.spec, teacherEdits.endings ?? [], sources)` when there are edits.
- check step: `edited = applyTeacherEdits(reveal.spec, teacherEdits.reveal ?? [], sources)`; errors are computed on `edited` (also in the early `asIs` return). When repair is needed, pass `frozen` (below) to `deps.passes.check`; after it returns, `final = replay(result.spec)` = apply details, endings, reveal changesets in that order with `applyTeacherEdits`. If replay throws, keep `edited` and its errors (log it). Recompute errors on the final spec for the "a repair that leaves more errors is dropped" comparison. Output also `teacherEdited: string[]` (frozen part ids).
- frozen parts: add to `FinalRepairInput` `frozen?: string[]` — blamed parts in `frozen` are not redone (their errors stay in `errors`/`partErrors`). Compute in the web check step: for each changeset, against the spec it was applied to (details.draft, endings.spec, reveal.spec), map each command to a path string — path commands → `path.join(".")`, convertDocument/replaceExcerpt → `documents.<index of documentId>` — and `pathOwner(path, { skeleton, spec, parts })` (export `pathOwner` from `@adventure/generation/v3` if it isn't). Drop nulls, de-dupe.
- `enqueueGeneration`: guided → `["sources"]` only.
- `approveSkeleton`: when the stored brief is guided, enqueue only `details` (`{ brief, skeleton? }`, deps `{ details: ["skeleton"] }`).
- `export type GuidedPass = "sources" | "skeleton" | "details" | "endings" | "reveal"`; `export function pausedPass(steps: JobStep[]): GuidedPass | null` — the last pipeline step (order sources, skeleton, details, endings, reveal) whose row is done and whose next pipeline step has no row. Add `mode` and `pausedAt?: GuidedPass` (when status needs_review) to `GenerationProgress`.
- `export async function loadPause(deps, store, adventure): Promise<PauseView | null>` (caller did access):
  ```ts
  type PauseView =
    | { pass: "sources"; index: 1; uploads: { id; title }[]; outside: { id; title; url }[]; rejected: { url; reason }[] }
    | { pass: "skeleton"; index: 2 }
    | { pass: "details" | "endings" | "reveal"; index: 3 | 4 | 5; base: AdventureSpec; edits: V3Edit[]; errors: CheckIssue[]; warnings: CheckIssue[] };
  ```
  base = details.draft / endings.spec / reveal.spec (raw step output; earlier edits are already inside it). edits = pause_draft edits if its pass matches, else []. errors/warnings = validateEditedSpec(base) (info only; they don't block).
- `continueFromSources(deps, jobs, store, userId, adventureId, removedSourceIds: string[], env)`: owner + flag + needs_review + guided + pausedAt "sources". Every id must be an outside source of this adventure; reject otherwise. Reject if nothing would be left (no uploads and every outside source removed): "Keep at least one source." `V3SourceStore.removeOutside(adventureId, ids)` deletes `sources_v3` rows with origin 'outside' and those source_keys. Conditional setStatus generating, enqueue `skeleton` (STEP_INPUT(brief), deps `{ skeleton: ["sources"] }`); on enqueue failure put status back.
- `savePauseEdits(deps, store, userId, adventureId, pass, rawEdits, env)`: owner + flag + needs_review + pausedAt === pass ∈ details|endings|reveal; `checkTeacherEdits(base, ...)`; errors → `{ ok: false, errors }` and NOTHING written; ok → savePauseDraft({ pass, edits }) → `{ ok: true, warnings }`.
- `continuePause(deps, jobs, store, userId, adventureId, pass, rawEdits, env)`: same checks + validation (errors → `{ error: "invalid edits", issues }`, nothing written). Prior changesets come from the paused step's own input `teacherEdits`. Conditional setStatus generating, then enqueue:
  - details → `endings` `{ brief, teacherEdits: { details: edits } }`, deps `{ endings: ["details"] }`
  - endings → `reveal` `{ brief, teacherEdits: { ...prior, endings: edits } }`, deps `{ reveal: ["details", "endings"] }`
  - reveal → `check` `{ brief, teacherEdits: { ...prior, reveal: edits } }` + `save` STEP_INPUT(brief), deps `{ check: ["details","endings","reveal"], save: ["check"] }`
  Then clearPauseDraft. Enqueue failure → status back to needs_review.
- Server actions for all of these in `apps/web/src/app/v3/teacher/[id]/pause-actions.ts` ("use server", same auth/flag pattern as edit-actions.ts, revalidatePath of the teacher page): `continueFromSourcesAction`, `savePauseEditsAction`, `continuePauseAction`, `fixPauseEditsWithAiAction`, `fixSkeletonWithAiAction`. Add `fixV3EditsWithAiAction(adventureId, expectedVersion, edits)` to edit-actions.ts.

## 6. #213 editor refuses a save that adds errors
`saveAdventureEdits`: after building `spec`, compute `introducedErrors(parsed.spec, spec, sources, generationErrors)`. Non-empty → return the new variant `{ ok: false; code: "check-errors"; message: "These edits add errors, so they weren't saved. Fix them or use Fix with AI."; errors: CheckIssue[] }` without calling saveDraft. A save that adds no new errors still saves even if older errors remain (so a generated draft with errors can be fixed step by step).

## 7. Fix with AI — `apps/web/src/lib/v3/edit/ai-fix.ts`
```ts
export interface AiFixDeps { llm: LlmClient }
export type AiFixResult =
  | { ok: true; edits: V3Edit[]; notes: string }
  | { ok: false; code: "no-errors" | "no-fix"; message: string; errors: CheckIssue[] };
export async function proposeEditFix(deps: AiFixDeps, input: { base: AdventureSpec; edits: V3Edit[]; sources: CapturedSource[]; savedErrors?: CheckIssue[] }): Promise<AiFixResult>
export async function proposeSkeletonFix(deps: AiFixDeps, input: { base: SkeletonShape; edited: unknown; issues(raw: unknown): Promise<CheckIssue[]> }): Promise<{ ok: true; skeleton: SkeletonShape; notes: string } | { ok: false; code: "no-errors" | "no-fix"; message: string; errors: CheckIssue[] }>
```
Access/loading stays in the service/actions; these are pure over deps.
- Errors to fix = `checkTeacherEdits(...)` errors. None → `no-errors`.
- One model call; if the proposal still fails `checkTeacherEdits`, one retry with the extra user block below; still failing → `no-fix` with the remaining errors. Model `DETAILS_MODEL`, reasoningEffort "low", maxOutputTokens 8000, schemaName "edit_fix".
- Skeleton: the changeset is computed by a generic diff `skeletonChanges(base, edited): V3Edit[]` — per top-level array, entity matched by id: changed → `set [key, i]`, added → `insert [key] index`, removed → `remove [key, i]` (removals first, from the highest index); changed non-array top-level fields → `set [key]`. Apply proposals with a generic path applier (set/insert/remove/move only; same forbidden keys as commands.ts), validate with `input.issues` (extract approveSkeleton's validate+check+quote logic into an exported `skeletonIssues(deps, adventureId, raw)` and use it in approveSkeleton too). Subject text below = "adventure plan (the skeleton)".
- Production LLM: `withJsonUsage(new OpenAiLlmClient({ timeoutMs: 240_000, maxRetries: 0 }), { purpose: "generation", adventureV3Id, organizationId: schoolId, userId })`.
- Fake: when `V3_FAKE_PASSES` is set and NODE_ENV !== "production", the actions use a fake LlmClient whose answer keeps only the teacher commands whose path is not the same entity (first two path segments) as any error path (and no convertDocument/replaceExcerpt on an errored document), notes "I undid the changes that caused the errors." — so the flow can be clicked through without OpenAI.

### Output JSON schema (strict)
```json
{ "type": "object", "additionalProperties": false, "required": ["notes", "edits"],
  "properties": {
    "notes": { "type": "string" },
    "edits": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["type", "path", "value_json", "index", "from", "to", "documentId"],
      "properties": {
        "type": { "type": "string", "enum": ["set", "insert", "remove", "move", "convertDocument"] },
        "path": { "type": "array", "items": { "type": "string" } },
        "value_json": { "type": ["string", "null"] },
        "index": { "type": ["integer", "null"] },
        "from": { "type": ["integer", "null"] },
        "to": { "type": ["integer", "null"] },
        "documentId": { "type": ["string", "null"] } } } } } }
```
Convert to V3Edit: path segments matching /^\d+$/ → numbers; `value` = JSON.parse(value_json); drop null fields; zod `V3Edit` parse (a bad command → treat the attempt as failing with an "invalid-edit" error). For the skeleton, `convertDocument` is not allowed (treat as invalid).
Before sending the teacher's commands, encode them the same way (numbers → digit strings, value → value_json).

### System prompt (verbatim; `{subject}` = "adventure" or "adventure plan (the skeleton)")
```
You help a teacher fix their own edits to a generated history {subject} for secondary-school students.
The teacher changed it with editing commands, and some of the changes broke its checks. Return a revised list of commands that fixes every listed error while keeping what the teacher meant.

Rules:
- Start from the teacher's commands. Keep every command that has nothing to do with an error exactly as it is.
- Change as little as possible. Prefer adjusting the teacher's own command to adding new ones. Drop a command only when no version of it can pass the checks, and say so in notes.
- Never change ids, citations, sourceLabel, real, sources or authoring.
- Never make up quotations or facts about real people or events. Only invented documents and invented characters' own words may be new.
- Paths address the JSON: object keys, and list positions written as digit strings. Commands run in order, each on the result of the ones before it, exactly as the teacher's do.
- value_json is the new value as a JSON string for set and insert, and null otherwise. index is for insert; from and to are for move; documentId is for convertDocument. Unused fields are null.
- notes: one or two plain sentences for the teacher saying what you changed and why.

Return JSON only, matching the schema.
```
### User message (verbatim layout)
```
<errors>
{JSON.stringify(errors, null, 2)}
</errors>

<teacher_commands>
{JSON.stringify(encodedTeacherCommands, null, 2)}
</teacher_commands>

<affected_parts>
{JSON.stringify(slices, null, 2)}
</affected_parts>
```
`slices` = for every distinct entity prefix (first two path segments, or the first one when the second isn't a list index) of the teacher's command paths and the error paths: `{ path: "stages.2", before: <value in base or null>, after: <value in the edited result or null> }`. If the whole message is over 60,000 characters, drop `before` from every slice.
Retry appends:
```

<previous_attempt>
{JSON.stringify(encodedProposal, null, 2)}
</previous_attempt>

<still_failing>
{JSON.stringify(remainingErrors, null, 2)}
</still_failing>
```

## 8. Tests (add; existing ones must keep passing)
- tests/api/v3-brief.test.ts: guided quick reply → `mode: "guided"`; summary label.
- tests/api/v3-generation.test.ts:
  a. guided enqueue = only sources; sources step sets needs_review; `pausedPass` = "sources"; `loadPause` returns outside sources + rejected.
  b. continueFromSources removes the given outside id, rejects an upload id / unknown id / removing the last source, enqueues only skeleton.
  c. guided skeleton step pauses; approveSkeleton for guided enqueues only details.
  d. guided details step pauses; savePauseEdits with an edit that adds an error (e.g. empties a required prose field → "empty-field") → ok:false and savePauseDraft NOT called; a harmless prose edit → saved.
  e. continuePause(details) enqueues endings with teacherEdits.details; running endings → `passes.endings` receives the draft with the edit applied.
  f. chain endings → reveal → check: the saved spec contains the teacher's details edit; when a check error is blamed on the edited part, `passes.check` gets `frozen` containing that part id and the saved spec still has the edit.
  g. replay that throws → check keeps the edited spec.
  h. quick and standard flows unchanged.
- tests/api/v3-editing.test.ts: a save that adds an error → `code: "check-errors"`, saveDraft not called; a save with only pre-existing errors still saves.
- new tests/api/v3-ai-fix.test.ts (fake LlmClient): good proposal → ok + converted edits (digit strings → numbers, value_json parsed); bad then good → ok after retry and the retry message contains `<still_failing>`; bad twice → no-fix; no errors → no-errors; skeleton fix happy path + skeletonChanges diff unit cases.
- packages/generation tests: finalRepair with `frozen` does not redo the frozen part.

## Implementation status

PR #286 implemented the backend and integrated the source allowlist from #281. The teacher page now routes all five Guided pauses and retries when the status arrives before the pass output. Guided follows `V3_ENABLED` and `V3_SCHOOL_IDS`; its temporary public gate has been removed after the local browser walkthrough passed.

The creation screen keeps the conversation on the left and the accumulated content on the right at desktop widths. On mobile the panes stack. The original brief transcript stays in `brief_state` after creation and survives reloads. Completed passes remain available as disclosure cards, and loading appears inline in the content pane. The main panels use the app's ink borders and offset shadows; smaller cards have a lighter shadow. Source checkboxes align with the first line of wrapped titles, and source links use record blue with underlines. Review prompts describe the current task without repeating the layout. Review toolbars, primary actions and edit toggles share scoped styles. The outline editor matches its preview card and omits the redundant first-section divider. Send buttons share a keyboard-accessible tooltip; the waiting hint does not take up composer space. Applied messages clear when the review step changes, and the saved draft retains the same Resolve issues action and existing-issues disclosure as the pause editors. Cards open their editors on demand and share the normal adventure editor's fields. Details exposes stages, characters and documents; Endings groups decisions by stage alongside ending editors; Reveal exposes the reveal and teacher questions. Skeleton keeps its existing autosave. At the three spec pauses, Save stores the full changeset against an immutable generated base, Continue submits current edits, and Discard restores the saved checkpoint. Existing generation issues are shown separately from newly introduced errors. Local structural and semantic checks give immediate feedback; server source and quotation checks remain authoritative.

The chat composer stays visible from brief confirmation through generation, all review pauses and the completed draft. Teachers can draft a request while a pass runs; sending becomes available when the next review is ready. Chat can suggest replacements for existing text or number fields, or outside-source selections. It shows the current and proposed values before Apply changes or Keep my edits. Applying updates the current cards; explicit Save/Continue remains in control, with the outline's existing autosave. Requests use the current unsaved edits. Changes to those edits invalidate proposals, including responses still in flight. Draft messages survive reloads in browser session storage; completed exchanges stay in `brief_state`. Conversation writes use an optimistic timestamp checkpoint to prevent one tab from overwriting another. Model output goes through protected-field checks and the existing authoritative validators before a proposal is offered.

Resolve issues uses one proposal panel across pause, skeleton and normal editors. The button floats beside the content pane. It shows an explanation and waits for Apply suggested fix or Keep my edits. Changing the underlying edits invalidates the proposal, including responses still in flight. Applying updates only local state, with the skeleton's usual autosave.

The recorded flow exposed a persisted-base bug: JSONB key ordering could make unchanged citations appear edited. `applyTeacherEdits` now normalizes both trees through the schema before attribution comparison; a regression test reproduces reordered persisted keys. Skeleton autosave also retains failed requests for retry, and discard waits for outstanding saves before restoring the generated plan.

## Browser verification

The standard adventure editor also includes an **Edit with chat** conversation
for draft, published and archived adventures. It reuses the Guided suggestion
preview and conversation history. Requests include current unsaved edits;
applying a suggestion enters edit mode and keeps the result local until Save.
Published adventures retain their live version until Publish changes is used.
Stale saved versions and edits made while a suggestion is pending invalidate it.
The editor browser harness covers applying, declining, invalidating and saving
chat suggestions alongside manual changes, plus retaining requests after errors.
It runs without Supabase or a model using the `RUN_REVIEW_BROWSER_TESTS` command
below; server action permission and version checks are covered by API tests.

Chat appears only in edit mode, aligned with the index and content in a wider
workspace. Only chat is constrained to the available viewport height, with
its transcript and suggestion preview scrolling inside the panel.

Editor checks appear as a clickable count alongside Resolve issues in a floating
control. The expanded list scrolls within the panel and opens its first issue's
details by default, retaining global errors, warnings and conflicts.
Selecting a located issue enters edit mode, opens the relevant tab
and focuses its field. Field errors appear beside their controls with an
accessible description; part-local generation issues stay with their owning
entity when a specific field cannot be identified.

When there are no errors, warnings or conflicts, the floating control says
“No issues” without an expandable list. Untouched legacy specs use the same
checks as the server review and publication path; stricter editing checks are
compared with the saved baseline so existing legacy omissions are not presented
as newly introduced errors. Saved generation errors remain visible independently
of edit mode.

The Generated assets tab reviews stage artwork and character portraits for the
saved spec version, including each major character's stance portraits. It uses
the same storage URLs and portrait-version inheritance as student play, offers
full image links, and shows unavailable/loading states with retry for missing
images. Switching tabs preserves unsaved story edits. After saving a new version,
the editor refreshes the asset inventory; older results are not relabeled as
belonging to the new version.

`tests/browser/v3-guided-local.test.ts` uses local Supabase and Next with `V3_FAKE_PASSES=1`, an isolated teacher in Testing School, and disposable adventures. It leaves existing seeded records untouched. Configure the usual local Supabase credentials and:

```sh
# Next environment (apps/web/.env.local or exported to the process):
# V3_ENABLED=1
# V3_SCHOOL_IDS=00000000-0000-4000-8000-000000005c01
# V3_FAKE_PASSES=1
# OPENAI_API_KEY=local-browser-test
# JOBS_TICK_SECRET=226-local-test
# JOBS_TICK_URL=http://127.0.0.1:3226/api/v3/jobs/tick
# NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3226
npm run dev --workspace web -- --port 3226

# Test environment: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
RUN_GUIDED_LOCAL_TESTS=1 npx vitest run tests/browser/v3-guided-local.test.ts tests/browser/v3-guided-ready-local.test.ts
RUN_REVIEW_BROWSER_TESTS=1 npx vitest run tests/browser/v3-editor.test.ts tests/browser/v3-review.test.ts
```

The Guided test covers creation through the brief, every pause route, fixed uploads, outside-source deselection, rejected results, refusing zero sources, delayed output, read-first cards and keyboard editing, explicit Save/reload, checkpoint discard, autosave and explicit-save network retries, new local validation errors, authoritative historical-quotation rejection, AI application without advancing, persistent composer drafts, chat proposals at every pause and after generation, proposal invalidation, conversation reloads, and preserving both saved and unsaved submitted edits in the final spec. Every pause is checked at 320, 768, 1024 and 1440 pixels for horizontal overflow and captured as a screenshot. Desktop checks also verify side-by-side panes and independent scrolling. The test also compares rendered toolbar and card styles, checks the divider removal, focuses the unavailable send button to reveal its tooltip at all four widths, and resolves an invalid edit on the completed draft. The browser runs with 650 ms action slowdown, pauses for 1 second after main actions, and waits 1.5 seconds before each screenshot set.

Successful recordings, screenshots and raw browser console diagnostics are written under the gitignored `output/guided-226-redesign/`; the successful video is `walkthrough.webm`. These artifacts are local and are not part of the source diff. The targeted ready-draft test also records `ready-issues.webm` and screenshots for its existing-issues disclosure, including keyboard access and allowing harmless edits despite existing errors. The fake source snapshots do not contain complete real-document paragraphs, so the existing generation issues panel is intentionally populated during this fixture flow.

The final Node 22 run passed with zero runtime exceptions and zero unexpected console errors. Its failed-resource messages are the deliberate skeleton-save, pause-save and chat-request network-abort cases. Next also emits its existing smooth-scroll configuration warning; the screenshots preserve caret styling to avoid interfering with hydration.

## Other verification

- `npx vitest run tests/api tests/unit/v3-local-edit-checks.test.ts`: 390 tests passed across 48 files, including Guided permissions, changeset replay and AI regressions.
- `npx vitest run tests/unit/v3-local-edit-checks.test.ts`.
- From `packages/generation`: `npx vitest run tests/v3-details.test.ts`: 29 tests passed, including frozen final repair.
- `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`.

The conversational edit requests use a new server action. No new HTTP route or migration is required by this UI work. The existing database access tests continue to cover pause-draft service-role writes and isolation between schools.
