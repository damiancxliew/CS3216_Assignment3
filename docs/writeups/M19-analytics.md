# M19 — Analytics (awaiting data)

Status: instrumentation landed 20 Sep; the production deploy
(<https://historical-adventures-ten.vercel.app>) has been ingesting into PostHog (US
cloud) since 22 Sep. Numbers and the observation-driven change are filled in once the
window has a few days in it — see "To fill in" below.

## What we measure and why

The product claim is that a teacher can turn a set of sources into a playable
historical adventure, and that a student finishes it. That is a two-sided funnel, so
we instrument both sides with one frozen event vocabulary
(`apps/web/src/lib/analytics/events.ts`):

**Teacher funnel:** `landing_viewed` → `sign_in_started` / `sign_in_completed` →
`adventure_created` → `source_uploaded` → `generation_started` /
`generation_completed` → `adventure_published` → `share_link_copied`.

**Student funnel:** `attempt_started` / `attempt_resumed` → `room_entered` →
`message_sent` → `decision_committed` (or `stage_timer_expired`) → `stage_advanced` →
`ending_reached` → `debrief_viewed`.

Names are declared centrally rather than typed at each call site so that a funnel
defined on Monday still resolves on Friday.

## Questions the data should answer

1. Where do teachers drop out — at sign-in, at uploading sources, or while waiting for
   generation? The gap between `generation_started` and `generation_completed` also
   gives us real latency to report against M12's cost/latency numbers.
2. Do students actually converse, or do they jump straight to the decision? The ratio
   of `message_sent` to `decision_committed` per stage is the clearest signal that the
   agent conversation carries the experience rather than decorating it.
3. How often does the stage timer, not the player, end a stage
   (`stage_timer_expired` / `decision_committed`)? If this is high the default timer is
   too short.
4. Completion: `attempt_started` → `ending_reached`, and how many go on to
   `debrief_viewed` — the debrief is where the documented-vs-simulated distinction
   lives, so if nobody reads it, that pedagogical claim is unsupported.

## Setup

PostHog, initialised client-side only when `NEXT_PUBLIC_POSTHOG_KEY` is present, with
App Router pageviews captured explicitly (the SDK's automatic capture misses client
navigations in the App Router). Vercel Analytics and Speed Insights run alongside for
web-vitals, which feed the performance half of the write-up.

## To fill in before submission

- Event volumes and funnel conversion for the real window (PostHog project 621035),
  with the funnel screenshot.
- At least one change we made because of an observation, with the before/after numbers.
  Candidate triggers, in the order we expect them to fire: teacher drop-off between
  `adventure_created` and `adventure_published` (would mean the review step is too
  heavy), a `message_sent` : `decision_committed` ratio near zero per stage (would mean
  the conversation is decorative and the decision needs gating on evidence), and a high
  `stage_timer_expired` share (would mean the default timer is too short — the fix is a
  one-line default, so this is the cheapest change to ship and measure).
