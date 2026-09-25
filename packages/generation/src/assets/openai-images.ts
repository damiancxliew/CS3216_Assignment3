/** OpenAI image model adapter (PRD D14). Server-side only. */
import OpenAI, { APIError, toFile } from 'openai'
import sharp from 'sharp'

import { WALKING_SHEET_REFERENCE } from './sprite-reference'
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

const referenceSheet = sharp(Buffer.from(WALKING_SHEET_REFERENCE, 'base64'))
  .greyscale().resize(1024, 1024, { kernel: 'nearest' }).png().toBuffer()
const referencePixels = sharp(Buffer.from(WALKING_SHEET_REFERENCE, 'base64'))
  .ensureAlpha().raw().toBuffer()

/** The model draws all poses together. Crop each cell before reducing it so
 * no frame can borrow pixels from its neighbour. Reject unusable sheets. */
export async function normalizeWalkingSpriteSheet(bytes: Uint8Array): Promise<Uint8Array> {
  const source = sharp(bytes)
  const metadata = await source.metadata()
  if (!metadata.width || !metadata.height || metadata.width !== metadata.height || metadata.width % 4 !== 0) {
    throw new Error('walking sprite sheet must be square with a 4 by 4 grid')
  }
  const cellSize = metadata.width / 4
  const output = Buffer.alloc(64 * 64 * 4)
  const reference = await referencePixels
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const frame = await sharp(bytes).extract({ left: column * cellSize, top: row * cellSize, width: cellSize, height: cellSize })
        .resize(16, 16, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer()
      let occupied = 0
      let maskIntersection = 0
      let maskUnion = 0
      for (let pixel = 0; pixel < 256; pixel += 1) {
        const visible = frame[pixel * 4 + 3]! > 32
        const referenceAt = ((row * 16 + Math.floor(pixel / 16)) * 64 + column * 16 + pixel % 16) * 4
        const referenceVisible = reference[referenceAt + 3]! > 32
        if (visible) occupied += 1
        if (visible && referenceVisible) maskIntersection += 1
        if (visible || referenceVisible) maskUnion += 1
        const target = ((row * 16 + Math.floor(pixel / 16)) * 64 + column * 16 + pixel % 16) * 4
        frame.copy(output, target, pixel * 4, pixel * 4 + 4)
      }
      if (occupied < 8 || occupied > 224) throw new Error(`walking sprite frame ${row + 1},${column + 1} is empty or has no transparent margin`)
      // Editing models can return sixteen occupied cells while shifting limbs,
      // clipping frames, or rotating a walker mid-step. The pose reference is
      // the contract the game renderer animates, so enforce it per frame.
      if (maskIntersection / maskUnion < 0.58) throw new Error(`walking sprite frame ${row + 1},${column + 1} does not match the pose template`)
    }
  }
  // Reject only clear row-major direction layouts. Walking poses can differ
  // substantially, so a close ratio is not reliable evidence of a bad sheet.
  let acrossDirections = 0
  let acrossSteps = 0
  for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) {
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
      const at = ((row * 16 + y) * 64 + column * 16 + x) * 4
      if (column < 3) {
        const next = at + 16 * 4
        for (let channel = 0; channel < 4; channel += 1) acrossDirections += Math.abs(output[at + channel]! - output[next + channel]!)
      }
      if (row < 3) {
        const next = at + 16 * 64 * 4
        for (let channel = 0; channel < 4; channel += 1) acrossSteps += Math.abs(output[at + channel]! - output[next + channel]!)
      }
    }
  }
  if (acrossSteps > 0 && acrossDirections < acrossSteps * 0.2) {
    throw new Error('walking sprite sheet appears to mix directions into the animation frames')
  }
  return new Uint8Array(await sharp(output, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer())
}

export class OpenAiImageService implements ImageService {
  readonly model: string
  readonly spriteModel: string
  private readonly client: OpenAI

  constructor(options: { apiKey?: string; model?: string; spriteModel?: string; timeoutMs?: number } = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    this.client = new OpenAI({ apiKey, timeout: options.timeoutMs ?? 120_000, maxRetries: 1 })
    this.model = options.model ?? process.env.LLM_MODEL_IMAGE ?? 'gpt-image-1-mini'
    this.spriteModel = options.spriteModel ?? process.env.LLM_MODEL_SPRITE ?? 'gpt-image-2.5-sunburst'
  }

  modelForKind(kind: ImageRequest['kind']): string {
    return kind === 'sprite' ? this.spriteModel : this.model
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    let response
    try {
      response = request.kind === 'sprite'
        ? await this.client.images.edit({
          model: this.spriteModel,
          image: await toFile(await referenceSheet, 'walking-sheet-reference.png', { type: 'image/png' }),
          prompt: request.prompt,
          size: request.size,
          quality: request.quality,
          output_format: 'webp',
          background: 'transparent',
          n: 1,
        })
        : await this.client.images.generate({
          model: this.model,
          prompt: request.prompt,
          size: request.size,
          quality: request.quality,
          output_format: 'webp',
          background: request.kind === 'portrait' || request.kind === 'cover' ? 'opaque' : 'transparent',
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
    const model = this.modelForKind(request.kind)
    const usage = response.usage
    const costUsd = model.startsWith('gpt-image-2.5-') && usage
      ? (usage.input_tokens_details.image_tokens * 8 + usage.input_tokens_details.text_tokens * 5 + usage.output_tokens * 30) / 1_000_000
      : IMAGE_PRICING[model]?.[request.quality][request.size] ?? 0
    if (request.kind === 'sprite') {
      try {
        const sheet = await normalizeWalkingSpriteSheet(Buffer.from(b64, 'base64'))
        return {
          bytes: new Uint8Array(sheet),
          mimeType: 'image/png',
          model,
          costUsd,
        }
      } catch (error) {
        throw new ImageServiceError('failed', error instanceof Error ? error.message : String(error), {
          bytes: new Uint8Array(Buffer.from(b64, 'base64')),
          mimeType: 'image/webp',
          costUsd,
        })
      }
    }
    return {
      bytes: new Uint8Array(Buffer.from(b64, 'base64')),
      mimeType: 'image/webp',
      model,
      costUsd,
    }
  }
}
