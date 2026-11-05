/**
 * LLM wire schema for the reveal pass — a single call, strict structured-output
 * friendly. Cites are dropped on merge; only the texts land in the spec.
 */
import { z } from 'zod'

const Id = z.string()
const Text = z.string()

const Cite = z.object({ sourceId: Id, quote: Text })

export const RevealLlmOutput = z.object({
  whatHappened: z.object({ text: Text, cites: z.array(Cite).min(1) }),
  interpretations: z.array(z.object({ text: Text, cites: z.array(Cite).min(1) })).max(4),
  interpretationsWarning: z.object({ message: Text, suggestedSources: z.array(Text) }).nullable(),
  corrections: z.array(z.object({ documentId: Id.nullable(), actId: Id.nullable(), text: Text })),
  couldHaveGone: z.array(z.object({ outcomeId: Id, text: Text })),
  teacherQuestions: z.array(Text),
})
export type RevealLlmOutput = z.infer<typeof RevealLlmOutput>
