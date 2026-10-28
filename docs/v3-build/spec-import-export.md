# Import and export v3 adventures with ZIP or JSON

On **Your adventures**, expand **Import adventure**, choose a ZIP or JSON file, and select
**Import adventure**. The file creates a new draft owned by the signed-in
teacher in their current school, then opens the editor. Existing adventures and
published versions are untouched. This requires staff membership in the school.

Open **Import / export** in the editor or a completed guided draft. **Download
ZIP** includes selected artwork and custom sprites; **Download JSON** keeps media
URL references. Save local edits before opening the dialog.

ZIP archives contain `adventure.json` (the JSON bundle below), `assets.json`
(the original URL → archive path manifest), and media bytes in `assets/`.
Images and custom walking sprites are copied into new storage during import;
the restored spec points to these new URLs. Image attribution and sprite layout
are preserved. Bundled sprites remain references to game assets shipped with the
application. A ZIP containing only a root `adventure.json` is also accepted; like
JSON import, it retains its URL references.

Before saving a new draft or an update from JSON (including a JSON-only ZIP),
the importer downloads every selected stage image, portrait, and custom walking
sprite to verify it exists and decodes correctly. Custom sprites must pass the
same 4 × 4 sheet checks as uploaded sprites. Fallback artwork, bundled sprites,
and citation/attribution links do not require downloads. Duplicate media URLs
are downloaded once; the JSON and its URLs are preserved.

Linked media is limited to 198 unique files, 10 MB per file and 40 MB total,
with a 30-second validation deadline. External downloads use the existing
DNS-pinned public-address checks, bounded responses, and redirect validation;
private-network URLs are rejected. Missing or invalid media prevents the draft
or version from being saved. Links must remain available after import; passing
validation cannot guarantee future availability.

ZIPs are limited to 15 MB, 40 MB expanded, 200 entries, and 10 MB per entry.
Unsupported or duplicate paths, missing/unlisted media, invalid image files, and
invalid custom sprite sheets are rejected before draft creation. Failed imports
remove newly uploaded media. ZIP export requires every selected media URL to be
available and fails if the result exceeds 15 MB; JSON export remains available.

The human-readable JSON contains:

```json
{
  "format": "pocket-adventure-v3",
  "version": 1,
  "spec": { "...": "the complete v3 AdventureSpec" },
  "sources": [
    {
      "id": "source-id",
      "title": "Source title",
      "kind": "text",
      "pages": [{ "page": 1, "text": "Captured source text" }]
    }
  ]
}
```

Imports also accept a raw v3 `AdventureSpec` object, without a wrapper. Raw specs
carry no captured sources; the editor reports missing sources and story errors
for review before publishing. Invalid JSON, invalid spec structure, unsupported
bundle versions, duplicate source ids, and files over 10 MB are rejected before
writing a draft. Story errors are allowed in drafts and use the existing review
and publication checks.

Both formats include character private agendas and captured source text; share them
with other authors accordingly. It excludes ownership, school ids, student data,
share links, publication history, generation jobs, and original uploaded files.
In JSON exports, images and sprites remain URL references. Generated stage and portrait URLs are
pinned during export so imported copies keep using the original artwork; the
referenced media must remain hosted and accessible.

## Updating an existing adventure and managing versions

In **Import / export**, **Import as new version** uploads a ZIP or JSON file as the next saved version of
the same adventure. It replaces the editable draft and source text, retaining
earlier spec and source snapshots. JSON updates retain media URL references and accept exported bundles or raw specs,
with the same 10 MB limit as new imports. An import never changes the live version.
If another author saves or publishes while the file is uploading, the import
fails without replacing their work and removes newly uploaded media.

Follow **Version history** in the adventure navigation to open the publication-history
page. Each published version has a stable student link, publisher attribution,
completion counts, and **View results**. Publish draft changes from the editor;
importing returns to the editor without opening a dialog. Earlier snapshots and
student attempts remain unchanged.

Student links use `/v3/join/<versionId>`, where `versionId` is the stable UUID
already issued to that published snapshot. Every copy control uses this URL:
the publish panel, desktop/mobile version history, and school
console. The library starts and resumes only the currently published version.
`/v3/play/<attemptId>` continues to identify one student's saved session.

Bare adventure join links are closed. Previously issued
`/v3/join/<adventureId>?release=<versionId>` links redirect to the matching canonical
version URL; the pair is checked before redirecting. They cannot select a different
version or silently follow the live pointer. The attempt API accepts `{versionId}`;
`{adventureId}` no longer starts a student game. Existing attempts retain their
original version and progress, and old version links still open that version
while the adventure remains published.

Deploy `20261028020000_v3_version_student_links.sql` before the application.
It exposes the current version's ID in library/school listing results and filters
library resume candidates to that version. It replaces two listing functions;
no saved spec, publication ID, or attempt is rewritten. The existing service-only
start RPC keeps its database signature for deployment compatibility; application
callers always supply the publication ID.

Published versions also show the teacher who last published them and when. This
identity is recorded during publishing, separately from the owner or draft
author. Republishing an older version updates its latest publisher. Earlier
records without an actor show **Publisher not recorded**; names are never
inferred from ownership. This records the latest publisher per version, not
a separate event for every republication.

School admins can open and edit adventures owned by other teachers in their
school, including import/export, version publication, and editor chat. System
admins can manage adventures across schools without a school membership.

Deploy `20261027010000_v3_version_import.sql` before this code. The additive
migration introduces source/check snapshots and transactional import and
selected-publication operations. Source snapshots are captured from deployment
onward; source text overwritten before this migration cannot be reconstructed.
Existing publications and student links continue to use their pinned versions.

Also deploy `20261028010000_v3_publication_attribution.sql` before the updated
application. It adds a nullable publisher reference and a service-only atomic
publish operation. Legacy publish RPCs remain supported and record an unknown
actor. Publication authorization and revision-conflict checks still run before
attribution is written.

Verification:

```sh
npm test -- --run tests/unit/v3-spec-transfer.test.ts tests/unit/v3-spec-archive.test.ts tests/api/v3-spec-transfer.test.ts
RUN_REVIEW_BROWSER_TESTS=1 npm test -- --run tests/browser/v3-editor.test.ts
npm run typecheck
```
