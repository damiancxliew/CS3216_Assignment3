/**
 * The parts of an adventure the engine reads (see docs/v3-build/engine-spec-needs.md).
 *
 * A structural stand-in until `@adventure/spec-v3` lands; then `EngineSpec` becomes an alias of (or an adapter
 * from) `AdventureSpec`. Unknown fields are ignored, so a fuller spec still parses.
 */
import { z } from 'zod'

const Id = z.string().min(1)
const Text = z.string()

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { discovered: string }
  | { stanceAtLeast: { characterId: string; stanceId: string } }
  | { stanceIs: { characterId: string; stanceId: string } }
  | { notePassed: { discoveryId: string; characterId: string } }
  | { slantConfronted: string }
  | { act: { momentId: string; actId: string } }
  | { outcome: { momentId: string; outcomeId: string } }
  | { inRoom: string }
  | { elapsedAtLeast: number }

const CharacterStance = z.strictObject({ characterId: Id, stanceId: Id })

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(Condition) }),
    z.strictObject({ any: z.array(Condition) }),
    z.strictObject({ not: Condition }),
    z.strictObject({ discovered: Id }),
    z.strictObject({ stanceAtLeast: CharacterStance }),
    z.strictObject({ stanceIs: CharacterStance }),
    z.strictObject({ notePassed: z.strictObject({ discoveryId: Id, characterId: Id }) }),
    z.strictObject({ slantConfronted: Id }),
    z.strictObject({ act: z.strictObject({ momentId: Id, actId: Id }) }),
    z.strictObject({ outcome: z.strictObject({ momentId: Id, outcomeId: Id }) }),
    z.strictObject({ inRoom: Id }),
    z.strictObject({ elapsedAtLeast: z.number().nonnegative() }),
  ]),
)

export const Role = z.object({
  name: Text,
  position: Text,
  relationships: z.array(Text),
  reputation: Text,
  stakes: Text,
  privateBrief: z.object({ goals: z.array(Text), fears: z.array(Text), constraints: z.array(Text), knows: z.array(Text) }),
  situation: Text,
})

export const Room = z.object({ id: Id, name: Text, description: Text })

export const Situation = z.object({
  whenOutcome: z.object({ momentId: Id, outcomeId: Id }),
  stances: z.record(Id, Id).optional(),
  placement: z.record(Id, Id).optional(),
  documentPlacement: z.record(Id, Id).optional(),
  openingNarration: Text.optional(),
})

export const Stage = z.object({
  id: Id,
  title: Text,
  timePlace: Text,
  centralQuestion: Text,
  openingNarration: Text,
  rooms: z.array(Room).min(1),
  startRoomId: Id,
  /** characterId → roomId, for every character present in the stage. */
  placement: z.record(Id, Id),
  /** documentId → roomId, or 'held' for documents the student starts the stage with. */
  documentPlacement: z.record(Id, Id),
  situations: z.array(Situation).default([]),
  definingMomentId: Id,
})

export const Stance = z.object({ id: Id, label: Text, demeanour: Text, hidden: z.boolean().optional() })

export const Slant = z.object({
  id: Id,
  claim: Text,
  contradictedBy: z.array(Id).min(1),
  /** Minor characters: the discovery unlocked when the slant is confronted (P13.6). */
  unlocksDiscoveryId: Id.optional(),
})

export const Character = z.object({
  id: Id,
  name: Text,
  title: Text,
  real: z.boolean(),
  tier: z.enum(['major', 'minor']),
  persona: z.object({
    voice: Text,
    phrases: z.array(z.object({ text: Text, sourceLabel: Text })),
    knewThen: Text,
    wantsFromStudent: Text,
    withholds: z.array(Text),
    publicPosition: Text,
    privateAgenda: Text,
  }),
  /** Ordered low → high. Majors only. Only the last may be hidden. */
  stances: z.array(Stance),
  initialStanceId: Id.nullable(),
  slants: z.array(Slant).default([]),
  /** The subtle notice when two challenged claims cost a stance (G4.3). */
  trustNotice: Text.optional(),
})

export const Discovery = z.object({
  id: Id,
  stageId: Id,
  holder: z.union([z.object({ characterId: Id }), z.object({ documentId: Id, keyPassageId: Id })]),
  /** Canonical statement, for the post-turn check. */
  text: Text,
  /** The student's note, in the role's voice (P7.2). */
  note: Text,
  /** Short topic phrase the character can be told to hold back ("his fear of Riau"), never the content. */
  topic: Text.optional(),
  core: z.boolean(),
  condition: Condition.optional(),
  sourceLabel: Text,
})

