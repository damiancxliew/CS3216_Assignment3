# Student browser acceptance

The document-reader regression test runs without Supabase or a Next server. It
starts a temporary Vite harness with the real play UI, map, and session, holds the
movement response, and checks immediate pickup, pending Notes, modal focus, and
mobile scrolling. Install Playwright Chromium, then run:

```sh
RUN_READER_BROWSER_TESTS=1 npx vitest run tests/browser/document-reader.test.ts
```

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge browser instead. Screenshots
are saved under `output/reader-check/`.

Run from the repository root against a running local Supabase instance with this
branch's migrations applied. The test creates fresh users and an adventure; it
does not reset the database. Install Playwright Chromium if it is not available.

Start the deterministic model provider in one terminal:

```sh
node tests/browser/model-server.mjs
```

In another terminal, configure Next with the local Supabase URL, anon key, and
service-role key as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
and `SUPABASE_SERVICE_ROLE_KEY`. Start the development server with:

```sh
OPENAI_API_KEY=local-browser-test \
OPENAI_BASE_URL=http://127.0.0.1:4010/v1 \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 \
npm run dev --workspace web
```

The `/v1` suffix is required: the model stub accepts `POST /v1/responses`.
Restart Next after changing these variables because its model client is cached
for the lifetime of the server process. Use the development server so the local
sign-in form is available.

In the test terminal, configure the matching local credentials as `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, then run:

```sh
RUN_BROWSER_TESTS=1 npx vitest run tests/browser/student-play.test.ts --reporter=verbose
```

The test expects Next on `127.0.0.1:3000`. It covers keyboard sign-in, joining,
initialization, movement, reload/resume, desktop/mobile layout, movement during
pending dialogue, audible replies, admission, evidence, first-stage objectives,
and the stage-two map and heading. It also checks browser errors and private
fields in API responses. Screenshots are written to `/tmp/spatial-browser-*.png`.
The separate `tests/db/release-gate.test.ts` covers the persisted three-stage
journey through the ending and debrief.
