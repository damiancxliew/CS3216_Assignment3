import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { FakeImageService, InMemoryAssetCache, InMemoryAssetStore } from '../src/assets/memory'
import { OpenAiImageService } from '../src/assets/openai-images'
import { assertGeneratable, buildImagePrompt, buildPortraitSafetyRetryPrompt, generateAssets, isCurrentSpriteRecord, pendingManifest, placeholderUrl, playableAssetEligibility, promptHash, resolveAssetUrl } from '../src/assets/service'
import { ImageServiceError } from '../src/assets/types'
import { loadI1Spec } from '../src/fixtures'
import type { AdventureSpec } from '../src/spec/v2'

function deps(mode: ConstructorParameters<typeof FakeImageService>[0] = 'ok') {
  return { images: new FakeImageService(mode), cache: new InMemoryAssetCache(), store: new InMemoryAssetStore() }
}

/** A copy of the fixture with `n` landmark assets (the fixture has 6 entries; rooms give us up to 9). */
async function specWithAssets(n: number): Promise<AdventureSpec> {
  const spec = structuredClone(await loadI1Spec())
  const rooms = spec.stages.flatMap((s) => s.rooms.map((r) => r.id))
  spec.assetEligibility = rooms.slice(0, n).map((room, i) => ({ id: `asset-${i}`, kind: 'landmark' as const, entityId: room, subject: `Landmark ${i}`, prompt: `A view of ${room}` }))
  return spec
}

describe('D5 — asset eligibility at the service boundary (FR-6b)', () => {
  it('uses the precision model only for sprites and keys their cache separately', async () => {
    const images = new OpenAiImageService({ apiKey: 'test-key', model: 'gpt-image-1-mini', spriteModel: 'gpt-image-2.5-sunburst' })
    expect(images.modelForKind('sprite')).toBe('gpt-image-2.5-sunburst')
    for (const kind of ['portrait', 'landmark', 'prop', 'cover'] as const) expect(images.modelForKind(kind)).toBe('gpt-image-1-mini')
    const spec = await loadI1Spec()
    spec.assetEligibility = playableAssetEligibility(spec)
    const manifest = pendingManifest(spec, images)
    for (const entry of spec.assetEligibility) {
      const record = manifest.records.find((item) => item.assetId === entry.id)!
      const model = images.modelForKind(entry.kind)
      const size = entry.kind === 'cover' ? '1536x1024' : '1024x1024'
      expect(record.promptHash).toBe(promptHash({ kind: entry.kind, prompt: buildImagePrompt(entry, spec), size, quality: 'medium' }, model))
    }
  })

  it('generates art for every playable fixture and skips room-only images', async () => {
    const spec = await loadI1Spec()
    const physicalRooms = spec.stages.flatMap((stage) => stage.rooms.filter((room) => room.landmark).map((room) => room.id))
    const emptyRoom = spec.stages.flatMap((stage) => stage.rooms).find((room) => !room.landmark)!
    spec.assetEligibility.push({ id: 'old-room-only-image', kind: 'landmark', entityId: emptyRoom.id, subject: emptyRoom.name, prompt: emptyRoom.purpose })
    const assets = playableAssetEligibility(spec)
    expect(assets.filter((asset) => asset.kind === 'landmark').map((asset) => asset.entityId).sort()).toEqual(physicalRooms.sort())
    expect(assets.some((asset) => asset.id === 'old-room-only-image')).toBe(false)
    expect(assets.filter((asset) => asset.kind === 'landmark').every((asset) => asset.id.length <= 48)).toBe(true)
    expect(assets.filter((asset) => asset.kind === 'sprite')).toHaveLength(spec.stakeholders.length)
  })

  it('uses medium quality for new walking sheets and rejects older sheet layouts', async () => {
    const spec = await loadI1Spec()
    spec.assetEligibility = playableAssetEligibility(spec)
    const sprite = spec.assetEligibility.find((entry) => entry.kind === 'sprite')!
    const current = pendingManifest(spec, new FakeImageService(), 'low').records.find((record) => record.assetId === sprite.id)!
    current.status = 'ready'
    current.model = 'fake-image-model'
    expect(isCurrentSpriteRecord(spec, current)).toBe(true)
    expect(isCurrentSpriteRecord(spec, { ...current, promptHash: 'old-layout' })).toBe(false)
    const images = new FakeImageService()
    await generateAssets({ ...spec, assetEligibility: [sprite] }, { images, cache: new InMemoryAssetCache(), store: new InMemoryAssetStore(), quality: 'low' })
    expect(images.requests[0]?.quality).toBe('medium')
    expect(images.requests[0]?.prompt).toContain('strict POSE AND GRID TEMPLATE')
  })

  it('rejects terrain, structural and UI requests', () => {
    for (const kind of ['terrain', 'tileset', 'wall', 'floor', 'ui', 'icon', 'background']) {
      expect(() => assertGeneratable({ kind })).toThrow(ImageServiceError)
      try {
        assertGeneratable({ kind })
      } catch (error) {
        expect((error as ImageServiceError).code).toBe('not-generatable')
      }
    }
    for (const kind of ['portrait', 'landmark', 'prop', 'sprite', 'cover']) expect(() => assertGeneratable({ kind })).not.toThrow()
  })

  it('never lets an ineligible entry reach the image service even if the spec object was tampered with', async () => {
    const spec = structuredClone(await loadI1Spec())
    ;(spec.assetEligibility[0] as { kind: string }).kind = 'terrain'
    const d = deps()
    const manifest = await generateAssets(spec, d)
    expect(manifest.records[0]).toMatchObject({ status: 'failed', url: '/assets/curated/placeholder-generic.png' })
    expect(manifest.records[0]!.error).toMatch(/curated-only/)
    expect(d.images.requests).toHaveLength(spec.assetEligibility.length - 1)
  })
})

