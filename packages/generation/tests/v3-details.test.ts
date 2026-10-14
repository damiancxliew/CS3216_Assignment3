import { describe, expect, it } from 'vitest'
import { checkSpec, validateSpec } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../src/ingest/types'
import type { FakeReply, LlmJsonRequest, LlmJsonResponse, LlmUsage } from '../src/llm/client'
import { tryParseJson } from '../src/llm/client'
import type { LlmClient } from '../src/llm/client'
import { generateDetails, toSkeleton } from '../src/v3/index'
import type { LinkLlmOutput, MinorsLlmOutput, PersonaLlmOutput, SkeletonLlmOutput, StageDetailsLlmOutput } from '../src/v3/index'

// --- fixture: one-stage skeleton, 2 majors + 1 minor, 1 char-held + 1 doc-held core ---------

const doc: ExtractedDocument = {
  id: 'singapore-1819',
  title: 'Singapore 1819 handout',
  kind: 'text',
  contentHash: 'x',
  pageCount: 1,
  charCount: 10,
  pages: [{ page: 1, text: 'The treaty was signed on 6 February 1819. Farquhar called it “a free port”.' }],
  warnings: [],
}
const SOURCE_TEXT = doc.pages[0]!.text

const llmSkeleton: SkeletonLlmOutput = {
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
      citations: [{ sourceId: 'singapore-1819', quote: SOURCE_TEXT }],
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
    { id: 'e-historical', type: 'historical', title: 'The Port Holds', summary: 'Singapore survives.', sourceLabel: 'from the teacher', citations: [{ sourceId: 'singapore-1819', quote: SOURCE_TEXT }] },
    { id: 'e-yield', type: 'alternative', title: 'The Flag Comes Down', summary: 'The settlement folds.', sourceLabel: 'invented', citations: null },
    { id: 'e-stall', type: 'alternative', title: 'The Long Negotiation', summary: 'The decision is deferred.', sourceLabel: 'invented', citations: null },
  ],
}

const skeleton = toSkeleton(llmSkeleton, { readingLevel: 'sec', documents: [doc] })
const input = { skeleton, documents: [doc] }

// --- canned call outputs -------------------------------------------------------------------

const stageOutput: StageDetailsLlmOutput = {
  openingNarration: 'Dawn over the roads.',
  documents: [
    {
      id: 'doc-1',
      kind: 'report',
      title: 'Port Register',
      real: true,
      provenance: { masthead: 'Port Office', date: null, sender: null, recipient: null, place: null },
      body: 'The register shows dues doubled this quarter.',
      sourceLabel: 'from the teacher',
      glossary: [],
      keyPassages: [{ id: 's1-doc1-kp1', text: 'dues doubled' }],
      citations: null,
      slanted: true,
      slantNote: 'Omits the merchants’ side.',
    },
    {
      id: 's1-letter',
      kind: 'letter',
      title: 'Raffles to Farquhar',
      real: false,
      provenance: { masthead: null, date: null, sender: 'Raffles', recipient: 'Farquhar', place: null },
      body: 'Hold fast; the flag must stay.',
      sourceLabel: 'invented',
      glossary: [],
      keyPassages: [{ id: 's1-letter-kp1', text: 'Hold fast' }],
      citations: null,
      slanted: false,
      slantNote: null,
    },
  ],
  coreLinks: [{ discoveryId: 'd-dues', keyPassageId: 's1-doc1-kp1' }],
  discoveries: [
    {
      id: 's1-d-note',
      documentId: 's1-letter',
      keyPassageId: 's1-letter-kp1',
      text: 'Raffles ordered the flag to stay.',
      note: 'A direct order.',
      topic: '',
      sourceLabel: 'invented',
      citations: null,
    },
  ],
  documentPlacement: [
    { documentId: 'doc-1', roomId: 'office' },
    { documentId: 's1-letter', roomId: 'held' },
  ],
  situations: [],
  storyEvents: [],
  openQuestions: [{ id: 's1-q1', text: 'Who really wanted the port?', discoveryIds: ['d-treaty'] }],
}

const personaCore = {
  voice: 'Measured, courteous.',
  phrases: [{ text: SOURCE_TEXT, sourceLabel: 'from the teacher', citations: [{ sourceId: 'singapore-1819', quote: SOURCE_TEXT }] }],
  knewThen: 'Little.',
  wantsFromStudent: 'Advice.',
  withholds: ['Doubt'],
}
const threeStances = [
  { label: 'Guarding', demeanour: 'Cool.', hidden: false },
  { label: 'Weighing', demeanour: 'Thoughtful.', hidden: false },
  { label: 'Convinced', demeanour: 'Warm.', hidden: false },
]

