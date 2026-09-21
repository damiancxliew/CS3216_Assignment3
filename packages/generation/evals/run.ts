/**
 * D7/D8 — one-command eval run.
 *
 *   npm run eval                       # every case, real OpenAI, default model
 *   npm run eval -- --cases singapore-1819,mason-1787 --model gpt-5.4 --effort low --label prompt-v1
 *   npm run eval -- --fake             # no network: replays fixtures/singapore-1819.spec.json as the plan
 *
 * Writes evals/results/<label>/<case>.{spec,report}.json, evals/results/<label>/summary.json
 * and regenerates evals/RESULTS.md from every summary on disk.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { FIXTURES_DIR, loadFixtureJson } from '../src/fixtures'
import { extractDocument, slugify } from '../src/ingest/extract'
import type { ExtractedDocument } from '../src/ingest/types'
import { FakeLlmClient, type LlmClient } from '../src/llm/client'
import { OpenAiLlmClient } from '../src/llm/openai'
import { DEFAULT_PLANNER_CONFIG, type GenerationMetrics, type PlannerConfig, generateAdventure } from '../src/planner/pipeline'
import { PROMPT_VERSION, PROMPT_VERSIONS, type PromptVersion } from '../src/planner/prompt'
import type { AdventureSpec } from '../src/spec/v2'
import { type SpecChecks, checkSpec, structuralSimilarity } from './checks'
import { CORPUS, type EvalCase } from './corpus'

const RESULTS_DIR = join(import.meta.dirname, 'results')

export interface CaseResult {
  case: string
  status: 'ok' | 'failed'
  reason: string | null
  metrics: GenerationMetrics
  checks: SpecChecks | null
  issues: number
  missingInformation: number
  title: string | null
}

export interface RunSummary {
  label: string
  startedAt: string
  promptVersion: string
  config: PlannerConfig
  cases: CaseResult[]
  aggregate: {
    n: number
    validRate: number
    firstTryValidRate: number
    repairRate: number
    meanRepairs: number
    checksPassRate: number
    meanLatencyMs: number
    meanInputTokens: number
    meanOutputTokens: number
    meanCostUsd: number | null
    totalCostUsd: number | null
    maxPairwiseSimilarity: number | null
    meanEarlyForkRatio: number
  }
}

async function loadDocuments(evalCase: EvalCase): Promise<ExtractedDocument[]> {
  const docs: ExtractedDocument[] = []
  for (const entry of evalCase.files) {
    const file = typeof entry === 'string' ? entry : entry.path
    const path = join(FIXTURES_DIR, file)
    const kind = extname(file).toLowerCase() === '.pdf' ? 'pdf' : 'text'
    const id = typeof entry === 'string' ? slugify(basename(file)) : entry.id
    const title = basename(file, extname(file)).replace(/[-_]+/g, ' ')
    docs.push(
      kind === 'pdf'
        ? await extractDocument({ id, title, kind, bytes: new Uint8Array(await readFile(path)) })
        : await extractDocument({ id, title, kind, text: await readFile(path, 'utf8') }),
    )
  }
  return docs
}

async function fakeClient(): Promise<LlmClient> {
  const spec = structuredClone(await loadFixtureJson('singapore-1819.spec.json')) as Record<string, unknown>
  delete spec.version
  delete spec.id
  delete spec.sources
  delete spec.readingLevel
  return new FakeLlmClient(Array(20).fill({ json: { adventure: spec, missingInformation: [] } }), { inputTokens: 4000, cachedInputTokens: 0, outputTokens: 18000, reasoningTokens: 8000 })
}

export async function runCase(evalCase: EvalCase, llm: LlmClient, config: Partial<PlannerConfig>, outDir: string): Promise<{ result: CaseResult; spec: AdventureSpec | null }> {
  const documents = await loadDocuments(evalCase)
  const generation = await generateAdventure({ teacher: evalCase.teacher, documents, llm, config })
  const base = { case: evalCase.id, metrics: generation.metrics, missingInformation: generation.missingInformation.length }
  if (generation.status === 'ok') {
    const checks = await checkSpec(generation.spec, new Map(documents.map((d) => [d.id, d])), undefined, evalCase.injectionMarker)
    await writeFile(join(outDir, `${evalCase.id}.spec.json`), `${JSON.stringify(generation.spec, null, 2)}\n`)
    const result: CaseResult = { ...base, status: 'ok', reason: null, checks, issues: 0, title: generation.spec.title }
    await writeFile(join(outDir, `${evalCase.id}.report.json`), `${JSON.stringify({ ...result, missingInformation: generation.missingInformation, warnings: generation.warnings }, null, 2)}\n`)
    return { result, spec: generation.spec }
  }
  const result: CaseResult = { ...base, status: 'failed', reason: generation.reason, checks: null, issues: generation.issues.length, title: null }
  await writeFile(join(outDir, `${evalCase.id}.report.json`), `${JSON.stringify({ ...result, issues: generation.issues, missingInformation: generation.missingInformation, lastOutput: generation.lastOutput }, null, 2)}\n`)
  return { result, spec: null }
}

function aggregate(cases: CaseResult[], specs: AdventureSpec[]): RunSummary['aggregate'] {
  const n = cases.length
  const ok = cases.filter((c) => c.status === 'ok')
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const costs = cases.map((c) => c.metrics.costUsd)
  const costKnown = costs.every((c): c is number => c !== null)
  let maxSim: number | null = null
  for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) maxSim = Math.max(maxSim ?? 0, structuralSimilarity(specs[i]!, specs[j]!))
  return {
    n,
    validRate: n ? ok.length / n : 0,
    firstTryValidRate: n ? cases.filter((c) => c.status === 'ok' && c.metrics.repairs === 0).length / n : 0,
    repairRate: n ? cases.filter((c) => c.metrics.repairs > 0).length / n : 0,
    meanRepairs: mean(cases.map((c) => c.metrics.repairs)),
    checksPassRate: ok.length ? ok.filter((c) => c.checks?.pass).length / ok.length : 0,
    meanLatencyMs: mean(cases.map((c) => c.metrics.totalLatencyMs)),
    meanInputTokens: mean(cases.map((c) => c.metrics.usage.inputTokens)),
    meanOutputTokens: mean(cases.map((c) => c.metrics.usage.outputTokens)),
    meanCostUsd: costKnown ? mean(costs) : null,
    totalCostUsd: costKnown ? costs.reduce((a, b) => a + b, 0) : null,
    maxPairwiseSimilarity: maxSim,
    meanEarlyForkRatio: mean(ok.map((c) => c.checks?.earlyFork?.ratio ?? 0)),
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const secs = (ms: number) => `${(ms / 1000).toFixed(0)}s`
const usd = (x: number | null) => (x === null ? '?' : `$${x.toFixed(3)}`)

export function renderResultsMarkdown(summaries: RunSummary[]): string {
  const lines = [
    '# Eval results (D7/D8)',
    '',
    'Generated by `npm run eval`. Every number below comes from a real run; nothing is estimated.',
    'Checks: grounding = every span resolves to its cited page; branching = ≥2 reachable endings and the final stage forks;',
    'reading = all player-facing texts within the word budget for the band; assets = ≤8, story-specific kinds only;',
    'playability = spec-level reachability until the compiler (I2) is wired in.',
    '',
    '## Runs',
    '',
    '| Run | Prompt | Model | Effort | n | Valid | First-try valid | Repair rate | Checks pass | Mean latency | Mean tokens in/out | Mean cost | Total cost | Max similarity | Early forks |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const s of summaries) {
    const a = s.aggregate
    lines.push(
      `| ${s.label} | ${s.promptVersion} | ${s.config.model} | ${s.config.reasoningEffort ?? '-'} | ${a.n} | ${pct(a.validRate)} | ${pct(a.firstTryValidRate)} | ${pct(a.repairRate)} | ${pct(a.checksPassRate)} | ${secs(a.meanLatencyMs)} | ${Math.round(a.meanInputTokens)}/${Math.round(a.meanOutputTokens)} | ${usd(a.meanCostUsd)} | ${usd(a.totalCostUsd)} | ${a.maxPairwiseSimilarity === null ? '-' : a.maxPairwiseSimilarity.toFixed(2)} | ${a.meanEarlyForkRatio === undefined ? '-' : pct(a.meanEarlyForkRatio)} |`,
    )
  }
  for (const s of summaries) {
    lines.push('', `## ${s.label} — per case`, '', '| Case | Status | Attempts | Repairs | Latency | Tokens in/out (reasoning) | Cost | Grounding | Documented share | Branching | Early forks | Chains/overlays | Stances | Reading | Assets | Injection | Pass |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const c of s.cases) {
      const m = c.metrics
      const k = c.checks
      lines.push(
        `| ${c.case} | ${c.status}${c.reason ? ` (${c.reason})` : ''} | ${m.attempts} | ${m.repairs} | ${secs(m.totalLatencyMs)} | ${m.usage.inputTokens}/${m.usage.outputTokens} (${m.usage.reasoningTokens}) | ${usd(m.costUsd)} | ${k ? `${k.grounding.resolved}/${k.grounding.total}` : '-'} | ${k ? pct(k.documentedShare) : '-'} | ${k ? `${k.branching.reachableEndings} endings, forks ${k.branching.distinctTargetsPerStage.join('/')}${k.branching.ok ? '' : ' ✗'}` : '-'} | ${k?.earlyFork ? `${k.earlyFork.forking}/${k.earlyFork.nonFinalStages}` : '-'} | ${k?.objectiveChains !== undefined ? `${k.objectiveChains}/${k.overlaysSet} of ${k.branching.stages}` : '-'} | ${k ? k.stances.distinct.length + (k.stances.ok ? '' : ' ✗') : '-'} | ${k ? `${k.readingLevel.maxWords}/${k.readingLevel.budgetWords}w${k.readingLevel.ok ? '' : ' ✗'}` : '-'} | ${k ? `${k.assets.count}${k.assets.ok ? '' : ' ✗'}` : '-'} | ${k ? (k.injection ? (k.injection.ok ? 'clean' : `LEAKED ${k.injection.leakedAt.length}`) : 'n/a') : '-'} | ${k ? (k.pass ? 'yes' : 'no') : '-'} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

async function loadSummaries(): Promise<RunSummary[]> {
  const summaries: RunSummary[] = []
  for (const dir of await readdir(RESULTS_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory()) continue
    try {
      summaries.push(JSON.parse(await readFile(join(RESULTS_DIR, dir.name, 'summary.json'), 'utf8')) as RunSummary)
    } catch {
      /* not a run directory */
    }
  }
  return summaries.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : undefined
  }
  const fake = args.includes('--fake')
  const label = flag('label') ?? (fake ? 'fake' : `${flag('prompt') ?? PROMPT_VERSION}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)
  const selected = flag('cases')?.split(',')
  const cases = selected ? CORPUS.filter((c) => selected.includes(c.id)) : CORPUS
  if (cases.length === 0) throw new Error(`no cases match ${selected?.join(',')}`)
  const config: PlannerConfig = {
    ...DEFAULT_PLANNER_CONFIG,
    ...(flag('model') ? { model: flag('model')! } : {}),
    ...(flag('effort') ? { reasoningEffort: flag('effort') as PlannerConfig['reasoningEffort'] } : {}),
    ...(flag('prompt') ? { promptVersion: flag('prompt') as PromptVersion } : {}),
  }
  if (!PROMPT_VERSIONS.includes(config.promptVersion)) throw new Error(`unknown prompt version ${config.promptVersion}; use one of ${PROMPT_VERSIONS.join(', ')}`)
  const llm = fake ? await fakeClient() : new OpenAiLlmClient()
  const outDir = join(RESULTS_DIR, label)
  await mkdir(outDir, { recursive: true })

  console.log(`eval "${label}": ${cases.length} case(s), model ${config.model}, effort ${config.reasoningEffort}${fake ? ' (FAKE client)' : ''}`)
  const results: CaseResult[] = []
  const specs: AdventureSpec[] = []
  for (const evalCase of cases) {
    process.stdout.write(`- ${evalCase.id} ... `)
    const { result, spec } = await runCase(evalCase, llm, config, outDir)
    results.push(result)
    if (spec) specs.push(spec)
    const m = result.metrics
    console.log(`${result.status} in ${secs(m.totalLatencyMs)}, attempts ${m.attempts}, repairs ${m.repairs}, ${usd(m.costUsd)}${result.checks ? `, checks ${result.checks.pass ? 'pass' : 'FAIL'}` : ` (${result.reason})`}`)
  }
  const summary: RunSummary = { label, startedAt: new Date().toISOString(), promptVersion: config.promptVersion, config, cases: results, aggregate: aggregate(results, specs) }
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(join(import.meta.dirname, 'RESULTS.md'), renderResultsMarkdown(await loadSummaries()))
  const a = summary.aggregate
  console.log(`\nvalid ${pct(a.validRate)} (first try ${pct(a.firstTryValidRate)}), repair rate ${pct(a.repairRate)}, checks pass ${pct(a.checksPassRate)}, mean latency ${secs(a.meanLatencyMs)}, total ${usd(a.totalCostUsd)}`)
  console.log(`wrote ${outDir} and evals/RESULTS.md`)
}

await main()
