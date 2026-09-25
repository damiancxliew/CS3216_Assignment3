/**
 * D5 — asset generation (PRD D4, FR-6/FR-6a/FR-6b).
 *
 * Only `spec.assetEligibility[]` entries can reach the image model, and the
 * schema restricts those to portrait | landmark | prop | sprite | cover. This module
 * re-checks at the service boundary (`assertGeneratable`) so a caller that
 * bypasses the spec — the compiler, a teacher "regenerate" button, a test —
 * still cannot request terrain. A prompt-hash cache means a subject reused
 * across stages costs nothing, and every
 * failure resolves to the curated placeholder: the manifest is always complete.
 *
 * `ignoreCache` exists for the teacher's "regenerate" button: it skips the
 * prompt-hash read so a record can be forced to re-draw, but still writes the
 * result back so the next identical subject stays free.
 */
import { createHash, randomUUID } from 'node:crypto'

import { CURATED_PLACEHOLDERS, GENERATABLE_ASSET_KINDS, GENERIC_PLACEHOLDER, type GeneratableAssetKind } from '../spec/catalogue'
import type { AdventureSpec, AssetEligibility } from '../spec/v2'
import { type AssetCache, type AssetManifest, type AssetRecord, type AssetStore, type ImageRequest, type ImageService, ImageServiceError } from './types'

/** Version the style suffix: changing it changes every prompt hash, which is what you want. */
export const ASSET_STYLE_VERSION = 'style-v4-playable-32px-landmark-tiles'

const STYLE: Record<GeneratableAssetKind, string> = {
  portrait: [
    'Serious, historically grounded head-and-shoulders character portrait for an educational game.',
    'Crisp hand-authored 16-bit pixel art with a limited muted period palette and a strong silhouette.',
    'Preserve the subject-specific age, hair, facial hair, clothing and cultural details supplied in the description.',
    'Centered frontal or slight three-quarter pose, reserved neutral expression, plain charcoal background, no text and no frame.',
    'Not cute, chibi, toy-like, anime, caricatured, smiling or heroic.',
  ].join(' '),
  landmark: 'A game-ready 32x32 pixel-art tile sheet of one solid physical landmark, occupying exactly two 16x16 map tiles in each direction. Draw one complete object centered in the square on a transparent background with a transparent margin of at most two pixels. Three-quarter top-down view matching hand-authored 16-bit game tiles: deliberate hard square pixel edges, strong readable silhouette, no antialiasing, no soft lighting, no gradients, and a limited muted palette of at most 16 colors. Show only the object, with no scene, ground plane, frame, placard, UI, text, characters, shadow outside the footprint, or painterly texture. The image will be reduced to 32x32 pixels and cut into four 16x16 terrain tiles.',
  prop: 'Single small physical object for a top-down 16px pixel-art game map. Three-quarter top-down view, crisp square pixels, simple readable silhouette, limited muted palette, transparent background. No scene, ground plane, frame, UI, text, characters, gradients or painterly texture.',
  cover: 'Wide establishing key-art illustration of the historical setting, for the cover of an educational adventure. Hand-authored 16-bit pixel art in the same visual family as the game maps: crisp square pixels, hard edges, a limited muted period palette, no antialiasing, and no painterly or photographic rendering. Compose one readable wide scene of the place — period architecture, terrain, sky and weather — seen from a slightly elevated three-quarter vantage point, with distinct foreground, midground and background layers. Any people are small, distant and incidental. No close-up faces or portraits, no text, lettering, titles, captions, logos, banners, flags, insignia, frames, borders, vignettes, UI, watermarks or modern objects. The card crops the image to a wide strip, so keep the important detail near the centre and away from the extreme edges.',
  sprite: 'Edit the attached grayscale walking sprite sheet into ONE new full-body character for a 16-bit top-down pixel-art game. Use the reference as a strict POSE AND GRID TEMPLATE, not as the character identity: colorize and change the hair, face, skin tone, clothing and accessories to match the described person. Preserve the exact four-by-four cell layout and the same pose silhouette in each corresponding cell. Do not redraw, rotate, shift, enlarge, or crop any pose silhouette. COLUMNS are facing directions: column 1 faces the viewer (down), column 2 shows the BACK OF THE HEAD and back of clothing (up), column 3 faces left in profile, column 4 faces right in profile. ROWS are walking phases: standing, left foot forward, standing, right foot forward. The four frames in each column must always face the same direction; only limbs move. Keep all sixteen cells aligned and equally sized, with transparent backgrounds and no grid lines. No portraits, photographs, scene, ground, shadow, text, or other characters. The sheet will be reduced to 64x64 pixels, giving each frame exactly 16x16 pixels.',
}

