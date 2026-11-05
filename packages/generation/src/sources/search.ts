import OpenAI from 'openai'

import { DEFAULT_MODELS, ZERO_USAGE, type LlmUsage } from '../llm/client'
import { toOpenAiStrictSchema } from '../llm/openai'

export interface SearchHit {
  url: string
  title: string
  snippet: string
}

export interface WebSearchClient {
  search(req: {
    query: string
    allowedDomains: string[] | null
    maxResults: number
    signal?: AbortSignal
  }): Promise<{ hits: SearchHit[]; usage: LlmUsage; model: string }>
}

const RESPONSE_SCHEMA = toOpenAiStrictSchema({
  type: 'object',
  properties: {
    hits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          snippet: { type: 'string' },
        },
        required: ['url', 'title', 'snippet'],
        additionalProperties: false,
      },
    },
  },
  required: ['hits'],
  additionalProperties: false,
})

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseHit(value: unknown): SearchHit | null {
  if (!isObject(value) || typeof value.url !== 'string' || !value.url.trim()) return null
  return {
    url: value.url.trim(),
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : value.url.trim(),
    snippet: typeof value.snippet === 'string' ? value.snippet.trim() : '',
  }
}

function responseHits(text: string | null): SearchHit[] {
  if (!text) return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isObject(parsed) || !Array.isArray(parsed.hits)) return []
    return parsed.hits.flatMap((hit) => {
      const result = parseHit(hit)
      return result ? [result] : []
    })
  } catch {
    return []
  }
}

function supplementalHits(output: unknown): SearchHit[] {
  if (!Array.isArray(output)) return []
  const hits: SearchHit[] = []

  const add = (value: unknown): void => {
    const hit = parseHit(value)
    if (hit) hits.push(hit)
  }

  for (const item of output) {
    if (!isObject(item)) continue
    if (item.type === 'web_search_call' && isObject(item.action) && Array.isArray(item.action.sources)) {
      for (const source of item.action.sources) add(source)
    }
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isObject(part) || !Array.isArray(part.annotations)) continue
      for (const annotation of part.annotations) {
        if (isObject(annotation) && annotation.type === 'url_citation') add(annotation)
      }
    }
  }
  return hits
}

function mergeHits(primary: SearchHit[], supplemental: SearchHit[]): SearchHit[] {
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  for (const hit of [...primary, ...supplemental]) {
    const key = hit.url.trim()
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(hit)
  }
  return hits
}

export function createOpenAiWebSearch(opts: {
  apiKey?: string
  model?: string
  client?: OpenAI
} = {}): WebSearchClient {
  const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY
  if (!opts.client && !apiKey) throw new Error('OPENAI_API_KEY is not set')
  const client = opts.client ?? new OpenAI({ apiKey, timeout: 180_000, maxRetries: 0 })
  const model = opts.model ?? DEFAULT_MODELS.cheap

  return {
    async search(req) {
      const prompt = [
        `Find up to ${req.maxResults} primary sources or reputable secondary accounts for this historical episode.`,
        `Episode and context: ${req.query}`,
        'Return concise titles, canonical source URLs, and factual snippets. Do not invent sources or URLs.',
      ].join('\n\n')
      const response = await client.responses.create({
        model,
        input: [{ role: 'user', content: prompt }],
        tools: [{
          type: 'web_search',
          filters: req.allowedDomains ? { allowed_domains: req.allowedDomains } : null,
          search_context_size: 'medium',
        }],
        include: ['web_search_call.action.sources'],
        text: {
          format: {
            type: 'json_schema',
            name: 'source_search_hits',
            schema: RESPONSE_SCHEMA,
            strict: true,
          },
        },
        max_output_tokens: 1_500,
        store: false,
      }, { timeout: 180_000, maxRetries: 0, signal: req.signal })

      const usage = response.usage
      return {
        hits: mergeHits(responseHits(response.output_text), supplementalHits(response.output)),
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0,
        },
        model: response.model,
      }
    },
  }
}

export class FakeWebSearch implements WebSearchClient {
  readonly requests: Array<{ query: string; allowedDomains: string[] | null; maxResults: number }> = []

  constructor(
    private readonly hits: SearchHit[],
    private readonly usage: LlmUsage = ZERO_USAGE,
    private readonly model: string = DEFAULT_MODELS.cheap,
  ) {}

  async search(req: { query: string; allowedDomains: string[] | null; maxResults: number }) {
    this.requests.push({
      ...req,
      allowedDomains: req.allowedDomains ? [...req.allowedDomains] : null,
    })
    return { hits: [...this.hits], usage: { ...this.usage }, model: this.model }
  }
}
