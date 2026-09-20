import { describe, expect, it } from 'vitest'
import {
  chooseDecision,
  createGameState,
  findPath,
  generateMap,
  interact,
  isWalkable,
  movePlayer,
  restoreGameState,
  validateBlueprint,
  validateMap,
  type Blueprint,
  type GameMap,
  type GameState,
  type MapEntity,
  type Point
} from '../src/core'
import { demoBlueprint } from '../src/scenario'

function cloneBlueprint(): Blueprint {
  return structuredClone(demoBlueprint)
}

function cloneMap(map: GameMap): GameMap {
  return structuredClone(map)
}

function adjacent(point: Point): Point[] {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 }
  ]
}

function reachableNeighbor(map: GameMap, entity: MapEntity): { point: Point; path: Point[] } {
  for (const point of adjacent(entity)) {
    const path = findPath(map, map.playerSpawn, point)
    if (path) return { point, path }
  }
  throw new Error(`No reachable neighbor for ${entity.id}`)
}

function followPath(map: GameMap, state: GameState, path: Point[]): GameState {
  return path.reduce((current, point) => movePlayer(map, current, point.x - current.player.x, point.y - current.player.y), state)
}

function completeInvestigation(map: GameMap): GameState {
  let state = createGameState(map)
  state = interact(map, state, 'shortage-notice', { remote: true }).state
  state = interact(map, state, 'mara-venn', { remote: true }).state
  state = interact(map, state, 'elias-reed', { remote: true }).state
  return state
}

describe('blueprint validation', () => {
  it('accepts the authored simulation scenario', () => {
    expect(validateBlueprint(demoBlueprint)).toEqual({ valid: true, errors: [] })
    expect(demoBlueprint.sources.every((source) => source.kind === 'simulation')).toBe(true)
    expect(demoBlueprint.objectives.every((objective) => objective.interactionId !== demoBlueprint.decision.id)).toBe(true)
  })

  it('never throws for malformed values', () => {
    const values: unknown[] = [null, undefined, true, 1, 'blueprint', [], {}, { version: 1 }, { ...demoBlueprint, player: null }]
    for (const value of values) {
      expect(() => validateBlueprint(value)).not.toThrow()
      expect(validateBlueprint(value).valid).toBe(false)
    }
  })

  it('rejects unknown and private fields', () => {
    const withTopLevelExtra = { ...cloneBlueprint(), extra: true }
    const withPrivateNpc = cloneBlueprint() as Blueprint & { npcs: Array<Blueprint['npcs'][number] & { privateKnowledge?: string }> }
    withPrivateNpc.npcs[0]!.privateKnowledge = 'hidden'
    expect(validateBlueprint(withTopLevelExtra).errors).toContain('blueprint.extra is not supported')
    expect(validateBlueprint(withPrivateNpc).errors.some((error) => error.includes('privateKnowledge'))).toBe(true)
  })

  it('enforces counts, bounded strings, safe IDs, and distinct location kinds', () => {
    const bad = cloneBlueprint()
    bad.id = 'Unsafe ID'
    bad.title = 'x'.repeat(121)
    bad.npcs.pop()
    const result = validateBlueprint(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('safe lowercase identifier'))).toBe(true)
    expect(result.errors.some((error) => error.includes('1-120'))).toBe(true)
    expect(result.errors.some((error) => error.includes('2-2 items'))).toBe(true)
    const repeatedKind = cloneBlueprint()
    repeatedKind.locations[2]!.kind = 'market'
    expect(validateBlueprint(repeatedKind).errors.some((error) => error.includes('one market'))).toBe(true)
  })

  it('rejects duplicate IDs and dangling location, source, and interaction references', () => {
    const bad = cloneBlueprint()
    bad.evidence[0]!.id = bad.npcs[0]!.id
    bad.npcs[0]!.locationId = 'missing-location'
    bad.npcs[1]!.sourceIds = ['missing-source']
    bad.objectives[0]!.interactionId = 'missing-interaction'
    const errors = validateBlueprint(bad).errors.join('\n')
    expect(errors).toContain('duplicates identifier')
    expect(errors).toContain('unknown location')
    expect(errors).toContain('unknown source')
    expect(errors).toContain('unknown interaction')
  })

  it('rejects dangling objective dependencies and self-dependencies', () => {
    const dangling = cloneBlueprint()
    dangling.objectives[1]!.requires = ['not-an-objective']
    expect(validateBlueprint(dangling).errors.some((error) => error.includes('unknown objective'))).toBe(true)
    const self = cloneBlueprint()
    self.objectives[0]!.requires = ['inspect-notice']
    expect(validateBlueprint(self).errors.some((error) => error.includes('cannot require itself'))).toBe(true)
  })

  it('rejects objective cycles', () => {
    const bad = cloneBlueprint()
    bad.objectives[0]!.requires = ['speak-merchant']
    bad.objectives[1]!.requires = ['inspect-notice']
    const result = validateBlueprint(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('cycle'))).toBe(true)
  })

  it('requires the decision to transitively cover every objective', () => {
    const bad = cloneBlueprint()
    bad.decision.requires = ['speak-merchant']
    const result = validateBlueprint(bad)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes('speak-clerk'))).toBe(true)
  })

  it('rejects decision targets and unused areas', () => {
    const decisionTarget = cloneBlueprint()
    decisionTarget.objectives[0]!.interactionId = decisionTarget.decision.id
    expect(validateBlueprint(decisionTarget).errors.some((error) => error.includes('unknown interaction'))).toBe(true)
    const unused = cloneBlueprint()
    unused.npcs[1]!.locationId = 'quay-market'
    expect(validateBlueprint(unused).errors.some((error) => error.includes('records-office has no interaction'))).toBe(true)
  })
})

