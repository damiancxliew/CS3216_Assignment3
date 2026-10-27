import type { AdventureSpec, CheckIssue, Condition, SpecTrigger } from '../index.js'

function knownCondition(condition: Condition | undefined, known: Set<string>): boolean | null {
  if (!condition) return true
  if ('discovered' in condition) return known.has(condition.discovered) ? true : null
  if ('not' in condition) {
    const value = knownCondition(condition.not, known)
    return value === null ? null : !value
  }
  if ('all' in condition || 'any' in condition) {
    const all = 'all' in condition
    const values = (all ? condition.all : condition.any).map((part) => knownCondition(part, known))
    if (all && values.includes(false)) return false
    if (!all && values.includes(true)) return true
    return values.includes(null) ? null : all
  }
  return null
}

function competingEffects(first: SpecTrigger['effect'], second: SpecTrigger['effect']): boolean {
  if ('stanceDelta' in first && 'stanceDelta' in second) return first.stanceDelta !== second.stanceDelta
  if ('toStance' in first && 'toStance' in second) return first.toStance !== second.toStance
  // A relative change next to an absolute reset can expose only an intermediate stance.
  return true
}

/** Intermediate automatic stances are unavailable for conversation until the rule loop settles. */
export function automaticPreparationIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const reported = new Set<string>()
  const discoveryStage = new Map(spec.discoveries.map((discovery) => [discovery.id, spec.stages.findIndex((stage) => stage.id === discovery.stageId)]))
  spec.stages.forEach((stage, stageIndex) => {
    if (!stage.preparation) return
    const present = new Set([...Object.keys(stage.placement), ...stage.situations.flatMap((situation) => Object.keys(situation.placement ?? {}))])
    const automatic = spec.triggers.flatMap((trigger, index) => 'discovered' in trigger.on && present.has(trigger.characterId) && (discoveryStage.get(trigger.on.discovered) ?? Infinity) <= stageIndex ? [{ trigger, index, discoveryId: trigger.on.discovered }] : [])
    automatic.forEach((first, index) => automatic.slice(index + 1).forEach((second) => {
      if (first.trigger.characterId !== second.trigger.characterId || !competingEffects(first.trigger.effect, second.trigger.effect)) return
      const sameFact = first.discoveryId === second.discoveryId
      const alreadyKnown = (discoveryStage.get(first.discoveryId) ?? Infinity) < stageIndex && (discoveryStage.get(second.discoveryId) ?? Infinity) < stageIndex && !first.trigger.requires && !second.trigger.requires
      if (!sameFact && !alreadyKnown) return
      const known = new Set([first.discoveryId, second.discoveryId])
      if (knownCondition(first.trigger.requires, known) === false || knownCondition(second.trigger.requires, known) === false) return
      const key = `${first.index}:${second.index}`
      if (reported.has(key)) return
      reported.add(key)
      issues.push({ code: 'preparation', path: `triggers.${second.index}.effect`, message: `Automatic triggers '${first.trigger.id}' and '${second.trigger.id}' can settle together with competing stance changes in prepared stage '${stage.id}'. Use one automatic transition or an evidence-sharing action between them.` })
    }))
  })
  return issues
}
