export type SourceKind = 'source' | 'simulation'
export type LocationKind = 'market' | 'records' | 'meeting'
export type EntityType = 'npc' | 'evidence' | 'decision'
export type JournalKind = SourceKind
export type Tile = 0 | 1 | 2 | 3 | 4

export interface SourceRecord {
  id: string
  title: string
  text: string
  kind: SourceKind
}

export interface PlayerDefinition {
  name: string
  role: string
  brief: string
}

export interface LocationDefinition {
  id: string
  name: string
  purpose: string
  kind: LocationKind
}

export interface NpcDefinition {
  id: string
  name: string
  role: string
  locationId: string
  dialogue: string
  sourceIds: string[]
}

export interface EvidenceDefinition {
  id: string
  name: string
  locationId: string
  text: string
  sourceIds: string[]
}

export interface ObjectiveDefinition {
  id: string
  title: string
  requires: string[]
  interactionId: string
}

export interface DecisionOption {
  id: string
  label: string
  outcome: string
}

export interface DecisionDefinition {
  id: string
  title: string
  requires: string[]
  options: DecisionOption[]
}

export interface Blueprint {
  version: 1
  id: string
  title: string
  setting: string
  description: string
  player: PlayerDefinition
  sources: SourceRecord[]
  assumptions: string[]
  locations: LocationDefinition[]
  npcs: NpcDefinition[]
  evidence: EvidenceDefinition[]
  objectives: ObjectiveDefinition[]
  decision: DecisionDefinition
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface Point {
  x: number
  y: number
}

export interface GeneratedLocation extends LocationDefinition {
  x: number
  y: number
  width: number
  height: number
}

export interface MapEntity extends Point {
  id: string
  type: EntityType
  name: string
  locationId: string
}

export interface GeneratedScene {
  id: 'main'
  name: string
  width: 30
  height: 20
  tiles: Tile[][]
  locations: GeneratedLocation[]
}

export interface GenerationMetadata {
  generatorVersion: string
  layoutVariant: number
}

export interface GeneratedMap {
  version: 1
  id: string
  seed: string
  blueprint: Blueprint
  scene: GeneratedScene
  playerSpawn: Point
  entities: MapEntity[]
  validation: ValidationResult
  generation: GenerationMetadata
}

export type GameMap = GeneratedMap

export interface JournalEntry {
  id: string
  title: string
  text: string
  kind: JournalKind
  sourceIds: string[]
}

export interface DecisionResult {
  optionId: string
  outcome: string
}

export interface GameState {
  mapId: string
  player: Point
  visited: string[]
  journal: JournalEntry[]
  completedObjectives: string[]
  decision: DecisionResult | null
}

export interface InteractionOptions {
  remote?: boolean
}

export interface InteractionResult {
  state: GameState
  ok: boolean
  message: string
}

export const GENERATOR_VERSION = 'map-generator-v1'

const WIDTH = 30
const HEIGHT = 20
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SEED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const WALKABLE_TILES = new Set<number>([0, 1, 4])
const LOCATION_KINDS = new Set<LocationKind>(['market', 'records', 'meeting'])
const SOURCE_KINDS = new Set<SourceKind>(['source', 'simulation'])

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(record: UnknownRecord, keys: readonly string[], path: string, errors: string[]): void {
  const expected = new Set(keys)
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) errors.push(`${path}.${key} is required`)
  }
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) errors.push(`${path}.${key} is not supported`)
  }
}

function requireRecord(value: unknown, path: string, keys: readonly string[], errors: string[]): UnknownRecord | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return null
  }
  hasExactKeys(value, keys, path, errors)
  return value
}