const farquharOutput: PersonaLlmOutput = {
  persona: personaCore,
  stances: threeStances,
  initialStance: 1,
  trustNotice: 'He pauses before answering.',
  coreConditions: [{ discoveryId: 'd-treaty', requires: { discoveries: [], stanceAtLeast: null } }],
  discoveries: [
    {
      id: 'farquhar-d1',
      stageId: 's1',
      text: 'Farquhar fears a Dutch protest.',
      note: 'His real worry.',
      topic: '',
      sourceLabel: 'invented',
      citations: null,
      requires: { discoveries: ['d-dues', 'd-treaty'], stanceAtLeast: null },
    },
  ],
  slants: [{ id: 'farquhar-slant', claim: 'The Dutch will not object.', contradictedBy: ['d-dues'] }],
  triggers: [
    {
      id: 'farquhar-t1',
      on: { kind: 'discovered', id: 'd-dues' },
      requires: null,
      effect: { kind: 'stanceDelta', stance: null, delta: 1 },
      handsOver: [],
      notice: 'He softens.',
    },
  ],
}

const rafflesOutput: PersonaLlmOutput = {
  persona: personaCore,
  stances: threeStances,
  initialStance: 2,
  trustNotice: 'His jaw tightens.',
  coreConditions: [],
  discoveries: [
    {
      id: 'raffles-d1',
      stageId: 's1',
      text: 'Raffles wrote ahead to the Temenggong.',
      note: 'The plan was older.',
      topic: '',
      sourceLabel: 'invented',
      citations: null,
      requires: { discoveries: ['d-dues'], stanceAtLeast: null },
    },
  ],
  slants: [],
  triggers: [
    {
      id: 'raffles-t1',
      on: { kind: 'discovered', id: 'd-dues' },
      requires: null,
      effect: { kind: 'toStance', stance: 's3', delta: null },
      handsOver: [],
      notice: 'He brightens.',
    },
  ],
}

const minorsOutput: MinorsLlmOutput = {
  characters: [
    {
      characterId: 'nakhoda',
      persona: { ...personaCore, phrases: [{ text: 'Plain sailor talk.', sourceLabel: 'invented', citations: null }] },
      discoveries: [
        {
          id: 'nakhoda-d1',
          stageId: 's1',
          text: 'The Bugis watch the flags carefully.',
          note: 'They keep their own counsel.',
          topic: '',
          sourceLabel: 'invented',
          citations: null,
          requires: { discoveries: [] },
        },
      ],
      slants: [],
    },
  ],
}

const linkOutput: LinkLlmOutput = {
  slantLinks: [{ slantId: 'farquhar-slant', contradictedBy: ['s1-d-note'] }],
  noteTriggers: [
    { id: 'link-t1', characterId: 'raffles', discoveryId: 'd-dues', effect: { kind: 'stanceDelta', stance: null, delta: -1 }, notice: 'He bristles.' },
  ],
}

// --- routing fake LLM ----------------------------------------------------------------------

function routeKey(request: LlmJsonRequest): string {
  switch (request.schemaName) {
    case 'stage_details_v3':
      return `stage ${request.user.match(/Write stage: (\S+)/)![1]}`
    case 'persona_v3':
      return `persona ${request.user.match(/Write character: (\S+)/)![1]}`
    case 'minors_v3':
      return 'minors'
    case 'link_v3':
      return 'link'
    default:
      throw new Error(`unexpected schema ${request.schemaName}`)
  }
}

const usage: LlmUsage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 }

class RoutingLlm implements LlmClient {
  readonly requests: { key: string; request: LlmJsonRequest }[] = []
  constructor(private readonly routes: Record<string, FakeReply[]>) {}
  count(key: string): number {
    return this.requests.filter((r) => r.key === key).length
  }
  async completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    const key = routeKey(request)
    this.requests.push({ key, request })
    const reply = this.routes[key]?.shift()
    if (reply === undefined) throw new Error(`RoutingLlm: no scripted reply for ${key}`)
    if ('error' in reply) throw new Error(reply.error)
    const base = { usage, model: request.model, latencyMs: 1 }
    if ('refusal' in reply) return { ...base, text: null, json: null, refusal: reply.refusal }
    const text = 'json' in reply ? JSON.stringify(reply.json) : reply.text
    return { ...base, text, json: tryParseJson(text), refusal: null }
  }
}

