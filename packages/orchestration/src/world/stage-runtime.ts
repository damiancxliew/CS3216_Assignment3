/**
 * The stage loop: autonomous agent ticks with the budget rails wired in (K4/K5, FR-12a/FR-12b).
 *
 * Agents act while the player is elsewhere — that is the point of FR-12a — but they do it inside
 * three caps that are enforced here rather than hoped for: a per-actor action cap, a stage-wide
 * action cap, and a token ceiling. The cheapest rail is the one that skips the call entirely, so
 * an agent with nothing left, or one the stage does not concern, is never sent to the model.
 *
 * Each agent's view is assembled from the world by presence (K3), so an agent physically cannot be
 * given a line from a room it was not standing in, and is given exactly one private context: its
 * own (K2/FR-21).
 */
import { DEFAULT_ACTION_BUDGET, type ActionBudget, type ActorAction, type DroppedAction } from '../actions'
import { runAgentTurn, type AgentTurnResult } from '../agent/character-agent'
import type { AgentPrivateContext, AgentPublicProfile, AgentTurnInput, RecalledLine, TranscriptLine } from '../agent/types'
import { StructuredCallMetrics } from '../llm/structured'
import type { LlmClient } from '../llm/types'
import { advanceTick, applyAction, occupantsOf, visibleTranscript, type ApplyResult, type WorldState } from './state'

export interface StageAgent {
  privateContext: AgentPrivateContext
  /**
   * FR-12b: only stage-relevant agents are ticked. A porter who has no part in this stage is not
   * a cheap call, it is no call.
   */
  relevant: boolean
}

export interface StageConfig {
  sharedContext: string
  stageBrief: string
  /** agentId -> per-stage configuration. Only agents listed here can act. */
  agents: Record<string, StageAgent>
  budget?: ActionBudget
  /** Hard stop on the loop, independent of the action caps. */
  maxTicks?: number
  /** Prompt + completion tokens the whole stage may spend (FR-12b, M9). */
  tokenBudget?: number
  /** Lines the agent is shown from its current room, most recent first. */
  transcriptWindow?: number
}

export interface StageTelemetry {
  ticks: number
  /** actorId -> actions charged against the budget this stage. `yield` is free (FR-12b). */
  actionsByActor: Record<string, number>
  totalActions: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  agentsTicked: string[]
  /** Agents the stage never called, with why. Evidence that the rail did something. */
  agentsSkipped: Record<string, 'not_stage_relevant' | 'budget_exhausted' | 'not_in_world'>
  droppedActions: DroppedAction[]
  refusedActions: number
  degradedTicks: number
  /** Share of model calls that needed a repair round (M11/M12). */
  repairRate: number
  /** Which cap ended the stage, if one did. */
  stoppedBy: 'max_ticks' | 'action_budget' | 'token_budget' | 'budget_exhausted' | 'all_yielded'
}

export interface StageRunResult {
  world: WorldState
  turns: AgentTurnResult[]
  telemetry: StageTelemetry
}

function toProfile(world: WorldState, actorId: string): AgentPublicProfile {
  const actor = world.actors[actorId]
  if (actor === undefined) throw new Error(`actor "${actorId}" is not in the world`)
  return { id: actor.id, name: actor.name, publicRole: actor.publicRole }
}

/**
 * Assemble one agent's view of the world. The only inputs are the world's recorded facts and this
 * agent's own private context; there is no parameter through which another agent's brief could
 * arrive.
 */
export function buildAgentTurnInput(
  world: WorldState,
  agentId: string,
  config: StageConfig,
  actionsRemaining: number,
): AgentTurnInput {
  const stageAgent = config.agents[agentId]
  if (stageAgent === undefined) throw new Error(`agent "${agentId}" is not in this stage`)
  const roomId = world.location[agentId] ?? ''
  const room = world.rooms[roomId]
  if (room === undefined) throw new Error(`agent "${agentId}" is nowhere`)

  const heard = visibleTranscript(world, agentId)
  const window = config.transcriptWindow ?? 12
  const roomLines = heard
    .filter((line) => line.roomId === roomId)
    .sort((left, right) => left.seq - right.seq)
  const lastSelfSeq = roomLines
    .filter((line) => line.speakerId === agentId)
    .at(-1)?.seq ?? -Infinity
  const playerMessage = [...roomLines]
    .reverse()
    .find(
      (line) =>
        line.seq > lastSelfSeq &&
        line.addresseeId === agentId &&
        world.actors[line.speakerId]?.kind === 'player',
    )?.body ?? null
  const here: TranscriptLine[] = roomLines
    .slice(-window)
    .map((line) => ({ speakerId: line.speakerId, speakerName: line.speakerName, body: line.body }))
  const recalled: RecalledLine[] = heard
    .filter((line) => line.roomId !== roomId)
    .slice(-window)
    .map((line) => ({
      speakerId: line.speakerId,
      speakerName: line.speakerName,
      body: line.body,
      roomName: world.rooms[line.roomId]?.name ?? line.roomId,
    }))

  return {
    self: toProfile(world, agentId),
    privateContext: {
      ...stageAgent.privateContext,
      // Notes the agent wrote on earlier ticks are part of its own context, and only its own.
      notes: [...stageAgent.privateContext.notes, ...(world.privateNotes[agentId] ?? [])],
    },
    sharedContext: config.sharedContext,
    stageBrief: config.stageBrief,
    room: {
      id: room.id,
      name: room.name,
      description: room.description,
      occupants: occupantsOf(world, roomId).map((occupant) => ({
        id: occupant.id,
        name: occupant.name,
        publicRole: occupant.publicRole,
      })),
      doorOpen: room.doorOpen,
    },
    transcript: here,
    recalled,
    playerMessage,
    actionsRemaining,
  }
}

