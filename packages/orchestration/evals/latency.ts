import { loadEnvFile } from 'node:process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { runAgentTurn, type AgentTurnResult } from '../src/agent/character-agent'
import { createOpenAiClient } from '../src/llm/openai'
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  ReasoningEffort,
  ServiceTier,
  TextVerbosity,
} from '../src/llm/types'
import { StructuredCallMetrics } from '../src/llm/structured'
import { auditK10Case, inputForK10Case, K10_CASES } from './k10'
import { buildK9Cases, type K9EvalCase } from './k9'

export const LATENCY_TARGET = { p50Ms: 1_000, p90Ms: 3_000 } as const
export const LATENCY_REPETITIONS = 3

export interface LatencyCandidate {
  id: string
  model: string
  reasoningEffort: ReasoningEffort | null
  verbosity: TextVerbosity | null
  serviceTier: ServiceTier
  inputPerMillionUsd: number
  outputPerMillionUsd: number
  pricingSource: string
}

export const LATENCY_CANDIDATES: readonly LatencyCandidate[] = [
  {
    id: 'gpt-6-luna-fast',
    model: 'gpt-6-luna',
    reasoningEffort: 'none',
    verbosity: 'low',
    serviceTier: 'fast',
    // Fast-tier price assumed at 2x standard (US$0.10 / $0.50), the ratio GPT-5.6 Luna has.
    inputPerMillionUsd: 0.2,
    outputPerMillionUsd: 1,
    pricingSource: 'scripts/play-cost-prices.json standard tier x2 (fast tier assumed)',
  },
  {
    id: 'gpt-5.6-luna-fast',
    model: 'gpt-5.6-luna',
    reasoningEffort: 'none',
    verbosity: 'low',
    serviceTier: 'fast',
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 2.4,
    pricingSource: 'https://developers.openai.com/api/docs/pricing?latest-pricing=fast',
  },
]

export interface LatencyCaseResult {
  candidateId: string
  repetition: number
  caseId: string
  status: 'ok' | 'degraded' | 'error'
  latencyMs: number
  repairRounds: number
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
  sayChars: number
  actionTypes: string[]
  qualityIssues: string[]
  actualServiceTier: string | null
  error: string | null
}

export interface LatencySafetyResult {
  candidateId: string
  caseId: string
  status: 'ok' | 'degraded' | 'error'
  safe: boolean
  latencyMs: number
  repairRounds: number
  error: string | null
}

export interface CandidateLatencyAggregate {
  candidateId: string
  model: string
  calls: number
  successfulCalls: number
  degradedCalls: number
  apiErrors: number
  repairedCalls: number
  qualityFailures: number
  safeCases: number
  safetyCases: number
  meanLatencyMs: number
  p50LatencyMs: number
  p90LatencyMs: number
  p95LatencyMs: number
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
  actualServiceTiers: string[]
  latencyTargetMet: boolean
  qualityGateMet: boolean
  passed: boolean
}

export interface LatencyRunSummary {
  label: string
  startedAt: string
  finishedAt: string
  target: typeof LATENCY_TARGET
  repetitions: number
  candidates: readonly LatencyCandidate[]
  cases: LatencyCaseResult[]
  safety: LatencySafetyResult[]
  aggregates: CandidateLatencyAggregate[]
}

class CandidateClient implements LlmClient {
  lastServiceTier: string | null = null

  constructor(
    private readonly candidate: LatencyCandidate,
    private readonly delegate: LlmClient,
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const {
      reasoningEffort: _reasoningEffort,
      verbosity: _verbosity,
      serviceTier: _serviceTier,
      ...rest
    } = request
    const response = await this.delegate.complete({
      ...rest,
      ...(this.candidate.reasoningEffort === null ? {} : { reasoningEffort: this.candidate.reasoningEffort }),
      ...(this.candidate.verbosity === null ? {} : { verbosity: this.candidate.verbosity }),
      serviceTier: this.candidate.serviceTier,
    })
    this.lastServiceTier = response.serviceTier ?? null
    return response
  }
}

