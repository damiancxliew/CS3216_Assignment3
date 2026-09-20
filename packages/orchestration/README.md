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
| `commit_decision` | — | ✓ | `optionId` — options-only, never free text (D18/FR-14) |
| `pass` | — | ✓ | recorded by the server on timer expiry (D12/FR-16) |
| `yield` | ✓ | ✓ | idle; costs no budget (FR-12b) |

Scene effects are **not** actions: only the Resolver emits them, and they are cosmetic (FR-15b).

Changing either list is a group decision — the compiler, the renderer, the Turn API and the DB all
encode them.

## Stubs

`fakeResolver` / `resolveStageSync` (K1) resolve a stage from fixed inputs with no LLM, no clock and
no `Math.random`: same inputs ⇒ byte-identical record. `src/fixtures.ts` carries a ready-made input
so the turn loop, the DB write and the renderer can be built against I4 today.
