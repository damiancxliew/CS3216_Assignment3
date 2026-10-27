# Student browser acceptance

The shared v2/v3 listings regression uses local Next and Supabase with disposable
accounts and adventures. Apply migrations first. Configure Next with
`V3_ENABLED=1` and a local test school's UUID in `V3_SCHOOL_IDS`, then run:

```sh
RUN_SHARED_LOCAL_TESTS=1 \
SHARED_LOCAL_BASE_URL=http://localhost:3105 \
SHARED_LOCAL_SCHOOL_ID="your-local-test-school-uuid" \
npx vitest run tests/browser/v3-shared-local.test.ts
```

It checks separate V3/V2 sections, desktop/mobile layouts, archive/unarchive,
published metadata, version-pinned start, resume, and completed results. It does
not call a model or reset the database.

The v3 Journal regression uses an isolated Vite fixture with the real stage UI
and CSS. It checks desktop and mobile decision layouts, document access, stable
activity height, and keyboard controls that must not submit a decision:

```sh
RUN_JOURNAL_BROWSER_TESTS=1 npx vitest run tests/browser/v3-journal.test.ts
```

The document-reader regression test runs without Supabase or a Next server. It
starts a temporary Vite harness with the real play UI, map, and session, holds the
movement response, and checks immediate pickup, pending Notes, modal focus, and
mobile scrolling. Install Playwright Chromium, then run:

```sh
RUN_READER_BROWSER_TESTS=1 npx vitest run tests/browser/document-reader.test.ts
```

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge browser instead. Screenshots
are saved under `output/reader-check/`.

## V3 evidence preparation

```sh
RUN_PREPARATION_BROWSER_TESTS=1 npx vitest run tests/browser/v3-preparation.test.ts
```

This isolated Vite fixture runs the real engine, projection, map, and player UI with
deterministic model replies and test transport. Desktop and mobile journeys cover
broad-highlight rejection, recovery, reload, accessible extra notes, essential
conversations, timer exceptions, queued guidance, and decision confirmation.
Screenshots and engine-result reports are saved in `output/v3-preparation-check/`.
Supabase, authentication, and a live model provider are not exercised.

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

## V3 review layout

The review regression uses the real component and application CSS in an isolated
Vite fixture; Supabase and a Next server are not required:

```sh
RUN_REVIEW_BROWSER_TESTS=1 npx vitest run tests/browser/v3-review.test.ts
```

It checks stable page, tab and pane heights across all four tabs at desktop and
mobile sizes, tree-index destinations, scroll resets, keyboard navigation, issue
links and a long unbroken persona field. It also captures browser errors.

## V3 direct editor

Use Node 22. The UI acceptance fixture mocks only the server-action transport and
runs the real editor and schema forms. It covers edit/save/reload, cross-tab local
state, discard, unsaved navigation, network failures, conflicts, keyboard tabs and
mobile overflow:

```sh
RUN_REVIEW_BROWSER_TESTS=1 npx vitest run tests/browser/v3-editor.test.ts tests/browser/v3-review.test.ts
```

For the signed-in local Supabase/Next walkthrough, start the development server
on `http://localhost:3000`, with an allowed **test** school in
`apps/web/.env.local`. Apply the additive publication migration first. This test
creates disposable teacher/student accounts and a copy of the generated 1819
fixture (correcting its historical-diversion rule only in that copy), plus local
captured source fixtures. It checks review → edit → save → preview → publish →
student start, the published version, and that preview inserted no attempt:

```sh
RUN_EDITOR_LOCAL_TESTS=1 npx vitest run tests/browser/v3-editor-local.test.ts
```

This fixture walkthrough does not call a live model or test full generation from
a new brief. Set `PLAYWRIGHT_BROWSERS_PATH` if Chromium is installed elsewhere.

## Teacher brief streaming

Run the real legacy and v3 brief components in an isolated Vite harness with a
held-open HTTP response. Supabase, Next, and model credentials are not required:

```sh
RUN_BRIEF_BROWSER_TESTS=1 npx vitest run tests/browser/brief-stream.test.ts
```

The regression checks immediate sent bubbles, incremental assistant replies,
final transcript reconciliation without duplicates, and retry after interruption.

## V3 map scenery

Run the real v3 UI, application CSS, renderer and engine in an isolated Vite fixture:

```sh
RUN_V3_MAP_BROWSER_TESTS=1 PLAYWRIGHT_CHANNEL=chrome npx vitest run tests/browser/v3-map.test.ts
```

Omit `PLAYWRIGHT_CHANNEL` to use Playwright Chromium. The test checks scenery and
weather, resident/animal counts and distinct spawns, keyboard movement and engine
room entry, local greetings, reduced motion, sound-toggle propagation, Role brief
opening/return, and mobile layout. It uses the golden
1819 adventure plus a clearly labelled synthetic rainy-office variant. HTTP transport
and Next font/link adapters are replaced; authentication, persistence and model
responses are not exercised. Screenshots and metrics go to `output/v3-map-check/`
(or `V3_MAP_OUTPUT`). The population-overview screenshot changes camera zoom only
inside the test; other screenshots use the actual play camera.
