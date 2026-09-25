# M6 — Pricing and monetisation

Unit economics below use the per-attempt cost measured in
[`M12-play-metrics.md`](M12-play-metrics.md) and the per-generation cost in
[`M12-generation-metrics.md`](M12-generation-metrics.md), in SGD at an assumed 1.29 per USD.

## What a unit costs us

Two cost events, with very different shapes:

| Event | Driver | Frequency |
| --- | --- | --- |
| **Generation** of an adventure | Planner LLM over the teacher's sources + ≤8 images, cached by prompt hash, capped by D4 | Once per published version, amortised over every student who plays it |
| **An attempt** | Character agents ticking autonomously (D17) + the Resolver per stage; the dominant term, and the one that scales with students | Once per student per adventure |

Generation is a fixed cost per lesson; attempts are the variable cost. A class of 30 on
one published adventure is therefore `1 × generation + 30 × attempt`, and the attempt
term decides whether any per-seat price works.

- Measured cost per attempt: **median S$0.042**, max S$0.060 over 7 simulated attempts
  (quick S$0.002, typical S$0.04, chatty S$0.06; chatty real play estimated up to ~S$0.13).
  Under the S$0.15 target. Three quarters of it is option minting on `gpt-6-sol`.
- Measured cost per generation: **≈ S$0.59** including 8 images (target: under S$1.00).
- Implied cost of one 30-student lesson: **≈ S$1.85** (1 generation + 30 attempts).

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

| Teacher-tier month | Attempts | Generations | Cost | Margin at S$12 (S$10 annual) |
| --- | --- | --- | --- | --- |
| Typical: 4 classes × 30, one adventure each | 120 | 4 | S$7.40 | **+S$4.60** (+S$2.60) |
| Top of allowance | 600 | 10 | S$31.10 | **−S$19.10** (−S$21.10) |
| Top of allowance, minting moved to `gpt-6-luna` | 600 | 10 | S$12.50 | −S$0.50 (−S$2.50) |

The allowances were meant to keep a teacher at the *top* of their allowance positive. At
the measured S$0.042 per attempt they do not: 600 attempts only break even below
S$0.02 per attempt (S$0.017 on annual billing). The typical month is positive; the
allowance is not. The same arithmetic puts Starter at ≈ S$3.70 a month per active free
teacher (60 attempts, 2 generations) and Department at ≈ S$336 of attempt cost against
S$400 a year if the pool is used up.

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

The cost figures are in. What is left is a decision on the allowance, since the
measured cost makes the top-of-allowance month negative. The levers, cheapest first:

1. **Move option minting to `gpt-6-luna`** — it is ~77% of a typical attempt, and this
   takes an attempt to ≈ S$0.011. Needs an eval that proposal quality holds.
2. **Lower the allowances** to what the typical month uses (e.g. Teacher 250, Starter 30).
3. **Raise the price**, last, since the argument above is that S$12 is what a teacher can
   expense without asking.

The agent tick rate (FR-12b), which this section used to name as the lever, turned out
not to be one: character replies are under a quarter of the cost.
