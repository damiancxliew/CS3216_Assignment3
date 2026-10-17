/**
 * A part is one generation call with a fixed output schema and its own check (#209). Passes return their parts so a
 * later step can assemble the spec in code, and redo one part from its saved output instead of rerunning the pass.
 *
 * Part ids: `stage:<stageId>`, `persona:<characterId>`, `minors`, `link`, `moment:<momentId>`, `ending:<endingId>`, `reveal`.
 */
import type { CheckIssue } from '@adventure/spec-v3'

export interface PartRecord<T = unknown> {
  output: T
  /** what the part's own check still reports after its repair turns */
  issues: CheckIssue[]
}

export type Parts = Record<string, PartRecord>

/** Resume a call from a saved output: the first turn is a repair turn over `output` with `issues`. */
export interface PartResume {
  output: unknown
  issues: CheckIssue[]
}

export const partId = {
  stage: (id: string) => `stage:${id}`,
  persona: (id: string) => `persona:${id}`,
  minors: 'minors',
  link: 'link',
  moment: (id: string) => `moment:${id}`,
  ending: (id: string) => `ending:${id}`,
  reveal: 'reveal',
} as const