function requireString(value: unknown, path: string, maximum: number, errors: string[], id = false): value is string {
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string`)
    return false
  }
  if (value.length < 1 || value.length > maximum || value.trim() !== value) {
    errors.push(`${path} must contain 1-${maximum} trimmed characters`)
    return false
  }
  if (id && !ID_PATTERN.test(value)) {
    errors.push(`${path} must be a safe lowercase identifier`)
    return false
  }
  return true
}

function requireArray(value: unknown, path: string, minimum: number, maximum: number, errors: string[]): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return null
  }
  if (value.length < minimum || value.length > maximum) {
    errors.push(`${path} must contain ${minimum}-${maximum} items`)
  }
  return value
}

function validateStringArray(value: unknown, path: string, minimum: number, maximum: number, errors: string[], ids: boolean): void {
  const values = requireArray(value, path, minimum, maximum, errors)
  if (!values) return
  const seen = new Set<string>()
  values.forEach((entry, index) => {
    if (requireString(entry, `${path}[${index}]`, ids ? 48 : 500, errors, ids)) {
      if (seen.has(entry)) errors.push(`${path} contains duplicate value ${entry}`)
      seen.add(entry)
    }
  })
}

function validateBlueprintValue(value: unknown, errors: string[]): void {
  const blueprint = requireRecord(value, 'blueprint', ['version', 'id', 'title', 'setting', 'description', 'player', 'sources', 'assumptions', 'locations', 'npcs', 'evidence', 'objectives', 'decision'], errors)
  if (!blueprint) return
  if (blueprint.version !== 1) errors.push('blueprint.version must equal 1')
  requireString(blueprint.id, 'blueprint.id', 48, errors, true)
  requireString(blueprint.title, 'blueprint.title', 120, errors)
  requireString(blueprint.setting, 'blueprint.setting', 120, errors)
  requireString(blueprint.description, 'blueprint.description', 1000, errors)

  const player = requireRecord(blueprint.player, 'blueprint.player', ['name', 'role', 'brief'], errors)
  if (player) {
    requireString(player.name, 'blueprint.player.name', 80, errors)
    requireString(player.role, 'blueprint.player.role', 120, errors)
    requireString(player.brief, 'blueprint.player.brief', 1000, errors)
  }

  const sources = requireArray(blueprint.sources, 'blueprint.sources', 1, 12, errors)
  sources?.forEach((entry, index) => {
    const source = requireRecord(entry, `blueprint.sources[${index}]`, ['id', 'title', 'text', 'kind'], errors)
    if (!source) return
    requireString(source.id, `blueprint.sources[${index}].id`, 48, errors, true)
    requireString(source.title, `blueprint.sources[${index}].title`, 120, errors)
    requireString(source.text, `blueprint.sources[${index}].text`, 2000, errors)
    if (!SOURCE_KINDS.has(source.kind as SourceKind)) errors.push(`blueprint.sources[${index}].kind must be source or simulation`)
  })

  validateStringArray(blueprint.assumptions, 'blueprint.assumptions', 0, 20, errors, false)

  const locations = requireArray(blueprint.locations, 'blueprint.locations', 3, 3, errors)
  locations?.forEach((entry, index) => {
    const location = requireRecord(entry, `blueprint.locations[${index}]`, ['id', 'name', 'purpose', 'kind'], errors)
    if (!location) return
    requireString(location.id, `blueprint.locations[${index}].id`, 48, errors, true)
    requireString(location.name, `blueprint.locations[${index}].name`, 100, errors)
    requireString(location.purpose, `blueprint.locations[${index}].purpose`, 500, errors)
    if (!LOCATION_KINDS.has(location.kind as LocationKind)) errors.push(`blueprint.locations[${index}].kind must be market, records, or meeting`)
  })

  const npcs = requireArray(blueprint.npcs, 'blueprint.npcs', 2, 2, errors)
  npcs?.forEach((entry, index) => {
    const npc = requireRecord(entry, `blueprint.npcs[${index}]`, ['id', 'name', 'role', 'locationId', 'dialogue', 'sourceIds'], errors)
    if (!npc) return
    requireString(npc.id, `blueprint.npcs[${index}].id`, 48, errors, true)
    requireString(npc.name, `blueprint.npcs[${index}].name`, 80, errors)
    requireString(npc.role, `blueprint.npcs[${index}].role`, 120, errors)
    requireString(npc.locationId, `blueprint.npcs[${index}].locationId`, 48, errors, true)
    requireString(npc.dialogue, `blueprint.npcs[${index}].dialogue`, 2000, errors)
    validateStringArray(npc.sourceIds, `blueprint.npcs[${index}].sourceIds`, 1, 12, errors, true)
  })

  const evidence = requireArray(blueprint.evidence, 'blueprint.evidence', 1, 3, errors)
  evidence?.forEach((entry, index) => {
    const item = requireRecord(entry, `blueprint.evidence[${index}]`, ['id', 'name', 'locationId', 'text', 'sourceIds'], errors)
    if (!item) return
    requireString(item.id, `blueprint.evidence[${index}].id`, 48, errors, true)
    requireString(item.name, `blueprint.evidence[${index}].name`, 120, errors)
    requireString(item.locationId, `blueprint.evidence[${index}].locationId`, 48, errors, true)
    requireString(item.text, `blueprint.evidence[${index}].text`, 2000, errors)
    validateStringArray(item.sourceIds, `blueprint.evidence[${index}].sourceIds`, 1, 12, errors, true)
  })

  const objectives = requireArray(blueprint.objectives, 'blueprint.objectives', 2, 12, errors)
  objectives?.forEach((entry, index) => {
    const objective = requireRecord(entry, `blueprint.objectives[${index}]`, ['id', 'title', 'requires', 'interactionId'], errors)
    if (!objective) return
    requireString(objective.id, `blueprint.objectives[${index}].id`, 48, errors, true)
    requireString(objective.title, `blueprint.objectives[${index}].title`, 160, errors)
    validateStringArray(objective.requires, `blueprint.objectives[${index}].requires`, 0, 12, errors, true)
    requireString(objective.interactionId, `blueprint.objectives[${index}].interactionId`, 48, errors, true)
  })

  const decision = requireRecord(blueprint.decision, 'blueprint.decision', ['id', 'title', 'requires', 'options'], errors)
  if (decision) {
    requireString(decision.id, 'blueprint.decision.id', 48, errors, true)
    requireString(decision.title, 'blueprint.decision.title', 160, errors)
    validateStringArray(decision.requires, 'blueprint.decision.requires', 1, 12, errors, true)
    const options = requireArray(decision.options, 'blueprint.decision.options', 2, 4, errors)
    options?.forEach((entry, index) => {
      const option = requireRecord(entry, `blueprint.decision.options[${index}]`, ['id', 'label', 'outcome'], errors)
      if (!option) return
      requireString(option.id, `blueprint.decision.options[${index}].id`, 48, errors, true)
      requireString(option.label, `blueprint.decision.options[${index}].label`, 160, errors)
      requireString(option.outcome, `blueprint.decision.options[${index}].outcome`, 2000, errors)
    })
  }

  if (errors.length > 0) return
  const typed = value as Blueprint
  const allIds = new Map<string, string>()
  const register = (id: string, path: string): void => {
    const previous = allIds.get(id)
    if (previous) errors.push(`${path} duplicates identifier ${id} from ${previous}`)
    else allIds.set(id, path)
  }
  register(typed.id, 'blueprint.id')
  typed.sources.forEach((entry, index) => register(entry.id, `blueprint.sources[${index}].id`))
  typed.locations.forEach((entry, index) => register(entry.id, `blueprint.locations[${index}].id`))
  typed.npcs.forEach((entry, index) => register(entry.id, `blueprint.npcs[${index}].id`))
  typed.evidence.forEach((entry, index) => register(entry.id, `blueprint.evidence[${index}].id`))
  typed.objectives.forEach((entry, index) => register(entry.id, `blueprint.objectives[${index}].id`))
  register(typed.decision.id, 'blueprint.decision.id')
  typed.decision.options.forEach((entry, index) => register(entry.id, `blueprint.decision.options[${index}].id`))

  const kinds = new Set(typed.locations.map((location) => location.kind))
  if (kinds.size !== 3) errors.push('blueprint.locations must contain one market, one records area, and one meeting area')
  const locationIds = new Set(typed.locations.map((location) => location.id))
  const sourceIds = new Set(typed.sources.map((source) => source.id))
  const interactionIds = new Set([...typed.npcs.map((npc) => npc.id), ...typed.evidence.map((item) => item.id)])
  const objectiveIds = new Set(typed.objectives.map((objective) => objective.id))

  for (const npc of typed.npcs) {
    if (!locationIds.has(npc.locationId)) errors.push(`NPC ${npc.id} references unknown location ${npc.locationId}`)
    for (const sourceId of npc.sourceIds) {
      if (!sourceIds.has(sourceId)) errors.push(`NPC ${npc.id} references unknown source ${sourceId}`)
    }
  }
  for (const item of typed.evidence) {
    if (!locationIds.has(item.locationId)) errors.push(`Evidence ${item.id} references unknown location ${item.locationId}`)
    for (const sourceId of item.sourceIds) {
      if (!sourceIds.has(sourceId)) errors.push(`Evidence ${item.id} references unknown source ${sourceId}`)
    }
  }
  for (const objective of typed.objectives) {
    if (!interactionIds.has(objective.interactionId)) errors.push(`Objective ${objective.id} references unknown interaction ${objective.interactionId}`)
    for (const dependency of objective.requires) {
      if (dependency === objective.id) errors.push(`Objective ${objective.id} cannot require itself`)
      else if (!objectiveIds.has(dependency)) errors.push(`Objective ${objective.id} requires unknown objective ${dependency}`)
    }
  }
  for (const dependency of typed.decision.requires) {
    if (!objectiveIds.has(dependency)) errors.push(`Decision ${typed.decision.id} requires unknown objective ${dependency}`)
  }

  const objectiveById = new Map(typed.objectives.map((objective) => [objective.id, objective]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, trail: string[]): void => {
    if (visiting.has(id)) {
      errors.push(`Objective dependency cycle: ${[...trail, id].join(' -> ')}`)
      return
    }
    if (visited.has(id)) return
    const objective = objectiveById.get(id)
    if (!objective) return
    visiting.add(id)
    objective.requires.forEach((dependency) => visit(dependency, [...trail, id]))
    visiting.delete(id)
    visited.add(id)
  }
  typed.objectives.forEach((objective) => visit(objective.id, []))

  const requiredByDecision = new Set<string>()
  const collect = (id: string): void => {
    if (requiredByDecision.has(id)) return
    requiredByDecision.add(id)
    objectiveById.get(id)?.requires.forEach(collect)
  }
  typed.decision.requires.forEach(collect)
  for (const objective of typed.objectives) {
    if (!requiredByDecision.has(objective.id)) errors.push(`Decision ${typed.decision.id} does not transitively require objective ${objective.id}`)
  }

  const occupiedLocations = new Set([...typed.npcs.map((npc) => npc.locationId), ...typed.evidence.map((item) => item.locationId)])
  const meeting = typed.locations.find((location) => location.kind === 'meeting')
  if (meeting) occupiedLocations.add(meeting.id)
  for (const location of typed.locations) {
    if (!occupiedLocations.has(location.id)) errors.push(`Location ${location.id} has no interaction`) 
  }
}

export function validateBlueprint(value: unknown): ValidationResult {
  const errors: string[] = []
  try {
    validateBlueprintValue(value, errors)
  } catch {
    errors.push('Blueprint validation failed safely because the input could not be inspected')
  }
  return { valid: errors.length === 0, errors }
}

function cloneBlueprint(blueprint: Blueprint): Blueprint {
  return {
    version: 1,
    id: blueprint.id,
    title: blueprint.title,
    setting: blueprint.setting,
    description: blueprint.description,
    player: { ...blueprint.player },
    sources: blueprint.sources.map((source) => ({ ...source })),
    assumptions: [...blueprint.assumptions],
    locations: blueprint.locations.map((location) => ({ ...location })),
    npcs: blueprint.npcs.map((npc) => ({ ...npc, sourceIds: [...npc.sourceIds] })),
    evidence: blueprint.evidence.map((item) => ({ ...item, sourceIds: [...item.sourceIds] })),
    objectives: blueprint.objectives.map((objective) => ({ ...objective, requires: [...objective.requires] })),
    decision: {
      ...blueprint.decision,
      requires: [...blueprint.decision.requires],
      options: blueprint.decision.options.map((option) => ({ ...option }))
    }
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const record = value as UnknownRecord
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
}

function hashIdentity(value: string): string {
  let hash = 14695981039346656037n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  return hash.toString(16).padStart(16, '0')
}

function mapIdentity(blueprint: Blueprint, seed: string): string {
  return `map-${hashIdentity(canonicalize({ blueprint, generatorVersion: GENERATOR_VERSION, seed }))}`
}

function seedHash(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function randomGenerator(seed: string): () => number {
  let state = seedHash(seed)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = result[index]!
    result[index] = result[swapIndex]!
    result[swapIndex] = current
  }
  return result
}

function terrainWalkable(map: GeneratedMap, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.scene.width || y >= map.scene.height) return false
  return WALKABLE_TILES.has(map.scene.tiles[y]?.[x] ?? -1)
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`
}

