/**
 * Schemas shared by `index.ts` (AdventureSpec) and `skeleton.ts` (SkeletonSpec). They live here so neither
 * module imports the other's values: `index.ts` re-exports `skeleton.ts`, and a value import back from it
 * is a cycle that bundlers evaluate out of order ("Cannot access … before initialization").
 */
import { z } from 'zod'

const Text = z.string()

export const DOCUMENT_KINDS = ['newspaper', 'letter', 'telegram', 'speech', 'minutes', 'memoir', 'treaty', 'report', 'other'] as const

export const Role = z.strictObject({
  name: Text,
  position: Text,
  relationships: z.array(Text),
  reputation: Text,
  stakes: Text,
  privateBrief: z.strictObject({ goals: z.array(Text), fears: z.array(Text), constraints: z.array(Text), knows: z.array(Text) }),
  situation: Text,
})
