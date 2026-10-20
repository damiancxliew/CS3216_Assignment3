/**
 * The reveal pass — a single call over the finished spec. All secret content is
 * stripped from the prompt (E3.6.2: the engine itself says a secret path existed).
 * Merge → validateSpec + full checkSpec → one repair round for errors the reveal added,
 * if the budget allows it. Errors already in the draft are carried through.
 */
import { checkSpec, validateSpec } from '@adventure/spec-v3'
import type { AdventureSpec, CheckIssue } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'
import { runCall } from '../details/calls'
import type { CallResult, DetailCallMetrics, DetailCallOptions } from '../details/calls'
import { sourceTexts } from '../grounding'
import { V3_MODEL } from '../config'
import { SKELETON_BUDGET_MS } from '../skeleton/generate'
import { sourcesBlock } from '../skeleton/index'
import { buildRevealContext, isSecretAct, revealIssues } from './checks'
import { mergeReveal } from './merge'
import { partId } from '../parts'
import type { PartResume, Parts } from '../parts'
import { fillRevealPrompt, REVEAL_SYSTEM_PROMPT } from './prompt'
import { RevealLlmOutput as RevealWire } from './schema'
import type { RevealLlmOutput } from './schema'

export const REVEAL_MODEL = V3_MODEL
export const REVEAL_BUDGET_MS = SKELETON_BUDGET_MS

export interface GenerateRevealInput {
  draft: AdventureSpec
  sources: ExtractedDocument[]
  slantedDocuments: { stageId: string; documentId: string; note: string }[]
  readingLevel?: 'sec' | 'jc'
}

export interface GenerateRevealOptions extends DetailCallOptions {
  budgetMs?: number
  now?: () => number
}

export interface RevealResult {
  ok: boolean
  spec?: AdventureSpec
  issues: CheckIssue[]
  warnings: CheckIssue[]
  pendingPasses: string[]
  /** the reveal part, when it produced an output (#209) */
  parts: Parts
  metrics: { calls: DetailCallMetrics[]; totalCostUsd: number }
}

/** What the model sees: the spec with every trace of the secret path removed. */
function revealUserMessage(input: GenerateRevealInput, readingLevel: 'sec' | 'jc'): string {
  const draft = input.draft
  const secretEndingIds = new Set(draft.endings.filter((e) => e.type === 'secret').map((e) => e.id))
  const nameOf = new Map(draft.characters.map((c) => [c.id, c.name]))
  const characterName = (id: string) => nameOf.get(id) ?? id

  const compact = {
    role: { name: draft.role.name, position: draft.role.position },
    arc: draft.arc ?? null,
    stages: draft.stages.map((s) => ({ id: s.id, title: s.title, timePlace: s.timePlace })),
    moments: draft.definingMoments.map((m) => ({
      id: m.id,
      scene: m.scene,
      decider: characterName(m.deciderId),
      acts: m.acts.filter((a) => !isSecretAct(a, m)).map((a) => ({ id: a.id, text: a.text, deception: a.deception === true })),
      outcomes: m.outcomes
        .filter((o) => o.secret !== true)
        .map((o) => ({
          id: o.id,
          summary: o.summary,
          historical: o.historical === true,
        })),
    })),
    endings: draft.endings
      .filter((e) => !secretEndingIds.has(e.id))
      .map((e) => ({ id: e.id, type: e.type, title: e.title, summary: e.summary })),
    slantedDocuments: input.slantedDocuments.map((s) => ({ documentId: s.documentId, note: s.note })),
  }
  return `Write the reveal.\n\n${JSON.stringify(compact, null, 2)}\n\n${sourcesBlock(input.sources)}`
}

