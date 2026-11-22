import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createOpenAiClient,
  MissingApiKeyError,
  MODEL_BY_TIER,
  toOpenAiStrictSchema,
  type OpenAiClientOptions,
} from '../src/llm/openai'
import type { DecisionRequest } from '../src/llm/types'

const request = {
  modelTier: 'cheap' as const,
  system: 'system instructions',
  user: 'user data',
  schemaName: 'answer',
  jsonSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
}

const decisionRequest: DecisionRequest = {
  name: 'v3_post_turn_check',
  input: [{ role: 'user', content: [{ type: 'input_text', text: 'context' }] }],
  questions: [
    { name: 'asserted', instructions: 'Did the student assert this?' },
    { name: 'flag_abusive', instructions: 'Are the words abusive?' },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OpenAI Responses API adapter', () => {
  it('constructs without a key and reports the missing environment variable on call', async () => {
    const originalKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const client = createOpenAiClient()
      await expect(client.complete(request)).rejects.toBeInstanceOf(MissingApiKeyError)
      await expect(client.complete(request)).rejects.toThrow('OPENAI_API_KEY')
      await expect(client.decide?.(decisionRequest)).rejects.toBeInstanceOf(MissingApiKeyError)
    } finally {
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = originalKey
    }
  })

  it('removes unsupported schema metadata and maps nested oneOf to anyOf', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        choice: {
          $id: 'choice',
          oneOf: [
            { type: 'string', $schema: 'nested-schema' },
            { type: 'number', $id: 'nested-id' },
          ],
        },
      },
      items: [{ $id: 'array-item', oneOf: [{ type: 'boolean' }] }],
    }

    const sanitized = toOpenAiStrictSchema(schema)

    expect(sanitized).toEqual({
      type: 'object',
      properties: {
        choice: {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
      items: [{ anyOf: [{ type: 'boolean' }] }],
    })
    expect(JSON.stringify(sanitized)).not.toContain('$schema')
    expect(JSON.stringify(sanitized)).not.toContain('$id')
  })

  it('maps controls, strict schema format, instructions, input, usage and latency through the Responses API', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"answer":"ok"}',
      model: 'gpt-5-mini',
      service_tier: 'priority',
      usage: {
        input_tokens: 12,
        output_tokens: 7,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 4 },
      },
    })
    const options: OpenAiClientOptions = {
      apiKey: 'test-key',
      models: { cheap: 'override-cheap' },
      client: { responses: { create } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    }
    const client = createOpenAiClient(options)

    const result = await client.complete({
      ...request,
      reasoningEffort: 'minimal',
      verbosity: 'low',
      maxOutputTokens: 400,
      serviceTier: 'fast',
    })
    expect(result.content).toBe('{"answer":"ok"}')
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 7, cachedPromptTokens: 3, reasoningTokens: 4 })
    expect(result.model).toBe('gpt-5-mini')
    expect(result.serviceTier).toBe('priority')
    expect(result.latencyMs).toEqual(expect.any(Number))
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(create).toHaveBeenCalledWith({
      model: 'override-cheap',
      instructions: request.system,
      input: request.user,
      store: false,
      reasoning: { effort: 'minimal' },
      max_output_tokens: 400,
      service_tier: 'fast',
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: request.schemaName,
          schema: request.jsonSchema,
          strict: true,
        },
      },
    })
  })

  it('omits undefined controls while always disabling storage', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{}',
      model: 'gpt-5-nano',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: { responses: { create } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })

    await client.complete(request)

    expect(create).toHaveBeenCalledWith({
      model: MODEL_BY_TIER.cheap,
      instructions: request.system,
      input: request.user,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          schema: request.jsonSchema,
          strict: true,
        },
      },
    })
  })

  it('rewrites the schema into the strict-mode subset: oneOf becomes anyOf, $schema is dropped', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '{}', usage: { input_tokens: 1, output_tokens: 1 } })
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: { responses: { create } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })
    await client.complete({
      ...request,
      jsonSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { actions: { type: 'array', items: { oneOf: [{ type: 'object' }, { type: 'string' }] } } },
      },
    })
    const sent = create.mock.calls[0]![0].text.format.schema
    expect(sent).toEqual({
      type: 'object',
      properties: { actions: { type: 'array', items: { anyOf: [{ type: 'object' }, { type: 'string' }] } } },
    })
    expect(JSON.stringify(sent)).not.toContain('oneOf')
  })

  it('uses the default model mapping for tiers without an override', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{}',
      usage: { input_tokens: 1, output_tokens: 1 },
    })
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: { responses: { create } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })

    await client.complete({ ...request, modelTier: 'frontier' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: MODEL_BY_TIER.frontier }))
  })

  it('routes character tiers to gpt-6-luna and honors an explicit request model', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '{}', usage: { input_tokens: 1, output_tokens: 1 } })
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: { responses: { create } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })

    await client.complete({ ...request, modelTier: 'mid' })
    await client.complete({ ...request, modelTier: 'cheap' })
    await client.complete({ ...request, modelTier: 'frontier', model: 'gpt-6-sol' })

    expect(MODEL_BY_TIER.mid).toBe('gpt-6-luna')
    expect(MODEL_BY_TIER.cheap).toBe('gpt-6-luna')
    expect(create).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'gpt-6-luna' }))
    expect(create).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'gpt-6-luna' }))
    expect(create).toHaveBeenNthCalledWith(3, expect.objectContaining({ model: 'gpt-6-sol' }))
  })

  it('maps predicate questions, named probabilities, usage and latency through Decisions', async () => {
    const create = vi.fn().mockResolvedValue({
      answers: [
        { type: 'predicate', name: null, probability: 0.75 },
        { type: 'predicate', name: 'abuse_override', probability: 0.25 },
        { type: 'refusal', name: 'skipped' },
      ],
      model: 'gpt-6-luna',
      usage: {
        input_tokens: 120,
        input_tokens_details: { cached_tokens: 80 },
        output_tokens: 9,
        output_tokens_details: { reasoning_tokens: 4 },
      },
    })
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: {
        responses: { create: vi.fn() },
        decisions: { create },
      } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })

    const result = await client.decide?.(decisionRequest)

    expect(result).toMatchObject({
      probabilities: { asserted: 0.75, abuse_override: 0.25 },
      usage: { promptTokens: 120, cachedPromptTokens: 80, completionTokens: 9, reasoningTokens: 4 },
      model: 'gpt-6-luna',
      latencyMs: expect.any(Number),
    })
    expect(result?.latencyMs).toBeGreaterThanOrEqual(0)
    expect(create).toHaveBeenCalledWith({
      model: 'gpt-6-luna',
      input: decisionRequest.input,
      questions: [
        { type: 'predicate', name: 'asserted', instructions: 'Did the student assert this?' },
        { type: 'predicate', name: 'flag_abusive', instructions: 'Are the words abusive?' },
      ],
    })
  })

  it('rejects Decisions when the transport does not provide it', async () => {
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: { responses: { create: vi.fn() } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })

    await expect(client.decide?.(decisionRequest)).rejects.toThrow('Decisions')
    await expect(client.decide?.(decisionRequest)).rejects.not.toBeInstanceOf(MissingApiKeyError)
  })

  it('rejects more than 400 Decisions questions before calling the transport', async () => {
    const create = vi.fn()
    const client = createOpenAiClient({
      apiKey: 'test-key',
      client: {
        responses: { create: vi.fn() },
        decisions: { create },
      } as unknown as NonNullable<OpenAiClientOptions['client']>,
    })
    const tooMany: DecisionRequest = {
      ...decisionRequest,
      questions: Array.from({ length: 401 }, (_, index) => ({
        name: `question_${index}`,
        instructions: 'Is this true?',
      })),
    }

    await expect(client.decide?.(tooMany)).rejects.toThrow('400')
    expect(create).not.toHaveBeenCalled()
  })
})
