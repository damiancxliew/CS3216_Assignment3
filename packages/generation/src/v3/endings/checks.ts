/**
 * Per-call checks for the endings pass: structural (id sets, counts, wording) and
 * reachability (atoms may only reference what the student could reach by that moment).
 * Errors route back through the call's own repair loop; warnings are advisory.
 */
import type { AdventureSpec, CheckIssue } from '@adventure/spec-v3'

import type { Atom, EndingLlmOutput, MomentLlmOutput } from './schema'

const issue = (code: string, path: string, message: string): CheckIssue => ({ code, path, message })

export interface MomentContext {
  draft: AdventureSpec
  momentId: string
  /** teacher source document ids — must never appear in student-facing text */
  sourceIds: Set<string>
  /** stage index of the moment's stage */
  stageIndex: number
  /** characterId → stage indices the character is placed in (≤ moment's stage) */
  placedCharacters: Map<string, number[]>
  /** characters placed in this or an earlier stage (id → character) */
  reachableCharacters: Map<string, AdventureSpec['characters'][number]>
  /** discoveries of this or earlier stages */
  reachableDiscoveries: Map<string, AdventureSpec['discoveries'][number]>
  /** slantId → slant (across all reachable characters) */
  slants: Map<string, { characterId: string; contradictedBy: string[] }>
  /** earlier moments' outcome ids: `momentId` → Set of outcome ids */
  earlierOutcomes: Map<string, Set<string>>
}

export function buildMomentContext(draft: AdventureSpec, momentId: string, sourceIds: Set<string> = new Set()): MomentContext {
  const moment = draft.definingMoments.find((m) => m.id === momentId)!
  const stageIndex = draft.stages.findIndex((s) => s.id === moment.stageId)
  const placedCharacters = new Map<string, number[]>()
  draft.stages.forEach((stage, i) => {
    for (const characterId of Object.keys(stage.placement)) placedCharacters.set(characterId, [...(placedCharacters.get(characterId) ?? []), i])
  })
  const reachableCharacters = new Map(draft.characters.filter((c) => (placedCharacters.get(c.id) ?? []).some((i) => i <= stageIndex)).map((c) => [c.id, c]))
  const reachableDiscoveries = new Map(
    draft.discoveries.filter((d) => draft.stages.findIndex((s) => s.id === d.stageId) <= stageIndex).map((d) => [d.id, d]),
  )
  const slants = new Map<string, { characterId: string; contradictedBy: string[] }>()
  for (const c of reachableCharacters.values()) for (const s of c.slants) slants.set(s.id, { characterId: c.id, contradictedBy: s.contradictedBy })
  const earlierOutcomes = new Map<string, Set<string>>()
  for (const m of draft.definingMoments) {
    const mStage = draft.stages.findIndex((s) => s.id === m.stageId)
    if (mStage < stageIndex) earlierOutcomes.set(m.id, new Set(m.outcomes.map((o) => o.id)))
  }
  return { draft, momentId, stageIndex, placedCharacters, reachableCharacters, reachableDiscoveries, slants, earlierOutcomes, sourceIds }
}

/** student-facing text must contain no source ids and no page references. */
const PAGE_REF = /\bpp?\.\s?\d/i
export function citationInText(text: string, path: string, sourceIds: Set<string>): CheckIssue[] {
  const issues: CheckIssue[] = []
  for (const id of sourceIds) if (id !== '' && text.includes(id)) issues.push(issue('citation-in-text', path, `student-facing text contains the source id '${id}'`))
  if (PAGE_REF.test(text)) issues.push(issue('citation-in-text', path, `student-facing text contains a page reference '${text.match(PAGE_REF)![0]}'`))
  return issues
}

/** acts whose fallback rule (no `when`) points at an outcome with `secret: true`. */
export function secretActIds(moment: AdventureSpec['definingMoments'][number]): Set<string> {
  const secretOutcomes = new Set(moment.outcomes.filter((o) => o.secret === true).map((o) => o.id))
  const ids = new Set<string>()
  for (const rule of moment.rules) if (rule.when === undefined && secretOutcomes.has(rule.outcomeId)) ids.add(rule.actId)
  return ids
}

