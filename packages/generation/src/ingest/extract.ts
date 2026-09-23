/**
 * D1 — server-side extraction (FR-1). Turns an uploaded PDF or pasted text into
 * an `ExtractedDocument` whose pages are the unit of citation for every span in
 * the adventure spec. Enforces size limits and hashes the normalised content.
 *
 * Source text is untrusted data. Nothing here interprets it; it is only
 * normalised, paginated and hashed.
 */
import { createHash } from 'node:crypto'

import { extractText, getDocumentProxy } from 'unpdf'

import type { SourceKind } from '../spec/catalogue'
import { ID_PATTERN } from '../spec/v2'
import type { ExtractedDocument, ExtractedPage } from './types'

export const LIMITS = {
  /** Upload size cap for a single PDF. */
  maxUploadBytes: 15 * 1024 * 1024,
  /** Pasted text cap (characters). */
  maxTextChars: 400_000,
  /** Pages per document. */
  maxPages: 300,
  /** Extracted characters per document after normalisation (~150k tokens). */
  maxExtractedChars: 600_000,
  /** Pasted text without page breaks is cut into pseudo-pages of about this many characters. */
  textPageChars: 2_500,
  /** Minimum non-whitespace characters for a PDF to count as having a text layer. */
  minPdfChars: 200,
} as const

export type ExtractionErrorCode =
  | 'empty'
  | 'too-large'
  | 'too-many-pages'
  | 'too-long'
  | 'no-text-layer'
  | 'unreadable-pdf'
  | 'bad-id'

export class ExtractionError extends Error {
  constructor(
    readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ExtractionError'
  }
}

export interface ExtractInput {
  /** Spec-level source id (lowercase slug). */
  id: string
  title: string
  kind: SourceKind
  /** PDF bytes when `kind === 'pdf'`. */
  bytes?: Uint8Array
  /** Per-page text when the client extracted the PDF itself. */
  pages?: readonly string[]
  /** Pasted text when `kind === 'text'`. */
  text?: string
}

export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function contentHash(pages: readonly ExtractedPage[]): string {
  return createHash('sha256')
    .update(pages.map((p) => p.text).join('\f'), 'utf8')
    .digest('hex')
}

/**
 * Pasted text is paginated on form feeds when present. Otherwise it is cut at
 * paragraph boundaries into pseudo-pages so that spans stay small enough to
 * verify and show in the debrief.
 */
