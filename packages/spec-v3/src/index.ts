/**
 * The v3 `AdventureSpec`: the full generated adventure the engine runs, the API serves and the
 * generator targets. Strict objects everywhere — unknown keys are rejected.
 *
 * Count/shape rules from the PRD (stance counts, rooms 2–5, …) are NOT here; they live in `checkSpec`
 * later. This file only enforces structure.
 */
import { z } from 'zod'

const Id = z.string().min(1)
const Text = z.string()

const Citation = z.strictObject({ sourceId: Id, quote: Text.optional() })

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

export const Role = z.strictObject({
  name: Text,
  position: Text,
  relationships: z.array(Text),
  reputation: Text,
  stakes: Text,
  privateBrief: z.strictObject({ goals: z.array(Text), fears: z.array(Text), constraints: z.array(Text), knows: z.array(Text) }),
  situation: Text,
})

export const Room = z.strictObject({ id: Id, name: Text, description: Text })

export const Situation = z.strictObject({
  whenOutcome: z.strictObject({ momentId: Id, outcomeId: Id }),
  stances: z.record(Id, Id).optional(),
  placement: z.record(Id, Id).optional(),
  documentPlacement: z.record(Id, Id).optional(),
  openingNarration: Text.optional(),
})

export const Stage = z.strictObject({
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

export const Stance = z.strictObject({ id: Id, label: Text, demeanour: Text, hidden: z.boolean().optional() })

export const Slant = z.strictObject({
  id: Id,
  claim: Text,
  contradictedBy: z.array(Id).min(1),
  /** Minor characters: the discovery unlocked when the slant is confronted (P13.6). */
  unlocksDiscoveryId: Id.optional(),
})

export const Character = z.strictObject({
  id: Id,
  name: Text,
  title: Text,
  real: z.boolean(),
  tier: z.enum(['major', 'minor']),
  persona: z.strictObject({
    voice: Text,
    phrases: z.array(z.strictObject({ text: Text, sourceLabel: Text, citations: z.array(Citation).optional() })),
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

export const Discovery = z.strictObject({
  id: Id,
  stageId: Id,
  holder: z.union([z.strictObject({ characterId: Id }), z.strictObject({ documentId: Id, keyPassageId: Id })]),
  /** Canonical statement, for the post-turn check. */
  text: Text,
  /** The student's note, in the role's voice (P7.2). */
  note: Text,
  /** Short topic phrase the character can be told to hold back ("his fear of Riau"), never the content. */
  topic: Text.optional(),
  core: z.boolean(),
  condition: Condition.optional(),
  sourceLabel: Text,
  citations: z.array(Citation).optional(),
})

export const DOCUMENT_KINDS = ['newspaper', 'letter', 'telegram', 'speech', 'minutes', 'memoir', 'treaty', 'report', 'other'] as const

export const Document = z.strictObject({
  id: Id,
  kind: z.enum(DOCUMENT_KINDS),
  title: Text,
  provenance: z.strictObject({
    masthead: Text.optional(),
    date: Text.optional(),
    sender: Text.optional(),
    recipient: Text.optional(),
    place: Text.optional(),
  }),
  body: Text,
  real: z.boolean(),
  sourceLabel: Text,
  glossary: z.array(z.strictObject({ term: Text, meaning: Text })).default([]),
  keyPassages: z.array(z.strictObject({ id: Id, start: z.number().int().nonnegative(), end: z.number().int().positive() })),
  citations: z.array(Citation).optional(),
})

export const Trigger = z.strictObject({
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

export const Act = z.strictObject({
  id: Id,
  text: Text,
  deception: z.boolean().optional(),
  reaction: Text,
  secret: z.strictObject({ unlock: z.array(Condition).min(2), minMet: z.number().int().min(2) }).optional(),
})

export const Outcome = z.strictObject({
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

export const DefiningMoment = z.strictObject({
  id: Id,
  stageId: Id,
  deciderId: Id,
  scene: Text,
  nudge: Text,
  finalCallNarration: Text,
  acts: z.array(Act).min(2),
  outcomes: z.array(Outcome).min(2),
  rules: z.array(z.strictObject({ actId: Id, when: Condition.optional(), outcomeId: Id })).min(1),
})

export const Ending = z.strictObject({
  id: Id,
  type: z.enum(['historical', 'alternative', 'secret']),
  title: Text,
  summary: Text,
  epilogue: Text,
  interview: z.strictObject({
    interviewer: Text,
    question: Text,
    verdicts: z.array(z.strictObject({ id: Id, text: Text, counterPoints: z.array(Id) })).length(3),
    generalCounter: Text,
  }),
  sourceLabel: Text,
  citations: z.array(Citation).optional(),
})

const Source = z.strictObject({
  id: Id,
  title: Text,
  origin: z.enum(['teacher', 'outside']),
  url: z.url().optional(),
})

const Conflict = z.strictObject({
  id: Id,
  itemIds: z.array(Id).min(1),
  teacherSays: Text,
  sourceSays: Text,
  sourceId: Id,
})

const StoryEventWhen = z.union([
  z.strictObject({ atSeconds: z.number().nonnegative() }),
  z.strictObject({ condition: Condition }),
  z.strictObject({ stuck: z.literal(true) }),
  z.strictObject({ timerOut: z.literal(true) }),
])

const storyEventBase = { id: Id, stageId: Id, when: StoryEventWhen, text: Text }

const StoryEvent = z.discriminatedUnion('effect', [
  z.strictObject({ ...storyEventBase, effect: z.literal('summons'), characterId: Id }),
  z.strictObject({ ...storyEventBase, effect: z.literal('move'), characterId: Id, toRoomId: Id }),
  z.strictObject({ ...storyEventBase, effect: z.literal('deliverDocument'), documentId: Id, characterId: Id.optional() }),
  z.strictObject({ ...storyEventBase, effect: z.literal('news') }),
  z.strictObject({ ...storyEventBase, effect: z.literal('beginMoment') }),
])

const OpenQuestion = z.strictObject({ id: Id, stageId: Id, text: Text, discoveryIds: z.array(Id).min(1) })

const HintAngle = z.strictObject({
  id: Id,
  discoveryId: Id,
  kind: z.enum(['ask', 'read', 'passOn', 'show']),
  text: Text,
})

export const AdventureSpec = z.strictObject({
  id: Id,
  title: Text,
  readingLevel: z.enum(['sec', 'jc']),
  /** One-line arc of the generated adventure. */
  arc: Text.optional(),
  timer: z.strictObject({ enabled: z.boolean(), stageMinutes: z.array(z.number().positive()) }),
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
    .strictObject({
      whatHappened: Text,
      interpretations: z.array(Text).default([]),
      corrections: z.array(Text).default([]),
      couldHaveGone: z.array(Text).default([]),
    })
    .optional(),
  teacherQuestions: z.array(Text).default([]),
  /** Sources the generator cited, teacher-provided or found outside. */
  sources: z.array(Source).default([]),
  /** Teacher-brief vs source contradictions surfaced for the teacher to resolve. */
  conflicts: z.array(Conflict).default([]),
  /** Engine-driven events mid-stage (summons, document delivery, news, moment start). */
  storyEvents: z.array(StoryEvent).default([]),
  openQuestions: z.array(OpenQuestion).default([]),
  hintAngles: z.array(HintAngle).default([]),
})
export type AdventureSpec = z.infer<typeof AdventureSpec>
export type SpecStage = z.infer<typeof Stage>
export type SpecCharacter = z.infer<typeof Character>
export type SpecDiscovery = z.infer<typeof Discovery>
export type SpecDocument = z.infer<typeof Document>
export type SpecTrigger = z.infer<typeof Trigger>
export type SpecMoment = z.infer<typeof DefiningMoment>
export type SpecAct = z.infer<typeof Act>
export type SpecOutcome = z.infer<typeof Outcome>
export type SpecEnding = z.infer<typeof Ending>
export type SpecStoryEvent = z.infer<typeof StoryEvent>
export type SpecSource = z.infer<typeof Source>
export type SpecConflict = z.infer<typeof Conflict>
export type SpecOpenQuestion = z.infer<typeof OpenQuestion>
export type SpecHintAngle = z.infer<typeof HintAngle>
export type SpecCitation = z.infer<typeof Citation>

/** A structural validation failure; `path` is the zod issue path joined with '.', '' for root. */
export type SpecIssue = { path: string; message: string }
export type ValidateResult = { ok: true; spec: AdventureSpec } | { ok: false; issues: SpecIssue[] }

/** Structural validation only — never throws. Semantic checks (counts, references) are `checkSpec`. */
export function validateSpec(input: unknown): ValidateResult {
  const result = AdventureSpec.safeParse(input)
  if (result.success) return { ok: true, spec: result.data }
  return { ok: false, issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }
}

/** `checkSpec` contract: PRD count/reference rules on top of `validateSpec`. */
export type CheckIssue = { code: string; path: string; message: string }
export type CheckResult = { errors: CheckIssue[]; warnings: CheckIssue[] }

export { checkSpec } from './check/index.js'
