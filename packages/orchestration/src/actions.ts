/**
 * The action allow-list (EXECUTION_SPEC §2, PRD FR-20 / FR-12a / D18).
 *
 * This is the complete, closed set of actions the world can execute on behalf of an actor. It is a
 * frozen interface: everything an agent or the player can do to the world passes through
 * `parseAction`, and anything that is not in this file is dropped rather than executed.
 *
 * Three rules are encoded here rather than left to callers:
 *
 *   1. **Model output is a proposal, never an effect** (PRD §4). An LLM emits candidate actions;
 *      `filterActions` returns only the ones the world can execute, with a drop reason for each
 *      rejection so the drop rate is measurable (FR-24) instead of silent.
 *   2. **Decisions are options-only** (D18/FR-14). `commit_decision` carries an option id, never a
 *      free-text action. Free text is `speak`: it is conversation, and it can only change which
 *      options exist. Any actor may decide — agents play by the player's rules here (revised
 *      20 Sep, Kevin) — but only from the live option set, which `stage/options` enforces.
 *   3. **Scene effects are not actions.** Only the Resolver emits `effects[]` (FR-15b), and they
 *      are cosmetic; no entry in this list can be used to smuggle one in.
 */
import { z } from 'zod'

/** Actions an autonomous character agent may take on a tick (FR-12a). */
export const AGENT_ACTION_TYPES = [
  'speak',
  'move_room',
  'open_door',
  'close_door',
  'share_evidence',
  'record_private_note',
  'commit_decision',
  'pass',
  'yield',
] as const
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number]

/** Actions the player may take. The player is modelled as another agent (D2/D17), and the engine
 * keeps that abstraction whole: the only asymmetry left is `record_private_note`, which exists
 * because a model has no memory between ticks and a human does. `pass` is what the timer records
 * on expiry (D12/FR-16). */
export const PLAYER_ACTION_TYPES = [
  'speak',
  'move_room',
  'open_door',
  'close_door',
  'share_evidence',
  'commit_decision',
  'pass',
  'yield',
] as const
export type PlayerActionType = (typeof PLAYER_ACTION_TYPES)[number]

