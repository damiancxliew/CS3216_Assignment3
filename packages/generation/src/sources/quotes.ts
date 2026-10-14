import type { ExtractedDocument } from '../ingest/types'

export function normaliseForQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—‑−]/g, '-')
    .replace(/…/g, '...')
    .replace(/-\s*\n\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function findQuote(quote: string, sourceText: string): { found: boolean; index: number } {
  const normalisedQuote = normaliseForQuote(quote)
  const normalisedSource = normaliseForQuote(sourceText)
  if (!normalisedQuote || !normalisedSource) return { found: false, index: -1 }

  const segments = normalisedQuote.split(/\[\s*\.{3}\s*\]|\.{3}/g).map((segment) => segment.trim()).filter(Boolean)
  if (segments.length === 0) return { found: false, index: -1 }

  let cursor = 0
  let firstIndex = -1
  for (const segment of segments) {
    const index = normalisedSource.indexOf(segment, cursor)
    if (index < 0) return { found: false, index: -1 }
    if (firstIndex < 0) firstIndex = index
    cursor = index + segment.length
  }
  return { found: true, index: firstIndex }
}

export interface QuoteIssue {
  path: string
  sourceId: string | null
  message: string
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function childPath(path: string, key: string): string {
  return `${path}.${key}`
}

function hasSource(sourceTexts: Record<string, string>, sourceId: string): boolean {
  return Object.prototype.hasOwnProperty.call(sourceTexts, sourceId)
}

export function checkQuotes(spec: unknown, sourceTexts: Record<string, string>): QuoteIssue[] {
  const issues: QuoteIssue[] = []

  const checkCitations = (citations: unknown[], path: string): void => {
    citations.forEach((citation, index) => {
      const citationPath = `${path}[${index}]`
      if (!isObject(citation) || typeof citation.sourceId !== 'string' || !hasSource(sourceTexts, citation.sourceId)) {
        issues.push({
          path: citationPath,
          sourceId: isObject(citation) && typeof citation.sourceId === 'string' ? citation.sourceId : null,
          message: 'citation references an unknown source',
        })
        return
      }
      if (typeof citation.quote === 'string' && !findQuote(citation.quote, sourceTexts[citation.sourceId] ?? '').found) {
        issues.push({
          path: citationPath,
          sourceId: citation.sourceId,
          message: 'quote not found in cited source',
        })
      }
    })
  }

  const checkDocument = (document: unknown, path: string): void => {
    if (!isObject(document) || document.real !== true) return
    const citations = Array.isArray(document.citations) ? document.citations : []
    if (citations.length === 0) {
      issues.push({ path: childPath(path, 'citations'), sourceId: null, message: 'real document has no citation' })
      return
    }
    if (typeof document.body !== 'string' || !normaliseForQuote(document.body)) {
      issues.push({ path: childPath(path, 'body'), sourceId: null, message: 'real document body is empty or not text' })
      return
    }

    const body = normaliseForQuote(document.body)
    const matchesCitation = citations.some((citation) => {
      if (!isObject(citation) || typeof citation.sourceId !== 'string' || !hasSource(sourceTexts, citation.sourceId)) {
        return false
      }
      return normaliseForQuote(sourceTexts[citation.sourceId] ?? '').includes(body)
    })
    if (!matchesCitation) {
      issues.push({ path: childPath(path, 'body'), sourceId: null, message: 'real document body not found in a cited source' })
    }
  }

  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    if (!isObject(value)) return

    if (Array.isArray(value.citations)) checkCitations(value.citations, childPath(path, 'citations'))
    for (const [key, child] of Object.entries(value)) {
      const pathToChild = childPath(path, key)
      if (key === 'documents' && Array.isArray(child)) {
        child.forEach((document, index) => checkDocument(document, `${pathToChild}[${index}]`))
      }
      visit(child, pathToChild)
    }
  }

  visit(spec, '$')
  return issues
}

export function documentText(document: ExtractedDocument): string {
  return document.pages.map((page) => page.text).join('\n')
}
