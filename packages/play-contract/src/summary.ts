/**
 * The teacher's class summary (T2.1–T2.7). Class totals only: no field identifies a student, and nothing
 * records whether a prediction was right (P3.6, C4). Flags are per attempt so the platform can show them
 * for that student, for safeguarding (T5).
 */
import { z } from 'zod'

import { Id, StageIndex } from './ids'

const count = z.number().int().nonnegative()

export const ClassSummary = z.object({
  adventureId: Id,
  attempts: count,
  completed: count,
  /** Where students got stuck (T2.1): hints shown, by what they pointed towards. */
  stuck: z.array(
    z.object({ stageIndex: StageIndex, targetDiscoveryId: Id.nullable(), label: z.string(), count }),
  ),
  /** How predictions split (T2.2). */
  predictions: z.array(
    z.object({
      momentId: Id,
      stageIndex: StageIndex,
      question: z.string(),
      options: z.array(z.object({ outcomeId: Id, label: z.string(), count })),
    }),
  ),
  /** Interview verdicts (T2.3), per ending's question. */
  verdicts: z.array(
    z.object({
      endingId: Id,
      question: z.string(),
      options: z.array(z.object({ verdictId: Id, label: z.string(), initial: count, final: count })),
      changedAfterPushBack: count,
      evidence: z.array(z.object({ discoveryId: Id, label: z.string(), count })),
    }),
  ),
  /** Discoveries found or missed, per holder (T2.4). */
  discoveries: z.array(
    z.object({
      holderId: Id,
      holderName: z.string(),
      items: z.array(z.object({ discoveryId: Id, label: z.string(), core: z.boolean(), found: count })),
    }),
  ),
  /** Endings reached (T2.5). */
  endings: z.array(z.object({ endingId: Id, label: z.string(), type: z.enum(['historical', 'alternative', 'secret']), count })),
  /** Selected Interview answers, anonymised (T2.6). */
  answers: z.array(z.object({ endingId: Id, verdictLabel: z.string(), text: z.string() })),
  flags: z.array(z.object({ attemptId: Id, count })),
})
export type ClassSummary = z.infer<typeof ClassSummary>
