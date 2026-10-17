/**
 * Reveal-pass tests: a single 'reveal_v3' call. The draft fixture is a complete spec
 * (endings fields filled), like the endings pass produces. The secret fixture adds a
 * secret ending/act that must never reach the model.
 */
import { describe, expect, it } from 'vitest'
import type { AdventureSpec } from '@adventure/spec-v3'
import { checkSpec, validateSpec } from '@adventure/spec-v3'

import type { FakeReply, LlmJsonRequest, LlmJsonResponse, LlmUsage } from '../src/llm/client'
import { tryParseJson } from '../src/llm/client'
import type { LlmClient } from '../src/llm/client'
import type { ExtractedDocument } from '../src/ingest/types'
import { generateReveal, mergeReveal } from '../src/v3/index'
import type { RevealLlmOutput } from '../src/v3/index'

// --- fixture: a complete spec (as the endings pass leaves it) ------------------------------------

const persona = { voice: 'v', phrases: [], knewThen: 'k', wantsFromStudent: 'w', withholds: ['x'], publicPosition: 'p', privateAgenda: 'a' }
const stances = [
  { id: 's1', label: 'Guarded', demeanour: 'd' },
  { id: 's2', label: 'Open', demeanour: 'd' },
  { id: 's3', label: 'Candid', demeanour: 'd' },
]
const interview = (id: string) => ({
  interviewer: 'A journalist, 1966',
  question: 'Could it have gone another way?',
  verdicts: [1, 2, 3].map((n) => ({ id: `${id}-v${n}`, text: `Verdict ${n} on ${id}.`, counterPoints: ['d-core1'] })),
  generalCounter: 'Historians still argue.',
})
const ending = (id: string, type: 'historical' | 'alternative' | 'secret', title: string) => ({
  id,
  type,
  title,
  summary: `Summary of ${id}.`,
  epilogue: `Your simulation: it ended as ${title}.`,
  interview: interview(id),
  sourceLabel: 'invented',
  ...(type === 'historical' ? { citations: [{ sourceId: 'src', quote: 'the settlement grew' }] } : {}),
})

const baseDraft = (): AdventureSpec => ({
  id: 'adv',
  title: 'The Test',
  readingLevel: 'sec',
  timer: { enabled: true, stageMinutes: [15] },
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
  ],
  characters: [
    { id: 'farquhar', name: 'Farquhar', title: 'Resident', real: true, tier: 'major', persona, stances, initialStanceId: 's1', slants: [{ id: 'farquhar-sl1', claim: 'c', contradictedBy: ['d-core1'] }], trustNotice: 'n' },
    { id: 'raffles', name: 'Raffles', title: 'Lieutenant-Governor', real: true, tier: 'major', persona, stances, initialStanceId: 's2', slants: [], trustNotice: 'n' },
  ],
  discoveries: [
    { id: 'd-core1', stageId: 's1', holder: { characterId: 'farquhar' }, text: 'Core one.', note: 'n', core: true, sourceLabel: 'from the teacher', citations: [{ sourceId: 'src', quote: 'the settlement grew' }] },
    { id: 'd-extra', stageId: 's1', holder: { documentId: 'doc-1', keyPassageId: 'kp-1' }, text: 'Extra.', note: 'n', core: false, sourceLabel: 'invented' },
  ],
  documents: [
    { id: 'doc-1', kind: 'report', title: 'R1', provenance: {}, body: 'Body one text.', real: false, sourceLabel: 'invented', glossary: [], keyPassages: [{ id: 'kp-1', start: 0, end: 8 }] },
  ],
  triggers: [],
  definingMoments: [
    {
      id: 'm1',
      stageId: 's1',
      deciderId: 'farquhar',
      scene: 'A schooner is sighted.',
      nudge: 'There is more to find.',
      finalCallNarration: 'Farquhar will not wait.',
      acts: [
        { id: 'a1-hold', text: 'Hold the flag', reaction: 'Farquhar nods.' },
        { id: 'a1-yield', text: 'Yield quietly', reaction: 'Farquhar frowns.', deception: true },
      ],
      outcomes: [
        { id: 'o1-hold', summary: 'The flag stays.', predictionText: 'The flag stays up.', because: 'You held firm.', endingId: 'e-historical', historical: true, closesEndingIds: [] },
        { id: 'o1-yield', summary: 'The flag falls.', predictionText: 'The flag comes down.', because: 'You yielded.', endingId: 'e-alt1', closesEndingIds: [] },
        { id: 'o1-stall', summary: 'Farquhar stalls.', predictionText: 'Farquhar stalls for time.', because: 'You hesitated.', endingId: 'e-alt2', closesEndingIds: [] },
      ],
      rules: [
        { actId: 'a1-hold', outcomeId: 'o1-hold' },
        { actId: 'a1-yield', outcomeId: 'o1-yield' },
        { actId: 'a1-yield', outcomeId: 'o1-stall' },
      ],
    },
  ],
  endings: [ending('e-historical', 'historical', 'The Port Holds'), ending('e-alt1', 'alternative', 'Flag Down'), ending('e-alt2', 'alternative', 'Long Talks')],
  teacherQuestions: [],
  sources: [{ id: 'src', title: 'handout', origin: 'teacher' }],
  conflicts: [],
  storyEvents: [],
  openQuestions: [],
  hintAngles: [],
})

