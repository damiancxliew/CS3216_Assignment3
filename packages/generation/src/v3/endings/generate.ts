/**
 * Orchestrates the endings pass: one call per defining moment + one per ending, all
 * concurrent, then merge → validateSpec/checkSpec/pending-field → one routed repair round.
 */
import { checkSpec, validateSpec } from '@adventure/spec-v3'
import type { AdventureSpec, CheckIssue } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'
import { SKELETON_BUDGET_MS } from '../skeleton/generate'
import { generateEnding, generateMoment } from './calls'
import type { CallResult, DetailCallMetrics, DetailCallOptions } from '../details/calls'
import { mergeEndings } from './merge'
import { partId } from '../parts'
import type { Parts } from '../parts'
import type { EndingLlmOutput, MomentLlmOutput } from './schema'

export const ENDINGS_BUDGET_MS = SKELETON_BUDGET_MS

export interface GenerateEndingsInput {
  draft: AdventureSpec
  documents: ExtractedDocument[]
  readingLevel?: 'sec' | 'jc'
}

export interface GenerateEndingsOptions extends DetailCallOptions {
  /** Defaults to `ENDINGS_BUDGET_MS` (270 s). */
  budgetMs?: number
  now?: () => number
}

export interface EndingsResult {
  ok: boolean
  spec?: AdventureSpec
  issues: CheckIssue[]
  warnings: CheckIssue[]
  pendingPasses: string[]
  /** every part that produced an output, for the final repair (#209) */
  parts: Parts
  metrics: { calls: DetailCallMetrics[]; totalCostUsd: number }
}

export async function generateEndings(input: GenerateEndingsInput, opts: GenerateEndingsOptions): Promise<EndingsResult> {
  const draft = input.draft
  const readingLevel = input.readingLevel ?? draft.readingLevel
  const shared = { draft, documents: input.documents, readingLevel }
  const calls: DetailCallMetrics[] = []
  const warnings: CheckIssue[] = []
  const issues: CheckIssue[] = []
  const counted = new Map<DetailCallMetrics[], number>()
  const countCalls = (result: CallResult<unknown>) => {
    calls.push(...result.calls.slice(counted.get(result.calls) ?? 0))
    counted.set(result.calls, result.calls.length)
  }
  const collect = (result: CallResult<unknown>) => {
    countCalls(result)
    warnings.push(...result.warnings)
    issues.push(...result.issues)
  }
  const totalCost = () => calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0)
  const uniq = (xs: CheckIssue[]) => xs.filter((x, i) => xs.findIndex((y) => y.code === x.code && y.path === x.path && y.message === x.message) === i)

  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? ENDINGS_BUDGET_MS)

  // --- all calls concurrently -------------------------------------------------------------------
  const [momentResults, endingResults] = await Promise.all([
    Promise.all(draft.definingMoments.map((m) => generateMoment(m.id, shared, opts))),
    Promise.all(draft.endings.map((e) => generateEnding(e.id, shared, opts))),
  ])
  const moments = new Map(draft.definingMoments.map((m, i) => [m.id, momentResults[i]!]))
  const endings = new Map(draft.endings.map((e, i) => [e.id, endingResults[i]!]))
  const all = (): CallResult<unknown>[] => [...moments.values(), ...endings.values()]
  all().forEach(countCalls)
  /** issues of repair reruns that produced no output (the previous output was kept) */
  const lost: CheckIssue[] = []

  // A part with no output after its own repairs gets one fresh call; the other parts are kept.
  await Promise.all([
    ...[...moments].filter(([, r]) => r.output === undefined).map(async ([id]) => {
      const r = await generateMoment(id, shared, opts)
      countCalls(r)
      moments.set(id, r)
    }),
    ...[...endings].filter(([, r]) => r.output === undefined).map(async ([id]) => {
      const r = await generateEnding(id, shared, opts)
      countCalls(r)
      endings.set(id, r)
    }),
  ])
  const partsOf = (): Parts => {
    const parts: Parts = {}
    for (const [id, r] of moments) if (r.output !== undefined) parts[partId.moment(id)] = { output: r.output, issues: r.issues }
    for (const [id, r] of endings) if (r.output !== undefined) parts[partId.ending(id)] = { output: r.output, issues: r.issues }
    return parts
  }
  const allIssues = (errs: CheckIssue[]) => uniq([...issues, ...lost, ...all().flatMap((r) => r.issues), ...errs])
  const allWarnings = () => uniq([...warnings, ...all().flatMap((r) => r.warnings)])
  if (all().some((r) => r.output === undefined))
    return { ok: false, issues: allIssues([]), warnings: allWarnings(), pendingPasses: [], parts: partsOf(), metrics: { calls, totalCostUsd: totalCost() } }

  // --- merge + check ----------------------------------------------------------------------------
  const mergeAndCheck = () => {
    const spec = assembleEndings(draft, partsOf())
    const validation = validateSpec(spec)
    const errors: CheckIssue[] = validation.ok
      ? [...checkSpec(spec).errors, ...pendingFieldIssues(spec)]
      : validation.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
    return { spec, errors }
  }
  const merged = mergeAndCheck()
  const remaining = merged.errors

  /** `ok` = assembled and clean. A spec with errors is still returned, with its parts, for the final repair (#209). */
  const finalSpec = (spec: AdventureSpec, errs: CheckIssue[]): EndingsResult => {
    const all = allIssues(errs)
    return {
      ok: all.length === 0,
      spec,
      issues: all,
      warnings: allWarnings(),
      pendingPasses: all.length === 0 ? ['reveal'] : [],
      parts: partsOf(),
      metrics: { calls, totalCostUsd: totalCost() },
    }
  }

  if (remaining.length === 0) return finalSpec(merged.spec, [])

  // --- one routed repair round ------------------------------------------------------------------
  const lastLatency = Math.max(0, ...calls.map((c) => c.latencyMs))
  if (now() + lastLatency > deadline) {
    issues.push({ code: 'time-budget', path: '', message: `no time left for a repair round within ${Math.round((opts.budgetMs ?? ENDINGS_BUDGET_MS) / 1000)} s` })
    return finalSpec(merged.spec, remaining)
  }
  const routed = new Map<CallResult<unknown>, CheckIssue[]>()
  for (const issue of remaining) {
    const owner = routeIssue(issue, merged.spec, moments, endings)
    if (owner === null) issues.push(issue)
    else routed.set(owner, [...(routed.get(owner) ?? []), issue])
  }
  const repairs = await Promise.all([...routed.entries()].map(async ([original, its]) => [original, await original.rerun(its)] as const))
  for (const [original, repair] of repairs) {
    countCalls(repair)
    if (repair.output === undefined) {
      lost.push(...repair.issues)
      continue
    }
    for (const [id, result] of moments) if (result === original) moments.set(id, repair as CallResult<MomentLlmOutput>)
    for (const [id, result] of endings) if (result === original) endings.set(id, repair as CallResult<EndingLlmOutput>)
  }

  const remerged = mergeAndCheck()
  return finalSpec(remerged.spec, remerged.errors)
}