describe('map generation and validation', () => {
  it('is deterministic and serializable', () => {
    const first = generateMap(demoBlueprint, 'same-seed')
    const second = generateMap(structuredClone(demoBlueprint), 'same-seed')
    expect(second).toEqual(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(first.scene.width).toBe(30)
    expect(first.scene.height).toBe(20)
  })

  it('changes geometry and identity with the seed', () => {
    const first = generateMap(demoBlueprint, 'harbor-a')
    const second = generateMap(demoBlueprint, 'harbor-b')
    expect(second.id).not.toBe(first.id)
    expect({ locations: second.scene.locations, tiles: second.scene.tiles }).not.toEqual({ locations: first.scene.locations, tiles: first.scene.tiles })
  })

  it('uses full canonical blueprint content in map identity', () => {
    const changed = cloneBlueprint()
    changed.description = `${changed.description} Another invented detail.`
    const originalMap = generateMap(demoBlueprint, 'identity-seed')
    const changedMap = generateMap(changed, 'identity-seed')
    expect(changedMap.id).not.toBe(originalMap.id)
    const reordered = {
      decision: structuredClone(demoBlueprint.decision),
      objectives: structuredClone(demoBlueprint.objectives),
      evidence: structuredClone(demoBlueprint.evidence),
      npcs: structuredClone(demoBlueprint.npcs),
      locations: structuredClone(demoBlueprint.locations),
      assumptions: structuredClone(demoBlueprint.assumptions),
      sources: structuredClone(demoBlueprint.sources),
      player: structuredClone(demoBlueprint.player),
      description: demoBlueprint.description,
      setting: demoBlueprint.setting,
      title: demoBlueprint.title,
      id: demoBlueprint.id,
      version: 1
    } satisfies Blueprint
    expect(generateMap(reordered, 'identity-seed').id).toBe(originalMap.id)
  })

  it('rejects invalid blueprints and seeds with readable errors', () => {
    expect(() => generateMap({})).toThrow(/Invalid blueprint/)
    expect(() => generateMap(demoBlueprint, '')).toThrow(/Invalid seed/)
    expect(() => generateMap(demoBlueprint, 'bad seed')).toThrow(/Invalid seed/)
    expect(() => generateMap(demoBlueprint, 'x'.repeat(65))).toThrow(/Invalid seed/)
  })

  it('generates valid reachable maps for 50 seeds', () => {
    for (let index = 0; index < 50; index += 1) {
      const map = generateMap(demoBlueprint, `sweep-${index}`)
      expect(validateMap(map), `seed sweep-${index}`).toEqual({ valid: true, errors: [] })
      expect(map.entities.filter((entity) => entity.type === 'npc')).toHaveLength(2)
      expect(map.entities.filter((entity) => entity.type === 'evidence')).toHaveLength(1)
      expect(map.entities.filter((entity) => entity.type === 'decision')).toHaveLength(1)
      expect(new Set(map.scene.locations.map((location) => location.kind))).toEqual(new Set(['market', 'records', 'meeting']))
      for (const entity of map.entities) expect(() => reachableNeighbor(map, entity)).not.toThrow()
    }
  })

  it('never throws when validating malformed maps', () => {
    for (const value of [null, undefined, 1, [], {}, { version: 1 }]) {
      expect(() => validateMap(value)).not.toThrow()
      expect(validateMap(value).valid).toBe(false)
    }
  })

  it('independently detects identity, terrain, geometry, and entity tampering', () => {
    const map = generateMap(demoBlueprint, 'tamper-map')
    const identity = cloneMap(map)
    identity.id = 'map-forged'
    expect(validateMap(identity).errors.some((error) => error.includes('map.id'))).toBe(true)
    const terrain = cloneMap(map)
    terrain.scene.tiles[terrain.playerSpawn.y]![terrain.playerSpawn.x] = 2
    expect(validateMap(terrain).errors.some((error) => error.includes('spawn'))).toBe(true)
    const geometry = cloneMap(map)
    geometry.scene.locations[1]!.x = geometry.scene.locations[0]!.x
    geometry.scene.locations[1]!.y = geometry.scene.locations[0]!.y
    expect(validateMap(geometry).errors.some((error) => error.includes('overlap'))).toBe(true)
    const entities = cloneMap(map)
    entities.entities[1]!.x = entities.entities[0]!.x
    entities.entities[1]!.y = entities.entities[0]!.y
    expect(validateMap(entities).errors.some((error) => error.includes('entities overlap'))).toBe(true)
  })
})

describe('navigation and collision', () => {
  it('finds shortest four-way paths with the documented endpoint behavior', () => {
    const map = generateMap(demoBlueprint, 'paths')
    const target = { x: map.playerSpawn.x + 1, y: map.playerSpawn.y }
    const path = findPath(map, map.playerSpawn, target)
    expect(path).toEqual([target])
    expect(findPath(map, map.playerSpawn, map.playerSpawn)).toEqual([])
    if (path) {
      expect(path[0]).not.toEqual(map.playerSpawn)
      expect(path.at(-1)).toEqual(target)
    }
  })

  it('treats walls, water, bounds, and entities as blocked', () => {
    const map = generateMap(demoBlueprint, 'collision')
    expect(isWalkable(map, -1, 0)).toBe(false)
    expect(isWalkable(map, 0, 0)).toBe(false)
    const entity = map.entities[0]!
    expect(isWalkable(map, entity.x, entity.y)).toBe(false)
    expect(findPath(map, map.playerSpawn, entity)).toBeNull()
  })

  it('moves only one orthogonal tile and preserves identity when blocked', () => {
    const map = generateMap(demoBlueprint, 'movement')
    const initial = createGameState(map)
    expect(movePlayer(map, initial, 0, 0)).toBe(initial)
    expect(movePlayer(map, initial, 1, 1)).toBe(initial)
    expect(movePlayer(map, initial, 2, 0)).toBe(initial)
    const entity = map.entities[0]!
    const { point, path } = reachableNeighbor(map, entity)
    const beside = followPath(map, initial, path)
    expect(beside.player).toEqual(point)
    const blocked = movePlayer(map, beside, entity.x - point.x, entity.y - point.y)
    expect(blocked).toBe(beside)
  })
})

describe('interactions and progression', () => {
  it('enforces proximity while remote interactions have equivalent effects', () => {
    const map = generateMap(demoBlueprint, 'proximity')
    const initial = createGameState(map)
    const local = interact(map, initial, 'shortage-notice')
    expect(local.ok).toBe(false)
    expect(local.state).toBe(initial)
    const remote = interact(map, initial, 'shortage-notice', { remote: true })
    expect(remote.ok).toBe(true)
    expect(remote.state.journal.map((entry) => entry.id)).toEqual(['shortage-notice'])
    expect(remote.state.completedObjectives).toEqual(['inspect-notice'])
  })

  it('requires dependency ordering and allows a repeated interaction to complete an unlocked objective', () => {
    const map = generateMap(demoBlueprint, 'ordering')
    let state = createGameState(map)
    state = interact(map, state, 'mara-venn', { remote: true }).state
    expect(state.completedObjectives).toEqual([])
    expect(state.journal.map((entry) => entry.id)).toEqual(['mara-venn'])
    state = interact(map, state, 'shortage-notice', { remote: true }).state
    expect(state.completedObjectives).toEqual(['inspect-notice'])
    state = interact(map, state, 'mara-venn', { remote: true }).state
    expect(state.completedObjectives).toEqual(['inspect-notice', 'speak-merchant'])
    expect(state.journal.map((entry) => entry.id)).toEqual(['mara-venn', 'shortage-notice'])
  })

  it('deduplicates journal entries and objective completion', () => {
    const map = generateMap(demoBlueprint, 'idempotent')
    let state = createGameState(map)
    for (let index = 0; index < 3; index += 1) state = interact(map, state, 'shortage-notice', { remote: true }).state
    expect(state.journal).toHaveLength(1)
    expect(state.completedObjectives).toEqual(['inspect-notice'])
  })

  it('supports physical interaction from a reachable neighbor', () => {
    const map = generateMap(demoBlueprint, 'physical')
    const entity = map.entities.find((entry) => entry.id === 'shortage-notice')!
    const { path } = reachableNeighbor(map, entity)
    const state = followPath(map, createGameState(map), path)
    const result = interact(map, state, entity.id)
    expect(result.ok).toBe(true)
    expect(result.state.completedObjectives).toContain('inspect-notice')
  })

  it('gates the final decision, enforces proximity, and makes the ending immutable', () => {
    const map = generateMap(demoBlueprint, 'decision')
    const initial = createGameState(map)
    expect(chooseDecision(map, initial, 'publish-and-review', { remote: true }).ok).toBe(false)
    const complete = completeInvestigation(map)
    expect(chooseDecision(map, complete, 'publish-and-review').ok).toBe(false)
    expect(interact(map, complete, map.blueprint.decision.id, { remote: true }).ok).toBe(true)
    const chosen = chooseDecision(map, complete, 'publish-and-review', { remote: true })
    expect(chosen.ok).toBe(true)
    expect(chosen.state.decision?.optionId).toBe('publish-and-review')
    expect(chooseDecision(map, chosen.state, 'publish-and-review', { remote: true }).state).toBe(chosen.state)
    const changed = chooseDecision(map, chosen.state, 'reserve-and-wait', { remote: true })
    expect(changed.ok).toBe(false)
    expect(changed.state).toBe(chosen.state)
  })
})

describe('strict save restoration', () => {
  it('restores a valid completed state', () => {
    const map = generateMap(demoBlueprint, 'restore-valid')
    const complete = completeInvestigation(map)
    const decided = chooseDecision(map, complete, 'publish-and-review', { remote: true }).state
    expect(restoreGameState(map, JSON.parse(JSON.stringify(decided)))).toEqual(decided)
  })

  it('restores a valid locked interaction history', () => {
    const map = generateMap(demoBlueprint, 'restore-locked')
    const state = interact(map, createGameState(map), 'mara-venn', { remote: true }).state
    expect(restoreGameState(map, structuredClone(state))).toEqual(state)
  })

  it('rejects mismatched identity, extra fields, invalid positions, and duplicate visits', () => {
    const map = generateMap(demoBlueprint, 'restore-base')
    const fresh = createGameState(map)
    const foreign = { ...fresh, mapId: generateMap(demoBlueprint, 'restore-other').id }
    expect(restoreGameState(map, foreign)).toEqual(fresh)
    expect(restoreGameState(map, { ...fresh, extra: true })).toEqual(fresh)
    expect(restoreGameState(map, { ...fresh, player: { x: 0, y: 0 } })).toEqual(fresh)
    const occupied = map.entities[0]!
    expect(restoreGameState(map, { ...fresh, player: { x: occupied.x, y: occupied.y } })).toEqual(fresh)
    expect(restoreGameState(map, { ...fresh, visited: ['quay-market', 'quay-market'] })).toEqual(fresh)
  })

  it('rejects forged, altered, and duplicate journal entries', () => {
    const map = generateMap(demoBlueprint, 'restore-journal')
    const state = interact(map, createGameState(map), 'shortage-notice', { remote: true }).state
    const fresh = createGameState(map)
    const forged = structuredClone(state)
    forged.journal[0]!.id = 'forged-entry'
    expect(restoreGameState(map, forged)).toEqual(fresh)
    const altered = structuredClone(state)
    altered.journal[0]!.text = 'tampered'
    expect(restoreGameState(map, altered)).toEqual(fresh)
    const duplicate = structuredClone(state)
    duplicate.journal.push(structuredClone(duplicate.journal[0]!))
    expect(restoreGameState(map, duplicate)).toEqual(fresh)
  })

  it('rejects impossible, unknown, duplicate, and misordered objective completion', () => {
    const map = generateMap(demoBlueprint, 'restore-objectives')
    const fresh = createGameState(map)
    expect(restoreGameState(map, { ...fresh, completedObjectives: ['inspect-notice'] })).toEqual(fresh)
    const complete = completeInvestigation(map)
    expect(restoreGameState(map, { ...complete, completedObjectives: ['unknown-objective'] })).toEqual(fresh)
    expect(restoreGameState(map, { ...complete, completedObjectives: ['inspect-notice', 'inspect-notice'] })).toEqual(fresh)
    expect(restoreGameState(map, { ...complete, completedObjectives: ['speak-merchant', 'inspect-notice', 'speak-clerk'] })).toEqual(fresh)
    expect(restoreGameState(map, { ...complete, completedObjectives: ['inspect-notice', 'speak-clerk'] })).toEqual(fresh)
  })

  it('rejects forged, changed, or illegally unlocked decisions', () => {
    const map = generateMap(demoBlueprint, 'restore-decision')
    const fresh = createGameState(map)
    const option = map.blueprint.decision.options[0]!
    const illegal = {
      ...fresh,
      visited: ['council-hall'],
      decision: { optionId: option.id, outcome: option.outcome }
    }
    expect(restoreGameState(map, illegal)).toEqual(fresh)
    const complete = completeInvestigation(map)
    const decided = chooseDecision(map, complete, option.id, { remote: true }).state
    expect(restoreGameState(map, { ...decided, decision: { ...decided.decision!, outcome: 'forged' } })).toEqual(fresh)
    expect(restoreGameState(map, { ...decided, decision: { optionId: 'unknown-option', outcome: option.outcome } })).toEqual(fresh)
  })

  it('never throws for malformed saved values', () => {
    const map = generateMap(demoBlueprint, 'restore-malformed')
    const fresh = createGameState(map)
    for (const value of [null, undefined, true, 1, 'save', [], {}, { mapId: map.id }]) {
      expect(() => restoreGameState(map, value)).not.toThrow()
      expect(restoreGameState(map, value)).toEqual(fresh)
    }
  })
})