/** adds a secret ending + secret act/outcome, like the secret fixture in the endings tests */
const secretDraft = (): AdventureSpec => {
  const draft = baseDraft()
  draft.definingMoments[0]!.acts.push({ id: 'a1-secret', text: 'Slip the paper across', reaction: 'A pause.' })
  draft.definingMoments[0]!.outcomes.push({ id: 'o1-secret', summary: 'A quiet side deal.', predictionText: 'A hidden bargain.', because: 'Trust opened it.', endingId: 'e-secret', secret: true, closesEndingIds: [] })
  draft.definingMoments[0]!.rules.push({ actId: 'a1-secret', outcomeId: 'o1-secret' })
  draft.endings.push(ending('e-secret', 'secret', 'The Side Deal'))
  return draft
}

// --- sources -------------------------------------------------------------------------------------

const sources: ExtractedDocument[] = [
  {
    id: 'src',
    title: 'Handout',
    kind: 'text',
    contentHash: 'h',
    pageCount: 1,
    charCount: 100,
    pages: [{ page: 1, text: 'In 1819 the settlement grew quickly under free trade. The Dutch protested the treaty.' }],
    warnings: [],
  },
]

const QUOTE = 'the settlement grew quickly under free trade'
const QUOTE2 = 'the dutch protested the treaty'

// --- happy output --------------------------------------------------------------------------------

const revealOutput = (overrides: Partial<RevealLlmOutput> = {}): RevealLlmOutput => ({
  whatHappened: { text: 'The flag stayed and the settlement grew under free trade.', cites: [{ sourceId: 'src', quote: QUOTE }] },
  interpretations: [
    { text: 'Some read it as a triumph of free trade.', cites: [{ sourceId: 'src', quote: QUOTE }] },
    { text: 'Others stress the Dutch objection it provoked.', cites: [{ sourceId: 'src', quote: QUOTE2 }] },
  ],
  interpretationsWarning: null,
  corrections: [
    { documentId: 'doc-1', actId: null, text: 'The letter you read left out the Dutch protest.' },
    { documentId: null, actId: 'a1-yield', text: 'Yielding quietly was not as harmless as it seemed.' },
  ],
  couldHaveGone: [
    { outcomeId: 'o1-yield', text: 'Had the flag fallen, the settlement might never have taken root.' },
    { outcomeId: 'o1-stall', text: 'Stalling could have let the Dutch press their claim first.' },
  ],
  teacherQuestions: ['Why did the treaty survive the Dutch protest?', 'Who gained most from the settlement?'],
  ...overrides,
})

const slantedDocuments = [{ stageId: 's1', documentId: 'doc-1', note: 'The letter omits the Dutch protest.' }]

// --- fake LLM -------------------------------------------------------------------------------------

