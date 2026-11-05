# Staging demo analytics

The standalone Lim Bo Seng demo sends gameplay events only when the analytics environment is `staging` and a PostHog project token was supplied at build time. The AWS workflow sets `NEXT_PUBLIC_APP_ENV=staging`. The production build retains its existing gameplay behaviour; it does not emit these demo events.

## Shared project setup

In GitHub's `aws-staging` environment, set `NEXT_PUBLIC_POSTHOG_KEY` as a **secret** and `NEXT_PUBLIC_POSTHOG_HOST` as a **variable**. The token may be the existing production project's public ingestion token. Run the AWS staging deploy workflow after merging. Changing EC2 runtime environment variables alone does not update the browser bundle.

Every browser event receives an `environment` property, including page views and automatic captures. Use `environment = staging` for demo evaluation and `environment = production` for production dashboards. Existing historical events will not acquire this property retroactively; use a hostname filter when analysing old production data. Staging uses separate PostHog browser persistence and does not share a cross-subdomain cookie with production.

## What can we learn?

| Question | Events and interpretation |
| --- | --- |
| Where do students stop? | `demo_started` / `demo_resumed` → `demo_chapter_started` → `demo_chapter_completed` → `demo_completed`. Completion means reaching the final reveal after both reflections. Chapter completion means passing the gated exit, not merely submitting a decision. |
| Which spaces and evidence attract attention? | `demo_room_entered`, `demo_source_inspected`, `demo_npc_conversation_started`. Conversation start is the first successful player exchange with that NPC in the chapter, not opening the chat panel. Sources include the archive, shelf excerpts, photographs and discovery panels. An inspection means displaying the source question, not proven reading. |
| Which questions need support? | `demo_quiz_answered` includes `source_id`, `option_index`, `correct` and `attempt_in_visit`. Attempts reset when reopening the reader; a repeated click on the same checked answer adds no attempt. Persisted hints do not emit answers on reload. |
| What decisions and follow-up actions occur? | `demo_decision_submitted` includes `choice_id`; `demo_restarted` and `demo_report_downloaded` distinguish resets and exports. These are engagement signals, not grades. |

Demo events carry `demo_id=lim-bo-seng`, a one-based `chapter`, `chapter_id`, `room_id`, and `preview_mode`. Page reloads resume saved progress rather than reporting chapter starts again. A chapter start occurs when its introduction is dismissed. Analytics failure cannot fail a committed gameplay action. No custom event includes student messages, notes, reflections, API replies or full saved state.

## Replays

Enable Session Replay in the shared PostHog project. Keep any existing production replay rules; add a recording rule matching `https://staging.pocketadventures.world/demo/lim-bo-seng` if current rules exclude it. Project recording rules and sampling still apply; the app does not force recording or bypass them.

On staging, recording is allowed only on the demo route, including client navigation. Canvas capture is requested locally at 2 fps and 0.4 quality, so enabling it globally for production is unnecessary. It shows the authored Phaser map and movement, rather than a full-frame-rate gameplay video. Inputs and displayed conversation/article text are masked; network bodies, headers and console recording are disabled for this staging setup. The map renders authored content rather than student chat text.

Filter recordings by the staging URL. After deployment, play the demo and verify a labelled `$pageview`, one quiz retry followed by a correct answer, chapter events, and a replay with a visible moving map. Code tests cannot establish whether a particular PostHog project's recording controls are enabled.

## Local verification

Use a fake token and a local interception endpoint:

```sh
NEXT_PUBLIC_APP_ENV=staging NEXT_PUBLIC_POSTHOG_KEY=phc_local_analytics_test NEXT_PUBLIC_POSTHOG_HOST=http://127.0.0.1:3012/analytics-test npm run dev --workspace web -- --port 3012 --hostname 127.0.0.1
RUN_DEMO_ANALYTICS_BROWSER=1 npm test -- tests/browser/demo-analytics.test.ts
npm test -- tests/demo-analytics.test.ts
```

The browser test intercepts PostHog ingestion locally and disables remote recording. It checks real event payloads, source visits, wrong/correct answers, reload behaviour and environment tagging without using the production token. Replay configuration is covered separately; verify recording ingestion against PostHog after deployment.

To disable staging capture, remove the staging token and rebuild/redeploy. Turning off the project's replay setting affects the shared production project too, so use staging URL rules when changing only staging recording.
