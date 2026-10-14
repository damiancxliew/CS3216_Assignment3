/**
 * Orchestrates the details pass: stage calls + persona calls + one minors call run concurrently,
 * then the link call, then merge → validateSpec/checkSpec → one routed repair round.
 */
import { checkSpec, validateSpec } from '@adventure/spec-v3'
import type { AdventureSpec, CheckIssue, SkeletonShape } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'
import { generateMinors, generatePersona, generateStageDetails, linkDetails } from './calls'
import type { CallResult, DetailCallMetrics, DetailCallOptions, DetailsShared } from './calls'
import type { LinkContext } from './checks'
import { mergeDetails } from './merge'
import type { LinkLlmOutput, MinorsLlmOutput, PersonaLlmOutput, StageDetailsLlmOutput } from './schema'

export interface GenerateDetailsInput {
  skeleton: SkeletonShape
  documents: ExtractedDocument[]
  readingLevel?: 'sec' | 'jc'
}

export interface GenerateDetailsOptions extends DetailCallOptions {
  linkModel?: string
  linkReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | null
}

export interface DetailsResult {
  ok: boolean
  draft?: AdventureSpec
  issues: CheckIssue[]
  warnings: CheckIssue[]
  slantedDocuments: { stageId: string; documentId: string; note: string }[]
  pendingPasses: string[]
  metrics: { calls: DetailCallMetrics[]; totalCostUsd: number }
}

type AnyCall = CallResult<unknown>

interface CallBag {
  stage: Map<string, CallResult<StageDetailsLlmOutput>>
  persona: Map<string, CallResult<PersonaLlmOutput>>
  minors: CallResult<MinorsLlmOutput> | null
  link: CallResult<LinkLlmOutput> | null
}

