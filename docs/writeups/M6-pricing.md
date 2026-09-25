# M6 — Pricing and monetisation

Unit economics below use the per-attempt and per-generation cost measured by M12. Where
a number is still pending from M12 it is marked **[M12]** and the structure of the
argument is given so only the figure changes.

## What a unit costs us

Two cost events, with very different shapes:

| Event | Driver | Frequency |
| --- | --- | --- |
| **Generation** of an adventure | Planner LLM over the teacher's sources + ≤8 images, cached by prompt hash, capped by D4 | Once per published version, amortised over every student who plays it |
| **An attempt** | Character agents ticking autonomously (D17) + the Resolver per stage; the dominant term, and the one that scales with students | Once per student per adventure |

Generation is a fixed cost per lesson; attempts are the variable cost. A class of 30 on
one published adventure is therefore `1 × generation + 30 × attempt`, and the attempt
term decides whether any per-seat price works.

- Measured cost per attempt: **[M12]** (target: under S$0.15 at the tiering in D14).
- Measured cost per generation: **[M12]** (target: under S$1.00 including images).
- Implied cost of one 30-student lesson: **[M12]**.

The controls that keep this bounded are already in the design rather than in a future
optimisation: model tiering per call (D14), the agent tick-rate budget (FR-12b), the ≤8
image cap with prompt-hash caching (D4), and the ~15-minute session target (D15).

## Why not the obvious models

**Per-seat student licensing** is how EdTech is usually sold and it is wrong here: the
school buys seats for students who play a handful of adventures a year, so we would be
charging for idle capacity and the teacher — the only person we have to convince —
cannot authorise it.

**Pure usage-based (per attempt)** matches cost exactly and is unsellable to a school:
a department cannot approve a bill that depends on how engaged the students were, and it
punishes the exact behaviour we want (replaying with a different strategy).

**Ads, or free with student data**, is disqualifying in a secondary-school product.

## The model: per-teacher, with a class allowance

The landing page ships these tiers as Scout, Expedition and Dynasty; the figures below are unchanged.

| Tier | Price | Included | Who it is for |
| --- | --- | --- | --- |
| **Free** | S$0 | 2 published adventures, 60 student attempts/month, our branding on the debrief | A teacher trying it on next week's lesson. This is the acquisition channel (M4), not a trial |
| **Teacher** | S$12/month (S$120/year) | Unlimited adventures, 600 attempts/month (≈ 4 classes × 5 lessons), own source library, no branding | The individual adopter, paid personally or from a department budget |
| **Department** | S$400/year per department (up to 10 teachers) | Pooled 8,000 attempts/year, shared adventure library, teacher-corrected forks across the department | The realistic purchase unit — adoption happens at a department meeting |
| **School / district** | Quoted | SSO, LMS export, admin roster, pooled allowance | Follows a successful term-long pilot |

Overage is sold as attempt packs rather than throttled mid-lesson: a class must never
stop playing because an allowance ran out. Failing open and invoicing is the only
acceptable behaviour in a classroom.

**Gross margin at the Teacher tier** = `12 − (attempts used × cost/attempt) − (generations × cost/generation)`.
With the M12 targets above and a typical month of 4 classes, that lands near **[M12]**;
the tier allowances were chosen so that a teacher at the *top* of their allowance is
still positive, which is the only version of this arithmetic worth stating.

## Why this is the right shape

1. It is priced to the person who decides. A teacher can expense S$12 or argue for
   S$400 at a department meeting; neither requires a procurement cycle.
2. The allowance is denominated in the thing that actually costs us money (attempts),
   so margin does not depend on guessing usage.
3. The free tier is generous enough to run one real lesson with a real class, because
   our acquisition loop is a teacher showing a colleague a lesson that worked (M4) —
   crippling the free tier would break the only channel we have.
4. It leaves the compounding asset alone: the shared, teacher-corrected library is a
   *benefit* of the paid tiers, not a paywalled artifact, because its value to us (M3)
   is that it grows.

## To finalise before submission

Replace each **[M12]** with the measured figure and restate the margin line; if cost per
attempt lands materially above the S$0.15 target, the lever is the agent tick rate
(FR-12b), not the price.
