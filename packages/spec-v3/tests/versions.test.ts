import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AdventureSpec, CURRENT_SCHEMA_VERSION, decodeStoredSpec, getSchemaSnapshot, getSchemaVersion, getUpgradePath, normalizeSchemaVersion, compareSchemaVersions, LatestAdventureSpec, validateSpec } from '../src/index.js'
import type { UpgradeDescriptor } from '../src/index.js'
import { sampleSpec } from './sample.js'

const current = () => ({ ...structuredClone(sampleSpec), schemaVersion: CURRENT_SCHEMA_VERSION, documents: [], stages: sampleSpec.stages.map(stage => ({ ...stage, preparation: { characters: {}, decision: [], essentialCharacters: [{ characterId: 'char-farquhar', discoveryIds: ['disc-1'] }] } })) })

describe('persisted schema versions', () => {
  it('reads unversioned and explicit legacy content without upgrading it', () => {
    const decoded = decodeStoredSpec(sampleSpec)
    expect(decoded).toMatchObject({ ok: true, schemaVersion: '1.0.0', support: 'best_effort' })
    if (decoded.ok) expect(decoded.spec.schemaVersion).toBeUndefined()
    expect(decodeStoredSpec({ ...sampleSpec, schemaVersion: 1 })).toMatchObject({ ok: true, schemaVersion: '1.0.0' })
  })
  it('requires preparation and reading checks for every latest stage and document', () => {
    const result = validateSpec({ ...sampleSpec, schemaVersion: 2 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.map(i => i.path)).toEqual(expect.arrayContaining(['stages.0.preparation', 'documents.0.readingCheck']))
    expect(LatestAdventureSpec.safeParse(sampleSpec).success).toBe(false)
    expect(AdventureSpec.safeParse(current()).success).toBe(true)
    expect(decodeStoredSpec(current())).toMatchObject({ ok: true, schemaVersion: CURRENT_SCHEMA_VERSION, support: 'current' })
  })
  it.each([0, -1, 1.5, 4, '2', null])('rejects unsupported or malformed version %s', schemaVersion => {
    expect(getSchemaVersion({ ...sampleSpec, schemaVersion })).toBeUndefined()
    expect(decodeStoredSpec({ ...sampleSpec, schemaVersion }).ok).toBe(false)
  })
  it('preserves preparation already authored in legacy adventures', () => {
    const input = current()
    const legacy = { ...input, schemaVersion: 1 }
    const decoded = decodeStoredSpec(legacy)
    expect(decoded).toMatchObject({ ok: true, schemaVersion: '1.0.0' })
    if (decoded.ok) expect(decoded.spec.stages[0]!.preparation).toEqual(legacy.stages[0]!.preparation)
    expect(legacy.schemaVersion).toBe(1)
  })
  it('keeps released schemas unchanged while current import metadata is explicit', () => {
    for (const version of [1, 2]) {
      const frozen = JSON.parse(readFileSync(new URL(`../schema/${version}.schema.json`, import.meta.url), 'utf8'))
      expect(getSchemaSnapshot(version)).toEqual(frozen)
      expect(JSON.stringify(getSchemaSnapshot(version))).not.toContain('importId')
    }
    expect(getSchemaSnapshot('2.1.0')).toEqual(JSON.parse(readFileSync(new URL('../schema/2.1.0.schema.json', import.meta.url), 'utf8')))
    expect(CURRENT_SCHEMA_VERSION).toBe('2.1.1')
    expect(JSON.stringify(getSchemaSnapshot(CURRENT_SCHEMA_VERSION))).toContain('importId')
  })
  it('preserves import attribution from parallel pre-versioning content without stamping its format', () => {
    const importId = '5adc1bb8-cbe5-4b04-930f-d57c31db3316'
    for (const schemaVersion of [undefined, 1, 2, '1.0.0', '2.0.0', '2.1.0', CURRENT_SCHEMA_VERSION]) {
      const input = { ...current(), authoring: { importId }, ...(schemaVersion === undefined ? {} : { schemaVersion }) }
      if (schemaVersion === undefined) delete (input as { schemaVersion?: string | number }).schemaVersion
      const decoded = decodeStoredSpec(input)
      expect(decoded).toMatchObject({ ok: true, schemaVersion: normalizeSchemaVersion(schemaVersion ?? 1), spec: { authoring: { importId } } })
      if (decoded.ok) expect(decoded.spec.schemaVersion).toBe(schemaVersion)
    }
  })
  it('does not mistake malformed containers for legacy adventures', () => {
    for (const raw of [null, [], 'adventure']) expect(getSchemaVersion(raw)).toBeUndefined()
    expect(decodeStoredSpec({ schemaVersion: 1 }).ok).toBe(false)
  })
  it('normalizes only released markers and compares semantic versions numerically', () => {
    expect(normalizeSchemaVersion(1)).toBe('1.0.0')
    expect(normalizeSchemaVersion(2)).toBe('2.0.0')
    expect(normalizeSchemaVersion('2.1.0')).toBe('2.1.0')
    expect(normalizeSchemaVersion(3)).toBeUndefined()
    expect(normalizeSchemaVersion('2.2.0')).toBeUndefined()
    expect(compareSchemaVersions('2.10.0', '2.9.0')).toBe(1)
    expect(compareSchemaVersions('2.0.10', '2.0.9')).toBe(1)
    expect(compareSchemaVersions('1.10.0', '2.0.0')).toBe(-1)
    expect(compareSchemaVersions('2.1.0', '2.1.0')).toBe(0)
    for (const invalid of ['02.1.0', '2.1', 'v2.1.0', '2.1.0-beta']) expect(() => compareSchemaVersions(invalid, '2.1.0')).toThrow()
  })
  it('retains the runtime object schema used by editor composition', () => {
    expect(AdventureSpec.shape.stages.element.shape.preparation).toBeDefined()
  })
  it('emits separately versioned structural contracts with explicit latest requirements', () => {
    const legacy = JSON.stringify(getSchemaSnapshot(1)), latest = JSON.stringify(getSchemaSnapshot(CURRENT_SCHEMA_VERSION))
    expect(legacy).toContain('schemaVersion')
    expect(latest).toContain('readingCheck')
    expect(legacy).not.toEqual(latest)
    expect(() => getSchemaSnapshot(999)).toThrow(/Unsupported/)
    const schema = getSchemaSnapshot(CURRENT_SCHEMA_VERSION) as { properties: { documents: { items: { required: string[] } }; stages: { items: { required: string[] } } }; required: string[] }
    expect(schema.required).toContain('schemaVersion')
    expect(schema.properties.documents.items.required).toContain('readingCheck')
    expect(schema.properties.stages.items.required).toContain('preparation')
  })
})

describe('upgrade paths', () => {
  it('declares the content upgrade and a no-op for current content', () => {
    expect(getUpgradePath(1)).toMatchObject([{ from: '1.0.0', to: '2.0.0', kind: 'content' }, { from: '2.0.0', to: '2.1.0', kind: 'structural' }, { from: '2.1.0', to: '2.1.1', kind: 'structural' }])
    expect(getUpgradePath(2)).toMatchObject([{ id: 'import-metadata', from: '2.0.0', to: '2.1.0', kind: 'structural' }, { id: 'reading-text', from: '2.1.0', to: '2.1.1', kind: 'structural' }])
    expect(getUpgradePath(CURRENT_SCHEMA_VERSION)).toEqual([])
  })
  it('resolves multiple ordered steps without mutating a supplied future registry', () => {
    const step = (from: string, to: string): UpgradeDescriptor => ({ id: `upgrade-${from}`, from, to, title: 'Upgrade', summary: 'Review additions', kind: 'structural', requirements: [] })
    const registry = Object.freeze([step('2.0.0', '2.1.0'), step('1.0.0', '2.0.0'), step('2.1.0', '3.0.0')])
    expect(getUpgradePath('1.0.0', '3.0.0', registry).map(x => x.id)).toEqual(['upgrade-1.0.0', 'upgrade-2.0.0', 'upgrade-2.1.0'])
    expect(registry[0]!.from).toBe('2.0.0')
  })
  it('rejects gaps, downgrades, fractional versions, and ambiguous outgoing migrations', () => {
    expect(() => getUpgradePath(0)).toThrow()
    expect(() => getUpgradePath(99, 99)).toThrow(/Unsupported/)
    expect(() => getUpgradePath(2, 1)).toThrow()
    expect(() => getUpgradePath(1.5)).toThrow()
    expect(() => getUpgradePath(1, 4)).toThrow(/route|path/i)
    const step: UpgradeDescriptor = { id: 'a', from: '1.0.0', to: '2.0.0', title: 'A', summary: 'A', kind: 'structural', requirements: [] }
    expect(() => getUpgradePath(1, 2, [step, { ...step, id: 'b' }])).toThrow(/ambiguous/i)
  })
})
