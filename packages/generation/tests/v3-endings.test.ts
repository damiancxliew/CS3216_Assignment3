/**
 * Endings-pass tests: one moment call + one ending call each, RoutingLlm keyed by
 * 'moment <id>' / 'ending <id>'. The draft fixture is a minimal valid AdventureSpec with
 * pending endings fields, like mergeDetails produces.
 */
import { describe, expect, it, vi } from 'vitest'
import type { AdventureSpec, CheckIssue } from '@adventure/spec-v3'

import type { FakeReply, LlmJsonRequest, LlmJsonResponse, LlmUsage } from '../src/llm/client'
import { tryParseJson } from '../src/llm/client'
import type { LlmClient } from '../src/llm/client'
import { generateEndings } from '../src/v3/index'
import type { Atom, EndingLlmOutput, MomentLlmOutput } from '../src/v3/index'

// allow tests to inject post-merge checkSpec errors (routing test)
const injected = vi.hoisted(() => ({ issues: [] as CheckIssue[] }))
vi.mock('@adventure/spec-v3', async (importOriginal) => {
  const real = await importOriginal<typeof import('@adventure/spec-v3')>()
  return {
    ...real,
    checkSpec: (spec: AdventureSpec) => {
      const result = real.checkSpec(spec)
      return { errors: [...result.errors, ...injected.issues], warnings: result.warnings }
    },
  }
})
import { checkSpec, validateSpec } from '@adventure/spec-v3'

// --- fixture draft -------------------------------------------------------------------------------

const persona = { voice: 'v', phrases: [], knewThen: 'k', wantsFromStudent: 'w', withholds: ['x'], publicPosition: 'p', privateAgenda: 'a' }
const stances = [
  { id: 's1', label: 'Guarded', demeanour: 'd' },
  { id: 's2', label: 'Open', demeanour: 'd' },
  { id: 's3', label: 'Candid', demeanour: 'd' },
]

