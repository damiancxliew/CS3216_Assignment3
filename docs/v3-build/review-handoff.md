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
- The fixture uses the actual review component and application CSS, with button
  styles copied from the shared UI module. It does not exercise a logged-in Next.js
  session. No local Supabase configuration was present, so the final test-school
  create → review → edit → preview → play walkthrough remains outstanding.

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
