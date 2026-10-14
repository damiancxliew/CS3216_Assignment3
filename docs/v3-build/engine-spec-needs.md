# What the engine reads from `AdventureSpec`

> For Yi Hao (owner of `packages/spec-v3`). This lists every field the play engine reads, so the schema can cover
> them. Names and nesting are a proposal: rename freely and tell Kevin, and the engine follows. Fields not listed
> here (citations, reveal content, generation metadata) are yours to shape; the engine ignores them.
> Damian's parts (story events, hints, Interview, reveal) are listed at the end for completeness.

## Conventions
- Every id is a stable string, unique within the adventure (not just within its stage), so events and the class
  summary can refer to it without a path.
- Text that students see is written to the adventure's reading level.
- **Stance ids should be opaque** (`s1` … `s5`). `PlayerView` carries the stance id so the client can pick the
  portrait, and a semantic id ("guarded") would show the stance name to anyone reading the network tab (P6.5).

## Top level
| Field | Type | Used for |
|---|---|---|
| `id`, `title` | string | Seeding the anonymised-answer pick in the class summary |
| `readingLevel` | `'sec' \| 'jc'` | Persona and check prompts (G16.2) |
| `timer` | `{ enabled: boolean, stageMinutes: number[] }` (one entry per stage) | Timer and final call (P1) |
| `role` | see below | Briefing, the persona prompt ("how they see you"), note voice |
| `stages[]` | see below | Everything in play |
| `characters[]` | see below | Conversations, stances |
| `discoveries[]` | see below | Notes |
| `documents[]` | see below | Documents and close reading |
| `triggers[]` | see below | Stance changes |
| `definingMoments[]` | see below | Acts, outcomes, endings closed |
| `endings[]` | see below | Epilogue, Interview |
| `reveal` | `{ whatHappened, interpretations[], corrections[], couldHaveGone[] }` | Reveal assembly (Damian) [E3] |
| `teacherQuestions` | `string[]` | Shown after the reveal [T1] |

## `role` [G3]
`name`, `position`, `relationships: string[]`, `reputation`, `stakes`,
`privateBrief: { goals: string[], fears: string[], constraints: string[], knows: string[] }`, `situation` (the
opening situation shown in the briefing).

## `stages[]` [G2, G5.2, P9.8]
| Field | Type | Notes |
|---|---|---|
| `id`, `title`, `timePlace`, `centralQuestion`, `openingNarration` | string | |
| `rooms[]` | `{ id, name, description }` | 2–5 rooms |
| `startRoomId` | string | Where the student starts the stage |
| `placement` | `Record<characterId, roomId>` | Characters present in this stage and where they start |
| `documentPlacement` | `Record<documentId, roomId \| 'held'>` | `'held'`: already in the student's hands at stage start |
| `situations[]` | `{ whenOutcome: { momentId, outcomeId }, stances?: Record<characterId, stanceId>, placement?, documentPlacement?, openingNarration? }` | How an earlier outcome changes this stage. The first matching entry applies on top of the defaults |
| `definingMomentId` | string | |

## `characters[]` [G7, G8, G4, G10.4]
| Field | Type | Notes |
|---|---|---|
| `id`, `name`, `title` | string | `title` is the public position shown in the UI |
| `real` | boolean | |
| `tier` | `'major' \| 'minor'` | Only majors have stances and triggers |
| `persona` | `{ voice, phrases: { text, sourceLabel }[], knewThen, wantsFromStudent, withholds: string[], publicPosition, privateAgenda }` | All prompt-only, never sent to the client |
| `stances[]` | `{ id, label, demeanour, hidden?: true }[]` | **Ordered low → high**, 3–5 entries, majors only. "Drops by one" means one step down this list. Only the top stance may be `hidden` (the hidden top stance, G6.1.2) |
| `initialStanceId` | string \| null | Null for minors |
| `slants[]` | `{ id, claim, contradictedBy: discoveryId[] }` | Majors and minors. `claim` is what the character pushes; `contradictedBy` lists discoveries whose notes, when inserted, count as confronting the slant (P13.5, P13.6) |
| `slants[].unlocksDiscoveryId` | string? | Minors only: the discovery unlocked when the slant is confronted (P13.6) |
| `trustNotice` | string? | The subtle notice when two challenged claims cost a stance. Default: "{name} seems to trust you a little less." |