const draft: AdventureSpec = {
  id: 'adv',
  title: 'The Test',
  readingLevel: 'sec',
  timer: { enabled: true, stageMinutes: [15, 15] },
  role: { name: 'Clerk', position: 'Junior clerk', relationships: [], reputation: 'new', stakes: 's', privateBrief: { goals: [], fears: [], constraints: [], knows: [] }, situation: 'new' },
  stages: [
    {
      id: 's1',
      title: 'First',
      timePlace: 'Feb 1819',
      centralQuestion: 'q1',
      openingNarration: 'Dawn.',
      rooms: [
        { id: 'r1', name: 'Dock', description: 'd' },
        { id: 'r2', name: 'Office', description: 'd' },
      ],
      startRoomId: 'r1',
      placement: { farquhar: 'r1', raffles: 'r2' },
      documentPlacement: { 'doc-1': 'r1' },
      situations: [],
      definingMomentId: 'm1',
    },
    {
      id: 's2',
      title: 'Second',
      timePlace: 'Feb 1819',
      centralQuestion: 'q2',
      openingNarration: 'Next.',
      rooms: [
        { id: 'r3', name: 'Hall', description: 'd' },
        { id: 'r4', name: 'Veranda', description: 'd' },
      ],
      startRoomId: 'r3',
      placement: { farquhar: 'r3', raffles: 'r3' },
      documentPlacement: { 'doc-2': 'r3' },
      situations: [],
      definingMomentId: 'm2',
    },
  ],
  characters: [
    {
      id: 'farquhar',
      name: 'Farquhar',
      title: 'Resident',
      real: true,
      tier: 'major',
      persona,
      stances,
      initialStanceId: 's1',
      slants: [{ id: 'farquhar-sl1', claim: 'c', contradictedBy: ['d-core2'] }],
      trustNotice: 'n',
    },
    {
      id: 'raffles',
      name: 'Raffles',
      title: 'Lieutenant-Governor',
      real: true,
      tier: 'major',
      persona,
      stances,
      initialStanceId: 's2',
      slants: [],
      trustNotice: 'n',
    },
  ],
  discoveries: [
    {
      id: 'd-core1',
      stageId: 's1',
      holder: { characterId: 'farquhar' },
      text: 'Core one.',
      note: 'n',
      core: true,
      sourceLabel: 'from the teacher',
      citations: [{ sourceId: 'src', quote: 'core one' }],
    },
    {
      id: 'd-extra',
      stageId: 's1',
      holder: { documentId: 'doc-1', keyPassageId: 'kp-1' },
      text: 'Extra.',
      note: 'n',
      core: false,
      sourceLabel: 'invented',
    },
    {
      id: 'd-guarded',
      stageId: 's1',
      holder: { characterId: 'raffles' },
      text: 'Guarded.',
      note: 'n',
      core: false,
      condition: { discovered: 'd-core1' },
      sourceLabel: 'invented',
    },
    {
      id: 'd-core2',
      stageId: 's2',
      holder: { documentId: 'doc-2', keyPassageId: 'kp-2' },
      text: 'Core two.',
      note: 'n',
      core: true,
      sourceLabel: 'from the teacher',
      citations: [{ sourceId: 'src', quote: 'core two' }],
    },
  ],
  documents: [
    { id: 'doc-1', kind: 'report', title: 'R1', provenance: {}, body: 'Body one text.', real: false, sourceLabel: 'invented', glossary: [], keyPassages: [{ id: 'kp-1', start: 0, end: 8 }] },
    { id: 'doc-2', kind: 'letter', title: 'L2', provenance: {}, body: 'Body two text.', real: false, sourceLabel: 'invented', glossary: [], keyPassages: [{ id: 'kp-2', start: 0, end: 8 }] },
  ],
  triggers: [],
  definingMoments: [
    {
      id: 'm1',
      stageId: 's1',
      deciderId: 'farquhar',
      scene: 'A schooner is sighted.',
      nudge: '',
      finalCallNarration: '',
      acts: [
        { id: 'a1-hold', text: 'Hold the flag', reaction: '' },
        { id: 'a1-yield', text: 'Yield quietly', reaction: '' },
      ],
      outcomes: [
        { id: 'o1-hold', summary: 'The flag stays.', predictionText: '', because: '', endingId: 'e-historical', historical: true, closesEndingIds: [] },
        { id: 'o1-yield', summary: 'The flag falls.', predictionText: '', because: '', endingId: 'e-alt1', closesEndingIds: [] },
        { id: 'o1-stall', summary: 'Farquhar stalls.', predictionText: '', because: '', endingId: 'e-alt2', closesEndingIds: [] },
      ],
      rules: [
        { actId: 'a1-hold', outcomeId: 'o1-hold' },
        { actId: 'a1-yield', outcomeId: 'o1-yield' },
        { actId: 'a1-yield', outcomeId: 'o1-stall' },
      ],
    },
    {
      id: 'm2',
      stageId: 's2',
      deciderId: 'raffles',
      scene: 'The treaty sits unsigned.',
      nudge: '',
      finalCallNarration: '',
      acts: [
        { id: 'a2-sign', text: 'Press for signature', reaction: '' },
        { id: 'a2-refuse', text: 'Advise refusal', reaction: '' },
      ],
      outcomes: [
        { id: 'o2-sign', summary: 'He signs.', predictionText: '', because: '', endingId: 'e-historical', historical: true, closesEndingIds: [] },
        { id: 'o2-refuse', summary: 'He refuses.', predictionText: '', because: '', endingId: 'e-alt1', closesEndingIds: [] },
        { id: 'o2-defer', summary: 'He defers.', predictionText: '', because: '', endingId: 'e-alt2', closesEndingIds: [] },
      ],
      rules: [
        { actId: 'a2-sign', outcomeId: 'o2-sign' },
        { actId: 'a2-refuse', outcomeId: 'o2-refuse' },
        { actId: 'a2-refuse', outcomeId: 'o2-defer' },
      ],
    },
  ],
  endings: [
    { id: 'e-historical', type: 'historical', title: 'The Port Holds', summary: 'It survives.', epilogue: '', interview: { interviewer: '', question: '', verdicts: [1, 2, 3].map((n) => ({ id: `e-historical-pending-v${n}`, text: '', counterPoints: [] })), generalCounter: '' }, sourceLabel: 'from the teacher', citations: [{ sourceId: 'src', quote: 'it held' }] },
    { id: 'e-alt1', type: 'alternative', title: 'Flag Down', summary: 'It folds.', epilogue: '', interview: { interviewer: '', question: '', verdicts: [1, 2, 3].map((n) => ({ id: `e-alt1-pending-v${n}`, text: '', counterPoints: [] })), generalCounter: '' }, sourceLabel: 'invented' },
    { id: 'e-alt2', type: 'alternative', title: 'Long Talks', summary: 'Deferred.', epilogue: '', interview: { interviewer: '', question: '', verdicts: [1, 2, 3].map((n) => ({ id: `e-alt2-pending-v${n}`, text: '', counterPoints: [] })), generalCounter: '' }, sourceLabel: 'invented' },
  ],
  teacherQuestions: [],
  sources: [{ id: 'src', title: 'handout', origin: 'teacher' }],
  conflicts: [],
  storyEvents: [],
  openQuestions: [{ id: 's1-q1', stageId: 's1', text: 'Who held the pen?', discoveryIds: ['d-core1'] }],
  hintAngles: [],
}

