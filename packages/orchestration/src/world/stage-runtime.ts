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
import {
  deriveOptions,
  type Decision,
  type DecisionRejection,
  type OptionDefinition,
  type StageDecisions,
} from '../stage/options'
import { flushReplies, type CoalescingOptions, type ReplyInbox, type ReplyRateLimiter } from './reply'
import { advanceTick, applyAction, occupantsOf, visibleTranscript, type WorldState } from './state'

export interface StageAgent {
  privateContext: AgentPrivateContext
  /**
   * FR-12b: only stage-relevant agents are ticked. A porter who has no part in this stage is not
   * a cheap call, it is no call.
   */
  relevant: boolean
}

/**
 * The stage decision (K6). Agents decide by the player's rules, so the loop routes their
 * `commit_decision` through the same ledger and the same staleness check a human's commit goes
 * through; the options themselves are re-derived every tick from world state (FR-14).
 */
export interface StageDecisionConfig {
  catalogue: readonly OptionDefinition[]
  ledger: StageDecisions
}

export interface StageReplyConfig {
  inbox: ReplyInbox
  limiter: ReplyRateLimiter
  /** Server clock. Injected so a run stays reproducible. */
  now: () => number
}

export interface StageConfig {
  sharedContext: string
  stageBrief: string
  decision?: StageDecisionConfig
  /** agentId -> per-stage configuration. Only agents listed here can act. */
  agents: Record<string, StageAgent>
  budget?: ActionBudget
  /** Hard stop on the loop, independent of the action caps. */
  maxTicks?: number
  /** Prompt + completion tokens the whole stage may spend (FR-12b, M9). */
  tokenBudget?: number
  replies?: StageReplyConfig
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
  agentsSkipped: Record<string, 'not_stage_relevant' | 'budget_exhausted'>
  droppedActions: DroppedAction[]
  refusedActions: number
  degradedTicks: number
  repliesFlushed: number
  heldMessagesAnswered: number
  heldMessagesDropped: number
  repliesUnroutable: number
  /** Share of model calls that needed a repair round (M11/M12). */
  repairRate: number
  decisions: Decision[]
  /** Decisions the ledger refused, with why. A stale commit is rejected, never applied (FR-14). */
  rejectedDecisions: { actorId: string; reason: DecisionRejection }[]
  /** Which cap ended the stage, if one did. */
  stoppedBy: 'max_ticks' | 'action_budget' | 'token_budget' | 'all_yielded' | 'all_decided'
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
): AgentTurnInput | null {
  const stageAgent = config.agents[agentId]
  if (stageAgent === undefined) return null
  const roomId = world.location[agentId]
  if (roomId === undefined) return null
  const room = world.rooms[roomId]
  if (room === undefined || world.actors[agentId] === undefined) return null

  const heard = visibleTranscript(world, agentId)
  const window = config.transcriptWindow ?? 12
  const here: TranscriptLine[] = heard
    .filter((line) => line.roomId === roomId)
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

  const decision = config.decision
  const options = decision === undefined ? undefined : deriveOptions(world, decision.catalogue).options
  // Once every human is in, the stage waits on the characters alone; making the table sit out the
  // timer for them is bad play, so they are told to decide now (agreed 20 Sep, Kevin).
  const mustDecide =
    decision !== undefined && decision.ledger.humansDecided() && !decision.ledger.has(agentId)

  const lastHere = here[here.length - 1]
  const playerMessage =
    lastHere !== undefined && world.actors[lastHere.speakerId]?.kind === 'player' ? lastHere.body : null

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
    options,
    mustDecide,
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
    agentsSkipped: Object.fromEntries(
      Object.entries(config.agents)
        .filter(([, agent]) => !agent.relevant)
        .map(([agentId]) => [agentId, 'not_stage_relevant' as const]),
    ),
    droppedActions: [],
    refusedActions: 0,
    degradedTicks: 0,
    repliesFlushed: 0,
    heldMessagesAnswered: 0,
    heldMessagesDropped: 0,
    repliesUnroutable: 0,
    repairRate: 0,
    decisions: [],
    rejectedDecisions: [],
    stoppedBy: 'all_yielded',
  }

  const turns: AgentTurnResult[] = []
  const spent = (actorId: string): number => telemetry.actionsByActor[actorId] ?? 0
  const overTokenBudget = (): boolean =>
    config.tokenBudget !== undefined && telemetry.totalTokens >= config.tokenBudget
  const unroutableReplyAgents = new Set<string>()
  const flushHeld = async (force: boolean): Promise<void> => {
    const replies = config.replies
    if (replies === undefined) return

    const options: CoalescingOptions = {
      limiter: replies.limiter,
      inbox: replies.inbox,
      nowMs: replies.now(),
      force,
      metrics,
      tokensSpent: telemetry.totalTokens,
      ...(config.tokenBudget === undefined ? {} : { tokenBudget: config.tokenBudget }),
    }

    const flushed = await flushReplies(
      client,
      world,
      (agentId) => {
        const input = buildAgentTurnInput(world, agentId, config, 1)
        if (input === null) unroutableReplyAgents.add(agentId)
        return input
      },
      options,
    )
    for (const result of flushed) {
      turns.push(result.reply.turn)
      telemetry.repliesFlushed += 1
      telemetry.heldMessagesAnswered += result.answered.length
      telemetry.promptTokens += result.reply.turn.usage.promptTokens
      telemetry.completionTokens += result.reply.turn.usage.completionTokens
      telemetry.totalTokens = telemetry.promptTokens + telemetry.completionTokens
    }
    telemetry.heldMessagesDropped = replies.inbox.droppedHeld()
    telemetry.repliesUnroutable = unroutableReplyAgents.size
  }

  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (tick > 0) advanceTick(world)
    await flushHeld(false)
    telemetry.ticks = tick + 1
    let acted = false

    for (const agentId of relevantIds) {
      if (overTokenBudget()) {
        telemetry.stoppedBy = 'token_budget'
        return await finish()
      }
      if (telemetry.totalActions >= budget.maxActions) {
        telemetry.stoppedBy = 'action_budget'
        return await finish()
      }

      const remaining = Math.min(
        budget.maxActionsPerActor - spent(agentId),
        budget.maxActions - telemetry.totalActions,
      )
      if (remaining <= 0) {
        telemetry.agentsSkipped[agentId] = 'budget_exhausted'
        continue
      }
      // An actor that has committed or passed is out of the stage; ticking it again would only
      // buy a stream of already_decided rejections.
      if (config.decision?.ledger.has(agentId) === true) continue

      const input = buildAgentTurnInput(world, agentId, config, remaining)
      if (input === null) continue
      const optionsVersion =
        config.decision === undefined ? undefined : deriveOptions(world, config.decision.catalogue).version
      const turn = await runAgentTurn(client, input, {
        budget,
        spent: spent(agentId),
        metrics,
        optionsVersion,
      })
      turns.push(turn)
      if (!telemetry.agentsTicked.includes(agentId)) telemetry.agentsTicked.push(agentId)
      telemetry.promptTokens += turn.usage.promptTokens
      telemetry.completionTokens += turn.usage.completionTokens
      telemetry.totalTokens = telemetry.promptTokens + telemetry.completionTokens
      telemetry.droppedActions.push(...turn.dropped)
      if (turn.degraded) telemetry.degradedTicks += 1

      for (const entry of turn.actions) {
        const charged = chargeAndApply(world, entry, config, telemetry)
        if (charged) {
          telemetry.actionsByActor[agentId] = spent(agentId) + 1
          telemetry.totalActions += 1
          acted = true
        }
      }
      telemetry.refusedActions = world.events.filter((event) => event.kind === 'refused').length
    }

    if (config.decision?.ledger.settled() === true) {
      telemetry.stoppedBy = 'all_decided'
      return await finish()
    }
    if (!acted) {
      telemetry.stoppedBy = 'all_yielded'
      return await finish()
    }
    if (tick === maxTicks - 1) telemetry.stoppedBy = 'max_ticks'
  }

  return await finish()

  async function finish(): Promise<StageRunResult> {
    await flushHeld(true)
    telemetry.repairRate = metrics.repairRate
    return { world, turns, telemetry }
  }
}

/**
 * Apply an action and report whether it costs budget. A yield is free (FR-12b); a refusal is not,
 * and neither is a rejected decision — attempting is spending, or a stale commit would be a free
 * retry loop.
 */
function chargeAndApply(
  world: WorldState,
  entry: ActorAction,
  config: StageConfig,
  telemetry: StageTelemetry,
): boolean {
  if (entry.action.type === 'yield') return false

  const decision = config.decision
  if (decision !== undefined && (entry.action.type === 'commit_decision' || entry.action.type === 'pass')) {
    const result =
      entry.action.type === 'pass'
        ? decision.ledger.pass(entry.actorId)
        : decision.ledger.commit(world, decision.catalogue, {
            actorId: entry.actorId,
            actorKind: entry.actorKind,
            optionId: entry.action.optionId,
            optionsVersion: entry.action.optionsVersion,
          })
    if (result.ok) telemetry.decisions.push(result.decision)
    else telemetry.rejectedDecisions.push({ actorId: entry.actorId, reason: result.reason })
    return true
  }

  applyAction(world, entry)
  return true
}
