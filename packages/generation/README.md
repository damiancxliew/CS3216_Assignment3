# `@adventure/generation` — ingest, Adventure Spec v2, planner, evals

Owner: Di Heng. Covers I1 and D1–D8 in [`docs/EXECUTION_SPEC.md`](../../docs/EXECUTION_SPEC.md).

```bash
cd packages/generation
npm ci
npm run check        # typecheck + tests + JSON Schema sync
npm run schema       # regenerate schema/adventure-spec-v2.schema.json after editing src/spec/v2.ts
```

## I1 — Adventure Spec v2 (frozen contract)

| What | Where |
| --- | --- |
| Zod schema + types + cross-reference validator | [`src/spec/v2.ts`](src/spec/v2.ts) |
| Frozen catalogues (overlays, effects, model tiers, room kinds, generatable asset kinds) | [`src/spec/catalogue.ts`](src/spec/catalogue.ts) |
| JSON Schema for non-TS consumers | [`schema/adventure-spec-v2.schema.json`](schema/adventure-spec-v2.schema.json) |
| **Hand-authored valid fixture** | [`fixtures/singapore-1819.spec.json`](fixtures/singapore-1819.spec.json) |
| The source its spans resolve to | [`fixtures/sources/singapore-1819-handout.txt`](fixtures/sources/singapore-1819-handout.txt) |

Import from TypeScript:

```ts
import { validateAdventureSpec, type AdventureSpec } from '@adventure/generation/spec'
import { loadI1Spec } from '@adventure/generation/fixtures' // tests only

const result = validateAdventureSpec(json) // never throws
if (!result.ok) console.log(result.issues) // [{ path: '$.stages.0.agents.1.startRoomId', message: 'unknown room "x"' }]
```

### Shape

```
AdventureSpec
├─ version: 2, id, title, setting, description
├─ readingLevel { band, ageMin, ageMax }              FR-1a — required
├─ learningObjectives[], player { name, role, brief }
├─ sources[] { id, title, kind, pageCount, contentHash }   written by ingest, not the planner
├─ sharedContext: Grounded                             D8 — what everyone knows
├─ assumptions[] { id, text, rationale }               FR-3 — explicit simulation assumptions
├─ stakeholders[3..4] { id, name, role, summary: Grounded }
├─ defaultTimerSeconds, ambientOverlay { id, intensity }
├─ stages[1..3]
│  ├─ id, index, title, sharedContext: Grounded
│  ├─ timerSeconds | null (inherit; 0 disables)       D12
│  ├─ ambientOverlay | null (inherit)                  FR-15a
│  ├─ spawnRoomId
│  ├─ rooms[2..5] { id, name, purpose, kind, size, doorDefault, landmark | null }
│  ├─ agents[1..4] { id, stakeholderId, startRoomId, publicPosition: Grounded,
│  │                  privateContext { persona, motivations, hiddenInterests, knowledgeHorizon, spans, assumptionIds },
│  │                  modelTier }
│  ├─ evidence[1..6] { id, name, roomId, content { text, spans[1..], assumptionIds } }
│  ├─ objectives[1..8] { id, title, requires[], targetId }   acyclic; all feed the decision
│  └─ decision { id, title, prompt, roomId, requires[],
│                options[2..4] { id, label, stance, preconditions[], branchTarget } }
├─ endings[1..4] { id, title, summary, historicalOutcome: Grounded, divergence, reflectionQuestions[] }
└─ assetEligibility[0..8] { id, kind: portrait|landmark|prop, entityId, subject, prompt }   FR-6b

Grounded    = { text, spans: SourceSpan[], assumptionIds: string[] }   ≥1 of the two
SourceSpan  = { sourceId, page, quote }                                page-accurate, verifiable
BranchTarget= { kind: 'stage', stageId } | { kind: 'ending', endingId }
```

### Rules the validator enforces beyond the shape

- All ids unique across the whole spec; every reference resolves (rooms are stage-scoped).
- Every stage `index` equals its position; branch targets only move forward; final-stage options must
  branch to endings; every stage > 0 and every ending is reachable from some option.