/**
 * Run the stage until a cap stops it or every relevant agent yields.
 *
 * Agents act in a fixed order (the order they are configured in), so a run is reproducible given
 * the same client: the loop contributes no randomness of its own.
 */
export async function runStage(
  client: LlmClient,
  world: WorldState,
  config: StageConfig,
): Promise<StageRunResult> {
  const budget = config.budget ?? DEFAULT_ACTION_BUDGET
  const maxTicks = config.maxTicks ?? 4
  const metrics = new StructuredCallMetrics()

  const relevantIds = Object.entries(config.agents)
    .filter(([, agent]) => agent.relevant)
    .map(([agentId]) => agentId)

  const telemetry: StageTelemetry = {
    ticks: 0,
    actionsByActor: {},
    totalActions: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    agentsTicked: [],
    agentsSkipped: {},
    droppedActions: [],
    refusedActions: 0,
    degradedTicks: 0,
    repairRate: 0,
    stoppedBy: 'all_yielded',
  }

  const turns: AgentTurnResult[] = []
  const lastSkipReason: Record<string, 'not_stage_relevant' | 'budget_exhausted' | 'not_in_world'> =
    Object.fromEntries(
      Object.entries(config.agents)
        .filter(([, agent]) => !agent.relevant)
        .map(([agentId]) => [agentId, 'not_stage_relevant' as const]),
    )
  const tickedAgents = new Set<string>()
  const spent = (actorId: string): number => telemetry.actionsByActor[actorId] ?? 0
  const overTokenBudget = (): boolean =>
    config.tokenBudget !== undefined && telemetry.totalTokens >= config.tokenBudget

  if (maxTicks <= 0) {
    telemetry.stoppedBy = 'max_ticks'
    return finish()
  }

  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (tick > 0) advanceTick(world)
    telemetry.ticks = tick + 1
    let acted = false
    let called = false
    let budgetSkipped = false

    for (const agentId of relevantIds) {
      if (world.actors[agentId] === undefined || world.location[agentId] === undefined) {
        lastSkipReason[agentId] = 'not_in_world'
        continue
      }
      if (overTokenBudget()) {
        telemetry.stoppedBy = 'token_budget'
        return finish()
      }
      if (telemetry.totalActions >= budget.maxActions) {
        telemetry.stoppedBy = 'action_budget'
        return finish()
      }

      const remaining = Math.min(
        budget.maxActionsPerActor - spent(agentId),
        budget.maxActions - telemetry.totalActions,
      )
      if (remaining <= 0) {
        lastSkipReason[agentId] = 'budget_exhausted'
        budgetSkipped = true
        continue
      }

      const input = buildAgentTurnInput(world, agentId, config, remaining)
      const turn = await runAgentTurn(client, input, {
        budget,
        spent: spent(agentId),
        stageRemaining: budget.maxActions - telemetry.totalActions,
        metrics,
      })
      turns.push(turn)
      called = true
      if (!tickedAgents.has(agentId)) {
        tickedAgents.add(agentId)
        telemetry.agentsTicked.push(agentId)
      }
      telemetry.promptTokens += turn.usage.promptTokens
      telemetry.completionTokens += turn.usage.completionTokens
      telemetry.totalTokens = telemetry.promptTokens + telemetry.completionTokens
      telemetry.droppedActions.push(...turn.dropped)
      if (turn.degraded) telemetry.degradedTicks += 1
      // A call may overshoot the ceiling; finish after applying that call, without starting another.
      const tokenBudgetReached = overTokenBudget()

      for (const entry of turn.actions) {
        const result = chargeAndApply(world, entry)
        if (entry.action.type !== 'yield') {
          telemetry.actionsByActor[agentId] = spent(agentId) + 1
          telemetry.totalActions += 1
          if (result.ok) acted = true
          else telemetry.refusedActions += 1
        }
      }
      if (tokenBudgetReached) {
        telemetry.stoppedBy = 'token_budget'
        return finish()
      }
    }

    if (telemetry.totalActions >= budget.maxActions) {
      telemetry.stoppedBy = 'action_budget'
      return finish()
    }
    if (!acted) {
      telemetry.stoppedBy = called || !budgetSkipped ? 'all_yielded' : 'budget_exhausted'
      return finish()
    }
    if (tick === maxTicks - 1) telemetry.stoppedBy = 'max_ticks'
  }

  return finish()

  function finish(): StageRunResult {
    telemetry.agentsSkipped = Object.fromEntries(
      Object.entries(lastSkipReason).filter(([agentId]) => !tickedAgents.has(agentId)),
    ) as StageTelemetry['agentsSkipped']
    telemetry.repairRate = metrics.repairRate
    return { world, turns, telemetry }
  }
}

/** Apply one action. A yield is free (FR-12b); a refusal is not. */
function chargeAndApply(world: WorldState, entry: ActorAction): ApplyResult {
  if (entry.action.type === 'yield') return { ok: true }
  return applyAction(world, entry)
}
