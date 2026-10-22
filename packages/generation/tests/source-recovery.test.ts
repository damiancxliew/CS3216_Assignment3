import { describe, expect, it, vi } from 'vitest'
import { runSources, FakeWebSearch } from '../src/sources'
import { makePdf } from './helpers/pdf'
const text = 'Merchants recorded the arrival of ships in the settlement in 1819. '.repeat(20)
const lookup = async () => [{ address: '93.184.216.34', family: 4 }]
const hit = (n: number) => ({ url: `https://nlb.gov.sg/record/${n}`, title: `Record ${n}`, snippet: '' })
const plain = (body = text, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } })
describe('source recovery', () => {
  it('recovers empty 202 responses without accepting empty material', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(plain('', 202)).mockResolvedValueOnce(plain())
    const result = await runSources({ episode: '1819' }, { search: new FakeWebSearch([hit(1)]), fetch, lookup })
    expect(result.documents).toHaveLength(1)
    expect(result.diagnostics?.[0]).toMatchObject({ attempts: 2, status: 200, outcome: 'accepted' })
  })
  it('reports persistent empty responses separately from short text and 403', async () => {
    const fetch = vi.fn(async (url) => plain(String(url).endsWith('2') ? 'Short' : '', String(url).endsWith('3') ? 403 : 202))
    const result = await runSources({ episode: '1819' }, { search: new FakeWebSearch([hit(1), hit(2), hit(3)]), fetch, lookup })
    expect(result.rejected.map(r => r.reason)).toEqual(['empty_response', 'too_short', 'http_403'])
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('continues beyond failed candidates with at most three fetches in flight', async () => {
    let active = 0, peak = 0
    const fetch = vi.fn(async (url) => {
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active--
      return plain(text, Number(String(url).split('/').at(-1)) < 5 ? 403 : 200)
    })
    const result = await runSources({ episode: '1819' }, { search: new FakeWebSearch(Array.from({ length: 15 }, (_, n) => hit(n))), fetch, lookup })
    expect(result.documents).toHaveLength(5)
    expect(peak).toBeLessThanOrEqual(3)
    expect(result.summary).toMatchObject({ accepted: 5, failed: 5 })
  })
  it('retains numbered pages in a text PDF and distinguishes scanned and malformed PDFs', async () => {
    const pdf = await makePdf([text, text])
    const scanned = await makePdf([''], { blank: true })
    const fetch = vi.fn(async (url) => new Response(new Uint8Array(String(url).endsWith('1') ? pdf : String(url).endsWith('2') ? scanned : new TextEncoder().encode('not a PDF')), { headers: { 'content-type': 'application/pdf' } }))
    const result = await runSources({ episode: '1819' }, { search: new FakeWebSearch([hit(1), hit(2), hit(3)]), fetch, lookup })
    expect(result.documents[0]).toMatchObject({ kind: 'pdf', pageCount: 2, pages: [{ page: 1 }, { page: 2 }] })
    expect(result.rejected.map(r => r.reason)).toEqual(['no-text-layer', 'unreadable-pdf'])
  })
})