## `discoveries[]` [G5, G5.3, P7, P8]
| Field | Type | Notes |
|---|---|---|
| `id`, `stageId` | string | |
| `holder` | `{ characterId } \| { documentId, keyPassageId }` | Core discoveries: majors or documents only |
| `text` | string | Canonical statement, used by the post-turn check to decide whether a reply conveyed it |
| `note` | string | The note the student gets, in the role's voice (P7.2) |
| `topic` | string? | A short topic phrase ("his fears about Riau") the character is told to hold back while the condition isn't met. Never the content. Omitted: the character isn't told about it at all |
| `core` | boolean | |
| `condition` | `Condition?` | Reveal condition (earlier discoveries and/or a stance). Omitted: always revealable |
| `sourceLabel` | string | Shown in the reveal breakdown |

## `documents[]` [G10, P4, P13]
`id`, `kind` (`newspaper | letter | telegram | speech | minutes | memoir | treaty | report | other`), `title`,
`provenance: { masthead?, date?, sender?, recipient?, place? }`, `body`, `real: boolean`, `sourceLabel`,
`glossary: { term, meaning }[]`, `keyPassages: { id, start, end }[]`. `start` and `end` are character offsets into
`body` (end exclusive), 1–2 per document.

## `triggers[]` [G4.1, P6, P13.5]
| Field | Type | Notes |
|---|---|---|
| `id`, `characterId` | string | Majors only |
| `on` | `{ notePassed: discoveryId } \| { slantConfronted: slantId } \| { discovered: discoveryId }` | What the student does |
| `requires` | `Condition?` | Extra condition, for example a current stance |
| `effect` | `{ toStance: stanceId } \| { stanceDelta: 1 \| -1 }` | |
| `handsOver` | `documentId[]?` | Documents the character gives the student (P13) |
| `notice` | string | The short, subtle notice shown when it fires (P6.4), for example "Lee goes quiet for a moment." |

Each trigger fires at most once. The trust trigger (two challenged claims lower a major character's stance by one,
G4.3) is built into the engine and needs no data.

## `definingMoments[]` [P9, G6]
| Field | Type | Notes |
|---|---|---|
| `id`, `stageId`, `deciderId`, `scene` | string | |
| `nudge` | string | What a character says if core discoveries are missing (P9.6) |
| `finalCallNarration` | string | Shown when the timer brings the moment to the student (P1.2) |
| `acts[]` | `{ id, text, deception?: true, reaction, secret?: { unlock: Condition[], minMet: number } }` | 2–4 visible acts. `reaction` is the characters' immediate reaction (P9.7). A secret act appears only when at least `minMet` (≥ 2) of its `unlock` conditions hold (P9.11) |
| `outcomes[]` | `{ id, summary, predictionText, because, closesEndingIds: endingId[], endingId?, secret?: true, historical?: true }` | 3–4 per moment. `predictionText` is the one-tap prediction (P3.3); `because` explains the rule (P3.5). Final moment: every outcome has an `endingId`. `historical` marks what actually happened at this moment, for the reveal's "your path vs history" |
| `rules[]` | `{ actId, when?: Condition, outcomeId }` | Ordered; the first match wins. Every act needs one rule without `when` as its fallback, so every act and situation leads to an outcome (G15) |

An act is offered only while at least one outcome its rules can produce is not a closed ending (P9.2, P9.10).

## `endings[]` [G6.4, E1, E2]
`id`, `type: 'historical' | 'alternative' | 'secret'`, `title`, `summary`, `epilogue`,
`interview: { interviewer, question, verdicts: { id, text, counterPoints: (discoveryId | documentId)[] }[], generalCounter }`,
`sourceLabel`.

## `Condition` (closed set, data only)
One language shared by reveal conditions, trigger requirements, outcome rules, secret unlocks and story events.
Nothing in it can execute.

```ts
type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { discovered: string }                                   // discoveryId
  | { stanceAtLeast: { characterId: string; stanceId: string } }
  | { stanceIs: { characterId: string; stanceId: string } }
  | { notePassed: { discoveryId: string; characterId: string } }
  | { slantConfronted: string }                              // slantId
  | { act: { momentId: string; actId: string } }
  | { outcome: { momentId: string; outcomeId: string } }
  | { inRoom: string }                                       // roomId (story events)
  | { elapsedAtLeast: number }                               // seconds since the stage opened (story events)
```

## Damian's parts (listed so the schema has room for them)
- `storyEvents[]`: `{ id, stageId, when: { atSeconds } | { condition } | { stuck: true } | { timerOut: true }, effect: summons | move | deliverDocument | news | beginMoment, text }` [G11, P14].
- `openQuestions[]`: `{ id, stageId, text, discoveryIds }` [G5.1] and `hintAngles[]`: `{ id, discoveryId, kind: ask | read | passOn | show, text }` [P5.2.1].
- The reveal content [E3].

## Until `spec-v3` lands
The engine keeps a structural copy of these types in `packages/engine/src/spec.ts` until `spec-v3` lands, then
imports `AdventureSpec` from `@adventure/spec-v3` instead. If your names differ, the engine adapts.
