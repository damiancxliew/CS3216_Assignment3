# Platform setup (P1, P2, P3, P9, I3)

## Prerequisites

- Node 22+ (`@supabase/supabase-js` needs the native `WebSocket` global)
- Docker (for the local Supabase stack)
- Supabase CLI (installed as a dev dependency, so `npx supabase` works)

## Local development

```bash
npm ci
cp .env.example apps/web/.env.local   # fill in the values printed by `npm run db:start`
npm run db:start                      # boots Postgres, Auth, Studio in Docker
npm run db:reset                      # rebuilds the database from migrations only
npm run dev                           # http://localhost:3000
```

`npm run db:reset` is the single command that rebuilds a fresh database. The schema
lives only in `supabase/migrations/`; nothing is ever applied by hand, so a teammate
or CI can reproduce the exact database from a clean checkout.

## Tests

| Command | Covers |
| --- | --- |
| `npx vitest run tests/api` | I3 Turn API contract, timer derivation, FR-21 leak checks |
| `npx vitest run tests/db/share-links.test.ts` | P3 — published-only share links, join, resume, token rotation |
| `npm run db:test` | resets the database, then runs the RLS negative tests |
| `npm run lint` / `npm run typecheck` / `npm run build` | web app |

The RLS suite (`tests/db/rls.test.ts`) creates two teachers and two students and
asserts, per table, that the second account sees nothing. Tables that hold private
agent context, agent memory and Resolver rolls are unreadable by every client role.

## Schema (PRD §6)

`supabase/migrations/20260920100000_init_schema.sql` creates the data model:
authoring (`adventure`, `source`, `source_chunk`, `spec_version`, `stage`, `room`,
`agent`, `evidence`, `objective`, `decision_option`, `map_artifact`) and play
(`attempt`, `attempt_state`, `message`, `resolution`, `agent_memory`).

Two things the schema enforces rather than the application:

- **Immutable publishing (P4).** `attempt.published_version` pins the spec version an
  attempt is playing. A teacher editing a published adventure writes a new
  `spec_version` row; in-flight attempts keep reading the pinned one, and RLS only
  exposes that exact version to the student.
- **Stage timers (D12/FR-16).** `adventure.default_timer_seconds` is the adventure-wide
  default, `stage.timer_seconds` is the per-stage override: `null` inherits, `0`
  disables. `effective_timer_seconds(stage_id)` resolves the two. The live deadline is
  `attempt.stage_deadline_at`, held server-side; the client only renders a countdown
  derived from the server's `secondsRemaining`, so a refresh or a client clock change
  cannot buy extra time.
- **Actor-kind-neutral decisions (D18/FR-14).** `stage_commitment` records one row per
  actor per stage of an attempt — `actor_kind` is `player` or `agent`, and
  `option_id is null` means a pass (declined, or the timer expired first). A stage
  closes when every actor has a row; orchestration owns closure, this table is the
  record. A client may read *that* an actor committed but never *what* they chose:
  `option_id` is withheld at the column grant, not merely omitted by the API.

## Auth and sharing links (P3)

Sign-in is Supabase Auth with Google. The browser client starts the OAuth dance,
`/auth/callback` exchanges the code for a session, and `middleware.ts` refreshes it
on every navigation so Server Components see a live user. `next` on the callback is
accepted only as a same-origin relative path, so a share link cannot be turned into
an open redirect.

A share link is `/join/<adventure.share_token>`, and the token is deliberately *not*
a read grant. It is an argument to two database functions:

- `share_link_preview(token)` — the only thing an anonymous visitor may call. It
  returns a title and setting **only** for a published adventure; a draft, an
  archived adventure and a token that belongs to nothing are all indistinguishable
  from each other, so an unpublished adventure is not reachable by link.
- `join_adventure(token)` — requires `auth.uid()`, resolves the published adventure,
  and either returns the student's existing active attempt (opening the link twice
  resumes rather than restarts) or creates one pinned to the current
  `published_version`, on the first stage, with `stage_deadline_at` set server-side
  from `effective_timer_seconds`.

Admission is therefore what grants access: after joining, the ordinary RLS policies
expose the pinned version and nothing else. A teacher can call
`rotate_share_token(adventure_id)` on their own adventure, which invalidates every
copy of the old link.

Enabling Google against the hosted project is dashboard configuration: add the OAuth
client, and add `<site>/auth/callback` to both the Google client's redirect URIs and
Supabase's redirect allow-list.

## Turn API (I3)

Frozen route handlers, currently backed by a canned in-memory stub so the client can
build tonight:

- `GET /api/attempt/:id/state`
- `POST /api/attempt/:id/message` — `{ roomId, body }`
- `POST /api/attempt/:id/decision` — `{ optionId }`, `409` on a stale option

State carries a `commitments` array — every actor that must commit before the stage
closes, human or agent, with a `committed` boolean only. The stub ticks its agents as
soon as the human is in rather than waiting the clock out, and records a pass for the
player when the deadline passes.

Every response is parsed through the public Zod schemas in
`apps/web/src/lib/turn-api/contract.ts` before it is returned, and
`findForbiddenKeys()` fails the test suite if a private-context, memory, roll,
rationale, knowledge-horizon or seed field ever appears in a payload (FR-21).
Swapping the stub for the real Resolver means replacing `stub.ts` only; the shapes
are frozen.

## Analytics (M19)

Event names are frozen in `apps/web/src/lib/analytics/events.ts` and cover the funnel
landing → sign-in → authoring → publish → play → ending. PostHog initialises only
when `NEXT_PUBLIC_POSTHOG_KEY` is set, so local runs and CI produce no noise.
