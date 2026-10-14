/**
 * Discoveries become notes [G5, P7, P8]. A discovery is revealable only when its holder is the character
 * being spoken to (or its key passage is selected), it belongs to the current stage, it isn't known yet and
 * its condition holds. Nothing else ever creates a note: not message text, not reading, not a hint.
 */
import { evaluate } from '../conditions'
import { currentStage, type StepContext } from '../context'
import type { SpecDiscovery } from '../spec'
import type { EngineState } from '../state'
import type { EngineSpec } from '../spec'

export function revealableFor(spec: EngineSpec, state: EngineState, characterId: string, now: number): SpecDiscovery[] {
  const stageId = spec.stages[state.stageIndex]?.id
  return spec.discoveries.filter(
    (discovery) =>
      'characterId' in discovery.holder &&
      discovery.holder.characterId === characterId &&
      discovery.stageId === stageId &&
      !state.discovered.includes(discovery.id) &&
      evaluate(discovery.condition, { spec, state, now }),
  )
}

/** Topics this character holds but may not discuss yet: only the topic phrase, never the content. */
export function heldBackTopics(spec: EngineSpec, state: EngineState, characterId: string, now: number): string[] {
  const stageId = spec.stages[state.stageIndex]?.id
  return spec.discoveries
    .filter(
      (discovery) =>
        'characterId' in discovery.holder &&
        discovery.holder.characterId === characterId &&
        discovery.stageId === stageId &&
        !state.discovered.includes(discovery.id) &&
        !evaluate(discovery.condition, { spec, state, now }) &&
        discovery.topic !== undefined,
    )
    .map((discovery) => discovery.topic as string)
}

export function noteText(spec: EngineSpec, discoveryId: string): string {
  return spec.discoveries.find((discovery) => discovery.id === discoveryId)?.note ?? ''
}

export function studentNoteTexts(spec: EngineSpec, state: EngineState): string[] {
  return state.notes.map((note) => noteText(spec, note.discoveryId))
}

export function markProgress(ctx: StepContext): void {
  ctx.state.hints.lastProgressAt = ctx.now
  ctx.state.hints.level = 0
}

/** Record a discovery as a note. Idempotent: a known discovery is never noted twice. */
export function grantDiscovery(ctx: StepContext, discovery: SpecDiscovery, via: 'conversation' | 'passage' | 'slant'): boolean {
  const { state } = ctx
  if (state.discovered.includes(discovery.id)) return false
  state.discovered.push(discovery.id)
  const noteId = ctx.nextId('n')
  state.notes.push({ id: noteId, discoveryId: discovery.id, source: via === 'passage' ? 'document' : 'conversation', stageIndex: state.stageIndex, at: ctx.now })
  ctx.emit({ type: 'discovery', discoveryId: discovery.id, noteId, core: discovery.core, via })
  markProgress(ctx)
  ctx.touch()
  return true
}

export function missingCore(ctx: StepContext): SpecDiscovery[] {
  const stageId = currentStage(ctx).id
  return ctx.spec.discoveries.filter((discovery) => discovery.stageId === stageId && discovery.core && !ctx.state.discovered.includes(discovery.id))
}
