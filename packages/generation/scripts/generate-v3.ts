/**
 * Run the v3 skeleton pass for real on one or more teacher sources.
 *
 *   OPENAI_API_KEY=... npx vite-node scripts/generate-v3.ts \
 *     --source <file.txt|file.pdf>... --episode "..." --level sec|jc [--notes "..."] [--out dir]
 *
 * Writes skeleton.json, issues.json, metrics.json and outline.txt to --out, and prints the outline.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { extractDocument, slugify } from '../src/ingest/extract'
import type { ExtractedDocument } from '../src/ingest/types'
import { OpenAiLlmClient } from '../src/llm/openai'
import { generateSkeleton } from '../src/v3/skeleton/generate'

const args = process.argv.slice(2)
const flags = (name: string): string[] => {
  const values: string[] = []
  args.forEach((arg, i) => {
    if (arg === `--${name}`) values.push(args[i + 1]!)
  })
  return values
}
const flag = (name: string): string | undefined => flags(name)[0]

const sources = flags('source')
const episode = flag('episode')
const readingLevel = flag('level') as 'sec' | 'jc' | undefined
const teacherNotes = flag('notes')
const outDir = flag('out') ?? 'evals/results/v3-manual'

if (sources.length === 0 || episode === undefined || (readingLevel !== 'sec' && readingLevel !== 'jc')) {
  console.error('usage: generate-v3.ts --source <file>... --episode "..." --level sec|jc [--notes "..."] [--out dir]')
  process.exit(2)
}

const documents: ExtractedDocument[] = []
for (const file of sources) {
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

const llm = new OpenAiLlmClient({ timeoutMs: 600_000 })
const input = { episode, readingLevel, documents, ...(teacherNotes !== undefined ? { teacherNotes } : {}) }
const result = await generateSkeleton(input, { llm })

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'issues.json'), `${JSON.stringify(result.issues, null, 2)}\n`)
await writeFile(join(outDir, 'metrics.json'), `${JSON.stringify(result.metrics, null, 2)}\n`)

for (const [i, call] of result.metrics.calls.entries())
  console.log(`call ${i + 1}: ${call.model} in ${(call.latencyMs / 1000).toFixed(1)}s, issues ${call.issueCount}, cost $${call.costUsd?.toFixed(4) ?? '?'}`)

if (!result.ok || result.skeleton === undefined) {
  console.log(`FAILED with ${result.issues.length} issues:`)
  for (const issue of result.issues) console.log(`  ${issue.code} at ${issue.path}: ${issue.message}`)
  process.exit(1)
}

const skeleton = result.skeleton
await writeFile(join(outDir, 'skeleton.json'), `${JSON.stringify(skeleton, null, 2)}\n`)

const characterName = new Map(skeleton.characters.map((c) => [c.id, c.name]))
const lines: string[] = []
lines.push(`${skeleton.title} (${skeleton.id})`)
lines.push(`Arc: ${skeleton.arc}`)
lines.push('')
lines.push(`Role: ${skeleton.role.name} — ${skeleton.role.position}`)
lines.push('')
lines.push('Cast:')
for (const character of skeleton.characters)
  lines.push(`  ${character.name} (${character.tier}, ${character.real ? 'real' : 'fictional'}): ${character.persona.publicPosition} / ${character.persona.privateAgenda}`)
for (const stage of skeleton.stages) {
  lines.push('')
  lines.push(`Stage ${stage.id}: ${stage.title} — ${stage.timePlace}`)
  lines.push(`  Question: ${stage.centralQuestion}`)
  lines.push(`  Rooms: ${stage.rooms.map((r) => `${r.id} (${r.name})`).join(', ')}; start ${stage.startRoomId}`)
  for (const [characterId, roomId] of Object.entries(stage.placement)) lines.push(`  ${characterName.get(characterId) ?? characterId} is in ${roomId}`)
  for (const discovery of skeleton.discoveries.filter((d) => d.stageId === stage.id)) {
    const holder = 'characterId' in discovery.holder ? (characterName.get(discovery.holder.characterId) ?? discovery.holder.characterId) : discovery.holder.documentId
    lines.push(`  core: [${holder}] ${discovery.text} (${discovery.sourceLabel})`)
  }
  const moment = skeleton.definingMoments.find((m) => m.id === stage.definingMomentId)
  if (moment !== undefined) {
    lines.push(`  Moment ${moment.id} (decider ${characterName.get(moment.deciderId) ?? moment.deciderId}): ${moment.scene}`)
    for (const act of moment.acts) lines.push(`    act ${act.id}: ${act.text}`)
    for (const outcome of moment.outcomes) {
      const parts = [`${outcome.summary}${outcome.historical ? ' [historical]' : ''}`]
      if (outcome.endingId !== undefined) parts.push(`→ ending ${outcome.endingId}`)
      if (outcome.closesEndingIds.length > 0) parts.push(`closes ${outcome.closesEndingIds.join(', ')}`)
      lines.push(`    outcome ${outcome.id}: ${parts.join(' | ')}`)
    }
  }
}
lines.push('')
lines.push('Endings:')
for (const ending of skeleton.endings) lines.push(`  ${ending.id} (${ending.type}): ${ending.title} — ${ending.summary}`)

const outline = lines.join('\n')
await writeFile(join(outDir, 'outline.txt'), `${outline}\n`)
console.log('')
console.log(outline)
console.log(`\nwrote ${outDir} — total cost $${result.metrics.totalCostUsd?.toFixed(4) ?? '?'}`)
