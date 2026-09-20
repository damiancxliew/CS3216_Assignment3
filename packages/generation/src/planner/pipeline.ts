/**
 * D3/D4 — documents -> Adventure Spec v2, or a report.
 *
 *   plan -> merge server-owned fields -> schema validate -> grounding check
 *        -> (invalid? repair, at most MAX_REPAIRS times) -> spec | failure report
 *
 * Invalid output is never returned as a spec (FR-4). Every run yields the D8
 * metrics: attempts, repairs, latency, tokens and cost.
 */
import { slugify } from '../ingest/extract'
import { verifyGrounding } from '../ingest/spans'
import type { ExtractedDocument } from '../ingest/types'
import { DEFAULT_MODELS, type LlmClient, type LlmJsonResponse, type LlmUsage, ZERO_USAGE, addUsage, estimateCostUsd } from '../llm/client'
import { SPEC_VERSION, type AdventureSpec, type SpecIssue, formatIssuePath, validateAdventureSpec } from '../spec/v2'
import { PROMPT_VERSION, buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from './prompt'
import { type TeacherInput, type TeacherInputRaw, plannerOutputJsonSchema, plannerOutputSchema, teacherInputSchema } from './schema'

/** FR-4: up to two bounded repair round-trips. */
export const MAX_REPAIRS = 2

export interface PlannerConfig {
  model: string
  maxOutputTokens: number
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | null
  maxRepairs: number
}

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  model: DEFAULT_MODELS.frontier,
  maxOutputTokens: 32_000,
  reasoningEffort: 'medium',
  maxRepairs: MAX_REPAIRS,
}

export interface CallMetrics {
  purpose: 'plan' | 'repair'
  model: string
  latencyMs: number
  usage: LlmUsage
  costUsd: number | null
  /** Issues found in this call's output (0 = accepted). */
  issueCount: number
  schemaIssues: number
  groundingIssues: number
  /** The issues fed back to the model after this call (first 40), kept for the eval write-up. */
  issues: SpecIssue[]
}

/** D8 — generation metrics for one adventure. */
export interface GenerationMetrics {
  promptVersion: string
  specVersion: number
  model: string
  attempts: number
  repairs: number
  valid: boolean
  totalLatencyMs: number
  usage: LlmUsage
  costUsd: number | null
  calls: CallMetrics[]
  documents: Array<{ id: string; pages: number; chars: number }>
  documentsTruncated: boolean
}

export type GenerationResult =
  | {
      status: 'ok'
      spec: AdventureSpec
      missingInformation: string[]
      warnings: string[]
      metrics: GenerationMetrics
    }
  | {
      status: 'failed'
      reason: 'invalid-after-repair' | 'refusal' | 'unparseable' | 'llm-error' | 'invalid-teacher-input'
      /** What is still wrong, path-addressed, for the teacher console. */
      issues: SpecIssue[]
      missingInformation: string[]
      /** The last raw output, kept for diagnostics; never published. */
      lastOutput: string | null
      metrics: GenerationMetrics
    }

export interface GenerateOptions {
  teacher: TeacherInputRaw
  documents: readonly ExtractedDocument[]
  llm: LlmClient
  config?: Partial<PlannerConfig>
}

interface Candidate {
  spec: AdventureSpec | null
  issues: SpecIssue[]
  schemaIssues: number
  groundingIssues: number
  missingInformation: string[]
}

/** Server-owned fields are merged before validation; the planner cannot set them. */
export function mergeServerFields(adventure: Record<string, unknown>, teacher: TeacherInput, documents: readonly ExtractedDocument[]): Record<string, unknown> {
  const title = typeof adventure.title === 'string' ? adventure.title : (teacher.title ?? 'adventure')
  let id = slugify(title, 'adventure')
  if (JSON.stringify(adventure).includes(`"${id}"`)) id = `${id}-adventure`
  return {
    ...adventure,
    version: SPEC_VERSION,
    id,
    readingLevel: teacher.readingLevel,
    sources: documents.map((d) => ({ id: d.id, title: d.title.slice(0, 160), kind: d.kind, pageCount: d.pageCount, contentHash: d.contentHash })),
  }
}

/** Validate one planner output all the way through: shape, cross-refs, grounding. */
export function evaluateCandidate(json: unknown, teacher: TeacherInput, documents: readonly ExtractedDocument[]): Candidate {
  const parsed = plannerOutputSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: formatIssuePath(i.path), message: i.message }))
    return { spec: null, issues, schemaIssues: issues.length, groundingIssues: 0, missingInformation: extractMissingInfo(json) }
  }
  const merged = mergeServerFields(parsed.data.adventure as unknown as Record<string, unknown>, teacher, documents)
  const validation = validateAdventureSpec(merged)
  if (!validation.ok) {
    const issues = validation.issues.map((i) => ({ path: i.path.replace(/^\$/, '$.adventure'), message: i.message }))
    return { spec: null, issues, schemaIssues: issues.length, groundingIssues: 0, missingInformation: parsed.data.missingInformation }
  }
  const grounding = verifyGrounding(validation.spec, new Map(documents.map((d) => [d.id, d])))
  const issues = grounding.failures.map((f) => ({
    path: f.path.replace(/^\$/, '$.adventure'),
    message:
      f.resolution.reason === 'quote-not-on-page'
        ? `quote not found on page ${f.span.page} of "${f.span.sourceId}"${f.resolution.nearestPage ? ` (it appears on page ${f.resolution.nearestPage})` : ' (not found on any page — copy text verbatim or replace with an assumptionId)'}`
        : f.resolution.reason === 'page-out-of-range'
          ? `page ${f.span.page} does not exist in "${f.span.sourceId}"`
          : `unknown source "${f.span.sourceId}"`,
  }))
  return {
    spec: issues.length === 0 ? validation.spec : null,
    issues,
    schemaIssues: 0,
    groundingIssues: issues.length,
    missingInformation: parsed.data.missingInformation,
  }
}

