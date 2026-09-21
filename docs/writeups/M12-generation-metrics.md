# M12 — Production optimisation and metrics: generation side (draft, 21 Sep)

Owner: Di Heng (generation half). Yi Hao owns the runtime half (Resolver/agent tiering, streaming,
parallel agent calls); Damian's P11 telemetry covers per-attempt play cost. Every figure below is
from `packages/generation/evals/results/*/summary.json` (`npm run eval`), 20–21 Sep 2026, and the
OpenAI price table read on 20 Sep (`src/llm/client.ts`, `src/assets/openai-images.ts`).

## What one generated adventure costs today

Planner: `gpt-5.4`, strict structured outputs on the Responses API, reasoning `medium`, prompt v2,
7-document corpus:

| Metric | Value |
| --- | --- |
| Schema-valid adventures (≤2 repairs) | 7/7 |
| Valid first try | 5/7 |
| Mean end-to-end latency | 201 s (min 133 s, max 278 s) |
| Mean tokens per adventure | 10.3k in (of which cached: only on repair turns), 23.2k out, incl. 10.7k reasoning |
| Mean cost per adventure | **$0.370** (min $0.225, max $0.567) |
| Cost of a repair turn | ≈ +$0.20–0.25 (the documents are re-sent; ~36% of the repair's input tokens hit the prompt cache) |
| Images (D5): `gpt-image-1-mini`, medium, 1024² | $0.011 each, 15 s; cap 8 → **≤ $0.09** per adventure, $0 on cache hits |
| **All-in generation cost per adventure** | **≈ $0.46** (planner + 8 images) |

For M6's pricing: at ~$0.46 per generated adventure and ~$0.09 to regenerate all images, generation is
a one-off per adventure version; the recurring cost is play (Yi Hao / Damian's numbers).

## Optimisations already in the pipeline

| Technique | Where | Measured effect |
| --- | --- | --- |
| **Strict structured outputs** (`json_schema`, `strict: true`) | `src/llm/openai.ts` | 0 shape/parse failures in 21 real generations; every repair was a cross-reference or grounding issue, never malformed JSON |
| **Bounded repair with path-addressed issues** (≤2 turns) | `src/planner/pipeline.ts` | 4/21 generations needed repair at `medium`; all 4 fixed in 1 turn |
| **Retrieval-assisted repair** (BM25 over page-bounded chunks names the page and passage to copy) | `src/ingest/chunk.ts` | Every "quote not found" repair converged in one round after this was added; before it the model was told only "not found" |
| **Prompt caching by construction** | repair turns keep the original user turn as a prefix | 5,888 / 16,369 repair input tokens cached (Spotted Tail, v1) |
| **Server-owned fields merged post-hoc** (`sources`, `readingLevel`, `id`) | `mergeServerFields()` | removes ~1k output tokens and an injection surface; the model cannot lower the reading level |
| **Tiering** (D14) | `DEFAULT_MODELS` | planner = frontier (`gpt-5.4`); planner marks each agent `frontier / mid / cheap` for the runtime; images = `gpt-image-1-mini` |
| **Image cap + prompt-hash cache** | `src/assets/service.ts` | ≤8 generations per adventure; repeated subject across stages/adventures is a hit; a failed or filtered image costs $0 and falls back to the placeholder without blocking publish |
| **No geometry from the model** (D3) | compiler owns layout | the planner output carries no coordinates, so nothing is spent on tokens the compiler would discard |

## Experiment: reasoning effort `low` vs `medium` (prompt v2, same 7 cases)

| | `medium` | `low` |
| --- | --- | --- |
| First planning call: latency / cost / reasoning tokens | 183 s / $0.313 / 10.3k | **90 s / $0.156 / 1.0k** |
| Valid first try | 5/7 | 2/7 |
| Repair turns used | 2 | 8 |
| Schema (cross-reference) issues in first plans | 0 | 6 |
| Schema-valid within ≤2 repairs | **7/7** | 6/7 — Magna Carta failed with one quote still non-verbatim after two repairs |
| Mean end-to-end latency | 201 s | 159 s (−21%) |
| Mean end-to-end cost | $0.370 | $0.355 (−4%) |
| Early-fork ratio (valid specs) | 11/11 | 9/9 |

Reading: `low` halves the cost and time of the *first call* but spends most of it back on repairs and
loses an adventure. Cross-reference mistakes (branching to an unknown stage, a room from another stage)
appear only at `low`; `medium` never made one across 14 generations. **Decision: keep `medium` for the
planner.** A plausible next step — plan at `low`, escalate the repair turn to `medium` — is untested
and is listed as a hypothesis, not a result.

## Latency: what it is and what it is not

201 s per adventure is generation, not play. It runs as a job with progress (PRD §7 "job runner"), and
the teacher's console shows extraction → planning → validation → repair states (M17). Two levers we
have *not* pulled because both trade validity for speed: lower reasoning effort (above), and a smaller
model (`gpt-5.4-mini` is 3.3× cheaper per token; untested on this task). Image generation runs after
publish and never gates it (FR-6a), so it adds 0 s to time-to-publish.

## Before/after prompt change (from M11)

Same model, same documents: early-stage forks 2/11 → 11/11, reachable endings 3.7 → 4.0, at +12%
latency and +3% cost, with validity, repair count and grounding unchanged. Full table in
[`M11-evals.md`](M11-evals.md).

## Closes EXECUTION_SPEC §6.4

"Confirm or change the ≤8 generated-image cap once real cost data exists." Measured: $0.011 per medium
1024² image on `gpt-image-1-mini` (15 s), so 8 images are $0.09 — about a fifth of the planner call.
The cap stays at **8**; if the quality tier moves to `gpt-image-1.5` medium ($0.034) it is still under
$0.30. The constraint on images is not cost but coherence (PRD D4), which the eligibility rules enforce.

## Reproduce

```bash
cd packages/generation
npm run eval -- --label m12-medium                 # gpt-5.4, medium, prompt v2
npm run eval -- --effort low --label m12-low
npm run assets -- fixtures/singapore-1819.spec.json --max 1   # one real image, prints $ and s
```
