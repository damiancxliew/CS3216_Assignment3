/**
 * Rule 4: every `core` discovery must be reachable in its own stage, under an optimistic static
 * fixpoint (assume whatever could fire does fire). Secret routes (hidden stances) are excluded (G15).
 * `core-missing` and `core-holder` are skeleton rules and live in `skeleton.ts`.
 *
 * Codes: `core-unreachable`.
 */
import type { AdventureSpec, CheckIssue, Condition } from '../index.js'
import { preparationProgress } from '../preparation.js'

export function coreIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message })

  const characterById = new Map(spec.characters.map((c) => [c.id, c]))
  const documentById = new Map(spec.documents.map((d) => [d.id, d]))
  const discoveryIndex = new Map(spec.discoveries.map((d, i) => [d.id, i]))
  const stageOrderOf = (id: string) => spec.stages.findIndex(stage => stage.id === id)
  const momentStageIndex = new Map<string, number>()
  spec.stages.forEach((stage, i) => momentStageIndex.set(stage.definingMomentId, i))
  /** discoveries only available once some slant is confronted */
  const lockedBy = new Map<string, string>()
  for (const character of spec.characters)
    for (const slant of character.slants) if (slant.unlocksDiscoveryId !== undefined) lockedBy.set(slant.unlocksDiscoveryId, slant.id)

  const previousReachable = new Set<string>()
  const guaranteed = new Set<string>()
  const carriedStances = new Map<string, string>()
  const spentTriggers = new Set<string>()
  spec.stages.forEach((stage, stageIndex) => {
    const requiredBeforeDeparture = new Set(guaranteed)
    for (const essential of stage.preparation?.essentialCharacters ?? []) {
      for (const id of essential.discoveryIds) requiredBeforeDeparture.add(id)
      for (const group of stage.preparation!.characters[essential.characterId] ?? []) {
        if (group.minMet === group.discoveryIds.length) for (const id of group.discoveryIds) requiredBeforeDeparture.add(id)
      }
    }
    const scenarioFindings: Set<string>[] = []
    const scenarioStances: Map<string, string>[] = []
    const stageSpent = new Set<string>()
    for (const situation of [undefined, ...stage.situations]) {
      const stageDiscoveries = spec.discoveries.filter(d => d.stageId === stage.id || 'documentId' in d.holder && stage.documentPlacement[d.holder.documentId] !== undefined && (stageOrderOf(d.stageId) < stageIndex))
      const present = new Set(Object.keys({ ...stage.placement, ...situation?.placement }))
      const available = new Set(Object.keys({ ...stage.documentPlacement, ...situation?.documentPlacement }))
      const reachableStances = new Map<string, Set<string>>()
      const entryStances = new Map<string, string>()
      const stancePaths = new Map<string, { id: string; used: string[] }[]>()
      for (const characterId of present) {
        const character = characterById.get(characterId)
        if (character?.tier === 'major' && character.initialStanceId !== null) {
          const initial = character.stances.find((s) => s.id === (situation?.stances?.[characterId] ?? carriedStances.get(characterId) ?? character.initialStanceId))
          if (initial !== undefined && initial.hidden !== true) {
            entryStances.set(characterId, initial.id)
            reachableStances.set(characterId, new Set([initial.id]))
            stancePaths.set(characterId, [{ id: initial.id, used: [...spentTriggers] }])
          }
        }
      }
      const found = new Set(stage.preparation ? guaranteed : previousReachable)
      const confronted = new Set<string>()

      const stanceIndex = (characterId: string, stanceId: string) =>
        characterById.get(characterId)?.stances.findIndex((s) => s.id === stanceId) ?? -1
      const stanceReachable = (characterId: string, stanceId: string) => reachableStances.get(characterId)?.has(stanceId) === true

      const satisfiable = (value: Condition | undefined, self?: { characterId: string; stanceId: string }): boolean => {
        if (value === undefined) return true
        if ('all' in value) return value.all.every(part => satisfiable(part, self))
        if ('any' in value) return value.any.some(part => satisfiable(part, self))
        if ('not' in value) return true
        if ('discovered' in value) return found.has(value.discovered)
        if ('stanceAtLeast' in value) {
          const { characterId, stanceId } = value.stanceAtLeast
          const target = stanceIndex(characterId, stanceId)
          if (target < 0) return false
          if (self?.characterId === characterId) return stanceIndex(characterId, self.stanceId) >= target
          return [...(reachableStances.get(characterId) ?? [])].some((id) => stanceIndex(characterId, id) >= target)
        }
        if ('stanceIs' in value) return self?.characterId === value.stanceIs.characterId ? self.stanceId === value.stanceIs.stanceId : stanceReachable(value.stanceIs.characterId, value.stanceIs.stanceId)
        if ('notePassed' in value) return found.has(value.notePassed.discoveryId) && present.has(value.notePassed.characterId) && preparationProgress(stage.preparation?.characters[value.notePassed.characterId] ?? [], [...found]).ready
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

      const addStance = (characterId: string, index: number, used: string[]): boolean => {
        const character = characterById.get(characterId)
        if (character === undefined) return false
        const clamped = Math.max(0, Math.min(index, character.stances.length - 1))
        const stance = character.stances[clamped]
        if (stance === undefined || stance.hidden === true) return false // G15: hidden stances never reachable
        const paths = stancePaths.get(characterId) ?? []
        if (paths.some(path => path.id === stance.id && path.used.every(id => used.includes(id)))) return false
        if (paths.length >= 1024) {
          add('reachability-budget', `stages.${stageIndex}.id`, 'Simplify stance dependencies so reachability can be checked within its limit.')
          return false
        }
        // A route consuming fewer one-shot triggers dominates a route to the same stance.
        stancePaths.set(characterId, [...paths.filter(path => path.id !== stance.id || !used.every(id => path.used.includes(id))), { id: stance.id, used }])
        const set = reachableStances.get(characterId) ?? new Set<string>()
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
          const heldDocument = 'documentId' in holder ? documentById.get(holder.documentId) : undefined
          const holderOk =
            'characterId' in holder
              ? present.has(holder.characterId) && preparationProgress(stage.preparation?.characters[holder.characterId] ?? [], [...found]).ready
              : available.has(holder.documentId) &&
                heldDocument?.keyPassages.some((p) => p.id === holder.keyPassageId) === true &&
                (heldDocument.readingCheck === undefined || heldDocument.readingCheck.discoveryId === discovery.id || found.has(heldDocument.readingCheck.discoveryId))
          if (holderOk && satisfiable(discovery.condition)) {
            found.add(discovery.id)
            changed = true
          }
        }
        // slants confronted by what we hold
        for (const characterId of present) {
          if (!preparationProgress(stage.preparation?.characters[characterId] ?? [], [...found]).ready) continue
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
              ? found.has(trigger.on.notePassed) && preparationProgress(stage.preparation?.characters[trigger.characterId] ?? [], [...found]).ready
              : 'discovered' in trigger.on
                ? found.has(trigger.on.discovered)
                : confronted.has(trigger.on.slantConfronted)
          if (!onOk) continue
          const routes = [...(stancePaths.get(trigger.characterId) ?? [])].filter(path => !path.used.includes(trigger.id) && satisfiable(trigger.requires, { characterId: trigger.characterId, stanceId: path.id }))
          if (!routes.length) continue
          stageSpent.add(trigger.id)
          for (const route of routes) {
            const target = 'toStance' in trigger.effect ? stanceIndex(trigger.characterId, trigger.effect.toStance) : stanceIndex(trigger.characterId, route.id) + trigger.effect.stanceDelta
            if (target >= 0 && addStance(trigger.characterId, target, [...route.used, trigger.id])) changed = true
          }
          for (const id of trigger.handsOver ?? [])
            if (!available.has(id)) {
              available.add(id)
              changed = true
            }
        }
        for (const event of spec.storyEvents) {
          if (event.stageId !== stage.id || event.effect !== 'deliverDocument' || 'timerOut' in event.when) continue
          if ('condition' in event.when && !satisfiable(event.when.condition)) continue
          if (!available.has(event.documentId)) { available.add(event.documentId); changed = true }
        }
      }

      for (const discovery of stageDiscoveries) {
        if (!discovery.core) continue
        const i = discoveryIndex.get(discovery.id) ?? 0
        if (!found.has(discovery.id))
          add('core-unreachable', `discoveries.${i}.id`, `core discovery '${discovery.id}' is not reachable in stage '${stage.id}'`)
      }
      if (stage.preparation) {
        const at = `stages.${stageIndex}.preparation`
        for (const [id, groups] of Object.entries(stage.preparation.characters)) {
          if (!preparationProgress(groups, [...found]).ready)
            add('preparation-unreachable', `${at}.characters.${id}`, `Preparation for '${id}' is unreachable in a stage situation.`)
        }
        if (!preparationProgress(stage.preparation.decision, [...found]).ready)
          add('preparation-unreachable', `${at}.decision`, 'Decision preparation is unreachable without the timer override.')
        if (!stage.preparation.decision.some(group => group.discoveryIds.filter(id => found.has(id)).length > group.minMet))
          add('preparation-unreachable', `${at}.decision`, 'Provide a reachable spare route for decision preparation in every situation.')
        for (const [i, essential] of stage.preparation.essentialCharacters.entries()) {
          if (!essential.discoveryIds.every(id => found.has(id)))
            add('preparation-unreachable', `${at}.essentialCharacters.${i}`, `An essential exchange with '${essential.characterId}' is unreachable.`)
        }
        for (const [i, doc] of spec.documents.entries()) {
          if (doc.readingCheck && available.has(doc.id) && !found.has(doc.readingCheck.discoveryId))
            add('preparation-unreachable', `documents.${i}.readingCheck.discoveryId`, 'The checked discovery cannot be earned from this scroll.')
        }
      }
      scenarioFindings.push(found)
      // Optional earlier exploration cannot be assumed at a later mandatory conversation.
      // Carry the entry stance plus automatic changes backed by guaranteed facts only.
      const terminalStances = new Map(entryStances)
      const forced = new Set(spentTriggers)
      const guaranteedCondition = (condition: Condition | undefined): boolean => {
        if (!condition) return true
        if ('all' in condition) return condition.all.every(guaranteedCondition)
        if ('any' in condition) return condition.any.some(guaranteedCondition)
        if ('discovered' in condition) return requiredBeforeDeparture.has(condition.discovered)
        if ('stanceAtLeast' in condition) return stanceIndex(condition.stanceAtLeast.characterId, terminalStances.get(condition.stanceAtLeast.characterId) ?? '') >= stanceIndex(condition.stanceAtLeast.characterId, condition.stanceAtLeast.stanceId)
        if ('stanceIs' in condition) return terminalStances.get(condition.stanceIs.characterId) === condition.stanceIs.stanceId
        return false
      }
      for (let round = 0; round <= spec.triggers.length; round++) {
        let fired = false
        for (const trigger of spec.triggers) {
          if (forced.has(trigger.id) || !('discovered' in trigger.on) || !requiredBeforeDeparture.has(trigger.on.discovered) || !guaranteedCondition(trigger.requires)) continue
          const character = characterById.get(trigger.characterId), current = terminalStances.get(trigger.characterId)
          if (!character || current === undefined) continue
          forced.add(trigger.id)
          fired = true
          const effect = trigger.effect
          const target = 'toStance' in effect ? character.stances.find(s => s.id === effect.toStance) : character.stances[stanceIndex(character.id, current) + effect.stanceDelta]
          if (target && !target.hidden) terminalStances.set(character.id, target.id)
        }
        if (!fired) break
      }
      scenarioStances.push(terminalStances)
    }
    // Later stages may rely only on discoveries available in every authored situation.
    for (const id of scenarioFindings[0] ?? []) if (scenarioFindings.every(found => found.has(id))) previousReachable.add(id)
    for (const id of stageSpent) spentTriggers.add(id)
    for (const character of spec.characters) {
      const possibilities = scenarioStances.map(values => values.get(character.id) ?? carriedStances.get(character.id) ?? character.initialStanceId).filter((id): id is string => id != null)
      const conservative = possibilities.sort((a, b) => character.stances.findIndex(s => s.id === a) - character.stances.findIndex(s => s.id === b))[0]
      if (conservative) carriedStances.set(character.id, conservative)
    }
    // The timer can waive decision evidence. Only essential exchanges and their all-of
    // prerequisites are guaranteed to survive every legal departure from a prepared stage.
    for (const id of requiredBeforeDeparture) guaranteed.add(id)
  })

  return issues.filter((issue, index) => issues.findIndex(other => other.code === issue.code && other.path === issue.path && other.message === issue.message) === index)
}
