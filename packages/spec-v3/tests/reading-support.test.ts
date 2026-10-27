import { describe, expect, it } from 'vitest'
import { sourceSentenceSpans, supportsReadingSelection } from '../src/reading-support.js'

const body = 'The harbour was busy. Several merchants opposed the new duties. Their cargo remained at anchor.\n\nThe weather was calm.'
const start = body.indexOf('Several'), end = body.indexOf(' Their')
const support = [{ start, end }]

describe('bounded reading evidence', () => {
  it('keeps sentence offsets into the original document', () => {
    expect(sourceSentenceSpans(body).map(s => body.slice(s.start, s.end))).toEqual([
      'The harbour was busy.', 'Several merchants opposed the new duties.', 'Their cargo remained at anchor.', 'The weather was calm.',
    ])
  })
  it('keeps PDF line wraps inside sentences without moving source offsets', () => {
    const text = 'PRESS RELEASE\n13 DECEMBER 2007\n\ni. A letter describes his hopes for\nhis children. It records his commitment to\nthe war effort.\nii. A savings card recalls school\ncooperation. A separate object remains.'
    expect(sourceSentenceSpans(text).map(span => text.slice(span.start, span.end))).toEqual([
      'PRESS RELEASE\n13 DECEMBER 2007', 'i. A letter describes his hopes for\nhis children.', 'It records his commitment to\nthe war effort.', 'ii. A savings card recalls school\ncooperation.', 'A separate object remains.',
    ])
    const start = text.indexOf('It records'), end = text.indexOf('\nii.')
    expect(supportsReadingSelection(text, [{ start, end }], start, end)).toBe(true)
    expect(supportsReadingSelection(text, [{ start, end }], 0, text.length)).toBe(false)
  })
  it('retains CRLF offsets and does not join across blank paragraphs', () => {
    const text = 'An account describes the\r\nwork. A later account disagrees.\r\n\r\nSeparate evidence remains.'
    expect(sourceSentenceSpans(text).map(span => text.slice(span.start, span.end))).toEqual([
      'An account describes the\r\nwork.', 'A later account disagrees.', 'Separate evidence remains.',
    ])
  })
  it('accepts support and imprecise dragging with one adjacent sentence', () => {
    expect(supportsReadingSelection(body, support, start, end)).toBe(true)
    expect(supportsReadingSelection(body, support, start + 3, end - 2)).toBe(true)
    expect(supportsReadingSelection(body, support, 0, end)).toBe(true)
    expect(supportsReadingSelection(body, support, start, body.indexOf('\n'))).toBe(true)
  })
  it('rejects incidental overlap, unrelated text and an indiscriminate sweep', () => {
    for (const [a, b] of [[start, start + 2], [0, body.length], [0, body.indexOf('\n')], [start, body.length], [-1, end], [end, start]]) {
      expect(supportsReadingSelection(body, support, a!, b!)).toBe(false)
    }
  })
  it('requires enough coverage of every sentence in multi-sentence support', () => {
    const two = [{ start, end: body.indexOf('\n') }]
    expect(supportsReadingSelection(body, two, start, end + 2)).toBe(false)
    expect(supportsReadingSelection(body, two, start, body.indexOf('\n'))).toBe(true)
  })
  it('accepts any authored alternative without exposing others', () => {
    expect(supportsReadingSelection(body, [...support, { start: 0, end: start - 1 }], 0, start - 1)).toBe(true)
    expect(supportsReadingSelection(body, [], start, end)).toBe(false)
  })
  it('does not permit context across a paragraph break or full short documents', () => {
    const short = 'One sentence. A second sentence.'
    expect(supportsReadingSelection(short, [{ start: 0, end: 13 }], 0, short.length)).toBe(false)
    const paragraph = 'First context.\n\nRequired evidence. Last context. Extra detail.'
    expect(supportsReadingSelection(paragraph, [{ start: 16, end: 34 }], 0, 34)).toBe(false)
  })
  it('keeps quotations, abbreviations, and decimal amounts in their source sentences', () => {
    const text = 'Mr. Jones wrote: “The duty was $1.50.” Trade continued.\nA later account disagreed.'
    expect(sourceSentenceSpans(text).map(span => text.slice(span.start, span.end))).toEqual([
      'Mr. Jones wrote: “The duty was $1.50.”', 'Trade continued.', 'A later account disagreed.',
    ])
  })
})