const atom = (kind: Atom['kind'], fields: Partial<Atom> = {}): Atom => ({
  kind,
  negate: false,
  discoveryId: null,
  characterId: null,
  stanceId: null,
  slantId: null,
  momentId: null,
  outcomeId: null,
  ...fields,
})

const momentOutput = (overrides: Partial<MomentLlmOutput> = {}, momentId = 'm1'): MomentLlmOutput => {
  const moment = draft.definingMoments.find((m) => m.id === momentId)!
  return {
    nudge: 'There is more you have not uncovered yet.',
    finalCallNarration: 'The time is up; the decider will not wait.',
    acts: moment.acts.map((a) => ({ id: a.id, reaction: `Reaction to ${a.id}.`, deception: false })),
    outcomes: moment.outcomes.map((o) => ({ id: o.id, predictionText: `Prediction ${o.id}.`, because: `Because of ${o.id}.` })),
    conditionalRules: [],
    secretUnlock: null,
    ...overrides,
  }
}

const endingOutput = (overrides: Partial<EndingLlmOutput> = {}): EndingLlmOutput => ({
  epilogue: 'Your simulation: February 1819. The flag stayed up, and the settlement grew.',
  interviewer: 'A Straits Times journalist, 1966',
  question: 'Could the outcome have been different?',
  verdicts: [
    { text: 'It was inevitable.', counterPoints: ['d-core1'] },
    { text: 'It depended on the messenger.', counterPoints: ['d-extra', 'd-core2'] },
    { text: 'Another decision was possible.', counterPoints: ['d-core2'] },
  ],
  generalCounter: 'Historians still argue about it.',
  ...overrides,
})

// --- routing fake LLM -----------------------------------------------------------------------------

function routeKey(request: LlmJsonRequest): string {
  switch (request.schemaName) {
    case 'moment_v3':
      return `moment ${request.user.match(/Write moment: (\S+)/)![1]}`
    case 'ending_v3':
      return `ending ${request.user.match(/Write ending: (\S+)/)![1]}`
    default:
      throw new Error(`unexpected schema ${request.schemaName}`)
  }
}

const usage: LlmUsage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 }

class RoutingLlm implements LlmClient {
  readonly requests: { key: string; request: LlmJsonRequest }[] = []
  constructor(private readonly routes: Record<string, FakeReply[]>) {}
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
  'moment m1': [{ json: momentOutput({ conditionalRules: [{ actId: 'a1-yield', outcomeId: 'o1-hold', when: [atom('notePassed', { discoveryId: 'd-extra', characterId: 'raffles' }), atom('stanceAtLeast', { characterId: 'raffles', stanceId: 's2' }), atom('slantConfronted', { slantId: 'farquhar-sl1', negate: true })] }] }) }],
  'moment m2': [{ json: momentOutput({ conditionalRules: [{ actId: 'a2-refuse', outcomeId: 'o2-defer', when: [atom('outcome', { momentId: 'm1', outcomeId: 'o1-hold' })] }] }, 'm2') }],
  'ending e-historical': [{ json: endingOutput() }],
  'ending e-alt1': [{ json: endingOutput() }],
  'ending e-alt2': [{ json: endingOutput() }],
})

