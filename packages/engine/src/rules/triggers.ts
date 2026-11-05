/**
 * Stances change only through written triggers [G4.1, P6] and the built-in trust trigger [G4.3, P8.4].
 * Confronting a slant with a note that contradicts it fires a major character's trigger [P13.5], or unlocks a
 * minor character's note with no stance change [P13.6].
 */
import { evaluate, stanceIndex } from '../conditions'
import { currentStage, lookup, type StepContext } from '../context'
import type { SpecTrigger } from '../spec'
import { grantDiscovery, markProgress } from './knowledge'

export const TRUST_CHALLENGES = 2

export interface TriggerEffects {
  stanceChanged: boolean
  handedOver: string[]
}

function setStance(ctx: StepContext, characterId: string, to: string, cause: 'trigger' | 'trust', triggerId: string | null, notice: string): boolean {
  const character = ctx.state.characters[characterId]
  if (character === undefined || character.stanceId === null || character.stanceId === to) return false
  const from = character.stanceId
  character.stanceId = to
  ctx.say('notice', notice, { characterId })
  ctx.emit({ type: 'stanceChange', characterId, from, to, cause, triggerId })
  markProgress(ctx)
  ctx.touch()
  return true
}

function targetStance(ctx: StepContext, trigger: SpecTrigger): string | null {
  const character = lookup.character(ctx.spec, trigger.characterId)
  const current = ctx.state.characters[trigger.characterId]?.stanceId ?? null
  const effect = trigger.effect
  if ('toStance' in effect) return character.stances.some((stance) => stance.id === effect.toStance) ? effect.toStance : null
  const index = stanceIndex(ctx.spec, character.id, current)
  if (index < 0) return null
  const next = character.stances[index + effect.stanceDelta]
  // A one-step rise never lands on the hidden top stance; only an explicit trigger reaches it (G6.1.2).
  if (next === undefined || next.hidden === true) return null
  return next.id
}

/** Fire one trigger if its requirement holds and it hasn't fired. Returns what changed. */
export function fireTrigger(ctx: StepContext, trigger: SpecTrigger, effects: TriggerEffects): void {
  const { state } = ctx
  if (state.firedTriggers.includes(trigger.id)) return
  if (!evaluate(trigger.requires, { spec: ctx.spec, state, now: ctx.now })) return
  state.firedTriggers.push(trigger.id)
  ctx.touch()
  const to = targetStance(ctx, trigger)
  const character = state.characters[trigger.characterId]
  if (to !== null && character?.trustRecoveryStanceId != null) {
    const ceiling = stanceIndex(ctx.spec, trigger.characterId, character.trustRecoveryStanceId)
    if ('toStance' in trigger.effect) character.trustRecoveryStanceId = null
    else if (trigger.effect.stanceDelta < 0 && character.stanceId !== to) {
      const adjusted = lookup.character(ctx.spec, trigger.characterId).stances[Math.max(0, ceiling + trigger.effect.stanceDelta)]
      character.trustRecoveryStanceId = adjusted?.id ?? null
    }
    if (stanceIndex(ctx.spec, trigger.characterId, to) >= stanceIndex(ctx.spec, trigger.characterId, character.trustRecoveryStanceId)) character.trustRecoveryStanceId = null
  }
  if (to !== null && setStance(ctx, trigger.characterId, to, 'trigger', trigger.id, trigger.notice)) effects.stanceChanged = true
  for (const documentId of trigger.handsOver ?? []) {
    if (state.heldDocuments.includes(documentId)) continue
    state.heldDocuments.push(documentId)
    delete state.documentRooms[documentId]
    effects.handedOver.push(documentId)
  }
}