const SIZES: Record<GeneratableAssetKind, ImageRequest['size']> = { portrait: '1024x1024', landmark: '1024x1024', prop: '1024x1024', sprite: '1024x1024', cover: '1536x1024' }

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
  const stage = entry.kind === 'cover'
    ? spec.stages[0]
    : spec.stages.find((candidate) => entry.kind === 'landmark'
      ? candidate.rooms.some((room) => room.id === entry.entityId)
      : entry.kind === 'prop' && candidate.evidence.some((item) => item.id === entry.entityId))
  const mapStyle = entry.kind === 'portrait'
    ? null
    : entry.kind === 'cover'
      ? `Match the ${stage?.mapTheme ?? 'classic'} map palette: ${THEME_PALETTES[stage?.mapTheme ?? 'classic']}.`
      : `Match the ${stage?.mapTheme ?? 'classic'} map tiles: ${THEME_PALETTES[stage?.mapTheme ?? 'classic']}. Keep the object's scale and pixel density consistent with 16x16 terrain tiles.`
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

function imageModel(images: ImageService, kind: GeneratableAssetKind): string {
  return images.modelForKind?.(kind) ?? images.model
}

/** Sprite frames and the wide cover need more detail than the default low quality used for larger artwork. */
export function assetQuality(kind: GeneratableAssetKind, quality: ImageRequest['quality']): ImageRequest['quality'] {
  return (kind === 'sprite' || kind === 'cover') && quality === 'low' ? 'medium' : quality
}

/** Older sprite prompts lacked a pose reference and produced mixed-facing walk cycles. */
export function isCurrentSpriteRecord(spec: AdventureSpec, record: AssetRecord): boolean {
  if (record.kind !== 'sprite' || !record.model) return false
  const entry = playableAssetEligibility(spec).find((asset) => asset.id === record.assetId && asset.kind === 'sprite')
  if (!entry) return false
  const prompt = buildImagePrompt(entry, spec)
  return (['medium', 'high'] as const).some((quality) => record.promptHash === promptHash({ kind: 'sprite', prompt, size: SIZES.sprite, quality }, record.model!))
}

export interface GenerateAssetsOptions {
  images: ImageService
  cache: AssetCache
  store: AssetStore
  quality?: ImageRequest['quality']
  /** Skip the prompt-hash read (regeneration); results are still written to the cache. */
  ignoreCache?: boolean
  /** Called after every record settles, so a UI can show progress. */
  onRecord?: (record: AssetRecord) => void | Promise<void>
}

/** Keep only gameplay-visible image requests and cover every physical fixture,
 * including those omitted by an older planner. Derived ids stay stable across runs. */
