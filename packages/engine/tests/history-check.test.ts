import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { FakeLlmClient } from '@adventure/orchestration'
import { describe, expect, it } from 'vitest'

import { EngineSpec } from '../src'
import { claimsOf, historyCheck, renderChecklist, unquotedSegments } from '../evals/history-check'

const ROOT = resolve(import.meta.dirname, '../../..')
const golden = EngineSpec.parse(JSON.parse(readFileSync(resolve(ROOT, 'fixtures/golden-1819.json'), 'utf8')))
const treaty = readFileSync(resolve(ROOT, 'fixtures/sources/treaty-1819-wikisource.txt'), 'utf8')

describe('history check', () => {
  it('lists core discoveries, the historical ending, what happened and real documents', () => {
    const kinds = claimsOf(golden).map((claim) => claim.kind)
    expect(kinds.filter((kind) => kind === 'core discovery')).toHaveLength(6)
    expect(kinds).toEqual(expect.arrayContaining(['historical ending', 'what happened', 'real document']))
  })

  it('finds real excerpts in their source, tolerating quote marks and spacing, and reports what is missing', () => {
    expect(unquotedSegments('Article 8. The port  of Singapoora is to be considered under the immediate protection', [treaty])).toEqual([])
    expect(unquotedSegments('The port of Singapoora is hereby ceded for ever.', [treaty])).toEqual(['The port of Singapoora is hereby ceded for ever.'])
  })

  it('flags invented core claims and unquoted real documents, and records the second opinion', async () => {
    const tampered = structuredClone(golden)
    const core = tampered.discoveries.find((discovery) => discovery.core)
    if (core) core.sourceLabel = 'invented'
    const reply = JSON.stringify({ items: [{ id: core?.id ?? '', verdict: 'doubtful', reason: 'Simplified.' }] })
    const results = await historyCheck(tampered, [], new FakeLlmClient({ replies: [reply] }))
    const flagged = results.find((result) => result.id === core?.id)
    expect(flagged?.problems).toEqual([expect.stringContaining('labelled invented')])
    expect(flagged?.opinion).toEqual({ verdict: 'doubtful', reason: 'Simplified.' })
    expect(results.find((result) => result.kind === 'real document')?.problems).toEqual([expect.stringContaining('no source texts')])
    expect(renderChecklist(tampered, results, 'now')).toContain('- [ ] `')
  })

  it('passes golden-1819 against its saved source', async () => {
    const results = await historyCheck(golden, [treaty], null)
    expect(results.flatMap((result) => result.problems)).toEqual([])
  })
})
