/**
 * Rule 4: every `core` discovery must be reachable in its own stage, under an optimistic static
 * fixpoint (assume whatever could fire does fire). Secret routes (hidden stances) are excluded (G15).
 *
 * Codes: `core-unreachable`, `core-holder`, `core-missing`.
 */
import type { AdventureSpec, CheckIssue, Condition } from '../index.js'

export function coreIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })

  const characterById = new Map(spec.characters.map((c) => [c.id, c]))
  const documentById = new Map(spec.documents.map((d) => [d.id, d]))
  const discoveryIndex = new Map(spec.discoveries.map((d, i) => [d.id, i]))
  const momentStageIndex = new Map<string, number>()
  spec.stages.forEach((stage, i) => momentStageIndex.set(stage.definingMomentId, i))
  /** discoveries only available once some slant is confronted */
  const lockedBy = new Map<string, string>()
  for (const character of spec.characters)
    for (const slant of character.slants) if (slant.unlocksDiscoveryId !== undefined) lockedBy.set(slant.unlocksDiscoveryId, slant.id)

  spec.stages.forEach((stage, stageIndex) => {
    const at = `stages.${stageIndex}`
    const stageDiscoveries = spec.discoveries.filter((d) => d.stageId === stage.id)
    if (!stageDiscoveries.some((d) => d.core))
      add('core-missing', `${at}.id`, `stage '${stage.id}' has no core discovery`)

    const present = new Set<string>([
      ...Object.keys(stage.placement),
      ...stage.situations.flatMap((s) => Object.keys(s.placement ?? {})),
    ])
    const available = new Set<string>([
      ...Object.keys(stage.documentPlacement),
      ...stage.situations.flatMap((s) => Object.keys(s.documentPlacement ?? {})),
    ])
    const reachableStances = new Map<string, Set<string>>()
    for (const characterId of present) {
      const character = characterById.get(characterId)
      if (character?.tier === 'major' && character.initialStanceId !== null) {
        const initial = character.stances.find((s) => s.id === character.initialStanceId)
        if (initial !== undefined && initial.hidden !== true) reachableStances.set(characterId, new Set([initial.id]))
      }
    }
    const found = new Set<string>()
    const confronted = new Set<string>()

    const stanceIndex = (characterId: string, stanceId: string) =>
      characterById.get(characterId)?.stances.findIndex((s) => s.id === stanceId) ?? -1
    const stanceReachable = (characterId: string, stanceId: string) => reachableStances.get(characterId)?.has(stanceId) === true

    const satisfiable = (value: Condition | undefined): boolean => {
      if (value === undefined) return true
      if ('all' in value) return value.all.every(satisfiable)
      if ('any' in value) return value.any.some(satisfiable)
      if ('not' in value) return true
      if ('discovered' in value) return found.has(value.discovered)
      if ('stanceAtLeast' in value) {
        const { characterId, stanceId } = value.stanceAtLeast
        const target = stanceIndex(characterId, stanceId)
        if (target < 0) return false
        return [...(reachableStances.get(characterId) ?? [])].some((id) => stanceIndex(characterId, id) >= target)
      }
      if ('stanceIs' in value) return stanceReachable(value.stanceIs.characterId, value.stanceIs.stanceId)
      if ('notePassed' in value) return found.has(value.notePassed.discoveryId) && present.has(value.notePassed.characterId)
      if ('slantConfronted' in value) return confronted.has(value.slantConfronted)
      if ('act' in value || 'outcome' in value) {
        const momentId = 'act' in value ? value.act.momentId : value.outcome.momentId
        const owner = momentStageIndex.get(momentId)
        return owner !== undefined && owner < stageIndex
      }
      if ('inRoom' in value) return stage.rooms.some((r) => r.id === value.inRoom)
      if ('elapsedAtLeast' in value) return true
      return false
    }

    const addStance = (characterId: string, index: number): boolean => {
      const character = characterById.get(characterId)
      if (character === undefined) return false
      const clamped = Math.max(0, Math.min(index, character.stances.length - 1))
      const stance = character.stances[clamped]
      if (stance === undefined || stance.hidden === true) return false // G15: hidden stances never reachable
      const set = reachableStances.get(characterId) ?? new Set<string>()
      if (set.has(stance.id)) return false
      set.add(stance.id)
      reachableStances.set(characterId, set)
      return true
    }

    let changed = true
    while (changed) {
      changed = false
      // discoveries
      for (const discovery of stageDiscoveries) {
        if (found.has(discovery.id)) continue
        const lockedBySlant = lockedBy.get(discovery.id)
        if (lockedBySlant !== undefined && !confronted.has(lockedBySlant)) continue
        const holder = discovery.holder
        const holderOk =
          'characterId' in holder
            ? present.has(holder.characterId)
            : available.has(holder.documentId) &&
              documentById.get(holder.documentId)?.keyPassages.some((p) => p.id === holder.keyPassageId) === true
        if (holderOk && satisfiable(discovery.condition)) {
          found.add(discovery.id)
          changed = true
        }
      }
      // slants confronted by what we hold
      for (const characterId of present) {
        const character = characterById.get(characterId)
        for (const slant of character?.slants ?? []) {
          if (!confronted.has(slant.id) && slant.contradictedBy.some((id) => found.has(id))) {
            confronted.add(slant.id)
            changed = true
          }
        }
      }
      // triggers of present major characters
      for (const trigger of spec.triggers) {
        const character = characterById.get(trigger.characterId)
        if (character?.tier !== 'major' || !present.has(trigger.characterId)) continue
        const onOk =
          'notePassed' in trigger.on
            ? found.has(trigger.on.notePassed)
            : 'discovered' in trigger.on
              ? found.has(trigger.on.discovered)
              : confronted.has(trigger.on.slantConfronted)
        if (!onOk || !satisfiable(trigger.requires)) continue
        if ('toStance' in trigger.effect) {
          const index = stanceIndex(trigger.characterId, trigger.effect.toStance)
          if (index >= 0 && addStance(trigger.characterId, index)) changed = true
        } else {
          for (const id of reachableStances.get(trigger.characterId) ?? [])
            if (addStance(trigger.characterId, stanceIndex(trigger.characterId, id) + trigger.effect.stanceDelta)) changed = true
        }
        for (const id of trigger.handsOver ?? [])
          if (!available.has(id)) {
            available.add(id)
            changed = true
          }
      }
    }

    for (const discovery of stageDiscoveries) {
      if (!discovery.core) continue
      const i = discoveryIndex.get(discovery.id) ?? 0
      if ('characterId' in discovery.holder && characterById.get(discovery.holder.characterId)?.tier !== 'major')
        add('core-holder', `discoveries.${i}.holder`, `core discovery '${discovery.id}' is held by a non-major character`)
      if (!found.has(discovery.id))
        add('core-unreachable', `discoveries.${i}.id`, `core discovery '${discovery.id}' is not reachable in stage '${stage.id}'`)
    }
  })

  return issues
}
