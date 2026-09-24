/**
 * D5 — asset generation (PRD D4, FR-6/FR-6a/FR-6b).
 *
 * Only `spec.assetEligibility[]` entries can reach the image model, and the
 * schema already restricts those to portrait | landmark | prop. This module
 * re-checks at the service boundary (`assertGeneratable`) so a caller that
 * bypasses the spec — the compiler, a teacher "regenerate" button, a test —
 * still cannot request terrain. Hard cap of 8 generated images per adventure,
 * prompt-hash cache so a subject reused across stages costs nothing, and every
 * failure resolves to the curated placeholder: the manifest is always complete
 * and publish never waits on it (FR-6a).
 *
 * `ignoreCache` exists for the teacher's "regenerate" button: it skips the
 * prompt-hash read so a record can be forced to re-draw, but still writes the
 * result back so the next identical subject stays free.
 */
import { createHash } from 'node:crypto'

import { CURATED_PLACEHOLDERS, GENERATABLE_ASSET_KINDS, GENERIC_PLACEHOLDER, type GeneratableAssetKind, MAX_GENERATED_ASSETS } from '../spec/catalogue'
import type { AdventureSpec, AssetEligibility } from '../spec/v2'
import { type AssetCache, type AssetManifest, type AssetRecord, type AssetStore, type ImageRequest, type ImageService, ImageServiceError } from './types'

/** Version the style suffix: changing it changes every prompt hash, which is what you want. */
export const ASSET_STYLE_VERSION = 'style-v3-grounded-portraits-map-sprites'

const STYLE: Record<GeneratableAssetKind, string> = {
  portrait: [
    'Serious, historically grounded head-and-shoulders character portrait for an educational game.',
    'Crisp hand-authored 16-bit pixel art with a limited muted period palette and a strong silhouette.',
    'Preserve the subject-specific age, hair, facial hair, clothing and cultural details supplied in the description.',
    'Centered frontal or slight three-quarter pose, reserved neutral expression, plain charcoal background, no text and no frame.',
    'Not cute, chibi, toy-like, anime, caricatured, smiling or heroic.',
  ].join(' '),
  landmark: 'Single physical landmark for a top-down 16px pixel-art game map. Three-quarter top-down view, crisp square pixels, simple readable silhouette, limited muted palette, transparent background. Show only the object, with no scene, ground plane, frame, placard, UI, text, characters, gradients or painterly texture.',
  prop: 'Single small physical object for a top-down 16px pixel-art game map. Three-quarter top-down view, crisp square pixels, simple readable silhouette, limited muted palette, transparent background. No scene, ground plane, frame, UI, text, characters, gradients or painterly texture.',
}

const SIZES: Record<GeneratableAssetKind, ImageRequest['size']> = { portrait: '1024x1024', landmark: '1024x1024', prop: '1024x1024' }

const THEME_PALETTES = {
  classic: 'warm grass green, dark brown wood, cream stone',
  desert: 'sandy ochre, clay brown, sun-faded cream',
  winter: 'snow white, pale blue-gray, dark timber',
  forest: 'moss green, deep leaf green, earthy brown',
  coast: 'sea green, weathered tan, muted blue-gray',
} as const

/** Placeholder url for an entity kind (generic for anything unknown). The curated set is owned by the client bundle. */
export function placeholderUrl(kind: string): string {
  return `/assets/curated/${(CURATED_PLACEHOLDERS as Record<string, string>)[kind] ?? GENERIC_PLACEHOLDER}.png`
}

/** Throws unless the request is for a scene/story-specific entity kind (FR-6b). */
export function assertGeneratable(request: { kind: string }): asserts request is { kind: GeneratableAssetKind } {
  if (!(GENERATABLE_ASSET_KINDS as readonly string[]).includes(request.kind)) {
    throw new ImageServiceError('not-generatable', `asset kind "${request.kind}" is curated-only and cannot be generated (allowed: ${GENERATABLE_ASSET_KINDS.join(', ')})`)
  }
}

/**
 * The prompt sent to the image model. The planner's `prompt` is delimited data
 * (FR-20); the style and audience constraints are ours and come after it.
 */
export function buildImagePrompt(entry: AssetEligibility, spec: AdventureSpec): string {
  const subject = entry.subject.replace(/\s+/g, ' ').trim()
  const brief = entry.prompt.replace(/\s+/g, ' ').trim()
  const stage = spec.stages.find((candidate) => entry.kind === 'landmark'
    ? candidate.rooms.some((room) => room.id === entry.entityId)
    : entry.kind === 'prop' && candidate.evidence.some((item) => item.id === entry.entityId))
  const mapStyle = entry.kind === 'portrait' ? null : `Match the ${stage?.mapTheme ?? 'classic'} map tiles: ${THEME_PALETTES[stage?.mapTheme ?? 'classic']}. Keep the object's scale and pixel density consistent with 16x16 terrain tiles.`
  return [
    `Subject: ${subject}.`,
    `Description (from the adventure author): """${brief}"""`,
    `Setting: ${spec.setting}.`,
    STYLE[entry.kind],
    mapStyle,
    `Suitable for students aged ${spec.readingLevel.ageMin}-${spec.readingLevel.ageMax}: no gore, no nudity, no modern text or logos.`,
  ].filter(Boolean).join(' ')
}