export async function generateDetails(input: GenerateDetailsInput, opts: GenerateDetailsOptions): Promise<DetailsResult> {
  const shared: DetailsShared = {
    skeleton: input.skeleton,
    documents: input.documents,
    readingLevel: input.readingLevel ?? input.skeleton.readingLevel,
  }
  const skeleton = input.skeleton
  const calls: DetailCallMetrics[] = []
  const warnings: CheckIssue[] = []
  const issues: CheckIssue[] = []
  const collect = (result: CallResult<unknown>) => {
    calls.push(...result.calls)
    warnings.push(...result.warnings)
    issues.push(...result.issues)
  }
  const totalCost = () => calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0)

  // --- stages + personas + minors concurrently -------------------------------------------------
  const majors = skeleton.characters.filter((c) => c.tier === 'major')
  const hasMinors = skeleton.characters.some((c) => c.tier === 'minor')
  const [stageResults, personaResults, minorsResult] = await Promise.all([
    Promise.all(skeleton.stages.map((s) => generateStageDetails(s.id, shared, opts))),
    Promise.all(majors.map((c) => generatePersona(c.id, shared, opts))),
    hasMinors ? generateMinors(shared, opts) : Promise.resolve(null),
  ])
  stageResults.forEach(collect)
  personaResults.forEach(collect)
  if (minorsResult !== null) collect(minorsResult)

  const bag: CallBag = {
    stage: new Map(skeleton.stages.map((s, i) => [s.id, stageResults[i]!])),
    persona: new Map(majors.map((c, i) => [c.id, personaResults[i]!])),
    minors: minorsResult,
    link: null,
  }
  const missingOutput = [...bag.stage.values(), ...bag.persona.values(), ...(bag.minors !== null ? [bag.minors] : [])].some((r) => r.output === undefined)
  if (issues.length > 0 || missingOutput)
    return { ok: false, issues, warnings, slantedDocuments: [], pendingPasses: [], metrics: { calls, totalCostUsd: totalCost() } }

  // --- link -------------------------------------------------------------------------------------
  const linkModel = opts.linkModel ?? opts.model
  const linkEffort = opts.linkReasoningEffort ?? opts.reasoningEffort
  const linkOpts: DetailCallOptions = {
    llm: opts.llm,
    ...(linkModel !== undefined ? { model: linkModel } : {}),
    ...(linkEffort !== undefined ? { reasoningEffort: linkEffort } : {}),
    ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  }
  bag.link = await linkDetails(buildLinkContext(skeleton, bag), shared, linkOpts)
  collect(bag.link)
  if (bag.link.output === undefined || bag.link.issues.length > 0)
    return { ok: false, issues, warnings, slantedDocuments: [], pendingPasses: [], metrics: { calls, totalCostUsd: totalCost() } }

  // --- merge + check ----------------------------------------------------------------------------
  const merged = mergeAndCheck(skeleton, bag)
  warnings.push(...merged.warnings)
  const remaining = merged.errors

  // --- one routed repair round -------------------------------------------------------------------
  if (remaining.length > 0) {
    const routed = new Map<AnyCall, CheckIssue[]>()
    for (const issue of remaining) {
      const owner = routeIssue(issue, merged.draft, bag, skeleton)
      if (owner === null) issues.push(issue)
      else routed.set(owner, [...(routed.get(owner) ?? []), issue])
    }
    const repairs = await Promise.all([...routed.entries()].map(([result, its]) => result.rerun(its)))
    for (const repair of repairs) {
      warnings.push(...repair.warnings)
      issues.push(...repair.issues)
      if (repair.output === undefined) continue
      // fold the repaired output back into the owning call
      for (const [id, result] of bag.stage) if (result === repair || result.calls === repair.calls) bag.stage.get(id)!.output = repair.output as StageDetailsLlmOutput
      for (const [id, result] of bag.persona) if (result === repair || result.calls === repair.calls) bag.persona.get(id)!.output = repair.output as PersonaLlmOutput
      if (bag.minors !== null && (bag.minors === repair || bag.minors.calls === repair.calls)) bag.minors.output = repair.output as MinorsLlmOutput
      if (bag.link === repair || bag.link?.calls === repair.calls) bag.link!.output = repair.output as LinkLlmOutput
    }
    if ([...bag.stage.values(), ...bag.persona.values(), ...(bag.minors !== null ? [bag.minors] : [])].every((r) => r.output !== undefined)) {
      bag.link = await linkDetails(buildLinkContext(skeleton, bag), shared, linkOpts)
      collect(bag.link)
      if (bag.link.output !== undefined && bag.link.issues.length === 0) {
        const remerged = mergeAndCheck(skeleton, bag)
        warnings.push(...remerged.warnings)
        issues.push(...remerged.errors)
        if (issues.length === 0)
          return { ok: true, draft: remerged.draft, issues, warnings, slantedDocuments: remerged.slantedDocuments, pendingPasses: ['endings', 'reveal'], metrics: { calls, totalCostUsd: totalCost() } }
        return { ok: false, draft: remerged.draft, issues, warnings, slantedDocuments: remerged.slantedDocuments, pendingPasses: [], metrics: { calls, totalCostUsd: totalCost() } }
      }
    }
    return { ok: false, draft: merged.draft, issues, warnings, slantedDocuments: merged.slantedDocuments, pendingPasses: [], metrics: { calls, totalCostUsd: totalCost() } }
  }

  return { ok: true, draft: merged.draft, issues, warnings, slantedDocuments: merged.slantedDocuments, pendingPasses: ['endings', 'reveal'], metrics: { calls, totalCostUsd: totalCost() } }
}

function mergeAndCheck(skeleton: SkeletonShape, bag: CallBag) {
  const merged = mergeDetails(skeleton, {
    stages: new Map([...bag.stage].map(([id, r]) => [id, r.output!])),
    personas: new Map([...bag.persona].map(([id, r]) => [id, r.output!])),
    minors: bag.minors?.output ?? null,
    link: bag.link!.output!,
  })
  const validation = validateSpec(merged.draft)
  const schemaIssues: CheckIssue[] = validation.ok ? [] : validation.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
  const errors = schemaIssues.length > 0 ? schemaIssues : checkSpec(merged.draft).errors
  return { draft: merged.draft, errors, warnings: merged.warnings, slantedDocuments: merged.slantedDocuments }
}

// --- link context ------------------------------------------------------------------------------

