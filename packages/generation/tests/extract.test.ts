import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { extractText, getDocumentProxy } from 'unpdf'
import { describe, expect, it } from 'vitest'

import { FIXTURES_DIR, I1_FIXTURE } from '../src/fixtures'
import { ExtractionError, LIMITS, extractDocument, paginateText, slugify } from '../src/ingest/extract'
import { normaliseForMatch, resolveSpan } from '../src/ingest/spans'
import type { ExtractedDocument } from '../src/ingest/types'
import { makePdf } from './helpers/pdf'

const CORPUS = join(FIXTURES_DIR, 'eval-corpus')

async function extractCorpusPdf(name: string): Promise<ExtractedDocument> {
  const bytes = new Uint8Array(await readFile(join(CORPUS, `${name}.pdf`)))
  return extractDocument({ id: name, title: name, kind: 'pdf', bytes })
}

/** Asserts the quote is found on exactly `page` and on no other page. */
function expectOnlyOnPage(doc: ExtractedDocument, page: number, quote: string) {
  const docs = new Map([[doc.id, doc]])
  const hit = resolveSpan({ sourceId: doc.id, page, quote }, docs)
  expect(hit.ok, `"${quote}" should be on page ${page} of ${doc.id}`).toBe(true)
  for (const other of doc.pages) {
    if (other.page === page) continue
    const miss = resolveSpan({ sourceId: doc.id, page: other.page, quote }, docs)
    expect(miss.ok, `"${quote}" must not also match page ${other.page}`).toBe(false)
    if (!miss.ok) {
      expect(miss.reason).toBe('quote-not-on-page')
      expect(miss.nearestPage).toBe(page)
    }
  }
}

describe('D1 — real PDFs extract with page-accurate spans', () => {
  it('George Mason, Objections to the Constitution (NARA, 2 pages)', async () => {
    const doc = await extractCorpusPdf('mason-objections-1787')
    expect(doc.pageCount).toBe(2)
    expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expectOnlyOnPage(doc, 1, 'There is no Declaration of Rights')
    expectOnlyOnPage(doc, 2, 'the Congress may grant monopolies in trade and commerce')
  })

  it('Spotted Tail Agency report, 1877 (NARA, 5 pages)', async () => {
    const doc = await extractCorpusPdf('spotted-tail-agency-1877')
    expect(doc.pageCount).toBe(5)
    expectOnlyOnPage(doc, 1, 'A Report from the Spotted Tail Indian Agency, 1877')
    // the running header repeats on every page and therefore must NOT be page-accurate
    const header = resolveSpan({ sourceId: doc.id, page: 3, quote: 'Primary Sources for Teachers 2006' }, new Map([[doc.id, doc]]))
    expect(header.ok).toBe(true)
  })

  it('Magna Carta 1297 translation (NARA, 6 pages)', async () => {
    const doc = await extractCorpusPdf('magna-carta-1297-translation')
    expect(doc.pageCount).toBe(6)
    expectOnlyOnPage(doc, 4, 'No sheriff or bailiff of ours or of anyone else is to take')
    expectOnlyOnPage(doc, 1, 'Edward by the grace of God King of England')
  })

  it('a PDF rendered from known page texts round-trips every page', async () => {
    const raw = await readFile(join(FIXTURES_DIR, I1_FIXTURE.source.file), 'utf8')
    const pages = raw.replace(/\r\n/g, '\n').split('\f')
    const doc = await extractDocument({ id: 'handout-pdf', title: 'handout', kind: 'pdf', bytes: await makePdf(pages) })
    expect(doc.pageCount).toBe(4)
    pages.forEach((text, i) => {
      const firstSentence = text.trim().split('\n').find((l) => l.length > 40)!
      expectOnlyOnPage(doc, i + 1, firstSentence)
    })
    // and the same quotes the I1 fixture uses resolve on the PDF just as they do on the text
    expectOnlyOnPage(doc, 3, 'the Temenggong 3,000 Spanish dollars a year')
    expect(normaliseForMatch(doc.pages[0]!.text)).toContain(normaliseForMatch('avoid any collision with the Dutch'))
  })
})

