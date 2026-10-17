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
import type { MergeResult } from './merge'
import { partId } from '../parts'
import type { Parts } from '../parts'
import type { LinkLlmOutput, MinorsLlmOutput, PersonaLlmOutput, StageDetailsLlmOutput } from './schema'

export interface GenerateDetailsInput {
  skeleton: SkeletonShape
  documents: ExtractedDocument[]
  readingLevel?: 'sec' | 'jc'
  timerMinutes?: number | null
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
  mergedDuplicates: { keep: string; drop: string[] }[]
  pendingPasses: string[]
  /** every part that produced an output, for the final repair (#209) */
  parts: Parts
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
  /** issues of repair reruns that produced no output (the previous output was kept) */
  const lost: CheckIssue[] = []
  // A call's metrics array keeps growing when it is rerun for repair, so record how much of it is counted.
  const counted = new Map<DetailCallMetrics[], number>()
  const countCalls = (result: CallResult<unknown>) => {
    calls.push(...result.calls.slice(counted.get(result.calls) ?? 0))
    counted.set(result.calls, result.calls.length)
  }
  const totalCost = () => calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0)
  const uniq = (xs: CheckIssue[]) => xs.filter((x, i) => xs.findIndex((y) => y.code === x.code && y.path === x.path && y.message === x.message) === i)

  // --- stages + personas + minors concurrently -------------------------------------------------
  const majors = skeleton.characters.filter((c) => c.tier === 'major')
  const hasMinors = skeleton.characters.some((c) => c.tier === 'minor')
  const genStage = (id: string) => generateStageDetails(id, shared, opts)
  const genPersona = (id: string) => generatePersona(id, shared, opts)
  const genMinors = () => generateMinors(shared, opts)
  const [stageResults, personaResults, minorsResult] = await Promise.all([
    Promise.all(skeleton.stages.map((s) => genStage(s.id))),
    Promise.all(majors.map((c) => genPersona(c.id))),
    hasMinors ? genMinors() : Promise.resolve(null),
  ])
  const bag: CallBag = {
    stage: new Map(skeleton.stages.map((s, i) => [s.id, stageResults[i]!])),
    persona: new Map(majors.map((c, i) => [c.id, personaResults[i]!])),
    minors: minorsResult,
    link: null,
  }
  const detailCalls = (): AnyCall[] => [...bag.stage.values(), ...bag.persona.values(), ...(bag.minors !== null ? [bag.minors] : [])]
  const allCalls = (): AnyCall[] => [...detailCalls(), ...(bag.link !== null ? [bag.link] : [])]
  detailCalls().forEach(countCalls)

  // A part with no output after its own repairs gets one fresh call; the other parts are kept.
  await Promise.all([
    ...[...bag.stage].filter(([, r]) => r.output === undefined).map(async ([id]) => {
      const r = await genStage(id)
      countCalls(r)
      bag.stage.set(id, r)
    }),
    ...[...bag.persona].filter(([, r]) => r.output === undefined).map(async ([id]) => {
      const r = await genPersona(id)
      countCalls(r)
      bag.persona.set(id, r)
    }),
    ...(bag.minors !== null && bag.minors.output === undefined
      ? [
          (async () => {
            const r = await genMinors()
            countCalls(r)
            bag.minors = r
          })(),
        ]
      : []),
  ])

  /** `ok` = assembled and clean. A draft with errors is still returned, with its parts, for the final repair (#209). */
  const finish = (merged: ReturnType<typeof mergeAndCheck> | null, errors: CheckIssue[]): DetailsResult => {
    const issues = uniq([...lost, ...allCalls().flatMap((r) => r.issues), ...errors])
    const ok = merged !== null && issues.length === 0
    return {
      ok,
      ...(merged !== null ? { draft: merged.draft } : {}),
      issues,
      warnings: uniq([...allCalls().flatMap((r) => r.warnings), ...warnings]),
      slantedDocuments: merged?.slantedDocuments ?? [],
      mergedDuplicates: bag.link?.output?.duplicates ?? [],
      pendingPasses: ok ? ['endings', 'reveal'] : [],
      parts: partsOf(bag),
      metrics: { calls, totalCostUsd: totalCost() },
    }
  }
  if (detailCalls().some((r) => r.output === undefined)) return finish(null, [])

  // --- link -------------------------------------------------------------------------------------
  const linkModel = opts.linkModel ?? opts.model
  const linkEffort = opts.linkReasoningEffort ?? opts.reasoningEffort
  const linkOpts: DetailCallOptions = {
    llm: opts.llm,
    ...(linkModel !== undefined ? { model: linkModel } : {}),
    ...(linkEffort !== undefined ? { reasoningEffort: linkEffort } : {}),
    ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  }
  const genLink = async () => {
    const r = await linkDetails(buildLinkContext(skeleton, bag), shared, linkOpts)
    countCalls(r)
    return r
  }
  bag.link = await genLink()
  if (bag.link.output === undefined) bag.link = await genLink()
  if (bag.link.output === undefined) return finish(null, [])

  // --- merge + check ----------------------------------------------------------------------------
  const merged = mergeAndCheck(skeleton, bag, input.timerMinutes)
  warnings.push(...merged.warnings)
  if (merged.errors.length === 0) return finish(merged, [])

  // --- one routed repair round -------------------------------------------------------------------
  const routed = new Map<AnyCall, CheckIssue[]>()
  for (const issue of merged.errors) {
    const owner = routeIssue(issue, merged.draft, bag, skeleton)
    if (owner !== null) routed.set(owner, [...(routed.get(owner) ?? []), issue])
  }
  if (routed.size === 0) return finish(merged, merged.errors)
  const repairs = await Promise.all([...routed.entries()].map(async ([original, its]) => [original, await original.rerun(its)] as const))
  let detailRepaired = false
  for (const [original, repair] of repairs) {
    countCalls(repair)
    if (repair.output === undefined) {
      lost.push(...repair.issues)
      continue
    }
    if (original !== bag.link) detailRepaired = true
    replaceCall(bag, original, repair)
  }
  // the link reads every detail part, so it is redone when one of them changed
  if (detailRepaired) {
    const relinked = await genLink()
    if (relinked.output !== undefined) bag.link = relinked
    else lost.push(...relinked.issues)
  }
  const remerged = mergeAndCheck(skeleton, bag, input.timerMinutes)
  warnings.push(...remerged.warnings)
  return finish(remerged, remerged.errors)
}