export const DOCUMENT_KINDS = ['newspaper', 'letter', 'telegram', 'speech', 'minutes', 'memoir', 'treaty', 'report', 'other'] as const

export const Document = z.object({
  id: Id,
  kind: z.enum(DOCUMENT_KINDS),
  title: Text,
  provenance: z.object({
    masthead: Text.optional(),
    date: Text.optional(),
    sender: Text.optional(),
    recipient: Text.optional(),
    place: Text.optional(),
  }),
  body: Text,
  real: z.boolean(),
  sourceLabel: Text,
  glossary: z.array(z.object({ term: Text, meaning: Text })).default([]),
  keyPassages: z.array(z.object({ id: Id, start: z.number().int().nonnegative(), end: z.number().int().positive() })),
})

export const Trigger = z.object({
  id: Id,
  characterId: Id,
  on: z.union([
    z.strictObject({ notePassed: Id }),
    z.strictObject({ slantConfronted: Id }),
    z.strictObject({ discovered: Id }),
  ]),
  requires: Condition.optional(),
  effect: z.union([z.strictObject({ toStance: Id }), z.strictObject({ stanceDelta: z.union([z.literal(1), z.literal(-1)]) })]),
  handsOver: z.array(Id).optional(),
  notice: Text,
})

export const Act = z.object({
  id: Id,
  text: Text,
  deception: z.boolean().optional(),
  reaction: Text,
  secret: z.object({ unlock: z.array(Condition).min(2), minMet: z.number().int().min(2) }).optional(),
})

export const Outcome = z.object({
  id: Id,
  summary: Text,
  predictionText: Text,
  because: Text,
  closesEndingIds: z.array(Id).default([]),
  endingId: Id.optional(),
  secret: z.boolean().optional(),
  /** What actually happened at this moment, for the reveal's "your path vs history". */
  historical: z.boolean().optional(),
})

export const DefiningMoment = z.object({
  id: Id,
  stageId: Id,
  deciderId: Id,
  scene: Text,
  nudge: Text,
  finalCallNarration: Text,
  acts: z.array(Act).min(2),
  outcomes: z.array(Outcome).min(2),
  rules: z.array(z.object({ actId: Id, when: Condition.optional(), outcomeId: Id })).min(1),
})

export const Ending = z.object({
  id: Id,
  type: z.enum(['historical', 'alternative', 'secret']),
  title: Text,
  summary: Text,
  epilogue: Text,
  interview: z.object({
    interviewer: Text,
    question: Text,
    verdicts: z.array(z.object({ id: Id, text: Text, counterPoints: z.array(Id) })).length(3),
    generalCounter: Text,
  }),
  sourceLabel: Text,
})

export const EngineSpec = z.object({
  id: Id,
  title: Text,
  readingLevel: z.enum(['sec', 'jc']),
  timer: z.object({ enabled: z.boolean(), stageMinutes: z.array(z.number().positive()) }),
  role: Role,
  stages: z.array(Stage).min(1),
  characters: z.array(Character).min(1),
  discoveries: z.array(Discovery),
  documents: z.array(Document),
  triggers: z.array(Trigger),
  definingMoments: z.array(DefiningMoment).min(1),
  endings: z.array(Ending).min(2),
  /** Reveal content (Damian's reveal assembly reads it). */
  reveal: z
    .object({
      whatHappened: Text,
      interpretations: z.array(Text).default([]),
      corrections: z.array(Text).default([]),
      couldHaveGone: z.array(Text).default([]),
    })
    .optional(),
  teacherQuestions: z.array(Text).default([]),
  /** Damian's parts, passed through untouched. */
  storyEvents: z.array(z.unknown()).default([]),
  openQuestions: z.array(z.unknown()).default([]),
  hintAngles: z.array(z.unknown()).default([]),
})
export type EngineSpec = z.infer<typeof EngineSpec>
export type SpecStage = z.infer<typeof Stage>
export type SpecCharacter = z.infer<typeof Character>
export type SpecDiscovery = z.infer<typeof Discovery>
export type SpecDocument = z.infer<typeof Document>
export type SpecTrigger = z.infer<typeof Trigger>
export type SpecMoment = z.infer<typeof DefiningMoment>
export type SpecAct = z.infer<typeof Act>
export type SpecOutcome = z.infer<typeof Outcome>
export type SpecEnding = z.infer<typeof Ending>
