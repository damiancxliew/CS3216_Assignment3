import { preparationProgress, type PreparationGroup } from '@adventure/spec-v3'

import { evaluate } from '../conditions'
import { currentStage, fail, type StepContext } from '../context'
import type { Condition, EngineSpec, SpecDiscovery } from '../spec'
import type { EngineState } from '../state'
import { markProgress } from './knowledge'

type Scope = { spec: EngineSpec; state: EngineState }

export function essentialProgress({ spec, state }: Scope) {
  const stage = spec.stages[state.stageIndex]
  return (stage?.preparation?.essentialCharacters ?? []).map(({ characterId, discoveryIds }) => ({
    characterId,
    name: spec.characters.find((character) => character.id === characterId)?.name ?? characterId,
    complete: discoveryIds.every((id) => state.essentialConversations?.[stage!.id]?.[characterId]?.includes(id)),
  }))
}

export function timerExpired({ spec, state }: Scope): boolean {
  return state.finalCallStages?.includes(spec.stages[state.stageIndex]?.id ?? '') ?? false
}

export function decisionPreparation(scope: Scope) {
  const groups = scope.spec.stages[scope.state.stageIndex]?.preparation?.decision ?? []
  const progress = preparationProgress(groups, scope.state.discovered)
  const essentialConversations = essentialProgress(scope)
  const expired = timerExpired(scope)
  // When time runs out the student may decide with whatever they have gathered.
  return { ...progress, ready: expired || (progress.ready && essentialConversations.every((character) => character.complete)), essentialConversations, timerExpired: expired }
}

export function requireCharacterPreparation(ctx: StepContext, characterId: string): void {
  const groups = currentStage(ctx).preparation?.characters[characterId] ?? []
  if (!preparationProgress(groups, ctx.state.discovered).ready) fail('preparation_required', 'complete the relevant evidence tasks before this conversation')
}

export function requireDecisionPreparation(ctx: StepContext): void {
  if (!decisionPreparation(ctx).ready) fail('preparation_required', 'finish the essential conversations and evidence before deciding')
}

/** Record designated facts confirmed by a substantive reply or by showing a verified note. */
export function confirmEssentialConversation(ctx: StepContext, characterId: string, conveyed: readonly string[]): void {
  const stage = currentStage(ctx)
  const requirement = stage.preparation?.essentialCharacters.find((character) => character.characterId === characterId)
  if (requirement === undefined) return
  const before = essentialProgress(ctx).find((character) => character.characterId === characterId)?.complete ?? false
  const matched = conveyed.filter((id) => requirement.discoveryIds.includes(id))
  if (matched.length === 0) return
  ctx.state.essentialConversations ??= {}
  const conversations = ctx.state.essentialConversations[stage.id] ??= {}
  const discussed = conversations[characterId] ??= []
  for (const id of matched) if (!discussed.includes(id)) discussed.push(id)
  if (!before && requirement.discoveryIds.every((id) => discussed.includes(id))) {
    ctx.emit({ type: 'essentialConversation', characterId })
    markProgress(ctx)
  }
  ctx.touch()
}

function missing(groups: readonly PreparationGroup[], state: EngineState): string[] {
  return groups.filter((group) => group.discoveryIds.filter((id) => state.discovered.includes(id)).length < group.minMet)
    .flatMap((group) => group.discoveryIds.filter((id) => !state.discovered.includes(id)))
}

function conditionPrerequisites(condition: Condition | undefined, spec: EngineSpec): string[] {
  if (condition === undefined) return []
  if ('discovered' in condition) return [condition.discovered]
  if ('all' in condition) return condition.all.flatMap((part) => conditionPrerequisites(part, spec))
  if ('any' in condition) return condition.any.flatMap((part) => conditionPrerequisites(part, spec))
  if ('notePassed' in condition) return [condition.notePassed.discoveryId]
  if ('slantConfronted' in condition) return spec.characters.flatMap((character) => character.slants.filter((slant) => slant.id === condition.slantConfronted).flatMap((slant) => slant.contradictedBy))
  if ('stanceIs' in condition || 'stanceAtLeast' in condition) {
    const characterId = 'stanceIs' in condition ? condition.stanceIs.characterId : condition.stanceAtLeast.characterId
    return spec.triggers.filter((trigger) => trigger.characterId === characterId).flatMap((trigger) => {
      if ('notePassed' in trigger.on) return [trigger.on.notePassed]
      if ('discovered' in trigger.on) return [trigger.on.discovered]
      return conditionPrerequisites({ slantConfronted: trigger.on.slantConfronted }, spec)
    })
  }
  return []
}

