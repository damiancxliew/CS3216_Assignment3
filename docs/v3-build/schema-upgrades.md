# Adventure schema versions and reviewed upgrades

The stable SemVer `schemaVersion` (`MAJOR.MINOR.PATCH`) inside an adventure identifies its persisted format. The database `spec_version` identifies a content revision. They serve different purposes: changing a title creates a content revision without changing the schema version.

Unversioned adventures and integer marker `1` are read as `1.0.0`. Integer marker `2` is read as `2.0.0`, which requires reading checks on documents and preparation requirements on stages. Format `2.1.0` declares optional import attribution. The current format, `2.1.1`, stores cleaned reading text with remapped passage and question-support offsets. Historical stored markers remain unchanged until an upgrade is applied. Partial preparation content from earlier releases remains readable and is preserved during upgrade.

Use a major version for breaking requirements, a minor version for compatible additions, and a patch version for compatible contract corrections. Only stable versions are persisted; prerelease and build suffixes are rejected. Version ordering compares numeric components, so `2.10.0` follows `2.9.0`. A validator implementation fix that leaves the contract unchanged needs a classification rather than a version bump.

## Support policy

The latest schema is fully supported. Older schemas run through the current engine and editor on a best-effort basis. We retain format readers, upgrade steps, and migration fixtures so teachers can upgrade their adventures. We do not retain historical engines or guarantee identical historical gameplay.

Upgrades are voluntary. An older adventure may be edited and published when it passes the application's applicable validation and can be adapted to the current runtime. Unsupported formats return an actionable message without changing the stored adventure or attempt. A future incompatible runtime change may require upgrading and starting a new attempt.

Published revisions, release links, and attempts stay pinned. An upgrade writes a new draft revision after review; publishing is a separate action. No upgrade changes an ongoing attempt or rewrites a published snapshot.

## Teacher workflow

Save current edits, then choose **Upgrade adventure**, or request an upgrade in the existing teacher chat. Both entry points use the same registry and service. The review explains the changes before generation starts.

The proposal persists while questions and stage requirements are prepared. Teachers can inspect source support, prerequisites, essential conversations, and blocking findings. Chat can refine the proposed additions. Applying always requires an explicit **Apply upgrade**, including structural-only upgrades. If preparation is blocked, **Fix failed checks** retries the missing sections and keeps successful checks. Findings are grouped by document or stage. Specific revisions can be requested in chat. Source edits still require discarding the proposal, saving the draft, and preparing a new upgrade.

The `1.0.0 → 2.0.0` upgrade preserves documents, historical quotations, citations, story content, IDs, and selected media. It authors missing questions and preparation using the existing evidence. If sources or discoveries are insufficient, it reports the gap and blocks applying. Edit and save the underlying adventure before rebuilding. A newer saved revision invalidates an older proposal.

The review shows preparation progress and a status for every document and stage. The latest completed section opens automatically. Mark each section **Reviewed** before applying; a changed section needs review again. Marks survive refresh in the current browser tab. Hover or focus the unavailable Apply control to see what remains.

The `2.1.0 → 2.1.1` upgrade joins hard-wrapped prose in stored document bodies, preserving paragraph breaks, list items and uppercase headers. It remaps key-passage and reading-question support offsets in the same operation. It uses no model calls. Captured source pages, citation quotations, prior revisions and published games remain unchanged. New generation receives cleaned source text and stores cleaned document bodies before saving; readers render that stored text without browser-side reflow. This is a whitespace correction, not a reconstruction of the original source layout.

The `2.0.0 → 2.1.0` upgrade changes the format marker and preserves all content and import attribution. It uses no model calls. Existing queued upgrades targeting `2.0.0` remain pinned to that target. An additive database migration converts upgrade-run version columns to text and normalizes their integer values.

The import/export feature originally added `authoring.importId` concurrently with versioning. That changed emitted historical schemas after merge and broke CI. Historical snapshots and their strict schema definitions are now frozen; the latest snapshot includes the field. The best-effort reader preserves this metadata in older stored adventures so upgrading cannot discard it. Historical snapshot filenames `1.schema.json` and `2.schema.json` remain unchanged.

## Required steps for every persisted schema change

1. Add the next SemVer schema and retain readers for registered historical formats. Keep released JSON schema snapshots unchanged; preserve the runtime boundary between stored formats and the current engine model.
2. Register an ordered upgrade step with a stable ID, source and target versions, explanation, and structural or content handler. Add its test paths to `packages/spec-v3/schema/evolution.json`. Every historical format must have a complete route to the latest.
3. Exercise the step through the shared Upgrade action and chat path. Add the appropriate review presentation and blocking findings; keep server-side validation authoritative. Avoid version-specific entry points.
4. Add representative input/output migration fixtures and tests for preservation, repeat requests, blocked content, and revision conflicts. For content upgrades, test model failures and resumability with deterministic responses, then review representative live output when available.
5. Update generation to emit the latest format. Preserve source versions for already persisted work and require normal validation before saving or publishing.
6. Run the schema evolution gate, migration tests, affected package checks, database tests, and desktop/mobile journeys.

Changing a validation requirement also changes the persisted contract, even when its JSON shape is unchanged. Add a `contract` declaration with a version increment. For a validator implementation fix that leaves requirements unchanged, add an `implementation` declaration with the base/target versions, reason, and regression test paths. These classifications require reviewer judgment; CI cannot determine semantic intent.

The CI gate compares emitted structural schemas with checked-in snapshots and the PR base, rejects edits to released snapshots, verifies ordered migration routes and test registrations, and requires classification when semantic validator files change. Contract declarations are append-only history. Ordinary text and content edits in individual adventures do not trigger a schema bump.

