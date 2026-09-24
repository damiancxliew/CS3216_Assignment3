/**
 * Generate the eligible assets of a spec for real and write them to disk.
 *
 *   OPENAI_API_KEY=... npx vite-node scripts/assets.ts fixtures/singapore-1819.spec.json [--quality medium] [--out dir]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { InMemoryAssetCache } from '../src/assets/memory'
import { OpenAiImageService } from '../src/assets/openai-images'
import { generateAssets } from '../src/assets/service'
import type { AssetStore } from '../src/assets/types'
import { validateAdventureSpec } from '../src/spec/v2'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
if (!file) throw new Error('usage: assets.ts <spec.json> [--quality low|medium|high] [--out dir]')
const outDir = flag('out') ?? 'evals/results/manual/assets'
await mkdir(outDir, { recursive: true })

const validation = validateAdventureSpec(JSON.parse(await readFile(file, 'utf8')))
if (!validation.ok) throw new Error(`invalid spec: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`)

const store: AssetStore = {
  async put(key, bytes) {
    const path = join(outDir, key.replace(/[\\/]/g, '_'))
    await writeFile(path, bytes)
    return path
  },
}
const images = new OpenAiImageService()
const started = Date.now()
const manifest = await generateAssets(validation.spec, {
  images,
  cache: new InMemoryAssetCache(),
  store,
  quality: (flag('quality') ?? 'medium') as 'low' | 'medium' | 'high',
  onRecord: (r) => console.log(`${r.status.padEnd(11)} ${r.kind.padEnd(8)} ${r.entityId.padEnd(20)} ${r.url}${r.error ? `  (${r.error})` : ''}`),
})
console.log(`\n${manifest.generatedCount} generated, ${manifest.cacheHits} cached, $${manifest.totalCostUsd.toFixed(3)}, ${((Date.now() - started) / 1000).toFixed(1)}s with ${images.model}`)
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
