import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { extractPlainText, slugify } from '../ingest/extract'
import type { ExtractedDocument } from '../ingest/types'
import { estimateCostUsd, type LlmUsage } from '../llm/client'
import { ID_PATTERN } from '../spec/v2'
import { allowedDomains, isAllowedUrl, type SourcePolicy } from './allowlist'
import { htmlToText } from './html'
import type { SearchHit, WebSearchClient } from './search'

export * from './allowlist'
export * from './html'
export * from './labels'
export * from './quotes'
export * from './search'

export interface SourcesInput {
  episode: string
  teacherNotes?: string
  policy?: SourcePolicy
  maxSources?: number
}

export interface OutsideSource {
  id: string
  title: string
  origin: 'outside'
  url: string
}

export interface SourcesOutput {
  sources: OutsideSource[]
  documents: ExtractedDocument[]
  rejected: { url: string; reason: string }[]
  usage: LlmUsage
  costUsd: number | null
}

export interface SourcesDeps {
  search: WebSearchClient
  fetch?: typeof fetch
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>
  now?: () => number
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
type SourceLookup = NonNullable<SourcesDeps['lookup']>

const defaultLookup: SourceLookup = (hostname) => dnsLookup(hostname, { all: true })

class SourceFetchError extends Error {
  constructor(readonly reason: string) {
    super(reason)
  }
}

interface Candidate {
  hit: SearchHit
  url: string
}

interface FetchedSource {
  source: OutsideSource
  document: ExtractedDocument
}

function canonicalUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString()
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true
  }

  const [first, second] = octets
  if (first === undefined || second === undefined) return true
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
}

function ipv6Bytes(address: string): number[] | null {
  let value = address.toLowerCase().split('%', 1)[0] ?? ''
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':')
    const ipv4 = value.slice(lastColon + 1)
    if (lastColon < 0 || !isPrivateIpv4Format(ipv4)) return null
    const octets = ipv4.split('.').map(Number)
    const firstWord = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0)
    const secondWord = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)
    value = `${value.slice(0, lastColon + 1)}${firstWord.toString(16)}:${secondWord.toString(16)}`
  }

  const halves = value.split('::')
  if (halves.length > 2) return null
  const left = (halves[0] ?? '').split(':').filter(Boolean)
  const right = halves.length === 2 ? (halves[1] ?? '').split(':').filter(Boolean) : []
  const zeroCount = 8 - left.length - right.length
  if ((halves.length === 1 && zeroCount !== 0) || (halves.length === 2 && zeroCount < 1)) return null
  const parts = [...left, ...Array.from({ length: zeroCount }, () => '0'), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  const words = parts.map((part) => Number.parseInt(part, 16))
  return words.flatMap((word) => [word >>> 8, word & 0xff])
}

function isPrivateIpv4Format(address: string): boolean {
  const octets = address.split('.').map(Number)
  return octets.length === 4 && octets.every((octet) =>
    Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family !== 6) return true

  const bytes = ipv6Bytes(address)
  if (!bytes) return true
  const allZero = bytes.every((byte) => byte === 0)
  const ipv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  if (ipv4Mapped) return isPrivateIpv4(bytes.slice(12).join('.'))

  if (allZero || (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1)) return true
  if (bytes.slice(0, 12).every((byte) => byte === 0)) return true

  const first = bytes[0] ?? 0
  const second = bytes[1] ?? 0
  return (first & 0xfe) === 0xfc ||
    (first === 0xfe && (second & 0xc0) === 0x80) ||
    first === 0xff
}

async function assertPublicResolution(url: string, lookup: SourceLookup): Promise<void> {
  const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname)
  } catch {
    throw new SourceFetchError('dns_lookup_failed')
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new SourceFetchError('dns_lookup_failed')
  }
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new SourceFetchError('private_address')
  }
}

