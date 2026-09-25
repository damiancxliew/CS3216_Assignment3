import type { GeneratableAssetKind } from '../spec/catalogue'
import type { CutsceneScene } from './scene'

export type AssetStatus = 'pending' | 'ready' | 'cached' | 'failed' | 'filtered' | 'skipped-cap'

/** One entry of the asset manifest: what the client should show for an entity. */
export interface AssetRecord {
  assetId: string
  entityId: string
  kind: GeneratableAssetKind
  status: AssetStatus
  /** Generated image when ready; a rejected image may be stored here for teacher review. */
  url: string
  placeholderUrl: string
  promptHash: string
  model: string | null
  costUsd: number
  error: string | null
  /** For a stage opening: what in the painting moves and sounds, once it has been read. */
  scene?: CutsceneScene | null
}

export interface AssetManifest {
  adventureId: string
  specVersion: number
  records: AssetRecord[]
  /** Images actually requested from the model in this run (cache hits excluded). */
  generatedCount: number
  cacheHits: number
  totalCostUsd: number
  startedAt: string
  finishedAt: string | null
}

export interface ImageRequest {
  kind: GeneratableAssetKind
  prompt: string
  size: '1024x1024' | '1024x1536' | '1536x1024'
  quality: 'low' | 'medium' | 'high'
}

export interface ImageResult {
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg'
  model: string
  costUsd: number
}

export class ImageServiceError extends Error {
  constructor(
    readonly code: 'content-filtered' | 'failed' | 'not-generatable',
    message: string,
    readonly rejectedImage?: { bytes: Uint8Array; mimeType: ImageResult['mimeType']; costUsd: number },
  ) {
    super(message)
    this.name = 'ImageServiceError'
  }
}

export interface ImageService {
  readonly model: string
  modelForKind?(kind: GeneratableAssetKind): string
  generate(request: ImageRequest): Promise<ImageResult>
}

/** Prompt-hash cache (FR-6). Backed by Supabase later; in-memory in tests. */
export interface AssetCache {
  get(promptHash: string): Promise<CachedAsset | null>
  put(promptHash: string, value: CachedAsset): Promise<void>
}

export type CachedAsset = { url: string; model: string; scene?: CutsceneScene | null }

/** Where image bytes go (object storage). */
export interface AssetStore {
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<string>
}