export function playableAssetEligibility(spec: AdventureSpec): AssetEligibility[] {
  const rooms = spec.stages.flatMap((stage) => stage.rooms.filter((room) => room.landmark))
  const landmarkRooms = new Set(rooms.map((room) => room.id))
  const eligible = spec.assetEligibility.filter((asset) => asset.kind !== 'landmark' || landmarkRooms.has(asset.entityId))
  const covered = new Set(eligible.filter((asset) => asset.kind === 'landmark').map((asset) => asset.entityId))
  for (const room of rooms) {
    if (covered.has(room.id) || !room.landmark) continue
    eligible.push({
      id: `asset-map-${createHash('sha256').update(room.id).digest('hex').slice(0, 16)}`,
      kind: 'landmark',
      entityId: room.id,
      subject: room.landmark.name,
      prompt: room.landmark.description,
    })
  }
  const spriteStakeholders = new Set(eligible.filter((asset) => asset.kind === 'sprite').map((asset) => asset.entityId))
  for (const stakeholder of spec.stakeholders) {
    if (spriteStakeholders.has(stakeholder.id)) continue
    const portrait = eligible.find((asset) => asset.kind === 'portrait' && asset.entityId === stakeholder.id)
    eligible.push({
      id: `asset-sprite-${createHash('sha256').update(stakeholder.id).digest('hex').slice(0, 16)}`,
      kind: 'sprite',
      entityId: stakeholder.id,
      subject: stakeholder.name,
      prompt: `${stakeholder.role}. ${portrait?.prompt ?? stakeholder.summary.text}`.slice(0, 600),
    })
  }
  // One adventure-level cover, derived like sprites; it leads the list because
  // it is the first image a teacher sees and generation walks the list in order.
  if (!eligible.some((asset) => asset.kind === 'cover')) {
    const places = (spec.stages[0]?.rooms ?? []).slice(0, 4).map((room) => room.landmark?.name ?? room.name)
    eligible.unshift({
      id: `asset-cover-${createHash('sha256').update(spec.id).digest('hex').slice(0, 16)}`,
      kind: 'cover',
      entityId: spec.id,
      subject: spec.title.slice(0, 120),
      prompt: `Wide view of ${spec.setting}.${places.length ? ` Places seen in this adventure: ${places.join(', ')}.` : ''} ${spec.description}`.slice(0, 600),
    })
  }
  return eligible
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
    records: spec.assetEligibility.map((entry) => initialRecord(entry, promptHash({ kind: entry.kind, prompt: buildImagePrompt(entry, spec), size: SIZES[entry.kind], quality: assetQuality(entry.kind, quality) }, imageModel(images, entry.kind)))),
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
 * ends as ready | cached | failed | filtered, and `url` is always
 * usable. A small pool limits simultaneous image requests.
 */
export async function generateAssets(spec: AdventureSpec, options: GenerateAssetsOptions, manifest?: AssetManifest): Promise<AssetManifest> {
  const quality = options.quality ?? 'medium'
  const currentManifest = manifest ?? pendingManifest(spec, options.images, quality)

  let nextIndex = 0
  const generateOne = async (index: number) => {
    const entry = spec.assetEligibility[index]!
    const record = currentManifest.records[index]!
    // A redraw needs a new public URL: browsers and the storage CDN may cache
    // the previous image even when an upload overwrites the same object key.
    const storageKey = `adventures/${spec.id}/${entry.id}-${record.promptHash.slice(0, 12)}${options.ignoreCache ? `-${randomUUID()}` : ''}`
    try {
      assertGeneratable(entry)
      const request: ImageRequest = { kind: entry.kind, prompt: buildImagePrompt(entry, spec), size: SIZES[entry.kind], quality: assetQuality(entry.kind, quality) }
      const cached = options.ignoreCache ? null : await options.cache.get(record.promptHash)
      if (cached) {
        Object.assign(record, { status: 'cached', url: cached.url, model: cached.model })
        currentManifest.cacheHits += 1
      } else {
        currentManifest.generatedCount += 1
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
        const url = await options.store.put(`${storageKey}.${result.mimeType.split('/')[1]}`, result.bytes, result.mimeType)
        await options.cache.put(record.promptHash, { url, model: result.model })
        Object.assign(record, { status: 'ready', url, model: result.model, costUsd: result.costUsd })
        currentManifest.totalCostUsd += result.costUsd
      }
    } catch (error) {
      const code = error instanceof ImageServiceError ? error.code : 'failed'
      let rejectedUrl: string | null = null
      if (error instanceof ImageServiceError && error.rejectedImage) {
        const image = error.rejectedImage
        currentManifest.totalCostUsd += image.costUsd
        record.costUsd = image.costUsd
        record.model = imageModel(options.images, entry.kind)
        try {
          rejectedUrl = await options.store.put(`${storageKey}-rejected.${image.mimeType.split('/')[1]}`, image.bytes, image.mimeType)
        } catch (uploadError) {
          // Preserve the validation error even if the diagnostic upload fails.
          record.error = `Could not save rejected image: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`
        }
      }
      Object.assign(record, {
        status: code === 'content-filtered' ? 'filtered' : 'failed',
        url: rejectedUrl ?? record.placeholderUrl,
        error: [error instanceof Error ? error.message : String(error), record.error].filter(Boolean).join(' · '),
      })
    }
    await options.onRecord?.(record)
  }
  const workers = Array.from({ length: Math.min(4, spec.assetEligibility.length) }, async () => {
    while (nextIndex < spec.assetEligibility.length) {
      const index = nextIndex++
      await generateOne(index)
    }
  })
  await Promise.all(workers)
  currentManifest.finishedAt = new Date().toISOString()
  return currentManifest
}

/** What the client shows for an entity right now: generated if ready/cached, else the placeholder. */
export function resolveAssetUrl(manifest: AssetManifest | null, entityId: string, fallbackKind: GeneratableAssetKind): string {
  const record = manifest?.records.find((r) => r.entityId === entityId && r.kind === fallbackKind)
  if (record && (record.status === 'ready' || record.status === 'cached')) return record.url
  return record?.placeholderUrl ?? placeholderUrl(fallbackKind)
}
