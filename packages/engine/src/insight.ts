/**
 * Teacher-only state for the preview's edit panel: what each character's prompt carries right now. Never
 * part of the PlayerView, which must not reveal stances or undiscovered content to students.
 */
import { stanceIndex } from './conditions'
import { heldBackTopics, revealableFor } from './rules/knowledge'
import type { EngineSpec } from './spec'
import type { EngineState } from './state'

export interface CharacterInsight {
  stance: { label: string; demeanour: string } | null
  mayShare: string[]
  notYet: string[]
}

export interface PreviewInsight {
  characters: Record<string, CharacterInsight>
}

export function previewInsight(spec: EngineSpec, state: EngineState, now: number): PreviewInsight {
  return {
    characters: Object.fromEntries(spec.characters.map((character) => {
      const stance = character.stances[stanceIndex(spec, character.id, state.characters[character.id]?.stanceId ?? null)]
      return [character.id, {
        stance: stance ? { label: stance.label, demeanour: stance.demeanour } : null,
        mayShare: revealableFor(spec, state, character.id, now).map((discovery) => discovery.text),
        notYet: heldBackTopics(spec, state, character.id, now),
      }]
    })),
  }
}
