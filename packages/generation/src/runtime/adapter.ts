/**
 * Adventure Spec v2 (I1) -> orchestration runtime inputs (K1-K7).
 *
 * `packages/orchestration` mirrors the spec's shapes by hand and does not import
 * them; this is the one place the two vocabularies meet, so a rename on either
 * side breaks a test here instead of a demo. Everything is a pure mapping —
 * no LLM, no geometry. Where the runtime has no way to express something the
 * spec says (see `warnings`), the gap is reported, never silently dropped.
 *
 * Type-only imports keep this package free of a runtime dependency on
 * orchestration; the integration test drives the real functions.
 */
import type { AgentPrivateContext, StageAgent, StageConfig } from '../../../orchestration/src/index'
import type { NextStep, ResolverAgentView, ResolverDecisionView, ResolverInput } from '../../../orchestration/src/index'
import type { Decision, MintedOption, OptionDefinition, OptionPrecondition } from '../../../orchestration/src/index'
import type { ActorProfile, RoomState, WorldSeed } from '../../../orchestration/src/index'
import type { AdventureSpec, Agent, DecisionOption, Stage } from '../spec/v2'

export const PLAYER_ID = 'player'

export interface StageRuntimeBundle {
  stageId: string
  stageIndex: number
  /** Seed for `createWorld()`: rooms, actors (agents + player), starting placement. */
  world: WorldSeed
  /** `StageConfig` minus the caller-owned parts (budget, replies, decision ledger). */
  stage: Pick<StageConfig, 'sharedContext' | 'stageBrief' | 'agents'>
  /** K6 option catalogue for this stage. */
  options: OptionDefinition[]
  /** Where play goes if the timer expires before a commit (D12/FR-16): the first neutral/evasive option, else the first. */
  fallbackNext: Extract<NextStep, { kind: 'stage' } | { kind: 'ending' }>
  /** Resolver view of the agents, all at neutral standing. Dispositions are world state after that. */
  resolverAgents: ResolverAgentView[]
  /** Evidence ids placed in this stage, for `evidenceCollected`. */
  evidenceIds: string[]
  /** Spec semantics the runtime cannot yet express. Each is a concrete interface ask. */
  warnings: string[]
}

export function toPrivateContext(agent: Agent, spec: AdventureSpec): AgentPrivateContext {
  const stakeholder = spec.stakeholders.find((s) => s.id === agent.stakeholderId)
  return {
    agentId: agent.id,
    // The runtime has no persona field; it is carried as the first motivation so the model still hears the voice.
    motivations: [`Persona: ${agent.privateContext.persona}`, agent.privateContext.motivations],
    secrets: [agent.privateContext.hiddenInterests],
    knowledgeHorizon: `${agent.privateContext.knowledgeHorizon}${stakeholder ? ` You are ${stakeholder.name}, ${stakeholder.role}.` : ''}`,
    notes: [],
  }
}

export function toRoomState(room: Stage['rooms'][number]): RoomState {
  const state: RoomState = { id: room.id, name: room.name, description: room.landmark ? `${room.purpose} ${room.landmark.name}: ${room.landmark.description}` : room.purpose, doorOpen: room.enclosure === 'open' || room.doorDefault === 'open' }
  return room.enclosure === null ? state : { ...state, enclosure: room.enclosure }
}

export function toActorProfile(agent: Agent, spec: AdventureSpec): ActorProfile {
  const stakeholder = spec.stakeholders.find((s) => s.id === agent.stakeholderId)
  return { id: agent.id, name: stakeholder?.name ?? agent.id, publicRole: stakeholder?.role ?? '', kind: 'agent' }
}

/**
 * Spec preconditions are objective ids; runtime preconditions are world-state
 * predicates. An objective that targets evidence maps to `knows_evidence`. An
 * objective that targets an agent ("speak with X") has no predicate in the K6
 * catalogue yet, so it is dropped with a warning.
 */
export function toOptionPreconditions(option: DecisionOption, stage: Stage, warnings: string[]): OptionPrecondition[] {
  const out: OptionPrecondition[] = []
  const evidenceIds = new Set(stage.evidence.map((e) => e.id))
  const agentIds = new Set(stage.agents.map((agent) => agent.id))
  const objectives = new Map(stage.objectives.map((objective) => [objective.id, objective]))
  const visited = new Set<string>()
  const add = (precondition: OptionPrecondition): void => {
    if (!out.some((existing) => JSON.stringify(existing) === JSON.stringify(precondition))) out.push(precondition)
  }
  const visit = (objectiveId: string): void => {
    if (visited.has(objectiveId)) return
    visited.add(objectiveId)
    // the validator already rejects this
    const objective = objectives.get(objectiveId)
    if (!objective) throw new Error(`${stage.id}/${option.id}: unknown objective "${objectiveId}"`)
    objective.requires.forEach(visit)
    if (evidenceIds.has(objective.targetId)) add({ kind: 'knows_evidence', actorId: PLAYER_ID, evidenceId: objective.targetId })
    else if (agentIds.has(objective.targetId)) add({ kind: 'spoke_with', actorId: PLAYER_ID, otherActorId: objective.targetId })
    else throw new Error(`${stage.id}/${option.id}: unsupported objective target "${objective.targetId}"`)
  }
  option.preconditions.forEach(visit)
  return out
}

