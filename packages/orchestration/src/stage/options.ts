/**
 * Option maintenance and the stage decision (K6, PRD FR-13/FR-14/D18).
 *
 * The rule that shapes this file is FR-14's last clause: *options are re-derived from state, so a
 * stale option can never be committed*. That is only true if availability is never stored. So an
 * option is a definition plus preconditions, the live set is a pure function of the world, and a
 * commit is checked against a set derived at the moment of the commit — not against whatever the
 * actor was shown when they made up their mind.
 *
 * Preconditions are data, not predicates in code, because they arrive in the authored adventure
 * spec (I1) as JSON. A closed set of comparisons keeps that safe: nothing an author or a model
 * writes can execute.
 *
 * Decisions are actor-kind-neutral (revised 20 Sep, Kevin): an agent commits under exactly the
 * rules a player does. The engine has one decision path, not two.
 */
import type { ActorKind } from '../actions'
import { hashSeed } from '../rng'
import { wasPresent, type WorldState } from '../world/state'

/** The closed set of conditions an option may depend on. Evaluated against recorded world state. */
export type OptionPrecondition =
  | { kind: 'actor_in_room'; actorId: string; roomId: string }
  | { kind: 'actors_together'; actorId: string; otherActorId: string }
  | { kind: 'door_open'; roomId: string; open: boolean }
  | { kind: 'knows_evidence'; actorId: string; evidenceId: string }
  /**
   * The actor has heard `speakerId` speak while both were in the same room. What "talk to X"
   * means at runtime (D7/FR-11): presence decides, so a line spoken behind a closed door the actor
   * was not in does not count, and neither does a message the actor sent without a reply.
   */
  | { kind: 'heard_from'; actorId: string; speakerId: string }
  | { kind: 'not'; precondition: OptionPrecondition }

export interface OptionDefinition {
  id: string
  /** What the actor sees. Public: it is rendered to every client (FR-21). */
  label: string
  /** All must hold for the option to be on the table. An empty list means always available. */
  preconditions: readonly OptionPrecondition[]
}

/** The client-facing shape of an option. No preconditions, no authoring notes. */
export interface PublicOption {
  id: string
  label: string
}

export interface OptionSet {
  /**
   * Catalogue identity followed by a per-option availability mask. The mask is scoped to the
   * viewer when one is supplied; without a viewer this is an omniscient server-internal view.
   */
  version: string
  options: PublicOption[]
}

export function evaluatePrecondition(world: WorldState, precondition: OptionPrecondition): boolean {
  switch (precondition.kind) {
    case 'actor_in_room':
      return world.location[precondition.actorId] === precondition.roomId
    case 'actors_together': {
      const room = world.location[precondition.actorId]
      return room !== undefined && room === world.location[precondition.otherActorId]
    }
    case 'door_open':
      return (world.rooms[precondition.roomId]?.doorOpen ?? false) === precondition.open
    case 'knows_evidence':
      return (world.evidenceKnown[precondition.actorId] ?? []).includes(precondition.evidenceId)
    case 'heard_from':
      return world.transcript.some(
        (line) =>
          line.speakerId === precondition.speakerId &&
          wasPresent(world, precondition.actorId, line.roomId, line.seq),
      )
    case 'not':
      return !evaluatePrecondition(world, precondition.precondition)
  }
}

export function isAvailable(world: WorldState, option: OptionDefinition): boolean {
  return option.preconditions.every((precondition) => evaluatePrecondition(world, precondition))
}

/** Whether a viewer must not be shown an option because it depends on another actor's evidence. */
export function isHiddenFrom(option: OptionDefinition, viewerId?: string): boolean {
  if (viewerId === undefined) return false

  const hiddenBy = (precondition: OptionPrecondition): boolean => {
    switch (precondition.kind) {
      case 'knows_evidence':
      case 'heard_from':
        return precondition.actorId !== viewerId
      case 'not':
        return hiddenBy(precondition.precondition)
      default:
        return false
    }
  }

  return option.preconditions.some(hiddenBy)
}

