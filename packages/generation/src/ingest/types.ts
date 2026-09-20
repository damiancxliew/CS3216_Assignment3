import type { SourceKind } from '../spec/catalogue'

export interface ExtractedPage {
  /** 1-based page number. */
  page: number
  text: string
}

/**
 * Output of server-side extraction (D1, FR-1). Pages are the unit of citation:
 * every `SourceSpan.page` in a spec points at one of these.
 */
export interface ExtractedDocument {
  id: string
  title: string
  kind: SourceKind
  /** sha256 hex of the normalised full text. */
  contentHash: string
  pageCount: number
  charCount: number
  pages: ExtractedPage[]
  warnings: string[]
}

export interface Chunk {
  id: string
  sourceId: string
  index: number
  page: number
  text: string
  /** Character offsets within the page text. */
  start: number
  end: number
}
