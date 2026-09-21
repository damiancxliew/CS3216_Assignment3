/** OpenAI image model adapter (PRD D14). Server-side only. */
import OpenAI, { APIError } from 'openai'

import { type ImageRequest, type ImageResult, type ImageService, ImageServiceError } from './types'

/** USD per image (developers.openai.com/api/docs/models/gpt-image-1-mini, read 20 Sep 2026). */
export const IMAGE_PRICING: Record<string, Record<ImageRequest['quality'], Record<ImageRequest['size'], number>>> = {
  'gpt-image-1-mini': {
    low: { '1024x1024': 0.005, '1024x1536': 0.006, '1536x1024': 0.006 },
    medium: { '1024x1024': 0.011, '1024x1536': 0.015, '1536x1024': 0.015 },
    high: { '1024x1024': 0.036, '1024x1536': 0.052, '1536x1024': 0.052 },
  },
  'gpt-image-1.5': {
    low: { '1024x1024': 0.009, '1024x1536': 0.013, '1536x1024': 0.013 },
    medium: { '1024x1024': 0.034, '1024x1536': 0.05, '1536x1024': 0.05 },
    high: { '1024x1024': 0.133, '1024x1536': 0.2, '1536x1024': 0.2 },
  },
}

export class OpenAiImageService implements ImageService {
  readonly model: string
  private readonly client: OpenAI

  constructor(options: { apiKey?: string; model?: string; timeoutMs?: number } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    this.client = new OpenAI({ apiKey, timeout: options.timeoutMs ?? 120_000, maxRetries: 1 })
    this.model = options.model ?? process.env.LLM_MODEL_IMAGE ?? 'gpt-image-1-mini'
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    let response
    try {
      response = await this.client.images.generate({
        model: this.model,
        prompt: request.prompt,
        size: request.size,
        quality: request.quality,
        output_format: 'webp',
        n: 1,
      })
    } catch (error) {
      if (error instanceof APIError && (error.code === 'moderation_blocked' || error.code === 'content_policy_violation' || /safety|moderation|content policy/i.test(error.message))) {
        throw new ImageServiceError('content-filtered', error.message)
      }
      throw new ImageServiceError('failed', error instanceof Error ? error.message : String(error))
    }
    const b64 = response.data?.[0]?.b64_json
    if (!b64) throw new ImageServiceError('failed', 'image response contained no data')
    return {
      bytes: new Uint8Array(Buffer.from(b64, 'base64')),
      mimeType: 'image/webp',
      model: this.model,
      costUsd: IMAGE_PRICING[this.model]?.[request.quality][request.size] ?? 0,
    }
  }
}
