/**
 * Minimal LLM boundary for the generation pipeline (PRD D14: OpenAI only,
 * tiered per call). Everything the planner needs is "give me JSON that matches
 * this schema, and tell me what it cost". The fake implementation lets the
 * pipeline, repair loop and eval harness run with no network.
 */
import type { ModelTier } from '../spec/catalogue'

export interface LlmUsage {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
}

export interface LlmJsonRequest {
  model: string
  /** System/developer instructions. Never contains source-document text. */
  system: string
  /** User turn. Source documents and teacher input live here, delimited. */
  user: string
  schemaName: string
  /** JSON Schema (draft 2020-12, strict-friendly) the output must satisfy. */
  jsonSchema: Record<string, unknown>
  maxOutputTokens: number
  reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | null
}

export interface LlmJsonResponse {
  /** Raw output text; `null` on refusal or when the model produced nothing. */
  text: string | null
  /** `JSON.parse(text)` if it parsed, else `null`. */
  json: unknown
  refusal: string | null
  usage: LlmUsage
  model: string
  latencyMs: number
}

export interface LlmClient {
  completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse>
}

/** USD per 1M tokens (developers.openai.com/api/docs/pricing, read 20 Sep 2026). */
export const PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
}

/** Default model per tier. Yi Hao pins the final choice (EXECUTION_SPEC §6.1); env overrides win. */
export const DEFAULT_MODELS: Record<ModelTier, string> = {
  frontier: process.env.LLM_MODEL_FRONTIER ?? 'gpt-5.4',
  mid: process.env.LLM_MODEL_MID ?? 'gpt-5.4-mini',
  cheap: process.env.LLM_MODEL_CHEAP ?? 'gpt-5.6-luna',
}

export function estimateCostUsd(model: string, usage: LlmUsage): number | null {
  const price = PRICING[model] ?? PRICING[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')]
  if (!price) return null
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens)
  return (uncached * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) / 1_000_000
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  }
}

export function tryParseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export type FakeReply = { json: unknown } | { text: string } | { refusal: string } | { error: string }

/**
 * Scripted client for tests and the offline eval mode. Replies are consumed in
 * order; every request is recorded so tests can assert on prompt contents
 * (e.g. that document text never appears in `system`).
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmJsonRequest[] = []
  private readonly replies: FakeReply[]

  constructor(replies: FakeReply[], private readonly usagePerCall: LlmUsage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, reasoningTokens: 0 }) {
    this.replies = [...replies]
  }

  async completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    this.requests.push(request)
    const reply = this.replies.shift()
    if (!reply) throw new Error('FakeLlmClient: no scripted reply left')
    if ('error' in reply) throw new Error(reply.error)
    const base = { usage: this.usagePerCall, model: request.model, latencyMs: 1 }
    if ('refusal' in reply) return { ...base, text: null, json: null, refusal: reply.refusal }
    const text = 'json' in reply ? JSON.stringify(reply.json) : reply.text
    return { ...base, text, json: tryParseJson(text), refusal: null }
  }
}
