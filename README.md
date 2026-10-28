# Historical Adventures

**Play the source material.** A teacher brings their history sources; the system turns them into a short adventure
where students question the people involved, weigh conflicting evidence and make choices no one is fully happy with.
Their thinking is played back to them and summarised for the teacher. Nothing is graded.

Live at <https://historical-adventures-ten.vercel.app>.

Built for CS3216 Assignment 3, National University of Singapore.

## What it does

- **One history lesson, one adventure.** Built for Singapore secondary and junior college history classes, sized to
  a 45-minute lesson by default, with reading levels for Sec and JC.
- **Reasoning, not recall.** Students act as a go-between among real historical figures. What they ask, pass on or
  hold back changes how characters stand and what becomes possible. Written rules, not an AI, decide what happens.
- **Honest about what is real.** Real excerpts are checked word for word against their sources, invented detail is
  labelled, and the reveal separates what happened from what the student's run simulated.

## Users and flows

| User | Primary need |
| --- | --- |
| Secondary and JC history teachers | Turn their own material into a lesson-ready adventure they can check, edit and trust |
| Secondary and JC students | Investigate a historical episode, decide under pressure and back a judgement with evidence |

**Teacher:** describe the adventure in a brief chat (sources, episode, focus, reading level, timer, mode, allowed
outside sources) → review and edit the skeleton → background generation writes stages, characters, documents,
endings and history checks → review and fix flagged issues → preview as a student → publish and share the join link
→ read the class summary.

**Student:** read the role brief → walk the map and talk to characters → read documents closely and highlight key
passages to make notes → pass notes on or confront a slanted account → choose an act at each stage's defining moment
and predict the outcome → see earlier outcomes shape the next stage → epilogue → the Interview (a verdict backed by
notes, one push-back) → the reveal.

**Class summary** (teacher): endings reached, where students got stuck, how predictions split, Interview verdicts
before and after push-back with the most-used evidence and anonymised answers, discoveries found or missed per
character, and flagged messages.

## Quickstart

Requires Node 22 and Docker (for the local Supabase stack).

```bash
npm ci
npx supabase start                   # local Postgres, Auth and Studio
npx supabase db reset                # rebuilds the whole schema from migrations
cp .env.example apps/web/.env.local  # fill in the keys printed by `supabase start`
```

Next.js only reads `.env.local` from `apps/web/`, not the repository root. The database is **only ever** built from
`supabase/migrations/`; a schema change that is not a migration does not exist. To apply new migrations without
wiping local data, run `npx supabase migration up --local`.

v3 is enabled for all schools by default. Add your model key to `apps/web/.env.local`:

```
OPENAI_API_KEY=...
```

Set `V3_ENABLED=0` or `false` to disable v3. An optional nonempty `V3_SCHOOL_IDS`
list restricts access to those schools; unset or empty allows all schools. Existing
deployments with an allowlist must clear it to open access to every school.
The local "Testing School" ID is `00000000-0000-4000-8000-000000005c01`. Then seed and run:

```bash
npx vitest run --config scripts/vitest.v3-seed.config.ts   # idempotent, localhost Supabase only
npm run dev --workspace apps/web                           # http://localhost:3000
```

The seed creates `teacher@local.test` (school admin) and `v3-student@local.test`, both with password
`password123!`, plus a published golden 1819 adventure owned by each. Open <http://localhost:3000/teacher> and use
"Local dev sign-in (email/password)".

- New adventure: `/v3/teacher/new`
- Teacher preview: `/v3/teacher/00000000-0000-4000-8000-000000005c03/preview`
- Student play: sign in as the student, then `/v3/play/start/00000000-0000-4000-8000-000000005c02`

**Without an OpenAI key.** Set `V3_FAKE_PASSES=1` so generation uses canned passes over the golden 1819 content. The
brief chat and in-game character replies still call a model. For characters, run
`node tests/browser/model-server.mjs` and start the app with
`OPENAI_API_KEY=local-browser-test OPENAI_BASE_URL=http://127.0.0.1:4010/v1`. Its replies are fixed, so it suits UI
work only. The brief chat is not confirmed to work against it; use a real `OPENAI_API_KEY` for that.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npx vitest run tests/api tests/unit   # API, session and pure-function tests (no database)
npm run db:test                       # database, RLS and platform tests (needs supabase running)
```

The browser acceptance suite in `tests/browser` is opt-in: it needs Playwright Chromium, the deterministic model
server and the dev server pointed at the local stack — see [`tests/browser/README.md`](tests/browser/README.md).

## Layout

```
apps/web                   Next.js App Router app; v3 lives under src/app/v3, src/components/play/v3,
                           src/lib/v3 and src/lib/play/v3
packages/spec-v3           The v3 adventure spec schema and its validation
packages/engine            Deterministic game rules: state, actions, triggers, outcomes, hints, Interview, reveal,
                           class summary