const input = { draft, documents: [] }
const inputWithSource = {
  draft,
  documents: [{ id: 'singapore-1819-handout', title: 'Handout', kind: 'text' as const, contentHash: 'h', pageCount: 1, charCount: 1, pages: [{ page: 1, text: 'x' }], warnings: [] }],
}

describe('generateEndings', () => {
  it('merges a clean run: conditional rules before fallbacks, condition shapes, verdict ids', async () => {
    const llm = new RoutingLlm(happyRoutes())
    const result = await generateEndings(input, { llm })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    const spec = result.spec!
    expect(validateSpec(spec).ok).toBe(true)
    expect(checkSpec(spec).errors).toEqual([])

    const m1 = spec.definingMoments[0]!
    expect(m1.nudge).not.toBe('')
    const a1yield = m1.rules.filter((r) => r.actId === 'a1-yield')
    expect(a1yield[0]!.when).toEqual({ all: [{ notePassed: { discoveryId: 'd-extra', characterId: 'raffles' } }, { stanceAtLeast: { characterId: 'raffles', stanceId: 's2' } }, { not: { slantConfronted: 'farquhar-sl1' } }] })
    expect(a1yield[0]!.outcomeId).toBe('o1-hold')
    expect(a1yield.slice(1).every((r) => r.when === undefined)).toBe(true) // fallbacks unchanged, after conditionals

    const m2 = spec.definingMoments[1]!
    expect(m2.rules[0]!.when).toEqual({ outcome: { momentId: 'm1', outcomeId: 'o1-hold' } })

    expect(spec.endings[0]!.interview.verdicts.map((v) => v.id)).toEqual(['e-historical-v1', 'e-historical-v2', 'e-historical-v3'])
    expect(JSON.stringify(spec)).not.toContain('-pending-v')
    expect(result.pendingPasses).toEqual(['reveal'])
  })

  it('a rule targeting another moment’s outcome repairs only that moment call', async () => {
    const bad = momentOutput({ conditionalRules: [{ actId: 'a2-refuse', outcomeId: 'o1-hold', when: [atom('discovered', { discoveryId: 'd-core2' })] }] }, 'm2')
    const good = momentOutput({}, 'm2')
    const llm = new RoutingLlm({ ...happyRoutes(), 'moment m2': [{ json: bad }, { json: good }] })
    const result = await generateEndings(input, { llm })
    expect(result.ok).toBe(true)
    const m2calls = llm.requests.filter((r) => r.key === 'moment m2')
    expect(m2calls).toHaveLength(2)
    expect(m2calls[1]!.request.user).toContain('is not an outcome of this moment')
    expect(llm.requests.filter((r) => r.key === 'moment m1')).toHaveLength(1)
  })

  it('rejects a discovered atom in a conditional rule', async () => {
    const bad = momentOutput({ conditionalRules: [{ actId: 'a1-yield', outcomeId: 'o1-hold', when: [atom('discovered', { discoveryId: 'd-core1' })] }] })
    const llm = new RoutingLlm({ ...happyRoutes(), 'moment m1': [{ json: bad }, { json: momentOutput() }] })
    const result = await generateEndings(input, { llm })
    expect(result.ok).toBe(true)
    const calls = llm.requests.filter((r) => r.key === 'moment m1')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.request.user).toContain('rule-discovered')
  })

  it('rejects a rule condition on a later-stage discovery', async () => {
    const bad = momentOutput({ conditionalRules: [{ actId: 'a1-yield', outcomeId: 'o1-hold', when: [atom('notePassed', { discoveryId: 'd-core2', characterId: 'raffles' })] }] }) // d-core2 is stage s2
    const llm = new RoutingLlm({ ...happyRoutes(), 'moment m1': [{ json: bad }, { json: momentOutput() }] })
    const result = await generateEndings(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests.filter((r) => r.key === 'moment m1')).toHaveLength(2)
    expect(llm.requests.filter((r) => r.key === 'moment m1')[1]!.request.user).toContain('not reachable')
  })

  it('historical-diverted is an error with a positive atom, a warning when all negated', async () => {
    // a1-hold's fallback is the historical outcome o1-hold
    const positive = momentOutput({ conditionalRules: [{ actId: 'a1-hold', outcomeId: 'o1-yield', when: [atom('notePassed', { discoveryId: 'd-extra', characterId: 'farquhar' })] }] })
    const llm = new RoutingLlm({ ...happyRoutes(), 'moment m1': [{ json: positive }, { json: momentOutput() }] })
    const result = await generateEndings(input, { llm })
    expect(result.ok).toBe(true)
    const calls = llm.requests.filter((r) => r.key === 'moment m1')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.request.user).toContain('historical-diverted')

    const negated = momentOutput({ conditionalRules: [{ actId: 'a1-hold', outcomeId: 'o1-yield', when: [atom('stanceAtLeast', { characterId: 'farquhar', stanceId: 's2', negate: true })] }] })
    const llm2 = new RoutingLlm({ ...happyRoutes(), 'moment m1': [{ json: negated }] })
    const result2 = await generateEndings(input, { llm: llm2 })
    expect(result2.ok).toBe(true)
    expect(result2.issues).toEqual([])
    expect(result2.warnings.some((w) => w.code === 'historical-diverted')).toBe(true)
    expect(llm2.requests.filter((r) => r.key === 'moment m1')).toHaveLength(1)
  })

  it('rejects source ids and page references in student-facing text', async () => {
    const bad = momentOutput()
    bad.outcomes[0]!.because = 'Because it says so (singapore-1819-handout, p. 2).'
    const llm = new RoutingLlm({ ...happyRoutes(), 'moment m1': [{ json: bad }, { json: momentOutput() }] })
    const result = await generateEndings(inputWithSource, { llm })
    expect(result.ok).toBe(true)
    const calls = llm.requests.filter((r) => r.key === 'moment m1')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.request.user).toContain('citation-in-text')
  })

  it('rejects document-id counterPoints and verdicts with no core counterPoint', async () => {
    const bad = endingOutput({
      verdicts: [
        { text: 'One.', counterPoints: ['doc-1'] },
        { text: 'Two.', counterPoints: ['d-extra'] },
        { text: 'Three.', counterPoints: ['d-core2'] },
      ],
    })
    const llm = new RoutingLlm({ ...happyRoutes(), 'ending e-alt1': [{ json: bad }, { json: endingOutput() }] })
    const result = await generateEndings(input, { llm })
    expect(result.ok).toBe(true)
    const calls = llm.requests.filter((r) => r.key === 'ending e-alt1')
    expect(calls).toHaveLength(2)
    expect(calls[1]!.request.user).toContain('counter-core')
    expect(calls[1]!.request.user).toContain('document id')
  })

  describe('secret unlock (secret fixture)', () => {
    const secretDraft: AdventureSpec = JSON.parse(JSON.stringify(draft))
    secretDraft.characters[0]!.stances.push({ id: 's4', label: 'Confiding', demeanour: 'd', hidden: true })
    secretDraft.discoveries.push({
      id: 'd-doc-held',
      stageId: 's2',
      holder: { documentId: 'doc-2', keyPassageId: 'kp-2' },
      text: 'Doc note.',
      note: 'n',
      core: false,
      sourceLabel: 'invented',
    })
    secretDraft.definingMoments[1]!.acts.push({ id: 'a2-secret', text: 'Slip the paper across', reaction: '' })
    secretDraft.definingMoments[1]!.outcomes.push({ id: 'o2-secret', summary: 'A quiet side deal.', predictionText: '', because: '', endingId: 'e-secret', secret: true, closesEndingIds: [] })
    secretDraft.definingMoments[1]!.rules.push({ actId: 'a2-secret', outcomeId: 'o2-secret' })
    secretDraft.endings.push({ id: 'e-secret', type: 'secret', title: 'The Side Deal', summary: 'A private bargain.', epilogue: '', interview: { interviewer: '', question: '', verdicts: [1, 2, 3].map((n) => ({ id: `e-secret-pending-v${n}`, text: '', counterPoints: [] })), generalCounter: '' }, sourceLabel: 'invented' })
    const secretInput = { draft: secretDraft, documents: [] }
    const validUnlock = { actId: 'a2-secret', conditions: [atom('stanceAtLeast', { characterId: 'farquhar', stanceId: 's4' }), atom('discovered', { discoveryId: 'd-guarded' })], minMet: 2 }
    const secretMoment = (unlock: MomentLlmOutput['secretUnlock']) =>
      momentOutput({}, 'm2') && {
        ...momentOutput({}, 'm2'),
        acts: [...momentOutput({}, 'm2').acts, { id: 'a2-secret', reaction: 'A sharp intake of breath.', deception: true }],
        outcomes: [...momentOutput({}, 'm2').outcomes, { id: 'o2-secret', predictionText: 'A hidden bargain.', because: 'Trust opened the door.' }],
        secretUnlock: unlock,
      }
    const secretRoutes = (m2: MomentLlmOutput) => ({
      'moment m1': [{ json: momentOutput() }],
      'moment m2': [{ json: m2 }],
      'ending e-historical': [{ json: endingOutput() }],
      'ending e-alt1': [{ json: endingOutput() }],
      'ending e-alt2': [{ json: endingOutput() }],
      'ending e-secret': [{ json: endingOutput() }],
    })

    it('a missing secretUnlock is an issue', async () => {
      const bad = secretMoment(null)
      const good = secretMoment(validUnlock)
      const llm = new RoutingLlm({ ...secretRoutes(good), 'moment m2': [{ json: bad }, { json: good }] })
      const result = await generateEndings(secretInput, { llm })
      expect(result.ok).toBe(true)
      const calls = llm.requests.filter((r) => r.key === 'moment m2')
      expect(calls).toHaveLength(2)
      expect(calls[1]!.request.user).toContain('secret-unlock')
    })

    it('a secretUnlock on a non-secret moment is an issue', async () => {
      const badM1 = { ...momentOutput(), secretUnlock: { actId: 'a1-hold', conditions: [atom('notePassed', { discoveryId: 'd-extra', characterId: 'raffles' }), atom('discovered', { discoveryId: 'd-core1' })], minMet: 2 } }
      const llm = new RoutingLlm({ ...secretRoutes(secretMoment(validUnlock)), 'moment m1': [{ json: badM1 }, { json: momentOutput() }] })
      const result = await generateEndings(secretInput, { llm })
      expect(result.ok).toBe(true)
      const calls = llm.requests.filter((r) => r.key === 'moment m1')
      expect(calls).toHaveLength(2)
      expect(calls[1]!.request.user).toContain('must be null')
    })

    it('a valid unlock merges with minMet onto the secret act', async () => {
      const llm = new RoutingLlm(secretRoutes(secretMoment(validUnlock)))
      const result = await generateEndings(secretInput, { llm })
      expect(result.issues).toEqual([])
      expect(result.ok).toBe(true)
      const act = result.spec!.definingMoments[1]!.acts.find((a) => a.id === 'a2-secret')!
      expect(act.secret).toEqual({
        unlock: [{ stanceAtLeast: { characterId: 'farquhar', stanceId: 's4' } }, { discovered: 'd-guarded' }],
        minMet: 2,
      })
    })
  })

  it('a post-merge checkSpec issue is routed to the owning call', async () => {
    injected.issues.push({ code: 'test-inject', path: 'endings.1.title', message: 'injected failure' })
    try {
      const llm = new RoutingLlm({ ...happyRoutes(), 'ending e-alt1': [{ json: endingOutput() }, { json: endingOutput() }] })
      const result = await generateEndings(input, { llm })
      // the injected error persists → not ok, but only e-alt1 was re-run
      expect(result.ok).toBe(false)
      expect(llm.requests.filter((r) => r.key === 'ending e-alt1')).toHaveLength(2)
      expect(llm.requests.filter((r) => r.key === 'ending e-alt2')).toHaveLength(1)
      expect(llm.requests.filter((r) => r.key === 'moment m1')).toHaveLength(1)
    } finally {
      injected.issues.length = 0
    }
  })
})
