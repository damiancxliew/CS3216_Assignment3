import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AdventureSpec } from '@adventure/spec-v3'
import { applyV3Edits } from '@/lib/v3/edit/commands'
import { applyTeacherEdits } from '@/lib/v3/edit/apply'
import { referenceContext, references, template } from '@/lib/v3/edit/form'
import { newLocalErrors } from '@/lib/v3/edit/local-checks'
import { checkTeacherEdits } from '@/lib/v3/edit/validation'

function fixture() {
  const spec = AdventureSpec.parse(JSON.parse(readFileSync('fixtures/golden-1819.json', 'utf8')))
  const document = spec.documents[0]
  document.real = false
  document.sourceLabel = 'invented'
  document.citations = []
  const question = (id: string) => ({ id, prompt: `What does this article establish (${id})?`, options: [{ id: 'yes', text: 'The Company may establish a factory.' }, { id: 'no', text: 'The Company must leave immediately.' }, { id: 'wait', text: 'Permission is postponed.' }], correctOptionId: 'yes', support: [{ start: document.body.indexOf('The Datoo Tumungong permits'), end: document.body.indexOf('The Datoo Tumungong permits') + 'The Datoo Tumungong permits the Honourable Company to establish a Factory at Singapoora.'.length }], explanation: 'The article grants permission to establish a factory.' })
  document.readingCheck = { discoveryId: 'd1-agreement', variants: ['v1', 'v2', 'v3', 'v4'].map(question), recovery: question('correction'), recoveryDiscoveryIds: [] }
  return spec
}

describe('teacher editing of reading checks', () => {
  it('offers only the active question’s interpretations as answer references', () => {
    const spec = fixture()
    const path = ['documents', 0, 'readingCheck', 'variants', 2, 'correctOptionId']
    const context = referenceContext(spec, path)
    expect(context).toMatchObject({ documentId: spec.documents[0].id, questionId: 'v3' })
    expect(references(spec, 'correctOptionId', context)).toEqual(spec.documents[0].readingCheck!.variants[2].options.map((option) => ({ value: option.id, label: option.text })))
    expect(references(spec, 'recoveryDiscoveryIds')).toHaveLength(spec.discoveries.length)
  })

  it('can add a new optional bank without changing existing entity identities', () => {
    const spec = fixture(), bank = spec.documents[0].readingCheck
    delete spec.documents[0].readingCheck
    const edited = applyV3Edits(spec, [{ type: 'set', path: ['documents', 0, 'readingCheck'], value: bank }], [])
    expect(edited.documents[0].readingCheck).toEqual(bank)
  })

  it('allows source drafting but rejects saving an unchanged question bank against changed text', () => {
    const spec = fixture()
    const edits = [{ type: 'set' as const, path: ['documents', 0, 'body'], value: spec.documents[0].body + '\n\nA further article follows.' }]
    const draft = applyV3Edits(spec, edits, [], true)
    expect(newLocalErrors(spec, draft)).toContainEqual(expect.objectContaining({ code: 'reading-check', path: 'documents.0.readingCheck' }))
    expect(() => applyV3Edits(spec, edits, [])).toThrow(/Review its reading questions/)
    expect(checkTeacherEdits(spec, edits, [])).toMatchObject({ ok: false })
  })

  it('records reviewed question prose as a teacher contribution', () => {
    const spec = fixture()
    const edited = applyTeacherEdits(spec, [{ type: 'set', path: ['documents', 0, 'readingCheck', 'variants', 0, 'prompt'], value: 'What permission does the article grant?' }], [])
    expect(edited.authoring!.teacherContributions).toContainEqual({ entity: `${spec.documents[0].id}/v1`, field: 'prompt' })
    expect(edited.documents[0].readingCheck!.variants[0].support).toEqual(spec.documents[0].readingCheck!.variants[0].support)
  })

  it('creates the four question slots and a correction in a newly added bank', () => {
    const schema = AdventureSpec.shape.documents.element.shape.readingCheck.unwrap()
    const bank = template(schema) as NonNullable<AdventureSpec['documents'][number]['readingCheck']>
    expect(bank.variants).toHaveLength(4)
    expect(bank.variants.every((question) => question.options.length === 3)).toBe(true)
    expect(bank.recovery.options).toHaveLength(3)
  })
})