describe('D5 — cache and generation', () => {
  it('generates each eligible asset once, stores it, and records cost', async () => {
    const spec = await loadI1Spec()
    const d = deps()
    const manifest = await generateAssets(spec, d)
    expect(manifest.records).toHaveLength(6)
    expect(manifest.records.every((r) => r.status === 'ready' && r.url.startsWith('memory://assets/adventures/singapore-1819/'))).toBe(true)
    expect(manifest.generatedCount).toBe(6)
    expect(manifest.totalCostUsd).toBeCloseTo(6 * 0.011, 6)
    expect(d.store.objects.size).toBe(6)
    // the planner's brief is embedded as delimited data with our style + audience suffix
    expect(d.images.requests[0]!.prompt).toContain('"""')
    expect(d.images.requests[0]!.prompt).toContain('aged 13-14')
    expect(d.images.requests.find((r) => r.kind === 'landmark')!.size).toBe('1024x1024')
  })

  it('a repeated subject is a cache hit: no second model call, no cost', async () => {
    const spec = await loadI1Spec()
    const d = deps()
    const first = await generateAssets(spec, d)
    const second = await generateAssets(spec, d)
    expect(d.images.requests).toHaveLength(6)
    expect(second.generatedCount).toBe(0)
    expect(second.cacheHits).toBe(6)
    expect(second.totalCostUsd).toBe(0)
    expect(second.records.map((r) => r.url)).toEqual(first.records.map((r) => r.url))
    expect(second.records.every((r) => r.status === 'cached')).toBe(true)
  })

  it('the same subject across two adventures shares the cache when the prompt is identical', async () => {
    const spec = await loadI1Spec()
    const other = structuredClone(spec)
    other.id = 'singapore-1819-copy'
    const d = deps()
    await generateAssets(spec, d)
    const manifest = await generateAssets(other, d)
    expect(manifest.cacheHits).toBe(6)
    expect(d.images.requests).toHaveLength(6)
  })

  it('a changed prompt changes the hash', () => {
    const base = { kind: 'portrait' as const, prompt: 'a', size: '1024x1024' as const, quality: 'medium' as const }
    expect(promptHash(base, 'm')).not.toBe(promptHash({ ...base, prompt: 'b' }, 'm'))
    expect(promptHash(base, 'm')).not.toBe(promptHash(base, 'other-model'))
    expect(promptHash(base, 'm')).toBe(promptHash(base, 'm'))
  })

  it('generates every eligible image beyond the former eight-image limit', async () => {
    const spec = await specWithAssets(9)
    expect(spec.assetEligibility).toHaveLength(9)
    const d = deps()
    const manifest = await generateAssets(spec, d)
    expect(d.images.requests).toHaveLength(9)
    expect(manifest.generatedCount).toBe(9)
    expect(manifest.records.every((record) => record.status === 'ready')).toBe(true)
  })

  it('generates images concurrently with at most four requests in flight', async () => {
    const spec = await specWithAssets(9)
    let active = 0
    let peak = 0
    const images = {
      model: 'concurrency-test',
      async generate() {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { bytes: new Uint8Array([1]), mimeType: 'image/png' as const, model: 'concurrency-test', costUsd: 0 }
      },
    }
    const manifest = await generateAssets(spec, { ...deps(), images })
    expect(peak).toBe(4)
    expect(manifest.records.every((record) => record.status === 'ready')).toBe(true)
  })

  it('reuses cached images while generating every remaining entry', async () => {
    const spec = await specWithAssets(9)
    const d = deps()
    await generateAssets(await specWithAssets(3), d) // warms 3 entries
    const manifest = await generateAssets(spec, d)
    expect(manifest.cacheHits).toBe(3)
    expect(manifest.generatedCount).toBe(6)
    expect(manifest.records.every((r) => r.status === 'ready' || r.status === 'cached')).toBe(true)
  })
})