/**
 * A narrowly-scoped second prompt for portraits that the image safety system
 * could not classify from the authored description alone. Historical figures
 * can carry charged offices, uniforms or affiliations; spelling out the
 * neutral classroom context and removing those visual trappings gives the
 * service one safe recovery attempt without changing the requested person or
 * the established portrait style.
 */
export function buildPortraitSafetyRetryPrompt(prompt: string): string {
  return [
    'Neutral classroom history illustration; documentary context only, with no endorsement, glorification, propaganda, or political messaging.',
    prompt,
    'Show only the adult subject in ordinary period-appropriate clothing. Omit uniforms, insignia, flags, symbols, salutes, gestures, weapons, crowds, and text.',
  ].join(' ')
}

export function promptHash(request: Pick<ImageRequest, 'kind' | 'prompt' | 'size' | 'quality'>, model: string): string {
  return createHash('sha256').update([ASSET_STYLE_VERSION, model, request.kind, request.size, request.quality, request.prompt].join('\n')).digest('hex')
}

export interface GenerateAssetsOptions {
  images: ImageService
  cache: AssetCache
  store: AssetStore
  quality?: ImageRequest['quality']
  maxImages?: number
  /** Skip the prompt-hash read (regeneration); results are still written to the cache. */
  ignoreCache?: boolean
  /** Called after every record settles, so a UI can show progress. */
  onRecord?: (record: AssetRecord) => void
}

function initialRecord(entry: AssetEligibility, hash: string): AssetRecord {
  return {
    assetId: entry.id,
    entityId: entry.entityId,
    kind: entry.kind,
    status: 'pending',
    url: placeholderUrl(entry.kind),
    placeholderUrl: placeholderUrl(entry.kind),
    promptHash: hash,
    model: null,
    costUsd: 0,
    error: null,
  }
}

/** A manifest with every entry pending — what publish returns immediately (FR-6a). */
export function pendingManifest(spec: AdventureSpec, images: ImageService, quality: ImageRequest['quality'] = 'medium'): AssetManifest {
  return {
    adventureId: spec.id,
    specVersion: spec.version,
    records: spec.assetEligibility.map((entry) => initialRecord(entry, promptHash({ kind: entry.kind, prompt: buildImagePrompt(entry, spec), size: SIZES[entry.kind], quality }, images.model))),
    generatedCount: 0,
    cacheHits: 0,
    totalCostUsd: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

/**
 * Generate every eligible asset, filling `manifest` in place when one is given
 * (publish hands over its pending manifest). Never throws for a single image: each record
 * ends as ready | cached | failed | filtered | skipped-cap, and `url` is always
 * usable. Sequential on purpose — image endpoints rate-limit per minute.
 */
export async function generateAssets(spec: AdventureSpec, options: GenerateAssetsOptions, manifest?: AssetManifest): Promise<AssetManifest> {
  const quality = options.quality ?? 'medium'
  const maxImages = Math.min(options.maxImages ?? MAX_GENERATED_ASSETS, MAX_GENERATED_ASSETS)
  manifest ??= pendingManifest(spec, options.images, quality)

  for (const [index, entry] of spec.assetEligibility.entries()) {
    const record = manifest.records[index]!
    try {
      assertGeneratable(entry)
      const request: ImageRequest = { kind: entry.kind, prompt: buildImagePrompt(entry, spec), size: SIZES[entry.kind], quality }
      const cached = options.ignoreCache ? null : await options.cache.get(record.promptHash)
      if (cached) {
        Object.assign(record, { status: 'cached', url: cached.url, model: cached.model })
        manifest.cacheHits += 1
      } else if (manifest.generatedCount >= maxImages) {
        Object.assign(record, { status: 'skipped-cap', error: `cap of ${maxImages} generated images reached` })
      } else {
        manifest.generatedCount += 1
        let result
        try {
          result = await options.images.generate(request)
        } catch (error) {
          // A filtered portrait is often recoverable when its neutral,
          // educational use is explicit. Retry once; a second rejection still
          // settles normally as `filtered` and keeps the curated fallback.
          if (!(error instanceof ImageServiceError) || error.code !== 'content-filtered' || entry.kind !== 'portrait') throw error
          result = await options.images.generate({ ...request, prompt: buildPortraitSafetyRetryPrompt(request.prompt) })
        }
        const url = await options.store.put(`adventures/${spec.id}/${entry.id}-${record.promptHash.slice(0, 12)}.${result.mimeType.split('/')[1]}`, result.bytes, result.mimeType)
        await options.cache.put(record.promptHash, { url, model: result.model })
        Object.assign(record, { status: 'ready', url, model: result.model, costUsd: result.costUsd })
        manifest.totalCostUsd += result.costUsd
      }
    } catch (error) {
      const code = error instanceof ImageServiceError ? error.code : 'failed'
      Object.assign(record, {
        status: code === 'content-filtered' ? 'filtered' : 'failed',
        url: record.placeholderUrl,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    options.onRecord?.(record)
  }
  manifest.finishedAt = new Date().toISOString()
  return manifest
}

/** What the client shows for an entity right now: generated if ready/cached, else the placeholder. */
export function resolveAssetUrl(manifest: AssetManifest | null, entityId: string, fallbackKind: GeneratableAssetKind): string {
  const record = manifest?.records.find((r) => r.entityId === entityId)
  if (record && (record.status === 'ready' || record.status === 'cached')) return record.url
  return record?.placeholderUrl ?? placeholderUrl(fallbackKind)
}