/** endings-owned placeholders that must be filled. */
function pendingFieldIssues(spec: AdventureSpec): CheckIssue[] {
  const issues: CheckIssue[] = []
  const empty = (path: string) => issues.push({ code: 'pending-field', path, message: 'endings-pass field still empty' })
  spec.definingMoments.forEach((m, i) => {
    if (m.nudge.trim() === '') empty(`definingMoments.${i}.nudge`)
    if (m.finalCallNarration.trim() === '') empty(`definingMoments.${i}.finalCallNarration`)
    m.acts.forEach((a, j) => {
      if (a.reaction.trim() === '') empty(`definingMoments.${i}.acts.${j}.reaction`)
    })
    m.outcomes.forEach((o, j) => {
      if (o.predictionText.trim() === '') empty(`definingMoments.${i}.outcomes.${j}.predictionText`)
      if (o.because.trim() === '') empty(`definingMoments.${i}.outcomes.${j}.because`)
    })
  })
  spec.endings.forEach((e, i) => {
    if (e.epilogue.trim() === '') empty(`endings.${i}.epilogue`)
    if (e.interview.interviewer.trim() === '') empty(`endings.${i}.interview.interviewer`)
    if (e.interview.question.trim() === '') empty(`endings.${i}.interview.question`)
    e.interview.verdicts.forEach((v, j) => {
      if (v.text.trim() === '') empty(`endings.${i}.interview.verdicts.${j}.text`)
      if (v.id.includes('-pending-v')) empty(`endings.${i}.interview.verdicts.${j}.id`)
    })
    if (e.interview.generalCounter.trim() === '') empty(`endings.${i}.interview.generalCounter`)
  })
  return issues
}

function routeIssue(
  issue: CheckIssue,
  spec: AdventureSpec,
  moments: Map<string, CallResult<MomentLlmOutput>>,
  endings: Map<string, CallResult<EndingLlmOutput>>,
): CallResult<unknown> | null {
  const [head, index] = issue.path.split('.')
  const i = Number(index)
  if (head === 'definingMoments') return moments.get(spec.definingMoments[i]?.id ?? '') ?? null
  if (head === 'endings') return endings.get(spec.endings[i]?.id ?? '') ?? null
  // verdict texts sit under endings paths only; anything else is unowned
  return null
}

/** The endings spec from saved parts, in code: the same parts always give the same spec. */
export function assembleEndings(draft: AdventureSpec, parts: Parts): AdventureSpec {
  return mergeEndings(draft, {
    moments: new Map(draft.definingMoments.map((m) => [m.id, parts[partId.moment(m.id)]?.output as MomentLlmOutput])),
    endings: new Map(draft.endings.map((e) => [e.id, parts[partId.ending(e.id)]?.output as EndingLlmOutput])),
  })
}