function locationContains(location: GeneratedLocation, point: Point): boolean {
  return point.x >= location.x && point.y >= location.y && point.x < location.x + location.width && point.y < location.y + location.height
}

function adjacentPoints(point: Point): Point[] {
  return [
    { x: point.x + 1, y: point.y },
    { x: point.x - 1, y: point.y },
    { x: point.x, y: point.y + 1 },
    { x: point.x, y: point.y - 1 }
  ]
}

export function generateMap(value: unknown, seed = 'harbor-1'): GeneratedMap {
  const blueprintValidation = validateBlueprint(value)
  if (!blueprintValidation.valid) throw new Error(`Invalid blueprint: ${blueprintValidation.errors.join('; ')}`)
  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) throw new Error('Invalid seed: use 1-64 letters, numbers, dots, underscores, or hyphens')
  const blueprint = cloneBlueprint(value as Blueprint)
  const random = randomGenerator(seed)
  const tiles: Tile[][] = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x): Tile => x === 0 || y === 0 || x === WIDTH - 1 || y === HEIGHT - 1 ? 2 : 0)
  )
  const columns = [2 + Math.floor(random() * 2), 11 + Math.floor(random() * 2), 20 + Math.floor(random() * 2)]
  const assignedLocations = shuffled(blueprint.locations, random)
  const locations: GeneratedLocation[] = assignedLocations.map((location, index) => {
    const upper = random() < 0.5
    return {
      ...location,
      x: columns[index]!,
      y: upper ? 2 + Math.floor(random() * 2) : 12 + Math.floor(random() * 2),
      width: 7,
      height: 5
    }
  })

  for (const location of locations) {
    for (let y = location.y; y < location.y + location.height; y += 1) {
      for (let x = location.x; x < location.x + location.width; x += 1) {
        const boundary = x === location.x || y === location.y || x === location.x + location.width - 1 || y === location.y + location.height - 1
        tiles[y]![x] = boundary ? 2 : 4
      }
    }
  }

  const playerSpawn = { x: 14 + Math.floor(random() * 3), y: 10 }
  const centers = locations.map((location) => location.x + Math.floor(location.width / 2))
  const roadStart = Math.min(playerSpawn.x, ...centers)
  const roadEnd = Math.max(playerSpawn.x, ...centers)
  for (let x = roadStart; x <= roadEnd; x += 1) tiles[playerSpawn.y]![x] = 1
  for (const location of locations) {
    const centerX = location.x + Math.floor(location.width / 2)
    const upper = location.y < playerSpawn.y
    const doorY = upper ? location.y + location.height - 1 : location.y
    const fromY = Math.min(playerSpawn.y, doorY)
    const toY = Math.max(playerSpawn.y, doorY)
    for (let y = fromY; y <= toY; y += 1) tiles[y]![centerX] = y === doorY ? 4 : 1
  }

  for (let y = 1; y < HEIGHT - 1; y += 1) {
    for (let x = 1; x < WIDTH - 1; x += 1) {
      if (tiles[y]![x] === 0 && random() < 0.075) tiles[y]![x] = 3
    }
  }

  const entities: MapEntity[] = []
  const definitions: Array<Omit<MapEntity, 'x' | 'y'>> = [
    ...blueprint.npcs.map((npc) => ({ id: npc.id, type: 'npc' as const, name: npc.name, locationId: npc.locationId })),
    ...blueprint.evidence.map((item) => ({ id: item.id, type: 'evidence' as const, name: item.name, locationId: item.locationId }))
  ]
  const meeting = blueprint.locations.find((location) => location.kind === 'meeting')!
  definitions.push({ id: blueprint.decision.id, type: 'decision', name: blueprint.decision.title, locationId: meeting.id })

  for (const location of locations) {
    const upper = location.y < playerSpawn.y
    const nearDoorY = upper ? location.y + location.height - 2 : location.y + 1
    const farY = upper ? location.y + 1 : location.y + location.height - 2
    const candidateXs = [1, 2, 3, 4, 5].map((offset) => location.x + offset)
    const candidates = shuffled([
      ...candidateXs.map((x) => ({ x, y: farY })),
      ...candidateXs.filter((x) => x !== location.x + 3).map((x) => ({ x, y: nearDoorY }))
    ], random)
    const localDefinitions = definitions.filter((definition) => definition.locationId === location.id)
    localDefinitions.forEach((definition, index) => {
      const point = candidates[index]
      if (!point) throw new Error(`Map generation failed: too many entities in location ${location.id}`)
      entities.push({ ...definition, ...point })
    })
  }

  const layoutVariant = seedHash(seed)
  const map: GeneratedMap = {
    version: 1,
    id: mapIdentity(blueprint, seed),
    seed,
    blueprint,
    scene: {
      id: 'main',
      name: `${blueprint.setting} Map`,
      width: WIDTH,
      height: HEIGHT,
      tiles,
      locations
    },
    playerSpawn,
    entities,
    validation: { valid: true, errors: [] },
    generation: { generatorVersion: GENERATOR_VERSION, layoutVariant }
  }
  const validation = validateMap(map)
  if (!validation.valid) throw new Error(`Map generation failed: ${validation.errors.join('; ')}`)
  return map
}

