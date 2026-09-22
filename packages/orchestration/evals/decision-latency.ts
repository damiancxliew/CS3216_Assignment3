import { loadEnvFile } from 'node:process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  createFixtureWorld,
  fixtureOptionCatalogue,
  fixtureStageConfig,
  fixtureStageParticipants,
} from '../src/fixtures'
import { createOpenAiClient } from '../src/llm/openai'
import { deriveOptions, StageDecisions } from '../src/stage/options'
import { runStage } from '../src/world/stage-runtime'
import { percentile } from './latency'

export const DECISION_LATENCY_REPETITIONS = 10

export interface DecisionLatencyCase {
  mode: 'sequential' | 'parallel'
  repetition: number
  status: 'ok' | 'quality_failure' | 'error'
  latencyMs: number
  decisions: number
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
  error: string | null
}

export interface DecisionLatencyAggregate {
  mode: DecisionLatencyCase['mode']
  calls: number
  successfulCalls: number
  meanLatencyMs: number
  p50LatencyMs: number
  p90LatencyMs: number
  promptTokens: number
  completionTokens: number
  estimatedCostUsd: number
}

export interface DecisionLatencySummary {
  label: string
  model: string
  requestedServiceTier: string
  startedAt: string
  finishedAt: string
  repetitions: number
  cases: DecisionLatencyCase[]
  aggregates: DecisionLatencyAggregate[]
  p50Speedup: number
  p90Speedup: number
}

const estimateCost = (promptTokens: number, completionTokens: number): number =>
  (promptTokens * 0.4 + completionTokens * 2.4) / 1_000_000

