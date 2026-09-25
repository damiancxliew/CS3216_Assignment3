/**
 * In-memory implementations of the asset interfaces: used by tests, the eval
 * harness and as the stand-in until the Supabase-backed versions land (P1).
 */
import type { CutsceneScene, SceneAnnotator } from './scene'
import { type AssetCache, type AssetStore, type CachedAsset, type ImageRequest, type ImageResult, type ImageService, ImageServiceError } from './types'

export class InMemoryAssetCache implements AssetCache {
  readonly entries = new Map<string, CachedAsset>()
  async get(promptHash: string) {
    return this.entries.get(promptHash) ?? null
  }
  async put(promptHash: string, value: CachedAsset) {
    this.entries.set(promptHash, value)
  }
}

/** A lit interior with a view of rain: one of everything the play view animates. */
export const FAKE_SCENE: CutsceneScene = {
  mood: 'tense',
  weather: 'rain',
  wind: 'breeze',
  openAir: [{ x: 0.35, y: 0.1 }, { x: 0.85, y: 0.1 }, { x: 0.85, y: 0.7 }, { x: 0.35, y: 0.7 }],
  flames: [{ kind: 'oil-lamp', x: 0.2, y: 0.66, width: 0.02, height: 0.05 }],
  firelit: true,
  smoke: [],
  crowd: false,
}

export class FakeSceneAnnotator implements SceneAnnotator {
  readonly requests: { mimeType: string; framing: string }[] = []
  constructor(private readonly mode: 'ok' | 'fail' = 'ok', readonly costPerScene = 0.002) {}
  async describe(image: { bytes: Uint8Array; mimeType: string }, framing: string) {
    this.requests.push({ mimeType: image.mimeType, framing })
    if (this.mode === 'fail') throw new Error('fake scene reader is down')
    return { scene: FAKE_SCENE, costUsd: this.costPerScene }
  }
}

export class InMemoryAssetStore implements AssetStore {
  readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>()
  constructor(private readonly baseUrl = 'memory://assets/') {}
  async put(key: string, bytes: Uint8Array, mimeType: string) {
    this.objects.set(key, { bytes, mimeType })
    return `${this.baseUrl}${key}`
  }
}

export type FakeImageMode = 'ok' | 'fail' | 'filter' | 'hang'

/**
 * Scripted image service. `mode` can be a single behaviour or a per-call list;
 * every request is recorded so tests can count real generations vs cache hits.
 */
export class FakeImageService implements ImageService {
  readonly model = 'fake-image-model'
  readonly requests: ImageRequest[] = []
  private readonly modes: FakeImageMode[]

  constructor(mode: FakeImageMode | FakeImageMode[] = 'ok', readonly costPerImage = 0.011) {
    this.modes = Array.isArray(mode) ? [...mode] : [mode]
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    this.requests.push(request)
    const mode = this.modes.length > 1 ? (this.modes.shift() ?? 'ok') : this.modes[0]!
    switch (mode) {
      case 'fail':
        throw new ImageServiceError('failed', 'fake image service is down')
      case 'filter':
        throw new ImageServiceError('content-filtered', 'fake safety system rejected the prompt')
      case 'hang':
        return new Promise(() => {})
      default:
        return { bytes: new TextEncoder().encode(`png:${request.prompt.slice(0, 32)}`), mimeType: 'image/png', model: this.model, costUsd: this.costPerImage }
    }
  }
}
