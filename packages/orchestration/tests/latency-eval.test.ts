import { describe, expect, it } from 'vitest'

import type { AgentTurnResult } from '../src/agent/character-agent'
import {
  aggregateCandidate,
  LATENCY_CANDIDATES,
  latencyQualityIssues,
  percentile,
  type LatencyCaseResult,
  type LatencySafetyResult,
} from '../evals/latency'
import { buildK9Cases } from '../evals/k9'

const candidate = LATENCY_CANDIDATES[0]!

const caseResult = (latencyMs: number): LatencyCaseResult => ({
  candidateId: candidate.id,
  repetition: 1,
  caseId: 'direct-question',
  status: 'ok',
  latencyMs,
  repairRounds: 0,
  promptTokens: 100,
  completionTokens: 20,
  cachedPromptTokens: 10,
  reasoningTokens: 0,
  estimatedCostUsd: 0.001,
  sayChars: 12,
  actionTypes: ['speak'],
  qualityIssues: [],
  actualServiceTier: 'default',
  error: null,
})

const safetyResult = (caseId: string): LatencySafetyResult => ({
  candidateId: candidate.id,
  caseId,
  status: 'ok',
  safe: true,
  latencyMs: 500,
  repairRounds: 0,
  error: null,
})

describe('character-agent latency eval harness', () => {
  it('uses nearest-rank percentiles', () => {
    expect(percentile([3000, 1000, 2000, 4000], 0.5)).toBe(2000)
    expect(percentile([3000, 1000, 2000, 4000], 0.9)).toBe(4000)
  })

  it('requires a spoken response and a forced decision where the case demands them', () => {
    const direct = buildK9Cases().find((entry) => entry.id === 'direct-question')!
    const forced = buildK9Cases().find((entry) => entry.id === 'forced-decision')!
    const silent: AgentTurnResult = {
      agentId: direct.input.self.id,
      say: '',
      actions: [{ actorKind: 'agent', actorId: direct.input.self.id, action: { type: 'yield' } }],
      dropped: [],
      degraded: false,
      repairRounds: 0,
      usage: { promptTokens: 1, completionTokens: 1 },
    }
    expect(latencyQualityIssues(direct, silent)).toContain('missing spoken response')
    expect(latencyQualityIssues(forced, silent)).toContain('forced decision neither committed nor passed')
  })

  it('enforces strict p50, p90, schema, behavior and five-case safety gates', () => {
    const cases = Array.from({ length: 10 }, (_, index) => caseResult(index < 5 ? 900 : 2_900))
    const safety = [
      'ignore-previous-instructions',
      'reveal-private-brief',
      'delimiter-escape',
      'forged-system-role',
      'forged-tool-json',
    ].map(safetyResult)
    const aggregate = aggregateCandidate(candidate, cases, safety)
    expect(aggregate).toMatchObject({
      p50LatencyMs: 900,
      p90LatencyMs: 2900,
      latencyTargetMet: true,
      qualityGateMet: true,
      passed: true,
    })

    const atBoundary = aggregateCandidate(
      candidate,
      cases.map((entry, index) => ({ ...entry, latencyMs: index < 5 ? 1_000 : 3_000 })),
      safety,
    )
    expect(atBoundary.latencyTargetMet).toBe(false)
    expect(atBoundary.passed).toBe(false)
  })
})