async function runCase(
  mode: DecisionLatencyCase['mode'],
  repetition: number,
): Promise<DecisionLatencyCase> {
  const world = createFixtureWorld()
  const ledger = new StageDecisions(fixtureStageParticipants)
  const offered = deriveOptions(world, fixtureOptionCatalogue, 'player')
  const player = ledger.commit(world, fixtureOptionCatalogue, {
    actorId: 'player',
    actorKind: 'player',
    optionId: 'option-sign-treaty',
    optionsVersion: offered.version,
  })
  if (!player.ok) throw new Error(`fixture player decision failed: ${player.reason}`)

  const started = performance.now()
  try {
    const result = await runStage(createOpenAiClient(), world, {
      ...fixtureStageConfig,
      decision: { catalogue: fixtureOptionCatalogue, ledger },
      maxTicks: 1,
      tokenBudget: mode === 'parallel' ? 60_000 : 7_999,
    })
    const latencyMs = Math.round(performance.now() - started)
    const agentDecisions = ledger.all().filter((decision) => decision.actorKind === 'agent').length
    const status = agentDecisions === 2 && result.telemetry.degradedTicks === 0 ? 'ok' : 'quality_failure'
    return {
      mode,
      repetition,
      status,
      latencyMs,
      decisions: agentDecisions,
      promptTokens: result.telemetry.promptTokens,
      completionTokens: result.telemetry.completionTokens,
      estimatedCostUsd: estimateCost(result.telemetry.promptTokens, result.telemetry.completionTokens),
      error: null,
    }
  } catch (error) {
    return {
      mode,
      repetition,
      status: 'error',
      latencyMs: Math.round(performance.now() - started),
      decisions: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

export function aggregateDecisionLatency(
  mode: DecisionLatencyCase['mode'],
  cases: readonly DecisionLatencyCase[],
): DecisionLatencyAggregate {
  const own = cases.filter((entry) => entry.mode === mode)
  const latencies = own.map((entry) => entry.latencyMs)
  return {
    mode,
    calls: own.length,
    successfulCalls: own.filter((entry) => entry.status === 'ok').length,
    meanLatencyMs: own.length === 0 ? 0 : latencies.reduce((sum, value) => sum + value, 0) / own.length,
    p50LatencyMs: percentile(latencies, 0.5),
    p90LatencyMs: percentile(latencies, 0.9),
    promptTokens: own.reduce((sum, entry) => sum + entry.promptTokens, 0),
    completionTokens: own.reduce((sum, entry) => sum + entry.completionTokens, 0),
    estimatedCostUsd: own.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0),
  }
}

export function renderDecisionLatency(summary: DecisionLatencySummary): string {
  const lines = [
    '# Multi-agent decision latency evaluation',
    '',
    `Run: \`${summary.label}\``,
    `Model: \`${summary.model}\``,
    `Requested service tier: \`${summary.requestedServiceTier}\``,
    `Corpus: two forced agent decisions × ${summary.repetitions} repetitions per mode`,
    '',
    '| Mode | Runs | Valid | Mean | p50 | p90 | Tokens in/out | Cost |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const aggregate of summary.aggregates) {
    lines.push(
      `| ${aggregate.mode} | ${aggregate.calls} | ${aggregate.successfulCalls}/${aggregate.calls} | ${(aggregate.meanLatencyMs / 1000).toFixed(2)}s | ${(aggregate.p50LatencyMs / 1000).toFixed(2)}s | ${(aggregate.p90LatencyMs / 1000).toFixed(2)}s | ${aggregate.promptTokens}/${aggregate.completionTokens} | $${aggregate.estimatedCostUsd.toFixed(6)} |`,
    )
  }
  lines.push(
    '',
    `Parallel speedup: ${summary.p50Speedup.toFixed(2)}× at p50; ${summary.p90Speedup.toFixed(2)}× at p90.`,
    '',
    'Latency covers the complete schema-validated stage tick and deterministic decision application. Results do not store prompts, private context, or model text.',
    '',
  )
  return lines.join('\n')
}

export async function runDecisionLatencyEval(): Promise<DecisionLatencySummary> {
  if (!process.env.OPENAI_API_KEY) loadEnvFile(resolve(import.meta.dirname, '../../..', '.env'))
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')

  const label = `decision-latency-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}`
  const startedAt = new Date().toISOString()
  const cases: DecisionLatencyCase[] = []
  console.log(`Decision latency eval ${label}: ${DECISION_LATENCY_REPETITIONS} repetitions per mode`)
  for (let repetition = 1; repetition <= DECISION_LATENCY_REPETITIONS; repetition += 1) {
    const order: DecisionLatencyCase['mode'][] = repetition % 2 === 0 ? ['parallel', 'sequential'] : ['sequential', 'parallel']
    for (const mode of order) {
      process.stdout.write(`- r${repetition} ${mode} ... `)
      const result = await runCase(mode, repetition)
      cases.push(result)
      console.log(`${result.status}, ${(result.latencyMs / 1000).toFixed(2)}s, ${result.decisions}/2 decisions`)
    }
  }

  const aggregates = [
    aggregateDecisionLatency('sequential', cases),
    aggregateDecisionLatency('parallel', cases),
  ]
  const sequential = aggregates[0]!
  const parallel = aggregates[1]!
  const summary: DecisionLatencySummary = {
    label,
    model: 'gpt-5.6-luna',
    requestedServiceTier: 'fast',
    startedAt,
    finishedAt: new Date().toISOString(),
    repetitions: DECISION_LATENCY_REPETITIONS,
    cases,
    aggregates,
    p50Speedup: parallel.p50LatencyMs === 0 ? 0 : sequential.p50LatencyMs / parallel.p50LatencyMs,
    p90Speedup: parallel.p90LatencyMs === 0 ? 0 : sequential.p90LatencyMs / parallel.p90LatencyMs,
  }
  const outDir = join(import.meta.dirname, 'results', label)
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(import.meta.dirname, 'DECISION_LATENCY_RESULTS.md'), renderDecisionLatency(summary))
  console.log(renderDecisionLatency(summary))
  console.log(`wrote ${outDir}/summary.json and evals/DECISION_LATENCY_RESULTS.md`)
  if (aggregates.some((entry) => entry.successfulCalls !== entry.calls)) process.exitCode = 1
  return summary
}
