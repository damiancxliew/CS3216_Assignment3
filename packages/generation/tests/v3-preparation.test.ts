import { describe, expect, it } from 'vitest'
import { GeneratedStageDetailsLlmOutput, GeneratedLinkLlmOutput, StageDetailsLlmOutput, LinkLlmOutput, toDocument } from '../src/v3/details/schema'
import { readingCheckIssues } from '../src/v3/details/checks'

const body = 'The stores are nearly empty. The convoy cannot leave before supplies arrive. Families still wait by the dock.\n\nThe register lists the ships in port.'
const question = (id: string) => ({ id, prompt: 'What limits the convoy’s departure?', options: [{ id: 'a', text: 'It needs more supplies.' }, { id: 'b', text: 'All ships have already left.' }, { id: 'c', text: 'Families have forbidden travel.' }], correctOptionId: 'a', support: ['The convoy cannot leave before supplies arrive.'], explanation: 'The departure depends on supplies arriving.' })
const document = () => ({ id: 's1-letter', kind: 'letter' as const, title: 'Harbour letter', real: false, provenance: { masthead: null, date: null, sender: null, recipient: null, place: null }, body, sourceLabel: 'invented', glossary: [], keyPassages: [{ id: 's1-kp', text: 'The convoy cannot leave before supplies arrive.' }], citations: null, slanted: false, slantNote: null, readingCheck: { discoveryId: 's1-supplies', variants: [question('q1'), question('q2'), question('q3'), question('q4')], recovery: question('recovery'), recoveryDiscoveryIds: [] } })

describe('generated reading preparation', () => {
  it('converts copied supporting text into offsets in the pinned document', () => {
    const converted = toDocument(document())
    const support = converted.readingCheck!.variants[0]!.support[0]!
    expect(converted.body.slice(support.start, support.end)).toBe(document().readingCheck.variants[0]!.support[0])
    expect(converted.readingCheck!.recovery.support).toEqual([support])
  })

  it('keeps legacy saved wire shapes readable while requiring checks and preparation for new calls', () => {
    const legacyStage = { openingNarration: 'Investigate the port.', documents: [{ ...document(), readingCheck: undefined }], coreLinks: [], discoveries: [], documentPlacement: [], situations: [], storyEvents: [], openQuestions: [], hintAngles: [] }
    expect(StageDetailsLlmOutput.safeParse(legacyStage).success).toBe(true)
    expect(GeneratedStageDetailsLlmOutput.safeParse(legacyStage).success).toBe(false)
    const legacyLink = { slantLinks: [], noteTriggers: [], duplicates: [] }
    expect(LinkLlmOutput.safeParse(legacyLink).success).toBe(true)
    expect(GeneratedLinkLlmOutput.safeParse(legacyLink).success).toBe(false)
  })

  it('rejects unsupported quotes, missing choices and whole-document support', () => {
    const doc = document()
    doc.readingCheck.variants[0]!.support = ['No departure is allowed.']
    doc.readingCheck.variants[1]!.correctOptionId = 'missing'
    doc.readingCheck.variants[2]!.support = [body]
    const issues = readingCheckIssues(doc, 'documents.0')
    expect(issues.map((i) => i.code)).toContain('reading-support')
    expect(issues.map((i) => i.code)).toContain('reading-option')
    expect(issues.map((i) => i.code)).toContain('reading-discriminating')
  })
})
