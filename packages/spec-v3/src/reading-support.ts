export type SourceSpan = { start: number; end: number }

/** Offsets stay in the original text, including punctuation and paragraph breaks. */
export function sourceSentenceSpans(body: string): SourceSpan[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const result: SourceSpan[] = []
  for (const paragraph of body.matchAll(/[^\r\n]+/g)) {
    const pieces: SourceSpan[] = []
    for (const part of segmenter.segment(paragraph[0])) {
      const text = part.segment, leading = text.length - text.trimStart().length
      const start = paragraph.index! + part.index + leading, end = paragraph.index! + part.index + text.trimEnd().length
      if (end <= start) continue
      const previous = pieces.at(-1)
      // ICU separates common titles from names; keep them with the following sentence.
      if (previous && /\b(?:Mr|Mrs|Ms|Dr|Prof|Capt|Lt|St|Gen|Col)\.$/.test(body.slice(previous.start, previous.end))) previous.end = end
      else pieces.push({ start, end })
    }
    result.push(...pieces)
  }
  return result
}

const length = (text: string) => text.replace(/\s/g, '').length

/** Grade raw offsets. Expanding a visual highlight must never increase its coverage. */
export function supportsReadingSelection(body: string, alternatives: readonly SourceSpan[], start: number, end: number): boolean {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > body.length) return false
  if (length(body.slice(start, end)) === length(body)) return false
  const sentences = sourceSentenceSpans(body)
  return alternatives.some(span => {
    if (span.start < 0 || span.end <= span.start || span.end > body.length) return false
    const support = sentences.flatMap((s, i) => s.start < span.end && s.end > span.start ? [i] : [])
    if (!support.length) return false
    if (!support.every(i => {
      const s = sentences[i]!
      return length(body.slice(Math.max(start, s.start), Math.min(end, s.end))) >= 0.8 * length(body.slice(s.start, s.end)) && end > s.start && start < s.end
    })) return false
    const selected = sentences.flatMap((s, i) => s.start < end && s.end > start ? [i] : [])
    const extra = selected.filter(i => !support.includes(i))
    if (extra.length > 1 || extra.some(i => i !== support[0]! - 1 && i !== support.at(-1)! + 1)) return false
    if (extra.some(i => {
      const a = sentences[Math.min(i, support[0]!)]!, b = sentences[Math.max(i, support.at(-1)!)]!
      return /\n\s*\n/.test(body.slice(a.end, b.start))
    })) return false
    return true
  })
}
