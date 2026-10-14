import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_ALLOWED_DOMAINS,
  FakeWebSearch,
  allowedDomains,
  checkQuotes,
  createOpenAiWebSearch,
  documentText,
  findQuote,
  htmlToText,
  isAllowedUrl,
  normaliseForQuote,
  runSources,
  sourceLabel,
  type SearchHit,
} from '../src/sources'

describe('source allowlist', () => {
  it('allows exact domains and subdomains without accepting lookalikes', () => {
    expect(isAllowedUrl('https://nas.gov.sg/archive')).toBe(true)
    expect(isAllowedUrl('https://www.nas.gov.sg/archive')).toBe(true)
    expect(isAllowedUrl('https://nas.gov.sg.example.com/archive')).toBe(false)
    expect(isAllowedUrl('https://notnas.gov.sg/archive')).toBe(false)
    expect(isAllowedUrl('ftp://nas.gov.sg/archive')).toBe(false)
  })

  it('normalizes teacher domains and discards invalid entries', () => {
    const domains = allowedDomains({
      extraDomains: [
        ' HTTPS://WWW.Example.ORG/path ',
        'www.nus.edu.sg',
        'localhost',
        '127.0.0.1',
        'not a domain',
      ],
    })
    expect(domains).toContain('example.org')
    expect(domains?.filter((domain) => domain === 'nus.edu.sg')).toHaveLength(1)
    expect(domains).not.toContain('localhost')
    expect(domains).not.toContain('127.0.0.1')
    expect(domains).toEqual(expect.arrayContaining([...DEFAULT_ALLOWED_DOMAINS]))
  })

  it('blocks local and IP-literal targets under allowAny', () => {
    expect(allowedDomains({ allowAny: true })).toBeNull()
    expect(isAllowedUrl('https://example.com/article', { allowAny: true })).toBe(true)
    for (const url of [
      'http://127.0.0.1',
      'http://localhost',
      'http://local',
      'http://10.0.0.1',
      'http://172.16.0.1',
      'http://192.168.1.1',
      'http://[::1]',
      'http://169.254.169.254/latest/meta-data',
      'http://printer.local',
    ]) {
      expect(isAllowedUrl(url, { allowAny: true }), url).toBe(false)
    }
  })
})

describe('quote verification', () => {
  it('normalizes Unicode punctuation, case, whitespace, and wrapped hyphenation', () => {
    const source = '“The long- \n awaited agreement” — ACCEPTED after review.'
    const quote = '  “THE long- \n awaited agreement” — accepted  '
    expect(normaliseForQuote(quote)).toBe('"the longawaited agreement" - accepted')
    expect(findQuote(quote, source).found).toBe(true)
    expect(findQuote('The long-awaited settlement — accepted', source).found).toBe(false)
  })

  it('matches ordered elisions and rejects reversed, empty, or missing quotes', () => {
    expect(findQuote('the first ... the last', 'The first passage comes before the last.').found).toBe(true)
    expect(findQuote('the last [...] the first', 'The first passage comes before the last.').found).toBe(false)
    expect(findQuote('…', 'A passage').found).toBe(false)
    expect(findQuote('', 'A passage')).toEqual({ found: false, index: -1 })
  })

  it('checks nested citations and real document bodies against their sources', () => {
    const sourceTexts = { s1: 'The original document states that trade began in 1819.' }
    const valid = {
      discoveries: [{ citations: [{ sourceId: 's1', quote: 'trade began in 1819' }] }],
      documents: [{
        real: true,
        body: 'The original document states that trade began in 1819.',
        citations: [{ sourceId: 's1' }],
      }, {
        real: false,
        body: 'Invented body without citations.',
      }],
    }
    expect(checkQuotes(valid, sourceTexts)).toEqual([])

    const changedQuote = {
      discoveries: [
        {},
        {},
        { citations: [{ sourceId: 's1', quote: 'trade ended in 1819' }] },
      ],
    }
    expect(checkQuotes(changedQuote, sourceTexts)).toContainEqual({
      path: '$.discoveries[2].citations[0]',
      sourceId: 's1',
      message: 'quote not found in cited source',
    })

    expect(checkQuotes({ citations: [{ sourceId: 'missing', quote: 'anything' }] }, sourceTexts)).toContainEqual({
      path: '$.citations[0]',
      sourceId: 'missing',
      message: 'citation references an unknown source',
    })
    expect(checkQuotes({
      documents: [{ real: true, body: 'No citation accompanies this text.' }],
    }, sourceTexts)).toContainEqual({
      path: '$.documents[0].citations',
      sourceId: null,
      message: 'real document has no citation',
    })
  })

  it('joins extracted page text with newlines', () => {
    expect(documentText({
      id: 'record',
      title: 'Record',
      kind: 'text',
      contentHash: 'test',
      pageCount: 2,
      charCount: 21,
      pages: [{ page: 1, text: 'First page' }, { page: 2, text: 'Second page' }],
      warnings: [],
    })).toBe('First page\nSecond page')
  })
})

