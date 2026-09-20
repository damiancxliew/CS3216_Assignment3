# @adventure/orchestration

Resolver/Orchestrator, character-agent runtime and safety rails (EXECUTION_SPEC §3.1, K1–K11).

```bash
npm ci && npm run check   # typecheck + tests, from this directory
```

## Frozen interfaces owned here

### I4 — resolution payload (`src/resolution.ts`)

The structured outcome the Resolver writes and the DB stores as a `resolution` row. The file splits
along the server-authority boundary (FR-21):

| Field | Visibility | Notes |
| --- | --- | --- |
| `outcome.announcement` | public | The only narrative text the player sees. No odds, no preview (D11). |
| `outcome.effects[]` | public | Ids from the frozen catalogue only (FR-15b); `publicResolution` adds the text equivalent (FR-15c). |
| `outcome.agentDeltas[]`, `outcome.worldDeltas[]`, `outcome.next` | server | World state the server applies. |
| `rolls[]` | **server only** | The probability rolls behind the outcome (D10). |
| `privateNotes[]`, `rationale` | **server only** | Why it happened. |

`publicResolution(record)` is the only supported client projection, and it is built from the public
fields rather than by deleting the private ones — a new private field cannot leak by being
forgotten. Its shape is exactly `decisionResponse.resolution` in the I3 Turn API contract.

### Action allow-list (`src/actions.ts`)

The complete, closed set of actions the world can execute (FR-20). Anything else is dropped with a
reason, never executed and never fatal to the turn.

| Action | Agent | Player | Payload |
| --- | --- | --- | --- |
| `speak` | ✓ | ✓ | `roomId`, `body`, `addresseeId` — conversation, scoped to one room (FR-11) |
| `move_room` | ✓ | ✓ | `toRoomId` |
| `open_door` / `close_door` | ✓ | ✓ | `roomId` — privacy is a door, not a flag (D7) |
| `share_evidence` | ✓ | ✓ | `roomId`, `evidenceId` |
| `record_private_note` | ✓ | — | `note` — agent memory; server-side only (FR-21) |
| `commit_decision` | ✓ | ✓ | `optionId`, `optionsVersion` — options-only, never free text (D18/FR-14) |
| `pass` | ✓ | ✓ | also recorded by the server on timer expiry (D12/FR-16) |
| `yield` | ✓ | ✓ | idle; costs no budget (FR-12b) |

Scene effects are **not** actions: only the Resolver emits them, and they are cosmetic (FR-15b).

Changing either list is a group decision — the compiler, the renderer, the Turn API and the DB all
encode them.

## Character-agent runtime (`src/agent/`, K2)

`runAgentTurn(client, input)` is one agent's tick: build the prompt, call the model through the
structured-output path, then push every proposed action through the allow-list and the budget.

- **Private-context isolation.** `AgentTurnInput` carries exactly one `privateContext` — the
  agent's own — and the prompt builder reads no other source, so another character's motivations
  have nowhere to enter from. Asserted in `tests/agent.test.ts`, on the request the client actually
  received.
- **Data is not instruction** (FR-20). Source text, transcripts and player messages are wrapped in
  `<<<LABEL … >>>` blocks; the system prompt declares those blocks quoted material before any of it
  is shown, and delimiters inside untrusted text are neutralised.
- **Budget** (FR-12b). An agent with no actions left yields without making a call at all; the spoken
  line is itself a budgeted, allow-listed action rather than a privileged side channel.
- **Degradation.** An unrepairable reply costs the agent its tick, not the turn: it yields.

## Stage runtime (`src/world/`, K3–K5)

`createWorld` / `applyAction` hold the server-authoritative state for one stage, and `runStage`
ticks the stage-relevant agents over it while the player is elsewhere (FR-12a).

- **Visibility is computed, not promised.** Every utterance carries a sequence number and presence
  is stored as `[fromSeq, toSeq)` intervals, so `visibleTranscript` answers "could this actor have
  heard this" from recorded facts. An agent that walks in afterwards gets nothing backfilled, and a
  closed door blocks movement, which is what makes a room private (D7).
- **Budget rails** (FR-12b): per-actor cap, stage-wide cap and a token ceiling. An agent that is
  out of budget, or that the stage does not concern, is not called at all — `telemetry.agentsSkipped`
  records which and why. `yield` is free.
- `StageTelemetry` reports actions per actor, tokens, drops, refusals, degraded ticks, repair rate
  and which cap ended the stage.

## Options and the stage decision (`src/stage/options.ts`, K6)

An option is a label plus preconditions drawn from a closed set of comparisons (`actor_in_room`,
`actors_together`, `door_open`, `knows_evidence`, `not`), so authored data can never execute.
Availability is never stored: `deriveOptions` recomputes the live set — and a fingerprint of it —
from world state, and `StageDecisions.commit` checks a submission against a set derived at the
moment it lands. A commit naming an option the world has moved past is rejected with a reason and
changes nothing (FR-14). Clients and agents see ids and labels only; preconditions stay server-side.

Decisions are actor-kind-neutral (revised 20 Sep): an agent commits or passes by exactly the rules a
player does, through the same ledger. The stage ends when everyone has decided (`all_decided`) or
when `expire()` passes for whoever is left on the timer; once every human is in, the remaining
agents are told to decide on their next tick rather than making the table wait out the clock.

### LLM seam (`src/llm/`)

The runtime talks to an `LlmClient`, so the whole suite still runs on `FakeLlmClient` with no key in
CI. Every call goes through `callStructured`, which validates against the response schema and
repairs at most twice (FR-4/D14).
`StructuredCallMetrics.repairRate` is the number M11/M12 ask for.

`createOpenAiClient` is an opt-in Responses API adapter. It is inert when `OPENAI_API_KEY` is not
set, so construction and tests remain key-free; a call made without the key raises
`MissingApiKeyError`. Set `OPENAI_API_KEY` to enable the adapter, and keep `FakeLlmClient` as the
default where deterministic behavior is required.

## Stubs

`fakeResolver` / `resolveStageSync` (K1) resolve a stage from fixed inputs with no LLM, no clock and
no `Math.random`: same inputs ⇒ byte-identical record. `src/fixtures.ts` carries a ready-made input
so the turn loop, the DB write and the renderer can be built against I4 today.
