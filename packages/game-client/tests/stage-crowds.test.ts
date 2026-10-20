import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileStage, isWalkable, roomContains, type StageMap } from '@adventure/game-core'
import { crowdForStage, drillFormation, stageCrowd } from '../src/stage-crowds.js'

describe('public stage crowds', () => {
  it.each([
    ['National Service, Singapore, 1967', 'troops'], ['Recruits at the barracks', 'troops'],
    ['Riots in the city', 'rioters'], ['A riot near the army barracks', 'rioters'],
    ['Police patrol on the quay', 'patrol'], ['Inspectors on duty', 'patrol'],
    ['A quiet treaty negotiation', undefined], ['A tropical harbour', undefined],
  ])('selects a crowd from %s', (context, kind) => {
    expect(stageCrowd(context)?.kind).toBe(kind)
    expect(stageCrowd(context)).toEqual(stageCrowd(context))
  })

  it('keeps v2 and playground populations unchanged unless explicitly enabled', () => {
    expect(crowdForStage({ storyContext: 'riots', roomDescriptions: { street: 'army barracks' } })).toBeNull()
    expect(crowdForStage({ crowdContext: 'Singapore', roomDescriptions: { street: 'Recruits drill here' } })?.kind).toBe('troops')
  })

  it('uses only existing walk sheets and short local flavour', () => {
    for (const context of ['National Service', 'riots', 'police patrol']) {
      const crowd = stageCrowd(context)!
      for (const sprite of crowd.sprites) {
        expect(existsSync(new URL(`../../../apps/web/public/game/ninja/characters/${sprite}/walk.png`, import.meta.url))).toBe(true)
      }
      expect(crowd.lines).toHaveLength(2)
      expect(crowd.lines.every(line => line.length > 0 && line.length < 100)).toBe(true)
    }
  })

  it('gives each crowd a distinct silhouette without sharing character sheets', () => {
    const crowds = ['National Service', 'riots', 'police patrol'].map(context => stageCrowd(context)!)
    for (let i = 0; i < crowds.length; i++) {
      for (let j = i + 1; j < crowds.length; j++) {
        expect(crowds[i]!.sprites.filter(sprite => crowds[j]!.sprites.includes(sprite))).toEqual([])
      }
    }
    expect(crowds[1]!.sprites.length).toBeGreaterThan(1)
  })
})

describe('troop drill geometry', () => {
  const { map } = compileStage({
    stageId: 's', spawnRoomId: 'office', rooms: ['office', 'hall'].map(id => ({ id, size: 'medium', enclosure: 'enclosed', doorDefault: null })),
    placements: [{ id: 'anchor', kind: 'decision', roomId: 'office' }],
  }, 'drill', { doors: false })

  it('keeps six soldiers outdoors and in formation on every step, including turns', () => {
    const lanes = drillFormation(map)!
    expect(lanes).not.toBeNull()
    expect(lanes).toHaveLength(6)
    for (let frame = 0; frame < 6; frame++) {
      const positions = lanes.map(lane => lane[frame]!)
      expect(new Set(positions.map(p => `${p.x},${p.y}`)).size).toBe(6)
      for (const [i, at] of positions.entries()) {
        expect(isWalkable(map, {}, at)).toBe(true)
        expect(map.rooms.some(room => roomContains(room, at))).toBe(false)
        const next = lanes[i]![(frame + 1) % 6]!
        expect(Math.abs(at.x - next.x) + Math.abs(at.y - next.y)).toBe(1)
        expect(at.x - positions[0]!.x).toBe(i % 3)
        expect(at.y - positions[0]!.y).toBe(Math.floor(i / 3) * 2)
      }
    }
  })

  it('falls back safely when there is no drill lane', () => {
    const blocked: StageMap = { ...map, tiles: map.tiles.map(row => row.map(() => 'wall')) }
    expect(drillFormation(blocked)).toBeNull()
  })
})
