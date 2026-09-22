# M18 — Landing page, SEO and OG

**Live:** <https://historical-adventures-ten.vercel.app>
Source: `apps/web/src/app/page.tsx`, `layout.tsx`, `opengraph-image.tsx`, `robots.ts`,
`sitemap.ts`, `icon.svg`.

## What the page has to do

One visitor type matters: a history teacher who arrived from a colleague's message and
will decide in about eight seconds whether this is a toy. So the page answers three
questions in order — *what is it*, *what do I do*, *will it lie to my students* — and
nothing else. There is no pricing block, no logo wall and no testimonials, because we
have none and inventing them is exactly the credibility problem the product exists to
solve.

**Above the fold:** the headline *"Play the source material."*, one sentence of what
happens, and the only call to action — Teacher sign-in with Google. Sign-in *is* the
funnel; there is no email capture, because the activation event we care about
(`adventure_published`) is three clicks past the door.

**Two three-step columns**, teacher and student, so a teacher can see the whole loop
(drop in sources → get a world → publish and share one link; walk in as someone → ask,
compare, decide → find out what it cost) without scrolling into marketing copy.

**A dedicated panel for the objection**: "A simulation that admits it is one." Generated
history invents things; ours says which things. This is the single differentiating claim
from M1/M3 and it gets its own bordered block rather than a bullet, because it is the
sentence that decides whether a teacher trusts the product.

## SEO

- **Metadata** is defined once in the root layout with `metadataBase` bound to
  `NEXT_PUBLIC_SITE_URL`, a title template (`%s — Historical Adventures`), and a
  description written for a search snippet rather than for us.
- **`robots.ts` allows only `/`** and disallows `/teacher`, `/play`, `/join`, `/api` and
  `/auth`. RLS already makes those empty to an anonymous crawler, but the disallow is
  what keeps **share tokens out of search indexes** — a share link in Google is a
  student-privacy problem, not just an SEO one. This is the one SEO decision here with
  teeth.
- **`sitemap.ts`** lists the single public URL. A sitemap of one is honest; padding it
  with authenticated routes would be worse than having none.
- The brand term is not the SEO strategy. As argued in M4, the ranking play is per-topic
  template pages ("the fall of Singapore, 1942") that match what a teacher searches the
  week before they teach it — not built yet, and named as the next step rather than
  claimed.

## OG / link preview

The share link is the distribution mechanism (M4), so the preview is product surface.
`opengraph-image.tsx` generates a 1200×630 card at request time from the same strings as
the page — mark, wordmark, *"Play the source material."*, and the one-line description —
so the preview cannot drift from the site the way a committed PNG does. Twitter card is
`summary_large_image`, `openGraph.url`/`siteName` are set, and the mark also serves as
the favicon via `icon.svg`.

Verified by rendering `/opengraph-image` on the live deployment and checking the tab
icon and title on production.

## Performance and instrumentation

Server components throughout with no client JS on the landing page beyond the analytics
provider and the sign-in button; fonts via `next/font` (self-hosted, no layout shift).
Vercel Speed Insights and Analytics run alongside PostHog, and the page fires
`landing_viewed` — the first step of the funnel measured in M19.

## What I would change next

The page argues; it does not show. The highest-value addition is a 20-second silent loop
of an actual stage and the debrief above the fold, because the objection panel is asking
teachers to take the grounding claim on trust when we could simply display it.
