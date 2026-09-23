import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { FakeLlmClient } from '../src/llm/fake'
import { MAX_REPAIR_ROUNDS, StructuredCallMetrics, callStructured } from '../src/llm/structured'

const schema = z.object({ answer: z.string().min(1) })

const call = {
  schema,
  schemaName: 'test_answer',
  modelTier: 'cheap' as const,
  system: 'system',
  user: 'user',
}

describe('structured outputs with bounded repair (K9/FR-4)', () => {
  it('passes the response schema to the provider as JSON Schema', async () => {
    const client = new FakeLlmClient({ replies: [JSON.stringify({ answer: 'yes' })] })
    await callStructured(client, call)
    expect(client.lastRequest?.schemaName).toBe('test_answer')
    expect(client.lastRequest?.jsonSchema).toMatchObject({ type: 'object', required: ['answer'] })
  })

  it('forwards service tier controls through the provider request', async () => {
    const client = new FakeLlmClient({ replies: [JSON.stringify({ answer: 'yes' })] })
    await callStructured(client, { ...call, serviceTier: 'fast' })
    expect(client.lastRequest?.serviceTier).toBe('fast')
  })

  it('stops after at most two repair rounds', async () => {
    const client = new FakeLlmClient({ replies: ['{}'] })
    const result = await callStructured(client, call)
    expect(client.requests).toHaveLength(MAX_REPAIR_ROUNDS + 1)
    expect(result.ok).toBe(false)
    expect(result.repairRounds).toBe(MAX_REPAIR_ROUNDS)
  })

  it('repairs from the validation issues, not from the bad response', async () => {
    const client = new FakeLlmClient({ replies: ['{}', JSON.stringify({ answer: 'fixed' })] })
    const result = await callStructured(client, call)
    expect(result.ok && result.value.answer).toBe('fixed')
    const repair = client.requests[1]?.user ?? ''
    expect(repair).toContain('answer:')
    expect(repair).not.toContain('{}')
  })

  it('accumulates repair rate and token usage across calls', async () => {
    const metrics = new StructuredCallMetrics()
    const clean = new FakeLlmClient({ replies: [JSON.stringify({ answer: 'a' })] })
    const dirty = new FakeLlmClient({ replies: ['{}', JSON.stringify({ answer: 'b' })] })
    await callStructured(clean, call, metrics)
    await callStructured(dirty, call, metrics)
    expect(metrics.calls).toBe(2)
    expect(metrics.repairedCalls).toBe(1)
    expect(metrics.repairRate).toBe(0.5)
    expect(metrics.totalTokens).toBeGreaterThan(0)
  })
})