export function paginateText(text: string, pageChars: number = LIMITS.textPageChars): { pages: string[]; synthetic: boolean } {
  const normalised = normaliseText(text)
  if (normalised.includes('\f')) {
    return { pages: normalised.split('\f').map((p) => p.trim()).filter((p) => p.length > 0), synthetic: false }
  }
  if (normalised.length <= pageChars) return { pages: [normalised], synthetic: false }

  const pages: string[] = []
  let current = ''
  for (const paragraph of normalised.split(/\n\s*\n/)) {
    if (current.length > 0 && current.length + paragraph.length + 2 > pageChars) {
      pages.push(current)
      current = ''
    }
    // a single paragraph longer than a page is split hard, at whitespace
    if (paragraph.length > pageChars) {
      if (current) pages.push(current)
      current = ''
      const words = paragraph.split(/\s+/)
      let piece = ''
      for (const word of words) {
        if (piece.length + word.length + 1 > pageChars) {
          pages.push(piece)
          piece = ''
        }
        piece = piece ? `${piece} ${word}` : word
      }
      if (piece) current = piece
      continue
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  if (current) pages.push(current)
  return { pages, synthetic: true }
}

function finish(input: ExtractInput, pageTexts: string[], warnings: string[]): ExtractedDocument {
  if (pageTexts.length > LIMITS.maxPages) {
    throw new ExtractionError('too-many-pages', `document has ${pageTexts.length} pages; the limit is ${LIMITS.maxPages}`)
  }
  const pages: ExtractedPage[] = pageTexts.map((text, i) => ({ page: i + 1, text }))
  const charCount = pages.reduce((n, p) => n + p.text.length, 0)
  if (charCount === 0) throw new ExtractionError('empty', 'document contains no text')
  if (charCount > LIMITS.maxExtractedChars) {
    throw new ExtractionError('too-long', `document has ${charCount} characters; the limit is ${LIMITS.maxExtractedChars}`)
  }
  return {
    id: input.id,
    title: input.title.trim(),
    kind: input.kind,
    contentHash: contentHash(pages),
    pageCount: pages.length,
    charCount,
    pages,
    warnings,
  }
}

export async function extractPdf(input: ExtractInput & { bytes: Uint8Array }): Promise<ExtractedDocument> {
  if (input.bytes.byteLength === 0) throw new ExtractionError('empty', 'empty upload')
  if (input.bytes.byteLength > LIMITS.maxUploadBytes) {
    throw new ExtractionError('too-large', `upload is ${input.bytes.byteLength} bytes; the limit is ${LIMITS.maxUploadBytes}`)
  }
  let totalPages: number
  let text: string[]
  try {
    const pdf = await getDocumentProxy(input.bytes)
    ;({ totalPages, text } = await extractText(pdf, { mergePages: false }))
  } catch (error) {
    throw new ExtractionError('unreadable-pdf', `could not parse PDF: ${error instanceof Error ? error.message : String(error)}`)
  }
  return extractPdfPages({ ...input, pages: text }, totalPages)
}

/** A PDF whose text layer was extracted by the client: every check `extractPdf` makes after parsing, minus the byte cap. */
export function extractPdfPages(input: ExtractInput & { pages: readonly string[] }, totalPages = input.pages.length): ExtractedDocument {
  if (input.pages.length === 0) throw new ExtractionError('empty', 'no pages supplied')
  if (input.pages.length > LIMITS.maxPages) {
    throw new ExtractionError('too-many-pages', `PDF has ${input.pages.length} pages; the limit is ${LIMITS.maxPages}`)
  }
  const pages = input.pages.map(normaliseText)
  const nonWhitespace = pages.join('').replace(/\s/g, '').length
  if (nonWhitespace < LIMITS.minPdfChars) {
    throw new ExtractionError('no-text-layer', 'PDF has no usable text layer (scanned image?). Paste the text instead.')
  }
  const warnings: string[] = []
  const emptyPages = pages.filter((p) => p.length === 0).length
  if (emptyPages > 0) warnings.push(`${emptyPages} of ${totalPages} pages had no extractable text`)
  return finish(input, pages, warnings)
}

export function extractPlainText(input: ExtractInput & { text: string }): ExtractedDocument {
  if (input.text.length > LIMITS.maxTextChars) {
    throw new ExtractionError('too-long', `text is ${input.text.length} characters; the limit is ${LIMITS.maxTextChars}`)
  }
  const { pages, synthetic } = paginateText(input.text)
  const warnings = synthetic ? [`text had no page breaks; split into ${pages.length} pseudo-pages of ~${LIMITS.textPageChars} characters`] : []
  return finish(input, pages, warnings)
}

/** Entry point used by the upload route and the eval harness. */
export async function extractDocument(input: ExtractInput): Promise<ExtractedDocument> {
  if (!ID_PATTERN.test(input.id)) throw new ExtractionError('bad-id', `source id "${input.id}" must be a lowercase slug`)
  if (input.kind === 'pdf') {
    if (input.pages) return extractPdfPages({ ...input, pages: input.pages })
    if (!input.bytes) throw new ExtractionError('empty', 'no PDF bytes supplied')
    return extractPdf({ ...input, bytes: input.bytes })
  }
  if (typeof input.text !== 'string' || input.text.trim().length === 0) throw new ExtractionError('empty', 'no text supplied')
  return extractPlainText({ ...input, text: input.text })
}

/** Derive a safe source id from a filename or title. */
export function slugify(name: string, fallback = 'source'): string {
  const slug = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return ID_PATTERN.test(slug) ? slug : fallback
}
