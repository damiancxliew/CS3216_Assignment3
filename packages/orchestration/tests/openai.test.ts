import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createOpenAiClient,
  MissingApiKeyError,
  MODEL_BY_TIER,
  toOpenAiStrictSchema,
  type OpenAiClientOptions,
} from '../src/llm/openai'

const request = {
  modelTier: 'cheap' as const,
  system: 'system instructions',
  user: 'user data',
  schemaName: 'answer',
  jsonSchema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
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

  it('maps tier, strict schema format, instructions, input and usage through the Responses API', async () => {
    const create = vi.fn().mockResolvedValue({
      output_text: '{"answer":"ok"}',
      usage: { input_tokens: 12, output_tokens: 7 },
    })
    const options: OpenAiClientOptions = {
      apiKey: 'test-key',
      models: { cheap: 'override-cheap' },
      client: { responses: { create } } as unknown as NonNullable<OpenAiClientOptions['client']>,
    }
    const client = createOpenAiClient(options)

    const result = await client.complete(request)
    expect(result).toEqual({
      content: '{"answer":"ok"}',
      usage: { promptTokens: 12, completionTokens: 7 },
    })
    expect(create).toHaveBeenCalledWith({
      model: 'override-cheap',
      instructions: request.system,
      input: request.user,
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
})
