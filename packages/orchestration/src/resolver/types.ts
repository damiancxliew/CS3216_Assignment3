/**
 * What the Resolver is given and what it must return (PRD D9/FR-15).
 *
 * The input is deliberately a *view*, not the spec and not the DB rows: it is everything the
 * Resolver is allowed to see, assembled by the server. Keeping it a plain structure is what lets
 * the fake Resolver (K1) and the LLM Resolver (K7/K9) be interchangeable behind one interface, and
 * what lets every other slice build against I4 tonight without an OpenAI key.
 */
import { z } from 'zod'

import type { ActorAction } from '../actions'
import { nextStepSchema, type NextStep, type ResolutionRecord, type ResolutionTrigger } from '../resolution'

/** Decision stances, mirrored from the Adventure Spec v2 (I1) catalogue. */
export const DECISION_STANCES = ['cooperative', 'antagonistic', 'neutral', 'evasive'] as const
export type DecisionStance = (typeof DECISION_STANCES)[number]

export interface ResolverAgentView {
  id: string
  name: string
  /** Standing toward the player, -5 hostile to +5 loyal. World state, carried between stages. */
  disposition: number
  /** The character's own end-of-stage commitment, from the K6 ledger, when it made one. */
  commitment?: { optionId: string | null; how: 'committed' | 'passed' | 'timed_out' }
}

/** The option the player committed to (D18). Options are spec-authored, so the branch is too. */
export interface ResolverDecisionView {
  optionId: string
  label: string
  stance: DecisionStance
  branchTarget: Extract<NextStep, { kind: 'stage' } | { kind: 'ending' }>
}

export interface ResolverInput {
  attemptId: string
  stageId: string
  /** Attempt-scoped seed. Same seed + same inputs ⇒ same rolls (FR-9, K7). */
  seed: string
  stageIndex: number
  /** ISO timestamp supplied by the caller: the Resolver never reads the clock, or it is not pure. */
  resolvedAt: string
  trigger: ResolutionTrigger
  /** `null` when the stage timer expired and the player passed (D12/FR-16). */
  decision: ResolverDecisionView | null
  /** Where play goes when there is no committed option. Spec-authored. */
  fallbackNext: NextStep
  agents: ResolverAgentView[]
  /** Allow-listed actions taken this stage (FR-20). Re-filtered defensively by the Resolver. */
  actions: ActorAction[]
  /** How much of the stage's evidence the player actually found — earned, not rolled. */
  evidenceCollected: number
  /** Effects proposed elsewhere (e.g. by a stage transition). Allow-listed before use (FR-15b). */
  candidateEffects?: readonly unknown[]
}

export interface ResolverTelemetry {
  /** Candidate actions or effects the allow-list dropped, for FR-24. */
  droppedActions: number
  droppedEffects: number
  droppedAgentDeltas: number
  /** LLM repair round-trips used (FR-4/D14). Always 0 for the deterministic fake Resolver. */
  repairRounds: number
}

export interface ResolverResult {
  record: ResolutionRecord
  telemetry: ResolverTelemetry
}

export interface Resolver {
  resolveStage(input: ResolverInput): Promise<ResolverResult>
}

const id = z.string().min(1).max(64)
const recoverableNumber = z.custom<number>((value) => typeof value === 'number')
const branchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), stageId: id }),
  z.object({ kind: z.literal('ending'), endingId: id }),
])

export const resolverInputSchema = z.object({
  attemptId: id,
  stageId: id,
  seed: z.string().min(1).max(256),
  stageIndex: z.number().int().nonnegative(),
  resolvedAt: z.string().datetime({ offset: true }),
  trigger: z.enum(['decision', 'timer_expiry', 'stage_objective']),
  decision: z
    .object({
      optionId: id,
      label: z.string().min(1).max(287),
      stance: z.enum(DECISION_STANCES),
      branchTarget: branchTargetSchema,
    })
    .nullable(),
  fallbackNext: nextStepSchema,
  agents: z.array(
    z.object({
      id,
      name: z.string().min(1).max(200),
      disposition: recoverableNumber,
      commitment: z
        .object({
          optionId: id.nullable(),
          how: z.enum(['committed', 'passed', 'timed_out']),
        })
        .optional(),
    }),
  ),
  actions: z.array(z.object({ actorKind: z.enum(['player', 'agent']), actorId: id, action: z.unknown() })),
  evidenceCollected: recoverableNumber,
  candidateEffects: z.array(z.unknown()).optional(),
})

export class ResolverInputError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`invalid resolver input: ${issues.join('; ')}`)
    this.name = 'ResolverInputError'
    this.issues = issues
  }
}