describe('D1 — limits and failure modes', () => {
  it('rejects an oversized upload before parsing', async () => {
    const bytes = new Uint8Array(LIMITS.maxUploadBytes + 1)
    await expect(extractDocument({ id: 'big', title: 'big', kind: 'pdf', bytes })).rejects.toMatchObject({ code: 'too-large' })
  })

  it('accepts pages the client extracted itself, identically to bytes', async () => {
    const raw = await readFile(join(FIXTURES_DIR, I1_FIXTURE.source.file), 'utf8')
    const bytes = await makePdf(raw.replace(/\r\n/g, '\n').split('\f'))
    // the browser sends the same per-page text unpdf produces
    const pdf = await getDocumentProxy(bytes.slice())
    const { text } = await extractText(pdf, { mergePages: false })
    const fromBytes = await extractDocument({ id: 'handout-pdf', title: 'handout', kind: 'pdf', bytes })
    const fromPages = await extractDocument({ id: 'handout-pdf', title: 'handout', kind: 'pdf', pages: text })
    expect(fromPages.pageCount).toBe(fromBytes.pageCount)
    expect(fromPages.pages).toEqual(fromBytes.pages)
    expect(fromPages.contentHash).toBe(fromBytes.contentHash)
  })

  it('rejects client-supplied pages over the page cap and with no text layer', async () => {
    const tooMany = Array.from({ length: LIMITS.maxPages + 1 }, () => 'word '.repeat(20))
    await expect(extractDocument({ id: 'many', title: 'many', kind: 'pdf', pages: tooMany })).rejects.toMatchObject({ code: 'too-many-pages' })
    await expect(extractDocument({ id: 'scan', title: 'scan', kind: 'pdf', pages: ['', '   '] })).rejects.toMatchObject({ code: 'no-text-layer' })
    await expect(extractDocument({ id: 'none', title: 'none', kind: 'pdf', pages: [] })).rejects.toMatchObject({ code: 'empty' })
  })

  it('rejects a PDF with no text layer', async () => {
    const bytes = await makePdf(['', ''], { blank: true })
    await expect(extractDocument({ id: 'scan', title: 'scan', kind: 'pdf', bytes })).rejects.toMatchObject({ code: 'no-text-layer' })
  })

  it('rejects bytes that are not a PDF', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 definitely not a pdf'.repeat(20))
    await expect(extractDocument({ id: 'junk', title: 'junk', kind: 'pdf', bytes })).rejects.toMatchObject({ code: 'unreadable-pdf' })
  })

  it('rejects too much pasted text and empty text', async () => {
    await expect(extractDocument({ id: 't', title: 't', kind: 'text', text: 'x'.repeat(LIMITS.maxTextChars + 1) })).rejects.toMatchObject({ code: 'too-long' })
    await expect(extractDocument({ id: 't', title: 't', kind: 'text', text: '   \n ' })).rejects.toMatchObject({ code: 'empty' })
  })

  it('rejects an unsafe source id', async () => {
    await expect(extractDocument({ id: 'Bad Id', title: 't', kind: 'text', text: 'hello' })).rejects.toBeInstanceOf(ExtractionError)
  })

  it('paginates pasted text on form feeds, or into pseudo-pages with a warning', async () => {
    expect(paginateText('a\fb\fc')).toEqual({ pages: ['a', 'b', 'c'], synthetic: false })
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(20).trim()}`).join('\n\n')
    const doc = await extractDocument({ id: 'long', title: 'long', kind: 'text', text: paragraphs })
    expect(doc.pageCount).toBeGreaterThan(1)
    expect(doc.pages.every((p) => p.text.length <= LIMITS.textPageChars + 50)).toBe(true)
    expect(doc.warnings[0]).toMatch(/pseudo-pages/)
    expect(doc.pages.map((p) => p.text).join('\n\n')).toBe(paragraphs)
  })

  it('normalises CRLF so the content hash is platform-stable', async () => {
    const a = await extractDocument({ id: 'a', title: 'a', kind: 'text', text: 'one\r\ntwo\r\n\fthree' })
    const b = await extractDocument({ id: 'a', title: 'a', kind: 'text', text: 'one\ntwo\n\fthree' })
    expect(a.contentHash).toBe(b.contentHash)
  })

  it('slugifies filenames into safe source ids', () => {
    expect(slugify('My Lesson (final).PDF')).toBe('my-lesson-final')
    expect(slugify('2024 notes.pdf')).toBe('notes')
    expect(slugify('!!!')).toBe('source')
  })
})
