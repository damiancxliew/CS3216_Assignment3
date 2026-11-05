/**
 * Merge the reveal output into the endings spec: reveal fields become plain strings
 * (cites dropped), teacherQuestions set. Everything else stays byte-identical.
 */
import type { AdventureSpec } from '@adventure/spec-v3'

import type { RevealLlmOutput } from './schema'

export function mergeReveal(draft: AdventureSpec, output: RevealLlmOutput): AdventureSpec {
  return {
    ...draft,
    reveal: {
      whatHappened: output.whatHappened.text,
      interpretations: output.interpretations.map((i) => i.text),
      corrections: output.corrections.map((c) => c.text),
      couldHaveGone: output.couldHaveGone.map((c) => c.text),
    },
    teacherQuestions: output.teacherQuestions,
  }
}