function rectanglesOverlap(left: GeneratedLocation, right: GeneratedLocation): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y
}

function validateMapValue(value: unknown, errors: string[]): void {
  const record = requireRecord(value, 'map', ['version', 'id', 'seed', 'blueprint', 'scene', 'playerSpawn', 'entities', 'validation', 'generation'], errors)
  if (!record) return
  if (record.version !== 1) errors.push('map.version must equal 1')
  requireString(record.id, 'map.id', 80, errors)
  if (typeof record.seed !== 'string' || !SEED_PATTERN.test(record.seed)) errors.push('map.seed is invalid')
  const blueprintValidation = validateBlueprint(record.blueprint)
  errors.push(...blueprintValidation.errors.map((error) => `map.${error}`))

  const scene = requireRecord(record.scene, 'map.scene', ['id', 'name', 'width', 'height', 'tiles', 'locations'], errors)
  if (scene) {
    if (scene.id !== 'main') errors.push('map.scene.id must equal main')
    requireString(scene.name, 'map.scene.name', 160, errors)
    if (scene.width !== WIDTH) errors.push(`map.scene.width must equal ${WIDTH}`)
    if (scene.height !== HEIGHT) errors.push(`map.scene.height must equal ${HEIGHT}`)
    if (!Array.isArray(scene.tiles) || scene.tiles.length !== HEIGHT) errors.push(`map.scene.tiles must have ${HEIGHT} rows`)
    else {
      scene.tiles.forEach((row, y) => {
        if (!Array.isArray(row) || row.length !== WIDTH) errors.push(`map.scene.tiles[${y}] must have ${WIDTH} columns`)
        else row.forEach((tile, x) => {
          if (!Number.isInteger(tile) || tile < 0 || tile > 4) errors.push(`map.scene.tiles[${y}][${x}] must be a tile from 0 to 4`)
        })
      })
    }
    const locations = requireArray(scene.locations, 'map.scene.locations', 3, 3, errors)
    locations?.forEach((entry, index) => {
      const location = requireRecord(entry, `map.scene.locations[${index}]`, ['id', 'name', 'purpose', 'kind', 'x', 'y', 'width', 'height'], errors)
      if (!location) return
      requireString(location.id, `map.scene.locations[${index}].id`, 48, errors, true)
      requireString(location.name, `map.scene.locations[${index}].name`, 100, errors)
      requireString(location.purpose, `map.scene.locations[${index}].purpose`, 500, errors)
      if (!LOCATION_KINDS.has(location.kind as LocationKind)) errors.push(`map.scene.locations[${index}].kind is invalid`)
      for (const field of ['x', 'y', 'width', 'height'] as const) {
        if (!Number.isInteger(location[field])) errors.push(`map.scene.locations[${index}].${field} must be an integer`)
      }
    })
  }

  const spawn = requireRecord(record.playerSpawn, 'map.playerSpawn', ['x', 'y'], errors)
  if (spawn) {
    if (!Number.isInteger(spawn.x)) errors.push('map.playerSpawn.x must be an integer')
    if (!Number.isInteger(spawn.y)) errors.push('map.playerSpawn.y must be an integer')
  }

  const entities = requireArray(record.entities, 'map.entities', 4, 6, errors)
  entities?.forEach((entry, index) => {
    const entity = requireRecord(entry, `map.entities[${index}]`, ['id', 'type', 'name', 'x', 'y', 'locationId'], errors)
    if (!entity) return
    requireString(entity.id, `map.entities[${index}].id`, 48, errors, true)
    if (entity.type !== 'npc' && entity.type !== 'evidence' && entity.type !== 'decision') errors.push(`map.entities[${index}].type is invalid`)
    requireString(entity.name, `map.entities[${index}].name`, 160, errors)
    if (!Number.isInteger(entity.x)) errors.push(`map.entities[${index}].x must be an integer`)
    if (!Number.isInteger(entity.y)) errors.push(`map.entities[${index}].y must be an integer`)
    requireString(entity.locationId, `map.entities[${index}].locationId`, 48, errors, true)
  })

  const validation = requireRecord(record.validation, 'map.validation', ['valid', 'errors'], errors)
  if (validation) {
    if (validation.valid !== true) errors.push('map.validation.valid must be true')
    if (!Array.isArray(validation.errors) || validation.errors.length !== 0) errors.push('map.validation.errors must be empty')
  }
  const generation = requireRecord(record.generation, 'map.generation', ['generatorVersion', 'layoutVariant'], errors)
  if (generation) {
    if (generation.generatorVersion !== GENERATOR_VERSION) errors.push(`map.generation.generatorVersion must equal ${GENERATOR_VERSION}`)
    if (!Number.isInteger(generation.layoutVariant) || (generation.layoutVariant as number) < 0) errors.push('map.generation.layoutVariant must be a non-negative integer')
  }

  if (errors.length > 0) return
  const map = value as GeneratedMap
  if (map.id !== mapIdentity(map.blueprint, map.seed)) errors.push('map.id does not match its blueprint, seed, and generator version')
  if (map.generation.layoutVariant !== seedHash(map.seed)) errors.push('map.generation.layoutVariant does not match the seed')
  if (map.scene.name !== `${map.blueprint.setting} Map`) errors.push('map.scene.name does not match the blueprint setting')

  const locationById = new Map(map.scene.locations.map((location) => [location.id, location]))
  if (locationById.size !== map.scene.locations.length) errors.push('map.scene.locations contains duplicate IDs')
  for (const definition of map.blueprint.locations) {
    const location = locationById.get(definition.id)
    if (!location) {
      errors.push(`map is missing location ${definition.id}`)
      continue
    }
    if (location.name !== definition.name || location.purpose !== definition.purpose || location.kind !== definition.kind) errors.push(`map location ${definition.id} does not match its blueprint definition`)
  }
  for (let left = 0; left < map.scene.locations.length; left += 1) {
    const location = map.scene.locations[left]!
    if (location.width < 3 || location.height < 3 || location.x < 1 || location.y < 1 || location.x + location.width >= WIDTH || location.y + location.height >= HEIGHT) {
      errors.push(`map location ${location.id} has invalid geometry`)
      continue
    }
    for (let right = left + 1; right < map.scene.locations.length; right += 1) {
      if (rectanglesOverlap(location, map.scene.locations[right]!)) errors.push(`map locations ${location.id} and ${map.scene.locations[right]!.id} overlap`)
    }
    for (let y = location.y; y < location.y + location.height; y += 1) {
      for (let x = location.x; x < location.x + location.width; x += 1) {
        const tile = map.scene.tiles[y]![x]!
        if (tile !== 2 && tile !== 4) errors.push(`map location ${location.id} contains invalid terrain at ${x},${y}`)
      }
    }
  }
  for (let x = 0; x < WIDTH; x += 1) {
    if (WALKABLE_TILES.has(map.scene.tiles[0]![x]!) || WALKABLE_TILES.has(map.scene.tiles[HEIGHT - 1]![x]!)) errors.push('map perimeter must not be walkable')
  }
  for (let y = 0; y < HEIGHT; y += 1) {
    if (WALKABLE_TILES.has(map.scene.tiles[y]![0]!) || WALKABLE_TILES.has(map.scene.tiles[y]![WIDTH - 1]!)) errors.push('map perimeter must not be walkable')
  }

  const expectedEntities = new Map<string, { type: EntityType; name: string; locationId: string }>()
  map.blueprint.npcs.forEach((npc) => expectedEntities.set(npc.id, { type: 'npc', name: npc.name, locationId: npc.locationId }))
  map.blueprint.evidence.forEach((item) => expectedEntities.set(item.id, { type: 'evidence', name: item.name, locationId: item.locationId }))
  const meeting = map.blueprint.locations.find((location) => location.kind === 'meeting')!
  expectedEntities.set(map.blueprint.decision.id, { type: 'decision', name: map.blueprint.decision.title, locationId: meeting.id })
  if (map.entities.length !== expectedEntities.size) errors.push('map entity count does not match the blueprint')
  const entityIds = new Set<string>()
  const occupied = new Set<string>()
  for (const entity of map.entities) {
    const expected = expectedEntities.get(entity.id)
    if (!expected) errors.push(`map contains unexpected entity ${entity.id}`)
    else if (entity.type !== expected.type || entity.name !== expected.name || entity.locationId !== expected.locationId) errors.push(`map entity ${entity.id} does not match its blueprint definition`)
    if (entityIds.has(entity.id)) errors.push(`map contains duplicate entity ${entity.id}`)
    entityIds.add(entity.id)
    const key = pointKey(entity)
    if (occupied.has(key)) errors.push(`map entities overlap at ${key}`)
    occupied.add(key)
    const location = locationById.get(entity.locationId)
    if (!location || !locationContains(location, entity)) errors.push(`map entity ${entity.id} is outside its assigned location`)
    if (!terrainWalkable(map, entity.x, entity.y)) errors.push(`map entity ${entity.id} is not on walkable terrain`)
  }
  for (const id of expectedEntities.keys()) {
    if (!entityIds.has(id)) errors.push(`map is missing entity ${id}`)
  }
  if (!terrainWalkable(map, map.playerSpawn.x, map.playerSpawn.y)) errors.push('map player spawn is not on walkable terrain')
  if (occupied.has(pointKey(map.playerSpawn))) errors.push('map player spawn overlaps an entity')

  if (errors.length > 0) return
  const reachable = new Set<string>()
  const queue: Point[] = [map.playerSpawn]
  reachable.add(pointKey(map.playerSpawn))
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of adjacentPoints(queue[index]!)) {
      const key = pointKey(next)
      if (!reachable.has(key) && terrainWalkable(map, next.x, next.y) && !occupied.has(key)) {
        reachable.add(key)
        queue.push(next)
      }
    }
  }
  for (const location of map.scene.locations) {
    let accessible = false
    for (let y = location.y; y < location.y + location.height && !accessible; y += 1) {
      for (let x = location.x; x < location.x + location.width; x += 1) {
        if (reachable.has(`${x},${y}`)) {
          accessible = true
          break
        }
      }
    }
    if (!accessible) errors.push(`map location ${location.id} is unreachable`)
  }
  for (const entity of map.entities) {
    if (!adjacentPoints(entity).some((point) => reachable.has(pointKey(point)))) errors.push(`map entity ${entity.id} has no reachable interaction neighbor`)
  }
}