function buildLinkContext(skeleton: SkeletonShape, bag: CallBag): LinkContext {
  const stageOrder = new Map(skeleton.stages.map((s, i) => [s.id, i]))
  const characters: LinkContext['characters'] = skeleton.characters.map((c) => {
    const stageIds = skeleton.stages.filter((s) => Object.keys(s.placement).includes(c.id)).map((s) => s.id)
    if (c.tier === 'major') {
      const output = bag.persona.get(c.id)!.output!
      return {
        id: c.id,
        tier: 'major' as const,
        stageIds,
        stances: output.stances.map((_, i) => `s${i + 1}`),
        slants: output.slants.map((s) => ({ id: s.id, claim: s.claim, contradictedBy: s.contradictedBy })),
      }
    }
    const minor = bag.minors?.output?.characters.find((x) => x.characterId === c.id)
    return {
      id: c.id,
      tier: 'minor' as const,
      stageIds,
      stances: [],
      slants: (minor?.slants ?? []).map((s) => ({ id: s.id, claim: s.claim, contradictedBy: s.contradictedBy })),
    }
  })
  const discoveries: LinkContext['discoveries'] = skeleton.discoveries.map((d) => ({
    id: d.id,
    stageId: d.stageId,
    holder: 'characterId' in d.holder ? `character:${d.holder.characterId}` : `document:${d.holder.documentId}`,
    text: d.text,
  }))
  for (const [stageId, result] of bag.stage)
    for (const d of result.output?.discoveries ?? []) discoveries.push({ id: d.id, stageId, holder: `document:${d.documentId}`, text: d.text })
  for (const [characterId, result] of bag.persona)
    for (const d of result.output?.discoveries ?? []) discoveries.push({ id: d.id, stageId: d.stageId, holder: `character:${characterId}`, text: d.text })
  for (const minor of bag.minors?.output?.characters ?? [])
    for (const d of minor.discoveries) discoveries.push({ id: d.id, stageId: d.stageId, holder: `character:${minor.characterId}`, text: d.text })
  return { characters, discoveries, stageOrder }
}

// --- post-merge issue routing --------------------------------------------------------------------

function routeIssue(issue: CheckIssue, draft: AdventureSpec, bag: CallBag, skeleton: SkeletonShape): AnyCall | null {
  const [head, index] = issue.path.split('.')
  const i = Number(index)
  switch (head) {
    case 'stages':
      return bag.stage.get(draft.stages[i]?.id ?? '') ?? null
    case 'documents':
      return docOwner(draft.documents[i]?.id ?? '', bag)
    case 'discoveries':
      return discoveryOwner(draft.discoveries[i]?.id ?? '', bag, skeleton)
    case 'characters':
      return bag.persona.get(draft.characters[i]?.id ?? '') ?? (draft.characters[i] !== undefined ? bag.minors : null)
    case 'triggers': {
      const trigger = draft.triggers[i]
      if (trigger === undefined) return null
      if (trigger.id.startsWith('link-')) return bag.link
      return bag.persona.get(trigger.characterId) ?? bag.minors
    }
    case 'storyEvents':
      return bag.stage.get(draft.storyEvents[i]?.stageId ?? '') ?? null
    case 'openQuestions':
      return bag.stage.get(draft.openQuestions[i]?.stageId ?? '') ?? null
    default:
      return null
  }
}

function docOwner(documentId: string, bag: CallBag): AnyCall | null {
  for (const [stageId, result] of bag.stage) if (result.output?.documents.some((d) => d.id === documentId)) return bag.stage.get(stageId)!
  return null
}

function discoveryOwner(discoveryId: string, bag: CallBag, skeleton: SkeletonShape): AnyCall | null {
  for (const result of bag.stage.values()) if (result.output?.discoveries.some((d) => d.id === discoveryId)) return result
  for (const result of bag.persona.values()) if (result.output?.discoveries.some((d) => d.id === discoveryId) || result.output?.coreConditions.some((c) => c.discoveryId === discoveryId)) return result
  if (bag.minors?.output?.characters.some((c) => c.discoveries.some((d) => d.id === discoveryId))) return bag.minors
  const held = skeleton.discoveries.find((d) => d.id === discoveryId)
  if (held === undefined) return null
  // skeleton doc-held core → the stage that wrote it; char-held core → its holder's call
  if ('documentId' in held.holder) return bag.stage.get(held.stageId) ?? null
  return bag.persona.get(held.holder.characterId) ?? bag.minors
}
