import { describe, expect, it } from 'vitest'
import { AdventureSpec, CURRENT_SCHEMA_VERSION, decodeStoredSpec, getSchemaSnapshot, getSchemaVersion, getUpgradePath, LatestAdventureSpec, validateSpec } from '../src/index.js'
import type { UpgradeDescriptor } from '../src/index.js'
import { sampleSpec } from './sample.js'

const current = () => ({ ...structuredClone(sampleSpec), schemaVersion: 2, documents: [], stages: sampleSpec.stages.map(stage => ({ ...stage, preparation: { characters: {}, decision: [], essentialCharacters: [{ characterId: 'char-farquhar', discoveryIds: ['disc-1'] }] } })) })

describe('persisted schema versions', () => {
  it('reads unversioned and explicit legacy content without upgrading it', () => {
    const decoded = decodeStoredSpec(sampleSpec)
    expect(decoded).toMatchObject({ ok: true, schemaVersion: 1, support: 'best_effort' })
    if (decoded.ok) expect(decoded.spec.schemaVersion).toBeUndefined()
    expect(decodeStoredSpec({ ...sampleSpec, schemaVersion: 1 })).toMatchObject({ ok: true, schemaVersion: 1 })
  })
  it('requires preparation and reading checks for every latest stage and document', () => {
    const result = validateSpec({ ...sampleSpec, schemaVersion: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(i => i.path)).toEqual(expect.arrayContaining(['stages.0.preparation', 'documents.0.readingCheck']))
    expect(LatestAdventureSpec.safeParse(sampleSpec).success).toBe(false)
    expect(AdventureSpec.safeParse(current()).success).toBe(true)
    expect(decodeStoredSpec(current())).toMatchObject({ ok: true, schemaVersion: CURRENT_SCHEMA_VERSION, support: 'current' })
  })
  it.each([0, -1, 1.5, 3, '2', null])('rejects unsupported or malformed version %s', schemaVersion => {
    expect(getSchemaVersion({ ...sampleSpec, schemaVersion })).toBeUndefined()
    expect(decodeStoredSpec({ ...sampleSpec, schemaVersion }).ok).toBe(false)
  })
  it('preserves preparation already authored in legacy adventures', () => {
    const input = current()
    const legacy = { ...input, schemaVersion: 1 }
    const decoded = decodeStoredSpec(legacy)
    expect(decoded).toMatchObject({ ok: true, schemaVersion: 1 })
    if (decoded.ok) expect(decoded.spec.stages[0]!.preparation).toEqual(legacy.stages[0]!.preparation)
    expect(legacy.schemaVersion).toBe(1)
  })
  it('does not mistake malformed containers for legacy adventures', () => {
    for (const raw of [null, [], 'adventure']) expect(getSchemaVersion(raw)).toBeUndefined()
    expect(decodeStoredSpec({ schemaVersion: 1 }).ok).toBe(false)
  })
  it('retains the runtime object schema used by editor composition', () => {
    expect(AdventureSpec.shape.stages.element.shape.preparation).toBeDefined()
  })
  it('emits separately versioned structural contracts with explicit latest requirements', () => {
    const legacy = JSON.stringify(getSchemaSnapshot(1)), latest = JSON.stringify(getSchemaSnapshot(2))
    expect(legacy).toContain('schemaVersion')
    expect(latest).toContain('readingCheck')
    expect(legacy).not.toEqual(latest)
    expect(() => getSchemaSnapshot(999)).toThrow(/Unsupported/)
    const schema = getSchemaSnapshot(2) as { properties: { documents: { items: { required: string[] } }; stages: { items: { required: string[] } } }; required: string[] }
    expect(schema.required).toContain('schemaVersion')
    expect(schema.properties.documents.items.required).toContain('readingCheck')
    expect(schema.properties.stages.items.required).toContain('preparation')
  })
})

describe('upgrade paths', () => {
  it('declares the content upgrade and a no-op for current content', () => {
    expect(getUpgradePath(1)).toMatchObject([{ from: 1, to: 2, kind: 'content' }])
    expect(getUpgradePath(2)).toEqual([])
  })
  it('resolves multiple ordered steps without mutating a supplied future registry', () => {
    const step = (from: number, to: number): UpgradeDescriptor => ({ id: `upgrade-${from}`, from, to, title: 'Upgrade', summary: 'Review additions', kind: 'structural', requirements: [] })
    const registry = Object.freeze([step(2, 3), step(1, 2), step(3, 4)])
    expect(getUpgradePath(1, 4, registry).map(x => x.id)).toEqual(['upgrade-1', 'upgrade-2', 'upgrade-3'])
    expect(registry[0]!.from).toBe(2)
  })
  it('rejects gaps, downgrades, fractional versions, and ambiguous outgoing migrations', () => {
    expect(() => getUpgradePath(0)).toThrow()
    expect(() => getUpgradePath(99, 99)).toThrow(/Unsupported/)
    expect(() => getUpgradePath(2, 1)).toThrow()
    expect(() => getUpgradePath(1.5)).toThrow()
    expect(() => getUpgradePath(1, 3)).toThrow(/route|path/i)
    const step: UpgradeDescriptor = { id: 'a', from: 1, to: 2, title: 'A', summary: 'A', kind: 'structural', requirements: [] }
    expect(() => getUpgradePath(1, 2, [step, { ...step, id: 'b' }])).toThrow(/ambiguous/i)
  })
})