describe('source labels', () => {
  it('prefers masthead and date, then title, then origin fallback', () => {
    expect(sourceLabel({ origin: 'outside', masthead: 'Utusan Melayu', date: '12 August 1964' }))
      .toBe('Utusan Melayu, 12 August 1964')
    expect(sourceLabel({ origin: 'teacher', title: ' Teacher handout ' })).toBe('Teacher handout')
    expect(sourceLabel({ origin: 'teacher' })).toBe('from the teacher')
    expect(sourceLabel({ origin: 'outside' })).toBe('from an outside source')
    expect(sourceLabel({ origin: 'invented', title: ' ' })).toBe('invented')
  })
})

describe('HTML extraction', () => {
  it('removes non-content blocks, preserves paragraphs, decodes entities, and extracts title', () => {
    const result = htmlToText(`
      <html><head><title>Archive &amp; Record</title><style>hidden style</style></head>
      <body><nav>hidden nav</nav><script>hidden script</script>
      <p>First &mdash; paragraph &amp; record.</p>
      <p>Second &lt;entry&gt; with &quot;quotes&quot; and &#39;apostrophe&#39;.</p>
      <aside>hidden aside</aside></body></html>
    `)
    expect(result.title).toBe('Archive & Record')
    expect(result.text).toContain('First — paragraph & record.')
    expect(result.text).toContain('Second <entry> with "quotes" and \'apostrophe\'.')
    expect(result.text).not.toContain('Archive & Record')
    expect(result.text).not.toMatch(/\n{3,}/)
    expect(result.text).not.toMatch(/hidden (?:style|nav|script|aside)/)
    expect(htmlToText('&apos;&nbsp;&ndash;&hellip;&rsquo;&lsquo;&ldquo;&rdquo;').text)
      .toBe("' –…’‘“”")
  })
})

const LONG_TEXT = 'A preserved source records that merchants arrived at the settlement in 1819. '.repeat(12)
const publicLookup = async (_hostname: string) => [{ address: '93.184.216.34', family: 4 }]

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

