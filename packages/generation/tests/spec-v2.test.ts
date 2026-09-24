import { describe, expect, it } from 'vitest'

import { loadFixtureJson, loadI1Documents, loadI1Spec } from '../src/fixtures'
import { verifyGrounding } from '../src/ingest/spans'
import { publicProjection, resolveStageSettings, validateAdventureSpec, validatePublishedSpec } from '../src/spec/v2'

type Json = Record<string, any>

async function fixture(): Promise<Json> {
  return structuredClone(await loadFixtureJson('singapore-1819.spec.json')) as Json
}

function expectInvalid(value: unknown, pathFragment: string, messageFragment?: string) {
  const result = validateAdventureSpec(value)
  expect(result.ok).toBe(false)
  if (result.ok) return
  const hit = result.issues.find((i) => i.path.includes(pathFragment) && (!messageFragment || i.message.includes(messageFragment)))
  expect(hit, `expected an issue at *${pathFragment}* (${messageFragment ?? 'any'}), got:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`).toBeDefined()
}

describe('I1 fixture', () => {
  it('is a valid Adventure Spec v2', async () => {
    const result = validateAdventureSpec(await loadFixtureJson('singapore-1819.spec.json'))
    expect(result.ok, result.ok ? '' : JSON.stringify(result.issues, null, 2)).toBe(true)
    if (result.ok) expect(result.spec.stages.every((stage) => stage.mapTheme === 'classic')).toBe(true)
  })

  it('accepts a stage theme chosen by the planner and rejects unknown themes', async () => {
    const spec = await fixture()
    spec.stages[0].mapTheme = 'coast'
    const valid = validateAdventureSpec(spec)
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(valid.spec.stages[0]!.mapTheme).toBe('coast')
    spec.stages[0].mapTheme = 'volcano'
    expectInvalid(spec, 'stages.0.mapTheme')
  })

  it('keeps legacy missing enclosure values as explicit null', async () => {
    const spec = await fixture()
    spec.stages.forEach((stage: Json) => stage.rooms.forEach((room: Json) => {
      if (room.enclosure === 'open') room.doorDefault = 'open'
      delete room.enclosure
    }))
    const result = validateAdventureSpec(spec)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.spec.stages.every((stage) => stage.rooms.every((room) => room.enclosure === null))).toBe(true)
  })

  it('preserves explicit enclosure annotations through parsing and public projection', async () => {
    const spec = await loadI1Spec()
    expect(spec.stages.flatMap((stage) => stage.rooms).every((room) => room.enclosure !== null)).toBe(true)
    const projected = publicProjection(spec)
    expect(projected.stages.flatMap((stage) => stage.rooms).map((room) => room.enclosure)).toEqual(spec.stages.flatMap((stage) => stage.rooms).map((room) => room.enclosure))
  })

  it('exercises the full v2 surface: 3 stages, rooms with doors, private context, branch targets, assets, overlays', async () => {
    const spec = await loadI1Spec()
    expect(spec.stages).toHaveLength(3)
    expect(spec.stages.every((s) => s.rooms.length >= 2)).toBe(true)
    expect(spec.stages.some((s) => s.rooms.some((r) => r.doorDefault === 'closed'))).toBe(true)
    expect(spec.stages.every((s) => s.agents.every((a) => a.privateContext.knowledgeHorizon.length > 0))).toBe(true)
    const targets = spec.stages.flatMap((s) => s.decision.options.map((o) => o.branchTarget.kind))
    expect(targets).toContain('stage')
    expect(targets).toContain('ending')
    expect(spec.assetEligibility.length).toBeGreaterThan(0)
    expect(spec.stages.map((s) => resolveStageSettings(spec, s).ambientOverlay.id)).toEqual(['clouds', 'rain', 'dust'])
    expect(spec.stages.map((s) => resolveStageSettings(spec, s).timerSeconds)).toEqual([480, 600, 0])
    const enclosureById = Object.fromEntries(spec.stages.flatMap((stage) => stage.rooms.map((room) => [room.id, [room.enclosure, room.doorDefault]])))
    expect(enclosureById).toEqual({
      'landing-beach': ['open', null],
      'ship-cabin': ['enclosed', 'closed'],
      'temenggong-hall': ['enclosed', 'open'],
      'farquhar-tent': ['enclosed', 'open'],
      'hussein-quarters': ['enclosed', 'closed'],
      'treaty-ground': ['open', null],
      bazaar: ['open', null],
      'resident-office': ['enclosed', 'closed'],
      godown: ['enclosed', 'open'],
    })
  })

  it('every source span resolves to a real page of the source (D2 spot-check)', async () => {
    const [spec, documents] = await Promise.all([loadI1Spec(), loadI1Documents()])
    const report = verifyGrounding(spec, documents)
    expect(report.total).toBeGreaterThan(30)
    expect(report.failures, JSON.stringify(report.failures, null, 2)).toEqual([])
    expect(spec.sources[0]?.contentHash).toBe(documents.get('handout')?.contentHash)
  })

  it('public projection carries no private context (FR-21)', async () => {
    const json = JSON.stringify(publicProjection(await loadI1Spec()))
    expect(json).not.toContain('privateContext')
    expect(json).not.toContain('knowledgeHorizon')
    expect(json).not.toContain('hiddenInterests')
  })
})