## Extending the framework

Use deterministic handlers for structural migrations and content handlers for additions that require authoring. The registry resolves an ordered path. Each intermediate version must validate before advancing. Successful task checkpoints are reused after interruption; retries must not restart completed model work. The same review-and-apply lifecycle covers both kinds.

Upgrade runs are separate from adventure generation status. They are bound to an immutable source revision and proposal revision. Applying uses a database transaction and checks both revisions, writes one draft snapshot, and records the applied revision. Repeating Apply returns the recorded result. Model output is never applied directly by the client.

Retain old snapshots and readers for migration, not a promise of perpetual runtime compatibility. Removing historical runtime branches is permitted under the best-effort policy; losing the ability to read and upgrade historical data requires a separate migration decision.

## Verification

The migration recovery fix was tested with the supplied “The Cost of Resistance” ZIP: seven source documents and 28 media assets decoded successfully. A real model authored all seven reading banks and both stage requirements. The first live run exposed an unreachable held-document prerequisite; after adding handover triggers, delivery events, and stage context to authoring, retry retained all successful banks and completed the proposal. The generated proposal passed the real database proof replay and Apply transaction as `2.1.0`, with no checker errors. The original revision and publication pin remained unchanged. All 35 questions accepted their authored support and rejected whole-document highlighting. Desktop/mobile recovery tests use deterministic transport; the live model and database runs were verified separately.

Reading choices, including guided corrections, are shuffled from the existing private attempt seed and question ID. An individual question keeps its order across refreshes; different attempts receive different orders. Grading uses the unchanged option IDs, and neither the answer nor the seed is exposed in the player view.

The complete-sentence validator treats line wraps as whitespace when checking support. Separately, format `2.1.1` cleans stored reading text and updates offsets through the reviewed upgrade path. Players select supporting passages directly in the source; the alternative sentence checkbox picker has been removed. Selections use yellow with dark text in both themes.

The SemVer update passed 112 spec tests, 737 web API/unit tests, 255 generation tests (one existing skip), and the 43-test schema evolution gate. Web typechecking, lint, and the production build pass, with existing lint warnings. Database tests verify conversion of stored integer version columns, numeric SemVer ordering, and applying both historical integer proposals and new SemVer proposals.

### First upgrade

The implementation passed 109 spec tests, 109 engine tests, 225 orchestration tests, 11 play-contract tests, 255 generation tests (one existing skip), 676 web API/unit tests, 33 v3 database tests, and 63 demo/compatibility tests. The schema gate separately executes the registry, migration-service, content-authoring, and synthetic future-step suites. Package/web typechecks and the production build pass; remaining build warnings are in unrelated modules.

The real database tests cover access controls, concurrent starts, atomic/idempotent application, immutable source revisions, persisted migration proof replay, publication history, and existing v3 tables. The upgrade browser journey covers desktop and 320px mobile layouts, explicit review, chat refinement, refresh, failure/retry, stale proposals, cancellation, unsaved changes, and Apply. Existing editor browser regression also passes. Browser tests inject deterministic server transport; they do not establish an authenticated browser-to-database journey.

Live authoring quality was not verified because the configured local model relay was unavailable. Deterministic model tests verify exact quote offsets, bounded repairs, blocked content gaps, source/media preservation, and resuming completed work. Teachers must review question quality and source interpretation before applying and publishing.

### Reading-text and review follow-up

The supplied format `2.1.0` ZIP was upgraded through Prepare and Apply to `2.1.1` without a model call. All seven documents, 35 questions, and 28 media assets survived export and reimport; publication validation returned no errors or warnings. The MOE release was the only document requiring line-wrap cleanup. Every authored support remained accepted and whole-document highlighting remained rejected. The original revision, publication pin, and captured source pages were preserved.

Chromium checks at desktop and mobile widths verify yellow highlighting in both themes against the actual cleaned MOE document, unchanged stored-to-rendered text, and correct submitted offsets. Separate engine-backed browser journeys cover reading recovery and additional notes; the teacher review journey covers progress, per-section statuses, review mark persistence/invalidation, auto-expansion, unavailable-Apply hints, retry and explicit Apply. These use deterministic model/transport fixtures; they do not evaluate learning outcomes.

Corrections now revisit the active failed question, using that question's choices and support spans. The normal/correction mode is part of the reader's state key, so a failed answer or highlight cannot carry into correction. A rejected correction shows explicit feedback and clears the inputs; an accepted correction announces the next question. Evidence is still withheld until a subsequent normal question succeeds. The historical shared `recovery` field remains readable in saved data; current gameplay derives the correction from the active variant, without rewriting existing adventures. Obsolete correction submissions are rejected with instructions to reopen the source.

Task dialogs share the game's parchment scroll component. Evidence preparation and essential conversations use labelled progress bars in guidance and the mission panel. Source status appears in a compact **Historical source** or **Reconstruction** chip; provenance remains in source details. Condensed natural-writing guidance is part of generation, live dialogue and teacher edit prompts. A bounded live prompt sample produced a short fictional wireless note with truthful metadata and no authenticity disclaimers in the body; this is a prose smoke check, not a full generation evaluation.

A separately reviewed content export, `the-cost-of-resistance-ready.zip`, rewrites five reconstructed documents and their 25 questions, shortens seven titles, and keeps the original captured pages and 28 media assets. Historical-source bodies are preserved apart from the reviewed whitespace cleanup. These copy changes are ordinary adventure edits, separate from the deterministic schema migration.