function catalogueFingerprint(catalogue: readonly OptionDefinition[]): string {
  return hashSeed(catalogue.map((option) => option.id).join('|')).toString(16)
}

function availabilityMask(
  world: WorldState,
  catalogue: readonly OptionDefinition[],
  viewerId?: string,
): boolean[] {
  return catalogue.map((option) => !isHiddenFrom(option, viewerId) && isAvailable(world, option))
}

function encodeMask(bits: readonly boolean[]): string {
  const nibbleCount = Math.max(1, Math.ceil(bits.length / 4))
  let encoded = ''
  for (let nibbleIndex = 0; nibbleIndex < nibbleCount; nibbleIndex += 1) {
    let nibble = 0
    for (let bit = 0; bit < 4; bit += 1) {
      if (bits[nibbleIndex * 4 + bit] === true) nibble |= 1 << bit
    }
    encoded += nibble.toString(16)
  }
  return encoded
}

/** Parse a catalogue fingerprint and per-option availability mask, or null when malformed. */
export function parseOptionsVersion(version: string): { catalogueFingerprint: string; bits: boolean[] } | null {
  const match = /^([0-9a-f]+):([0-9a-f]+)$/i.exec(version)
  if (match === null) return null
  const [, fingerprint, mask] = match
  if (fingerprint === undefined || mask === undefined) return null

  const bits: boolean[] = []
  for (const nibble of mask.toLowerCase()) {
    const value = Number.parseInt(nibble, 16)
    for (let bit = 0; bit < 4; bit += 1) bits.push((value & (1 << bit)) !== 0)
  }
  return { catalogueFingerprint: fingerprint.toLowerCase(), bits }
}

/**
 * Derive the live option set from world state. Pure: the same world and viewer always yield the
 * same set. Omitting `viewerId` is an explicit omniscient server-internal view; no option is
 * hidden in that mode.
 */
export function deriveOptions(
  world: WorldState,
  catalogue: readonly OptionDefinition[],
  viewerId?: string,
): OptionSet {
  const available = catalogue.filter(
    (option) => !isHiddenFrom(option, viewerId) && isAvailable(world, option),
  )
  const bits = availabilityMask(world, catalogue, viewerId)
  const version = `${catalogueFingerprint(catalogue)}:${encodeMask(bits)}`
  return { version, options: available.map((option) => ({ id: option.id, label: option.label })) }
}

export type DecisionRejection =
  | 'stale_option_set'
  | 'unknown_option'
  | 'option_unavailable'
  | 'already_decided'
  | 'not_in_stage'

export interface Decision {
  actorId: string
  actorKind: ActorKind
  /** null when the actor passed or the timer passed for them (D12/FR-16). */
  optionId: string | null
  how: 'committed' | 'passed' | 'timed_out'
}

export type DecisionResult = { ok: true; decision: Decision } | { ok: false; reason: DecisionRejection; detail: string }

export interface DecisionSubmission {
  actorId: string
  actorKind: ActorKind
  optionId: string
  /** The version of the option set the actor was looking at. */
  optionsVersion: string
}

/**
 * Who has decided this stage and who has not. Holds no option state of its own: availability is
 * always re-derived, so the ledger cannot go stale either.
 */
export class StageDecisions {
  private readonly participants: Map<string, ActorKind>
  private readonly decisions = new Map<string, Decision>()

  constructor(
    participants: readonly { actorId: string; actorKind: ActorKind }[],
    existing: readonly Decision[] = [],
  ) {
    this.participants = new Map(participants.map((p) => [p.actorId, p.actorKind]))
    for (const decision of existing) {
      const actorKind = this.participants.get(decision.actorId)
      if (actorKind === undefined || actorKind !== decision.actorKind) {
        throw new Error(`cannot restore decision for non-participant "${decision.actorId}"`)
      }
      if (this.decisions.has(decision.actorId)) {
        throw new Error(`cannot restore duplicate decision for "${decision.actorId}"`)
      }
      this.decisions.set(decision.actorId, decision)
    }
  }

  /** Rehydrate trusted stored decisions without re-evaluating option availability. */
  static restore(
    participants: readonly { actorId: string; actorKind: ActorKind }[],
    decisions: readonly Decision[],
  ): StageDecisions {
    return new StageDecisions(participants, decisions)
  }

