/**
 * OpenAI Responses API adapter with strict structured outputs (PRD D14).
 * The API key stays server-side; this module is never imported by client code.
 */
import OpenAI, { NotFoundError } from 'openai'

import { type LlmClient, type LlmJsonRequest, type LlmJsonResponse, tryParseJson } from './client'

export interface OpenAiClientOptions {
  apiKey?: string
  /** Strict mode guarantees schema adherence; turn off only to debug a schema the API rejects. */
  strict?: boolean
  timeoutMs?: number
  maxRetries?: number
  /** Run the request as an OpenAI background response so it survives this invocation. */
  background?: boolean
  /** Poll this in-flight background response instead of creating a new one. */
  resumeResponseId?: string | null
  /** Called as soon as a background response id exists, before any polling. */
  onResponseCreated?: (responseId: string) => void | Promise<void>
  /** Wall-clock budget for polling inside one invocation (default 200_000). */
  pollBudgetMs?: number
  /** Default 2_000. */
  pollIntervalMs?: number
  /**
   * Total wall-clock budget shared by every request made through this client.
   * This is useful when several planner/repair calls run inside one serverless
   * invocation and must leave time for persistence before the host deadline.
   */
  deadlineMs?: number
}

export class PendingResponseError extends Error {
  constructor(readonly responseId: string) {
    super(`Model response ${responseId} is still running`)
  }
}

/**
 * OpenAI strict structured outputs accept a JSON Schema subset. Rewrite what
 * Zod emits into that subset without changing meaning: `oneOf` -> `anyOf`
 * (discriminated unions are disjoint anyway) and drop `$schema`/`$id`.
 */
export function toOpenAiStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$schema' || key === '$id' || key === 'default') continue
      out[key === 'oneOf' ? 'anyOf' : key] = walk(value)
    }
    return out
  }
  return walk(schema) as Record<string, unknown>
}

export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI
  private readonly strict: boolean
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly deadlineAt: number | null
  private readonly background: boolean
  private readonly resumeResponseId: string | null
  private readonly onResponseCreated: OpenAiClientOptions['onResponseCreated']
  private readonly pollBudgetMs: number
  private readonly pollIntervalMs: number

  constructor(options: OpenAiClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    this.timeoutMs = options.timeoutMs ?? 300_000
    this.maxRetries = options.maxRetries ?? 2
    this.deadlineAt = options.deadlineMs === undefined ? null : Date.now() + options.deadlineMs
    this.client = new OpenAI({ apiKey, timeout: this.timeoutMs, maxRetries: this.maxRetries })
    this.strict = options.strict ?? true
    this.background = options.background ?? false
    this.resumeResponseId = options.resumeResponseId ?? null
    this.onResponseCreated = options.onResponseCreated
    this.pollBudgetMs = options.pollBudgetMs ?? 200_000
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000
  }

  async completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const remainingMs = this.deadlineAt === null ? this.timeoutMs : this.deadlineAt - Date.now()
    if (remainingMs <= 0) {
      throw new Error('Generation reached its time limit before another model call could start')
    }

    const started = Date.now()
    let response
    if (this.background) {
      if (this.resumeResponseId) {
        try {
          response = await this.client.responses.retrieve(this.resumeResponseId, undefined, {
            timeout: Math.min(this.timeoutMs, remainingMs),
            maxRetries: this.maxRetries,
          })
        } catch (error) {
          if (!(error instanceof NotFoundError) && !(error && typeof error === 'object' && (error as { status?: unknown }).status === 404)) {
            throw error
          }
        }
      }
      if (!response) {
        response = await this.client.responses.create({
          model: request.model,
          instructions: request.system,
          input: [{ role: 'user', content: request.user }],
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName,
              schema: toOpenAiStrictSchema(request.jsonSchema),
              strict: this.strict,
            },
          },
          max_output_tokens: request.maxOutputTokens,
          ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
          background: true,
          store: false,
        }, {
          timeout: Math.min(this.timeoutMs, remainingMs),
          maxRetries: this.maxRetries,
        })
        await this.onResponseCreated?.(response.id)
      }
      const pollDeadline = Date.now() + this.pollBudgetMs
      while (response.status === 'queued' || response.status === 'in_progress') {
        if (Date.now() >= pollDeadline) throw new PendingResponseError(response.id)
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs))
        response = await this.client.responses.retrieve(response.id, undefined, {
          timeout: this.timeoutMs,
          maxRetries: this.maxRetries,
        })
      }
      if (response.status === 'failed') throw new Error(response.error?.message ?? 'model response failed')
      if (response.status === 'cancelled') throw new Error('model response cancelled')
    } else {
      response = await this.client.responses.create({
        model: request.model,
        instructions: request.system,
        input: [{ role: 'user', content: request.user }],
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: toOpenAiStrictSchema(request.jsonSchema),
            strict: this.strict,
          },
        },
        max_output_tokens: request.maxOutputTokens,
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
        store: false,
      }, {
        timeout: Math.min(this.timeoutMs, remainingMs),
        maxRetries: this.maxRetries,
      })
    }
    const latencyMs = Date.now() - started

    let refusal: string | null = null
    for (const item of response.output) {
      if (item.type !== 'message') continue
      for (const part of item.content) if (part.type === 'refusal') refusal = part.refusal
    }
    const text = refusal ? null : response.output_text || null
    const usage = response.usage
    return {
      text,
      json: tryParseJson(text),
      refusal,
      model: response.model,
      latencyMs,
      usage: {
        inputTokens: usage?.input_tokens ?? 0,
        cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
      },
    }
  }
}
