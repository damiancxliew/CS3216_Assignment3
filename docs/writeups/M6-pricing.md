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

Prices are unchanged from the first draft; the allowances were cut on 25 Sep once the cost
per attempt was measured (below). Each tier includes everything in the one before. The
cards list only what the product does today or a plan term the team can honour — shared
department libraries, forks and school admin are not listed until they are built.

| Tier | Price | Included | Who it is for |
| --- | --- | --- | --- |
| **Starter** | S$0 | Adventures built from your own PDFs and notes, 2 published adventures, 30 student attempts/month (one class, one lesson), stock art only, Historical Adventures watermark on the debrief | A teacher trying it on next week's lesson. This is the acquisition channel (M4), not a trial; the watermark is a link back from every student's debrief |
| **Teacher** | S$12/month (S$120/year) | Starter, plus: class results summary, unlimited published adventures, 150 attempts/month (≈ 5 class lessons of 30), custom artwork, no watermark | The individual adopter, paid personally or from a department budget |
| **Department** | S$400/year (S$40/month), up to 10 teachers | Teacher, plus: 5,000 attempts/year shared across the department, an onboarding session where we build the first adventure with them, priority support during the pilot | The realistic purchase unit — adoption happens at a department meeting |
| **School / district** | Quoted, later | SSO, LMS export, admin roster (none built yet) | Follows a successful term-long pilot |

Overage is sold as attempt packs rather than throttled mid-lesson: a class must never
stop playing because an allowance ran out. Failing open and invoicing is the only
acceptable behaviour in a classroom. The pack price is not on the page yet; at the
measured cost it needs to be at least S$0.06 an attempt to cover the most expensive one.

The onboarding session is the one benefit that costs the team time rather than tokens —
about an hour per department. At S$400 a year that is affordable, and it is also how the
first adventure gets built well, which is what makes a department renew.

## Does it pay?

Measured cost per attempt: median **S$0.042**, max S$0.060 ([M12](M12-play-metrics.md));
generation ≈ S$0.59 per adventure.

**Gross margin at the Teacher tier** = `12 − (attempts used × cost/attempt) − (generations × cost/generation)`.

| Teacher-tier month | Attempts | Generations | Cost | Margin at S$12 (S$10 annual) |
| --- | --- | --- | --- | --- |
| Typical: 4 classes × 30, one adventure each | 120 | 4 | S$7.40 | **+S$4.60** (+S$2.60) |
| Top of allowance, median attempts | 150 | 5 | S$9.25 | **+S$2.75** (+S$0.75) |
| Top of allowance, every attempt as costly as the worst measured | 150 | 5 | S$11.95 | +S$0.05 (−S$1.95) |

A teacher at the *top* of their allowance is positive at the median cost, which was the
test the first draft set and failed at 600 attempts (−S$19.10). The margin is thin on
annual billing, so the allowance should not grow until the cost does not either.

| Other tiers, fully used | Cost | Revenue | Margin |
| --- | --- | --- | --- |
| Starter, per active free teacher (30 attempts, 2 generations a month) | S$2.44/month | S$0 | acquisition cost |
| Department (5,000 attempts, ~40 generations a year) | S$233.60/year | S$400 | **+S$166.40** (42%) |

The tiers now step up in the right direction: Teacher works out at S$0.067 per included
attempt on annual billing and Department at S$0.08, paying for the shared library. Two
teachers are better off on two Teacher plans (S$240, 3,600 attempts); from four teachers
Department is the cheaper way to buy it, which is where a department meeting starts.

## Why this is the right shape

1. It is priced to the person who decides. A teacher can expense S$12 or argue for
   S$400 at a department meeting; neither requires a procurement cycle.
2. The allowance is denominated in the thing that actually costs us money (attempts),
   so margin does not depend on guessing usage.
3. The free tier is generous enough to run one real lesson with a real class, because
   our acquisition loop is a teacher showing a colleague a lesson that worked (M4) —
   crippling the free tier would break the only channel we have.
4. It leaves room for the compounding asset: when the shared, teacher-corrected library
   (M3) is built, it joins Department as a *benefit*, not a paywalled artifact, because
   its value to us is that it grows. It is not on the page until it exists.

## What would change it

1. **Move option minting to `gpt-6-luna`.** Minting is ~77% of a typical attempt; on the
   cheap tier an attempt costs ≈ S$0.011. If an M11-style eval shows proposals stay
   grounded and valid, the Teacher allowance can go back up to ~400 a month at the same
   margin. This is the first thing to try, before touching the price.
2. **Real classroom attempts.** The figures come from simulated students; turn the cost
   meter on (`PLAY_COST_LOG=1`) for the first pilot and re-check the median. Chatty real
   play could reach ~S$0.10–0.13 per attempt (M12's estimate), which would make the top
   of the Teacher allowance negative again.
3. **Raise the price** only if both of those fail, since the argument above is that S$12
   is what a teacher can expense without asking.

The agent tick rate (FR-12b), which the first draft named as the lever, is not one:
character replies are under a quarter of the cost.
