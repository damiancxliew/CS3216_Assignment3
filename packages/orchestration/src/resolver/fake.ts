/**
 * K1 — deterministic fake Resolver behind I4.
 *
 * No LLM, no clock, no `Math.random`: every number comes from the seeded PRNG and every timestamp
 * from the caller, so the same inputs always produce byte-identical output. It exists so the rest
 * of the team can build the turn loop, the DB writes and the renderer against a real I4 payload
 * tonight, and so K7's probabilistic resolution has a reproducible baseline to diff against.
 *
 * It models the two rules that matter and nothing else: outcomes are probabilistic while actions
 * are not (D10), and where play goes next is spec-authored, never invented (FR-14).
 */
import { parseAction, type ActorAction } from '../actions'
import { EFFECT_TEXT } from '../catalogue'
import {
  MAX_AGENT_DELTAS,
  RESOLUTION_VERSION,
  sanitizeEffects,
  validateResolutionRecord,
  type AgentDelta,
  type NextStep,
  type ResolutionRecord,
  type Roll,
  type SceneEffect,
  type WorldDelta,
} from '../resolution'
import { createRng } from '../rng'
import {
  resolverInputSchema,
  ResolverInputError,
  type DecisionStance,
  type Resolver,
  type ResolverInput,
  type ResolverResult,
} from './types'

/** Starting odds per stance. Deliberately close to even: history is not a dice game with a
 * favourite, and a cooperative move that always works removes the point of D10. */
const STANCE_BASE_PROBABILITY: Record<DecisionStance, number> = {
  cooperative: 0.6,
  neutral: 0.55,
  evasive: 0.5,
  antagonistic: 0.45,
}

/** Odds when the timer expired and nobody committed (D12/FR-16). Passing is rarely rewarded. */
const PASS_PROBABILITY = 0.3

/** How a stance moves a stakeholder's standing, before jitter. */
const STANCE_DISPOSITION: Record<DecisionStance, { success: number; failure: number }> = {
  cooperative: { success: 2, failure: -1 },
  neutral: { success: 1, failure: -1 },
  evasive: { success: 0, failure: -1 },
  antagonistic: { success: -1, failure: -2 },
}