/** Follow preparation dependencies to an obtainable task. Returns only authored IDs, never private text. */
function preparationHintTask(scope: Scope, characterId?: string, now = scope.state.hints.lastProgressAt ?? scope.state.stageStartedAt ?? 0): { discovery: SpecDiscovery; shareWith?: string } | undefined {
  const { spec, state } = scope
  const stage = spec.stages[state.stageIndex]
  if (stage?.preparation === undefined) return undefined
  const localCharacters = characterId === undefined
    ? Object.keys(stage.preparation.characters).filter((id) => state.characters[id]?.roomId === state.playerRoomId)
    : [characterId]
  const roots = [
    ...localCharacters.flatMap((id) => missing(stage.preparation!.characters[id] ?? [], state)),
    ...(timerExpired(scope) ? [] : missing(stage.preparation.decision, state)),
    ...stage.preparation.essentialCharacters.flatMap((required) => required.discoveryIds.filter((id) => !state.essentialConversations?.[stage.id]?.[required.characterId]?.includes(id))),
  ]
  function shareRecipient(condition: Condition | undefined, discoveryId: string): string | undefined {
    if (condition === undefined) return undefined
    if ('all' in condition || 'any' in condition) return ('all' in condition ? condition.all : condition.any).map((part) => shareRecipient(part, discoveryId)).find((id) => id !== undefined)
    if ('notePassed' in condition && condition.notePassed.discoveryId === discoveryId) return condition.notePassed.characterId
    if ('slantConfronted' in condition) return spec.characters.find((character) => character.slants.some((slant) => slant.id === condition.slantConfronted && slant.contradictedBy.includes(discoveryId)))?.id
    if ('stanceIs' in condition || 'stanceAtLeast' in condition) {
      const holder = 'stanceIs' in condition ? condition.stanceIs.characterId : condition.stanceAtLeast.characterId
      if (spec.triggers.some((trigger) => trigger.characterId === holder && !state.firedTriggers.includes(trigger.id) && (
        'notePassed' in trigger.on ? trigger.on.notePassed === discoveryId : 'slantConfronted' in trigger.on && shareRecipient({ slantConfronted: trigger.on.slantConfronted }, discoveryId) === holder
      ))) return holder
    }
    return undefined
  }
  function accessible(id: string, visited: Set<string>): { discovery: SpecDiscovery; shareWith?: string } | undefined {
    if (visited.has(id)) return undefined
    const seen = new Set(visited).add(id)
    const discovery = spec.discoveries.find((candidate) => candidate.id === id)
    if (discovery === undefined) return undefined
    if (!evaluate(discovery.condition, { ...scope, now })) {
      for (const dependency of conditionPrerequisites(discovery.condition, spec)) {
        const target = accessible(dependency, seen)
        if (target !== undefined) {
          const recipient = state.discovered.includes(dependency) ? shareRecipient(discovery.condition, dependency) : undefined
          if (recipient !== undefined && state.characters[recipient]?.roomId != null && preparationProgress(stage!.preparation!.characters[recipient] ?? [], state.discovered).ready) return { discovery: target.discovery, shareWith: recipient }
          return target
        }
      }
      return undefined
    }
    if ('documentId' in discovery.holder) {
      return state.heldDocuments.includes(discovery.holder.documentId) || state.documentRooms[discovery.holder.documentId] !== undefined ? { discovery } : undefined
    }
    const holder = discovery.holder.characterId
    if (state.characters[holder]?.roomId == null) return undefined
    const prerequisites = stage!.preparation!.characters[holder] ?? []
    if (preparationProgress(prerequisites, state.discovered).ready) return { discovery }
    for (const dependency of missing(prerequisites, state)) {
      const target = accessible(dependency, seen)
      if (target !== undefined) return target
    }
    return undefined
  }
  for (const id of roots) {
    const recipient = stage.preparation.essentialCharacters.find((required) => required.discoveryIds.includes(id)
      && state.notes.some((note) => note.discoveryId === id) && state.discovered.includes(id)
      && !state.essentialConversations?.[stage.id]?.[required.characterId]?.includes(id)
      && state.characters[required.characterId]?.roomId != null
      && preparationProgress(stage.preparation!.characters[required.characterId] ?? [], state.discovered).ready)
    const discovery = spec.discoveries.find((candidate) => candidate.id === id)
    if (recipient !== undefined && discovery !== undefined) return { discovery, shareWith: recipient.characterId }
    const target = accessible(id, new Set())
    if (target !== undefined) return target
  }
  return undefined
}

export function preparationHintTarget(scope: Scope, characterId?: string, now?: number): SpecDiscovery | undefined {
  return preparationHintTask(scope, characterId, now)?.discovery
}

export function preparationHint(scope: Scope, characterId?: string, now?: number): string | null {
  const task = preparationHintTask(scope, characterId, now)
  if (task === undefined) return null
  const target = task.discovery
  const stage = scope.spec.stages[scope.state.stageIndex]!
  const roomName = (roomId: string | undefined | null) => stage.rooms.find((room) => room.id === roomId)?.name
  const holder = target.holder
  if (task.shareWith !== undefined) {
    const recipient = scope.spec.characters.find((candidate) => candidate.id === task.shareWith)
    const title = 'documentId' in holder ? scope.spec.documents.find((document) => document.id === holder.documentId)?.title : scope.spec.characters.find((character) => character.id === holder.characterId)?.name
    const room = roomName(scope.state.characters[task.shareWith]?.roomId)
    return recipient === undefined ? null : `Show your note from “${title ?? 'this source'}” to ${recipient.name}${room === undefined ? '' : ` in ${room}`}.`
  }
  if ('documentId' in holder) {
    const document = scope.spec.documents.find((candidate) => candidate.id === holder.documentId)
    if (document === undefined) return null
    const room = roomName(scope.state.documentRooms[document.id])
    return `Read “${document.title}”${room === undefined ? ' in your documents' : ` in ${room}`}${document.readingCheck === undefined ? ' and look for useful evidence' : ' and complete its reading check'}.`
  }
  const character = scope.spec.characters.find((candidate) => candidate.id === holder.characterId)
  if (character === undefined) return null
  const room = roomName(scope.state.characters[character.id]?.roomId)
  return `Speak with ${character.name}${room === undefined ? '' : ` in ${room}`} about the evidence you have collected.`
}
