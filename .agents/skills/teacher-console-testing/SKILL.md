---
name: teacher-console-testing
description: Run teacher console UI tests against local Next.js and Supabase with isolated teacher accounts and source fixtures.
---

# Local teacher console testing

- Use the requested worktree; multiple clones can have different revisions.
- Use Node 22: `. "$HOME/.nvm/nvm.sh" && nvm use 22`.
- Reuse existing local Supabase containers and `.env.local` when present.
  Do not reset an existing seeded database without approval.
- Run `npm run dev` for local email/password sign-in. On `/teacher`,
  expand "Local dev sign-in (email/password)". Unknown emails are created
  automatically; the local default password is `password123!`.
- Use a separate local account for destructive/start-over flows so seeded
  long transcripts and source fixtures remain available.
- Actual brief turns require the OpenAI key on the server process, not just
  the browser or a previous shell. Bind it via the secret environment;
  never write it into a tracked file.
- For short desktop viewport checks, measure document height versus innerHeight
  and control rectangles versus the card rectangle. Card-internal scrolling
  may be intentional; page scrolling and inaccessible clipped controls are not.
- For source disclosures test a long natural-language source, an unbroken
  20,000-character source, a short form-feed-separated `page_map.text`, and
  `page_map={}`. The database requires a non-null page_map.
- The detail page shows Brief rows only when reading_level is present.
  If unfinished-brief testing needs source detail visibility, set reading_level
  only on the disposable fixture and disclose this setup in the report.
- Chromium may reserve a 15px scrollbar gutter. Use scrollWidth == clientWidth
  and scrollWidth <= innerWidth to diagnose horizontal overflow accurately.
- If hydration warnings mention only `devin-*`/`devinid` attributes, verify with
  a clean navigation that waits for hydration before DOM-inspection tools run.
  Capture raw console and pageerror events rather than suppressing warnings.

## Source upload fixtures and diagnostics

- Check `LIMITS.minPdfChars` in `packages/generation/src/ingest/extract.ts`
  before generating normal PDF fixtures. The current threshold is 200
  non-whitespace characters across the document; a shorter genuine text-layer
  PDF may correctly return the same error as a scanned PDF.
- Validate normal fixtures have enough extracted text and image-only fixtures
  extract zero characters before UI execution. Use `unpdf` from the installed
  workspace dependencies; do not assume a visually rendered PDF has extractable text.
- A failed upload may retain the file input's selected filename. Selecting the
  same path again may not fire a change event. Report retry behavior separately;
  toggling "Paste text instead" then "Upload a file instead" clears the input
  when fixture correction is needed.
- For browser-extracted large PDF uploads, passively capture the actual POST
  body byte length and multipart field names. Expect pages and filename rather
  than raw PDF bytes. Source state in subsequent requests also includes prior
  filenames, so do not identify uploads from filename substring alone.
- Capture the Reading state immediately after choosing a large file, without
  artificial throttling, and verify subsequent picker reuse through the UI.

## Devin Secrets Needed

- `OPENAI_API_KEY` (repo-scoped): needed for real assistant brief turns.
- Local Supabase URL/keys must be configured in the gitignored `.env.local`
  or exported into the Next.js process using `npx supabase status -o env`.
