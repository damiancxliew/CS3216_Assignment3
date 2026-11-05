/**
 * `generateSkeleton`: one LLM call plus up to `MAX_REPAIRS` repair turns, each validated by
 * `validateSkeleton` and checked by `checkSkeleton`. Pure given its input and the LLM replies.
 */
import { checkSkeleton, validateSkeleton } from '@adventure/spec-v3'
import type { CheckIssue, SkeletonSpec } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../../ingest/types'
import type { LlmClient, LlmUsage } from '../../llm/client'
import { estimateCostUsd, ZERO_USAGE } from '../../llm/client'
import { quoteIssues, sourceTexts } from '../grounding'
import { V3_MODEL } from '../config'
import { skeletonRepairMessage, skeletonSystemPrompt, skeletonUserMessage } from './prompt'
import type { SkeletonPromptInput } from './prompt'
import { SkeletonLlmOutput, skeletonOutputJsonSchema, toSkeleton } from './schema'

export const MAX_REPAIRS = 2

/**
 * Wall-clock budget for the whole pass, first call and repairs together. A job step must finish within the host's
 * 300 s limit with time left to save, so a repair only starts if the last call's duration still fits.
 */
export const SKELETON_BUDGET_MS = 270_000

export const SKELETON_MODEL = V3_MODEL

export interface SkeletonGenerationInput {
  episode: string
  teacherNotes?: string
  readingLevel: 'sec' | 'jc'
  documents: ExtractedDocument[]
}

export interface SkeletonGenerationOptions {
  llm: LlmClient
  model?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | null
  maxOutputTokens?: number
  /** Defaults to `SKELETON_BUDGET_MS`. */
  budgetMs?: number
  /** Injected for tests. */
  now?: () => number
}

export interface SkeletonCallMetrics {
  model: string
  latencyMs: number
  usage: LlmUsage
  costUsd: number | null
  issueCount: number
}

export interface SkeletonGenerationResult {
  ok: boolean
  skeleton?: SkeletonSpec
  issues: CheckIssue[]
  metrics: { calls: SkeletonCallMetrics[]; totalCostUsd: number | null }
}

export async function generateSkeleton(input: SkeletonGenerationInput, opts: SkeletonGenerationOptions): Promise<SkeletonGenerationResult> {
  const model = opts.model ?? SKELETON_MODEL
  const reasoningEffort = opts.reasoningEffort === undefined ? 'high' : opts.reasoningEffort
  const maxOutputTokens = opts.maxOutputTokens ?? 24_000

  const promptInput: SkeletonPromptInput = {
    episode: input.episode,
    readingLevel: input.readingLevel,
    documents: input.documents,
    ...(input.teacherNotes !== undefined ? { teacherNotes: input.teacherNotes } : {}),
  }
  const system = skeletonSystemPrompt(input.readingLevel)
  const user = skeletonUserMessage(promptInput)
  const jsonSchema = skeletonOutputJsonSchema()
  const texts = sourceTexts(input.documents)

  const calls: SkeletonCallMetrics[] = []
  let issues: CheckIssue[] = []
  let skeleton: SkeletonSpec | undefined
  let previousRaw: string | null = null

  const now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? SKELETON_BUDGET_MS)
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const lastLatency = calls.at(-1)?.latencyMs ?? 0
    if (attempt > 0 && now() + lastLatency > deadline) {
      issues = [...issues, { code: 'time-budget', path: '', message: `no time left for repair ${attempt} within ${Math.round((opts.budgetMs ?? SKELETON_BUDGET_MS) / 1000)} s` }]
      break
    }
    const userTurn =
      attempt === 0 ? user : `${user}\n\nYour previous skeleton:\n\`\`\`json\n${previousRaw ?? ''}\n\`\`\`\n\n${skeletonRepairMessage(issues)}`
    const response = await opts.llm.completeJson({
      model,
      system,
      user: userTurn,
      schemaName: 'skeleton_v3',
      jsonSchema,
      maxOutputTokens,
      reasoningEffort,
    })
    previousRaw = response.text

    issues = []
    skeleton = undefined
    if (response.refusal !== null || response.json === null || response.json === undefined) {
      issues = [{ code: 'llm-output', path: '', message: response.refusal ?? 'model returned no parseable JSON' }]
    } else {
      const parsed = SkeletonLlmOutput.safeParse(response.json)
      if (!parsed.success) {
        issues = parsed.error.issues.map((i) => ({ code: 'schema', path: i.path.join('.'), message: i.message }))
      } else {
        const candidate = toSkeleton(parsed.data, input)
        const valid = validateSkeleton(candidate)
        if (!valid.ok) {
          issues = valid.issues.map((i) => ({ code: 'schema', path: i.path, message: i.message }))
        } else {
          skeleton = valid.spec
          issues = checkSkeleton(valid.spec).errors
          issues.push(
            ...quoteIssues(
              [
                ...valid.spec.discoveries.flatMap((d, i) =>
                  (d.citations ?? []).flatMap((c, j) => (c.quote !== undefined ? [{ path: `discoveries.${i}.citations.${j}.quote`, sourceId: c.sourceId, quote: c.quote }] : [])),
                ),
                ...valid.spec.endings.flatMap((e, i) =>
                  (e.citations ?? []).flatMap((c, j) => (c.quote !== undefined ? [{ path: `endings.${i}.citations.${j}.quote`, sourceId: c.sourceId, quote: c.quote }] : [])),
                ),
              ],
              texts,
            ),
          )
        }
      }
    }

    calls.push({
      model: response.model,
      latencyMs: response.latencyMs,
      usage: response.usage ?? ZERO_USAGE,
      costUsd: estimateCostUsd(response.model, response.usage ?? ZERO_USAGE),
      issueCount: issues.length,
    })

    if (issues.length === 0) break
  }

  const costs = calls.map((c) => c.costUsd)
  return {
    ok: issues.length === 0,
    ...(skeleton !== undefined ? { skeleton } : {}),
    issues,
    metrics: { calls, totalCostUsd: costs.includes(null) ? null : (costs as number[]).reduce((a, b) => a + b, 0) },
  }
}
