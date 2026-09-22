# M14 — Name and logo

## The name: Historical Adventures

Chosen for legibility to the only audience that has to understand it in one glance — a
teacher scanning a list of tools. It says the subject and the format, and it survives
being read aloud at a department meeting without explanation.

It is deliberately not clever. A history teacher searching for a classroom tool is not
looking for a brand; the product's differentiation (grounded claims vs. labelled
assumptions) is a sentence, not a pun, and the tagline carries it: *"Turn your history
sources into a game students can play."*

### Alternatives considered

| Name | Why not |
| --- | --- |
| **Counterfactual** | Precisely describes what the simulation does, and mis-sells it: the product's core promise is fidelity to the record, and this name foregrounds invention — the exact anxiety a teacher has |
| **Chronicle** | Elegant, heavily used across note-taking and journalism products, and says nothing about play |
| **Pastport** | Memorable, the kind of pun that reads as a consumer toy; wrong register for something a teacher defends to a head of department |
| **Sourceplay** | Captures source-grounding *and* play, and is opaque on first read — "source" reads as source *code* to half the audience |
| **Ford Motor Factory** *(scenario-derived names)* | Ties the brand to one adventure |

The trade-off accepted: a generic name has no trademark strength and competes poorly for
search on its own. We take that, because the SEO plan (M4) is per-topic template pages,
not the brand term, and a name that needs explaining costs more at the classroom door
than it gains in distinctiveness.

## The logo

A single mark used at every size: a **swallow-tailed pennant on a staff**, drawn as two
flat shapes in mint (`#6ee7b7`) on the product's near-black (`#0b0f0c`). Source:
`apps/web/src/app/icon.svg` — the same two shapes are inlined into the
generated OG card, so the favicon, the tab icon and every shared-link preview are one
drawing rather than three assets that drift.

A planted standard reads as both *exploration* and *claimed ground* — which is the
product: you walk into a situation and you have to commit to something.

Constraints it had to satisfy:

- **Two flat shapes, one colour.** It appears at 16px as a favicon and at 1200px in the
  OG card. Anything with detail dies at the small end.
- **No clock, no scroll, no laurel wreath.** The obvious history iconography codes as
  *dusty*, and the product is trying to argue that the past was contingent and live.
- **Works on the dark landing hero.** Hence a flat fill, no gradients, and a rounded
  dark tile behind the mark so it also survives a light browser tab strip.

The generated OG card (`apps/web/src/app/opengraph-image.tsx`, 1200×630) pairs the mark
with the wordmark and the tagline, so every shared link — which is how this product
spreads — carries both. The card is generated from the same strings as the page rather
than committed as a PNG, so the preview cannot drift from the site.

Evidence: the live site at <https://historical-adventures-ten.vercel.app>, its tab icon,
and the OG card rendered at `/opengraph-image`.
