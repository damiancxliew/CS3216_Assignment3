/**
 * History check of a generated adventure (C3, an H item: Kevin signs off the output).
 *
 *   npx vite-node packages/engine/evals/run-history-check.ts -- <spec.json> [--sources <dir>] [--no-model]
 *
 * For every core discovery, the historical ending, the reveal's "what happened" and every real document:
 * 1. it must carry a source label other than "invented" (G13);
 * 2. real documents must be found word for word in one of the source texts in `--sources` (G13.2, G13.5),
 *    with the same tolerance as ingest's quote check;
 * 3. a frontier model gives a second opinion on each claim (accurate / doubtful / wrong, with a reason). It is
 *    advice for the reviewer, never a pass.
 * Writes `history-check.md` next to the spec: a checklist for Kevin to tick.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'

import { callStructured, createOpenAiClient, type LlmClient } from '@adventure/orchestration'
import { z } from 'zod'

import { EngineSpec } from '../src'

const ROOT = resolve(import.meta.dirname, '../../..')

export interface Claim {
  id: string
  kind: 'core discovery' | 'historical ending' | 'what happened' | 'real document'
  text: string
  sourceLabel: string
}

export interface ClaimResult extends Claim {
  problems: string[]
  opinion: { verdict: 'accurate' | 'doubtful' | 'wrong'; reason: string } | null
}

export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00AD/g, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function claimsOf(spec: EngineSpec): Claim[] {
  const claims: Claim[] = spec.discoveries
    .filter((discovery) => discovery.core)
    .map((discovery) => ({ id: discovery.id, kind: 'core discovery' as const, text: discovery.text, sourceLabel: discovery.sourceLabel }))
  for (const ending of spec.endings.filter((candidate) => candidate.type === 'historical')) {
    claims.push({ id: ending.id, kind: 'historical ending', text: ending.summary, sourceLabel: ending.sourceLabel })
  }
  if (spec.reveal !== undefined) claims.push({ id: 'reveal', kind: 'what happened', text: spec.reveal.whatHappened, sourceLabel: 'reveal' })
  for (const document of spec.documents.filter((candidate) => candidate.real)) {
    claims.push({ id: document.id, kind: 'real document', text: document.body, sourceLabel: document.sourceLabel })
  }
  return claims
}

/** Segments of a real excerpt that are not in any source text. Ellipses and paragraph breaks split segments. */
export function unquotedSegments(body: string, sources: readonly string[]): string[] {
  const normalisedSources = sources.map(normalise)
  return body
    .split(/…|\.\.\.|\n\n/)
    .map((segment) => segment.replace(/^\s*Article \w+\.\s*/, '').trim())
    .filter((segment) => segment.length > 0)
    .filter((segment) => !normalisedSources.some((source) => source.includes(normalise(segment))))
}

const Opinion = z.object({
  items: z.array(z.object({ id: z.string(), verdict: z.enum(['accurate', 'doubtful', 'wrong']), reason: z.string() })),
})

export async function secondOpinion(llm: LlmClient, spec: EngineSpec, claims: Claim[]): Promise<Map<string, ClaimResult['opinion']>> {
  const checkable = claims.filter((claim) => claim.kind !== 'real document')
  const result = await callStructured(llm, {
    schema: Opinion,
    schemaName: 'history_second_opinion',
    modelTier: 'frontier',
    reasoningEffort: 'medium',
    system: [
      'You are a careful historian reviewing claims written for a secondary-school history game.',
      'For each claim, judge whether it is historically accurate as stated, for the episode and the moment given.',
      '"accurate": consistent with the scholarly record. "doubtful": simplified, disputed, anachronistic or not well supported. "wrong": contradicts the record.',
      'Give one short reason each, naming what is wrong or uncertain. Do not judge style. Return every id once.',
    ].join('\n'),
    user: [`Episode: ${spec.title}. Stages: ${spec.stages.map((stage) => `${stage.title} (${stage.timePlace})`).join('; ')}.`, '', ...checkable.map((claim) => `${claim.id} [${claim.kind}]: ${claim.text}`)].join('\n'),
  })
  const opinions = new Map<string, ClaimResult['opinion']>()
  if (result.ok) for (const item of result.value.items) opinions.set(item.id, { verdict: item.verdict, reason: item.reason })
  return opinions
}

export async function historyCheck(spec: EngineSpec, sources: readonly string[], llm: LlmClient | null): Promise<ClaimResult[]> {
  const claims = claimsOf(spec)
  const opinions = llm === null ? new Map<string, ClaimResult['opinion']>() : await secondOpinion(llm, spec, claims)
  return claims.map((claim) => {
    const problems: string[] = []
    if (claim.kind !== 'what happened' && claim.sourceLabel.trim().toLowerCase() === 'invented') problems.push('labelled invented, but this must be cited (G13)')
    if (claim.kind === 'real document') {
      if (sources.length === 0) problems.push('no source texts given to check the quote against')
      else for (const segment of unquotedSegments(claim.text, sources)) problems.push(`not found word for word in any source: "${segment.slice(0, 80)}${segment.length > 80 ? '…' : ''}"`)
    }
    return { ...claim, problems, opinion: opinions.get(claim.id) ?? null }
  })
}

export function renderChecklist(spec: EngineSpec, results: ClaimResult[], startedAt: string): string {
  const flagged = results.filter((result) => result.problems.length > 0 || (result.opinion !== null && result.opinion.verdict !== 'accurate'))
  return [
    `# History check: ${spec.title} (${startedAt})`,
    '',
    `${results.length} claims; ${flagged.length} need attention. Tick each once you have checked it against the record.`,
    '',
    ...results.map((result) => {
      const marks = [
        ...result.problems.map((problem) => `  - ⚠️ ${problem}`),
        result.opinion === null ? null : `  - Second opinion: **${result.opinion.verdict}**: ${result.opinion.reason}`,
      ].filter((line): line is string => line !== null)
      const text = result.kind === 'real document' ? `${result.text.slice(0, 160)}…` : result.text
      return [`- [ ] \`${result.id}\` (${result.kind}, *${result.sourceLabel}*): ${text}`, ...marks].join('\n')
    }),
    '',
    'Signed off by: ______  Date: ______',
  ].join('\n')
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index < 0 ? undefined : process.argv[index + 1]
}

export async function main(): Promise<void> {
  const specPath = process.argv.slice(2).find((arg) => arg.endsWith('.json'))
  if (specPath === undefined) throw new Error('usage: run-history-check.ts <spec.json> [--sources <dir>] [--no-model]')
  const spec = EngineSpec.parse(JSON.parse(readFileSync(resolve(specPath), 'utf8')))
  const sourceDir = option('sources')
  const sources = sourceDir === undefined ? [] : readdirSync(sourceDir).filter((file) => file.endsWith('.txt')).map((file) => readFileSync(join(sourceDir, file), 'utf8'))
  let llm: LlmClient | null = null
  if (!process.argv.includes('--no-model')) {
    if (!process.env.OPENAI_API_KEY) loadEnvFile(resolve(ROOT, '.env'))
    llm = createOpenAiClient()
  }
  const results = await historyCheck(spec, sources, llm)
  const out = join(dirname(resolve(specPath)), `${spec.id}.history-check.md`)
  writeFileSync(out, `${renderChecklist(spec, results, new Date().toISOString())}\n`)
  console.log(`Wrote ${out}`)
}
