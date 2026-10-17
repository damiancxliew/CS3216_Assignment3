import { describe, expect, it } from 'vitest'
import { checkSpec, validateSpec } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../src/ingest/types'
import type { FakeReply, LlmJsonRequest, LlmJsonResponse, LlmUsage } from '../src/llm/client'
import { tryParseJson } from '../src/llm/client'
import type { LlmClient } from '../src/llm/client'
import { assembleDetails, blame, finalRepair, generateDetails, specErrors, toSkeleton } from '../src/v3/index'
import { mergeDetails } from '../src/v3/details/merge'
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
      citations: [{ sourceId: 'singapore-1819', quote: 'The treaty was signed on 6 February 1819.' }],
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
      body: 'The treaty was signed on 6 February 1819.',
      sourceLabel: 'from the teacher',
      glossary: [],
      keyPassages: [{ id: 's1-doc1-kp1', text: 'signed on 6 February 1819' }],
      citations: [{ sourceId: 'singapore-1819', quote: null }],
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
  hintAngles: [
    { id: 's1-h1', discoveryId: 'd-treaty', kind: 'ask', text: 'Perhaps Farquhar knows who really signed.' },
    { id: 's1-h2', discoveryId: 'd-dues', kind: 'read', text: 'Perhaps the register mentions the dues.' },
  ],
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
    { id: 'link-t1', characterId: 'raffles', discoveryId: 's1-d-note', effect: { kind: 'stanceDelta', stance: null, delta: -1 }, notice: 'He bristles.' },
  ],
  duplicates: [],
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
    expect(doc1.body.slice(doc1.keyPassages[0]!.start, doc1.keyPassages[0]!.end)).toBe('signed on 6 February 1819')
    expect(doc1.provenance).toEqual({ masthead: 'Port Office' })

    // requires → Condition shapes: none / one / many
    expect(draft.discoveries.find((d) => d.id === 'd-treaty')!.condition).toBeUndefined()
    expect(draft.discoveries.find((d) => d.id === 'raffles-d1')!.condition).toEqual({ discovered: 'd-dues' })
    expect(draft.discoveries.find((d) => d.id === 'farquhar-d1')!.condition).toEqual({ all: [{ discovered: 'd-dues' }, { discovered: 'd-treaty' }] })

    // link note trigger + slanted documents
    expect(draft.triggers.find((t) => t.id === 'link-t1')).toMatchObject({ characterId: 'raffles', on: { notePassed: 's1-d-note' }, effect: { stanceDelta: -1 } })
    expect(result.slantedDocuments).toEqual([{ stageId: 's1', documentId: 'doc-1', note: 'Omits the merchants’ side.' }])

    // placeholders + timer
    expect(draft.definingMoments[0]!.nudge).toBe('')
    expect(draft.definingMoments[0]!.outcomes[0]!.predictionText).toBe('')
    expect(draft.endings[0]!.interview.verdicts.map((v) => v.id)).toEqual(['e-historical-pending-v1', 'e-historical-pending-v2', 'e-historical-pending-v3'])
    expect(draft.timer).toEqual({ enabled: true, stageMinutes: [45] })
    expect(draft.hintAngles).toEqual([
      { id: 's1-h1', discoveryId: 'd-treaty', kind: 'ask', text: 'Perhaps Farquhar knows who really signed.' },
      { id: 's1-h2', discoveryId: 'd-dues', kind: 'read', text: 'Perhaps the register mentions the dues.' },
    ])
    expect(draft.conflicts).toEqual([])

    // metrics: one call per route with labels
    expect(result.metrics.calls.map((c) => c.label).sort()).toEqual(['link', 'minors', 'persona farquhar', 'persona raffles', 'stage s1'])
    for (const key of ['stage s1', 'persona farquhar', 'persona raffles', 'minors', 'link']) expect(llm.count(key)).toBe(1)
  })

  it('returns its parts, and assembling them in code gives the same draft (#209)', async () => {
    const result = await generateDetails(input, { llm: new RoutingLlm(happyRoutes()) })
    expect(Object.keys(result.parts).sort()).toEqual(['link', 'minors', 'persona:farquhar', 'persona:raffles', 'stage:s1'])
    expect(assembleDetails(input.skeleton, result.parts).draft).toEqual(result.draft)
  })

  it('gives a part with no output one fresh call and keeps the other parts (#209)', async () => {
    const llm = new RoutingLlm({ ...happyRoutes(), 'persona raffles': [{ refusal: 'no' }, { refusal: 'no' }, { refusal: 'no' }, { json: rafflesOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.count('persona raffles')).toBe(4)
    expect(llm.count('stage s1')).toBe(1)
    expect(llm.count('persona farquhar')).toBe(1)
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
    const dangling: LinkLlmOutput = { slantLinks: [{ slantId: 'farquhar-slant', contradictedBy: ['nope'] }], noteTriggers: [], duplicates: [] }
    const llm = new RoutingLlm({ ...happyRoutes(), link: [{ json: dangling }, { json: linkOutput }] })
    const ok = await generateDetails(input, { llm })
    expect(ok.ok).toBe(true)
    expect(llm.count('link')).toBe(2)
    expect(llm.requests.filter((r) => r.key === 'link')[1]!.request.user).toContain("discovery 'nope' does not exist")

    // still broken after its own repairs: the pass carries on, and returns the draft and its parts with the errors (#209)
    const always = new RoutingLlm({
      ...happyRoutes(),
      'persona farquhar': [{ json: farquharOutput }, { json: farquharOutput }],
      link: Array.from({ length: 6 }, () => ({ json: dangling })),
    })
    const result = await generateDetails(input, { llm: always })
    expect(result.ok).toBe(false)
    expect(always.count('link')).toBeGreaterThanOrEqual(3)
    expect(result.issues.some((i) => i.code === 'ref')).toBe(true)
    expect(result.draft).toBeDefined()
    expect(result.parts.link?.issues.some((i) => i.code === 'ref')).toBe(true)
  })

  it('flags quote-not-in-source for an invented quote but passes normalised quotes', async () => {
    const curly = JSON.parse(JSON.stringify(stageOutput))
    curly.documents[0].citations = [{ sourceId: 'singapore-1819', quote: '“A   FREE PORT”' }] // curly quotes + extra spaces + case
    const invented = JSON.parse(JSON.stringify(stageOutput))
    invented.documents[0].citations = [{ sourceId: 'singapore-1819', quote: 'the harbour was crowded with ships' }]
    const split = JSON.parse(JSON.stringify(stageOutput))
    split.documents[0].citations = [{ sourceId: 'singapore-1819', quote: 'The treaty was signed … Farquhar called it' }]
    const thin = JSON.parse(JSON.stringify(stageOutput))
    thin.documents[0].citations = [{ sourceId: 'singapore-1819', quote: 'The … 1819.' }] // elided pieces too short to count

    for (const variant of [curly, split]) {
      const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: variant }] })
      const result = await generateDetails(input, { llm })
      expect(result.ok).toBe(true)
      expect(llm.count('stage s1')).toBe(1)
    }

    for (const variant of [invented, thin]) {
      const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: variant }, { json: stageOutput }] })
      const result = await generateDetails(input, { llm })
      expect(result.ok).toBe(true)
      expect(llm.count('stage s1')).toBe(2)
      expect(llm.requests.filter((r) => r.key === 'stage s1')[1]!.request.user).toContain('quote-not-in-source')
    }
  })

  it('requires a real document to cite a source and reproduce it word for word (G13.2)', async () => {
    const rewritten = JSON.parse(JSON.stringify(stageOutput))
    rewritten.documents[0].body = 'The treaty was signed on 6 February 1819 to great acclaim.'
    rewritten.documents[0].keyPassages = [{ id: 's1-doc1-kp1', text: 'signed on 6 February 1819' }]
    const uncited = JSON.parse(JSON.stringify(stageOutput))
    uncited.documents[0].citations = null
    for (const [variant, code] of [[rewritten, 'quote-not-in-source'], [uncited, 'real-uncited']] as const) {
      const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: variant }, { json: stageOutput }] })
      const result = await generateDetails(input, { llm })
      expect(result.ok).toBe(true)
      expect(llm.count('stage s1')).toBe(2)
      expect(llm.requests.filter((r) => r.key === 'stage s1')[1]!.request.user).toContain(code)
    }
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
      link: [{ json: { slantLinks: [], noteTriggers: [], duplicates: [] } }],
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
    // every call, the routed repair included, is in the metrics
    expect(result.metrics.calls).toHaveLength(llm.requests.length)
  })

  it('rejects a link noteTrigger duplicating an existing persona trigger, then repairs', async () => {
    const dup: LinkLlmOutput = {
      ...linkOutput,
      noteTriggers: [{ id: 'link-t1', characterId: 'farquhar', discoveryId: 'd-dues', effect: { kind: 'stanceDelta', stance: null, delta: 1 }, notice: 'Again.' }],
    }
    const llm = new RoutingLlm({ ...happyRoutes(), link: [{ json: dup }, { json: linkOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.count('link')).toBe(2)
    expect(llm.requests.filter((r) => r.key === 'link')[1]!.request.user).toContain('duplicate-trigger')
  })

  it('requires ≥2 requires conditions on a toStance into the hidden stance', async () => {
    const hidden = JSON.parse(JSON.stringify(farquharOutput))
    hidden.stances[2].hidden = true
    hidden.triggers[0] = { id: 'farquhar-t1', on: { kind: 'discovered', id: 'd-dues' }, requires: { discoveries: ['d-treaty'], stanceAtLeast: null }, effect: { kind: 'toStance', stance: 's3', delta: null }, handsOver: [], notice: 'He opens fully.' }
    const bad = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: hidden }, { json: farquharOutput }] })
    const res = await generateDetails(input, { llm: bad })
    expect(res.ok).toBe(true)
    expect(bad.requests.filter((r) => r.key === 'persona farquhar')[1]!.request.user).toContain('hidden-stance-guard')

    hidden.triggers[0].requires = { discoveries: ['d-treaty'], stanceAtLeast: 's2' }
    const good = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: hidden }] })
    const res2 = await generateDetails(input, { llm: good })
    expect(res2.issues.filter((i) => i.code === 'hidden-stance-guard')).toEqual([])
    expect(good.count('persona farquhar')).toBe(1)
  })

  it('flags a beginMoment event on discovered and converts allCore to the core conditions', async () => {
    const bad = JSON.parse(JSON.stringify(stageOutput))
    bad.storyEvents = [{ id: 's1-ev1', when: { kind: 'discovered', seconds: null, discoveryId: 'd-treaty' }, effect: 'beginMoment', characterId: null, toRoomId: null, documentId: null, text: 'Time to decide.' }]
    const good = JSON.parse(JSON.stringify(stageOutput))
    good.storyEvents = [{ id: 's1-ev1', when: { kind: 'allCore', seconds: null, discoveryId: null }, effect: 'beginMoment', characterId: null, toRoomId: null, documentId: null, text: 'Time to decide.' }]
    const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: bad }, { json: good }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests.filter((r) => r.key === 'stage s1')[1]!.request.user).toContain('begin-moment')
    const event = result.draft!.storyEvents.find((e) => e.id === 's1-ev1')!
    expect(event.when).toEqual({ condition: { all: [{ discovered: 'd-treaty' }, { discovered: 'd-dues' }] } })
  })

  it('merges duplicate discoveries: removes the drop and remaps every reference', async () => {
    // farquhar-d2 duplicates farquhar-d1's fact; the link keeps s1-d-note instead
    const farq = JSON.parse(JSON.stringify(farquharOutput))
    farq.discoveries.push({ id: 'farquhar-d2', stageId: 's1', text: 'Raffles ordered the flag to stay.', note: 'Same fact again.', topic: '', sourceLabel: 'invented', citations: null, requires: { discoveries: [], stanceAtLeast: null } })
    farq.discoveries[0].requires = { discoveries: ['farquhar-d2'], stanceAtLeast: null } // condition referencing the drop
    farq.triggers[0].on = { kind: 'discovered', id: 'farquhar-d2' } // trigger on referencing the drop
    farq.slants[0].contradictedBy = ['d-dues', 'farquhar-d2'] // slant contradictedBy referencing the drop
    const link: LinkLlmOutput = {
      slantLinks: [],
      noteTriggers: [],
      duplicates: [{ keep: 's1-d-note', drop: ['farquhar-d2'] }],
    }
    const llm = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: farq }], link: [{ json: link }] })
    const result = await generateDetails(input, { llm })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    const draft = result.draft!
    expect(draft.discoveries.find((d) => d.id === 'farquhar-d2')).toBeUndefined()
    expect(draft.discoveries.find((d) => d.id === 'farquhar-d1')!.condition).toEqual({ discovered: 's1-d-note' })
    expect(draft.triggers.find((t) => t.id === 'farquhar-t1')!.on).toEqual({ discovered: 's1-d-note' })
    expect(draft.characters.find((c) => c.id === 'farquhar')!.slants[0]!.contradictedBy).toEqual(['d-dues', 's1-d-note'])
    expect(result.warnings.some((w) => w.code === 'discovery-merged' && w.message === "'farquhar-d2' merged into 's1-d-note'")).toBe(true)
    expect(result.mergedDuplicates).toEqual([{ keep: 's1-d-note', drop: ['farquhar-d2'] }])

    // dropping a core or a document-held discovery is rejected by the link check
    for (const drop of ['d-dues', 's1-d-note', 'd-treaty']) {
      const badLink: LinkLlmOutput = { ...linkOutput, duplicates: [{ keep: 'farquhar-d1', drop: [drop] }] }
      const bad = new RoutingLlm({ ...happyRoutes(), link: [{ json: badLink }, { json: linkOutput }] })
      const r = await generateDetails(input, { llm: bad })
      expect(r.ok).toBe(true) // repaired
      expect(bad.requests.filter((x) => x.key === 'link')[1]!.request.user).toContain('duplicate-merge')
    }
  })

  it('drops a slant contradicted only by its own holder, trigger included, with no duplicates', async () => {
    const farq = JSON.parse(JSON.stringify(farquharOutput))
    farq.slants[0].contradictedBy = ['farquhar-d1'] // held by farquhar himself
    farq.triggers.push({ id: 'farquhar-t2', on: { kind: 'slantConfronted', id: 'farquhar-slant' }, requires: null, effect: { kind: 'stanceDelta', stance: null, delta: -1 }, handsOver: [], notice: 'n' })
    const link: LinkLlmOutput = { slantLinks: [], noteTriggers: [], duplicates: [] }
    const llm = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: farq }], link: [{ json: link }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    const farquhar = result.draft!.characters.find((c) => c.id === 'farquhar')!
    expect(farquhar.slants).toEqual([])
    expect(result.draft!.triggers.find((t) => t.id === 'farquhar-t2')).toBeUndefined()
    expect(result.warnings.filter((w) => w.code === 'slant-dropped')).toHaveLength(2)
    expect(result.warnings[0]!.message).toBe("slant 'farquhar-slant' has no contradicting discovery held by a document or another character")
    // the link user message must flag it
    const linkRequest = llm.requests.find((r) => r.key === 'link')!.request.user
    expect(linkRequest).toContain('needs evidence from a document or another character, or it will be dropped')
  })

  it('warns slant-reactions-uniform when ≥3 slant triggers all move the same direction', async () => {
    const farq = JSON.parse(JSON.stringify(farquharOutput))
    const raf = JSON.parse(JSON.stringify(rafflesOutput))
    raf.slants = [{ id: 'raffles-sl1', claim: 'x', contradictedBy: ['d-dues'] }]
    raf.triggers.push({ id: 'raffles-t2', on: { kind: 'slantConfronted', id: 'raffles-sl1' }, requires: null, effect: { kind: 'stanceDelta', stance: null, delta: -1 }, handsOver: [], notice: 'n' })
    farq.slants.push({ id: 'farquhar-slant2', claim: 'y', contradictedBy: ['d-dues'] })
    farq.triggers.push({ id: 'farquhar-t2', on: { kind: 'slantConfronted', id: 'farquhar-slant' }, requires: null, effect: { kind: 'stanceDelta', stance: null, delta: -1 }, handsOver: [], notice: 'n' })
    farq.triggers.push({ id: 'farquhar-t3', on: { kind: 'slantConfronted', id: 'farquhar-slant2' }, requires: null, effect: { kind: 'stanceDelta', stance: null, delta: -1 }, handsOver: [], notice: 'n' })
    const llm = new RoutingLlm({ ...happyRoutes(), 'persona farquhar': [{ json: farq }], 'persona raffles': [{ json: raf }] })
    const result = await generateDetails(input, { llm })
    expect(result.warnings.some((w) => w.code === 'slant-reactions-uniform' && w.path === 'triggers')).toBe(true)
  })

  it('repairs a core discovery with no hint angle', async () => {
    const broken = JSON.parse(JSON.stringify(stageOutput))
    broken.hintAngles = broken.hintAngles.filter((a: { discoveryId: string }) => a.discoveryId !== 'd-treaty')
    const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: broken }, { json: stageOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    const stageCalls = llm.requests.filter((r) => r.key === 'stage s1')
    expect(stageCalls).toHaveLength(2)
    expect(stageCalls[1]!.request.user).toContain('hint-angle-missing')
    expect(result.draft!.hintAngles).toHaveLength(2)
  })

  it('rejects a read angle on a character-held discovery', async () => {
    const broken = JSON.parse(JSON.stringify(stageOutput))
    broken.hintAngles[0].kind = 'read' // d-treaty is held by farquhar
    const llm = new RoutingLlm({ ...happyRoutes(), 'stage s1': [{ json: broken }, { json: stageOutput }] })
    const result = await generateDetails(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests.filter((r) => r.key === 'stage s1')).toHaveLength(2)
    expect(llm.requests.filter((r) => r.key === 'stage s1')[1]!.request.user).toContain('hint-angle-kind')
  })

  it('remaps, drops and dedupes hint angles on a duplicate merge', () => {
    // drop candidates are only character-held discoveries, which hint angles may not reference —
    // exercise the merge-level remap/drop/dedupe directly on mergeDetails
    const withAngles = JSON.parse(JSON.stringify(stageOutput)) as StageDetailsLlmOutput
    withAngles.hintAngles.push({ id: 's1-h3', discoveryId: 'farquhar-d1', kind: 'passOn', text: 'Perhaps someone should hear this worry.' })
    withAngles.hintAngles.push({ id: 's1-h3b', discoveryId: 'farquhar-d1', kind: 'passOn', text: 'Perhaps someone should hear this worry.' }) // identical → deduped
    withAngles.hintAngles.push({ id: 's1-h4', discoveryId: 'gone-id', kind: 'show', text: 'Nowhere to point.' }) // no such discovery → dropped
    const link: LinkLlmOutput = { slantLinks: [], noteTriggers: [], duplicates: [{ keep: 'd-dues', drop: ['farquhar-d1'] }] }
    const merged = mergeDetails(skeleton, {
      stages: new Map([['s1', withAngles]]),
      personas: new Map([
        ['farquhar', farquharOutput],
        ['raffles', rafflesOutput],
      ]),
      minors: minorsOutput,
      link,
    })
    const angles = merged.draft.hintAngles
    expect(angles.find((a) => a.id === 's1-h3')?.discoveryId).toBe('d-dues')
    expect(angles.filter((a) => a.kind === 'passOn' && a.discoveryId === 'd-dues')).toHaveLength(1)
    expect(angles.find((a) => a.id === 's1-h4')).toBeUndefined()
    expect(merged.draft.discoveries.find((d) => d.id === 'farquhar-d1')).toBeUndefined()
  })

  it('merges the requested timer duration, no timer, and the 45-minute default', () => {
    const parts = {
      stages: new Map([['s1', stageOutput]]),
      personas: new Map([
        ['farquhar', farquharOutput],
        ['raffles', rafflesOutput],
      ]),
      minors: minorsOutput,
      link: linkOutput,
    }

    expect(mergeDetails(skeleton, parts, { timerMinutes: 60 }).draft.timer).toEqual({
      enabled: true,
      stageMinutes: [60],
    })
    expect(mergeDetails(skeleton, parts, { timerMinutes: null }).draft.timer).toEqual({
      enabled: false,
      stageMinutes: [45],
    })
    expect(mergeDetails(skeleton, parts).draft.timer).toEqual({
      enabled: true,
      stageMinutes: [45],
    })
  })
})

