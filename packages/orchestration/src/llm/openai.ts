/**
 * Opt-in OpenAI Responses API adapter for the shared LLM seam.
 *
 * Construction stays inert without OPENAI_API_KEY so imports, tests and fake-backed runtimes do
 * not need credentials. The first real call reports the missing configuration instead.
 */
import OpenAI from 'openai'
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'

import type { LlmClient, LlmRequest, ModelTier } from './types'

export const MODEL_BY_TIER: Record<ModelTier, string> = {
  frontier: 'gpt-5',
  mid: 'gpt-5-mini',
  cheap: 'gpt-5-nano',
}

export interface OpenAiClientOptions {
  apiKey?: string
  models?: Partial<Record<ModelTier, string>>
  client?: OpenAiTransport
}

export interface OpenAiTransport {
  responses: Pick<OpenAI['responses'], 'create'>
}

export class MissingApiKeyError extends Error {
  readonly envVar = 'OPENAI_API_KEY'

  constructor() {
    super('OpenAI client requires OPENAI_API_KEY; set OPENAI_API_KEY before making a request')
    this.name = 'MissingApiKeyError'
  }
}

/**
 * OpenAI strict structured outputs accept a JSON Schema subset: `oneOf` is rejected (Zod emits it
 * for discriminated unions, which are disjoint anyway, so `anyOf` means the same) and `$schema` /
 * `$id` are noise. Same rewrite as the generation package's planner adapter.
 */
export function toOpenAiStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$schema' || key === '$id') continue
      out[key === 'oneOf' ? 'anyOf' : key] = walk(value)
    }
    return out
  }
  return walk(schema) as Record<string, unknown>
}

export function createOpenAiClient(options: OpenAiClientOptions = {}): LlmClient {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY
  const client = options.client ?? (apiKey === undefined || apiKey === '' ? undefined : new OpenAI({ apiKey }))
  const models = { ...MODEL_BY_TIER, ...options.models }

  return {
    async complete(request: LlmRequest) {
      if (client === undefined) throw new MissingApiKeyError()

      const params: ResponseCreateParamsNonStreaming = {
        model: models[request.modelTier],
        instructions: request.system,
        input: request.user,
        text: {
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: toOpenAiStrictSchema(request.jsonSchema as Record<string, unknown>),
            strict: true,
          },
        },
      }
      const response = await client.responses.create(params)
      if (response.usage === undefined) throw new Error('OpenAI response did not include usage')
      return {
        content: response.output_text,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
      }
    },
  }
}
