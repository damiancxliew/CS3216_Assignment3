import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FIXTURES_DIR } from '../src/fixtures'
import { adventureSpecJsonSchema } from '../src/spec/json-schema'

describe('committed JSON Schema', () => {
  it('matches the Zod schema (run `npm run schema` after changing v2.ts)', async () => {
    const committed = JSON.parse(await readFile(join(FIXTURES_DIR, '..', 'schema', 'adventure-spec-v2.schema.json'), 'utf8'))
    expect(committed).toEqual(adventureSpecJsonSchema())
  })

  it('is strict-structured-output friendly: every object closes additionalProperties and has no optional keys', () => {
    const schema = adventureSpecJsonSchema()
    const walk = (node: any, path: string) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'object' && node.properties) {
        expect(node.additionalProperties, `${path}.additionalProperties`).toBe(false)
        expect(Object.keys(node.properties).sort(), `${path}.required`).toEqual([...(node.required ?? [])].sort())
        Object.entries(node.properties).forEach(([k, v]) => walk(v, `${path}.${k}`))
      }
      if (node.items) walk(node.items, `${path}[]`)
      for (const branch of node.anyOf ?? node.oneOf ?? []) walk(branch, `${path}|`)
    }
    walk(schema, '$')
  })
})
