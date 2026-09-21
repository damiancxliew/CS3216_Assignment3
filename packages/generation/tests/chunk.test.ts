import { describe, expect, it } from 'vitest'

import { loadI1Documents } from '../src/fixtures'
import { CHUNK_CHARS, LexicalRetriever, chunkDocument, nearestChunk } from '../src/ingest/chunk'
import { normaliseForMatch } from '../src/ingest/spans'

describe('D2 — chunking with page references', () => {
  it('never crosses a page boundary and covers every page', async () => {
    const doc = (await loadI1Documents()).get('handout')!
    const chunks = chunkDocument(doc)
    expect(chunks.length).toBeGreaterThan(doc.pageCount)
    for (const chunk of chunks) {
      const page = doc.pages[chunk.page - 1]!
      expect(page.text.slice(chunk.start, chunk.end).trim()).toBe(chunk.text)
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_CHARS + 2)
    }
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set(doc.pages.map((p) => p.page)))
    // overlapping windows: consecutive chunks on a page share text
    const [a, b] = chunks.filter((c) => c.page === 1)
    expect(a && b && a.end > b!.start).toBe(true)
  })

  it('resolves to the `source_chunk` row shape (page_from == page_to)', async () => {
    const doc = (await loadI1Documents()).get('handout')!
    const row = chunkDocument(doc)[0]!
    expect(row).toMatchObject({ sourceId: 'handout', index: 0, page: 1 })
    expect(typeof row.text).toBe('string')
  })
})

describe('D2 — lexical retrieval finds the page a paraphrase came from', () => {
  it('ranks the right page first for a paraphrased claim', async () => {
    const docs = await loadI1Documents()
    const retriever = LexicalRetriever.fromDocuments(docs.values())
    const hits = await retriever.search('Farquhar licensed gambling and allowed opium to raise revenue')
    expect(hits[0]!.chunk.page).toBe(4)
    const succession = await retriever.search('Mahmud Shah died leaving two sons and the younger became Sultan')
    expect(succession[0]!.chunk.page).toBe(3)
  })

  it('nearestChunk gives the repair loop a verbatim passage to copy from', async () => {
    const docs = await loadI1Documents()
    const retriever = LexicalRetriever.fromDocuments(docs.values())
    const hit = await nearestChunk(retriever, 'Raffles named Farquhar Resident and left for Bencoolen after about a week', 'handout')
    expect(hit?.chunk.page).toBe(3)
    expect(normaliseForMatch(hit!.chunk.text)).toContain(normaliseForMatch('appointed Farquhar as Resident and Commandant'))
    expect(await nearestChunk(retriever, 'quantum chromodynamics lattice gauge', 'handout')).toBeNull()
  })
})