export const ACTION_TYPES = [
  'speak',
  'move_room',
  'open_door',
  'close_door',
  'share_evidence',
  'record_private_note',
  'commit_decision',
  'pass',
  'yield',
] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export const ACTOR_KINDS = ['agent', 'player'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

const id = z.string().min(1).max(64)
const body = z.string().trim().min(1).max(2000)

/**
 * Say something in a room. The room's occupants hear it and it enters that room's transcript only
 * (FR-11); a closed door is what makes an exchange private (D7). `addresseeId` is a hint for the
 * renderer and the agent runtime, not a delivery rule.
 */
export const speakActionSchema = z.object({
  type: z.literal('speak'),
  roomId: id,
  body,
  addresseeId: id.nullable(),
})

export const moveRoomActionSchema = z.object({
  type: z.literal('move_room'),
  toRoomId: id,
})

export const openDoorActionSchema = z.object({
  type: z.literal('open_door'),
  roomId: id,
})

export const closeDoorActionSchema = z.object({
  type: z.literal('close_door'),
  roomId: id,
})

/** Reveal a known evidence item to everyone currently in the room. Information transfer is an
 * action so that who-knows-what stays server-authoritative (FR-12). */
export const shareEvidenceActionSchema = z.object({
  type: z.literal('share_evidence'),
  roomId: id,
  evidenceId: id,
})

/** An agent writing to its own memory. Server-side only: it never reaches a client payload (FR-21). */
export const recordPrivateNoteActionSchema = z.object({
  type: z.literal('record_private_note'),
  note: z.string().trim().min(1).max(600),
})

/** The stage decision (D18/FR-14): an id from the Resolver-maintained option list, nothing else.
 * `optionsVersion` is the version of the option set the actor was looking at; a commit carrying a
 * stale version is rejected rather than applied (FR-14). */
export const commitDecisionActionSchema = z.object({
  type: z.literal('commit_decision'),
  optionId: id,
  optionsVersion: z.string().min(1).max(64),
})

/** Declining the stage decision. Recorded for any actor that has not decided when the timer
 * expires (D12/FR-16): not deciding is a decision. */
export const passActionSchema = z.object({
  type: z.literal('pass'),
})

/** Nothing worth doing this tick. An idle agent yields rather than burning budget (FR-12b). */
export const yieldActionSchema = z.object({
  type: z.literal('yield'),
})

export const actionSchema = z.discriminatedUnion('type', [
  speakActionSchema,
  moveRoomActionSchema,
  openDoorActionSchema,
  closeDoorActionSchema,
  shareEvidenceActionSchema,
  recordPrivateNoteActionSchema,
  commitDecisionActionSchema,
  passActionSchema,
  yieldActionSchema,
])
export type Action = z.infer<typeof actionSchema>
export type AgentAction = Extract<Action, { type: AgentActionType }>

/** An action with its actor attached, as stored in `resolution.actions` (PRD §6). */
export const actorActionSchema = z.object({
  actorKind: z.enum(ACTOR_KINDS),
  actorId: id,
  action: actionSchema,
})
export type ActorAction = z.infer<typeof actorActionSchema>

const ALLOWED_BY_ACTOR: Record<ActorKind, readonly ActionType[]> = {
  agent: AGENT_ACTION_TYPES,
  player: PLAYER_ACTION_TYPES,
}

/** Actions whose payload is server-side only and must never be projected to a client (FR-21). */
export const PRIVATE_ACTION_TYPES = ['record_private_note'] as const

export function isPrivateAction(action: Action): boolean {
  return (PRIVATE_ACTION_TYPES as readonly string[]).includes(action.type)
}

export type DropReason =
  | 'not_allow_listed'
  | 'actor_not_permitted'
  | 'malformed_payload'
  | 'budget_exhausted'

export interface DroppedAction {
  reason: DropReason
  /** The offending action type when it was at least a recognisable string. */
  type: string | null
  detail: string
}

export type ParseResult = { ok: true; action: Action } | { ok: false; dropped: DroppedAction }

/**
 * Validate one candidate action against the allow-list. Never throws: an unparseable or
 * non-allow-listed proposal is a dropped action, not a failed turn (FR-20).
 */
export function parseAction(value: unknown, actorKind: ActorKind): ParseResult {
  const type =
    value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
      ? (value as { type: string }).type
      : null

  if (type === null || !(ACTION_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      dropped: { reason: 'not_allow_listed', type, detail: `"${String(type)}" is not an allow-listed action` },
    }
  }
  if (!ALLOWED_BY_ACTOR[actorKind].includes(type as ActionType)) {
    return {
      ok: false,
      dropped: { reason: 'actor_not_permitted', type, detail: `a ${actorKind} may not emit "${type}"` },
    }
  }

  const parsed = actionSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      dropped: {
        reason: 'malformed_payload',
        type,
        detail: parsed.error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`).join('; '),
      },
    }
  }
  return { ok: true, action: parsed.data }
}

/** Per-stage action budget (FR-12b). `maxActionsPerActor` is what keeps one scheming agent from
 * spending the whole stage; `maxActions` is the stage-wide cap the token budget is derived from. */
export interface ActionBudget {
  maxActions: number
  maxActionsPerActor: number
}

export const DEFAULT_ACTION_BUDGET: ActionBudget = {
  maxActions: 24,
  maxActionsPerActor: 6,
}

export interface FilterResult {
  actions: ActorAction[]
  dropped: DroppedAction[]
  /** dropped / (accepted + dropped), rounded to 4dp. Feeds the FR-24 telemetry. */
  dropRate: number
}

/**
 * Filter a batch of candidate actions from one actor through the allow-list and the budget.
 * A `yield` never counts against the budget: yielding is how an idle agent stays cheap (FR-12b).
 */
export function filterActions(
  candidates: readonly unknown[],
  actor: { actorKind: ActorKind; actorId: string },
  budget: ActionBudget = DEFAULT_ACTION_BUDGET,
  spentByActor = 0,
): FilterResult {
  const actions: ActorAction[] = []
  const dropped: DroppedAction[] = []
  let spent = spentByActor

  for (const candidate of candidates) {
    const result = parseAction(candidate, actor.actorKind)
    if (!result.ok) {
      dropped.push(result.dropped)
      continue
    }
    const costs = result.action.type !== 'yield'
    if (costs && spent >= budget.maxActionsPerActor) {
      dropped.push({
        reason: 'budget_exhausted',
        type: result.action.type,
        detail: `actor "${actor.actorId}" is at its cap of ${budget.maxActionsPerActor} actions for this stage`,
      })
      continue
    }
    if (costs) spent += 1
    actions.push({ actorKind: actor.actorKind, actorId: actor.actorId, action: result.action })
  }

  const total = actions.length + dropped.length
  return { actions, dropped, dropRate: total === 0 ? 0 : Number((dropped.length / total).toFixed(4)) }
}
