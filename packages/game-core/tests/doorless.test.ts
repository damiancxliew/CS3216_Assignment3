import { describe, expect, it } from 'vitest'
import { settlementFixture } from '../fixtures/settlement.js'
import {
  closeSpatialDoor,
  compileStage,
  projectMap,
  spaceAt,
  validateCompiledStage,
  validateStageLayout,
  walkActorTowardRoom,
} from '../src/index.js'
import type { SpatialState, StageLayoutInput, StageMap } from '../src/types.js'

describe('doorless stage compilation', () => {
  it('preserves layout geometry and default output while assigning a distinct identity', () => {
    const ordinary = compileStage(settlementFixture, 'doorless-seed')
    const explicitDoors = compileStage(settlementFixture, 'doorless-seed', { doors: true })
    const doorless = compileStage(settlementFixture, 'doorless-seed', { doors: false })

    expect(explicitDoors).toEqual(ordinary)
    expect(JSON.stringify(explicitDoors)).toBe(JSON.stringify(ordinary))
    expect(ordinary.map).not.toHaveProperty('doorless')
    expect(doorless.map.doorless).toBe(true)
    expect(doorless.map.id).not.toBe(ordinary.map.id)
    expect(doorless.map.tiles).toEqual(ordinary.map.tiles)
    expect(doorless.map.rooms).toEqual(ordinary.map.rooms)
    expect(doorless.map.doors).toEqual(ordinary.map.doors)
    expect(doorless.placements).toEqual(ordinary.placements)
    expect(projectMap(doorless).doorless).toBe(true)
    expect(Object.values(doorless.initialDoors).every((state) => state === 'open')).toBe(true)
  })

  it('allows a null enclosed-room default only for doorless compilation', () => {
    const input: StageLayoutInput = {
      ...settlementFixture,
      rooms: settlementFixture.rooms.map((room, index) => index === 0 ? { ...room, doorDefault: null } : room),
    }

    expect(validateStageLayout(input).valid).toBe(false)
    expect(validateStageLayout(input, { doors: false }).valid).toBe(true)
    expect(() => compileStage(input, 'doorless-null-seed')).toThrow(/doorDefault/)
    expect(compileStage(input, 'doorless-null-seed', { doors: false }).map.doorless).toBe(true)

    const openLocation: StageLayoutInput = {
      ...input,
      rooms: input.rooms.map((room, index) => index === 0 ? { ...room, enclosure: 'open', doorDefault: 'open' } : room),
    }
    expect(validateStageLayout(openLocation, { doors: false }).valid).toBe(false)
  })

  it('rejects closed doors and invalid doorless markers in compiled-stage validation', () => {
    const doorless = compileStage(settlementFixture, 'doorless-validation-seed', { doors: false })
    const firstDoor = doorless.map.doors[0]!
    const closedDoor = {
      ...doorless,
      initialDoors: { ...doorless.initialDoors, [firstDoor.id]: 'closed' as const },
    }
    expect(validateCompiledStage(closedDoor).errors).toContain(
      `initialDoors.${firstDoor.id}: doorless maps keep every doorway open`,
    )

    const invalidMap = { ...doorless.map, doorless: false } as unknown as StageMap
    expect(validateCompiledStage({ ...doorless, map: invalidMap }).errors).toContain('map.doorless: expected true')
  })

  it('does not close a door and walks into an enclosed room without waiting', () => {
    const compiled = compileStage(settlementFixture, 'doorless-walk-seed', { doors: false })
    const door = compiled.map.doors[0]!
    const state: SpatialState = {
      doors: compiled.initialDoors,
      actors: { actor: door.outside },
    }

    expect(closeSpatialDoor(compiled.map, state, door.id)).toBe(state)
    let current = state
    let status: 'moving' | 'arrived' | 'waiting_for_door' | 'unreachable' = 'moving'
    for (let step = 0; step < compiled.map.width * compiled.map.height && status !== 'arrived'; step += 1) {
      const result = walkActorTowardRoom(compiled.map, current, 'actor', door.roomId)
      current = result.state
      status = result.status
      expect(status).not.toBe('waiting_for_door')
    }

    expect(status).toBe('arrived')
    expect(spaceAt(compiled.map, current.actors.actor!)).toEqual({ kind: 'room', roomId: door.roomId })
  })
})