function replaceCall(bag: CallBag, original: AnyCall, repair: AnyCall): void {
  for (const [id, r] of bag.stage) if (r === original) bag.stage.set(id, repair as CallResult<StageDetailsLlmOutput>)
  for (const [id, r] of bag.persona) if (r === original) bag.persona.set(id, repair as CallResult<PersonaLlmOutput>)
  if (bag.minors === original) bag.minors = repair as CallResult<MinorsLlmOutput>
  if (bag.link === original) bag.link = repair as CallResult<LinkLlmOutput>
}

function partsOf(bag: CallBag): Parts {
  const parts: Parts = {}
  const put = (id: string, r: AnyCall | null) => {
    if (r !== null && r.output !== undefined) parts[id] = { output: r.output, issues: r.issues }
  }
  for (const [id, r] of bag.stage) put(partId.stage(id), r)
  for (const [id, r] of bag.persona) put(partId.persona(id), r)
  put(partId.minors, bag.minors)
  put(partId.link, bag.link)
  return parts
}

/** The details draft from saved parts, in code: the same parts always give the same draft. */
export function assembleDetails(skeleton: SkeletonShape, parts: Parts, timerMinutes?: number | null): MergeResult {
  const out = (id: string) => parts[id]?.output
  return mergeDetails(
    skeleton,
    {
      stages: new Map(skeleton.stages.map((s) => [s.id, out(partId.stage(s.id)) as StageDetailsLlmOutput])),
      personas: new Map(skeleton.characters.filter((c) => c.tier === 'major').map((c) => [c.id, out(partId.persona(c.id)) as PersonaLlmOutput])),
      minors: (out(partId.minors) as MinorsLlmOutput | undefined) ?? null,
      link: out(partId.link) as LinkLlmOutput,
    },
    timerMinutes !== undefined ? { timerMinutes } : {},
  )
}

function mergeAndCheck(skeleton: SkeletonShape, bag: CallBag, timerMinutes?: number | null) {
  const merged = assembleDetails(skeleton, partsOf(bag), timerMinutes)
  const validation = validateSpec(merged.draft)
  const schemaIssues: CheckIssue[] = validation.ok ? [] : validation.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
  const errors = schemaIssues.length > 0 ? schemaIssues : checkSpec(merged.draft).errors
  const warnings = [...merged.warnings, ...slantReactionsWarnings(merged.draft)]
  return { draft: merged.draft, errors, warnings, slantedDocuments: merged.slantedDocuments }
}

/** ≥3 slantConfronted triggers that all move the same direction read as mechanical. */
function slantReactionsWarnings(draft: AdventureSpec): CheckIssue[] {
  const deltas = draft.triggers.filter((t) => 'slantConfronted' in t.on && 'stanceDelta' in t.effect).map((t) => (t.effect as { stanceDelta: number }).stanceDelta)
  if (deltas.length >= 3 && deltas.every((d) => d === deltas[0]))
    return [{ code: 'slant-reactions-uniform', path: 'triggers', message: `all ${deltas.length} slant-confronted triggers use stanceDelta ${deltas[0]}` }]
  return []
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
      slants: (minor?.slants ?? []).map((s) => ({ id: s.id, claim: s.claim, contradictedBy: s.contradictedBy, unlocksDiscoveryId: s.unlocksDiscoveryId })),
    }
  })
  const discoveries: LinkContext['discoveries'] = skeleton.discoveries.map((d) => ({
    id: d.id,
    stageId: d.stageId,
    holder: 'characterId' in d.holder ? `character:${d.holder.characterId}` : `document:${d.holder.documentId}`,
    text: d.text,
    core: true,
  }))
  for (const [stageId, result] of bag.stage)
    for (const d of result.output?.discoveries ?? []) discoveries.push({ id: d.id, stageId, holder: `document:${d.documentId}`, text: d.text, core: false })
  for (const [characterId, result] of bag.persona)
    for (const d of result.output?.discoveries ?? []) discoveries.push({ id: d.id, stageId: d.stageId, holder: `character:${characterId}`, text: d.text, core: false })
  for (const minor of bag.minors?.output?.characters ?? [])
    for (const d of minor.discoveries) discoveries.push({ id: d.id, stageId: d.stageId, holder: `character:${minor.characterId}`, text: d.text, core: false })
  const triggers: LinkContext['triggers'] = []
  for (const [characterId, result] of bag.persona)
    for (const t of result.output?.triggers ?? []) triggers.push({ characterId, on: { kind: t.on.kind, id: t.on.id } })
  return { characters, discoveries, triggers, stageOrder }
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
