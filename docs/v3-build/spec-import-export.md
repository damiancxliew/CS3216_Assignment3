# Import and export v3 adventures

On **Your adventures**, expand **Import JSON**, choose a file, and select
**Import adventure**. The file creates a new draft owned by the signed-in
teacher in their current school, then opens the editor. Existing adventures and
published versions are untouched. This requires v3 access for the school.

In the adventure editor, **Export JSON** downloads the saved draft. Save any
local edits first. The guided creation page also offers **Export saved JSON**
once its draft is ready.

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

The bundle includes character private agendas and captured source text; share it
with other authors accordingly. It excludes ownership, school ids, student data,
share links, publication history, generation jobs, and original uploaded files.
Images and sprites remain URL references. Generated stage and portrait URLs are
pinned during export so imported copies keep using the original artwork; the
referenced media must remain hosted and accessible.

Verification:

```sh
npm test -- --run tests/unit/v3-spec-transfer.test.ts tests/api/v3-spec-transfer.test.ts
RUN_REVIEW_BROWSER_TESTS=1 npm test -- --run tests/browser/v3-editor.test.ts
npm run typecheck
```