describe('Adventure Spec v2 rejects', () => {
  it('invalid enclosure and doorDefault combinations', async () => {
    const openWithDoor = await fixture()
    openWithDoor.stages[0].rooms[0].enclosure = 'open'
    openWithDoor.stages[0].rooms[0].doorDefault = 'open'
    expectInvalid(openWithDoor, 'stages.0.rooms.0.doorDefault', 'open locations must have no door')

    const enclosedWithoutDoor = await fixture()
    enclosedWithoutDoor.stages[0].rooms[0].enclosure = 'enclosed'
    enclosedWithoutDoor.stages[0].rooms[0].doorDefault = null
    expectInvalid(enclosedWithoutDoor, 'stages.0.rooms.0.doorDefault', 'enclosed or legacy locations require')
  })

  it('a missing reading level (FR-1a)', async () => {
    const spec = await fixture()
    delete spec.readingLevel
    expectInvalid(spec, 'readingLevel')
  })

  it('a terrain/structural/UI asset request (FR-6b)', async () => {
    const spec = await fixture()
    spec.assetEligibility.push({ id: 'asset-grass', kind: 'terrain', entityId: 'bazaar', subject: 'grass tiles', prompt: 'seamless grass tileset' })
    expectInvalid(spec, 'assetEligibility.6.kind')
    spec.assetEligibility[6].kind = 'ui'
    expectInvalid(spec, 'assetEligibility.6.kind')
  })

  it('accepts more than eight eligible images', async () => {
    const spec = await fixture()
    const rooms = spec.stages.flatMap((stage: Json) => stage.rooms.map((room: Json) => room.id))
    spec.assetEligibility = [
      ...spec.assetEligibility.filter((asset: Json) => asset.kind === 'portrait').slice(0, 2),
      ...rooms.map((room: string, i: number) => ({ id: `asset-extra-${i}`, kind: 'landmark', entityId: room, subject: room, prompt: 'A physical fixture' })),
    ]
    expect(spec.assetEligibility.length).toBeGreaterThan(8)
    expect(validateAdventureSpec(spec).ok).toBe(true)
  })

  it('an asset whose kind does not match its entity', async () => {
    const spec = await fixture()
    spec.assetEligibility[0].kind = 'landmark'
    expectInvalid(spec, 'assetEligibility.0.entityId', 'landmark must reference a room')
  })

  it('ungrounded content: no span and no assumption (FR-3)', async () => {
    const spec = await fixture()
    spec.stakeholders[0].summary.spans = []
    spec.stakeholders[0].summary.assumptionIds = []
    expectInvalid(spec, 'stakeholders.0.summary.spans', 'at least one source span')
  })

  it('a span pointing past the end of the source', async () => {
    const spec = await fixture()
    spec.sharedContext.spans[0].page = 99
    expectInvalid(spec, 'sharedContext.spans.0.page', 'beyond source')
  })

  it('a span citing an unknown source', async () => {
    const spec = await fixture()
    spec.sharedContext.spans[0].sourceId = 'wikipedia'
    expectInvalid(spec, 'sharedContext.spans.0.sourceId', 'unknown source')
  })

  it('evidence without any source span', async () => {
    const spec = await fixture()
    spec.stages[0].evidence[0].content.spans = []
    expectInvalid(spec, 'stages.0.evidence.0.content.spans')
  })

  it('an agent starting in a room from another stage', async () => {
    const spec = await fixture()
    spec.stages[0].agents[0].startRoomId = 'bazaar'
    expectInvalid(spec, 'stages.0.agents.0.startRoomId', 'unknown room')
  })

  it('a closed room nobody starts in', async () => {
    const spec = await fixture()
    const stage = spec.stages[0]
    const sealed = stage.rooms.find((r: Json) => r.doorDefault === 'closed' && r.id !== stage.spawnRoomId)
    for (const agent of stage.agents) if (agent.startRoomId === sealed.id) agent.startRoomId = stage.spawnRoomId
    expectInvalid(spec, 'stages.0.rooms', 'never be opened')
  })

  it('but keeps an already-published version readable, so a new authoring rule cannot retire a live adventure', async () => {
    const spec = await fixture()
    const stage = spec.stages[0]
    const sealed = stage.rooms.find((r: Json) => r.doorDefault === 'closed' && r.id !== stage.spawnRoomId)
    for (const agent of stage.agents) if (agent.startRoomId === sealed.id) agent.startRoomId = stage.spawnRoomId
    expect(validateAdventureSpec(spec).ok).toBe(false)
    expect(validatePublishedSpec(spec).ok).toBe(true)
    expect(validatePublishedSpec({ version: 1 }).ok).toBe(false)
  })

  it('a backward branch target', async () => {
    const spec = await fixture()
    spec.stages[1].decision.options[0].branchTarget = { kind: 'stage', stageId: 'stage-landing' }
    expectInvalid(spec, 'stages.1.decision.options.0.branchTarget.stageId', 'move forward')
  })

  it('a final-stage option that does not end the adventure', async () => {
    const spec = await fixture()
    spec.stages[2].decision.options[0].branchTarget = { kind: 'stage', stageId: 'stage-sultan' }
    expectInvalid(spec, 'stages.2.decision.options.0.branchTarget')
  })

  it('an unreachable ending', async () => {
    const spec = await fixture()
    spec.stages[0].decision.options[2].branchTarget = { kind: 'stage', stageId: 'stage-sultan' }
    expectInvalid(spec, 'endings.3.id', 'unreachable')
  })

  it('an objective cycle', async () => {
    const spec = await fixture()
    spec.stages[0].objectives[1].requires = ['obj-meet-temenggong']
    expectInvalid(spec, 'stages.0.objectives', 'cycle')
  })

  it('an objective the decision never requires', async () => {
    const spec = await fixture()
    spec.stages[0].objectives.push({ id: 'obj-dead', title: 'Dead end', requires: [], targetId: 'ev-instructions' })
    expectInvalid(spec, 'stages.0.objectives.3.id', 'not (transitively) required')
  })

  it('a stakeholder who never appears as an agent', async () => {
    const spec = await fixture()
    spec.stages[1].agents.splice(0, 1) // remove hussein
    spec.stages[1].objectives[1].targetId = 'agent-temenggong-s1'
    expectInvalid(spec, 'stakeholders.3.id', 'never appears')
  })

  it('duplicate ids anywhere in the spec', async () => {
    const spec = await fixture()
    spec.stages[1].rooms[0].id = 'landing-beach'
    expectInvalid(spec, 'stages.1.rooms.0.id', 'duplicate id')
  })

  it('an unknown ambient overlay or effect-style id', async () => {
    const spec = await fixture()
    spec.stages[0].ambientOverlay = { id: 'thunderstorm', intensity: 2 }
    expectInvalid(spec, 'stages.0.ambientOverlay.id')
  })

  it('a fourth stage', async () => {
    const spec = await fixture()
    spec.stages.push({ ...structuredClone(spec.stages[2]), id: 'stage-four', index: 3 })
    expectInvalid(spec, 'stages')
  })

  it('non-object garbage without throwing', () => {
    expect(validateAdventureSpec(null).ok).toBe(false)
    expect(validateAdventureSpec('spec').ok).toBe(false)
    expect(validateAdventureSpec({ version: 1 }).ok).toBe(false)
  })
})
