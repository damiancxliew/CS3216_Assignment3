# Historical Adventures

**Play the source material.** A teacher drops in historical sources; the system builds a
small world around them, fills it with people who each want something different, and lets
a student find out what their decisions cost.

Live at <https://historical-adventures-ten.vercel.app>.

Built for CS3216 Assignment 3, National University of Singapore.

## What it does

- **AI-generated playable worlds** — historical material becomes a navigable environment
  with meaningful locations, character placements, evidence, and objectives, generated
  together as one coherent adventure.
- **Interactive AI-driven gameplay** — stakeholders respond to the student's questions,
  discoveries, and decisions within a persistent world where consequences carry forward.
- **A simulation that admits it is one** — the debrief separates documented history, with
  the source, page and quote behind each claim, from the assumptions the simulation made
  where the record is silent.

## Users and flows

| User | Primary need |
| --- | --- |
| Secondary-school history teachers | Create curriculum-relevant adventures from their own material without game-development skills |
| Secondary-school students | Explore historical situations through objectives, interactive characters, and consequential choices |

**Teacher:** create an adventure → provide material → generate map, characters, evidence,
objectives → preview → correct or regenerate → publish and share → review attempts.

**Student:** join and read the role brief → explore and meet stakeholders → ask questions,
compare accounts, collect evidence → decide before the stage timer expires → observe
persistent changes → reach an ending and reflect.

## Quickstart

Requires Node 22 and Docker (for the local Supabase stack).

```bash
npm ci
npx supabase start                   # local Postgres, Auth and Studio
npx supabase db reset                # rebuilds the whole schema from migrations
cp .env.example apps/web/.env.local  # fill in the keys printed by `supabase start`
npm run dev --workspace apps/web     # http://localhost:3000
```

Next.js only reads `.env.local` from `apps/web/`, not the repository root. Set `OPENAI_API_KEY`
there too if you want "Generate from the sources" in the teacher console to work locally; without
it the console still accepts a spec pasted into "Import an adventure spec".

The database is **only ever** built from `supabase/migrations/`; `db reset` recreates it
from scratch, so a schema change that is not a migration does not exist.

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npx vitest run tests/api tests/unit   # Turn API, session and pure-function tests (no database)
npm run db:test                       # database, RLS and platform tests (needs supabase running)
```

The browser acceptance suite in `tests/browser` is opt-in: it needs Playwright
Chromium, the deterministic model server and the dev server pointed at the local
stack — see [`tests/browser/README.md`](tests/browser/README.md).

## Layout

```
apps/web            Next.js App Router app: landing, teacher console, play, debrief, Turn API
packages/generation Adventure Spec v2 schema, planner and compiler
packages/orchestration Resolver/Orchestrator runtime, character agents and safety rails
packages/game-core  Deterministic game logic and pathfinding
packages/game-client Phaser settlement-map playground client
packages/game-integration Adventure Spec to game-core spatial adapter
scripts             Demo seeding (seed-demo) and its vitest config
supabase/migrations The schema, in order; the only way the database changes
tests/api           Turn API and play-session tests over the in-memory store
tests/unit          Pure-function unit tests (no database, no network)
tests/db            RLS negative tests and platform behaviour tests
tests/browser       Opt-in Playwright student acceptance suite
docs/               PRD, execution spec, platform notes, launch kit, write-ups
```

## Environment

See [`.env.example`](.env.example). Deployment (Vercel) needs
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_POSTHOG_KEY` and `OPENAI_API_KEY`, with the Vercel
project's root directory set to `apps/web` and the Next.js preset.

## Security model in one paragraph

Every response a client sees is a public projection: private agent context, unrevealed
events, probability rolls and Resolver rationale live in tables and columns no client
role can select. Row Level Security isolates teachers to their own adventures and
students to their own attempts, with a negative test per table using a second account.
Published versions are immutable, so editing after publish creates a new version and
leaves in-flight attempts on the one they started. Stage deadlines are held server-side;
the client only renders the countdown, so a refresh or a changed clock buys no time.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements, schema and the public/private boundary
- [`docs/PLATFORM.md`](docs/PLATFORM.md) — how auth, versioning, timers, resume and the debrief work
- [`docs/EXECUTION_SPEC.md`](docs/EXECUTION_SPEC.md) — task breakdown and per-task validation
- [`docs/launch/`](docs/launch) — Product Hunt kit and submission checklist
- [`docs/specs.md`](docs/specs.md) — full system specification
