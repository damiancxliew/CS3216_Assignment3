# Load testing a public v3 link

`scripts/load/v3-public-link.mjs` simulates a class opening one public v3 student link at the same
time, through the real HTTP surface. The target scenario is **30 students starting together**.

## What each virtual student does

| Step | Request | What it exercises |
| --- | --- | --- |
| `join page` | `GET /v3/join/<versionId>` | Server-rendered join page and publication lookup |
| `start` | `GET /v3/play/start/<versionId>` | Guest session (Supabase anonymous sign-in, plus identity sync on the split Auth/Data deployment) and attempt creation; expects a redirect to the game |
| `game page` | `GET /v3/play/<attemptId>` | Server-rendered game page: spec load, scenery and media resolution |
| `resume attempt` | `POST /api/v3/attempts` | Attempt resume with the full view |
| `action:tick` | every 15 s | The game client's background tick |
| `action:continue`, `enterRoom`, `openDocument`, `closeDocument` | as the student plays | Engine turns and database writes |
| `action:message` | `--chat` times per student | A real character reply: an LLM call |

Students pause 2–6 s between actions. Each keeps its own cookies, as separate browsers would.

## Running it

You need a v3 adventure that is **published and set to public**. Copy the link of its latest version
from the editor's Publication panel or the Versions dialog (`…/v3/join/<versionId>`).

```bash
# The scenario: 30 students arriving at once, playing for 5 minutes, 2 character messages each
npm run load:v3 -- --link https://staging.pocketadventures.world/v3/join/<versionId> --users 30

# A gentler arrival (spread over 60 s) and no LLM calls, to separate infrastructure from model latency
npm run load:v3 -- --link <link> --users 30 --ramp 60 --chat 0

# Smoke test first
npm run load:v3 -- --link <link> --users 3 --duration 60 --chat 1 --report load-report.json
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--users` | 30 | Simultaneous students |
| `--ramp` | 0 | Spread arrivals over this many seconds; 0 means all at once |
| `--duration` | 300 | Seconds each student plays after joining |
| `--chat` | 2 | Character messages per student (LLM calls) |
| `--tick` | 15 | Seconds between ticks |
| `--max-error-rate` | 0.02 | Fail above this share of failed requests |
| `--report` | — | Also write the full results as JSON |
| `--allow-production` | off | Required for hosts that are not staging, preview, dev or local |

## Reading the result

The script prints, per step: request count, failures, p50, p95, max latency (ms) and status codes,
then sample errors and **PASS** or **FAIL**. It exits non-zero on FAIL or if any student could not start.

The run passes when:
- every student started;
- at most 2% of requests failed. A `409` on an action is a stale revision (a tick and an action
  crossed), which the real client also retries, so it is not counted as a failure;
- p95 latency is within budget: start ≤ 15 s, page ≤ 8 s, action ≤ 5 s, character message ≤ 30 s.

## Known risk to check first: guest sign-in rate limit

Guest sessions are created **by the app server**, which calls Supabase Auth's anonymous sign-in. Every
student therefore appears to Supabase as the server's single IP address. Supabase limits anonymous
sign-ins **per IP per hour**; this repository's local config sets it to 30 (`supabase/config.toml`,
`[auth.rate_limit] anonymous_users`), and hosted projects have their own setting.

If that limit is 30 on staging, a class of 30 uses the whole hour's budget, and the next student,
or a second class, fails at `start` with `503 Could not start guest play`. A load test run also uses
the budget. The symptom in the report is `start` failures with status 503.

Fix before a real class: raise **Authentication → Rate Limits → anonymous sign-ins** in the Supabase
dashboard for the project in `NEXT_PUBLIC_SUPABASE_URL` (for example to a few hundred per hour), then
re-run.

## Side effects and cost

- Each run creates one anonymous user and one attempt per student in the target database. They are
  ordinary guest records; delete them from the Supabase dashboard if needed.
- `--chat 2` with 30 students makes 60 character replies, a few US cents at current model prices.
- The app limits actions to 20 per attempt per 10 s (`V3_RATE_LIMIT_PER_10S`). The script stays well
  under it, so a `429 rate_limited` in the report means the app's limiter, not the script, is the bottleneck.
- The script runs from one machine, so the app sees all students from one IP. Per-IP limits in front
  of the app (Caddy, a CDN) would apply to the test but not to a real class on separate devices.
  The Supabase anonymous sign-in limit above applies to both, because sign-in happens server-side.