function atomIssues(atom: Atom, path: string, ctx: MomentContext): CheckIssue[] {
  const issues: CheckIssue[] = []
  const { stageIndex, placedCharacters, reachableCharacters, reachableDiscoveries, slants, earlierOutcomes, draft } = ctx
  switch (atom.kind) {
    case 'discovered': {
      const discovery = atom.discoveryId === null ? undefined : reachableDiscoveries.get(atom.discoveryId)
      if (discovery === undefined) issues.push(issue('ref', `${path}.discoveryId`, `discovery '${atom.discoveryId}' is not reachable by this moment`))
      break
    }
    case 'stanceAtLeast': {
      const character = atom.characterId === null ? undefined : reachableCharacters.get(atom.characterId)
      if (character === undefined) {
        issues.push(issue('ref', `${path}.characterId`, `character '${atom.characterId}' is not placed in this or an earlier stage`))
      } else if (atom.stanceId === null || !character.stances.some((s) => s.id === atom.stanceId)) {
        issues.push(issue('ref', `${path}.stanceId`, `stance '${atom.stanceId}' is not a stance of '${atom.characterId}'`))
      }
      break
    }
    case 'notePassed': {
      const discovery = atom.discoveryId === null ? undefined : reachableDiscoveries.get(atom.discoveryId)
      if (discovery === undefined) issues.push(issue('ref', `${path}.discoveryId`, `discovery '${atom.discoveryId}' is not reachable by this moment`))
      const character = atom.characterId === null ? undefined : draft.characters.find((c) => c.id === atom.characterId)
      if (character === undefined) issues.push(issue('ref', `${path}.characterId`, `character '${atom.characterId}' does not exist`))
      else if (character.tier !== 'major') issues.push(issue('ref', `${path}.characterId`, `notePassed needs a major character, not '${atom.characterId}'`))
      else if (!(placedCharacters.get(character.id) ?? []).some((i) => i <= stageIndex))
        issues.push(issue('ref', `${path}.characterId`, `character '${atom.characterId}' is not placed in this or an earlier stage`))
      break
    }
    case 'slantConfronted': {
      if (atom.slantId === null || !slants.has(atom.slantId)) issues.push(issue('ref', `${path}.slantId`, `slant '${atom.slantId}' is not a slant of a reachable character`))
      break
    }
    case 'outcome': {
      const outcomes = atom.momentId === null ? undefined : earlierOutcomes.get(atom.momentId)
      if (outcomes === undefined) issues.push(issue('ref', `${path}.momentId`, `moment '${atom.momentId}' is not an earlier moment`))
      else if (atom.outcomeId === null || !outcomes.has(atom.outcomeId)) issues.push(issue('ref', `${path}.outcomeId`, `outcome '${atom.outcomeId}' is not an outcome of moment '${atom.momentId}'`))
      break
    }
  }
  return issues
}

/** G6.1.2: what a secret-unlock condition may be. */
function unlockAtomIssues(atom: Atom, path: string, ctx: MomentContext): CheckIssue[] {
  const issues = atomIssues(atom, path, ctx)
  if (issues.length > 0) return issues
  const { draft, reachableDiscoveries, slants } = ctx
  switch (atom.kind) {
    case 'stanceAtLeast': {
      const character = draft.characters.find((c) => c.id === atom.characterId)!
      const top = character.stances.at(-1)
      if (top === undefined || top.id !== atom.stanceId || top.hidden !== true)
        issues.push(issue('secret-unlock', path, `stanceAtLeast must name '${character.id}'s hidden top stance`))
      break
    }
    case 'discovered': {
      const discovery = reachableDiscoveries.get(atom.discoveryId!)!
      if (discovery.core || discovery.condition === undefined)
        issues.push(issue('secret-unlock', path, `discovered must name a non-core discovery with a reveal condition ('${atom.discoveryId}' doesn't qualify)`))
      break
    }
    case 'slantConfronted': {
      const slant = slants.get(atom.slantId!)!
      const docHeld = slant.contradictedBy.some((id) => {
        const discovery = draft.discoveries.find((d) => d.id === id)
        return discovery !== undefined && 'documentId' in discovery.holder
      })
      if (!docHeld) issues.push(issue('secret-unlock', path, `slant '${atom.slantId}' has no document-held discovery contradicting it`))
      break
    }
    case 'notePassed':
      break
    case 'outcome':
      issues.push(issue('secret-unlock', path, 'an earlier outcome is not a valid secret-unlock condition'))
      break
  }
  return issues
}

