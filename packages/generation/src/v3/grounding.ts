/**
 * Grounding check: every citation `quote` (and persona phrase text) must literally occur in the
 * cited source's text. Normalisation: NFKC, curly quotes → straight, en/em dashes → '-',
 * whitespace collapsed, lowercased. A quote containing '…' or '...' passes if each non-empty
 * piece occurs, in order. Unknown sourceId → `ref`.
 */
import type { CheckIssue } from '@adventure/spec-v3'

import type { ExtractedDocument } from '../ingest/types'

export function normaliseText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** documentId → full source text (all pages joined with '\n'). */
export function sourceTexts(documents: ExtractedDocument[]): Map<string, string> {
  return new Map(documents.map((doc) => [doc.id, doc.pages.map((p) => p.text).join('\n')]))
}

export function quoteInSource(quote: string, source: string): boolean {
  const haystack = normaliseText(source)
  const needle = normaliseText(quote)
  const pieces = needle.split(/…|\.\.\./).map((p) => p.trim()).filter((p) => p.length > 0)
  let from = 0
  for (const piece of pieces) {
    const at = haystack.indexOf(piece, from)
    if (at < 0) return false
    from = at + piece.length
  }
  return pieces.length > 0
}

/** One item per citation quote; the caller decides which paths to report at. */
export function quoteIssues(items: { path: string; sourceId: string; quote: string }[], sources: Map<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = []
  for (const item of items) {
    const source = sources.get(item.sourceId)
    if (source === undefined) {
      issues.push({ code: 'ref', path: item.path, message: `source '${item.sourceId}' does not exist` })
    } else if (!quoteInSource(item.quote, source)) {
      issues.push({ code: 'quote-not-in-source', path: item.path, message: `quote does not occur in source '${item.sourceId}'` })
    }
  }
  return issues
}

/** Collect every citation quote of a value shaped like { citations?: [{ sourceId, quote? }] }. */
export function citationQuotes(
  items: { path: string; citations?: { sourceId: string; quote?: string }[] | undefined }[],
): { path: string; sourceId: string; quote: string }[] {
  const out: { path: string; sourceId: string; quote: string }[] = []
  for (const item of items)
    for (const citation of item.citations ?? [])
      if (citation.quote !== undefined) out.push({ path: item.path, sourceId: citation.sourceId, quote: citation.quote })
  return out
}