export function validateMap(value: unknown): ValidationResult {
  const errors: string[] = []
  try {
    validateMapValue(value, errors)
  } catch {
    errors.push('Map validation failed safely because the input could not be inspected')
  }
  return { valid: errors.length === 0, errors }
}

export function isWalkable(map: GeneratedMap, x: number, y: number): boolean {
  return terrainWalkable(map, x, y) && !map.entities.some((entity) => entity.x === x && entity.y === y)
}

export function findPath(map: GeneratedMap, from: Point, to: Point): Point[] | null {
  if (from.x === to.x && from.y === to.y) return []
  if (!isWalkable(map, from.x, from.y) || !isWalkable(map, to.x, to.y)) return null
  const startKey = pointKey(from)
  const targetKey = pointKey(to)
  const queue: Point[] = [{ ...from }]
  const previous = new Map<string, string | null>([[startKey, null]])
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    for (const next of adjacentPoints(current)) {
      const key = pointKey(next)
      if (previous.has(key) || !isWalkable(map, next.x, next.y)) continue
      previous.set(key, pointKey(current))
      if (key === targetKey) {
        const path: Point[] = [{ ...to }]
        let cursor = pointKey(current)
        while (cursor !== startKey) {
          const [x, y] = cursor.split(',').map(Number)
          path.push({ x: x!, y: y! })
          cursor = previous.get(cursor)!
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

function locationAt(map: GeneratedMap, point: Point): GeneratedLocation | undefined {
  return map.scene.locations.find((location) => locationContains(location, point))
}

function addVisited(state: GameState, locationId: string): string[] {
  return state.visited.includes(locationId) ? state.visited : [...state.visited, locationId]
}

export function createGameState(map: GeneratedMap): GameState {
  const location = locationAt(map, map.playerSpawn)
  return {
    mapId: map.id,
    player: { ...map.playerSpawn },
    visited: location ? [location.id] : [],
    journal: [],
    completedObjectives: [],
    decision: null
  }
}

export function movePlayer(map: GeneratedMap, state: GameState, dx: number, dy: number): GameState {
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return state
  const player = { x: state.player.x + dx, y: state.player.y + dy }
  if (!isWalkable(map, player.x, player.y)) return state
  const location = locationAt(map, player)
  return {
    ...state,
    player,
    visited: location ? addVisited(state, location.id) : state.visited
  }
}

function journalKind(map: GeneratedMap, sourceIds: readonly string[]): JournalKind {
  return sourceIds.some((id) => map.blueprint.sources.find((source) => source.id === id)?.kind === 'source') ? 'source' : 'simulation'
}

function journalForEntity(map: GeneratedMap, entity: MapEntity): JournalEntry | null {
  if (entity.type === 'npc') {
    const npc = map.blueprint.npcs.find((entry) => entry.id === entity.id)
    return npc ? { id: npc.id, title: `${npc.name}, ${npc.role}`, text: npc.dialogue, kind: journalKind(map, npc.sourceIds), sourceIds: [...npc.sourceIds] } : null
  }
  if (entity.type === 'evidence') {
    const evidence = map.blueprint.evidence.find((entry) => entry.id === entity.id)
    return evidence ? { id: evidence.id, title: evidence.name, text: evidence.text, kind: journalKind(map, evidence.sourceIds), sourceIds: [...evidence.sourceIds] } : null
  }
  return null
}

function isNear(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) <= 1
}

export function interact(map: GeneratedMap, state: GameState, entityId: string, options: InteractionOptions = {}): InteractionResult {
  const entity = map.entities.find((entry) => entry.id === entityId)
  if (!entity) return { state, ok: false, message: `Unknown interaction ${entityId}` }
  if (!options.remote && !isNear(state.player, entity)) return { state, ok: false, message: `${entity.name} is not within interaction range` }
  if (entity.type === 'decision') {
    if (state.decision) return { state, ok: true, message: state.decision.outcome }
    const missing = map.blueprint.decision.requires.filter((id) => !state.completedObjectives.includes(id))
    if (missing.length > 0) return { state, ok: false, message: `Decision locked; complete ${missing.join(', ')}` }
    return { state, ok: true, message: 'Decision unlocked; choose one of the available options' }
  }
  const journalEntry = journalForEntity(map, entity)
  if (!journalEntry) return { state, ok: false, message: `Interaction ${entityId} is unavailable` }
  const completedBefore = new Set(state.completedObjectives)
  const newlyCompleted = map.blueprint.objectives
    .filter((objective) => objective.interactionId === entity.id && !completedBefore.has(objective.id) && objective.requires.every((id) => completedBefore.has(id)))
    .map((objective) => objective.id)
  const journal = state.journal.some((entry) => entry.id === journalEntry.id) ? state.journal : [...state.journal, journalEntry]
  const nextState: GameState = {
    ...state,
    visited: addVisited(state, entity.locationId),
    journal,
    completedObjectives: newlyCompleted.length > 0 ? [...state.completedObjectives, ...newlyCompleted] : state.completedObjectives
  }
  const message = newlyCompleted.length > 0 ? `${journalEntry.title}; completed ${newlyCompleted.join(', ')}` : journalEntry.text
  return { state: nextState, ok: true, message }
}

export function chooseDecision(map: GeneratedMap, state: GameState, optionId: string, options: InteractionOptions = {}): InteractionResult {
  const entity = map.entities.find((entry) => entry.type === 'decision' && entry.id === map.blueprint.decision.id)
  if (!entity) return { state, ok: false, message: 'Decision point is unavailable' }
  const option = map.blueprint.decision.options.find((entry) => entry.id === optionId)
  if (!option) return { state, ok: false, message: `Unknown decision option ${optionId}` }
  if (state.decision) {
    if (state.decision.optionId === option.id) return { state, ok: true, message: state.decision.outcome }
    return { state, ok: false, message: 'The final decision cannot be changed' }
  }
  if (!options.remote && !isNear(state.player, entity)) return { state, ok: false, message: `${entity.name} is not within interaction range` }
  const missing = map.blueprint.decision.requires.filter((id) => !state.completedObjectives.includes(id))
  if (missing.length > 0) return { state, ok: false, message: `Decision locked; complete ${missing.join(', ')}` }
  const decision = { optionId: option.id, outcome: option.outcome }
  return {
    state: { ...state, visited: addVisited(state, entity.locationId), decision },
    ok: true,
    message: option.outcome
  }
}

function exactRecord(value: unknown, keys: readonly string[]): value is UnknownRecord {
  if (!isRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function sameStrings(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index])
}

function progressionIsReachable(map: GeneratedMap, journalIds: readonly string[], completedObjectives: readonly string[]): boolean {
  const seen = new Set<string>()
  const visit = (journalIndex: number, completionIndex: number): boolean => {
    const stateKey = `${journalIndex}:${completionIndex}`
    if (seen.has(stateKey)) return false
    seen.add(stateKey)
    const completed = new Set(completedObjectives.slice(0, completionIndex))
    const apply = (targetId: string): number | null => {
      const batch = map.blueprint.objectives
        .filter((objective) => objective.interactionId === targetId && !completed.has(objective.id) && objective.requires.every((id) => completed.has(id)))
        .map((objective) => objective.id)
      if (batch.some((id, offset) => completedObjectives[completionIndex + offset] !== id)) return null
      return batch.length
    }
    if (journalIndex === journalIds.length && completionIndex === completedObjectives.length) return true
    if (journalIndex < journalIds.length) {
      const batchLength = apply(journalIds[journalIndex]!)
      if (batchLength !== null && visit(journalIndex + 1, completionIndex + batchLength)) return true
    }
    for (let index = 0; index < journalIndex; index += 1) {
      const batchLength = apply(journalIds[index]!)
      if (batchLength !== null && batchLength > 0 && visit(journalIndex, completionIndex + batchLength)) return true
    }
    return false
  }
  return visit(0, 0)
}

export function restoreGameState(map: GeneratedMap, value: unknown): GameState {
  const fresh = createGameState(map)
  try {
    if (!exactRecord(value, ['mapId', 'player', 'visited', 'journal', 'completedObjectives', 'decision'])) return fresh
    if (value.mapId !== map.id || !exactRecord(value.player, ['x', 'y'])) return fresh
    const player = value.player
    if (!Number.isInteger(player.x) || !Number.isInteger(player.y) || !isWalkable(map, player.x as number, player.y as number)) return fresh
    const playerPoint = { x: player.x as number, y: player.y as number }
    if (!findPath(map, map.playerSpawn, playerPoint)) return fresh

    if (!Array.isArray(value.visited) || !value.visited.every((id) => typeof id === 'string')) return fresh
    const visited = value.visited as string[]
    const locationIds = new Set(map.scene.locations.map((location) => location.id))
    if (new Set(visited).size !== visited.length || visited.some((id) => !locationIds.has(id))) return fresh

    if (!Array.isArray(value.journal)) return fresh
    const journal: JournalEntry[] = []
    const journalIds = new Set<string>()
    for (const unknownEntry of value.journal) {
      if (!exactRecord(unknownEntry, ['id', 'title', 'text', 'kind', 'sourceIds']) || typeof unknownEntry.id !== 'string') return fresh
      const entity = map.entities.find((entry) => entry.id === unknownEntry.id && entry.type !== 'decision')
      if (!entity || journalIds.has(entity.id)) return fresh
      const expected = journalForEntity(map, entity)
      if (!expected || unknownEntry.title !== expected.title || unknownEntry.text !== expected.text || unknownEntry.kind !== expected.kind || !sameStrings(unknownEntry.sourceIds, expected.sourceIds)) return fresh
      if (!visited.includes(entity.locationId)) return fresh
      journalIds.add(entity.id)
      journal.push(expected)
    }

    if (!Array.isArray(value.completedObjectives) || !value.completedObjectives.every((id) => typeof id === 'string')) return fresh
    const completedObjectives = value.completedObjectives as string[]
    if (new Set(completedObjectives).size !== completedObjectives.length) return fresh
    const objectiveById = new Map(map.blueprint.objectives.map((objective) => [objective.id, objective]))
    const completionIndex = new Map(completedObjectives.map((id, index) => [id, index]))
    for (const objectiveId of completedObjectives) {
      const objective = objectiveById.get(objectiveId)
      if (!objective || !journalIds.has(objective.interactionId)) return fresh
    }
    if (!progressionIsReachable(map, journal.map((entry) => entry.id), completedObjectives)) return fresh

    const currentLocation = locationAt(map, playerPoint)
    if (currentLocation && !visited.includes(currentLocation.id)) return fresh

    let decision: DecisionResult | null = null
    const savedDecision = value.decision
    if (savedDecision !== null) {
      if (!exactRecord(savedDecision, ['optionId', 'outcome']) || typeof savedDecision.optionId !== 'string') return fresh
      const option = map.blueprint.decision.options.find((entry) => entry.id === savedDecision.optionId)
      const meeting = map.blueprint.locations.find((location) => location.kind === 'meeting')!
      if (!option || savedDecision.outcome !== option.outcome || !map.blueprint.decision.requires.every((id) => completionIndex.has(id)) || !visited.includes(meeting.id)) return fresh
      decision = { optionId: option.id, outcome: option.outcome }
    }

    return {
      mapId: map.id,
      player: playerPoint,
      visited: [...visited],
      journal,
      completedObjectives: [...completedObjectives],
      decision
    }
  } catch {
    return fresh
  }
}
