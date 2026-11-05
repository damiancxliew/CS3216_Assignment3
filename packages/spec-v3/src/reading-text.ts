import type { SpecDocument } from './index.js'

/** A boundary map is needed only while migrating stored offsets; raw sources stay captured separately. */
export function cleanReadingText(original: string): { text: string; offsets: number[] } {
  const offsets: number[] = new Array(original.length + 1)
  let text = '', from = 0
  for (const match of original.matchAll(/\r\n|\r|\n/g)) {
    const at = match.index!
    for (let index = from; index < at; index++) { offsets[index] = text.length; text += original[index] }
    const lineStart = Math.max(original.lastIndexOf('\n', at - 1), original.lastIndexOf('\r', at - 1)) + 1
    const line = original.slice(lineStart, at).trim()
    const nextStart = at + match[0].length
    const next = original.slice(nextStart).match(/^[^\r\n]*/)?.[0] ?? ''
    const heading = line.length <= 80 && /[A-Z]/.test(line) && line === line.toUpperCase()
    const hardBreak = !line || !next.trim() || heading || /^\s*(?:[ivxlcdm]+[.)]|\d+[.)]|[-•])\s+/i.test(next)
    for (let index = at; index < nextStart; index++) offsets[index] = text.length
    text += hardBreak ? '\n' : ' '
    offsets[nextStart] = text.length
    from = nextStart
  }
  for (let index = from; index < original.length; index++) { offsets[index] = text.length; text += original[index] }
  offsets[original.length] = text.length
  return { text, offsets }
}

/** Whitespace-only correction; IDs, quotations, provenance and all source wording stay intact. */
export function cleanReadingDocument<T extends SpecDocument>(document: T): T {
  const { text, offsets } = cleanReadingText(document.body)
  const span = <S extends { start: number; end: number }>(value: S): S => {
    if (!Number.isInteger(value.start) || !Number.isInteger(value.end) || value.start < 0 || value.end > document.body.length || value.end <= value.start)
      throw Error('Cannot clean reading text with invalid source offsets.')
    return { ...value, start: offsets[value.start]!, end: offsets[value.end]! }
  }
  const result = structuredClone(document)
  result.body = text
  result.keyPassages = result.keyPassages.map(span)
  if (result.readingCheck) {
    for (const question of [...result.readingCheck.variants, result.readingCheck.recovery]) question.support = question.support.map(span)
  }
  return result
}
