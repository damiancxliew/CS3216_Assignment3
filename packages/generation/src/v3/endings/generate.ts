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
  momentResults.forEach(collect)
  endingResults.forEach(collect)

  const moments = new Map(draft.definingMoments.map((m, i) => [m.id, momentResults[i]!]))
  const endings = new Map(draft.endings.map((e, i) => [e.id, endingResults[i]!]))
  const missingOutput = [...momentResults, ...endingResults].some((r) => r.output === undefined)
  if (issues.length > 0 || missingOutput)
    return { ok: false, issues, warnings: uniq(warnings), pendingPasses: [], metrics: { calls, totalCostUsd: totalCost() } }

  // --- merge + check ----------------------------------------------------------------------------
  const mergeAndCheck = () => {
    const spec = mergeEndings(draft, {
      moments: new Map([...moments].map(([id, r]) => [id, r.output!])),
      endings: new Map([...endings].map(([id, r]) => [id, r.output!])),
    })
    const validation = validateSpec(spec)
    const errors: CheckIssue[] = validation.ok
      ? [...checkSpec(spec).errors, ...pendingFieldIssues(spec)]
      : validation.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
    return { spec, errors }
  }
  const merged = mergeAndCheck()
  const remaining = merged.errors

  const finalSpec = (spec: AdventureSpec, errs: CheckIssue[]): EndingsResult => ({
    ok: errs.length === 0 && issues.length === 0,
    spec,
    issues: [...issues, ...errs],
    warnings: uniq(warnings),
    pendingPasses: errs.length === 0 && issues.length === 0 ? ['reveal'] : [],
    metrics: { calls, totalCostUsd: totalCost() },
  })

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
  const repairs = await Promise.all([...routed.entries()].map(([result, its]) => result.rerun(its)))
  for (const repair of repairs) {
    countCalls(repair)
    warnings.push(...repair.warnings)
    issues.push(...repair.issues)
    if (repair.output === undefined) continue
    for (const [id, result] of moments) if (result === repair || result.calls === repair.calls) moments.get(id)!.output = repair.output as MomentLlmOutput
    for (const [id, result] of endings) if (result === repair || result.calls === repair.calls) endings.get(id)!.output = repair.output as EndingLlmOutput
  }
  if (![...moments.values(), ...endings.values()].every((r) => r.output !== undefined)) return finalSpec(merged.spec, remaining)

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