describe('final check-and-repair (#209)', () => {
  const generated = async () => {
    const result = await generateDetails(input, { llm: new RoutingLlm(happyRoutes()) })
    expect(result.ok).toBe(true)
    return result
  }

  it('blames a planned id nobody produced on its producer, not on the part that refers to it', async () => {
    const result = await generated()
    const spec = structuredClone(result.draft!)
    spec.documents = spec.documents.filter((d) => d.id !== 'doc-1')
    const refs = specErrors(spec).filter((i) => i.code === 'ref' && i.ids?.[0] === 'doc-1')
    expect(refs.length).toBeGreaterThan(0)
    for (const issue of refs) expect(blame(issue, { skeleton, spec, parts: result.parts })).toEqual(['stage:s1'])
  })

  it('blames an invented id on the part that refers to it', async () => {
    const result = await generated()
    const spec = structuredClone(result.draft!)
    const i = spec.discoveries.findIndex((d) => d.id === 'raffles-d1')
    spec.discoveries[i]!.condition = { discovered: 'raffles-nope' }
    const issue = specErrors(spec).find((e) => e.code === 'ref' && e.ids?.[0] === 'raffles-nope')!
    expect(issue.path.startsWith(`discoveries.${i}`)).toBe(true)
    expect(blame(issue, { skeleton, spec, parts: result.parts })).toEqual(['persona:raffles'])
  })

  it('leaves skeleton-level errors unblamed, for the teacher', async () => {
    const result = await generated()
    expect(blame({ code: 'historical-missing', path: 'endings', message: 'x' }, { skeleton, spec: result.draft!, parts: result.parts })).toEqual([])
  })

  it('blames a cross-part error on its fixed group: historical-unreachable on every moment part', async () => {
    const result = await generated()
    const parts = { ...result.parts, 'moment:m1': { output: {}, issues: [] } }
    expect(blame({ code: 'historical-unreachable', path: 'endings', message: 'x' }, { skeleton, spec: result.draft!, parts })).toEqual(['moment:m1'])
    // a part that was never saved can't be redone
    expect(blame({ code: 'historical-unreachable', path: 'endings', message: 'x' }, { skeleton, spec: result.draft!, parts: result.parts })).toEqual([])
  })

  it('redoes only the blamed part, from its saved output, and reassembles a clean spec', async () => {
    const result = await generated()
    const broken = JSON.parse(JSON.stringify(rafflesOutput).replace('"d-dues"', '"raffles-nope"'))
    const parts = { ...result.parts, 'persona:raffles': { output: broken, issues: [] } }
    const llm = new RoutingLlm({ 'persona raffles': [{ json: rafflesOutput }] })
    const repair = await finalRepair({ skeleton, documents: [doc], parts }, { llm })
    expect(repair.repaired).toEqual(['persona:raffles'])
    expect(repair.errors).toEqual([])
    expect(repair.spec).toEqual(result.draft)
    expect(llm.requests.map((r) => r.key)).toEqual(['persona raffles'])
    expect(llm.requests[0]!.request.user).toContain('Your previous output:')
    expect(llm.requests[0]!.request.user).toContain('raffles-nope')
  })

  it('does nothing on a clean spec', async () => {
    const result = await generated()
    const llm = new RoutingLlm({})
    const repair = await finalRepair({ skeleton, documents: [doc], parts: result.parts }, { llm })
    expect(repair).toMatchObject({ errors: [], unresolved: [], repaired: [] })
    expect(llm.requests).toEqual([])
  })
})