export function momentIssues(output: MomentLlmOutput, ctx: MomentContext): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const errors: CheckIssue[] = []
  const warnings: CheckIssue[] = []
  const { draft, momentId } = ctx
  const moment = draft.definingMoments.find((m) => m.id === momentId)!

  // ids: exactly the moment's acts and outcomes
  const actIds = new Set(moment.acts.map((a) => a.id))
  const outcomeIds = new Set(moment.outcomes.map((o) => o.id))
  output.acts.forEach((a, i) => {
    if (!actIds.has(a.id)) errors.push(issue('ref', `acts.${i}.id`, `act '${a.id}' is not an act of this moment`))
  })
  for (const id of actIds) if (!output.acts.some((a) => a.id === id)) errors.push(issue('missing', 'acts', `act '${id}' has no entry`))
  output.outcomes.forEach((o, i) => {
    if (!outcomeIds.has(o.id)) errors.push(issue('ref', `outcomes.${i}.id`, `outcome '${o.id}' is not an outcome of this moment`))
  })
  for (const id of outcomeIds) if (!output.outcomes.some((o) => o.id === id)) errors.push(issue('missing', 'outcomes', `outcome '${id}' has no entry`))

  // text
  errors.push(...citationInText(output.nudge, 'nudge', ctx.sourceIds))
  errors.push(...citationInText(output.finalCallNarration, 'finalCallNarration', ctx.sourceIds))
  if (output.nudge.trim() === '') errors.push(issue('empty-field', 'nudge', 'nudge is empty'))
  if (output.finalCallNarration.trim() === '') errors.push(issue('empty-field', 'finalCallNarration', 'finalCallNarration is empty'))
  output.acts.forEach((a, i) => {
    if (a.reaction.trim() === '') errors.push(issue('empty-field', `acts.${i}.reaction`, `reaction for act '${a.id}' is empty`))
    errors.push(...citationInText(a.reaction, `acts.${i}.reaction`, ctx.sourceIds))
  })
  const predictionTexts = new Set<string>()
  output.outcomes.forEach((o, i) => {
    errors.push(...citationInText(o.predictionText, `outcomes.${i}.predictionText`, ctx.sourceIds))
    errors.push(...citationInText(o.because, `outcomes.${i}.because`, ctx.sourceIds))
    if (o.predictionText.trim() === '') errors.push(issue('empty-field', `outcomes.${i}.predictionText`, `predictionText for '${o.id}' is empty`))
    else {
      if (o.predictionText.trim().split(/\s+/).length > 12)
        errors.push(issue('prediction-long', `outcomes.${i}.predictionText`, `predictionText for '${o.id}' has more than 12 words`))
      const key = o.predictionText.trim().toLowerCase()
      if (predictionTexts.has(key)) errors.push(issue('prediction-duplicate', `outcomes.${i}.predictionText`, `predictionText '${o.predictionText}' is repeated within the moment`))
      predictionTexts.add(key)
    }
    if (o.because.trim() === '') errors.push(issue('empty-field', `outcomes.${i}.because`, `because for '${o.id}' is empty`))
  })

  // fallback outcome per act = the first unconditional rule (later ones are alternates)
  const fallback = new Map<string, string>()
  for (const r of moment.rules) if (r.when === undefined && !fallback.has(r.actId)) fallback.set(r.actId, r.outcomeId)
  const secretOutcomes = new Set(moment.outcomes.filter((o) => o.secret === true).map((o) => o.id))
  const historicalOutcomes = new Set(moment.outcomes.filter((o) => o.historical === true).map((o) => o.id))
  const hiddenStances = new Map<string, Set<string>>()
  for (const c of draft.characters) hiddenStances.set(c.id, new Set(c.stances.filter((s) => s.hidden === true).map((s) => s.id)))

  const rulesPerAct = new Map<string, number>()
  output.conditionalRules.forEach((rule, i) => {
    const at = `conditionalRules.${i}`
    if (!actIds.has(rule.actId)) errors.push(issue('ref', `${at}.actId`, `act '${rule.actId}' is not an act of this moment`))
    else rulesPerAct.set(rule.actId, (rulesPerAct.get(rule.actId) ?? 0) + 1)
    if (!outcomeIds.has(rule.outcomeId)) errors.push(issue('ref', `${at}.outcomeId`, `outcome '${rule.outcomeId}' is not an outcome of this moment`))
    else {
      if (secretOutcomes.has(rule.outcomeId)) errors.push(issue('ref', `${at}.outcomeId`, `a conditional rule may not target the secret outcome '${rule.outcomeId}'`))
      if (fallback.get(rule.actId) === rule.outcomeId) errors.push(issue('ref', `${at}.outcomeId`, `a conditional rule duplicates act '${rule.actId}'s fallback outcome`))
      if (historicalOutcomes.has(fallback.get(rule.actId) ?? '')) {
        // the historical act: never divert it via a hidden stance
        for (const [j, atom] of rule.when.entries()) {
          if (atom.kind === 'stanceAtLeast' && hiddenStances.get(atom.characterId ?? '')?.has(atom.stanceId ?? ''))
            errors.push(issue('historical-hidden', `${at}.when.${j}`, 'the historical path may not depend on reaching a hidden stance'))
        }
        // the historical act always leads to the historical outcome: no rule may divert it, positive or negated
        if (!historicalOutcomes.has(rule.outcomeId))
          errors.push(issue('historical-diverted', at, `conditional rule routes the historical act '${rule.actId}' away from the historical outcome`))
      }
    }
    if (rule.when.length < 1 || rule.when.length > 3) errors.push(issue('rule-when', `${at}.when`, `a conditional rule needs 1–3 conditions (has ${rule.when.length})`))
    rule.when.forEach((atom, j) => {
      if (atom.kind === 'discovered')
        errors.push(issue('rule-discovered', `${at}.when.${j}`, 'a conditional rule may not use discovered — what the student found only matters once it is passed on'))
      errors.push(...atomIssues(atom, `${at}.when.${j}`, ctx))
    })
  })
  for (const [actId, count] of rulesPerAct) if (count > 2) errors.push(issue('rule-count', 'conditionalRules', `act '${actId}' has ${count} conditional rules (≤2 allowed)`))
  // G6: an outcome depends on the act *and* on stances and what characters were told. With no conditional rule,
  // every act maps to one outcome whatever the student did during the stage.
  // A warning for now (test fixtures still have unconditional moments); consider an error once they're updated.
  if (output.conditionalRules.length === 0)
    warnings.push(issue('rules-unconditional', 'conditionalRules', 'write at least one conditional rule: the outcome must depend on stances or notes passed on, not only on the act (G6)'))

  // secret unlock
  const secret = secretActIds(moment)
  if (secret.size === 0) {
    if (output.secretUnlock !== null) errors.push(issue('secret-unlock', 'secretUnlock', 'this moment has no secret act; secretUnlock must be null'))
  } else {
    const unlock = output.secretUnlock
    if (unlock === null) errors.push(issue('secret-unlock', 'secretUnlock', 'this moment has a secret act; secretUnlock is required'))
    else {
      if (!secret.has(unlock.actId)) errors.push(issue('secret-unlock', 'secretUnlock.actId', `act '${unlock.actId}' is not the secret act`))
      if (unlock.conditions.length < 2 || unlock.conditions.length > 3)
        errors.push(issue('secret-unlock', 'secretUnlock.conditions', `a secret unlock needs 2–3 conditions (has ${unlock.conditions.length})`))
      if (new Set(unlock.conditions.map((a) => a.kind)).size !== unlock.conditions.length)
        errors.push(issue('secret-unlock', 'secretUnlock.conditions', 'unlock conditions must use different kinds'))
      if (unlock.minMet < 2 || unlock.minMet > unlock.conditions.length)
        errors.push(issue('secret-unlock', 'secretUnlock.minMet', `minMet must be between 2 and the number of conditions (${unlock.minMet} of ${unlock.conditions.length})`))
      unlock.conditions.forEach((atom, j) => errors.push(...unlockAtomIssues(atom, `secretUnlock.conditions.${j}`, ctx)))
    }
  }
  return { errors, warnings }
}