function extractMissingInfo(json: unknown): string[] {
  if (json && typeof json === 'object' && Array.isArray((json as { missingInformation?: unknown }).missingInformation)) {
    return ((json as { missingInformation: unknown[] }).missingInformation).filter((x): x is string => typeof x === 'string')
  }
  return []
}

export async function generateAdventure(options: GenerateOptions): Promise<GenerationResult> {
  const config: PlannerConfig = { ...DEFAULT_PLANNER_CONFIG, ...options.config }
  const metrics: GenerationMetrics = {
    promptVersion: PROMPT_VERSION,
    specVersion: SPEC_VERSION,
    model: config.model,
    attempts: 0,
    repairs: 0,
    valid: false,
    totalLatencyMs: 0,
    usage: ZERO_USAGE,
    costUsd: 0,
    calls: [],
    documents: [],
    documentsTruncated: false,
  }
  const started = Date.now()
  const finish = <T extends GenerationResult>(result: T): T => {
    metrics.totalLatencyMs = Date.now() - started
    return result
  }

  const teacherParsed = teacherInputSchema.safeParse(options.teacher)
  if (!teacherParsed.success) {
    return finish({
      status: 'failed',
      reason: 'invalid-teacher-input',
      issues: teacherParsed.error.issues.map((i) => ({ path: formatIssuePath(['teacher', ...i.path]), message: i.message })),
      missingInformation: [],
      lastOutput: null,
      metrics,
    })
  }
  const teacher = teacherParsed.data
  const system = buildSystemPrompt(teacher)
  const { user, budget } = buildUserPrompt(teacher, options.documents)
  metrics.documents = budget.included
  metrics.documentsTruncated = budget.truncated
  const jsonSchema = plannerOutputJsonSchema()

  let userTurn = user
  let lastOutput: string | null = null
  let lastCandidate: Candidate | null = null

  for (let attempt = 0; attempt <= config.maxRepairs; attempt++) {
    const purpose = attempt === 0 ? 'plan' : 'repair'
    let response: LlmJsonResponse
    try {
      response = await options.llm.completeJson({
        model: config.model,
        system,
        user: userTurn,
        schemaName: 'adventure_spec_v2_plan',
        jsonSchema,
        maxOutputTokens: config.maxOutputTokens,
        reasoningEffort: config.reasoningEffort,
      })
    } catch (error) {
      return finish({
        status: 'failed',
        reason: 'llm-error',
        issues: [{ path: '$', message: error instanceof Error ? error.message : String(error) }],
        missingInformation: lastCandidate?.missingInformation ?? [],
        lastOutput,
        metrics,
      })
    }
    metrics.attempts += 1
    if (attempt > 0) metrics.repairs += 1
    metrics.usage = addUsage(metrics.usage, response.usage)
    const callCost = estimateCostUsd(response.model, response.usage)
    metrics.costUsd = metrics.costUsd === null || callCost === null ? null : metrics.costUsd + callCost
    const call: CallMetrics = { purpose, model: response.model, latencyMs: response.latencyMs, usage: response.usage, costUsd: callCost, issueCount: 0, schemaIssues: 0, groundingIssues: 0, issues: [] }
    metrics.calls.push(call)

    if (response.refusal !== null) {
      call.issueCount = 1
      return finish({ status: 'failed', reason: 'refusal', issues: [{ path: '$', message: response.refusal }], missingInformation: [], lastOutput: null, metrics })
    }
    lastOutput = response.text
    if (response.json === null) {
      call.issueCount = 1
      const issue = { path: '$', message: 'output was not valid JSON' }
      call.issues = [issue]
      if (attempt === config.maxRepairs) return finish({ status: 'failed', reason: 'unparseable', issues: [issue], missingInformation: [], lastOutput, metrics })
      userTurn = `${user}\n\n${buildRepairPrompt(lastOutput ?? '', [issue], attempt + 1, config.maxRepairs)}`
      continue
    }

    const candidate = evaluateCandidate(response.json, teacher, options.documents)
    lastCandidate = candidate
    call.issueCount = candidate.issues.length
    call.schemaIssues = candidate.schemaIssues
    call.groundingIssues = candidate.groundingIssues
    call.issues = candidate.issues.slice(0, 40)

    if (candidate.spec) {
      metrics.valid = true
      const warnings: string[] = []
      if (budget.truncated) warnings.push('Some source pages were omitted from the planner input for length.')
      for (const doc of options.documents) warnings.push(...doc.warnings.map((w) => `${doc.id}: ${w}`))
      return finish({ status: 'ok', spec: candidate.spec, missingInformation: candidate.missingInformation, warnings, metrics })
    }
    if (attempt === config.maxRepairs) break
    userTurn = `${user}\n\n${buildRepairPrompt(lastOutput ?? '', candidate.issues, attempt + 1, config.maxRepairs)}`
  }

  return finish({
    status: 'failed',
    reason: 'invalid-after-repair',
    issues: lastCandidate?.issues ?? [],
    missingInformation: lastCandidate?.missingInformation ?? [],
    lastOutput,
    metrics,
  })
}
