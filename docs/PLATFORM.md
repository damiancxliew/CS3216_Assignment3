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

## Publishing and immutable versions (P4)

`publish_adventure(adventure_id)` stamps the newest draft `spec_version` and points
`adventure.published_version` at it. From that moment the version is frozen by
triggers rather than by convention: `spec_version` and everything hanging off it —
stages, rooms, agents, private context, evidence, objectives, options, maps — reject
INSERT, UPDATE and DELETE **for every role, service role included**, so the
generation pipeline cannot quietly rewrite a version students are playing either.

Editing after publish therefore means `create_draft_version(adventure_id)`, which
deep-copies the newest version into the next version number as a draft and rewrites
internal references (an agent's starting room, an option's branch target, the stage
ids inside `branch_map`) to point at the copies. Republishing stamps that draft.

An attempt pins `published_version` when it joins and RLS only exposes the pinned
version, so republishing mid-game is invisible to a game already in progress — the
test asserts exactly that, rewriting the adventure under a live attempt and checking
the student still sees the original stage.

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

## Teacher console (P5)

`/teacher` lists the signed-in teacher's adventures and creates new ones;
`/teacher/<id>` is the whole lifecycle for one of them: source material, versions,
publish, stage and stakeholder editing, the share link, and the roster of attempts.

Nothing on those pages filters by owner. The list query is a bare
`select … from adventure` and the detail page fetches by id alone — RLS is what
makes another teacher's adventure absent rather than forbidden, which also means a
broken policy fails visibly in the UI instead of being masked by a redundant
`where owner_id = …`.

Writes split by who is allowed to make them:

- The teacher's own row (`adventure`) and the owner-checked RPCs
  (`publish_adventure`, `create_draft_version`, `rotate_share_token`) go through the
  request-scoped client, so the database re-derives `auth.uid()` from the cookie.
- Authoring content (sources, spec import, stage and stakeholder edits) is written
  with the service role, because clients hold SELECT only on those tables by design
  (P2). Every such action re-reads the adventure through the user's client first: if
  RLS does not return the row, the action redirects instead of writing.

`persistSpecVersion` in `apps/web/src/lib/adventures/persist-spec.ts` is the seam the
generator plugs into. It validates an adventure spec v2, refuses to write anything at
all when validation fails, then inserts a new **draft** version — stages, rooms,
agents, evidence, objectives, decision options — rewriting every spec slug to the
uuid of the row actually inserted, so nothing downstream resolves slugs against the
json blob. Persona, motivations, hidden interests and knowledge horizon go only to
`agent_private_context`, which no client role can read (FR-21); the editor
consequently exposes a stakeholder's name, role and public position and nothing else.

Editing a published adventure is refused by the freeze triggers, not by the UI: the
console surfaces that as "this version is frozen, choose *Edit as a new version*",
which calls `create_draft_version` (P4).

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

## Stage timers (P6, D12/FR-16)

Configuration is inheritance: `adventure.default_timer_seconds` applies to every
stage, `stage.timer_seconds` overrides it, `null` inherits and `0` disables. Teachers
set both from the console; `set_stage_timer` checks ownership and refuses a frozen
version, so the same rule holds however the value arrives.

Enforcement is not configuration. The deadline is written by
`start_stage_deadline(attempt, stage)` from the database clock when a stage opens
(service_role only — opening a stage is orchestration, not a client action) and read
back from `attempt.stage_deadline_at`. The browser only renders it: a refresh re-reads
the same instant, and a device clock that is wrong changes the number on screen, not
the moment the stage closes. `expire_stage_if_due` compares `now()` in the database
and, only once the deadline has actually passed, records the player's pass as a
`stage_commitment` with `option_id is null` — doing nothing if a decision is already
there, so a late poll cannot overwrite a decision made in time. Closing the stage and
resolving it remain orchestration's job; this only guarantees the pass exists.

## Resume (P7, FR-18)

There is nothing to restore, because nothing was ever only in the tab: the attempt
row, `attempt_state` (journal, position), the room transcript and the stage's
commitments are all server-side already. `loadResumeState()` in
`apps/web/src/lib/attempts/resume.ts` reads them **as the signed-in user**, so RLS —
not the function — decides what comes back: another student's attempt is null, private
agent-to-agent messages are filtered by the `message_select` policy, and
`agent_memory`/`resolution` are denied to client roles outright (FR-21).

The recap is derived on each read rather than stored, so it can only ever restate
public state the student has already seen. The countdown resumes against `server_now()`
rather than the browser clock, so reopening a tab shows the real remaining time and
changes nothing about the deadline.

## Ending and debrief (P8, FR-19)

An ending is not a stage row — it lives in the pinned spec json — so an attempt only
records *which* ending it reached, in `attempt.ending_id`, written by
`complete_attempt()` (service_role only: reaching an ending is the Resolver's call,
not a student's).

The debrief's claim is a separation, and spec v2 already encodes it:
`ending.historicalOutcome` is `grounded()`, so it carries `spans` (source, page,
verbatim quote) and `assumptionIds`. `loadDebrief()` resolves those against
`spec.sources` and `spec.assumptions` and returns documented history and simulated
assumption as separately-typed fields, which is what stops the page from blurring
them. A span whose source is missing is still shown with its page and quote — the
student can check a citation we failed to resolve — while a dangling assumption id
shows nothing at all, because an empty claim must not be dressed up as a stated
assumption.

The whole read is against the version the attempt pinned, so republishing mid-attempt
cannot rewrite the history a student is being debriefed on.

## Analytics (M19)

Event names are frozen in `apps/web/src/lib/analytics/events.ts` and cover the funnel
landing → sign-in → authoring → publish → play → ending. PostHog initialises only
when `NEXT_PUBLIC_POSTHOG_KEY` is set, so local runs and CI produce no noise.