const STANCE_EFFECTS: Record<DecisionStance, { success: SceneEffect['id'][]; failure: SceneEffect['id'][] }> = {
  cooperative: { success: ['confetti', 'crowd_cheer'], failure: ['smoke', 'crowd_flee'] },
  neutral: { success: ['flash'], failure: ['smoke'] },
  evasive: { success: ['smoke'], failure: ['crowd_flee'] },
  antagonistic: { success: ['explosion', 'rubble'], failure: ['fire', 'crowd_flee'] },
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const round = (value: number): number => Number(value.toFixed(4))

function successProbability(input: ResolverInput): number {
  if (input.decision === null) return PASS_PROBABILITY
  const base = STANCE_BASE_PROBABILITY[input.decision.stance]
  const averageDisposition =
    input.agents.length === 0 ? 0 : input.agents.reduce((sum, agent) => sum + agent.disposition, 0) / input.agents.length
  // Evidence is the one lever the player earns rather than rolls: knowing more makes a move likelier
  // to land, which is what makes investigation worth the stage time.
  const evidenceBonus = 0.04 * Math.min(input.evidenceCollected, 4)
  return round(clamp(base + 0.03 * averageDisposition + evidenceBonus, 0.05, 0.95))
}

function resolveNext(input: ResolverInput): NextStep {
  return input.decision === null ? input.fallbackNext : input.decision.branchTarget
}

function buildAnnouncement(input: ResolverInput, success: boolean, deltas: readonly AgentDelta[]): string {
  const byName = new Map(input.agents.map((agent) => [agent.id, agent.name]))
  const swung = [...deltas].sort((a, b) => {
    const magnitude = Math.abs(b.dispositionDelta) - Math.abs(a.dispositionDelta)
    if (magnitude !== 0) return magnitude
    return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0
  })[0]
  const reaction =
    swung === undefined || swung.dispositionDelta === 0
      ? 'The room holds its position.'
      : swung.dispositionDelta > 0
        ? `${byName.get(swung.agentId) ?? 'A stakeholder'} comes round.`
        : `${byName.get(swung.agentId) ?? 'A stakeholder'} hardens against you.`

  if (input.decision === null) {
    const head = success
      ? 'The stage closes without your word, and the other parties settle it in a way you can live with.'
      : 'The stage closes without your word, and the other parties settle it without you in mind.'
    return `${head} ${reaction}`
  }
  const head = success
    ? `You commit to: ${input.decision.label}. It carries.`
    : `You commit to: ${input.decision.label}. It does not hold.`
  return `${head} ${reaction}`
}

function buildEffects(input: ResolverInput, success: boolean): { effects: SceneEffect[]; dropped: number } {
  // Timer expiry uses the same evasive stance for disposition and effects.
  const stance = input.decision?.stance ?? 'evasive'
  const ids = STANCE_EFFECTS[stance][success ? 'success' : 'failure']
  const authored: SceneEffect[] = ids.map((id, index) => ({
    id,
    at: null,
    intensity: index === 0 ? (success ? 2 : 1) : 1,
  }))
  // Externally proposed effects go through the same allow-list: an unknown id is dropped, never
  // fatal (FR-15b).
  const sanitized = sanitizeEffects(input.candidateEffects ?? [])
  // Authored effects take precedence; valid caller candidates follow in their input order.
  const combined = [...authored, ...sanitized.effects]
  const droppedByCap = Math.max(0, combined.length - 4)
  return { effects: combined.slice(0, 4), dropped: sanitized.dropped.length + droppedByCap }
}

function normalizeInput(rawInput: ResolverInput): ResolverInput {
  const parsed = resolverInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new ResolverInputError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`),
    )
  }

  const { candidateEffects, actions: rawActions, ...rest } = parsed.data
  const actions = rawActions as ResolverInput['actions']
  return {
    ...rest,
    actions,
    evidenceCollected:
      Number.isFinite(parsed.data.evidenceCollected) && parsed.data.evidenceCollected >= 0
        ? parsed.data.evidenceCollected
        : 0,
    agents: parsed.data.agents.map((agent) => ({
      ...agent,
      disposition: Number.isFinite(agent.disposition)
        ? Math.min(5, Math.max(-5, Math.round(agent.disposition)))
        : 0,
    })),
    ...(candidateEffects === undefined ? {} : { candidateEffects }),
  }
}

function compareAgentIds(a: { agentId: string }, b: { agentId: string }): number {
  return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0
}

function compareDeltaPriority(a: AgentDelta, b: AgentDelta): number {
  return Math.abs(b.dispositionDelta) - Math.abs(a.dispositionDelta) || compareAgentIds(a, b)
}

/**
 * Resolve a stage. Pure and synchronous: `resolveStageSync(x)` twice returns deep-equal records.
 */
export function resolveStageSync(rawInput: ResolverInput): ResolverResult {
  const input = normalizeInput(rawInput)
  // Defence in depth: the runtime allow-lists actions before they execute, and the Resolver refuses
  // to record one that is not on the list (FR-20).
  const actions: ActorAction[] = []
  let droppedActions = 0
  for (const candidate of input.actions) {
    const parsed = parseAction(candidate.action, candidate.actorKind)
    if (parsed.ok) actions.push({ ...candidate, action: parsed.action })
    else droppedActions += 1
  }
  const acceptedActions = actions.slice(0, 256)
  droppedActions += Math.max(0, actions.length - acceptedActions.length)

  const rng = createRng(`${input.seed}|${input.attemptId}|${input.stageId}|${input.decision?.optionId ?? 'pass'}`)
  const probability = successProbability(input)
  const value = round(rng.next())
  const success = value < probability
  const rolls: Roll[] = [
    {
      id: `${input.stageId}-outcome`,
      label: input.decision === null ? 'stage resolves on timer expiry' : `option "${input.decision.optionId}" succeeds`,
      probability,
      value,
      success,
    },
  ]

  const stance = input.decision?.stance ?? 'evasive'
  const base = STANCE_DISPOSITION[stance][success ? 'success' : 'failure']
  const allAgentDeltas: AgentDelta[] = [...input.agents]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((agent) => {
      const agentRng = createRng(`${input.seed}|${input.attemptId}|${input.stageId}|${agent.id}`)
      const jitter = agentRng.int(-1, 1)
      const disposition = clamp(agent.disposition + clamp(base + jitter, -3, 3), -5, 5)
      return { agentId: agent.id, dispositionDelta: disposition - agent.disposition, disposition }
    })
  const agentDeltas = [...allAgentDeltas].sort(compareDeltaPriority).slice(0, MAX_AGENT_DELTAS)

  const next = resolveNext(input)
  const { effects, dropped: droppedEffects } = buildEffects(input, success)

  const worldDeltas: WorldDelta[] = [
    {
      path: `stage.${input.stageId}.resolved`,
      value: true,
      summary: `Stage ${input.stageIndex + 1} resolved (${input.trigger.replace('_', ' ')}).`,
    },
  ]
  if (input.decision !== null) {
    worldDeltas.push({
      path: `decision.${input.decision.optionId}`,
      value: success ? 'succeeded' : 'failed',
      summary: `${input.decision.label} — ${success ? 'succeeded' : 'failed'}.`,
    })
  }

  const record: ResolutionRecord = {
    version: RESOLUTION_VERSION,
    attemptId: input.attemptId,
    stageId: input.stageId,
    resolvedAt: input.resolvedAt,
    trigger: input.trigger,
    actions: acceptedActions,
    outcome: {
      announcement: buildAnnouncement(input, success, agentDeltas),
      effects,
      agentDeltas,
      worldDeltas,
      sharedContextAppend:
        input.decision === null
          ? `The stage ended with no decision from the player; ${success ? 'the outcome still favoured them' : 'the outcome went against them'}.`
          : `The player chose "${input.decision.label}", and it ${success ? 'succeeded' : 'failed'}.`,
      next,
    },
    rolls,
    privateNotes: agentDeltas.map((delta) => ({
      agentId: delta.agentId,
      note:
        delta.dispositionDelta >= 0
          ? 'Reads the outcome as an opening worth using next stage.'
          : 'Reads the outcome as a slight, and will remember it next stage.',
    })),
    rationale: `stance=${stance} trigger=${input.trigger} p=${probability} roll=${value} success=${success} evidence=${input.evidenceCollected}; branch is spec-authored (${next.kind}).`,
  }

  const validated = validateResolutionRecord(record)
  if (!validated.ok) {
    throw new Error(`fake resolver produced an invalid I4 payload: ${validated.issues.join('; ')}`)
  }

  return {
    record: validated.record,
    telemetry: {
      droppedActions,
      droppedEffects,
      droppedAgentDeltas: allAgentDeltas.length - agentDeltas.length,
      repairRounds: 0,
    },
  }
}

/** The fake Resolver behind the shared `Resolver` interface, so the LLM one can replace it later. */
export const fakeResolver: Resolver = {
  resolveStage: async (input) => resolveStageSync(input),
}

/** Transcript line for an effect, so a skipped animation still reads in the log (FR-15c). */
export function effectTranscriptLine(effect: SceneEffect): string {
  return EFFECT_TEXT[effect.id]
}
