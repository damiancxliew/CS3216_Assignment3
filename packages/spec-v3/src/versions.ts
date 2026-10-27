import { z } from 'zod'
import { LegacyAdventureSpec, V2AdventureSpec, LatestAdventureSpec, validateSpec } from './index.js'
import type { AdventureSpec, SpecIssue } from './index.js'

/** This is the persisted contract version, independent of the database's content revision. */
export const CURRENT_SCHEMA_VERSION = '2.1.0' as const
export type SchemaVersion = '1.0.0' | '2.0.0' | '2.1.0'
export type SchemaSupport = 'current' | 'best_effort'
export const SCHEMA_REGISTRY = Object.freeze([
  Object.freeze({ version: '1.0.0' as const, snapshotVersion: '1', title: 'Original adventure format', support: 'best_effort' as const }),
  Object.freeze({ version: '2.0.0' as const, snapshotVersion: '2', title: 'Evidence preparation', support: 'best_effort' as const }),
  Object.freeze({ version: CURRENT_SCHEMA_VERSION, snapshotVersion: '2.1.0', title: 'Import attribution', support: 'current' as const }),
])

export type UpgradeDescriptor = Readonly<{
  id: string
  from: string
  to: string
  title: string
  summary: string
  kind: 'content' | 'structural'
  requirements: readonly string[]
}>

/** Descriptors declare upgrade capability. Execution lives in the authoring service. */
export const UPGRADE_REGISTRY: readonly UpgradeDescriptor[] = Object.freeze([
  Object.freeze({
    id: 'evidence-preparation', from: '1.0.0', to: '2.0.0',
    title: 'Add evidence preparation',
    summary: 'Add reading questions, relevant character preparation, and essential conversations before decisions.',
    kind: 'content' as const,
    requirements: Object.freeze(['readingChecks', 'stagePreparation', 'teacherReview']),
  }),
  Object.freeze({
    id: 'import-metadata', from: '2.0.0', to: '2.1.0',
    title: 'Preserve import attribution',
    summary: 'Record import attribution without changing the adventure content.',
    kind: 'structural' as const,
    requirements: Object.freeze(['teacherReview']),
  }),
])

/** Persisted schema releases use stable SemVer identifiers; prerelease/build markers are not released formats. */
function versionParts(value: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error(`Invalid stable schema version ${value}.`)
  const parts = value.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Invalid stable schema version ${value}.`)
  return parts
}

/** Numeric SemVer ordering, including double-digit minor and patch versions. */
export function compareSchemaVersions(a: string, b: string): number {
  const left = versionParts(a), right = versionParts(b)
  for (let i = 0; i < 3; i++) {
    if (left[i]! < right[i]!) return -1
    if (left[i]! > right[i]!) return 1
  }
  return 0
}

/** Normalize historical wire aliases without rewriting the stored marker. */
export function normalizeSchemaVersion(value: unknown): SchemaVersion | undefined {
  if (value === 1 || value === '1.0.0') return '1.0.0'
  if (value === 2 || value === '2.0.0') return '2.0.0'
  return value === CURRENT_SCHEMA_VERSION ? CURRENT_SCHEMA_VERSION : undefined
}

/** Read only the format marker; structural validation remains the decoder's responsibility. */
export function getSchemaVersion(raw: unknown): SchemaVersion | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const version = (raw as Record<string, unknown>).schemaVersion
  if (version === undefined) return '1.0.0'
  return normalizeSchemaVersion(version)
}

export type DecodeStoredSpecResult =
  | { ok: true; spec: AdventureSpec; schemaVersion: SchemaVersion; support: SchemaSupport }
  | { ok: false; issues: SpecIssue[] }

/** Decode at the storage boundary. Never upgrades, stamps, or rewrites the source object. */
export function decodeStoredSpec(input: unknown): DecodeStoredSpecResult {
  const schemaVersion = getSchemaVersion(input)
  if (schemaVersion === undefined) return { ok: false, issues: [{ path: 'schemaVersion', message: 'Unsupported or malformed adventure schema version. Use a supported upgrade path before opening this adventure.' }] }
  const result = validateSpec(input)
  if (!result.ok) return result
  return { ...result, schemaVersion, support: schemaVersion === CURRENT_SCHEMA_VERSION ? 'current' : 'best_effort' }
}

/** A unique ordered migration chain. Missing or ambiguous routes are configuration errors. */
export function getUpgradePath(from: string | number, to: string | number = CURRENT_SCHEMA_VERSION, registry: readonly UpgradeDescriptor[] = UPGRADE_REGISTRY): UpgradeDescriptor[] {
  const start = typeof from === 'number' ? normalizeSchemaVersion(from) : from
  const target = typeof to === 'number' ? normalizeSchemaVersion(to) : to
  if (!start || !target) throw new Error('Unsupported upgrade path; versions must use released SemVer identifiers.')
  if (compareSchemaVersions(start, target) > 0) throw new Error('Schema downgrades are not supported.')
  const known = new Set(registry.flatMap(step => [step.from, step.to]))
  if (!known.has(start) || !known.has(target)) throw new Error(`Unsupported upgrade path from schema version ${start} to ${target}.`)
  const result: UpgradeDescriptor[] = []
  let current = start
  while (compareSchemaVersions(current, target) < 0) {
    const outgoing = registry.filter(step => step.from === current)
    if (outgoing.length > 1) throw new Error(`Ambiguous upgrade path from schema version ${current}.`)
    const step = outgoing[0]
    if (!step || compareSchemaVersions(step.to, current) <= 0 || compareSchemaVersions(step.to, target) > 0) throw new Error(`No upgrade route from schema version ${current} to ${target}.`)
    result.push(step)
    current = step.to
  }
  return result
}

/** Stable structural contracts for CI snapshots; semantic policy is separately tested. */
export function getSchemaSnapshot(version: string | number): Record<string, unknown> {
  const normalized = normalizeSchemaVersion(version)
  const schema = normalized === '1.0.0' ? LegacyAdventureSpec : normalized === '2.0.0' ? V2AdventureSpec : normalized === CURRENT_SCHEMA_VERSION ? LatestAdventureSpec : undefined
  if (!schema) throw new Error(`Unsupported schema version ${version}.`)
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>
}
