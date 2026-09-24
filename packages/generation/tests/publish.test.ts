import { describe, expect, it } from 'vitest'

import { FakeImageService, InMemoryAssetCache, InMemoryAssetStore } from '../src/assets/memory'
import { resolveAssetUrl } from '../src/assets/service'
import { loadFixtureJson, loadI1Spec } from '../src/fixtures'
import { chooseByStance, chooseFirst, enumeratePaths, walkthrough } from '../src/play/walkthrough'
import { PublishError, type PublishedAdventure, publishAdventure } from '../src/publish/publish'
import { ASSET_KIND_ENTITY } from '../src/spec/catalogue'
import type { AdventureSpec } from '../src/spec/v2'

function deps(mode: ConstructorParameters<typeof FakeImageService>[0] = 'ok') {
  return { images: new FakeImageService(mode), cache: new InMemoryAssetCache(), store: new InMemoryAssetStore() }
}

/**
 * The D6 proof: play the published adventure from spawn to an ending along
 * every branch, resolving an image for every asset-bearing entity on the way.
 * Every url must be usable (generated or placeholder); nothing may throw.
 */
function playEveryPath(published: PublishedAdventure): { endings: Set<string>; urlsResolved: number } {
  const spec = published.spec
  const endings = new Set<string>()
  let urlsResolved = 0
  const entityKind = new Map(spec.assetEligibility.map((a) => [a.entityId, a.kind]))
  for (const path of enumeratePaths(spec)) {
    const result = walkthrough(spec, (_stage, available, step) => available.find((o) => o.id === path.optionIds[step]) ?? available[0]!)
    expect(result.endingId).toBe(path.endingId)
    endings.add(result.endingId)
    for (const step of result.steps) {
      for (const entity of [...step.roomsVisited, ...step.agentsMet, ...step.evidenceInspected]) {
        const kind = entityKind.get(entity)
        if (!kind) continue
        const url = resolveAssetUrl(published.assets, entity, kind)
        expect(url, `${entity} must resolve to some image`).toMatch(/^(memory:|\/assets\/curated\/)/)
        urlsResolved += 1
      }
      // stakeholders' portraits are looked up through the agent's stakeholderId
      const stage = spec.stages.find((s) => s.id === step.stageId)!
      for (const agent of stage.agents) {
        const url = resolveAssetUrl(published.assets, agent.stakeholderId, 'portrait')
        expect(url).toMatch(/^(memory:|\/assets\/curated\/)/)
        urlsResolved += 1
      }
    }
  }
  return { endings, urlsResolved }
}

describe('spec-level walkthrough (runtime stand-in behind I2/I3)', () => {
  it('completes the fixture from spawn to an ending, visiting rooms in dependency order', async () => {
    const spec = await loadI1Spec()
    const run = walkthrough(spec)
    expect(run.steps).toHaveLength(3)
    expect(run.endingId).toBe('end-free-port')
    const first = run.steps[0]!
    expect(first.roomsVisited[0]).toBe('landing-beach')
    expect(first.objectivesCompleted.indexOf('obj-hear-farquhar')).toBeLessThan(first.objectivesCompleted.indexOf('obj-meet-temenggong'))
    expect(first.roomsVisited.at(-1)).toBe('temenggong-hall') // the decision room
  })

  it('reaches every ending via some path (PRD §9.3)', async () => {
    const spec = await loadI1Spec()
    const paths = enumeratePaths(spec)
    expect(new Set(paths.map((p) => p.endingId))).toEqual(new Set(spec.endings.map((e) => e.id)))
    expect(walkthrough(spec, chooseByStance('antagonistic')).endingId).toBe('end-forced-landing')
    expect(walkthrough(spec, chooseFirst).endingId).not.toBe(walkthrough(spec, chooseByStance('antagonistic')).endingId)
  })

  it('fails loudly on a spec that cannot be completed', async () => {
    const spec = structuredClone(await loadI1Spec())
    spec.stages[0]!.decision.options.forEach((o) => (o.preconditions = ['obj-never']))
    expect(() => walkthrough(spec)).toThrow(/no decision option is available/)
  })
})

describe('D6 — publish never blocks on images (FR-6a)', () => {
  it('refuses to publish an invalid spec', async () => {
    const broken = structuredClone(await loadFixtureJson('singapore-1819.spec.json')) as Record<string, unknown>
    delete broken.readingLevel
    expect(() => publishAdventure(broken, deps())).toThrow(PublishError)
  })

  it('returns synchronously with an all-pending manifest and a frozen spec', async () => {
    const published = publishAdventure(await loadI1Spec(), deps('hang')) // images never come back
    expect(published.assets.records).toHaveLength(6)
    expect(published.assets.records.every((r) => r.status === 'pending' && r.url === r.placeholderUrl)).toBe(true)
    expect(Object.isFrozen(published.spec)).toBe(true)
    expect(Object.isFrozen(published.spec.stages[0]!.agents[0]!.privateContext)).toBe(true)
    expect(() => ((published.spec as AdventureSpec).title = 'edited')).toThrow()
    // fully playable while the image service hangs forever
    const { endings, urlsResolved } = playEveryPath(published)
    expect(endings.size).toBe(4)
    expect(urlsResolved).toBeGreaterThan(20)
  })

  it('image service stubbed to FAIL: adventure publishes and every path plays to an ending on placeholders', async () => {
    const d = deps('fail')
    const published = publishAdventure(await loadI1Spec(), d)
    const before = playEveryPath(published)
    expect(before.endings.size).toBe(4)

    const manifest = await published.assetsReady
    expect(manifest).toBe(published.assets) // same object, filled in place
    expect(manifest.records.every((r) => r.status === 'failed' && r.url === r.placeholderUrl)).toBe(true)
    expect(manifest.totalCostUsd).toBe(0)
    expect(d.images.requests).toHaveLength(6) // it did try every image

    const after = playEveryPath(published)
    expect(after.endings.size).toBe(4)
    expect(after.urlsResolved).toBe(before.urlsResolved)
    // every entity that had an asset request resolves to the placeholder of its kind
    for (const record of manifest.records) {
      expect(resolveAssetUrl(manifest, record.entityId, record.kind)).toBe(`/assets/curated/placeholder-${record.kind}.png`)
      expect(ASSET_KIND_ENTITY[record.kind]).toBeDefined()
    }
  })

  it('mixed outcomes: generated images are used where ready, placeholders elsewhere, playthrough unaffected', async () => {
    // The filtered portrait consumes a second filtered response during its
    // neutral classroom-context retry; the remaining entries keep their
    // original mixed outcomes.
    const published = publishAdventure(await loadI1Spec(), deps(['ok', 'filter', 'filter', 'fail', 'ok', 'ok', 'fail']))
    await published.assetsReady
    const statuses = published.assets.records.map((r) => r.status)
    expect(statuses).toEqual(['ready', 'filtered', 'failed', 'ready', 'ready', 'failed'])
    expect(resolveAssetUrl(published.assets, 'raffles', 'portrait')).toMatch(/^memory:/)
    expect(resolveAssetUrl(published.assets, 'farquhar', 'portrait')).toBe('/assets/curated/placeholder-portrait.png')
    expect(playEveryPath(published).endings.size).toBe(4)
  })
})
