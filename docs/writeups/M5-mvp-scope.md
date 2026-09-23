# M5 — MVP scope and future features

Source: `docs/PRD.md` §8, with the delivered state as of submission.

## The scoping rule we used

Everything in the MVP had to serve one claim: *a teacher's own sources become an
adventure a class can play in a period, and the student can tell what was documented
from what was simulated.* A feature that did not support that claim was cut regardless
of how good it would have looked in a demo.

## In scope — what ships

**Teacher:** Google sign-in; create an adventure; upload PDF or paste text; generated
Adventure Spec v2 with a stage editor; per-stage and adventure-default timers; publish
as an **immutable version** (editing afterwards copies into a new draft and leaves
in-flight attempts on the version they started); one share link, rotatable; a roster of
attempts.

**Student:** open the link, sign in, get a role brief; 1–3 stages, each a map with rooms
and doors; free movement; shared room chat with 3–4 autonomous stakeholders who hold
private motives and act between the player's turns; evidence into a journal;
options-only decisions from a Resolver-maintained list; probabilistic resolution;
server-held stage deadlines (a refresh or a client clock change buys no time; expiry
records a pass); persistence and resume; ending and a debrief that separates documented
history with citations from labelled simulation assumptions and names the divergence.

**Platform:** Supabase Postgres with row-level security and negative tests per table, a
public-projection boundary so no private agent context, unresolved roll or Resolver
rationale reaches a client (FR-21); deployment on Vercel; PostHog analytics from day one;
ambient overlays and a curated effect catalogue; an eval harness; landing page with OG
card; README and launch kit.

## Out of scope, deliberately

| Cut | Why |
| --- | --- |
| Multiplayer | Breaks decision resolution and historical grounding; single player is modelled as one more agent so it stays possible later (D2) |
| Free-text decision *proposals* | Options-only removes the "model invented an action the world cannot execute" failure class and shrinks the action allow-list surface (D18). Free text still drives conversation |
| Voice, combat | No pedagogical claim depends on them |
| Mobile layout | Phones are locked away in the target classroom; desktop web only (D1) |
| Classroom management, grading, LMS sync | Real needs, but a term of work and not needed to prove the core claim |
| Arbitrary historical periods at guaranteed quality | We claim bounded events with teacher-supplied sources, not all of history |
| Generated game code, generated terrain/UI art | Style drift and unplayability at the highest volume; terrain and UI are curated, generation is limited to ≤8 scene-specific images (D4) |

## Known gaps at submission

- `/play` renders public state and the debrief, but the Turn API it talks to is the
  frozen I3 contract; full conversational play through real attempt rows is the
  integration seam between the platform and the runtime.
- Assets fall back to placeholders; generation is non-blocking for publish by design.

## Future features, in the order we would build them

1. **Teacher-corrected spec library and one-click fork** — the corpus already accrues
   (M3); exposing it turns every published adventure into a starting point for another
   teacher and is our cheapest acquisition channel (M4).
2. **Classroom mode**: a roster view live during the lesson, per-student progress, and a
   whole-class debrief projected at the end. The first thing every teacher asks for.
3. **Free-text decision proposals**, mediated by the Resolver into the option list —
   the natural relaxation of D18 once the allow-list discipline is proven.
4. **Multiplayer**, one faction per student in the same world; the agent-symmetric
   design (D2/D17) was chosen to keep this reachable.
5. **LMS/Google Classroom integration and grading export** — necessary for school-wide
   purchase, worthless before it.
6. **Advanced retrieval over a school's whole source corpus**, so an adventure can be
   grounded in a textbook rather than a passage.
