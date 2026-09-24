import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpenAiLlmClient } from '../src/llm/openai'

const request = {
  model: 'gpt-test',
  system: 'Return JSON.',
  user: 'Make a test object.',
  schemaName: 'test_object',
  jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
  maxOutputTokens: 100,
  reasoningEffort: null,
} as const

afterEach(() => vi.useRealTimers())

describe('OpenAiLlmClient deadlines', () => {
  it('caps each request at the time left in the shared deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'))

    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      timeoutMs: 1_000,
      maxRetries: 0,
      deadlineMs: 5_000,
    })
    const create = vi.fn().mockResolvedValue({
      output: [],
      output_text: '{}',
      model: 'gpt-test',
      usage: null,
    })
    ;(client as unknown as { client: { responses: { create: typeof create } } }).client = {
      responses: { create },
    }

    vi.setSystemTime(new Date('2026-09-24T00:00:04.900Z'))
    await client.completeJson(request)

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]?.[1]).toMatchObject({ timeout: 100, maxRetries: 0 })
  })

  it('does not start another request after the shared deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'))

    const client = new OpenAiLlmClient({ apiKey: 'test-key', deadlineMs: 10 })
    const create = vi.fn()
    ;(client as unknown as { client: { responses: { create: typeof create } } }).client = {
      responses: { create },
    }

    vi.setSystemTime(new Date('2026-09-24T00:00:00.011Z'))
    await expect(client.completeJson(request)).rejects.toThrow(/time limit/)
    expect(create).not.toHaveBeenCalled()
  })
})