- Objective graph is acyclic and every objective is transitively required by the stage decision.
- Every stakeholder appears as an agent in at least one stage; no stakeholder twice in one stage.
- Every span cites a known source and a page within its `pageCount`. Evidence needs ≥1 span.
- `assetEligibility`: ≤ 8, kind must match entity (portrait→stakeholder, landmark→room,
  prop→evidence), one asset per entity. Terrain/structural/UI kinds are not representable.

### What the spec deliberately does not contain

Coordinates, tiles, corridors, sprite ids, effects. The compiler (Yi Hao) owns geometry and asset
selection; the Resolver (Kevin) emits `effects[]`. `privateContext` must never reach a client —
`publicProjection(spec)` strips it, and the Turn API's `findForbiddenKeys` guards the wire.

### Grounding check

`verifyGrounding(spec, documents)` in [`src/ingest/spans.ts`](src/ingest/spans.ts) resolves every
span's `quote` against the extracted page text (whitespace/punctuation tolerant, no paraphrase).
The fixture resolves 100%; the planner pipeline runs this on every generated spec.

## D3/D4 — planner

```ts
import { generateAdventure, OpenAiLlmClient } from '@adventure/generation'

const result = await generateAdventure({
  teacher: { setting, learningObjectives, studentRole, readingLevel: { band: 'lower-secondary', ageMin: 13, ageMax: 14 }, stageCount: 3 },
  documents,                     // ExtractedDocument[] from extractDocument()
  llm: new OpenAiLlmClient(),    // or FakeLlmClient in tests
})
// result.status === 'ok'     -> { spec, missingInformation, warnings, metrics }
// result.status === 'failed' -> { reason, issues[], missingInformation, lastOutput, metrics }  (never a spec)
```

- `readingLevel` is required on the teacher input; the run fails before any model call without it (FR-1a).
- The planner returns the narrative half only. `version`, `id`, `sources` and `readingLevel` are merged in
  server-side, so the model cannot invent a source or lower the reading level.
- Validation = Zod shape → cross-references → span grounding against the extracted pages. Path-addressed
  issues go back to the model for at most **2 repair turns** (FR-4); after that the run fails with the issues
  and the `missingInformation` list for the teacher console.
- Documents are sent as `<<<DOCUMENT>>>`/`<<<PAGE n>>>`-delimited data in the user turn, never in the system
  prompt; delimiter lookalikes in the source are defanged (FR-20).
- `metrics` (D8): attempts, repairs, per-call latency, tokens (input/cached/output/reasoning), cost from the
  pricing table in [`src/llm/client.ts`](src/llm/client.ts).
- Models: `DEFAULT_MODELS` in `src/llm/client.ts`, overridable with `LLM_MODEL_FRONTIER|MID|CHEAP`.

Try it on a file: `OPENAI_API_KEY=… npm run generate -- path/to/doc.pdf --setting "…" --band upper-secondary`.

## D7/D8 — eval harness

```bash
npm run eval                                   # all corpus cases, real model
npm run eval -- --cases mason-1787 --effort low --label planner-v1-low
npm run eval -- --fake                         # offline smoke run
```

Corpus in [`evals/corpus.ts`](evals/corpus.ts) (documents in `fixtures/eval-corpus/`), checks in
[`evals/checks.ts`](evals/checks.ts), results in [`evals/RESULTS.md`](evals/RESULTS.md) (regenerated from
every `evals/results/<label>/summary.json`). Per case: validity, repairs, latency, tokens, cost, grounding
ratio, documented-vs-assumed share, branching (≥2 endings and a forking final stage), stance diversity,
reading-level word budgets, asset rules, private-context leak, and playability (spec-level until the I2
compiler is passed in via the `compile` hook). Across cases: max pairwise structural similarity (PRD §9.1).

## D1 — extraction

[`src/ingest/extract.ts`](src/ingest/extract.ts): `extractDocument({ id, title, kind, bytes | text })`
→ `ExtractedDocument { pages[{ page, text }], contentHash, warnings }`. PDFs go through `unpdf`
(pdf.js) per page; pasted text is paginated on form feeds or cut into ~2.5k-char pseudo-pages.
Limits in `LIMITS`. Scanned PDFs without a text layer are rejected with `no-text-layer`.
