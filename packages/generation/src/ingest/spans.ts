/**
 * Source-span resolution (D2 proof, FR-3). A span is *grounded* when its quote
 * occurs on the cited page of the cited document. Matching is whitespace- and
 * punctuation-tolerant because PDF extraction mangles both, but it is still a
 * substring match: paraphrases do not count.
 */
import type { AdventureSpec, SourceSpan } from '../spec/v2'
import type { ExtractedDocument } from './types'

export function normaliseForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\u00AD/g, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export type SpanResolution =
  | { ok: true; span: SourceSpan; offset: number }
  | { ok: false; span: SourceSpan; reason: 'unknown-source' | 'page-out-of-range' | 'quote-not-on-page'; nearestPage: number | null }

export function resolveSpan(span: SourceSpan, documents: ReadonlyMap<string, ExtractedDocument>): SpanResolution {
  const doc = documents.get(span.sourceId)
  if (!doc) return { ok: false, span, reason: 'unknown-source', nearestPage: null }
  const page = doc.pages[span.page - 1]
  if (!page) return { ok: false, span, reason: 'page-out-of-range', nearestPage: null }
  const needle = normaliseForMatch(span.quote)
  const offset = normaliseForMatch(page.text).indexOf(needle)
  if (offset >= 0) return { ok: true, span, offset }
  const nearest = doc.pages.find((p) => normaliseForMatch(p.text).includes(needle))
  return { ok: false, span, reason: 'quote-not-on-page', nearestPage: nearest?.page ?? null }
}

export interface LocatedSpan {
  path: string
  span: SourceSpan
}

/** Every span in a spec, with the JSON path it sits at. */
export function collectSpans(spec: AdventureSpec): LocatedSpan[] {
  const out: LocatedSpan[] = []
  const add = (path: string, spans: SourceSpan[]) => spans.forEach((span, i) => out.push({ path: `${path}.spans.${i}`, span }))
  add('$.sharedContext', spec.sharedContext.spans)
  spec.stakeholders.forEach((s, i) => add(`$.stakeholders.${i}.summary`, s.summary.spans))
  spec.endings.forEach((e, i) => add(`$.endings.${i}.historicalOutcome`, e.historicalOutcome.spans))
  spec.stages.forEach((stage, si) => {
    add(`$.stages.${si}.sharedContext`, stage.sharedContext.spans)
    stage.agents.forEach((a, i) => {
      add(`$.stages.${si}.agents.${i}.publicPosition`, a.publicPosition.spans)
      add(`$.stages.${si}.agents.${i}.privateContext`, a.privateContext.spans)
    })
    stage.evidence.forEach((e, i) => add(`$.stages.${si}.evidence.${i}.content`, e.content.spans))
  })
  return out
}

export interface GroundingReport {
  total: number
  resolved: number
  failures: Array<LocatedSpan & { resolution: Extract<SpanResolution, { ok: false }> }>
}

/** Resolve every span in a spec against the extracted documents. */
export function verifyGrounding(spec: AdventureSpec, documents: ReadonlyMap<string, ExtractedDocument>): GroundingReport {
  const located = collectSpans(spec)
  const failures: GroundingReport['failures'] = []
  for (const item of located) {
    const resolution = resolveSpan(item.span, documents)
    if (!resolution.ok) failures.push({ ...item, resolution })
  }
  return { total: located.length, resolved: located.length - failures.length, failures }
}
