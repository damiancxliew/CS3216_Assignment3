/**
 * D2 — chunking with page references, and retrieval over the chunks.
 *
 * Chunks are the unit of storage (`source_chunk` in the Supabase schema: body,
 * page_from, page_to, embedding) and of retrieval. A chunk never crosses a page
 * boundary, so anything retrieved can be cited page-accurately. The lexical
 * retriever here needs no network and is what the repair loop uses to tell the
 * planner where a misquoted span actually lives; the `Embedder` interface is the
 * seam for pgvector once P1's storage is wired.
 */
import { normaliseForMatch } from './spans'
import type { Chunk, ExtractedDocument } from './types'

export const CHUNK_CHARS = 700
export const CHUNK_OVERLAP = 120

/** Sentence-aware sliding window inside each page. */
export function chunkDocument(doc: ExtractedDocument, size: number = CHUNK_CHARS, overlap: number = CHUNK_OVERLAP): Chunk[] {
  const chunks: Chunk[] = []
  for (const page of doc.pages) {
    const text = page.text
    if (text.trim().length === 0) continue
    let start = 0
    while (start < text.length) {
      let end = Math.min(text.length, start + size)
      if (end < text.length) {
        const window = text.slice(start, end)
        const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf('? '), window.lastIndexOf('! '))
        if (cut > size * 0.5) end = start + cut + 1
      }
      const body = text.slice(start, end)
      if (body.trim().length > 0) {
        chunks.push({ id: `${doc.id}:${page.page}:${chunks.length}`, sourceId: doc.id, index: chunks.length, page: page.page, text: body.trim(), start, end })
      }
      if (end >= text.length) break
      start = Math.max(end - overlap, start + 1)
    }
  }
  return chunks
}

export interface RetrievedChunk {
  chunk: Chunk
  score: number
}

export interface Retriever {
  search(query: string, limit?: number): Promise<RetrievedChunk[]>
}

/** Seam for pgvector: OpenAI `text-embedding-3-small` produces the 1536-d vectors the schema expects. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'at', 'by', 'for', 'was', 'were', 'is', 'be', 'that', 'this', 'with', 'as', 'it', 'its', 'he', 'his', 'she', 'her', 'they', 'their', 'from', 'or', 'not', 'had', 'has', 'have'])

export function tokenize(text: string): string[] {
  return normaliseForMatch(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/**
 * BM25 over the chunk texts. Good enough to find "the page this quote is
 * paraphrasing" — the job the repair loop needs — with zero cost.
 */
export class LexicalRetriever implements Retriever {
  private readonly docs: Array<{ chunk: Chunk; tf: Map<string, number>; len: number }>
  private readonly df = new Map<string, number>()
  private readonly avgLen: number

  constructor(chunks: readonly Chunk[]) {
    this.docs = chunks.map((chunk) => {
      const tokens = tokenize(chunk.text)
      const tf = new Map<string, number>()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      return { chunk, tf, len: tokens.length }
    })
    this.avgLen = this.docs.reduce((n, d) => n + d.len, 0) / Math.max(1, this.docs.length)
  }

  static fromDocuments(documents: Iterable<ExtractedDocument>): LexicalRetriever {
    return new LexicalRetriever([...documents].flatMap((d) => chunkDocument(d)))
  }

  async search(query: string, limit = 5): Promise<RetrievedChunk[]> {
    const terms = [...new Set(tokenize(query))]
    const n = this.docs.length
    const k1 = 1.2
    const b = 0.75
    const scored = this.docs.map(({ chunk, tf, len }) => {
      let score = 0
      for (const term of terms) {
        const f = tf.get(term)
        if (!f) continue
        const df = this.df.get(term) ?? 0
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / this.avgLen)))
      }
      return { chunk, score }
    })
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
      .slice(0, limit)
  }
}

/** The best chunk for a failed quote, if any: which page it is really on and what the text there says. */
export async function nearestChunk(retriever: Retriever, quote: string, sourceId?: string): Promise<RetrievedChunk | null> {
  const hits = await retriever.search(quote, 8)
  return hits.find((h) => !sourceId || h.chunk.sourceId === sourceId) ?? null
}
