import { createHash } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'

import { extractPdf, ExtractionError, LIMITS, extractPlainText, slugify } from '../ingest/extract'
import type { ExtractedDocument } from '../ingest/types'
import { estimateCostUsd, type LlmUsage } from '../llm/client'
import { ID_PATTERN } from '../spec/v2'
import { allowedDomains, isAllowedUrl, type SourcePolicy } from './allowlist'
import { htmlToText } from './html'
import { isPrivateAddress } from './private-address'
import { pinnedFetch } from './pinned-fetch'
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
  /** Optional so previously queued jobs and stored outputs remain readable. */
  summary?: { discovered: number; attempted: number; accepted: number; failed: number; policyRejected: number }
  diagnostics?: SourceDiagnostic[]
}

export interface SourceDiagnostic {
  url: string
  stage: 'policy' | 'fetch' | 'extract' | 'complete'
  attempts: number
  outcome: 'accepted' | 'rejected'
  status?: number
  contentType?: string
  responseBytes?: number
  extractedLength?: number
  reason?: string
  redirects?: string[]
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

export class SourceFetchError extends Error {
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

function hasPrivateAddressCause(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    if ('code' in current && current.code === 'ERR_SOURCE_PRIVATE_ADDRESS') return true
    current = 'cause' in current ? current.cause : undefined
  }
  return false
}

function sourceId(title: string, url: string): string {
  const slug = slugify(title).slice(0, 31).replace(/-+$/, '') || 'source'
  const digest = createHash('sha256').update(url).digest('hex').slice(0, 8)
  const id = `outside-${slug}-${digest}`
  if (!ID_PATTERN.test(id) || id.length > 48) throw new Error('generated outside source id is invalid')
  return id
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
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

/** Bounded bytes first: callers choose an extractor only after validating metadata.
 * Every redirect and the actual connection retain the same DNS/public-address checks.
 */
export async function fetchSourceBytes(
  startUrl: string,
  options: {
    policy: SourcePolicy
    fetch?: typeof fetch
    lookup?: SourceLookup
    signal?: AbortSignal
    maxBytes?: number
    contentTypes?: readonly string[]
    diagnostic?: Partial<SourceDiagnostic>
  },
): Promise<{ url: string; bytes: Uint8Array; contentType: string; status: number }> {
  const { policy } = options
  if (!isAllowedUrl(startUrl, policy)) throw new SourceFetchError('not_allowlisted')
  let url = canonicalUrl(startUrl)
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000)
  const diagnostic = options.diagnostic ?? {}
  diagnostic.redirects = []
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted()
    await assertPublicResolution(url, options.lookup ?? defaultLookup)
    const response = await (options.fetch ?? pinnedFetch)(url, {
      method: 'GET',
      headers: { accept: 'text/html, application/pdf, text/plain;q=0.9' },
      redirect: 'manual', signal,
    })
    diagnostic.status = response.status
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (redirects >= MAX_REDIRECTS) throw new SourceFetchError('too_many_redirects')
      if (!location) throw new SourceFetchError('redirect_missing_location')
      try { url = canonicalUrl(new URL(location, url).toString()) }
      catch { throw new SourceFetchError('invalid_redirect') }
      if (!isAllowedUrl(url, policy)) throw new SourceFetchError('not_allowlisted')
      diagnostic.redirects.push(url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new SourceFetchError(`http_${response.status}`)
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    diagnostic.contentType = contentType
    if (!(options.contentTypes ?? ['text/html', 'text/plain', 'application/pdf']).includes(contentType)) {
      await response.body?.cancel()
      throw new SourceFetchError('unsupported_content_type')
    }
    const maxBytes = options.maxBytes ?? (contentType === 'application/pdf' ? LIMITS.maxUploadBytes : MAX_RESPONSE_BYTES)
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel()
      throw new SourceFetchError('too_large')
    }
    const bytes = await readBoundedBody(response, maxBytes)
    diagnostic.responseBytes = bytes.length
    if (!bytes.length) throw new SourceFetchError('empty_response')
    return { url, bytes, contentType, status: response.status }
  }
}

function failureReason(cause: unknown): string {
  if (hasPrivateAddressCause(cause)) return 'private_address'
  if (cause instanceof SourceFetchError) return cause.reason
  if (cause instanceof ExtractionError) return cause.code
  return cause instanceof Error && /timeout|abort/i.test(cause.name) ? 'timeout' : 'fetch_failed'
}

