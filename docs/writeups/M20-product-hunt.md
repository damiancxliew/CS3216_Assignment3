# M20 — Product Hunt kit

The postable copy lives in `docs/launch/PRODUCT_HUNT.md` (name, tagline, description,
maker's first comment, topics, gallery list, links, launch-day notes). This write-up is
the reasoning behind it and the state of the assets.

## Positioning decision

Product Hunt's audience is builders, not history teachers, and the failure mode of an
AI-education launch there is being read as "ChatGPT wrapper for homework". So the copy
leads with the *artifact* rather than the model: **"Turn your history sources into a
game students can play"** — the teacher's own material is the input, and a playable
world is the output. The word "AI" does not appear in the tagline on purpose.

The description then spends its 260 characters on the one thing a builder audience will
actually interrogate — that the debrief shows the record, with page and quote, next to
what the simulation assumed.

## The first comment

The maker's note opens by conceding the easy half ("AI generates a history game") and
naming the hard half: a generated world states things that never happened in the same
confident voice it uses for things that did. Conceding the obvious criticism in the
first two lines is the cheapest credibility available, and it sets up the grounding
claim as an engineering answer rather than a marketing one.

It then lists three decisions that only make sense if you have taught a class —
immutable publishing, server-held deadlines, resume-from-server-state — because those
are what separate this from a demo, and they are checkable on the live site.

Expected questions, pre-answered in the launch notes: *"how do you stop it
hallucinating?"* (we don't stop it inventing, we make it declare — grounded spans vs.
labelled assumptions) and *"can I use my own textbook?"* (yes, PDF or pasted text).

## Gallery

Order is deliberate: hero, then **the debrief second** — the differentiating screen goes
before the pretty one, because most visitors see two images.

1. Landing page hero (1270×760) — **[TODO]** capture at launch resolution.
2. The debrief: documented history with citations beside labelled simulated
   assumptions. Captured during the WW2 demo (*The Last Week: Singapore, February
   1942*) and attached to
   <https://github.com/damiancxliew/CS3216_Assignment3/pull/23>; needs re-capture at
   1270×760 for the gallery.
3. Teacher console: source added, spec imported, publish + share link — captured in the
   same PR #23 comment, same re-capture needed.
4. Student play view with the stage countdown running — **[TODO]**; the countdown is
   real (server-held deadline), the surrounding play view is still the frozen I3 stub,
   so this shot waits on the runtime integration.
5. 30–60s screen recording, teacher source → student debrief — **[TODO]**; the flow has
   been run end to end locally, the recording needs a clean take on production.

Thumbnail: the generated OG card at `/opengraph-image`.

Demo fixtures (the WW2 handout and spec) are intentionally not committed — the
repository stays code-only; the screenshots live on the PR.

## Launch mechanics

Post at 00:01 PT = 15:01 SGT, with the team available that afternoon; answer every
comment within the hour for the first four hours, since comment velocity moves ranking
more than raw upvotes. Links point at the live deployment
(<https://historical-adventures-ten.vercel.app>) and the public repository.

## Honest gaps before this is launchable

Three of five gallery assets and the recording are outstanding, and one of them (the
play view) depends on work that is not in this slice. The copy is final; the assets are
not.
