import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'

import { createOpenAiClient } from '../src/llm/openai'
import type { LlmClient } from '../src/llm/types'
import { checkInterviewAnswer, type InterviewCheckResult } from '../src/v3'
import { CASES } from './v3-interview-check'

type FlagSeverity = 'urgent' | 'serious' | 'review'

const SEVERITY_BY_CATEGORY: Partial<Record<string, FlagSeverity>> = {
  self_harm: 'urgent',
  threat: 'urgent',
  hateful: 'serious',
  sexual: 'serious',
  abusive: 'serious',
  provocative: 'review',
}

interface EvalRow {
  caseId: string
  run: number
  result: InterviewCheckResult | null
  probabilities: Record<string, number> | null
  latencyMs: number
}

function signature(result: InterviewCheckResult | null): string {
  return result === null
    ? 'null'
    : JSON.stringify({
        addressed: result.addressed,
        flagged: result.moderation.flagged,
        category: result.moderation.category,
      })
}

function resultSummary(result: InterviewCheckResult | null) {
  return result === null
    ? null
    : {
        addressed: result.addressed,
        flagged: result.moderation.flagged,
        category: result.moderation.category,
        severity: SEVERITY_BY_CATEGORY[result.moderation.category] ?? null,
      }
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) loadEnvFile(resolve(import.meta.dirname, '../../..', '.env'))
  const openai = createOpenAiClient()
  if (!openai.decide) throw new Error('The OpenAI client does not support Decisions.')

  let probabilities: Record<string, number> | null = null
  const llm: LlmClient = {
    complete: (request) => openai.complete(request),
    decide: async (request) => {
      const response = await openai.decide!(request)
      probabilities = response.probabilities
      return response
    },
  }

  const rows: EvalRow[] = []
  for (let run = 1; run <= 3; run += 1) {
    for (const testCase of CASES) {
      probabilities = null
      const startedAt = performance.now()
      const result = await checkInterviewAnswer(llm, testCase.input)
      rows.push({
        caseId: testCase.id,
        run,
        result,
        probabilities,
        latencyMs: Math.round(performance.now() - startedAt),
      })
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n')

  let addressedTp = 0
  let addressedFp = 0
  let addressedFn = 0
  let moderationHits = 0
  let moderationExpected = 0
  let severityHits = 0
  let severityExpected = 0
  let falseFlags = 0
  let unflaggedExpected = 0
  let nullCount = 0

  for (const row of rows) {
    const testCase = CASES.find(({ id }) => id === row.caseId)!
    const expectedAddressed = new Set(testCase.expect.addressed)
    const actualAddressed = new Set(row.result?.addressed ?? [])
    for (const candidate of testCase.input.counterpoints) {
      const expected = expectedAddressed.has(candidate.id)
      const actual = actualAddressed.has(candidate.id)
      if (expected && actual) addressedTp += 1
      else if (expected) addressedFn += 1
      else if (actual) addressedFp += 1
    }
    for (const id of actualAddressed) {
      if (!testCase.input.counterpoints.some((candidate) => candidate.id === id)) addressedFp += 1
    }

    if (row.result === null) nullCount += 1
    if (testCase.expect.flagged) {
      moderationExpected += 1
      if (row.result?.moderation.flagged) moderationHits += 1
      if (testCase.expect.severity !== undefined) {
        severityExpected += 1
        if (SEVERITY_BY_CATEGORY[row.result?.moderation.category ?? 'none'] === testCase.expect.severity) severityHits += 1
      }
    } else {
      unflaggedExpected += 1
      if (row.result?.moderation.flagged) falseFlags += 1
    }
  }

  const ratio = (numerator: number, denominator: number) => denominator === 0 ? 1 : Number((numerator / denominator).toFixed(3))
  const addressedPrecision = ratio(addressedTp, addressedTp + addressedFp)
  const addressedRecall = ratio(addressedTp, addressedTp + addressedFn)
  const moderationRecall = ratio(moderationHits, moderationExpected)
  const severityAccuracy = ratio(severityHits, severityExpected)
  const casesById = new Map(CASES.map((testCase) => [
    testCase.id,
    rows.filter((row) => row.caseId === testCase.id).sort((a, b) => a.run - b.run),
  ]))
  const consistentCases = [...casesById.values()].filter((caseRows) =>
    caseRows.length === 3 && new Set(caseRows.map((row) => signature(row.result))).size === 1,
  ).length

  const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b)
  const percentile = (quantile: number) =>
    latencies[Math.max(0, Math.ceil(quantile * latencies.length) - 1)] ?? 0

  const mismatches = CASES.flatMap((testCase) => {
    const caseRows = casesById.get(testCase.id) ?? []
    const expected = {
      addressed: testCase.expect.addressed,
      flagged: testCase.expect.flagged,
      ...(testCase.expect.severity === undefined ? {} : { severity: testCase.expect.severity }),
    }
    const hasMismatch = caseRows.some((row) => {
      const actual = resultSummary(row.result)
      return actual === null ||
        JSON.stringify(actual.addressed) !== JSON.stringify(expected.addressed) ||
        actual.flagged !== expected.flagged ||
        (testCase.expect.severity !== undefined && actual.severity !== testCase.expect.severity)
    })
    return hasMismatch
      ? [`- \`${testCase.id}\`: expected ${JSON.stringify(expected)}; ${caseRows.map((row) =>
          `run ${row.run}: got ${JSON.stringify(resultSummary(row.result))}, probabilities ${JSON.stringify(row.probabilities)}`,
        ).join('; ')}`]
      : []
  })

  const report = [
    `# v3 Interview check eval (${new Date().toISOString()}; 3 runs)`,
    '',
    `Cases: ${CASES.length} × 3 = ${rows.length}. Null results: ${nullCount}.`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| addressed precision | ${addressedPrecision} |`,
    `| addressed recall | ${addressedRecall} |`,
    `| moderation recall | ${moderationRecall} (${moderationHits}/${moderationExpected}) |`,
    `| severity accuracy on flagged cases | ${severityAccuracy} (${severityHits}/${severityExpected}) |`,
    `| false flags on unflagged cases | ${falseFlags}/${unflaggedExpected} |`,
    `| cross-run consistency | ${consistentCases}/${CASES.length} cases |`,
    `| latency p50 / p90 | ${percentile(0.5)} / ${percentile(0.9)} ms |`,
    '',
    '## Mismatches',
    ...(mismatches.length === 0 ? ['None.'] : mismatches),
  ].join('\n')

  const directory = resolve(import.meta.dirname, 'results', 'v3-interview-check')
  await mkdir(directory, { recursive: true })
  const file = join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`)
  await writeFile(file, `${report}\n`)
  console.log(report)
  console.log(`\nWritten to ${file}`)
}

await main()