function sourceId(title: string, url: string): string {
  const slug = slugify(title).slice(0, 31).replace(/-+$/, '') || 'source'
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 8)
  const id = `outside-${slug}-${digest}`
  if (!ID_PATTERN.test(id) || id.length > 48) throw new Error('generated outside source id is invalid')
  return id
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new SourceFetchError('too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchText(
  startUrl: string,
  policy: SourcePolicy,
  fetcher: typeof fetch,
  lookup: SourceLookup,
): Promise<{ url: string; title: string | null; text: string }> {
  if (!isAllowedUrl(startUrl, policy)) throw new SourceFetchError('not_allowlisted')

  let url = canonicalUrl(startUrl)
  const signal = AbortSignal.timeout(15_000)
  let redirects = 0
  while (true) {
    await assertPublicResolution(url, lookup)
    let response: Response
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers: { accept: 'text/html, text/plain;q=0.9' },
        redirect: 'manual',
        signal,
      })
    } catch (cause) {
      if (cause instanceof SourceFetchError) throw cause
      throw new SourceFetchError(cause instanceof Error && /timeout|abort/i.test(cause.name) ? 'timeout' : 'fetch_failed')
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= MAX_REDIRECTS) {
        await response.body?.cancel()
        throw new SourceFetchError('too_many_redirects')
      }
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new SourceFetchError('redirect_missing_location')

      let redirectedUrl: string
      try {
        redirectedUrl = canonicalUrl(new URL(location, url).toString())
      } catch {
        throw new SourceFetchError('invalid_redirect')
      }
      if (!isAllowedUrl(redirectedUrl, policy)) throw new SourceFetchError('not_allowlisted')
      url = redirectedUrl
      redirects += 1
      continue
    }

    if (!response.ok) {
      await response.body?.cancel()
      throw new SourceFetchError(`http_${response.status}`)
    }

    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'text/html' && contentType !== 'text/plain') {
      await response.body?.cancel()
      throw new SourceFetchError('unsupported_content_type')
    }

    const body = new TextDecoder('utf-8').decode(await readBoundedBody(response))
    if (contentType === 'text/html') {
      return { url, ...htmlToText(body) }
    }
    return { url, title: null, text: body }
  }
}

async function fetchCandidate(
  candidate: Candidate,
  policy: SourcePolicy,
  fetcher: typeof fetch,
  lookup: SourceLookup,
): Promise<{ result?: FetchedSource; rejected?: { url: string; reason: string } }> {
  try {
    const page = await fetchText(candidate.url, policy, fetcher, lookup)
    const text = page.text.trim()
    if (text.length < 400) return { rejected: { url: candidate.hit.url, reason: 'too_short' } }

    const title = page.title?.trim() || candidate.hit.title.trim() || new URL(page.url).hostname
    const id = sourceId(title, page.url)
    const document = extractPlainText({ id, title, kind: 'text', text })
    return {
      result: {
        source: { id, title, origin: 'outside', url: page.url },
        document,
      },
    }
  } catch (cause) {
    const reason = cause instanceof SourceFetchError ? cause.reason : 'extract_failed'
    return { rejected: { url: candidate.hit.url, reason } }
  }
}

export async function runSources(input: SourcesInput, deps: SourcesDeps): Promise<SourcesOutput> {
  const policy = input.policy ?? {}
  const requestedMax = input.maxSources ?? 5
  const maxSources = Number.isFinite(requestedMax)
    ? Math.min(8, Math.max(0, Math.floor(requestedMax)))
    : 5
  const searchDomains = allowedDomains(policy)
  const teacherNotes = input.teacherNotes?.trim()
  const query = teacherNotes ? `${input.episode}\nTeacher notes: ${teacherNotes}` : input.episode
  const searchResult = await deps.search.search({
    query,
    allowedDomains: searchDomains,
    maxResults: maxSources,
  })

  const rejected: SourcesOutput['rejected'] = []
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  for (const hit of searchResult.hits) {
    let url: string
    try {
      url = canonicalUrl(hit.url)
    } catch {
      rejected.push({ url: hit.url, reason: 'invalid_url' })
      continue
    }
    if (!isAllowedUrl(url, policy)) {
      rejected.push({ url: hit.url, reason: 'not_allowlisted' })
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    if (candidates.length < maxSources) candidates.push({ hit, url })
  }

  const fetched = await Promise.all(candidates.map((candidate) =>
    fetchCandidate(candidate, policy, deps.fetch ?? fetch, deps.lookup ?? defaultLookup),
  ))
  const sources: OutsideSource[] = []
  const documents: ExtractedDocument[] = []
  for (const item of fetched) {
    if (item.rejected) {
      rejected.push(item.rejected)
    } else if (item.result) {
      sources.push(item.result.source)
      documents.push(item.result.document)
    }
  }

  return {
    sources,
    documents,
    rejected,
    usage: searchResult.usage,
    costUsd: estimateCostUsd(searchResult.model, searchResult.usage),
  }
}