export function toStageRuntime(spec: AdventureSpec, stageIndex: number): StageRuntimeBundle {
  const stage = spec.stages[stageIndex]
  if (!stage) throw new Error(`spec has no stage ${stageIndex}`)
  const warnings: string[] = []

  const actors: ActorProfile[] = [
    ...stage.agents.map((a) => toActorProfile(a, spec)),
    { id: PLAYER_ID, name: spec.player.name, publicRole: spec.player.role, kind: 'player' },
  ]
  const placement: Record<string, string> = Object.fromEntries([...stage.agents.map((a) => [a.id, a.startRoomId] as const), [PLAYER_ID, stage.spawnRoomId] as const])

  // A door only opens from inside (K3), so a closed room nobody starts in is sealed for the
  // whole stage and `createWorld()` refuses the seed. The spec validator rejects that now, but
  // versions published before it are frozen: open the door instead of failing the attempt.
  const occupied = new Set(Object.values(placement))
  const rooms = stage.rooms.map((room) => {
    const state = toRoomState(room)
    if (state.doorOpen || occupied.has(room.id)) return state
    warnings.push(`${stage.id}: room "${room.id}" starts closed with nobody inside; opening its door so it stays reachable`)
    return { ...state, doorOpen: true }
  })

  const agents: Record<string, StageAgent> = Object.fromEntries(stage.agents.map((a) => [a.id, { privateContext: toPrivateContext(a, spec), relevant: true }]))

  const options = stage.decision.options.map((option): OptionDefinition => ({ id: option.id, label: option.label, preconditions: toOptionPreconditions(option, stage, warnings) }))
  if (stage.decision.requires.length) {
    const gate = toOptionPreconditions({ ...stage.decision.options[0]!, preconditions: stage.decision.requires }, stage, [])
    for (const option of options) (option.preconditions as OptionPrecondition[]).push(...gate.filter((g) => !option.preconditions.some((p) => JSON.stringify(p) === JSON.stringify(g))))
  }

  const fallback = stage.decision.options.find((o) => o.stance === 'neutral' || o.stance === 'evasive') ?? stage.decision.options[0]!

  return {
    stageId: stage.id,
    stageIndex,
    world: { rooms, actors, placement },
    stage: { sharedContext: spec.sharedContext.text, stageBrief: `${stage.title}. ${stage.sharedContext.text}`, agents },
    options,
    fallbackNext: fallback.branchTarget,
    resolverAgents: stage.agents.map((a) => ({ id: a.id, name: spec.stakeholders.find((s) => s.id === a.stakeholderId)?.name ?? a.id, disposition: 0 })),
    evidenceIds: stage.evidence.map((e) => e.id),
    warnings,
  }
}

export function toDecisionView(
  spec: AdventureSpec,
  stageIndex: number,
  optionId: string,
  mintedOptions: readonly MintedOption[] = [],
): ResolverDecisionView {
  const option = spec.stages[stageIndex]?.decision.options.find((o) => o.id === optionId)
  if (!option) {
    const minted = mintedOptions.find((candidate) => candidate.id === optionId)
    if (minted) return { optionId: minted.id, label: minted.label, stance: minted.stance, branchTarget: minted.branchTarget }
    throw new Error(`stage ${stageIndex} has no option ${optionId}`)
  }
  return { optionId: option.id, label: option.label, stance: option.stance, branchTarget: option.branchTarget }
}

export interface ResolverInputParts {
  attemptId: string
  seed: string
  resolvedAt: string
  /** `null` = timer expired / player passed. */
  optionId: string | null
  actions: ResolverInput['actions']
  evidenceCollected: number
  /** Standing carried over from earlier stages, by agent id. */
  dispositions?: Record<string, number>
  /** The K6 ledger at resolution time (`StageDecisions.all()`). Agents' entries become their `commitment` (K7). */
  decisions?: readonly Decision[]
  /** Resolver-minted options still in the current stage. */
  mintedOptions?: readonly MintedOption[]
}

export function toResolverInput(spec: AdventureSpec, bundle: StageRuntimeBundle, parts: ResolverInputParts): ResolverInput {
  const commitments = new Map((parts.decisions ?? []).map((d) => [d.actorId, { optionId: d.optionId, how: d.how }]))
  return {
    attemptId: parts.attemptId,
    stageId: bundle.stageId,
    seed: parts.seed,
    stageIndex: bundle.stageIndex,
    resolvedAt: parts.resolvedAt,
    trigger: parts.optionId === null ? 'timer_expiry' : 'decision',
    decision: parts.optionId === null ? null : toDecisionView(spec, bundle.stageIndex, parts.optionId, parts.mintedOptions),
    fallbackNext: bundle.fallbackNext,
    agents: bundle.resolverAgents.map((a) => {
      const commitment = commitments.get(a.id)
      return { ...a, disposition: parts.dispositions?.[a.id] ?? a.disposition, ...(commitment ? { commitment } : {}) }
    }),
    actions: parts.actions,
    evidenceCollected: parts.evidenceCollected,
  }
}
