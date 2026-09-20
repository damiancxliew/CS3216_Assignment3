/**
 * Loaders for the committed fixtures. The I1 fixture is the one hand-authored
 * valid spec everyone builds against (EXECUTION_SPEC §2); the source handout
 * next to it is what its spans resolve to.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractDocument } from './ingest/extract'
import type { ExtractedDocument } from './ingest/types'
import { type AdventureSpec, validateAdventureSpec } from './spec/v2'

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

export const I1_FIXTURE = {
  spec: 'singapore-1819.spec.json',
  source: { id: 'handout', file: 'sources/singapore-1819-handout.txt', title: 'The Founding of a Trading Post at Singapore, 1819 (classroom handout)' },
} as const

export async function loadFixtureJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8')) as unknown
}

export async function loadI1Spec(): Promise<AdventureSpec> {
  const result = validateAdventureSpec(await loadFixtureJson(I1_FIXTURE.spec))
  if (!result.ok) throw new Error(`I1 fixture is invalid:\n${result.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`)
  return result.spec
}

export async function loadI1Documents(): Promise<Map<string, ExtractedDocument>> {
  const text = await readFile(join(FIXTURES_DIR, I1_FIXTURE.source.file), 'utf8')
  const doc = await extractDocument({ id: I1_FIXTURE.source.id, title: I1_FIXTURE.source.title, kind: 'text', text })
  return new Map([[doc.id, doc]])
}
