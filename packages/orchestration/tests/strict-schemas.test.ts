import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { toOpenAiStrictSchema } from '../src/llm/openai'
import { resolverNarrationSchema } from '../src/resolver/llm'
import { mintProposalsSchema } from '../src/stage/mint'

/** Every object property must be required in OpenAI strict mode; the fake client does not check this. */
function unrequired(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) return node.flatMap((item, index) => unrequired(item, `${path}[${index}]`))
  if (node === null || typeof node !== 'object') return []
  const record = node as Record<string, unknown>
  const missing: string[] = []
  if (record.properties && typeof record.properties === 'object') {
    const required = new Set((record.required as string[] | undefined) ?? [])
    for (const key of Object.keys(record.properties)) if (!required.has(key)) missing.push(`${path}.${key}`)
  }
  return [...missing, ...Object.entries(record).flatMap(([key, value]) => unrequired(value, `${path}/${key}`))]
}

describe('strict structured-output schemas', () => {
  it.each([
    ['resolver_narration', resolverNarrationSchema],
    ['option_minting', mintProposalsSchema],
  ])('%s lists every property as required', (_name, schema) => {
    expect(unrequired(toOpenAiStrictSchema(z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>))).toEqual([])
  })
})
