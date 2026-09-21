/**
 * In-memory implementations of the asset interfaces: used by tests, the eval
 * harness and as the stand-in until the Supabase-backed versions land (P1).
 */
import { type AssetCache, type AssetStore, type ImageRequest, type ImageResult, type ImageService, ImageServiceError } from './types'

export class InMemoryAssetCache implements AssetCache {
  readonly entries = new Map<string, { url: string; model: string }>()
  async get(promptHash: string) {
    return this.entries.get(promptHash) ?? null
  }
  async put(promptHash: string, value: { url: string; model: string }) {
    this.entries.set(promptHash, value)
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
