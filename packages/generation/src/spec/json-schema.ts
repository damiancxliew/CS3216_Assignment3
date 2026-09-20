import { z } from 'zod'

import { adventureSpecObjectSchema, SPEC_SCHEMA_ID } from './v2'

/**
 * JSON Schema (draft 2020-12) for the structural half of Adventure Spec v2.
 * Cross-reference rules live in `refineAdventureSpec` and are not expressible
 * here; always run `validateAdventureSpec` as well. Used for the committed
 * `schema/adventure-spec-v2.schema.json` and for OpenAI structured outputs.
 */
export function adventureSpecJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(adventureSpecObjectSchema, { target: 'draft-2020-12', io: 'output' })
  return { $id: SPEC_SCHEMA_ID, title: 'Adventure Spec v2', ...schema }
}