const usage: LlmUsage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, reasoningTokens: 0 }

class RevealLlm implements LlmClient {
  readonly requests: LlmJsonRequest[] = []
  constructor(private readonly replies: FakeReply[]) {}
  async completeJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
    if (request.schemaName !== 'reveal_v3') throw new Error(`unexpected schema ${request.schemaName}`)
    this.requests.push(request)
    const reply = this.replies.shift()
    if (reply === undefined) throw new Error('RevealLlm: no scripted reply')
    if ('error' in reply) throw new Error(reply.error)
    const base = { usage, model: request.model, latencyMs: 1 }
    if ('refusal' in reply) return { ...base, text: null, json: null, refusal: reply.refusal }
    const text = 'json' in reply ? JSON.stringify(reply.json) : reply.text
    return { ...base, text, json: tryParseJson(text), refusal: null }
  }
}

const input = { draft: baseDraft(), sources, slantedDocuments }

// --- tests -----------------------------------------------------------------------------------------

describe('generateReveal', () => {
  it('happy path: fills reveal + teacherQuestions, spec validates clean', async () => {
    const llm = new RevealLlm([{ json: revealOutput() }])
    const result = await generateReveal(input, { llm })
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    const spec = result.spec!
    expect(validateSpec(spec).ok).toBe(true)
    expect(checkSpec(spec).errors).toEqual([])
    expect(spec.reveal!.whatHappened).toContain('settlement grew')
    expect(spec.reveal!.corrections).toHaveLength(2)
    expect(spec.reveal!.couldHaveGone).toHaveLength(2)
    expect(spec.teacherQuestions).toHaveLength(2)
    expect(result.pendingPasses).toEqual([])
  })

  it('an invented quote triggers a repair', async () => {
    const bad = revealOutput({ whatHappened: { text: 'It grew.', cites: [{ sourceId: 'src', quote: 'words never written anywhere' }] } })
    const llm = new RevealLlm([{ json: bad }, { json: revealOutput() }])
    const result = await generateReveal(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[1]!.user).toContain('quote-not-in-source')
  })

  it('a missing correction for a slanted document triggers a repair', async () => {
    const bad = revealOutput({ corrections: [{ documentId: null, actId: 'a1-yield', text: 'Only the act.' }] })
    const llm = new RevealLlm([{ json: bad }, { json: revealOutput() }])
    const result = await generateReveal(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[1]!.user).toContain('correction-missing')
  })

  describe('secret fixture', () => {
    const secretInput = { draft: secretDraft(), sources, slantedDocuments }

    it('the prompt contains no secret ending title or secret act text', async () => {
      const llm = new RevealLlm([{ json: revealOutput() }])
      const result = await generateReveal(secretInput, { llm })
      expect(result.ok).toBe(true)
      const user = llm.requests[0]!.user
      expect(user).not.toContain('The Side Deal')
      expect(user).not.toContain('Slip the paper across')
      expect(user).not.toContain('o1-secret')
      expect(user).not.toContain('e-secret')
    })

    it('a couldHaveGone naming a secret outcome is rejected', async () => {
      const bad = revealOutput({
        couldHaveGone: [
          { outcomeId: 'o1-yield', text: 'One.' },
          { outcomeId: 'o1-stall', text: 'Two.' },
          { outcomeId: 'o1-secret', text: 'The hidden deal could have held.' },
        ],
      })
      const llm = new RevealLlm([{ json: bad }, { json: revealOutput() }])
      const result = await generateReveal(secretInput, { llm })
      expect(result.ok).toBe(true)
      expect(llm.requests).toHaveLength(2)
      expect(llm.requests[1]!.user).toContain('o1-secret')
    })
  })

  it('the secret-leak backstop matches whole distinctive strings only', async () => {
    const leak = revealOutput({ whatHappened: { text: 'A rival recalled the side deal years later.', cites: [{ sourceId: 'src', quote: QUOTE }] } })
    const llm = new RevealLlm([{ json: leak }, { json: revealOutput() }])
    const result = await generateReveal({ draft: secretDraft(), sources, slantedDocuments }, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests[1]!.user).toContain('secret-leak')

    // a short secret title ("Wait") must not flag ordinary words
    const shortSecret = secretDraft()
    shortSecret.endings.find((e) => e.id === 'e-secret')!.title = 'Wait'
    const ordinary = revealOutput({ whatHappened: { text: 'They had to wait for Calcutta.', cites: [{ sourceId: 'src', quote: QUOTE }] } })
    const llm2 = new RevealLlm([{ json: ordinary }])
    expect((await generateReveal({ draft: shortSecret, sources, slantedDocuments }, { llm: llm2 })).ok).toBe(true)
  })

  it('the teacher-only interpretations warning may name sources and pages', async () => {
    const thin = revealOutput({
      interpretations: [{ text: 'One reading only.', cites: [{ sourceId: 'src', quote: QUOTE }] }],
      interpretationsWarning: { message: 'See src, p. 4 for the only reading.', suggestedSources: ['Dutch account, p. 12'] },
    })
    const llm = new RevealLlm([{ json: thin }])
    const result = await generateReveal(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests).toHaveLength(1)
  })

  it('fails fast, with no model call, when the draft already fails checkSpec', async () => {
    const broken = baseDraft()
    broken.definingMoments[0]!.rules = broken.definingMoments[0]!.rules.map((r) => ({ ...r, outcomeId: 'nope' }))
    const llm = new RevealLlm([])
    const result = await generateReveal({ draft: broken, sources, slantedDocuments }, { llm })
    expect(result.ok).toBe(false)
    expect(llm.requests).toHaveLength(0)
    expect(result.issues.every((i) => i.message.startsWith('draft already fails'))).toBe(true)
  })

  it('fewer than 2 interpretations needs the warning, which is surfaced', async () => {
    const thin = revealOutput({
      interpretations: [{ text: 'One reading only.', cites: [{ sourceId: 'src', quote: QUOTE }] }],
      interpretationsWarning: { message: 'The sources support only one reading.', suggestedSources: ['a Dutch account'] },
    })
    const llm = new RevealLlm([{ json: thin }])
    const result = await generateReveal(input, { llm })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.code === 'interpretations-warning' && w.message.includes('a Dutch account'))).toBe(true)

    const bare = revealOutput({ interpretations: thin.interpretations, interpretationsWarning: null })
    const llm2 = new RevealLlm([{ json: bare }, { json: thin }])
    const result2 = await generateReveal(input, { llm: llm2 })
    expect(result2.ok).toBe(true)
    expect(llm2.requests).toHaveLength(2)
    expect(llm2.requests[1]!.user).toContain('interpretations-few')
  })

  it('a source id in student-facing text is an issue', async () => {
    const bad = revealOutput()
    bad.whatHappened.text = 'It grew (src, p. 2).'
    const llm = new RevealLlm([{ json: bad }, { json: revealOutput() }])
    const result = await generateReveal(input, { llm })
    expect(result.ok).toBe(true)
    expect(llm.requests).toHaveLength(2)
    expect(llm.requests[1]!.user).toContain('citation-in-text')
  })

  it('the merge preserves the draft except the reveal fields', () => {
    const draft = baseDraft()
    const merged = mergeReveal(draft, revealOutput())
    expect(merged.reveal).toEqual({
      whatHappened: 'The flag stayed and the settlement grew under free trade.',
      interpretations: ['Some read it as a triumph of free trade.', 'Others stress the Dutch objection it provoked.'],
      corrections: ['The letter you read left out the Dutch protest.', 'Yielding quietly was not as harmless as it seemed.'],
      couldHaveGone: ['Had the flag fallen, the settlement might never have taken root.', 'Stalling could have let the Dutch press their claim first.'],
    })
    expect(merged.teacherQuestions).toHaveLength(2)
    const { reveal: _r, teacherQuestions: _t, ...rest } = merged
    const { reveal: _r2, teacherQuestions: _t2, ...restDraft } = draft
    expect(rest).toEqual(restDraft)
  })
})
