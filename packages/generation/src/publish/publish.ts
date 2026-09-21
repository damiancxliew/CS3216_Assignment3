/**
 * D6 — publish is never blocked by images (FR-6a).
 *
 * `publishAdventure` validates the spec (an invalid spec is never published,
 * FR-4), freezes it, and returns synchronously with an asset manifest in which
 * every entry is `pending` and already resolves to its curated placeholder.
 * Image generation runs afterwards and fills the same manifest in place; the
 * adventure is playable the whole time. Persisting the frozen version is
 * Damian's P4 — this module hands him the frozen object and the manifest.
 */
import { type GenerateAssetsOptions, generateAssets, pendingManifest } from '../assets/service'
import type { AssetManifest } from '../assets/types'
import { type AdventureSpec, type SpecIssue, validateAdventureSpec } from '../spec/v2'

export class PublishError extends Error {
  constructor(readonly issues: SpecIssue[]) {
    super(`spec is invalid and cannot be published (${issues.length} issue${issues.length === 1 ? '' : 's'})`)
    this.name = 'PublishError'
  }
}

export interface PublishedAdventure {
  /** Deep-frozen: a published version is immutable (FR-5). */
  spec: Readonly<AdventureSpec>
  publishedAt: string
  /** Live manifest: starts all-pending, updated in place as images settle. */
  assets: AssetManifest
  /** Resolves when every image has settled (ready/cached/failed/filtered). Nobody has to await it. */
  assetsReady: Promise<AssetManifest>
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

export function publishAdventure(candidate: unknown, options: GenerateAssetsOptions): PublishedAdventure {
  const validation = validateAdventureSpec(candidate)
  if (!validation.ok) throw new PublishError(validation.issues)
  const spec = deepFreeze(structuredClone(validation.spec))
  const assets = pendingManifest(spec, options.images, options.quality)
  const assetsReady = generateAssets(spec, options, assets).catch((error: unknown) => {
    // generateAssets already downgrades per-image failures; this only guards the loop itself.
    for (const record of assets.records) {
      if (record.status === 'pending') Object.assign(record, { status: 'failed', url: record.placeholderUrl, error: error instanceof Error ? error.message : String(error) })
    }
    assets.finishedAt = new Date().toISOString()
    return assets
  })
  return { spec, publishedAt: new Date().toISOString(), assets, assetsReady }
}