  /**
   * Commit an option. Rejects — never mutates — when the actor is looking at an option set the
   * world has moved past, or when the option's preconditions no longer hold (FR-14).
   */
  commit(
    world: WorldState,
    catalogue: readonly OptionDefinition[],
    submission: DecisionSubmission,
  ): DecisionResult {
    const actorKind = this.participants.get(submission.actorId)
    if (actorKind === undefined || actorKind !== submission.actorKind) {
      return { ok: false, reason: 'not_in_stage', detail: `"${submission.actorId}" is not deciding this stage` }
    }
    if (this.decisions.has(submission.actorId)) {
      return { ok: false, reason: 'already_decided', detail: `"${submission.actorId}" has already decided` }
    }

    const parsed = parseOptionsVersion(submission.optionsVersion)
    if (parsed === null || parsed.catalogueFingerprint !== catalogueFingerprint(catalogue)) {
      return {
        ok: false,
        reason: 'stale_option_set',
        detail: `the options changed since "${submission.optionId}" was offered; re-read the option list`,
      }
    }

    const definition = catalogue.find((option) => option.id === submission.optionId)
    if (definition === undefined) {
      return { ok: false, reason: 'unknown_option', detail: `no option "${submission.optionId}"` }
    }
    if (isHiddenFrom(definition, submission.actorId)) {
      return { ok: false, reason: 'unknown_option', detail: `no option "${submission.optionId}"` }
    }
    const optionIndex = catalogue.indexOf(definition)
    if (parsed.bits[optionIndex] !== true) {
      return {
        ok: false,
        reason: 'stale_option_set',
        detail: `the options changed since "${submission.optionId}" was offered; re-read the option list`,
      }
    }
    // The mask says what was on the table when the actor read it; this says what is on the table
    // now. An option whose preconditions have since failed must never be committed (FR-14).
    if (!isAvailable(world, definition)) {
      return {
        ok: false,
        reason: 'option_unavailable',
        detail: `"${submission.optionId}" is no longer on the table`,
      }
    }

    const decision: Decision = {
      actorId: submission.actorId,
      actorKind,
      optionId: submission.optionId,
      how: 'committed',
    }
    this.decisions.set(submission.actorId, decision)
    return { ok: true, decision }
  }

  /** Decline to decide. Always accepted from a participant who has not yet decided. */
  pass(actorId: string, how: 'passed' | 'timed_out' = 'passed'): DecisionResult {
    const actorKind = this.participants.get(actorId)
    if (actorKind === undefined) {
      return { ok: false, reason: 'not_in_stage', detail: `"${actorId}" is not deciding this stage` }
    }
    if (this.decisions.has(actorId)) {
      return { ok: false, reason: 'already_decided', detail: `"${actorId}" has already decided` }
    }
    const decision: Decision = { actorId, actorKind, optionId: null, how }
    this.decisions.set(actorId, decision)
    return { ok: true, decision }
  }

  /** The timer ran out (D12/FR-16). Everyone still undecided passes; nobody is left pending. */
  expire(): Decision[] {
    const timedOut: Decision[] = []
    for (const actorId of this.pending()) {
      const result = this.pass(actorId, 'timed_out')
      if (result.ok) timedOut.push(result.decision)
    }
    return timedOut
  }

  pending(kind?: ActorKind): string[] {
    return [...this.participants.entries()]
      .filter(([actorId, actorKind]) => !this.decisions.has(actorId) && (kind === undefined || actorKind === kind))
      .map(([actorId]) => actorId)
  }

  has(actorId: string): boolean {
    return this.decisions.has(actorId)
  }

  /**
   * Every human is in. The stage is then decided except for the agents, and making the table wait
   * out a timer for characters that can answer in a second is bad play, so the loop forces them.
   */
  humansDecided(): boolean {
    return this.pending('player').length === 0
  }

  settled(): boolean {
    return this.pending().length === 0
  }

  all(): Decision[] {
    return [...this.decisions.values()]
  }
}
