# M12 — Production metrics: play side (25 Sep)

What one student attempt costs, for M6's pricing. The generation half is in
[`M12-generation-metrics.md`](M12-generation-metrics.md) (≈ US$0.46 per adventure, once per version);
this is the recurring cost that scales with students. Every figure is from
[`data/play-cost-2026-09-25-fixed.jsonl`](data/play-cost-2026-09-25-fixed.jsonl) (one line per model
call) and the OpenAI standard-tier price table read on 25 Sep
([`scripts/play-cost-prices.json`](../../scripts/play-cost-prices.json)). SGD at an assumed 1.29 per USD.

## How it was measured

`attempt_telemetry.tokens` could not answer this: it sums character-reply tokens only, as one total,
with no input/cached/output split and no model, so it cannot be priced. Instead:

- **Cost meter** (`apps/web/src/lib/play/cost-meter.ts`, opt-in with `PLAY_COST_LOG=1`) wraps the
  play model client per attempt and logs every call — its type, model, token split, latency, and any
  error.
- **Simulated students** (`npm run measure:play-cost`) play the demo adventure (Singapore 1819: 3
  stages, 3 characters and 2 pieces of evidence each) through the real play service and the real
  models, with an in-memory store instead of the database. Three styles per stage:
  **quick** examines the evidence and sends 1 message; **typical** sends 2 messages to each character,
  1 to the whole room, and shares evidence; **chatty** sends 5 to each character and 2 to the room.
  Walking costs nothing (movement makes no model calls), so the styles differ only in what they say.

## What one attempt costs

7 attempts, all played to an ending:

| Style | Attempts | Model calls | Cost per attempt |
| --- | --- | --- | --- |
| Quick | 2 | 11–12 | **S$0.002** |
| Typical | 3 | 38–42 | **S$0.039–0.044** |
| Chatty | 2 | 67–78 | **S$0.052–0.060** |
| **All** | 7 | 288 | **median S$0.042**, mean S$0.034, max S$0.060 |

Where it goes:

| Call | Model | Mean tokens (in / out) | Mean cost | Share of a typical attempt |
| --- | --- | --- | --- | --- |
| Character reply (incl. autonomous and decision ticks) | `gpt-6-luna` | 1,780 / 127 | US$0.0002 | ~23% |
| Option minting (FR-13), 1 per stage after 6 transcript lines | `gpt-6-sol`, reasoning `medium` | 1,853 / 488 (345 reasoning) | US$0.0086 | **~77%** |

Stage resolution made no model call in this build. A quick student never triggers minting, which is
why their attempt costs a twentieth of a typical one.

**One 30-student lesson** on one adventure ≈ 1 × S$0.59 generation + 30 × S$0.042 ≈ **S$1.85**.

## Bounds and caveats

- **Hard ceiling.** Every play call except stage resolution counts against `STAGE_TOKEN_BUDGET`
  (60k tokens per stage, `apps/web/src/lib/play/session.ts`). If a stage's whole budget went to
  minting, an attempt on this 3-stage adventure would cost ≈ S$0.85. Minting stops after 2 accepted
  options, so this is a ceiling, not an expectation.
- **The simulation under-counts minting for chatty play.** It mints at most once per stage; the
  browser client mints whenever the state says `mintReady`, which re-arms every 6 new transcript
  lines until 2 options are accepted. A chatty stage could run 2–3 mints, putting a chatty attempt
  nearer **S$0.10–0.13** (estimate, not measured).
- **Simulated, not real, students.** Message counts are chosen, not observed. The per-call costs are
  real; the calls per attempt should be re-checked against real classroom attempts with the meter on.
- **One adventure.** Longer adventures (more stages or characters) scale the minting and reply terms
  roughly linearly.

## Found while measuring: minting never worked live

The first run showed no minting calls at all. With failures logged, every `option_minting` call
returned `400 Invalid schema … must be type "object", got type "array"`: the proposal schema was a
top-level array, OpenAI rejects that, and `mintOptions` swallowed the error, so students never saw a
minted option. Tests passed because the fake client did not check schema shape. Fixed by wrapping the
list as `{ proposals }`; the fake client now refuses a non-object schema the way OpenAI does, and 26
tests fail against the old schema. Before the fix an attempt cost median S$0.0095
([`data/play-cost-2026-09-25-before-fix.jsonl`](data/play-cost-2026-09-25-before-fix.jsonl)) —
the gap is the minting cost above.

## The lever

Minting is three quarters of a typical attempt. Moving it from `gpt-6-sol` to `gpt-6-luna` would take
a typical attempt from ≈ S$0.042 to ≈ S$0.011 at today's token counts. That is untested for proposal
quality (grounding, valid preconditions) and should go through an M11-style eval before it ships.
Character replies are already on the cheap tier and are not worth optimising.

## Reproduce

```bash
npm run measure:play-cost                                  # 2 quick, 3 typical, 2 chatty (~US$0.20)
PLAY_COST_PROFILES=typical,chatty npm run measure:play-cost
node scripts/play-cost-summary.mjs output/play-cost-sim.jsonl scripts/play-cost-prices.json --usd-to-sgd 1.29
```

To meter real attempts instead, set `PLAY_COST_LOG=1` in `apps/web/.env.local`, play in the browser,
and summarise `apps/web/play-cost.jsonl`.
