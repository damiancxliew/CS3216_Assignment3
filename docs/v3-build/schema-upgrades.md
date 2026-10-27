# Adventure schema versions and reviewed upgrades

The integer `schemaVersion` inside an adventure identifies its persisted format. The database `spec_version` identifies a content revision. They serve different purposes: changing a title creates a content revision without changing the schema version.

Unversioned adventures are schema 1. Schema 2 requires reading checks on documents and preparation requirements on stages. Partial preparation content from earlier releases remains readable as schema 1 and is preserved during upgrade.

## Support policy

The latest schema is fully supported. Older schemas run through the current engine and editor on a best-effort basis. We retain format readers, upgrade steps, and migration fixtures so teachers can upgrade their adventures. We do not retain historical engines or guarantee identical historical gameplay.

Upgrades are voluntary. An older adventure may be edited and published when it passes the application's applicable validation and can be adapted to the current runtime. Unsupported formats return an actionable message without changing the stored adventure or attempt. A future incompatible runtime change may require upgrading and starting a new attempt.

Published revisions, release links, and attempts stay pinned. An upgrade writes a new draft revision after review; publishing is a separate action. No upgrade changes an ongoing attempt or rewrites a published snapshot.

## Teacher workflow

Save current edits, then choose **Upgrade adventure**, or request an upgrade in the existing teacher chat. Both entry points use the same registry and service. The review explains the changes before generation starts.

The proposal persists while questions and stage requirements are prepared. Teachers can inspect source support, prerequisites, essential conversations, and blocking findings. Chat can refine the proposed additions. Applying always requires an explicit **Apply upgrade**, including structural-only upgrades.

The first upgrade preserves documents, historical quotations, citations, story content, IDs, and selected media. It authors missing questions and preparation using the existing evidence. If sources or discoveries are insufficient, it reports the gap and blocks applying. Edit and save the underlying adventure before rebuilding. A newer saved revision invalidates an older proposal.

## Required steps for every persisted schema change

1. Add the next integer schema and retain readers for registered historical formats. Keep released JSON schema snapshots unchanged; preserve the runtime boundary between stored formats and the current engine model.
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
