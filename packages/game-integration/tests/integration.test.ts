import { describe, expect, it } from 'vitest'

import { projectMap } from '@adventure/game-core'
import { loadFixtureJson, loadI1Spec } from '@adventure/generation/fixtures'
import { validateAdventureSpec, type AdventureSpec } from '@adventure/generation/spec'

import { compileAdventure, createSpatialStageWorld, toStageLayout } from '../src/index'

async function fixtureJson(): Promise<Record<string, any>> {
  return structuredClone(await loadFixtureJson('singapore-1819.spec.json')) as Record<string, any>
}

function expectSuccessful(value: ReturnType<typeof compileAdventure>) {
  expect(value.ok).toBe(true)
  if (!value.ok) throw new Error(JSON.stringify(value.issues))
  return value
}

describe('spatial integration adapter', () => {
  it('compiles every annotated fixture stage with preserved ids and placements', async () => {
    const spec = await loadI1Spec()
    const result = expectSuccessful(compileAdventure(spec, 'integration-seed'))
    expect(result.stages.map(({ map }) => map.stageId)).toEqual(spec.stages.map(({ id }) => id))
    result.stages.forEach((compiled, stageIndex) => {
      const stage = spec.stages[stageIndex]!
      expect(compiled.placements).toHaveLength(stage.agents.length + stage.evidence.length + 1)
      expect(compiled.placements.map(({ id }) => id).sort()).toEqual([
        ...stage.agents.map(({ id }) => id),
        ...stage.evidence.map(({ id }) => id),
        stage.decision.id,
      ].sort())
      expect(compiled.placements.every(({ position }) => Number.isInteger(position.x) && Number.isInteger(position.y))).toBe(true)
      expect(compiled.map.rooms.map(({ id }) => id).sort()).toEqual(stage.rooms.map(({ id }) => id).sort())
    })
  })

  it('creates a validated spatial world from the compiled stage and runtime seed', async () => {
    const spec = await loadI1Spec()
    const compiled = expectSuccessful(compileAdventure(spec, 'world-seed'))
    const world = createSpatialStageWorld(spec, 0, compiled.stages[0]!)
    expect(world.spatial?.map.stageId).toBe(spec.stages[0]!.id)
    expect(Object.keys(world.spatial?.state.actors ?? {}).sort()).toEqual(['agent-farquhar-s0', 'agent-raffles-s0', 'agent-temenggong-s0', 'player'])
    expect(Object.keys(world.location).sort()).toEqual(['agent-farquhar-s0', 'agent-raffles-s0', 'agent-temenggong-s0', 'player'])
    expect(world.spatial?.targets).toEqual({})
  })

  it('accepts legacy null enclosures in the spec validator but rejects them for spatial compilation', async () => {
    const spec = await fixtureJson()
    spec.stages[0].rooms[1].enclosure = null
    spec.stages[1].rooms[1].enclosure = null
    expect(validateAdventureSpec(spec).ok).toBe(true)
    const result = compileAdventure(spec, 'integration-seed')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.stages.0.rooms.1.enclosure' }))
      expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.stages.1.rooms.1.enclosure' }))
    }

    const missing = await fixtureJson()
    delete missing.stages[1].rooms[1].enclosure
    expect(validateAdventureSpec(missing).ok).toBe(true)
    const missingResult = compileAdventure(missing, 'integration-seed')
    expect(missingResult.ok).toBe(false)
    if (!missingResult.ok) expect(missingResult.issues).toContainEqual(expect.objectContaining({ path: '$.stages.1.rooms.1.enclosure' }))
  })

  it('preserves cross-reference paths and returns invalid seeds as issues', async () => {
    const spec = await fixtureJson()
    spec.stages[0].agents[0].startRoomId = 'missing-room'
    const crossRef = compileAdventure(spec, 'integration-seed')
    expect(crossRef.ok).toBe(false)
    if (!crossRef.ok) expect(crossRef.issues.some(({ path }) => path === '$.stages.0.agents.0.startRoomId')).toBe(true)

    const valid = await loadI1Spec()
    const invalidSeed = compileAdventure(valid, 'bad seed!')
    expect(invalidSeed.ok).toBe(false)
    if (!invalidSeed.ok) {
      expect(invalidSeed.issues[0]?.path).toBe('$.stages.0')
      expect(invalidSeed.issues[0]?.message).toContain('seed')
    }
  })

  it('throws for an invalid stage index and rejects the reserved player id', async () => {
    const spec = await loadI1Spec()
    expect(() => toStageLayout(spec, -1)).toThrow(/no stage -1/)
    expect(() => toStageLayout(spec, spec.stages.length)).toThrow(/no stage/)
    const withPlayer = structuredClone(spec) as AdventureSpec
    withPlayer.stages[0]!.agents[0]!.id = 'player'
    expect(() => toStageLayout(withPlayer, 0)).toThrow(/reserved actor id "player"/)
    const result = compileAdventure(withPlayer, 'integration-seed')
    expect(result.ok).toBe(false)
  })

  it('canonicalizes room and placement ordering without exposing content fields', async () => {
    const spec = await loadI1Spec()
    const reversed = structuredClone(spec) as AdventureSpec
    reversed.stages.forEach((stage) => {
      stage.rooms.reverse()
      stage.agents.reverse()
      stage.evidence.reverse()
    })
    const first = expectSuccessful(compileAdventure(spec, 'order-seed'))
    const second = expectSuccessful(compileAdventure(reversed, 'order-seed'))
    expect(second.stages.map(({ map }) => map)).toEqual(first.stages.map(({ map }) => map))
    for (let index = 0; index < spec.stages.length; index += 1) {
      const layout = toStageLayout(spec, index)
      expect(Object.keys(layout).sort()).toEqual(['landmarks', 'placements', 'rooms', 'spawnRoomId', 'stageId'])
      expect(layout.landmarks?.every((landmark) => Object.keys(landmark).sort().join(',') === 'kind,roomId')).toBe(true)
      expect(layout.rooms.every((room) => Object.keys(room).sort().join(',') === 'doorDefault,enclosure,id,size')).toBe(true)
      expect(layout.placements.every((placement) => Object.keys(placement).sort().join(',') === 'id,kind,roomId')).toBe(true)
      const projected = projectMap(first.stages[index]!)
      expect(projected).not.toHaveProperty('placements')
      expect(JSON.stringify(projected)).not.toContain('privateContext')
      expect(JSON.stringify(layout)).not.toContain('privateContext')
    }
  })

  it('keeps geometry identity independent of private and public prose', async () => {
    const first = await loadI1Spec()
    const snapshot = structuredClone(first)
    const second = structuredClone(first) as AdventureSpec
    second.sharedContext.text = 'A different private and public briefing.'
    second.stages.forEach((stage) => {
      stage.sharedContext.text = 'A different stage briefing.'
      stage.agents.forEach((agent) => {
        agent.publicPosition.text = 'A different public position.'
        agent.privateContext.motivations = 'A different motivation.'
      })
    })
    const firstResult = expectSuccessful(compileAdventure(first, 'privacy-seed'))
    const secondResult = expectSuccessful(compileAdventure(second, 'privacy-seed'))
    expect(secondResult.stages.map(({ map }) => map.id)).toEqual(firstResult.stages.map(({ map }) => map.id))
    expect(secondResult.stages.map(({ map }) => map)).toEqual(firstResult.stages.map(({ map }) => map))
    expect(first).toEqual(snapshot)
  })

  it('is deterministic for every stage over twenty seeds', async () => {
    const spec = await loadI1Spec()
    for (let index = 0; index < 20; index += 1) {
      const first = expectSuccessful(compileAdventure(spec, `integration-${index}`))
      const second = expectSuccessful(compileAdventure(spec, `integration-${index}`))
      expect(second.stages).toEqual(first.stages)
    }
  })
})
