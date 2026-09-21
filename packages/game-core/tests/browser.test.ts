import { build } from 'esbuild'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { compileStage } from '../src/index.js'

const input = {
  stageId: 'browser-stage',
  spawnRoomId: 'hall',
  rooms: [
    { id: 'hall', size: 'medium' as const, doorDefault: 'open' as const },
    { id: 'archive', size: 'small' as const, doorDefault: 'closed' as const },
    { id: 'market', size: 'large' as const, doorDefault: 'open' as const },
  ],
  placements: [
    { id: 'decision', kind: 'decision' as const, roomId: 'hall' },
    { id: 'actor', kind: 'actor' as const, roomId: 'market' },
  ],
}
const reversed = {
  ...input,
  rooms: [...input.rooms].reverse(),
  placements: [...input.placements].reverse(),
}
const distinct = {
  stageId: 'browser-small',
  spawnRoomId: 'market',
  rooms: [
    { id: 'hall', size: 'large' as const, doorDefault: 'open' as const },
    { id: 'market', size: 'small' as const, doorDefault: 'closed' as const },
  ],
  placements: [
    { id: 'decision', kind: 'decision' as const, roomId: 'market' },
    { id: 'actor', kind: 'actor' as const, roomId: 'hall' },
  ],
}

describe('browser parity', () => {
  it('matches Node compilation for reordered inputs and 20 seeds', async () => {
    const bundle = await build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'iife',
      globalName: 'GameCore',
      platform: 'browser',
      target: 'es2022',
      write: false,
    })
    const source = bundle.outputFiles[0]?.text
    expect(source).toBeTruthy()
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: source! })
      for (const variant of [input, reversed, distinct]) {
        for (let index = 0; index < 20; index += 1) {
          const seed = `browser-${index}`
          const nodeArtifact = JSON.stringify(compileStage(variant, seed))
          const browserArtifact = await page.evaluate(
            ({ value, currentSeed }) => {
              const core = (globalThis as unknown as { GameCore: { compileStage: (input: unknown, seed: string) => unknown } }).GameCore
              return JSON.stringify(core.compileStage(value, currentSeed))
            },
            { value: variant, currentSeed: seed },
          )
          expect(browserArtifact).toBe(nodeArtifact)
        }
      }
      const pathResult = await page.evaluate((value) => {
        const core = (globalThis as unknown as {
          GameCore: {
            compileStage: (input: unknown, seed: string) => {
              map: { doors: Array<{ id: string; inside: { x: number; y: number }; outside: { x: number; y: number } }>; }
              initialDoors: Record<string, 'open' | 'closed'>
              playerSpawn: { x: number; y: number }
            }
            findPath: (map: unknown, doors: unknown, from: unknown, to: unknown) => unknown[] | null
          }
        }).GameCore
        const artifact = core.compileStage(value, 'browser-path')
        const door = artifact.map.doors[0]!
        const doors = { ...artifact.initialDoors, [door.id]: 'open' as const }
        return {
          pathLength: core.findPath(artifact.map, doors, door.inside, door.outside)?.length ?? 0,
          same: core.findPath(artifact.map, doors, artifact.playerSpawn, artifact.playerSpawn),
        }
      }, input)
      expect(pathResult.pathLength).toBeGreaterThan(0)
      expect(pathResult.same).toEqual([])
    } finally {
      await browser.close()
    }
  })
})