async function fetchCandidate(
  candidate: Candidate, policy: SourcePolicy, deps: SourcesDeps, signal: AbortSignal,
): Promise<{ result?: FetchedSource; rejected?: { url: string; reason: string }; diagnostic: SourceDiagnostic }> {
  const diagnostic: SourceDiagnostic = { url: candidate.hit.url, stage: 'fetch', attempts: 0, outcome: 'rejected' }
  for (let attempt = 0; attempt < 2; attempt++) {
    diagnostic.attempts++
    diagnostic.stage = 'fetch'
    try {
      const page = await fetchSourceBytes(candidate.url, { policy, fetch: deps.fetch ?? pinnedFetch, lookup: deps.lookup ?? defaultLookup, signal, diagnostic })
      diagnostic.stage = 'extract'
      const decoded = page.contentType === 'application/pdf' ? null : new TextDecoder('utf-8').decode(page.bytes)
      const html = page.contentType === 'text/html' ? htmlToText(decoded!) : null
      const title = html?.title?.trim() || candidate.hit.title.trim() || new URL(page.url).hostname
      const id = sourceId(title, page.url)
      const document = page.contentType === 'application/pdf'
        ? await extractPdf({ id, title, kind: 'pdf', bytes: page.bytes })
        : extractPlainText({ id, title, kind: 'text', text: html?.text ?? decoded! })
      signal.throwIfAborted()
      diagnostic.extractedLength = document.charCount
      if (document.charCount < 400) throw new SourceFetchError('too_short')
      diagnostic.stage = 'complete'
      diagnostic.outcome = 'accepted'
      return { result: { source: { id, title, origin: 'outside', url: page.url }, document }, diagnostic }
    } catch (cause) {
      let reason = failureReason(cause)
      if (cause instanceof ExtractionError && cause.code === 'empty') reason = 'too_short'
      const transient = /^(empty_response|timeout|fetch_failed|http_429|http_50[0234])$/.test(reason)
      if (attempt === 0 && transient && !signal.aborted) continue
      diagnostic.reason = reason
      return { rejected: { url: candidate.hit.url, reason }, diagnostic }
    }
  }
  throw new Error('unreachable')
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
  const deadline = AbortSignal.timeout(240_000)
  const searchSignal = AbortSignal.any([deadline, AbortSignal.timeout(180_000)])
  const searchResult = await deps.search.search({
    query,
    allowedDomains: searchDomains,
    maxResults: 15,
    signal: searchSignal,
  })

  const rejected: SourcesOutput['rejected'] = []
  const diagnostics: SourceDiagnostic[] = []
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  for (const hit of searchResult.hits.slice(0, 15)) {
    let url: string
    try {
      url = canonicalUrl(hit.url)
    } catch {
      rejected.push({ url: hit.url, reason: 'invalid_url' })
      diagnostics.push({ url: hit.url, stage: 'policy', attempts: 0, outcome: 'rejected', reason: 'invalid_url' })
      continue
    }
    if (!isAllowedUrl(url, policy)) {
      rejected.push({ url: hit.url, reason: 'not_allowlisted' })
      diagnostics.push({ url: hit.url, stage: 'policy', attempts: 0, outcome: 'rejected', reason: 'not_allowlisted' })
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    if (candidates.length < 15) candidates.push({ hit, url })
  }

  const sources: OutsideSource[] = []
  const documents: ExtractedDocument[] = []
  // Batches retain search order, avoid over-fetching, and replace failures.
  for (let index = 0; index < candidates.length && sources.length < maxSources && !deadline.aborted;) {
    const batch = candidates.slice(index, index + Math.min(3, maxSources - sources.length))
    index += batch.length
    const fetched = await Promise.all(batch.map(candidate => fetchCandidate(candidate, policy, deps, deadline)))
    for (const item of fetched) {
      diagnostics.push(item.diagnostic)
      if (item.rejected) rejected.push(item.rejected)
      else if (item.result) {
        sources.push(item.result.source)
        documents.push(item.result.document)
      }
    }
  }

  return {
    sources,
    documents,
    rejected,
    diagnostics,
    summary: { discovered: searchResult.hits.length, attempted: diagnostics.filter(d => d.attempts > 0).length,
      accepted: sources.length, failed: diagnostics.filter(d => d.attempts > 0 && d.outcome === 'rejected').length,
      policyRejected: diagnostics.filter(d => d.stage === 'policy').length },
    usage: searchResult.usage,
    costUsd: estimateCostUsd(searchResult.model, searchResult.usage),
  }
}
