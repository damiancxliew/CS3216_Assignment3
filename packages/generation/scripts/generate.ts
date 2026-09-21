/**
 * Run the planner for real on one or more documents.
 *
 *   OPENAI_API_KEY=... npx vite-node scripts/generate.ts <file.pdf|file.txt>... [--out dir] [--model gpt-5.4] [--stages 3]
 *
 * Writes <out>/<slug>.spec.json (only if valid), <out>/<slug>.report.json (always).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { extractDocument, slugify } from '../src/ingest/extract'
import type { ExtractedDocument } from '../src/ingest/types'
import { OpenAiLlmClient } from '../src/llm/openai'
import { generateAdventure } from '../src/planner/pipeline'
import type { TeacherInputRaw } from '../src/planner/schema'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const files = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--')))
if (files.length === 0) {
  console.error('usage: generate.ts <file>... [--out dir] [--model m] [--stages n] [--band lower-secondary]')
  process.exit(2)
}
const outDir = flag('out') ?? 'evals/results/manual'
const model = flag('model')
const stageCount = Number(flag('stages') ?? 3) as 1 | 2 | 3
const band = (flag('band') ?? 'lower-secondary') as TeacherInputRaw['readingLevel']['band']

const documents: ExtractedDocument[] = []
for (const file of files) {
  const kind = extname(file).toLowerCase() === '.pdf' ? 'pdf' : 'text'
  const id = slugify(basename(file))
  const title = basename(file, extname(file)).replace(/[-_]+/g, ' ')
  documents.push(
    kind === 'pdf'
      ? await extractDocument({ id, title, kind, bytes: new Uint8Array(await readFile(file)) })
      : await extractDocument({ id, title, kind, text: await readFile(file, 'utf8') }),
  )
  const doc = documents.at(-1)!
  console.log(`extracted ${doc.id}: ${doc.pageCount} pages, ${doc.charCount} chars${doc.warnings.length ? ` (${doc.warnings.join('; ')})` : ''}`)
}

const teacher: TeacherInputRaw = {
  title: null,
  setting: flag('setting') ?? 'As described in the source documents',
  learningObjectives: [
    'Explain the causes of the events described in the sources',
    'Describe what each stakeholder wanted and why they disagreed',
    'Distinguish documented history from simulated assumptions',
  ],
  studentRole: flag('role') ?? 'A junior participant who can move between the stakeholders and advise the decision-maker',
  readingLevel: { band, ageMin: band === 'primary' ? 10 : band === 'lower-secondary' ? 13 : band === 'upper-secondary' ? 15 : 17, ageMax: band === 'primary' ? 12 : band === 'lower-secondary' ? 14 : band === 'upper-secondary' ? 16 : 18 },
  stageCount,
}

const llm = new OpenAiLlmClient()
console.log(`planning with ${model ?? 'default model'} ...`)
const result = await generateAdventure({ teacher, documents, llm, ...(model ? { config: { model } } : {}) })

await mkdir(outDir, { recursive: true })
const slug = documents.map((d) => d.id).join('+').slice(0, 60)
const { metrics } = result
console.log(
  `${result.status.toUpperCase()} in ${(metrics.totalLatencyMs / 1000).toFixed(1)}s — attempts ${metrics.attempts}, repairs ${metrics.repairs}, ` +
    `tokens in ${metrics.usage.inputTokens} (cached ${metrics.usage.cachedInputTokens}) out ${metrics.usage.outputTokens} (reasoning ${metrics.usage.reasoningTokens}), cost $${metrics.costUsd?.toFixed(4) ?? '?'}`,
)
for (const call of metrics.calls) console.log(`  ${call.purpose}: ${(call.latencyMs / 1000).toFixed(1)}s, issues ${call.issueCount} (schema ${call.schemaIssues}, grounding ${call.groundingIssues})`)

if (result.status === 'ok') {
  await writeFile(join(outDir, `${slug}.spec.json`), `${JSON.stringify(result.spec, null, 2)}\n`)
  console.log(`spec: ${result.spec.title} — ${result.spec.stages.length} stages, ${result.spec.stakeholders.length} stakeholders, ${result.spec.endings.length} endings, ${result.spec.assetEligibility.length} assets`)
  if (result.missingInformation.length) console.log(`missing information:\n  - ${result.missingInformation.join('\n  - ')}`)
  await writeFile(join(outDir, `${slug}.report.json`), `${JSON.stringify({ status: 'ok', missingInformation: result.missingInformation, warnings: result.warnings, metrics }, null, 2)}\n`)
} else {
  console.log(`reason: ${result.reason}`)
  for (const issue of result.issues.slice(0, 40)) console.log(`  ${issue.path}: ${issue.message}`)
  await writeFile(join(outDir, `${slug}.report.json`), `${JSON.stringify({ status: 'failed', reason: result.reason, issues: result.issues, missingInformation: result.missingInformation, metrics, lastOutput: result.lastOutput }, null, 2)}\n`)
}
