# PR #322 verification

The implementation contract is [the plan](../plans/reliable-sources-and-splash-images.md).
This report distinguishes fixture verification, an isolated PostgreSQL engine, local browser checks,
and live-provider observations. It is not deployed-worker acceptance.

## Implemented behavior

- Bounded pinned HTML/PDF retrieval; one transient retry; separate accepted/candidate budgets;
  diagnostics; guided retry runs with atomic enqueue and shared Retry/Continue row locking.
- Additive source-run and media migrations; immutable candidates; server-resolved versioned
  selections; immutable storage keys; private UN confirmations; separate Save and Publish.
- One Assets tab for all stage openings, every portrait/stance, player and every character sprite.
  Upload, curated search/import, UN links, bundled choices, AI jobs and explicit candidate review.
- Separate ordinary-image and walking-sheet validation. Shared gallery/playback resolution,
  inherited portraits and legacy stage-art preservation. Existing renderer and movement rules reused.

## Fixture and local checks

Controlled source fixtures cover empty 202
recovery, persistent empty responses, short text, 403, redirects, PDF page numbering, malformed PDFs,
scanned PDFs and later successful candidates. Media checks cover real image decoding/normalization,
permissions/targets, duplicate requests, selected snapshots and older-version isolation, UN without
image storage, late AI completion and rejected sprite cost.

The additive SQL was executed in PostgreSQL WASM (PGlite 0.3.14 installed under `/tmp`), with the
repository's adventure, source and job migrations and minimal identity/organization prerequisites.
Checks passed for reservation idempotency/conflicts, immutable ready snapshots, atomic job enqueue,
source exclusion retention, Continue refusing active imports, terminal-job lock release, staff-only
candidate reads, and server-only writes/RPCs. This checks PostgreSQL semantics; it does not establish
PostgREST integration or multi-connection contention. `tests/db/v3-media-source-runs.test.ts` covers
those checks against the normal local database, including concurrent Retry/Continue. Docker is not
available in this execution environment, so that database-backed test remains pending.

Editor/map browser fixtures use real components, CSS, Phaser and gameplay code, replacing only
server transport/framework adapters. They do not prove authentication or database integration.

## Live observations from the execution environment

2026-10-22, representative public NLB record:
`https://www.nlb.gov.sg/main/article-detail?cmsuuid=8b54be13-5b70-44d0-abf6-f9781247686f`.
With the same Accept header, pinned fetch returned HTTP 202 (2,268 bytes; no usable source text),
while curl returned HTTP 200 (185,798 bytes). `runSources` rejected the 202 body as too short and
accepted zero sources. No NLB-specific header workaround was added. This is a client-dependent
observation from this environment, not proof of behavior on the deployed worker.

The representative PDF URL
`https://exhibitions.nlb.gov.sg/files/onpaper/nlb-on-paper-exhibition-guide_en.pdf` returned 404
through pinned fetch and 403 through curl here. PDF fixture success must not be interpreted as a
fix for either upstream access outcome.

`packages/generation/scripts/check-source-fetch.ts` records public request headers, redirect/status,
response headers (excluding cookies), body sizes and timings for both clients, retaining pinned/public
address checks and guarded curl redirects. Run it from the deployed worker to repeat the comparison.

Commons/LOC discovery, metadata re-fetch and normalization are checked separately from storage.
The live Commons check returned three eligible records from six raw results and a second-page
cursor. Re-fetching file ID `10229309` (`Harbour in Singapore, circa 1870.jpg`) confirmed public-domain
metadata, downloaded 94,158 bytes and normalized to 828 × 281 WebP. This exercised live discovery,
metadata verification, guarded download and decoding; it did not write to application storage.
LOC returned HTTP 403 from this environment. Provider fixtures separately cover approved rights,
HTML sanitization, host validation and numeric Commons metadata extension fields.

## Final local verification

- Web API/unit suites: **602 passed**, 84 files, including editing, publication, media and inventory.
- Generation package: **248 passed, 1 skipped**, 20 files, including PDF recovery and sprite normalization.
- Spec package: **64 passed**. Game-client checks: **66 passed**, typecheck and production bundle passed.
- Web/spec/generation typechecks and web production build passed. Web lint has no errors; four
  existing warnings remain. Build warnings include the existing font override, unpdf dynamic import
  and game-client bundle size advisories.
- Real Chromium editor flow passed: desktop/mobile (including 320 px), keyboard controls,
  unsaved edits across tabs, upload review, explicit selection, Save/reload, errors, reduced motion
  and reservation-key reuse after a lost AI response.
- Real Phaser/map browser flow passed: movement/room entry, selected player and NPC sheets,
  all four directions, eight frames per second, row-zero idle, reload and failed-sheet bundled fallback.
  Expected broken-image errors are isolated from unexpected browser errors.
- A deliberately inverted target-compatibility check was rejected by the media regression tests;
  the original implementation was restored before final checks.

The last focused inventory/editor rerun checks the inherited-portrait regression after the full suite.
Browser fixture transport and isolated SQL checks are narrower than deployed application acceptance.

## Before deployment acceptance

Apply the additive migrations before application code. Run the normal Supabase/PostgREST database
suite and the local-stack editor test without resetting seeded data. Verify selected candidates through
actual Save/reload, preview, republish, old release links and resumed student attempts. Repeat NLB and
Commons/LOC checks from the same deployed worker. Confirm real paid AI job completion for all three
asset groups with the deployment's image-service credentials. Keep #323 open until these checks pass.
