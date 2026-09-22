import { describe, expect, it } from 'vitest'

import {
  buildK9Cases,
  estimateK9Cost,
  renderK9Results,
  summarizeK9Results,
  type K9CaseResult,
} from '../evals/k9'

describe('K9 character-agent eval harness', () => {
  it('defines a fixed, unique ten-case corpus through the real agent input shape', () => {
    const cases = buildK9Cases()
    expect(cases).toHaveLength(10)
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length)
    expect(cases.find((entry) => entry.id === 'forced-decision')?.input.mustDecide).toBe(true)
    expect(cases.find((entry) => entry.id === 'instruction-injection')?.input.playerMessage).toContain(
      'Ignore previous instructions',
    )
    for (const entry of cases) expect(entry.input.privateContext.agentId).toBe(entry.input.self.id)
  })

  it('uses the recorded gpt-5-mini list prices', () => {
    expect(estimateK9Cost(1_000_000, 1_000_000)).toBe(2.25)
  })

  it('aggregates repairs, failures, tokens, latency and cost without rerunning cases', () => {
    const cases: K9CaseResult[] = [
      {
        id: 'clean',
        status: 'ok',
        latencyMs: 1000,
        repairRounds: 0,
        structuredCalls: 1,
        structuredFailures: 0,
        promptTokens: 100,
        completionTokens: 20,
        estimatedCostUsd: estimateK9Cost(100, 20),
        sayChars: 12,
        actionTypes: ['speak'],
        droppedActions: 0,
        error: null,
      },
      {
        id: 'repaired',
        status: 'degraded',
        latencyMs: 3000,
        repairRounds: 2,
        structuredCalls: 1,
        structuredFailures: 1,
        promptTokens: 300,
        completionTokens: 40,
        estimatedCostUsd: estimateK9Cost(300, 40),
        sayChars: 0,
        actionTypes: ['yield'],
        droppedActions: 0,
        error: null,
      },
    ]
    const summary = summarizeK9Results('fixture', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:04.000Z', cases)
    expect(summary.aggregate).toMatchObject({
      caseCount: 2,
      successfulCases: 1,
      degradedCases: 1,
      apiErrors: 0,
      structuredCalls: 2,
      repairedCalls: 1,
      repairRate: 0.5,
      repairRounds: 2,
      structuredFailures: 1,
      promptTokens: 400,
      completionTokens: 60,
      totalTokens: 460,
      meanLatencyMs: 2000,
      p50LatencyMs: 1000,
      p95LatencyMs: 3000,
    })
    expect(renderK9Results(summary)).toContain('Repair rate: 50.0% (1/2 calls)')
  })
})
