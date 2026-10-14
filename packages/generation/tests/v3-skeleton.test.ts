import { describe, expect, it } from 'vitest'

import type { ExtractedDocument } from '../src/ingest/types'
import { FakeLlmClient } from '../src/llm/client'
import { generateSkeleton, MAX_REPAIRS, SKELETON_MODEL, toSkeleton } from '../src/v3/index'
import type { SkeletonLlmOutput } from '../src/v3/index'

const doc: ExtractedDocument = {
  id: 'singapore-1819',
  title: 'Singapore 1819 handout',
  kind: 'text',
  contentHash: 'x',
  pageCount: 1,
  charCount: 10,
  pages: [{ page: 1, text: 'The treaty was signed on 6 February 1819.' }],
  warnings: [],
}

const input = { episode: 'The founding of British Singapore, 1819', readingLevel: 'sec' as const, documents: [doc] }

/** A canned LLM skeleton in the wire format (placement pairs, tagged holder, nulls). */
const llmOutput: SkeletonLlmOutput = {
  id: 'skel-1819',
  title: 'A Port in the Balance',
  arc: 'The student arrives as the flag goes up and must advise the Resident.',
  role: {
    name: 'Student Clerk',
    position: 'Junior clerk',
    relationships: ['Reports to the Resident'],
    reputation: 'New and untested',
    stakes: 'A good word',
    privateBrief: { goals: ['Learn'], fears: ['Sent home'], constraints: ['No rank'], knows: ['Ledgers'] },
    situation: 'Just arrived',
  },
  characters: [
    { id: 'farquhar', name: 'William Farquhar', title: 'Resident', real: true, tier: 'major', persona: { publicPosition: 'p', privateAgenda: 'a' } },
    { id: 'raffles', name: 'Stamford Raffles', title: 'Lieutenant-Governor', real: true, tier: 'major', persona: { publicPosition: 'p', privateAgenda: 'a' } },
    { id: 'nakhoda', name: 'Nakhoda Ismail', title: 'Bugis captain', real: false, tier: 'minor', persona: { publicPosition: 'p', privateAgenda: 'a' } },
  ],
  stages: [
    {
      id: 's1',
      title: 'The Anchorage',
      timePlace: 'Singapore, February 1819',
      centralQuestion: 'Whose port is this?',
      rooms: [
        { id: 'dock', name: 'Dock', description: 'Prahus crowd the water.' },
        { id: 'office', name: 'Office', description: 'Maps and letters.' },
      ],
      startRoomId: 'dock',
      placement: [
        { characterId: 'farquhar', roomId: 'office' },
        { characterId: 'raffles', roomId: 'office' },
        { characterId: 'nakhoda', roomId: 'dock' },
      ],
      definingMomentId: 'm1',
    },
  ],
  discoveries: [
    {
      id: 'd-treaty',
      stageId: 's1',
      holder: { kind: 'character', id: 'farquhar' },
      text: 'Raffles negotiated the preliminary treaty himself.',
      note: 'Raffles signed first.',
      sourceLabel: 'from the teacher',
      citations: [{ sourceId: 'singapore-1819', quote: 'The treaty was signed on 6 February 1819.' }],
    },
    {
      id: 'd-dues',
      stageId: 's1',
      holder: { kind: 'document', id: 'doc-1' },
      text: 'Some merchants resented new port dues.',
      note: 'Not all welcomed the flag.',
      sourceLabel: 'from the teacher',
      citations: [{ sourceId: 'singapore-1819', quote: null }],
    },
  ],
  documents: [{ id: 'doc-1', kind: 'report', title: 'Port Register', real: true }],
  definingMoments: [
    {
      id: 'm1',
      stageId: 's1',
      deciderId: 'farquhar',
      scene: 'A Dutch schooner is sighted.',
      acts: [
        { id: 'a-hold', text: 'Keep the flag flying' },
        { id: 'a-yield', text: 'Strike the flag quietly' },
      ],
      outcomes: [
        { id: 'o-hold', summary: 'The flag stays.', closesEndingIds: [], endingId: 'e-historical', secret: false, historical: true },
        { id: 'o-yield', summary: 'The flag comes down.', closesEndingIds: [], endingId: 'e-yield', secret: false, historical: false },
        { id: 'o-stall', summary: 'Farquhar stalls.', closesEndingIds: [], endingId: 'e-stall', secret: false, historical: false },
      ],
      rules: [
        { actId: 'a-hold', outcomeId: 'o-hold' },
        { actId: 'a-yield', outcomeId: 'o-yield' },
        { actId: 'a-yield', outcomeId: 'o-stall' },
      ],
    },
  ],
  endings: [
    {
      id: 'e-historical',
      type: 'historical',
      title: 'The Port Holds',
      summary: 'Singapore survives.',
      sourceLabel: 'from the teacher',
      citations: [{ sourceId: 'singapore-1819', quote: 'The treaty was signed on 6 February 1819.' }],
    },
    { id: 'e-yield', type: 'alternative', title: 'The Flag Comes Down', summary: 'The settlement folds.', sourceLabel: 'invented', citations: null },
    { id: 'e-stall', type: 'alternative', title: 'The Long Negotiation', summary: 'The decision is deferred.', sourceLabel: 'invented', citations: null },
  ],
}