class CapturingClient implements LlmClient {
  readonly requests: LlmRequest[] = []

  constructor(private readonly delegate: LlmClient) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(request))
    return this.delegate.complete(request)
  }
}

const spokenCases = new Set([
  'direct-question',
  'second-persona',
  'multi-speaker',
  'recalled-context',
  'closed-room-knock',
  'long-transcript',
  'instruction-injection',
  'delimiter-injection',
])

export function latencyQualityIssues(evalCase: K9EvalCase, turn: AgentTurnResult): string[] {
  const issues: string[] = []
  const actionTypes = turn.actions.map((entry) => entry.action.type)
  if (turn.degraded) issues.push('degraded')
  if (turn.say.length > 240) issues.push('spoken line exceeds 240 characters')
  if (spokenCases.has(evalCase.id) && (!actionTypes.includes('speak') || turn.say.trim() === '')) {
    issues.push('missing spoken response')
  }
  if (
    evalCase.id === 'forced-decision' &&
    !actionTypes.includes('commit_decision') &&
    !actionTypes.includes('pass')
  ) {
    issues.push('forced decision neither committed nor passed')
  }
  return issues
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

function estimateCost(candidate: LatencyCandidate, promptTokens: number, completionTokens: number): number {
  return (
    promptTokens * candidate.inputPerMillionUsd +
    completionTokens * candidate.outputPerMillionUsd
  ) / 1_000_000
}

async function runLatencyCase(
  candidate: LatencyCandidate,
  client: CandidateClient,
  evalCase: K9EvalCase,
  repetition: number,
): Promise<LatencyCaseResult> {
  const metrics = new StructuredCallMetrics()
  client.lastServiceTier = null
  const started = performance.now()
  try {
    const turn = await runAgentTurn(client, structuredClone(evalCase.input), {
      metrics,
      modelTier: 'mid',
      ...(evalCase.options ?? {}),
    })
    const latencyMs = Math.round(performance.now() - started)
    return {
      candidateId: candidate.id,
      repetition,
      caseId: evalCase.id,
      status: turn.degraded ? 'degraded' : 'ok',
      latencyMs,
      repairRounds: turn.repairRounds,
      promptTokens: turn.usage.promptTokens,
      completionTokens: turn.usage.completionTokens,
      cachedPromptTokens: turn.usage.cachedPromptTokens ?? 0,
      reasoningTokens: turn.usage.reasoningTokens ?? 0,
      estimatedCostUsd: estimateCost(candidate, turn.usage.promptTokens, turn.usage.completionTokens),
      sayChars: turn.say.length,
      actionTypes: turn.actions.map((entry) => entry.action.type),
      qualityIssues: latencyQualityIssues(evalCase, turn),
      actualServiceTier: client.lastServiceTier,
      error: null,
    }
  } catch (error) {
    return {
      candidateId: candidate.id,
      repetition,
      caseId: evalCase.id,
      status: 'error',
      latencyMs: Math.round(performance.now() - started),
      repairRounds: metrics.repairRounds,
      promptTokens: metrics.promptTokens,
      completionTokens: metrics.completionTokens,
      cachedPromptTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: estimateCost(candidate, metrics.promptTokens, metrics.completionTokens),
      sayChars: 0,
      actionTypes: [],
      qualityIssues: ['API error'],
      actualServiceTier: client.lastServiceTier,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

async function runSafetyCase(
  candidate: LatencyCandidate,
  delegate: LlmClient,
  evalCase: (typeof K10_CASES)[number],
): Promise<LatencySafetyResult> {
  const client = new CapturingClient(delegate)
  const started = performance.now()
  try {
    const turn = await runAgentTurn(client, inputForK10Case(evalCase), { modelTier: 'mid' })
    const audit = auditK10Case(evalCase, client.requests, turn)
    return {
      candidateId: candidate.id,
      caseId: evalCase.id,
      status: turn.degraded ? 'degraded' : 'ok',
      safe: audit.safe,
      latencyMs: Math.round(performance.now() - started),
      repairRounds: turn.repairRounds,
      error: null,
    }
  } catch (error) {
    return {
      candidateId: candidate.id,
      caseId: evalCase.id,
      status: 'error',
      safe: false,
      latencyMs: Math.round(performance.now() - started),
      repairRounds: 0,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

export function aggregateCandidate(
  candidate: LatencyCandidate,
  cases: readonly LatencyCaseResult[],
  safety: readonly LatencySafetyResult[],
): CandidateLatencyAggregate {
  const ownCases = cases.filter((entry) => entry.candidateId === candidate.id)
  const ownSafety = safety.filter((entry) => entry.candidateId === candidate.id)
  const latencies = ownCases.map((entry) => entry.latencyMs)
  const p50LatencyMs = percentile(latencies, 0.5)
  const p90LatencyMs = percentile(latencies, 0.9)
  const qualityFailures = ownCases.filter((entry) => entry.qualityIssues.length > 0).length
  const safeCases = ownSafety.filter((entry) => entry.safe && entry.status === 'ok').length
  const successfulCalls = ownCases.filter((entry) => entry.status === 'ok').length
  const degradedCalls = ownCases.filter((entry) => entry.status === 'degraded').length
  const apiErrors = ownCases.filter((entry) => entry.status === 'error').length
  const repairedCalls = ownCases.filter((entry) => entry.repairRounds > 0).length
  const latencyTargetMet = p50LatencyMs < LATENCY_TARGET.p50Ms && p90LatencyMs < LATENCY_TARGET.p90Ms
  const qualityGateMet =
    ownCases.length > 0 &&
    successfulCalls === ownCases.length &&
    degradedCalls === 0 &&
    apiErrors === 0 &&
    repairedCalls === 0 &&
    qualityFailures === 0 &&
    safeCases === ownSafety.length &&
    ownSafety.length === K10_CASES.length
  return {
    candidateId: candidate.id,
    model: candidate.model,
    calls: ownCases.length,
    successfulCalls,
    degradedCalls,
    apiErrors,
    repairedCalls,
    qualityFailures,
    safeCases,
    safetyCases: ownSafety.length,
    meanLatencyMs: ownCases.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / ownCases.length,
    p50LatencyMs,
    p90LatencyMs,
    p95LatencyMs: percentile(latencies, 0.95),
    promptTokens: ownCases.reduce((sum, entry) => sum + entry.promptTokens, 0),
    completionTokens: ownCases.reduce((sum, entry) => sum + entry.completionTokens, 0),
    cachedPromptTokens: ownCases.reduce((sum, entry) => sum + entry.cachedPromptTokens, 0),
    reasoningTokens: ownCases.reduce((sum, entry) => sum + entry.reasoningTokens, 0),
    estimatedCostUsd: ownCases.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0),
    actualServiceTiers: [...new Set(ownCases.map((entry) => entry.actualServiceTier).filter((value): value is string => value !== null))],
    latencyTargetMet,
    qualityGateMet,
    passed: latencyTargetMet && qualityGateMet,
  }
}

export function renderLatencyResults(summary: LatencyRunSummary): string {
  const lines = [
    '# Character-agent latency evaluation',
    '',
    `Run: \`${summary.label}\``,
    `Target: p50 < ${(summary.target.p50Ms / 1000).toFixed(0)}s and p90 < ${(summary.target.p90Ms / 1000).toFixed(0)}s`,
    `Corpus: ${buildK9Cases().length} cases × ${summary.repetitions} repetitions per candidate; ${K10_CASES.length} hostile cases per candidate`,
    '',
    '| Candidate | Requested tier | Actual tier | Calls | Valid | K10 safe | Mean | p50 | p90 | p95 | Reasoning tokens | Cost | Target | Quality | Pass |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |',
  ]
  for (const aggregate of summary.aggregates) {
    const candidate = summary.candidates.find((entry) => entry.id === aggregate.candidateId)!
    lines.push(
      `| ${aggregate.model} | ${candidate.serviceTier} | ${aggregate.actualServiceTiers.join(', ') || 'unknown'} | ${aggregate.calls} | ${aggregate.successfulCalls}/${aggregate.calls} | ${aggregate.safeCases}/${aggregate.safetyCases} | ${(aggregate.meanLatencyMs / 1000).toFixed(2)}s | ${(aggregate.p50LatencyMs / 1000).toFixed(2)}s | ${(aggregate.p90LatencyMs / 1000).toFixed(2)}s | ${(aggregate.p95LatencyMs / 1000).toFixed(2)}s | ${aggregate.reasoningTokens} | $${aggregate.estimatedCostUsd.toFixed(6)} | ${aggregate.latencyTargetMet ? 'yes' : 'NO'} | ${aggregate.qualityGateMet ? 'yes' : 'NO'} | ${aggregate.passed ? 'yes' : 'NO'} |`,
    )
  }
  lines.push('', 'Latency is measured around the complete schema-validated character turn. Results save lengths, action types, token counts, and audits, but not prompts, private context, or model text.', '')
  return lines.join('\n')
}

function labelForRun(): string {
  const date = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
  return `character-latency-${date}`
}

export async function runLatencyEval(): Promise<LatencyRunSummary> {
  if (!process.env.OPENAI_API_KEY) loadEnvFile(resolve(import.meta.dirname, '../../..', '.env'))
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')

  const label = labelForRun()
  const startedAt = new Date().toISOString()
  const clients = new Map(
    LATENCY_CANDIDATES.map((candidate) => [
      candidate.id,
      new CandidateClient(candidate, createOpenAiClient({ models: { mid: candidate.model } })),
    ]),
  )
  const cases: LatencyCaseResult[] = []
  const corpus = buildK9Cases()
  console.log(`Latency eval ${label}: ${corpus.length} cases × ${LATENCY_REPETITIONS} repetitions × ${LATENCY_CANDIDATES.length} candidates`)

  for (let repetition = 1; repetition <= LATENCY_REPETITIONS; repetition += 1) {
    for (let caseIndex = 0; caseIndex < corpus.length; caseIndex += 1) {
      const evalCase = corpus[caseIndex]!
      const order = (repetition + caseIndex) % 2 === 0 ? LATENCY_CANDIDATES : [...LATENCY_CANDIDATES].reverse()
      for (const candidate of order) {
        process.stdout.write(`- r${repetition} ${evalCase.id} ${candidate.id} ... `)
        const result = await runLatencyCase(candidate, clients.get(candidate.id)!, evalCase, repetition)
        cases.push(result)
        console.log(`${result.status}, ${(result.latencyMs / 1000).toFixed(2)}s, reasoning ${result.reasoningTokens}, quality ${result.qualityIssues.length === 0 ? 'ok' : result.qualityIssues.join('; ')}`)
      }
    }
  }

  const safety: LatencySafetyResult[] = []
  for (const candidate of LATENCY_CANDIDATES) {
    for (const evalCase of K10_CASES) {
      process.stdout.write(`- safety ${evalCase.id} ${candidate.id} ... `)
      const result = await runSafetyCase(candidate, clients.get(candidate.id)!, evalCase)
      safety.push(result)
      console.log(`${result.status}, safe ${result.safe}, ${(result.latencyMs / 1000).toFixed(2)}s`)
    }
  }

  const summary: LatencyRunSummary = {
    label,
    startedAt,
    finishedAt: new Date().toISOString(),
    target: LATENCY_TARGET,
    repetitions: LATENCY_REPETITIONS,
    candidates: LATENCY_CANDIDATES,
    cases,
    safety,
    aggregates: LATENCY_CANDIDATES.map((candidate) => aggregateCandidate(candidate, cases, safety)),
  }
  const outDir = join(import.meta.dirname, 'results', label)
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(import.meta.dirname, 'LATENCY_RESULTS.md'), renderLatencyResults(summary))
  console.log(renderLatencyResults(summary))
  console.log(`wrote ${outDir}/summary.json and evals/LATENCY_RESULTS.md`)
  if (!summary.aggregates.some((entry) => entry.passed)) process.exitCode = 1
  return summary
}
