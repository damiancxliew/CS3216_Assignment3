import { z } from 'zod'
import { LegacyAdventureSpec, LatestAdventureSpec, validateSpec } from './index.js'
import type { AdventureSpec, SpecIssue } from './index.js'

/** This is the persisted contract version, independent of the database's content revision. */
export const CURRENT_SCHEMA_VERSION = 2 as const
export type SchemaVersion = 1 | 2
export type SchemaSupport = 'current' | 'best_effort'
export const SCHEMA_REGISTRY = Object.freeze([
  Object.freeze({ version: 1, title: 'Original adventure format', support: 'best_effort' as const }),
  Object.freeze({ version: CURRENT_SCHEMA_VERSION, title: 'Evidence preparation', support: 'current' as const }),
])

export type UpgradeDescriptor = Readonly<{
  id: string
  from: number
  to: number
  title: string
  summary: string
  kind: 'content' | 'structural'
  requirements: readonly string[]
}>

/** Descriptors declare upgrade capability. Execution lives in the authoring service. */
export const UPGRADE_REGISTRY: readonly UpgradeDescriptor[] = Object.freeze([
  Object.freeze({
    id: 'evidence-preparation', from: 1, to: 2,
    title: 'Add evidence preparation',
    summary: 'Add reading questions, relevant character preparation, and essential conversations before decisions.',
    kind: 'content' as const,
    requirements: Object.freeze(['readingChecks', 'stagePreparation', 'teacherReview']),
  }),
])

/** Read only the format marker; structural validation remains the decoder's responsibility. */
export function getSchemaVersion(raw: unknown): SchemaVersion | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const version = (raw as Record<string, unknown>).schemaVersion
  if (version === undefined) return 1
  return version === 1 || version === CURRENT_SCHEMA_VERSION ? version : undefined
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
export function getUpgradePath(from: number, to: number = CURRENT_SCHEMA_VERSION, registry: readonly UpgradeDescriptor[] = UPGRADE_REGISTRY): UpgradeDescriptor[] {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) throw new Error('Upgrade versions must be positive integers in ascending order.')
  const known = new Set(registry.flatMap(step => [step.from, step.to]))
  if (!known.has(from) || !known.has(to)) throw new Error(`Unsupported upgrade path from schema version ${from} to ${to}.`)
  const result: UpgradeDescriptor[] = []
  let current = from
  while (current < to) {
    const outgoing = registry.filter(step => step.from === current)
    if (outgoing.length > 1) throw new Error(`Ambiguous upgrade path from schema version ${current}.`)
    const step = outgoing[0]
    if (!step || !Number.isSafeInteger(step.to) || step.to <= current || step.to > to) throw new Error(`No upgrade route from schema version ${current} to ${to}.`)
    result.push(step)
    current = step.to
  }
  return result
}

/** Stable structural contracts for CI snapshots; semantic policy is separately tested. */
export function getSchemaSnapshot(version: number): Record<string, unknown> {
  const schema = version === 1 ? LegacyAdventureSpec : version === 2 ? LatestAdventureSpec : undefined
  if (!schema) throw new Error(`Unsupported schema version ${version}.`)
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>
}