/** The student showed `discoveryId`'s note to `characterId`: notePassed triggers and slant confrontations. */
export function onNotePassed(ctx: StepContext, characterId: string, discoveryId: string): TriggerEffects {
  const effects: TriggerEffects = { stanceChanged: false, handedOver: [] }
  const { state, spec } = ctx
  if (!state.passedOn.some((passed) => passed.characterId === characterId && passed.discoveryId === discoveryId)) {
    state.passedOn.push({ characterId, discoveryId })
    ctx.touch()
  }
  const character = lookup.character(spec, characterId)
  for (const slant of character.slants) {
    if (!slant.contradictedBy.includes(discoveryId) || state.confrontedSlants.includes(slant.id)) continue
    state.confrontedSlants.push(slant.id)
    ctx.touch()
    if (character.tier === 'minor' && slant.unlocksDiscoveryId !== undefined) {
      grantDiscovery(ctx, lookup.discovery(spec, slant.unlocksDiscoveryId), 'slant')
    }
    for (const trigger of spec.triggers) {
      if (trigger.characterId === characterId && 'slantConfronted' in trigger.on && trigger.on.slantConfronted === slant.id) fireTrigger(ctx, trigger, effects)
    }
  }
  for (const trigger of spec.triggers) {
    if (trigger.characterId === characterId && 'notePassed' in trigger.on && trigger.on.notePassed === discoveryId) fireTrigger(ctx, trigger, effects)
  }
  return effects
}

/** Triggers that watch the state rather than an action (`on.discovered`). Part of the fixpoint loop. */
export function settleTriggers(ctx: StepContext): void {
  const effects: TriggerEffects = { stanceChanged: false, handedOver: [] }
  for (const trigger of ctx.spec.triggers) {
    if ('discovered' in trigger.on && ctx.state.discovered.includes(trigger.on.discovered)) fireTrigger(ctx, trigger, effects)
  }
}

/** The trust trigger: every second challenged claim to a major character costs one stance step. */
export function onChallenged(ctx: StepContext, characterId: string): void {
  const character = lookup.character(ctx.spec, characterId)
  const state = ctx.state.characters[characterId]
  if (state === undefined) return
  ctx.emit({ type: 'challenge', characterId })
  if (character.tier !== 'major' || state.stanceId === null) return
  state.challenged += 1
  if (state.challenged < TRUST_CHALLENGES) return
  state.challenged = 0
  const index = stanceIndex(ctx.spec, characterId, state.stanceId)
  const lower = character.stances[index - 1]
  if (lower === undefined) return
  if (currentStage(ctx).preparation !== undefined) {
    const ceiling = stanceIndex(ctx.spec, characterId, state.trustRecoveryStanceId ?? null)
    if (ceiling < index) state.trustRecoveryStanceId = state.stanceId
  }
  setStance(ctx, characterId, lower.id, 'trust', null, character.trustNotice ?? `${character.name} seems to trust you a little less.`)
}

/** A checked correction can restore lost trust, but never repeat a trigger or create a new high stance. */
export function recoverTrust(ctx: StepContext, characterId: string, discoveryId: string): void {
  const preparation = currentStage(ctx).preparation
  const state = ctx.state.characters[characterId]
  if (preparation === undefined || state?.trustRecoveryStanceId == null || !ctx.state.discovered.includes(discoveryId)) return
  const character = lookup.character(ctx.spec, characterId)
  const relevant = character.slants.some((slant) => slant.contradictedBy.includes(discoveryId))
    || ctx.spec.triggers.some((trigger) => trigger.characterId === characterId && 'notePassed' in trigger.on && trigger.on.notePassed === discoveryId)
    || (preparation.characters[characterId] ?? []).some((group) => group.discoveryIds.includes(discoveryId))
    || preparation.essentialCharacters.some((required) => required.characterId === characterId && required.discoveryIds.includes(discoveryId))
  if (!relevant) return
  const ceiling = state.trustRecoveryStanceId
  if (stanceIndex(ctx.spec, characterId, state.stanceId) < stanceIndex(ctx.spec, characterId, ceiling)) {
    setStance(ctx, characterId, ceiling, 'trust', null, `${character.name} accepts your correction.`)
  }
  state.trustRecoveryStanceId = null
  state.challenged = 0
  ctx.touch()
}