describe('runSources', () => {
  it('fetches allowed pages, rejects disallowed hits before fetch, and sends default domains to search', async () => {
    const hits: SearchHit[] = [
      { url: 'https://www.nas.gov.sg/archive/record/', title: 'Search title', snippet: 'A record' },
      { url: 'https://example.com/private', title: 'Not allowed', snippet: '' },
    ]
    const search = new FakeWebSearch(hits)
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input))
      return new Response(`<html><title>National Archives record</title><p>${LONG_TEXT}</p></html>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    const result = await runSources({ episode: 'Singapore in 1819' }, { search, fetch: fetcher, lookup: publicLookup })

    expect(search.requests).toHaveLength(1)
    expect(search.requests[0]).toMatchObject({
      query: 'Singapore in 1819',
      allowedDomains: [...DEFAULT_ALLOWED_DOMAINS],
      maxResults: 5,
    })
    expect(calls).toEqual(['https://www.nas.gov.sg/archive/record'])
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      title: 'National Archives record',
      origin: 'outside',
      url: 'https://www.nas.gov.sg/archive/record',
    })
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]?.id).toMatch(/^outside-[a-z0-9-]+-[0-9a-f]{8}$/)
    expect(result.documents[0]?.id.length).toBeLessThanOrEqual(48)
    expect(result.rejected).toEqual([{ url: 'https://example.com/private', reason: 'not_allowlisted' }])
  })

  it('rechecks redirect targets and reports non-success and short pages', async () => {
    const search = new FakeWebSearch([
      { url: 'https://nas.gov.sg/redirect', title: 'Redirect', snippet: '' },
      { url: 'https://nas.gov.sg/missing', title: 'Missing', snippet: '' },
      { url: 'https://nas.gov.sg/short', title: 'Short', snippet: '' },
    ])
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/redirect')) {
        return new Response(null, { status: 302, headers: { location: 'https://example.com/private' } })
      }
      if (url.endsWith('/missing')) return textResponse('missing', 404)
      return textResponse('too short')
    }

    const result = await runSources({ episode: 'Singapore in 1819' }, { search, fetch: fetcher, lookup: publicLookup })

    expect(calls).toHaveLength(3)
    expect(calls).not.toContain('https://example.com/private')
    expect(result.sources).toEqual([])
    expect(result.documents).toEqual([])
    expect(result.rejected.map(({ reason }) => reason)).toEqual(['not_allowlisted', 'http_404', 'too_short'])
  })

  it('deduplicates normalized URLs and returns identical output for identical runs', async () => {
    const search = new FakeWebSearch([
      { url: 'https://nas.gov.sg/records/1/', title: 'Source title', snippet: '' },
      { url: 'https://nas.gov.sg/records/1#copy', title: 'Duplicate title', snippet: '' },
    ])
    const calls: string[] = []
    const fetcher: typeof fetch = async (input) => {
      calls.push(String(input))
      return textResponse(LONG_TEXT)
    }

    const input = { episode: 'Singapore in 1819', maxSources: 20 }
    const deps = { search, fetch: fetcher, lookup: publicLookup, now: () => 0 }
    const first = await runSources(input, deps)
    const second = await runSources(input, deps)

    expect(calls).toEqual(['https://nas.gov.sg/records/1', 'https://nas.gov.sg/records/1'])
    expect(first).toEqual(second)
    expect(first.sources).toHaveLength(1)
    expect(search.requests[0]?.maxResults).toBe(8)
  })

  it('rejects allowAny hosts with a private DNS answer before fetching', async () => {
    const url = 'https://teacher-source.example/record'
    const search = new FakeWebSearch([{ url, title: 'Record', snippet: '' }])
    let fetches = 0
    let lookedUpHost = ''
    const fetcher: typeof fetch = async () => {
      fetches += 1
      return textResponse(LONG_TEXT)
    }
    const lookup = async (hostname: string) => {
      lookedUpHost = hostname
      return [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]
    }

    const result = await runSources({
      episode: 'A source',
      policy: { allowAny: true },
    }, { search, fetch: fetcher, lookup })

    expect(lookedUpHost).toBe('teacher-source.example')
    expect(fetches).toBe(0)
    expect(result.rejected).toEqual([{ url, reason: 'private_address' }])
  })

  it('resolves and rejects private redirect targets before requesting them', async () => {
    const search = new FakeWebSearch([{
      url: 'https://start.example/redirect',
      title: 'Redirect',
      snippet: '',
    }])
    const requests: string[] = []
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input))
      return new Response(null, {
        status: 302,
        headers: { location: 'https://internal.example/record' },
      })
    }
    const lookup = async (hostname: string) => hostname === 'start.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '10.0.0.5', family: 4 }]

    const result = await runSources({
      episode: 'A source',
      policy: { allowAny: true },
    }, { search, fetch: fetcher, lookup })

    expect(requests).toEqual(['https://start.example/redirect'])
    expect(result.rejected).toEqual([{
      url: 'https://start.example/redirect',
      reason: 'private_address',
    }])
  })

  it('fetches when all resolved addresses are public', async () => {
    const search = new FakeWebSearch([{
      url: 'https://public.example/record',
      title: 'Public record',
      snippet: '',
    }])
    const fetcher: typeof fetch = async () => textResponse(LONG_TEXT)
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]

    const result = await runSources({
      episode: 'A source',
      policy: { allowAny: true },
    }, { search, fetch: fetcher, lookup })

    expect(result.sources).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })

  it('rejects IPv4-mapped IPv6 loopback resolutions', async () => {
    const url = 'https://mapped.example/record'
    const search = new FakeWebSearch([{ url, title: 'Mapped', snippet: '' }])
    let fetches = 0
    const fetcher: typeof fetch = async () => {
      fetches += 1
      return textResponse(LONG_TEXT)
    }
    const lookup = async () => [{ address: '::ffff:127.0.0.1', family: 6 }]

    const result = await runSources({
      episode: 'A source',
      policy: { allowAny: true },
    }, { search, fetch: fetcher, lookup })

    expect(fetches).toBe(0)
    expect(result.rejected).toEqual([{ url, reason: 'private_address' }])
  })
})

describe('OpenAI web search adapter', () => {
  it('sends domain filters and included sources, parses JSON, and merges citation URLs', async () => {
    const response = {
      model: 'gpt-5.6-luna',
      output_text: JSON.stringify({
        hits: [{ url: 'https://nas.gov.sg/json', title: 'JSON hit', snippet: 'From JSON' }],
      }),
      output: [
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'sources',
            annotations: [{
              type: 'url_citation',
              url: 'https://wikipedia.org/annotation',
              title: 'Annotation hit',
            }],
          }],
        },
        {
          type: 'web_search_call',
          action: {
            type: 'search',
            sources: [{ type: 'url', url: 'https://loc.gov/search-source' }],
          },
        },
      ],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
        output_tokens: 3,
        output_tokens_details: { reasoning_tokens: 1 },
        total_tokens: 13,
      },
    }
    const create = vi.fn(async (..._args: unknown[]) => response)
    const client = { responses: { create } } as unknown as OpenAI
    const search = createOpenAiWebSearch({ client })

    const result = await search.search({ query: 'episode', allowedDomains: ['nas.gov.sg'], maxResults: 3 })
    await search.search({ query: 'open web', allowedDomains: null, maxResults: 2 })

    const requests = create.mock.calls.map(([request]) => request as {
      tools: Array<{ filters: unknown }>
      include: string[]
    })
    expect(requests[0]?.tools[0]?.filters).toEqual({ allowed_domains: ['nas.gov.sg'] })
    expect(requests[0]?.include).toContain('web_search_call.action.sources')
    expect(requests[1]?.tools[0]?.filters).toBeNull()
    expect(result.hits.map(({ url }) => url)).toEqual([
      'https://nas.gov.sg/json',
      'https://wikipedia.org/annotation',
      'https://loc.gov/search-source',
    ])
    expect(result.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 3,
      reasoningTokens: 1,
    })
  })
})
