# Import and export v3 adventures with ZIP or JSON

On **Your adventures**, expand **Import adventure**, choose a ZIP or JSON file, and select
**Import adventure**. The file creates a new draft owned by the signed-in
teacher in their current school, then opens the editor. Existing adventures and
published versions are untouched. This requires v3 access for the school.

In the adventure editor, **Export ZIP** downloads the saved draft with selected
artwork and custom sprites, while **Export JSON** downloads the spec with media
URL references. Save any local edits first. The guided creation page offers
**Export saved ZIP** and **Export saved JSON** once its draft is ready.

ZIP archives contain `adventure.json` (the JSON bundle below), `assets.json`
(the original URL → archive path manifest), and media bytes in `assets/`.
Images and custom walking sprites are copied into new storage during import;
the restored spec points to these new URLs. Image attribution and sprite layout
are preserved. Bundled sprites remain references to game assets shipped with the
application. A ZIP containing only a root `adventure.json` is also accepted; like
JSON import, it retains its URL references.

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

Verification:

```sh
npm test -- --run tests/unit/v3-spec-transfer.test.ts tests/unit/v3-spec-archive.test.ts tests/api/v3-spec-transfer.test.ts
RUN_REVIEW_BROWSER_TESTS=1 npm test -- --run tests/browser/v3-editor.test.ts
npm run typecheck
```
