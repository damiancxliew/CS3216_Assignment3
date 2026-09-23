---
name: teacher-console-local-testing
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

## Dossier fixtures and visual evidence

- For a generated draft without an OpenAI call, load `loadI1Spec` from
  `@adventure/generation/fixtures` and use `persistSpecVersion` from
  `apps/web/src/lib/adventures/persist-spec.ts` for an adventure owned by an
  isolated teacher. This runs validation and compilation on a source fixture.
- Preserve assumption IDs referenced by fixture entities; deleting assumptions
  alone may fail validation. Use a separate validated fixture for an empty-list case.
- Compiled maps are stored in `spec_version.compiled_stages`, with legacy data
  potentially in `compiled_spec`. For a genuine no-map draft, clear both fields
  on only the disposable version; deleting `map_artifact` rows is not sufficient.
- Measure SVG label `getBBox()` coordinates against the matching room rectangle
  in SVG units. Pair geometry checks with screenshots at desktop and narrow widths;
  DOM presence alone does not prove the plan is visible.
- If a branch changes during testing and stale vendor chunks or CSS requests fail,
  stop the app, move its `.next` cache aside, then restart. Audit a new server log
  and clean browser navigation separately from the superseded HMR run.
- Browser observers should select the app tab by URL, not page-array position.
  Log the observed URL and a document response to prove the observer is attached.

## Devin Secrets Needed

- `OPENAI_API_KEY` (repo-scoped): needed for real assistant brief turns and artwork
  generation/polling completion, but not for source-fixture or missing-key tests.
- Local Supabase URL/keys must be configured in the gitignored `.env.local` or
  exported to the server process. `supabase status -o env` supplies local API URL,
  anon key, and service-role key; map these to `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
