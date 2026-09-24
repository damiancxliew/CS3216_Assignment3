/**
 * K2 — one character agent answering in-room.
 *
 * The runtime is a pipeline with no discretion of its own: assemble the prompt from this agent's
 * view only, call the model through the structured-output + repair path (FR-4), then push every
 * proposed action through the allow-list and the remaining budget (FR-12b/FR-20) before anything
 * reaches the world. A model that misbehaves costs the agent its tick, never the turn: an
 * unrepairable reply degrades to a yield.
 */
import { DEFAULT_ACTION_BUDGET, filterActions, type ActionBudget, type ActorAction, type DroppedAction } from '../actions'
import { callStructured, type StructuredCallMetrics } from '../llm/structured'
import type { LlmClient, ModelTier, TokenUsage } from '../llm/types'
import { TIER_BY_ROLE } from '../llm/types'
import { buildAgentPrompt } from './prompt'
import { agentReplySchema, type AgentTurnInput } from './types'

export interface AgentTurnResult {
  agentId: string
  /** The line the agent says in the room. Empty when it yielded. */
  say: string
  /** Allow-listed actions, already attributed and budget-checked. */
  actions: ActorAction[]
  goalClaims?: { objectiveId: string; quote: string }[]
  dropped: DroppedAction[]
  /** True when the model failed schema validation after the repair budget and the agent yielded. */
  degraded: boolean
  repairRounds: number
  usage: TokenUsage
}

export const CHARACTER_LLM_PROFILE = {
  reasoningEffort: 'none',
  verbosity: 'low',
  maxOutputTokens: 400,
  serviceTier: 'fast',
} as const

export interface AgentTurnOptions {
  budget?: ActionBudget
  /** Actions this agent has already spent this stage (FR-12b). */
  spent?: number
  /** Actions remaining across the whole stage (FR-12b). */
  stageRemaining?: number
  metrics?: StructuredCallMetrics
  modelTier?: ModelTier
  brief?: boolean
  /** Version of the option set this agent was shown. Stamped onto any decision it proposes (K6). */
  optionsVersion?: string | undefined
}

/**
 * Stamp the option-set version the agent was actually shown onto its decision. The model never
 * supplies it: a version it invented would make the staleness check meaningless, and a version it
 * copied from the prompt would only be the same value by a longer route.
 */
function stamp(proposal: { type: string }, options: AgentTurnOptions): unknown {
  if (proposal.type !== 'commit_decision') return proposal
  return { ...proposal, optionsVersion: options.optionsVersion ?? '' }
}

function yieldTurn(agentId: string, partial: Partial<AgentTurnResult> = {}): AgentTurnResult {
  return {
    agentId,
    say: '',
    actions: [{ actorKind: 'agent', actorId: agentId, action: { type: 'yield' } }],
    goalClaims: [],
    dropped: [],
    degraded: false,
    repairRounds: 0,
    usage: { promptTokens: 0, completionTokens: 0 },
    ...partial,
  }
}

/**
 * Run one tick for one agent. An agent with no budget left yields without spending a call at all —
 * the cheapest way to honour FR-12b is not to make the request (K4/K5 tick this per stage).
 */
export async function runAgentTurn(
  client: LlmClient,
  input: AgentTurnInput,
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  const agentId = input.self.id
  if (input.actionsRemaining <= 0) return yieldTurn(agentId)

  const prompt = buildAgentPrompt(input, options.brief === undefined ? {} : { brief: options.brief })
  const result = await callStructured(
    client,
    {
      schema: agentReplySchema,
      schemaName: 'character_agent_reply',
      modelTier: options.modelTier ?? TIER_BY_ROLE.characterAgent,
      system: prompt.system,
      user: prompt.user,
      ...CHARACTER_LLM_PROFILE,
    },
    options.metrics,
  )

  if (!result.ok) {
    return yieldTurn(agentId, { degraded: true, repairRounds: result.repairRounds, usage: result.usage })
  }

  const { say, actions: proposals } = result.value
  const goalCandidateIds = new Set((input.goalCandidates ?? []).map(({ id }) => id))
  // The spoken line is itself an action, so it is budgeted and allow-listed like any other and is
  // never a privileged side channel. A silent character proposes no line at all.
  const spoken =
    say.trim() === '' ? [] : [{ type: 'speak', roomId: input.room.id, body: say, addresseeId: null }]
  const candidates = [
    ...spoken,
    ...proposals.filter((proposal) => proposal.type !== 'speak' && proposal.type !== 'goal_evidence').map((proposal) => stamp(proposal, options)),
  ]
  const filtered = filterActions(
    candidates,
    { actorKind: 'agent', actorId: agentId },
    options.budget ?? DEFAULT_ACTION_BUDGET,
    options.spent ?? 0,
    options.stageRemaining,
  )

  const saySurvived = filtered.actions.some((entry) => entry.action.type === 'speak')
  const goalClaims: AgentTurnResult['goalClaims'] = []
  if (saySurvived) {
    for (const proposal of proposals) {
      if (proposal.type === 'goal_evidence' && goalCandidateIds.has(proposal.objectiveId)) goalClaims.push({ objectiveId: proposal.objectiveId, quote: proposal.quote })
    }
  }
  return {
    agentId,
    say: saySurvived ? say : '',
    actions: filtered.actions,
    goalClaims,
    dropped: filtered.dropped,
    degraded: false,
    repairRounds: result.repairRounds,
    usage: result.usage,
  }
}

/**
 * What the room sees of a tick. Private notes stay server-side (FR-21): they are stripped here, at
 * the projection, rather than trusted not to be serialised downstream.
 */
export interface PublicAgentTurn {
  agentId: string
  say: string
  actions: { type: string; roomId?: string; toRoomId?: string; evidenceId?: string }[]
}

export function publicAgentTurn(result: AgentTurnResult): PublicAgentTurn {
  return {
    agentId: result.agentId,
    say: result.say,
    actions: result.actions
      .filter((entry) => entry.action.type !== 'record_private_note')
      .map((entry) => {
        const { action } = entry
        switch (action.type) {
          case 'speak':
          case 'open_door':
          case 'close_door':
          case 'knock':
            return { type: action.type, roomId: action.roomId }
          case 'move_room':
            return { type: action.type, toRoomId: action.toRoomId }
          case 'share_evidence':
            return { type: action.type, roomId: action.roomId, evidenceId: action.evidenceId }
          default:
            return { type: action.type }
        }
      }),
  }
}
