# Submission checklist

Due **Fri 25 Sep 2026, 23:59**. Tick items only when the evidence exists, not when the
work feels done.

## Product

- [x] Schema rebuildable from migrations with one command (`supabase db reset`) — P1
- [x] RLS with a negative test per table using a second account — P2
- [x] Google sign-in and share links that only admit students to a published adventure — P3
- [x] Publishing immutable; editing after publish creates a version, in-flight attempts undisturbed — P4
- [x] Teacher console: create, sources, publish, share link, attempt roster — P5
- [x] Stage timers: adventure default + per-stage override, server-held deadline, pass on expiry — P6
- [x] Persistence and resume with a recap, no extra time bought by a refresh — P7
- [x] Ending debrief separating documented history (with citations) from simulated assumption — P8
- [x] Deployed to Vercel with env keys set; PostHog receiving real events — P9
      (<https://historical-adventures-ten.vercel.app>)
- [x] Landing page with SEO/OG, README, Product Hunt kit — P10

## Launch assets

- [ ] Live public URL, reachable signed-out, OG preview renders (check with the Product
      Hunt/Twitter card debugger, not just locally)
- [ ] Five gallery images and the demo recording (see `PRODUCT_HUNT.md`)
- [ ] Product Hunt draft created with tagline, description, first comment and topics
- [ ] A seeded demo adventure that a grader can play without a teacher account

## Write-ups

- [ ] M0–M6
- [ ] M14
- [ ] M18
- [ ] M19 — needs several days of real PostHog data, so it is gated on P9 landing early
- [ ] M20

## Still blocked on credentials (not on code)

Google OAuth client id/secret, with `https://historical-adventures-ten.vercel.app/auth/callback`
on both Google's and Supabase's redirect allow-lists. Sign-in on the deployed site fails
until that exists.

## Final pass

- [ ] `npm ci && npm run lint && npm run typecheck && npm run build` clean from a fresh clone
- [ ] `npx supabase db reset && npx vitest run tests` green from a fresh clone
- [ ] CI green on `main`
- [ ] No secrets in the repo or in the deployed client bundle
- [ ] README quickstart followed verbatim on a clean machine
