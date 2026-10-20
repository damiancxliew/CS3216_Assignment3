import { writeFile } from 'node:fs/promises'
import type { ExtractedDocument } from '../src/ingest/types'
import { OpenAiLlmClient } from '../src/llm/openai'
import { GROUNDING_CASES, reviewClaimEvidence } from './v3-grounding'
import { V3_MODEL } from '../src/v3/config'

if (process.argv.includes('--help') || !process.argv.includes('--live')) {
  console.log('Usage: npm run eval:v3-grounding -- --live [--out report.json]\nMakes four model calls using synthetic claims and one synthetic source excerpt. Requires OPENAI_API_KEY. Reports semantic relevance separately from literal quote occurrence.')
} else {
  const quote = 'The treaty was signed on 6 February 1819.'
  const documents: ExtractedDocument[] = [{ id: 'src', title: 'Synthetic evaluation excerpt', kind: 'text', origin: 'teacher', contentHash: 'synthetic', pageCount: 1, charCount: quote.length, pages: [{ page: 1, text: quote }], warnings: [] }]
  const llm = new OpenAiLlmClient({ maxRetries: 0, timeoutMs: 120_000 })
  const results = []
  for (const entry of GROUNDING_CASES) {
    const result = await reviewClaimEvidence({ text: entry.text, note: entry.note, citations: [{ sourceId: 'src', quote }] }, documents, llm)
    const pass = result.quoteErrors.length === 0 && result.support?.textSupported === entry.expected.textSupported && result.support?.noteSupported === entry.expected.noteSupported
    results.push({ id: entry.id, expected: entry.expected, ...result, pass })
  }
  const report = { model: V3_MODEL, cases: results, passed: results.filter((r) => r.pass).length, total: results.length }
  const json = `${JSON.stringify(report, null, 2)}\n`
  const outIndex = process.argv.indexOf('--out')
  if (outIndex >= 0) {
    const path = process.argv[outIndex + 1]
    if (!path) throw new Error('--out needs a file path')
    await writeFile(path, json)
  }
  console.log(json)
  if (report.passed !== report.total) process.exitCode = 1
}
