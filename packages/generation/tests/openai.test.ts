import { afterEach, describe, expect, it, vi } from 'vitest'

import { OpenAiLlmClient, PendingResponseError } from '../src/llm/openai'

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

describe('OpenAiLlmClient background responses', () => {
  it('persists the response id before throwing when polling exceeds its budget', async () => {
    vi.useFakeTimers()
    const events: string[] = []
    const response = {
      id: 'resp_pending',
      status: 'in_progress',
      output: [],
      output_text: '',
      model: 'gpt-test',
      usage: null,
      error: null,
    }
    const create = vi.fn().mockResolvedValue(response)
    const retrieve = vi.fn().mockImplementation(async () => {
      events.push('poll')
      return response
    })
    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      background: true,
      maxRetries: 0,
      pollBudgetMs: 100,
      pollIntervalMs: 1_000,
      onResponseCreated: (id) => { events.push(`created:${id}`) },
    })
    ;(client as unknown as { client: { responses: { create: typeof create; retrieve: typeof retrieve } } }).client = {
      responses: { create, retrieve },
    }

    const pending = client.completeJson(request).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1_000)

    const error = await pending
    expect(error).toBeInstanceOf(PendingResponseError)
    expect(error).toMatchObject({ responseId: 'resp_pending' })
    expect(events).toEqual(['created:resp_pending', 'poll'])
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ background: true, store: false }), expect.any(Object))
    expect(retrieve).toHaveBeenCalledOnce()
  })

  it('resumes an existing response instead of creating a new one', async () => {
    const create = vi.fn()
    const retrieve = vi.fn().mockResolvedValue({
      id: 'resp_done',
      status: 'completed',
      output: [],
      output_text: '{"ok":true}',
      model: 'gpt-test',
      usage: null,
      error: null,
    })
    const client = new OpenAiLlmClient({
      apiKey: 'test-key',
      background: true,
      resumeResponseId: 'resp_done',
      maxRetries: 0,
    })
    ;(client as unknown as { client: { responses: { create: typeof create; retrieve: typeof retrieve } } }).client = {
      responses: { create, retrieve },
    }

    const result = await client.completeJson(request)

    expect(create).not.toHaveBeenCalled()
    expect(retrieve).toHaveBeenCalledWith('resp_done', undefined, expect.any(Object))
    expect(result.json).toEqual({ ok: true })
  })
})
