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
import type { WorldState } from '../world/state'

/** The closed set of conditions an option may depend on. Evaluated against recorded world state. */
export type OptionPrecondition =
  | { kind: 'actor_in_room'; actorId: string; roomId: string }
  | { kind: 'actors_together'; actorId: string; otherActorId: string }
  | { kind: 'door_open'; roomId: string; open: boolean }
  | { kind: 'knows_evidence'; actorId: string; evidenceId: string }
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
   * Fingerprint of the available ids. Changes the instant the world changes the set, which is
   * what makes a stale submission detectable without storing per-actor snapshots.
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
    case 'not':
      return !evaluatePrecondition(world, precondition.precondition)
  }
}

export function isAvailable(world: WorldState, option: OptionDefinition): boolean {
  return option.preconditions.every((precondition) => evaluatePrecondition(world, precondition))
}

/** Derive the live option set from world state. Pure: the same world always yields the same set. */
export function deriveOptions(world: WorldState, catalogue: readonly OptionDefinition[]): OptionSet {
  const available = catalogue.filter((option) => isAvailable(world, option))
  const version = hashSeed(available.map((option) => option.id).join('|')).toString(16)
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

  constructor(participants: readonly { actorId: string; actorKind: ActorKind }[]) {
    this.participants = new Map(participants.map((p) => [p.actorId, p.actorKind]))
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

    const live = deriveOptions(world, catalogue)
    if (live.version !== submission.optionsVersion) {
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
    // Belt and braces: the version alone would catch this, but an option whose preconditions fail
    // must never be committed even if some future change makes two states share a fingerprint.
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