/** The reveal call; `from` resumes it from a saved output (#209). */
export function revealCall(input: GenerateRevealInput, opts: DetailCallOptions, from?: PartResume) {
  const readingLevel = input.readingLevel ?? input.draft.readingLevel
  const ctx = buildRevealContext(input.draft, sourceTexts(input.sources), new Set(input.sources.map((d) => d.id)), input.slantedDocuments)
  return runCall(
    {
      label: 'reveal',
      schemaName: 'reveal_v3',
      schema: RevealWire,
      system: fillRevealPrompt(REVEAL_SYSTEM_PROMPT, { readingLevel }),
      user: revealUserMessage(input, readingLevel),
      check: (output) => revealIssues(output, ctx),
    },
    opts,
    { model: REVEAL_MODEL, reasoningEffort: 'medium' },
    from,
  )
}

export async function generateReveal(input: GenerateRevealInput, opts: GenerateRevealOptions): Promise<RevealResult> {
  const draft = input.draft
  const readingLevel = input.readingLevel ?? draft.readingLevel
  const sourceIds = new Set(input.sources.map((d) => d.id))
  const ctx = buildRevealContext(draft, sourceTexts(input.sources), sourceIds, input.slantedDocuments)

  const calls: DetailCallMetrics[] = []
  const counted = new Map<DetailCallMetrics[], number>()
  const countCalls = (result: CallResult<unknown>) => {
    calls.push(...result.calls.slice(counted.get(result.calls) ?? 0))
    counted.set(result.calls, result.calls.length)
  }
  const totalCost = () => calls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0)
  const uniq = (xs: CheckIssue[]) => xs.filter((x, i) => xs.findIndex((y) => y.code === x.code && y.path === x.path && y.message === x.message) === i)
  const warnings: CheckIssue[] = []
  const issues: CheckIssue[] = []

  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? REVEAL_BUDGET_MS)

  // Errors already in the draft aren't the reveal's to fix: they are carried through for the final repair (#209),
  // and only errors the reveal adds are repaired here.
  const before = validateSpec(draft)
  const draftErrors: CheckIssue[] = before.ok ? checkSpec(before.spec).errors : before.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
  const key = (i: CheckIssue) => `${i.code}|${i.path}|${i.message}`
  const inDraft = new Set(draftErrors.map(key))
  const added = (errs: CheckIssue[]) => errs.filter((e) => !inDraft.has(key(e)))

  const result = await revealCall(input, opts)
  countCalls(result)
  warnings.push(...result.warnings)
  issues.push(...result.issues)

  let part = result
  const finish = (spec: AdventureSpec | undefined, errs: CheckIssue[]): RevealResult => {
    const all = uniq([...draftErrors, ...issues, ...errs])
    return {
      ok: all.length === 0 && spec !== undefined,
      ...(spec !== undefined ? { spec } : {}),
      issues: all,
      warnings: uniq(warnings),
      pendingPasses: [],
      parts: part.output !== undefined ? { [partId.reveal]: { output: part.output, issues: part.issues } } : {},
      metrics: { calls, totalCostUsd: totalCost() },
    }
  }

  if (result.output === undefined) return finish(undefined, [])

  const mergeAndCheck = (output: RevealLlmOutput) => {
    const spec = mergeReveal(draft, output)
    const validation = validateSpec(spec)
    const errors: CheckIssue[] = validation.ok
      ? added(checkSpec(spec).errors)
      : validation.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
    return { spec, errors }
  }

  let merged = mergeAndCheck(result.output)
  if (merged.errors.length === 0) return finish(merged.spec, [])

  // one repair round on the same call, if it can still fit in the budget
  const lastLatency = Math.max(0, ...calls.map((c) => c.latencyMs))
  if (now() + lastLatency > deadline) {
    issues.push({ code: 'time-budget', path: '', message: `no time left for a repair round within ${Math.round((opts.budgetMs ?? REVEAL_BUDGET_MS) / 1000)} s` })
    return finish(merged.spec, merged.errors)
  }
  const repair = await result.rerun(merged.errors)
  countCalls(repair)
  warnings.push(...repair.warnings)
  issues.push(...repair.issues)
  if (repair.output === undefined) return finish(merged.spec, merged.errors)
  part = repair
  merged = mergeAndCheck(repair.output)
  return finish(merged.spec, merged.errors)
}