describe('D5 — failure handling (FR-6a)', () => {
  it('stores a rejected sprite for teacher review while play uses the fallback', async () => {
    const spec = await loadI1Spec()
    spec.assetEligibility = playableAssetEligibility(spec).filter((entry) => entry.kind === 'sprite').slice(0, 1)
    const d = deps()
    const images = {
      model: 'test-image-model',
      async generate() {
        throw new ImageServiceError('failed', 'walking sprite frame 1,1 is empty', {
          bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/webp', costUsd: 0.011,
        })
      },
    }
    const manifest = await generateAssets(spec, { ...d, images })
    const record = manifest.records[0]!
    expect(record.status).toBe('failed')
    expect(record.url).toContain('-rejected.webp')
    expect(record.error).toContain('frame 1,1')
    expect(d.store.objects.size).toBe(1)
    expect(manifest.totalCostUsd).toBe(0.011)
    expect(resolveAssetUrl(manifest, record.entityId, 'sprite')).toBe(record.placeholderUrl)
  })

  it('a failing image service yields placeholders for everything and never throws', async () => {
    const spec = await loadI1Spec()
    const manifest = await generateAssets(spec, deps('fail'))
    expect(manifest.records.every((r) => r.status === 'failed' && r.url === r.placeholderUrl)).toBe(true)
    expect(manifest.totalCostUsd).toBe(0)
    expect(manifest.finishedAt).not.toBeNull()
  })

  it('a content-filtered image is marked filtered and falls back the same way (FR-23)', async () => {
    const spec = await loadI1Spec()
    const manifest = await generateAssets(spec, deps('filter'))
    expect(manifest.records.every((r) => r.status === 'filtered')).toBe(true)
    expect(manifest.records[1]!.url).toBe(placeholderUrl('portrait'))
    expect(resolveAssetUrl(manifest, manifest.records[1]!.entityId, 'portrait')).toBe(placeholderUrl('portrait'))
    expect(resolveAssetUrl(manifest, 'entity-without-asset', 'prop')).toBe(placeholderUrl('prop'))
    expect(resolveAssetUrl(null, 'anything', 'landmark')).toBe(placeholderUrl('landmark'))
  })

  it('retries a filtered portrait once in explicit neutral classroom context', async () => {
    const spec = await loadI1Spec()
    spec.assetEligibility = spec.assetEligibility.filter((entry) => entry.kind === 'portrait').slice(0, 1)
    const d = deps(['filter', 'ok'])
    const manifest = await generateAssets(spec, d)

    expect(manifest.records[0]).toMatchObject({ status: 'ready' })
    expect(d.images.requests).toHaveLength(2)
    expect(d.images.requests[1]!.prompt).toBe(buildPortraitSafetyRetryPrompt(d.images.requests[0]!.prompt))
    expect(d.images.requests[1]!.prompt).toMatch(/Neutral classroom history illustration/)
    expect(d.images.requests[1]!.prompt).toMatch(/Omit uniforms, insignia, flags/)
  })

  it('image prompts carry the setting and never the private context', async () => {
    const spec = await loadI1Spec()
    for (const entry of spec.assetEligibility) {
      const prompt = buildImagePrompt(entry, spec)
      expect(prompt).toContain(spec.setting)
      expect(prompt).not.toMatch(/hiddenInterests|knowledgeHorizon|motivations/)
    }
  })

  it('generates map objects in the same pixel style and palette as their stage', async () => {
    const spec = await loadI1Spec()
    spec.stages[0]!.mapTheme = 'winter'
    const room = spec.stages[0]!.rooms[0]!
    const prompt = buildImagePrompt({ id: 'winter-object', kind: 'landmark', entityId: room.id, subject: 'Old monument', prompt: 'A weathered monument' }, spec)
    expect(prompt).toMatch(/32x32 pixel-art tile sheet/)
    expect(prompt).toMatch(/four 16x16 terrain tiles/)
    expect(prompt).toMatch(/transparent background/)
    expect(prompt).toMatch(/snow white, pale blue-gray, dark timber/)
    expect(prompt).toMatch(/no scene, ground plane, frame/)
  })

  it('derives one adventure cover, listed first, and never duplicates it', async () => {
    const spec = await loadI1Spec()
    const assets = playableAssetEligibility(spec)
    const covers = assets.filter((asset) => asset.kind === 'cover')
    expect(covers).toHaveLength(1)
    const cover = covers[0]!
    expect(assets[0]).toBe(cover)
    expect(cover.entityId).toBe(spec.id)
    expect(cover.id).toBe(`asset-cover-${createHash('sha256').update(spec.id).digest('hex').slice(0, 16)}`)
    expect(cover.id.length).toBeLessThanOrEqual(48)
    expect(cover.prompt).toContain(spec.setting)
    expect(cover.prompt).toContain('Places seen in this adventure:')
    expect(cover.prompt.length).toBeLessThanOrEqual(600)
    expect(cover.subject.length).toBeLessThanOrEqual(120)
    // an existing cover entry is kept, not duplicated or reordered
    const withCover = playableAssetEligibility({ ...spec, assetEligibility: [cover, ...spec.assetEligibility] })
    expect(withCover.filter((asset) => asset.kind === 'cover')).toHaveLength(1)
    expect(withCover.findIndex((asset) => asset.kind === 'cover')).toBe(0)
  })

  it('draws the cover wide at medium quality and drops the map-tile scale line', async () => {
    const spec = await loadI1Spec()
    spec.stages[0]!.mapTheme = 'winter'
    const cover = playableAssetEligibility(spec).find((asset) => asset.kind === 'cover')!
    const prompt = buildImagePrompt(cover, spec)
    expect(prompt).toContain('Wide establishing key-art illustration')
    expect(prompt).toContain('snow white, pale blue-gray, dark timber')
    expect(prompt).toContain('map palette')
    expect(prompt).not.toContain('16x16 terrain tiles')
    const images = new FakeImageService()
    await generateAssets({ ...spec, assetEligibility: [cover] }, { images, cache: new InMemoryAssetCache(), store: new InMemoryAssetStore(), quality: 'low' })
    expect(images.requests[0]?.size).toBe('1536x1024')
    expect(images.requests[0]?.quality).toBe('medium')
  })

  it('asks for sober, stakeholder-specific pixel portraits that stay legible on the map', async () => {
    const spec = await loadI1Spec()
    const entry = spec.assetEligibility.find((asset) => asset.kind === 'portrait')!
    const prompt = buildImagePrompt(entry, spec)

    expect(prompt).toMatch(/16-bit pixel art/)
    expect(prompt).toMatch(/subject-specific age, hair, facial hair, clothing and cultural details/)
    expect(prompt).toMatch(/Not cute, chibi, toy-like/)
  })
})