describe('toSkeleton', () => {
  it('converts the wire format to a SkeletonSpec', () => {
    const skeleton = toSkeleton(llmOutput, input)
    expect(skeleton.stages[0]!.placement).toEqual({ farquhar: 'office', raffles: 'office', nakhoda: 'dock' })
    expect(skeleton.discoveries[0]!.holder).toEqual({ characterId: 'farquhar' })
    expect(skeleton.discoveries[1]!.holder).toEqual({ documentId: 'doc-1' })
    expect(skeleton.discoveries[1]!.citations).toEqual([{ sourceId: 'singapore-1819' }])
    expect(skeleton.definingMoments[0]!.outcomes[0]!.endingId).toBe('e-historical')
    expect(skeleton.definingMoments[0]!.outcomes[0]!.historical).toBe(true)
    expect('secret' in skeleton.definingMoments[0]!.outcomes[1]!).toBe(false)
    expect(skeleton.sources).toEqual([{ id: 'singapore-1819', title: 'Singapore 1819 handout', origin: 'teacher' }])
    expect(skeleton.discoveries.every((d) => d.core === true)).toBe(true)
  })
})

describe('generateSkeleton', () => {
  it('succeeds on the first attempt with one call', async () => {
    const llm = new FakeLlmClient([{ json: llmOutput }])
    const result = await generateSkeleton(input, { llm })
    expect(result.ok).toBe(true)
    expect(result.skeleton?.id).toBe('skel-1819')
    expect(result.issues).toEqual([])
    expect(result.metrics.calls).toHaveLength(1)
    expect(llm.requests).toHaveLength(1)
  })

  it('defaults to the gpt-6-sol skeleton model and prices its calls', async () => {
    const llm = new FakeLlmClient([{ json: llmOutput }])
    const result = await generateSkeleton(input, { llm })
    expect(llm.requests[0]!.model).toBe(SKELETON_MODEL)
    expect(result.metrics.calls[0]!.model).toBe(SKELETON_MODEL)
    expect(result.metrics.calls[0]!.costUsd).toBeCloseTo(0.007, 3)
    expect(result.metrics.totalCostUsd).toBeCloseTo(0.007, 3)
  })

  it('honours an explicit model override', async () => {
    const llm = new FakeLlmClient([{ json: llmOutput }])
    await generateSkeleton(input, { llm, model: 'gpt-5.4' })
    expect(llm.requests[0]!.model).toBe('gpt-5.4')
  })

  it('repairs a broken reply and succeeds in two calls', async () => {
    const broken = JSON.parse(JSON.stringify(llmOutput))
    broken.definingMoments[0].outcomes[0].endingId = 'e-yield' // historical ending now unreachable
    const llm = new FakeLlmClient([{ json: broken }, { json: llmOutput }])
    const result = await generateSkeleton(input, { llm })
    expect(result.ok).toBe(true)
    expect(result.metrics.calls).toHaveLength(2)
    expect(llm.requests[1]!.user).toContain('historical-unreachable')
    expect(llm.requests[1]!.user).toContain('Your previous skeleton:')
  })

  it('returns ok: false after the attempt plus MAX_REPAIRS when always broken', async () => {
    const broken = JSON.parse(JSON.stringify(llmOutput))
    broken.definingMoments[0].outcomes[0].endingId = 'e-yield'
    const llm = new FakeLlmClient([{ json: broken }, { json: broken }, { json: broken }])
    const result = await generateSkeleton(input, { llm })
    expect(result.ok).toBe(false)
    expect(result.metrics.calls).toHaveLength(1 + MAX_REPAIRS)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('counts a refusal as an llm-output failure', async () => {
    const llm = new FakeLlmClient([{ refusal: 'cannot help' }, { refusal: 'cannot help' }, { refusal: 'cannot help' }])
    const result = await generateSkeleton(input, { llm })
    expect(result.issues[0]!.code).toBe('llm-output')
  })
})
