import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { adventureSpecJsonSchema } from '../src/spec/json-schema'

const out = join(import.meta.dirname, '..', 'schema', 'adventure-spec-v2.schema.json')
await writeFile(out, `${JSON.stringify(adventureSpecJsonSchema(), null, 2)}\n`)
console.log(`wrote ${out}`)
