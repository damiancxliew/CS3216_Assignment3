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

import { validateSkeleton, validateSpec } from '@adventure/spec-v3'
import type { AdventureSpec, Condition, SkeletonShape } from '@adventure/spec-v3'

import { extractDocument, slugify } from '../src/ingest/extract'
import type { ExtractedDocument } from '../src/ingest/types'
import { OpenAiLlmClient } from '../src/llm/openai'
import { generateDetails } from '../src/v3/details/generate'
import { generateEndings } from '../src/v3/endings/generate'
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

const skeletonPath = flag('skeleton')
const draftPath = flag('draft')
const detailsModel = flag('details-model')
const endingsModel = flag('endings-model')

if (sources.length === 0 || episode === undefined || (readingLevel !== 'sec' && readingLevel !== 'jc')) {
  console.error('usage: generate-v3.ts --source <file>... --episode "..." --level sec|jc [--notes "..."] [--model m] [--skeleton skeleton.json] [--draft spec.json|draft.json] [--details-model m] [--endings-model m] [--out dir]')
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

const model = flag('model')
const llm = new OpenAiLlmClient({ timeoutMs: 600_000 })

await mkdir(outDir, { recursive: true })

let skeleton: SkeletonShape
let draftInput: AdventureSpec | undefined
let skeletonMetrics: unknown = null
if (draftPath !== undefined) {
  const loaded = validateSpec(JSON.parse(await readFile(draftPath, 'utf8')))
  if (!loaded.ok) {
    console.log(`draft at ${draftPath} failed validation:`)
    for (const issue of loaded.issues) console.log(`  ${issue.path}: ${issue.message}`)
    process.exit(1)
  }
  draftInput = loaded.spec
  skeleton = loaded.spec // a full spec is also a valid SkeletonShape
  console.log(`loaded draft from ${draftPath}`)
} else if (skeletonPath !== undefined) {
  const loaded = validateSkeleton(JSON.parse(await readFile(skeletonPath, 'utf8')))
  if (!loaded.ok) {
    console.log(`skeleton at ${skeletonPath} failed validation:`)
    for (const issue of loaded.issues) console.log(`  ${issue.path}: ${issue.message}`)
    process.exit(1)
  }
  skeleton = loaded.spec
  console.log(`loaded skeleton from ${skeletonPath}`)
} else {
  const input = { episode, readingLevel, documents, ...(teacherNotes !== undefined ? { teacherNotes } : {}) }
  const result = await generateSkeleton(input, { llm, ...(model !== undefined ? { model } : {}) })

  await writeFile(join(outDir, 'issues.json'), `${JSON.stringify(result.issues, null, 2)}\n`)
  skeletonMetrics = result.metrics

  for (const [i, call] of result.metrics.calls.entries())
    console.log(`call ${i + 1}: ${call.model} in ${(call.latencyMs / 1000).toFixed(1)}s, issues ${call.issueCount}, cost $${call.costUsd?.toFixed(4) ?? '?'}`)

  if (!result.ok || result.skeleton === undefined) {
    console.log(`FAILED with ${result.issues.length} issues:`)
    for (const issue of result.issues) console.log(`  ${issue.code} at ${issue.path}: ${issue.message}`)
    process.exit(1)
  }
  skeleton = result.skeleton
  await writeFile(join(outDir, 'skeleton.json'), `${JSON.stringify(skeleton, null, 2)}\n`)
}

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

// --- details pass --------------------------------------------------------------------------------

const details = draftInput !== undefined
  ? { ok: true, draft: draftInput, issues: [], warnings: [], slantedDocuments: [], mergedDuplicates: [], pendingPasses: [], metrics: { calls: [] as import('../src/v3/details/calls').DetailCallMetrics[], totalCostUsd: 0 } }
  : await generateDetails(
      { skeleton, documents, ...(readingLevel !== undefined ? { readingLevel } : {}) },
      { llm, ...(detailsModel !== undefined ? { model: detailsModel } : {}) },
    )
for (const [i, call] of details.metrics.calls.entries())
  console.log(`details call ${i + 1} (${call.label}): ${call.model} in ${(call.latencyMs / 1000).toFixed(1)}s, issues ${call.issueCount}, cost $${call.costUsd?.toFixed(4) ?? '?'}`)

await writeFile(join(outDir, 'details-issues.json'), `${JSON.stringify({ issues: details.issues, warnings: details.warnings }, null, 2)}\n`)
if (details.draft !== undefined) await writeFile(join(outDir, 'draft.json'), `${JSON.stringify(details.draft, null, 2)}\n`)

// --- endings pass --------------------------------------------------------------------------------

const endings = details.draft === undefined
  ? { ok: false, spec: undefined as AdventureSpec | undefined, issues: [], warnings: [], pendingPasses: [] as string[], metrics: { calls: [] as import('../src/v3/details/calls').DetailCallMetrics[], totalCostUsd: 0 } }
  : await generateEndings(
      { draft: details.draft, documents, ...(readingLevel !== undefined ? { readingLevel } : {}) },
      { llm, ...(endingsModel !== undefined ? { model: endingsModel } : {}) },
    )
for (const [i, call] of endings.metrics.calls.entries())
  console.log(`endings call ${i + 1} (${call.label}): ${call.model} in ${(call.latencyMs / 1000).toFixed(1)}s, issues ${call.issueCount}, cost $${call.costUsd?.toFixed(4) ?? '?'}`)

await writeFile(join(outDir, 'endings-issues.json'), `${JSON.stringify({ issues: endings.issues, warnings: endings.warnings }, null, 2)}\n`)
await writeFile(join(outDir, 'metrics.json'), `${JSON.stringify({ skeleton: skeletonMetrics, details: details.metrics, endings: endings.metrics }, null, 2)}\n`)
if (endings.spec !== undefined) await writeFile(join(outDir, 'spec.json'), `${JSON.stringify(endings.spec, null, 2)}\n`)

lines.push('')
lines.push('=== details ===')
if (details.draft !== undefined) {
  const draft = details.draft
  for (const stage of draft.stages) {
    lines.push('')
    lines.push(`Stage ${stage.id} — opening:`)
    lines.push(`  ${stage.openingNarration}`)
    for (const doc of draft.documents.filter((d) => Object.keys(stage.documentPlacement).includes(d.id))) {
      const slanted = details.slantedDocuments.find((s) => s.documentId === doc.id)
      lines.push(`  doc ${doc.id} (${doc.kind}, ${doc.real ? 'real' : 'invented'}) at ${stage.documentPlacement[doc.id]}${slanted !== undefined ? ` [SLANTED: ${slanted.note}]` : ''}`)
      for (const passage of doc.keyPassages) {
        const reveals = draft.discoveries.filter((d) => 'keyPassageId' in d.holder && d.holder.keyPassageId === passage.id).map((d) => d.id)
        lines.push(`    passage ${passage.id}: “${doc.body.slice(passage.start, passage.end)}”${reveals.length ? ` → reveals ${reveals.join(', ')}` : ''}`)
      }
    }
    for (const event of draft.storyEvents.filter((e) => e.stageId === stage.id)) lines.push(`  event ${event.id}: ${JSON.stringify(event.when)} → ${event.effect} — ${event.text}`)
    for (const question of draft.openQuestions.filter((q) => q.stageId === stage.id)) lines.push(`  open question ${question.id}: ${question.text}`)
    const angleIds = new Set(draft.discoveries.filter((d) => d.stageId === stage.id).map((d) => d.id))
    for (const angle of draft.hintAngles.filter((a) => angleIds.has(a.discoveryId))) lines.push(`  hint ${angle.id} [${angle.kind} → ${angle.discoveryId}]: ${angle.text}`)
  }
  lines.push('')
  for (const character of draft.characters) {
    lines.push(`${character.name} (${character.id}):`)
    character.stances.forEach((stance) =>
      lines.push(`  ${character.initialStanceId === stance.id ? '*' : ' '} ${stance.id} ${stance.label}${stance.hidden ? ' (hidden)' : ''}: ${stance.demeanour}`),
    )
    if (character.trustNotice !== undefined) lines.push(`  trust notice: ${character.trustNotice}`)
    for (const slant of character.slants) lines.push(`  slant ${slant.id}: ${slant.claim} → contradicted by ${slant.contradictedBy.join(', ')}`)
    for (const trigger of draft.triggers.filter((t) => t.characterId === character.id))
      lines.push(`  trigger ${trigger.id}: on ${JSON.stringify(trigger.on)} → ${JSON.stringify(trigger.effect)}${trigger.handsOver !== undefined ? ` hands over ${trigger.handsOver.join(', ')}` : ''} — ${trigger.notice}`)
    for (const discovery of draft.discoveries.filter((d) => 'characterId' in d.holder && d.holder.characterId === character.id))
      lines.push(`  discovery ${discovery.id}${discovery.core ? ' (core)' : ''}: ${discovery.text}${discovery.condition !== undefined ? ` — needs ${renderCondition(discovery.condition)}` : ''}`)
  }
} else {
  lines.push(`details pass failed with ${details.issues.length} issues`)
}
for (const dup of details.mergedDuplicates) lines.push(`merged duplicates: kept ${dup.keep}, dropped ${dup.drop.join(', ')}`)
for (const issue of [...details.issues.map((i) => ({ ...i, kind: 'issue' })), ...details.warnings.map((w) => ({ ...w, kind: 'warning' }))])
  lines.push(`  ${issue.kind} ${issue.code} at ${issue.path}: ${issue.message}`)

lines.push('')
lines.push('=== endings ===')
if (endings.spec !== undefined) {
  const spec = endings.spec
  for (const moment of spec.definingMoments) {
    lines.push('')
    lines.push(`Moment ${moment.id}: ${moment.scene}`)
    lines.push(`  nudge: ${moment.nudge}`)
    lines.push(`  final call: ${moment.finalCallNarration}`)
    for (const act of moment.acts) {
      lines.push(`  act ${act.id}${act.secret !== undefined ? ' [SECRET]' : ''}: ${act.text}${act.deception === true ? ' (deception)' : ''}`)
      lines.push(`    reaction: ${act.reaction}`)
      if (act.secret !== undefined) lines.push(`    unlock (≥${act.secret.minMet}): ${act.secret.unlock.map(renderCondition).join(' | ')}`)
      for (const rule of spec.definingMoments.find((m) => m.id === moment.id)!.rules.filter((r) => r.actId === act.id))
        lines.push(`    rule → ${rule.outcomeId}${rule.when !== undefined ? ` when ${renderCondition(rule.when)}` : ' (fallback)'}`)
    }
    for (const outcome of moment.outcomes) {
      lines.push(`  outcome ${outcome.id}${outcome.historical === true ? ' [historical]' : ''}${outcome.secret === true ? ' [secret]' : ''}: “${outcome.predictionText}”`)
      lines.push(`    because: ${outcome.because}`)
    }
  }
  lines.push('')
  for (const ending of spec.endings) {
    const coreIds = new Set(spec.discoveries.filter((d) => d.core).map((d) => d.id))
    lines.push(`Ending ${ending.id} (${ending.type}): ${ending.title}`)
    lines.push(`  epilogue: ${ending.epilogue}`)
    lines.push(`  interviewer: ${ending.interview.interviewer}`)
    lines.push(`  question: ${ending.interview.question}`)
    for (const verdict of ending.interview.verdicts)
      lines.push(`  verdict ${verdict.id}: ${verdict.text} — countered by ${verdict.counterPoints.map((id) => `${id}${coreIds.has(id) ? ' (core)' : ''}`).join(', ')}`)
    lines.push(`  general counter: ${ending.interview.generalCounter}`)
    lines.push('')
  }
}
for (const issue of [...endings.issues.map((i) => ({ ...i, kind: 'issue' })), ...endings.warnings.map((w) => ({ ...w, kind: 'warning' }))])
  lines.push(`  ${issue.kind} ${issue.code} at ${issue.path}: ${issue.message}`)

const outline = lines.join('\n')
await writeFile(join(outDir, 'outline.txt'), `${outline}\n`)
console.log('')
console.log(outline)
console.log(`\nwrote ${outDir} — details $${details.metrics.totalCostUsd.toFixed(4)}, endings $${endings.metrics.totalCostUsd.toFixed(4)}`)
if (!details.ok || !endings.ok) process.exit(1)

function renderCondition(condition: Condition): string {
  if ('all' in condition) return condition.all.map(renderCondition).join(' + ')
  if ('any' in condition) return condition.any.map(renderCondition).join(' or ')
  if ('not' in condition) return `not ${renderCondition(condition.not)}`
  if ('discovered' in condition) return condition.discovered
  if ('stanceAtLeast' in condition) return `stance ≥ ${condition.stanceAtLeast.stanceId}`
  if ('stanceIs' in condition) return `stance = ${condition.stanceIs.stanceId}`
  if ('notePassed' in condition) return `note ${condition.notePassed.discoveryId} → ${condition.notePassed.characterId}`
  if ('slantConfronted' in condition) return `confronted ${condition.slantConfronted}`
  if ('act' in condition) return `act ${condition.act.actId}`
  if ('outcome' in condition) return `outcome ${condition.outcome.outcomeId}`
  if ('inRoom' in condition) return `in ${condition.inRoom}`
  return `after ${condition.elapsedAtLeast}s`
}