export function endingIssues(output: EndingLlmOutput, draft: AdventureSpec, endingId: string, sourceIds: Set<string> = new Set()): { errors: CheckIssue[]; warnings: CheckIssue[] } {
  const errors: CheckIssue[] = []
  const discoveryById = new Map(draft.discoveries.map((d) => [d.id, d]))
  const documentIds = new Set(draft.documents.map((d) => d.id))

  if (!output.epilogue.trim().startsWith('Your simulation:'))
    errors.push(issue('epilogue', 'epilogue', `epilogue must start with "Your simulation:"`))
  errors.push(...citationInText(output.epilogue, 'epilogue', sourceIds))
  errors.push(...citationInText(output.question, 'question', sourceIds))
  errors.push(...citationInText(output.generalCounter, 'generalCounter', sourceIds))
  if (output.interviewer.trim() === '') errors.push(issue('empty-field', 'interviewer', 'interviewer is empty'))
  else if (draft.characters.some((c) => output.interviewer.toLowerCase().includes(c.name.toLowerCase())))
    errors.push(issue('interviewer-character', 'interviewer', 'the interviewer must not be a character the student met'))
  if (output.question.trim() === '') errors.push(issue('empty-field', 'question', 'question is empty'))
  if (output.generalCounter.trim() === '') errors.push(issue('empty-field', 'generalCounter', 'generalCounter is empty'))

  if (output.verdicts.length !== 3) errors.push(issue('verdict-count', 'verdicts', `expected exactly 3 verdicts, got ${output.verdicts.length}`))
  const seen = new Set<string>()
  output.verdicts.forEach((verdict, i) => {
    if (verdict.text.trim() === '') errors.push(issue('empty-field', `verdicts.${i}.text`, `verdict ${i + 1} text is empty`))
    errors.push(...citationInText(verdict.text, `verdicts.${i}.text`, sourceIds))
    const key = verdict.text.trim().toLowerCase()
    if (seen.has(key)) errors.push(issue('verdict-duplicate', `verdicts.${i}.text`, 'verdict texts must be distinct'))
    seen.add(key)
    if (verdict.counterPoints.length < 1 || verdict.counterPoints.length > 3)
      errors.push(issue('counter-count', `verdicts.${i}.counterPoints`, `verdict needs 1–3 counterPoints (has ${verdict.counterPoints.length})`))
    let hasCore = false
    verdict.counterPoints.forEach((id, j) => {
      if (documentIds.has(id)) errors.push(issue('ref', `verdicts.${i}.counterPoints.${j}`, `counterPoint '${id}' is a document id — the push-back only reads discovery ids`))
      else if (!discoveryById.has(id)) errors.push(issue('ref', `verdicts.${i}.counterPoints.${j}`, `counterPoint '${id}' is not a discovery`))
      else if (discoveryById.get(id)!.core) hasCore = true
    })
    if (verdict.counterPoints.length > 0 && !hasCore)
      errors.push(issue('counter-core', `verdicts.${i}.counterPoints`, `verdict ${i + 1} has no core discovery among its counterPoints`))
  })
  return { errors, warnings: [] }
}
