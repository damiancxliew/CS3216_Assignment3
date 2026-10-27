import { describe, expect, it } from 'vitest'
import { cleanReadingText, cleanReadingDocument } from '../src/reading-text'
import { Document } from '../src/index'
import { sampleSpec } from './sample'

describe('stored reading text', () => {
  it('joins soft wraps while preserving headers, paragraphs, lists and original punctuation', () => {
    const original = 'PRESS RELEASE\r\n13 DECEMBER 2007\r\n\r\ni. A letter\r\ndescribes his hopes. The second\r\nsentence continues.\r\nii. A card\r\nrecords saving.'
    const cleaned = cleanReadingText(original)
    expect(cleaned.text).toBe('PRESS RELEASE\n13 DECEMBER 2007\n\ni. A letter describes his hopes. The second sentence continues.\nii. A card records saving.')
    for (const phrase of ['describes his hopes.', 'sentence continues.', 'records saving.']) {
      const start = original.indexOf(phrase), end = start + phrase.length
      expect(cleaned.text.slice(cleaned.offsets[start], cleaned.offsets[end])).toBe(phrase)
    }
    expect(cleanReadingText(cleaned.text).text).toBe(cleaned.text)
    expect(cleaned.offsets).toHaveLength(original.length + 1)
  })
  it('remaps existing evidence and every normal/correction support without altering citations or input', () => {
    const document = Document.parse(structuredClone(sampleSpec.documents[0]!))
    document.body = 'An opening line. A letter\r\ndescribes his hopes.\n\nOther evidence remains.'
    const start = document.body.indexOf('A letter'), end = document.body.indexOf('\n\n')
    document.keyPassages = [{ id: 'passage', start, end }]
    const q = (id: string) => ({ id, prompt: 'Which claim?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], correctOptionId: 'a', explanation: 'Because.', support: [{ start, end }] })
    document.readingCheck = { discoveryId: 'd', variants: [q('1'), q('2'), q('3'), q('4')], recovery: q('r'), recoveryDiscoveryIds: [] }
    const before = structuredClone(document)
    const cleaned = cleanReadingDocument(document)
    expect(document).toEqual(before)
    expect(cleaned.citations).toEqual(document.citations)
    expect(cleaned.keyPassages[0]!.id).toBe('passage')
    for (const span of [cleaned.keyPassages[0]!, ...cleaned.readingCheck!.variants.flatMap(q => q.support), ...cleaned.readingCheck!.recovery.support])
      expect(cleaned.body.slice(span.start, span.end)).toBe('A letter describes his hopes.')
    expect(cleanReadingDocument(cleaned)).toEqual(cleaned)
  })
  it('refuses to conceal invalid original offsets', () => {
    const document = Document.parse(structuredClone(sampleSpec.documents[0]!))
    document.keyPassages[0]!.end = document.body.length + 1
    expect(() => cleanReadingDocument(document)).toThrow(/offset/)
  })
})
