/**
 * The recorded events of an attempt (`attempt_events_v3`). They are the input to the class summary, so
 * they carry ids, never student-identifying data beyond what the attempt row already holds.
 */
import { z } from 'zod'

import { Id, StageIndex, Timestamp } from './ids'
import { Phase } from './view'

const base = { at: Timestamp, stageIndex: StageIndex.nullable() }

export const DiscoveryEvent = z.object({
  ...base,
  type: z.literal('discovery'),
  discoveryId: Id,
  noteId: Id,
  core: z.boolean(),
  via: z.enum(['conversation', 'passage', 'slant']),
})

export const StanceChangeEvent = z.object({
  ...base,
  type: z.literal('stanceChange'),
  characterId: Id,
  from: Id,
  to: Id,
  cause: z.enum(['trigger', 'trust']),
  triggerId: Id.nullable(),
})

/** A claim the student couldn't back with a note was challenged (P8.2). */
export const ChallengeEvent = z.object({ ...base, type: z.literal('challenge'), characterId: Id })

export const ActEvent = z.object({ ...base, type: z.literal('act'), momentId: Id, actId: Id })

export const PredictionEvent = z.object({ ...base, type: z.literal('prediction'), momentId: Id, outcomeId: Id })

export const OutcomeEvent = z.object({
  ...base,
  type: z.literal('outcome'),
  momentId: Id,
  outcomeId: Id,
  /** Set for the final defining moment: the ending reached. */
  endingId: Id.nullable(),
  closedEndingIds: z.array(Id),
})

export const VerdictEvent = z.object({
  ...base,
  type: z.literal('verdict'),
  endingId: Id,
  verdictId: Id,
  evidenceNoteIds: z.array(Id),
  /** `initial`: the first answer. `final`: the response after the push-back, changed or not. */
  stage: z.enum(['initial', 'final']),
  text: z.string().nullable(),
})

export const HintEvent = z.object({
  ...base,
  type: z.literal('hint'),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  targetDiscoveryId: Id.nullable(),
})

export const StoryEventEvent = z.object({ ...base, type: z.literal('storyEvent'), eventId: Id })

export const FlagEvent = z.object({
  ...base,
  type: z.literal('flag'),
  messageId: Id,
  category: z.enum(['abusive', 'hateful', 'provocative', 'sexual', 'self_harm']),
  reason: z.string().nullable(),
})

export const PhaseEvent = z.object({ ...base, type: z.literal('phase'), to: Phase })

export const GameEvent = z.discriminatedUnion('type', [
  DiscoveryEvent,
  StanceChangeEvent,
  ChallengeEvent,
  ActEvent,
  PredictionEvent,
  OutcomeEvent,
  VerdictEvent,
  HintEvent,
  StoryEventEvent,
  FlagEvent,
  PhaseEvent,
])
export type GameEvent = z.infer<typeof GameEvent>
export type GameEventType = GameEvent['type']
export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>
