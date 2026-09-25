# M18 — Landing page, SEO and OG

**Live:** <https://historical-adventures-ten.vercel.app>
Source: `apps/web/src/app/page.tsx`, `layout.tsx`, `opengraph-image.tsx`, `share/og/route.tsx`,
`share/page.tsx`, `manifest.ts`, `robots.ts`, `sitemap.ts`, `icon.svg`,
`components/pricing.tsx`, `components/share-buttons.tsx`, `lib/pricing.ts`,
`lib/seo/structured-data.ts`.

## What the page has to do

One visitor type matters: a history teacher who arrived from a colleague's message and
will decide in about eight seconds whether this is a toy. The page answers four questions
in order — *what is it*, *what does playing it actually look like*, *what do I have to do*,
*what will it cost me* — and nothing else. No logo wall, no testimonials: we have neither,
and inventing them is exactly the credibility problem the product exists to solve.

**Hero.** "Don't just teach history. Drop them into it.", one sentence of what the product
does, and the only primary call to action — Google sign-in into the teacher console. Next
to it, an autoplaying muted clip of real gameplay (a student questioning Raffles in
Singapore, 1819). Earlier drafts of this page argued; this one shows, because the grounding
claim is the whole product and a teacher can check it in four seconds of footage faster
than in four paragraphs. The clip respects `prefers-reduced-motion` (it falls back to a
poster frame with controls) and only plays while it is on screen.

**Features — "Inside every adventure".** Four numbered beats (walk the world, question
everyone, choose under pressure, know fact from fiction), each paired with a small
illustrative mock of that exact interaction rather than a stock icon. The fourth beat
carries the differentiating claim from M1/M3: every ending separates documented history
from the simulation's assumptions.

**Three steps from PDF to playtime**, so a teacher can see the whole loop — drop in your
sources → get a playable world → send one link — without scrolling into marketing copy.

**Pricing.** Three tiers (Scout / Expedition / Dynasty) with a monthly–annual toggle,
rendered from `lib/pricing.ts`, which is the same set of figures argued for in M6. Two
deliberate decisions here:

- The tiers are priced to the person who can actually say yes — a teacher expensing S$12,
  or a head of department approving S$400 a year — not per student seat. The reasoning is
  in M6; the page only states the outcome.
- The section ends with **"Billing isn't live yet: every tier is free while we pilot with
  schools, and we'll tell you before that changes."** A pricing page on a product that
  cannot yet take payment is a promise about the future, and a product whose entire pitch
  is *we tell you which parts are invented* cannot start by hiding that. It is also the
  honest answer to the objection the price raises ("so am I being charged today?").

**Closing CTA and footer**, repeating the single conversion action.

## SEO

- **Metadata** is defined once in the root layout: `metadataBase` bound to
  `NEXT_PUBLIC_SITE_URL`, a title template (`%s — Historical Adventures`), a description
  written for a search snippet rather than for us, `keywords`, `openGraph.locale`, and a
  **canonical URL**, so the Vercel preview domains and any future custom domain cannot
  compete with the production URL for the same content.
- **Semantic structure**: one `<h1>`, one `<h2>` per section, `<nav>`/`<main>`/`<footer>`
  landmarks, and every `<section>` labelled with `aria-labelledby` pointing at its own
  heading — the same tree a crawler reads is the one a screen reader announces.
- **Structured data**: a JSON-LD `@graph` (`Organization`, `WebSite`,
  `SoftwareApplication` with one `Offer` per tier) generated in
  `lib/seo/structured-data.ts` *from `PRICING_TIERS`*, so the markup cannot quote a price
  the page does not show. This is the pattern used throughout: every duplicated string on
  this page — description, price, OG copy — has exactly one definition.
- **`robots.ts` allows only `/`** and disallows `/teacher`, `/play`, `/join`, `/api` and
  `/auth`. RLS already makes those empty to an anonymous crawler, but the disallow is what
  keeps **share tokens out of search indexes** — a share link in Google is a
  student-privacy problem, not just an SEO one. This is the one SEO decision here with
  teeth.
- **`sitemap.ts`** lists the single public URL. A sitemap of one is honest; padding it with
  authenticated routes would be worse than having none.
- **`manifest.ts`** makes the site installable and pins the theme colour to the paper
  background, so a saved icon never flashes a colour the site doesn't use.
- The brand term is not the SEO strategy. As argued in M4, the ranking play is per-topic
  template pages ("the fall of Singapore, 1942") that match what a teacher searches the
  week before they teach it — not built yet, and named as the next step rather than
  claimed.

## OG / link preview

The share link is the distribution mechanism (M4), so the preview is product surface, and
there are two of them.

**The site card** (`opengraph-image.tsx`) is generated at request time from the same
strings as the page — mark, wordmark, headline and the one-line description — so the
preview cannot drift from the site the way a committed PNG does. `og:url`, `og:site_name`,
`og:locale`, `og:image:alt` and `twitter:card = summary_large_image` are all set, and the
mark also serves as the favicon via `icon.svg`.

**The ending card** is the interesting one. A student who finishes an adventure can share
their ending from the debrief (X, LinkedIn, WhatsApp, Telegram, or copy link). The link
points at `/share`, whose OG image is generated per request by `share/og/route.tsx` from two
query parameters — the adventure title and the ending reached — so what appears in the
group chat is *"Singapore, 1819 — The Merlion Compromise"* on a branded card, not a generic
site preview. Three constraints shaped it:

- **Nothing private may enter the URL.** Only those two titles travel; attempt ids, share
  tokens, evidence and decisions never do. That is why sharing routes through `/share`
  rather than through the debrief URL itself.
- **Query parameters are attacker-controlled**, so both are stripped of control characters
  and truncated before rendering, and the JSON-LD is escaped against script-tag breakout.
- **`/share` is `noindex`.** It is a landing spot for a link, not a page we want competing
  with `/` in search results.

Each share button carries UTM parameters and fires a PostHog event with the network, so
M19 can see whether student sharing is a real acquisition channel or a feature we assumed.

## Performance and instrumentation

Fonts via `next/font` (self-hosted, no layout shift); the gameplay clips are
`preload="none"` and play only while intersecting the viewport, so the hero costs one
poster image on first paint. Vercel Speed Insights and Analytics run alongside PostHog,
and the page fires `landing_viewed` and `pricing_cta_clicked` — the first steps of the
funnel measured in M19.

## What I would change next

Two things. First, the per-topic template pages described above: they are the only part of
the SEO story that would bring traffic we do not already know. Second, the pricing section
currently states tiers; once billing is live it should state *usage* — "your class of 30
used 2% of this month's allowance" is a far stronger argument for the Expedition tier than
any copy we can write.
