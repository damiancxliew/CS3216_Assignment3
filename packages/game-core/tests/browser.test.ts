import { build } from 'esbuild'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { settlementFixture } from '../fixtures/settlement.js'
import { canHearSpeech, closeSpatialDoor, compileStage, projectActorPositions, walkActorTowardRoom } from '../src/index.js'

type Core = typeof import('../src/index.js')

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
const allOpen = {
  stageId: 'browser-open',
  spawnRoomId: 'grove',
  rooms: [
    { id: 'grove', size: 'medium' as const, enclosure: 'open' as const, doorDefault: null },
    { id: 'plaza', size: 'small' as const, enclosure: 'open' as const, doorDefault: null },
  ],
  placements: [
    { id: 'decision', kind: 'decision' as const, roomId: 'grove' },
    { id: 'actor', kind: 'actor' as const, roomId: 'plaza' },
  ],
}
const mixed = {
  stageId: 'browser-mixed',
  spawnRoomId: 'grove',
  rooms: [
    { id: 'grove', size: 'medium' as const, enclosure: 'open' as const, doorDefault: null },
    { id: 'archive', size: 'small' as const, enclosure: 'enclosed' as const, doorDefault: 'closed' as const },
  ],
  placements: [
    { id: 'decision', kind: 'decision' as const, roomId: 'grove' },
    { id: 'actor', kind: 'actor' as const, roomId: 'archive' },
  ],
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
      for (const variant of [input, reversed, distinct, allOpen, mixed]) {
        for (let index = 0; index < 20; index += 1) {
          const seed = `browser-${index}`
          const nodeArtifact = JSON.stringify(compileStage(variant, seed))
          const browserArtifact = await page.evaluate(
            ({ value, currentSeed }) => {
              const core = (globalThis as unknown as { GameCore: Core }).GameCore
              return JSON.stringify(core.compileStage(value, currentSeed))
            },
            { value: variant, currentSeed: seed },
          )
          expect(browserArtifact).toBe(nodeArtifact)
          const nodeHearing = canHearSpeech(compileStage(variant, seed).map, { x: 1, y: 1 }, { x: 4, y: 1 })
          const browserHearing = await page.evaluate(
            ({ value, currentSeed }) => {
              const core = (globalThis as unknown as { GameCore: Core }).GameCore
              return core.canHearSpeech(core.compileStage(value, currentSeed).map, { x: 1, y: 1 }, { x: 4, y: 1 })
            },
            { value: variant, currentSeed: seed },
          )
          expect(browserHearing).toBe(nodeHearing)
        }
      }
      const pathResult = await page.evaluate((value) => {
        const core = (globalThis as unknown as { GameCore: Core }).GameCore
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

  it('keeps actor door closure, waiting, and public projection in Node/browser parity', async () => {
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
    const compiled = compileStage(settlementFixture, 'fixture-seed')
    const targetDoor = compiled.map.doors[1]!
    const initial = {
      doors: Object.fromEntries(compiled.map.doors.map(({ id }) => [id, 'open' as const])),
      actors: {
        actor: { x: targetDoor.position.x, y: targetDoor.position.y },
        viewer: { x: targetDoor.inside.x, y: targetDoor.inside.y },
      },
    }
    const closed = closeSpatialDoor(compiled.map, initial, targetDoor.id)
    const nodeResult = walkActorTowardRoom(compiled.map, closed, 'actor', targetDoor.roomId)
    const expected = JSON.stringify({
      state: nodeResult.state,
      status: nodeResult.status,
      projection: projectActorPositions(nodeResult.state),
    })
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.setContent('<!doctype html><html><body></body></html>')
      await page.addScriptTag({ content: source! })
      const browserResult = await page.evaluate((value) => {
        const core = (globalThis as unknown as { GameCore: Core }).GameCore
        const artifact = core.compileStage(value, 'fixture-seed')
        const door = artifact.map.doors[1]!
        const initialState = {
          doors: Object.fromEntries(artifact.map.doors.map(({ id }) => [id, 'open' as const])),
          actors: {
            actor: { x: door.position.x, y: door.position.y },
            viewer: { x: door.inside.x, y: door.inside.y },
          },
        }
        const closedState = core.closeSpatialDoor(artifact.map, initialState, door.id)
        const result = core.walkActorTowardRoom(artifact.map, closedState, 'actor', door.roomId)
        return JSON.stringify({ state: result.state, status: result.status, projection: core.projectActorPositions(result.state) })
      }, settlementFixture)
      expect(browserResult).toBe(expected)
    } finally {
      await browser.close()
    }
  })
})
