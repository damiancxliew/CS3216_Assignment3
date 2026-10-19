# Review screen handoff (#212)

The generated adventure now links to `/v3/teacher/[id]/review`. The route requires
an enabled v3 school, a staff viewer, ownership, and a draft, published or archived
adventure. It shows stages, characters, documents and endings, with linked final
errors (including remaining part errors), warnings grouped by pass, and conflicts.
Edit remains disabled with an accessible “Coming soon” explanation.

Publishing from the draft page, preview, API or server action rejects both spec
errors and saved final part errors. Unpublishing remains available. Source origin
and URL survive source loading and skeleton conversion; old drafts recover source
provenance at display time without changing their saved specs. Content source
labels remain visible when citations or quotes are missing.

Conflicts have fixture coverage. Empty generated results say detection is pending;
full generated-conflict acceptance still depends on #259.

## Verification

- Web and generation package typechecks pass.
- Targeted review, publish, preview, generation and student-attempt tests pass.
- Skeleton tests cover mixed source origins and the legacy default.
- An isolated Chromium fixture exercised every item at 1440, 375 and 320 pixels,
  tab keyboard navigation, issue selection/focus, passage highlighting and a
  20,000-character unbroken persona field. No horizontal overflow or browser errors.
- The layout regression (`RUN_REVIEW_BROWSER_TESTS=1 npx vitest run
  tests/browser/v3-review.test.ts`) verifies every outline destination, index
  collapse, stable tab/page/pane heights, scrolling and keyboard navigation at
  1440, 1024, 375 and 320 pixels.
- Local signed-in Supabase checks verify clean and blocked drafts, 40px action
  buttons, stage-index collapse and explicit character names in discovery titles.
  The final create → review → edit → preview → play walkthrough still requires
  #213; editing remains disabled.

The review workspace scrolls its index and detail pane independently. Separate
cards group the content, and the index can be collapsed without resetting the
selected stage. Tab buttons share dimensions, the page reserves scrollbar space,
and the background is fixed to the viewport to avoid content-length shifts.
Conversational topics such as “his fears” display the holder’s name in review
headings and index entries; saved generation content is unchanged.

## Next PR: direct edits (#213)

Checkpoint 2 step 5 remains incomplete until #213 ships. A changed Save must create
an immutable version through the existing trigger. Current migrations have no
published-version pointer, and student starts currently read the latest saved spec.
Enabling edits before fixing that would change what new students play immediately.

Migration request to coordinate with Damian (prepared here; not sent externally):

- Add nullable `adventures_v3.published_version`, referencing the same adventure's
  version in `adventure_versions_v3`.
- Backfill it from `spec_version` for currently published adventures.
- Provide an atomic publication operation that checks the expected latest version
  and updates the pointer, rejecting stale concurrent publication.
- New attempts load the published pointer. Existing attempts continue to load their
  pinned `spec_version`.
- Saving later versions must retain the live release. Teacher review and preview
  load the latest saved version. Publish validates that version before switching
  the pointer; Save and Publish reject stale concurrent updates.

No `spec_draft` column is needed. The source-policy, evaluation, Guided checkpoints
and optional regeneration issues remain separate follow-up PRs as planned.

## #213 publication foundation

The additive `20261019000000_v3_publication.sql` migration must deploy before
editor writes are enabled. It backfills published pointers, enforces same-adventure
snapshot references, and provides service-only atomic save, publication and start
operations. Authenticated direct insert/update access is revoked; application
services retain the existing staff and school boundaries. Student starts initialize
from the published snapshot and retry a publication race; attempts remain pinned.

Platform/migration review: Damian. Contract changes in subsequent PR: Kevin.
No production migration has been applied from this workspace.

## #213 editor and acceptance (2026-10-19)

Three ordered implementation branches build on open prerequisite #262. The review
workspace now has explicit Edit/Save/Discard controls and Settings and Reveal and
questions tabs. Schema-driven forms cover nested content, reference selection,
recursive condition variants, ordering and dependency disclosures. Local changes
survive tab changes and failed/stale saves; Preview/Publish require saved work.
Real bodies require captured-source selection or explicit invented conversion.
The server derives teacher attribution and portrait reuse metadata, creates no
model/image jobs, and accepts structurally valid drafts with semantic blockers.

New deterministic runtime checks apply to authored versions. Existing fixtures
and immutable snapshots retain their prior shape and behavior. Saved generation
errors are retired only for constraints rechecked from the current saved spec;
part-local obligations requiring missing context remain blockers. Historical job
outputs are never rewritten. This conservative behavior means some old generation
blockers still need generation/context repair rather than an unrelated edit.

Verified locally:

- 205 targeted authoring/review/publishing/preview/attempt tests passed before the
  final additional portrait and form coverage; web/spec/engine/generation typechecks
  pass. Lint has no errors (four existing warnings in unrelated UI).
- Spec package: 59 tests. Engine: 77 tests, including golden build/reachability.
- Local database: 12 publication/table integration tests passed without resetting
  seeded data. The additive migration was applied locally only.
- Real Chromium: review layout at 1440, 1024, 375 and 320px; editor save/reload,
  discard, navigation cancellation, failure/conflict retention, keyboard tabs,
  desktop/mobile overflow.
- Signed-in local test school: disposable generated-fixture creation → review →
  title edit → Save v2 → preview (zero attempts) → publish v2 → student start
  pinned to v2. No live model or image call was made. This is fixture acceptance,
  not a new-brief/live-generation walkthrough or the full two-student reveal run.

Deploy migration before enabling editor writes. Damian reviews platform/migration
changes; Kevin reviews contract/check behavior. Merge #262 and the implementation
stack in dependency order. Production deployment and human approvals are pending.

Final checks: all 18 affected local database tests pass (publication, tables,
brief columns and flag saves). Generation package: 217 passed, one pre-existing
opt-in test skipped. The editor browser regression passed after fixing array
schema unwrapping; signed-in fixture acceptance passed on the configured localhost
origin. Production deployment remains unperformed.

### Contextual controls and link history

Review shows Edit only; a clean editing form shows Done editing; dirty edits show
Save and Discard. Successful save/discard returns to review mode.
`/v3/teacher/[id]/links` lists the permanent student link for each published
version with started/in-progress/completed totals and rates. Completion means
reaching the reveal. New publications issue one link atomically; existing release
links remain pinned and cannot be regenerated for old versions. Unpublish closes
all release links to new starts. Students resume an existing attempt for the
requested release, while the original unversioned link retains its resume behavior.
The history migration backfills legacy live/attempt versions with unknown dates.
Deploy `20261019010000_v3_publication_history.sql` before these controls are enabled.
