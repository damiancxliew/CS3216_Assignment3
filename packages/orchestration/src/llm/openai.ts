/**
 * Opt-in OpenAI Responses API adapter for the shared LLM seam.
 *
 * Construction stays inert without OPENAI_API_KEY so imports, tests and fake-backed runtimes do
 * not need credentials. The first real call reports the missing configuration instead.
 */
import OpenAI from 'openai'
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'

import type { DecisionRequest, DecisionResponse, LlmClient, LlmRequest, ModelTier } from './types'

export const MODEL_BY_TIER: Record<ModelTier, string> = {
  frontier: 'gpt-5',
  mid: 'gpt-6-luna',
  cheap: 'gpt-6-luna',
}

export const DECISION_MODEL = 'gpt-6-luna'

export interface OpenAiClientOptions {
  apiKey?: string
  models?: Partial<Record<ModelTier, string>>
  client?: OpenAiTransport
}

export interface OpenAiTransport {
  responses: Pick<OpenAI['responses'], 'create'>
  decisions?: Pick<OpenAI['decisions'], 'create'>
}

export function toOpenAiStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== 'object') return node
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$schema' || key === '$id') continue
      output[key === 'oneOf' ? 'anyOf' : key] = walk(value)
    }
    return output
  }
  return walk(schema) as Record<string, unknown>
}

export class MissingApiKeyError extends Error {
  readonly envVar = 'OPENAI_API_KEY'

  constructor() {
    super('OpenAI client requires OPENAI_API_KEY; set OPENAI_API_KEY before making a request')
    this.name = 'MissingApiKeyError'
  }
}

export function createOpenAiClient(options: OpenAiClientOptions = {}): LlmClient {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY
  const client = options.client ?? (apiKey === undefined || apiKey === '' ? undefined : new OpenAI({ apiKey }))
  const models = { ...MODEL_BY_TIER, ...options.models }

  return {
    async complete(request: LlmRequest) {
      if (client === undefined) throw new MissingApiKeyError()

      const params: ResponseCreateParamsNonStreaming = {
        model: request.model ?? models[request.modelTier],
        instructions: request.system,
        input: request.user,
        store: false,
        ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort } }),
        ...(request.maxOutputTokens === undefined ? {} : { max_output_tokens: request.maxOutputTokens }),
        ...(request.serviceTier === undefined ? {} : { service_tier: request.serviceTier }),
        text: {
          ...(request.verbosity === undefined ? {} : { verbosity: request.verbosity }),
          format: {
            type: 'json_schema',
            name: request.schemaName,
            schema: toOpenAiStrictSchema(request.jsonSchema as Record<string, unknown>),
            strict: true,
          },
        },
      }
      const startedAt = performance.now()
      const response = await client.responses.create(params)
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))
      if (response.usage === undefined) throw new Error('OpenAI response did not include usage')
      const usage = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        ...(response.usage.input_tokens_details?.cached_tokens === undefined
          ? {}
          : { cachedPromptTokens: response.usage.input_tokens_details.cached_tokens }),
        ...(response.usage.output_tokens_details?.reasoning_tokens === undefined
          ? {}
          : { reasoningTokens: response.usage.output_tokens_details.reasoning_tokens }),
      }
      return {
        content: response.output_text,
        usage,
        model: response.model,
        latencyMs,
        ...(response.service_tier === undefined || response.service_tier === null
          ? {}
          : { serviceTier: response.service_tier }),
      }
    },
    async decide(request: DecisionRequest): Promise<DecisionResponse> {
      if (client === undefined) throw new MissingApiKeyError()
      if (client.decisions === undefined) throw new Error('OpenAI transport does not support Decisions')
      if (request.questions.length > 400) throw new Error('OpenAI Decisions supports at most 400 questions')

      const startedAt = performance.now()
      const response = await client.decisions.create({
        model: DECISION_MODEL,
        input: request.input as never,
        questions: request.questions.map((question) => ({
          type: 'predicate',
          name: question.name,
          instructions: question.instructions,
        })),
      })
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))
      const probabilities: Record<string, number> = {}
      response.answers.forEach((answer, index) => {
        if (answer.type !== 'predicate') return
        const name = answer.name ?? request.questions[index]?.name
        if (name !== undefined) probabilities[name] = answer.probability
      })
      return {
        probabilities,
        usage: {
          promptTokens: response.usage.input_tokens,
          cachedPromptTokens: response.usage.input_tokens_details.cached_tokens,
          completionTokens: response.usage.output_tokens,
          reasoningTokens: response.usage.output_tokens_details.reasoning_tokens,
        },
        model: response.model,
        latencyMs,
      }
    },
  }
}