const happyRoutes = () => ({
  'stage s1': [{ json: stageOutput }],
  'persona farquhar': [{ json: farquharOutput }],
  'persona raffles': [{ json: rafflesOutput }],
  minors: [{ json: minorsOutput }],
  link: [{ json: linkOutput }],
})

// --- tests -----------------------------------------------------------------------------------

describe('generateDetails', () => {
  it('happy path: merges a draft that validates and checks clean', async () => {
    const llm = new RoutingLlm(happyRoutes())
    const result = await generateDetails(input, { llm })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.pendingPasses).toEqual(['endings', 'reveal'])

    const draft = result.draft!
    expect(validateSpec(draft).ok).toBe(true)
    expect(checkSpec(draft)).toEqual({ errors: [], warnings: [] })

    // conversions
    const farquhar = draft.characters.find((c) => c.id === 'farquhar')!
    expect(farquhar.stances.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(farquhar.initialStanceId).toBe('s1')
    expect(farquhar.slants[0]!.contradictedBy).toEqual(['d-dues', 's1-d-note'])
    const raffles = draft.characters.find((c) => c.id === 'raffles')!
    expect(raffles.initialStanceId).toBe('s2')
    const nakhoda = draft.characters.find((c) => c.id === 'nakhoda')!
    expect(nakhoda.stances).toEqual([])
    expect(nakhoda.initialStanceId).toBeNull()

    // key passage offsets
    const doc1 = draft.documents.find((d) => d.id === 'doc-1')!
    expect(doc1.body.slice(doc1.keyPassages[0]!.start, doc1.keyPassages[0]!.end)).toBe('dues doubled')
    expect(doc1.provenance).toEqual({ masthead: 'Port Office' })

    // requires → Condition shapes: none / one / many
    expect(draft.discoveries.find((d) => d.id === 'd-treaty')!.condition).toBeUndefined()
    expect(draft.discoveries.find((d) => d.id === 'raffles-d1')!.condition).toEqual({ discovered: 'd-dues' })
    expect(draft.discoveries.find((d) => d.id === 'farquhar-d1')!.condition).toEqual({ all: [{ discovered: 'd-dues' }, { discovered: 'd-treaty' }] })

    // link note trigger + slanted documents
    expect(draft.triggers.find((t) => t.id === 'link-t1')).toMatchObject({ characterId: 'raffles', on: { notePassed: 'd-dues' }, effect: { stanceDelta: -1 } })
    expect(result.slantedDocuments).toEqual([{ stageId: 's1', documentId: 'doc-1', note: 'Omits the merchants’ side.' }])

    // placeholders + timer
    expect(draft.definingMoments[0]!.nudge).toBe('')
    expect(draft.definingMoments[0]!.outcomes[0]!.predictionText).toBe('')
    expect(draft.endings[0]!.interview.verdicts.map((v) => v.id)).toEqual(['e-historical-pending-v1', 'e-historical-pending-v2', 'e-historical-pending-v3'])
    expect(draft.timer).toEqual({ enabled: true, stageMinutes: [30] })
    expect(draft.hintAngles).toEqual([])
    expect(draft.conflicts).toEqual([])

    // metrics: one call per route with labels
    expect(result.metrics.calls.map((c) => c.label).sort()).toEqual(['link', 'minors', 'persona farquhar', 'persona raffles', 'stage s1'])
    for (const key of ['stage s1', 'persona farquhar', 'persona raffles', 'minors', 'link']) expect(llm.count(key)).toBe(1)
  })

  it('repairs a broken persona on the second reply; other routes stay at one call', async () => {
    const broken = JSON.parse(JSON.stringify(farquharOutput))
    broken.stances = threeStances.slice(0, 2) // only 2 stances
    const llm = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: broken }, { json: farquharOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.count('persona farquhar')).toBe(2)
    expect(llm.count('stage s1')).toBe(1)
    expect(llm.count('link')).toBe(1)
    const repair = llm.requests.filter((r) => r.key === 'persona farquhar')[1]!.request.user
    expect(repair).toContain('stance-count')
    expect(repair).toContain('Your previous output:')
  })

  it('rejects a stage output that rewrites a stub document (skeleton-changed), then repairs', async () => {
    const broken = JSON.parse(JSON.stringify(stageOutput))
    broken.documents[0].kind = 'letter'
    const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: broken }, { json: stageOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.count('stage s1')).toBe(2)
    expect(llm.requests.find((r) => r.key === 'stage s1' && r.request.user.includes('skeleton-changed'))).toBeDefined()
  })

  it('flags a dangling link contradictedBy and gives up after MAX_REPAIRS when always broken', async () => {
    const dangling: LinkLlmOutput = { slantLinks: [{ slantId: 'farquhar-slant', contradictedBy: ['nope'] }], noteTriggers: [] }
    const llm = new RoutingLlm({ ...happyRoutes(), link: [{ json: dangling }, { json: linkOutput }] })
    const ok = await generateDetails(input, { llm })
    expect(ok.ok).toBe(true)
    expect(llm.count('link')).toBe(2)
    expect(llm.requests.filter((r) => r.key === 'link')[1]!.request.user).toContain("discovery 'nope' does not exist")

    const always = new RoutingLlm({ ...happyRoutes(), link: [{ json: dangling }, { json: dangling }, { json: dangling }] })
    const result = await generateDetails(input, { llm: always })
    expect(result.ok).toBe(false)
    expect(always.count('link')).toBe(3)
    expect(result.issues.some((i) => i.code === 'ref')).toBe(true)
  })

  it('flags quote-not-in-source for an invented quote but passes normalised quotes', async () => {
    const curly = JSON.parse(JSON.stringify(stageOutput))
    curly.documents[0].citations = [{ sourceId: 'singapore-1819', quote: '“A   FREE PORT”' }] // curly quotes + extra spaces + case
    const invented = JSON.parse(JSON.stringify(stageOutput))
    invented.documents[0].citations = [{ sourceId: 'singapore-1819', quote: 'the harbour was crowded with ships' }]
    const split = JSON.parse(JSON.stringify(stageOutput))
    split.documents[0].citations = [{ sourceId: 'singapore-1819', quote: 'The treaty … 1819.' }]

    for (const variant of [curly, split]) {
      const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: variant }] })
      const result = await generateDetails(input, { llm })
      expect(result.ok).toBe(true)
      expect(llm.count('stage s1')).toBe(1)
    }

    const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: invented }, { json: stageOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.count('stage s1')).toBe(2)
    expect(llm.requests.filter((r) => r.key === 'stage s1')[1]!.request.user).toContain('quote-not-in-source')
  })

  it('flags id-prefix and passage-not-in-body', async () => {
    const broken = JSON.parse(JSON.stringify(stageOutput))
    broken.discoveries[0].id = 'wrong-prefix'
    broken.documents[1].keyPassages[0].text = 'not in the body'
    const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: broken }, { json: stageOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    const repair = llm.requests.filter((r) => r.key === 'stage s1')[1]!.request.user
    expect(repair).toContain('id-prefix')
    expect(repair).toContain('passage-not-in-body')
  })

  it('drops a slant left uncontradicted after linking, with a slant-dropped warning', async () => {
    const farq = JSON.parse(JSON.stringify(farquharOutput))
    farq.slants[0].contradictedBy = []
    const llm = new RoutingLlm({
      ...happyRoutes(),
      'persona farquhar': [{ json: farq }],
      link: [{ json: { slantLinks: [], noteTriggers: [] } }],
    })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.code === 'slant-dropped')).toBe(true)
    expect(result.draft!.characters.find((c) => c.id === 'farquhar')!.slants).toEqual([])
  })

  it('routes a post-merge core-unreachable error back to the owning persona only', async () => {
    const gated = JSON.parse(JSON.stringify(farquharOutput))
    gated.coreConditions[0].requires = { discoveries: [], stanceAtLeast: 's3' }
    // s3 unreachable: the only trigger moves to s2, not by delta
    gated.triggers = [{ id: 'farquhar-t1', on: { kind: 'discovered', id: 'd-dues' }, requires: null, effect: { kind: 'toStance', stance: 's2', delta: null }, handsOver: [], notice: 'He softens.' }]
    const llm = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: gated }, { json: farquharOutput }], link: [{ json: linkOutput }, { json: linkOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.count('persona farquhar')).toBe(2)
    expect(llm.count('stage s1')).toBe(1)
    expect(llm.count('persona raffles')).toBe(1)
    expect(llm.count('link')).toBe(2) // re-run after the repair round
    expect(llm.requests.filter((r) => r.key === 'persona farquhar')[1]!.request.user).toContain('core-unreachable')
  })
})