packages/play-contract     Schemas shared by the engine, API and student screens (actions, events, views)
packages/generation        Source ingest and the v3 generation passes (skeleton, details, endings, reveal, repair)
packages/orchestration     Character replies and post-turn checks, LLM client
packages/jobs              Background job runner for generation steps
packages/game-core         Map compilation and pathfinding
packages/game-client       Phaser map renderer and music
supabase/migrations        The schema, in order; the only way the database changes
scripts                    Seeding and measurement scripts
tests/api, tests/unit      API, session and pure-function tests
tests/db                   RLS and platform tests
tests/browser              Opt-in Playwright acceptance suite
docs/                      PRD v3, rationale, build notes; docs/archive holds retired material
```

Some routes and modules from before v3 are still in the codebase and are not the current product.

## Environment

See [`.env.example`](.env.example). Deployment (Vercel) needs
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_POSTHOG_KEY` and `OPENAI_API_KEY`, with the Vercel
project's root directory set to `apps/web` and the Next.js preset. v3 is enabled by default;
`V3_ENABLED` and `V3_SCHOOL_IDS` are optional rollout restrictions.

`main` is for development and deploys as a Vercel preview; `production` deploys to production.
No other branch deploys automatically ([`apps/web/vercel.json`](apps/web/vercel.json), read from
the project's root directory). The Hobby plan allows 100 deployments a day per account, and
branch previews used it up. For a preview of another branch, run `npx vercel deploy` from `apps/web`.

To release, open a PR from `main` into `production`; merging it deploys to Vercel and the CI
`migrate` job applies migrations to hosted Supabase. The Vercel project's Production Branch
(Settings → Git) must be set to `production`.

## Security model in one paragraph

The student's screen is built field by field from public data only: personas, stances, slants, key passages, outcome
rules and endings not reached never leave the server. Student actions are parsed with strict, bounded schemas, and
discoveries are recorded only by the server, so a client cannot forge progress. Row Level Security isolates schools,
teachers and students, with database tests for the v3 tables. Published versions are frozen, and each attempt stays
on the version it started. The engine reads no clock of its own; the server supplies the time, so the timer cannot be
gamed from the browser. Attempts are rate-limited and capped, and messages that break the rules are flagged to the
teacher.

## Group 9

| Member | Matriculation no. | Email | Main contributions |
| --- | --- | --- | --- |
| Hon Yi Hao | A0301205A | e1355571@u.nus.edu | Adventure generation pipeline (`packages/generation`), the Phaser renderer and client (`packages/game-core`, `packages/game-client`), teacher console generation flows |
| Damian Liew Cho Xiang | A0302976X | e1366515@u.nus.edu | Setup Vercel, Google OAuth, Supabase, Database schema, migrations and Row Level Security, the `tests/db` isolation suite, teacher console, platform and milestone write-ups |
| Zhang Li Kevin | A0309012W | e1406431@u.nus.edu | Turn loop and Resolver (`packages/orchestration`), character agents, the `tests/api` suite, play-side state projections |
| Hoo Di Heng | A0306753A | e1384318@u.nus.edu | Play UI and rendering polish (`packages/game-client`, `components/play`), teacher console, landing page, SEO and share cards |

Contributions are inferred from commit history; areas overlap because most features were
paired on.

## Resources used significantly

- **Next.js** (App Router) and **TypeScript** for the web app; **Tailwind CSS**, **Radix UI** primitives and **lucide-react** for the interface
- **Supabase** — Postgres, Auth, Row Level Security and **pgvector** for source retrieval
- **OpenAI API** for the planner, character agents and Resolver; **Zod** for schema validation at every model boundary
- **Phaser 3** for the 2D world
- **Vercel** for hosting, plus `next/og` for dynamic Open Graph images, and Vercel Analytics and Speed Insights
- **PostHog** for product analytics
- **Vitest** for the API, DB and unit suites
- **Devin** and **Claude Code** for parts of the implementation and the launch-milestone polish

Game art and media:

- **[Ninja Adventure Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack)** by Pixel-boy and AAA (CC0): characters, doors, effects, music and sound effects. `chatter.ogg` and `crowd.ogg` are synthesised by `scripts/make-street-audio.py`.
- **Terrain tilesets** from OpenGameArt, all CC0: [SandDesertTileSet16x16](https://opengameart.org/content/sanddeserttileset16x16) (GrumpyDiamond), [The Field of the Floating Islands](https://opengameart.org/content/the-field-of-the-floating-islands) (Buch and contributors), [Puny World](https://opengameart.org/content/16x16-puny-world-tileset) (Shade) and [16x16 Overworld Tiles](https://opengameart.org/content/16x16-overworld-tiles-0) (ARoachIFoundOnMyPillow). See [`apps/web/public/game/themes/README.md`](apps/web/public/game/themes/README.md).
- **Historical portrait** from the Library of Congress George Grantham Bain Collection (public domain); see [`apps/web/public/game/portraits/ATTRIBUTION.md`](apps/web/public/game/portraits/ATTRIBUTION.md).
- Story-specific portraits, landmarks, props, sprites and cutscenes are generated per adventure with OpenAI image models.

## Documentation

- [`docs/PRD-v3.md`](docs/PRD-v3.md) — product requirements
- [`docs/PRD-v3-rationale.md`](docs/PRD-v3-rationale.md) — the reasoning and team decisions behind each requirement
- [`docs/prd-v3/`](docs/prd-v3) — overview, glossary, diagrams and an example playthrough
- [`docs/v3-build/`](docs/v3-build) — build plan, checkpoints and handoffs
- [`docs/archive/`](docs/archive) — retired material, kept for reference only
