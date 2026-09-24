import { describe, expect, it } from 'vitest'

import { FakeImageService, InMemoryAssetCache, InMemoryAssetStore } from '../src/assets/memory'
import { assertGeneratable, buildImagePrompt, buildPortraitSafetyRetryPrompt, generateAssets, placeholderUrl, promptHash, resolveAssetUrl } from '../src/assets/service'
import { ImageServiceError } from '../src/assets/types'
import { loadI1Spec } from '../src/fixtures'
import { MAX_GENERATED_ASSETS } from '../src/spec/catalogue'
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
  it('rejects terrain, structural and UI requests', () => {
    for (const kind of ['terrain', 'tileset', 'wall', 'floor', 'ui', 'icon', 'background']) {
      expect(() => assertGeneratable({ kind })).toThrow(ImageServiceError)
      try {
        assertGeneratable({ kind })
      } catch (error) {
        expect((error as ImageServiceError).code).toBe('not-generatable')
      }
    }
    for (const kind of ['portrait', 'landmark', 'prop']) expect(() => assertGeneratable({ kind })).not.toThrow()
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

describe('D5 — cache and cap', () => {
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

  it('caps generated images at 8 per adventure, even when asked for more', async () => {
    const spec = await specWithAssets(9)
    expect(spec.assetEligibility).toHaveLength(9)
    const d = deps()
    // maxImages above the cap is clamped to it
    const manifest = await generateAssets(spec, { ...d, maxImages: 50 })
    expect(d.images.requests).toHaveLength(MAX_GENERATED_ASSETS)
    expect(manifest.generatedCount).toBe(MAX_GENERATED_ASSETS)
    expect(manifest.records.filter((r) => r.status === 'ready')).toHaveLength(8)
    expect(manifest.records[8]).toMatchObject({ status: 'skipped-cap', url: placeholderUrl('landmark') })
  })

  it('cache hits do not count towards the cap', async () => {
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
  it('a failing image service yields placeholders for everything and never throws', async () => {
    const spec = await loadI1Spec()
    const manifest = await generateAssets(spec, deps('fail'))
    expect(manifest.records.every((r) => r.status === 'failed' && r.url === r.placeholderUrl)).toBe(true)
    expect(manifest.totalCostUsd).toBe(0)
    expect(manifest.finishedAt).not.toBeNull()
  })

  it('a content-filtered image is marked filtered and falls back the same way (FR-23)', async () => {
    const spec = await loadI1Spec()
    const manifest = await generateAssets(spec, deps(['ok', 'filter', 'filter', 'ok', 'fail', 'ok', 'ok']))
    expect(manifest.records.map((r) => r.status)).toEqual(['ready', 'filtered', 'ready', 'failed', 'ready', 'ready'])
    expect(manifest.records[1]!.url).toBe(placeholderUrl('portrait'))
    expect(resolveAssetUrl(manifest, manifest.records[1]!.entityId, 'portrait')).toBe(placeholderUrl('portrait'))
    expect(resolveAssetUrl(manifest, manifest.records[0]!.entityId, 'portrait')).toMatch(/^memory:/)
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
    expect(prompt).toMatch(/16px pixel-art game map/)
    expect(prompt).toMatch(/transparent background/)
    expect(prompt).toMatch(/snow white, pale blue-gray, dark timber/)
    expect(prompt).toMatch(/no scene, ground plane, frame/)
  })
})
