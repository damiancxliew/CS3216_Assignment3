/**
 * K9 — structured outputs with a bounded repair loop (PRD FR-4 / D14).
 *
 * Every LLM call in this package goes through here, so three things are true by construction:
 * the response is schema-validated before anything reads it, a malformed response gets at most two
 * repair round-trips, and the repair rate is counted rather than estimated (M11/M12 need the
 * number). A repair prompt re-sends the *validation issues*, never the model's excuse for them.
 */
import { z } from 'zod'

import type { LlmClient, LlmRequest, ModelTier, TokenUsage } from './types'

/** FR-4: at most two repair round-trips, then the call fails and the caller degrades. */
export const MAX_REPAIR_ROUNDS = 2

export interface StructuredCall<T> {
  schema: z.ZodType<T>
  schemaName: string
  modelTier: ModelTier
  system: string
  user: string
}

export interface StructuredSuccess<T> {
  ok: true
  value: T
  repairRounds: number
  usage: TokenUsage
}

export interface StructuredFailure {
  ok: false
  issues: string[]
  repairRounds: number
  usage: TokenUsage
}

export type StructuredResult<T> = StructuredSuccess<T> | StructuredFailure

/** Running totals for FR-24 telemetry. One instance per attempt or per eval run. */
export class StructuredCallMetrics {
  calls = 0
  repairedCalls = 0
  repairRounds = 0
  failures = 0
  promptTokens = 0
  completionTokens = 0

  record(result: StructuredResult<unknown>): void {
    this.calls += 1
    this.repairRounds += result.repairRounds
    if (result.repairRounds > 0) this.repairedCalls += 1
    if (!result.ok) this.failures += 1
    this.promptTokens += result.usage.promptTokens
    this.completionTokens += result.usage.completionTokens
  }

  /** Share of calls that needed at least one repair (M11/M12). */
  get repairRate(): number {
    return this.calls === 0 ? 0 : Number((this.repairedCalls / this.calls).toFixed(4))
  }

  get totalTokens(): number {
    return this.promptTokens + this.completionTokens
  }
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '$'}: ${issue.message}`)
}

function parseContent<T>(schema: z.ZodType<T>, content: string): { ok: true; value: T } | { ok: false; issues: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    return { ok: false, issues: [`$: response is not valid JSON (${(error as Error).message})`] }
  }
  const result = schema.safeParse(parsed)
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: describeIssues(result.error) }
}

function repairPrompt(user: string, issues: string[]): string {
  return [
    user,
    '',
    'Your previous response failed schema validation. Return the corrected JSON only.',
    'Validation issues:',
    ...issues.map((issue) => `- ${issue}`),
  ].join('\n')
}

/**
 * Make one schema-validated call, repairing up to `MAX_REPAIR_ROUNDS` times.
 * Never throws on a bad model response — an unrepairable call is a failed result the caller
 * degrades from, because a broken JSON blob must not take a turn down with it.
 */
export async function callStructured<T>(
  client: LlmClient,
  call: StructuredCall<T>,
  metrics?: StructuredCallMetrics,
): Promise<StructuredResult<T>> {
  const jsonSchema = z.toJSONSchema(call.schema, { io: 'output' })
  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0 }
  let user = call.user
  let issues: string[] = []

  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    const request: LlmRequest = {
      modelTier: call.modelTier,
      system: call.system,
      user,
      schemaName: call.schemaName,
      jsonSchema,
    }
    const response = await client.complete(request)
    usage.promptTokens += response.usage.promptTokens
    usage.completionTokens += response.usage.completionTokens

    const parsed = parseContent(call.schema, response.content)
    if (parsed.ok) {
      const result: StructuredSuccess<T> = { ok: true, value: parsed.value, repairRounds: round, usage }
      metrics?.record(result)
      return result
    }
    issues = parsed.issues
    user = repairPrompt(call.user, issues)
  }

  const result: StructuredFailure = { ok: false, issues, repairRounds: MAX_REPAIR_ROUNDS, usage }
  metrics?.record(result)
  return result
}
