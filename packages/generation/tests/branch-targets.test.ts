import { describe, expect, it } from 'vitest'

import { fixBranchTargetKinds } from '../src/planner/branch-targets'
import type { PlannerOutput } from '../src/planner/schema'

describe('fixBranchTargetKinds', () => {
  it('corrects only targets that unambiguously name the other kind without mutating the input', () => {
    const input = {
      endings: [{ id: 'ending-confidence-drains-away' }],
      stages: [
        {
          id: 'stage-landing',
          decision: {
            options: [
              { branchTarget: { kind: 'ending', endingId: 'stage-succession' } },
              { branchTarget: { kind: 'stage', stageId: 'unknown-id' } },
              { branchTarget: { kind: 'stage', stageId: 'ending-confidence-drains-away' } },
              { branchTarget: { kind: 'stage', stageId: 'stage-landing' } },
              { branchTarget: { kind: 'ending', endingId: 'ending-confidence-drains-away' } },
            ],
          },
        },
        { id: 'stage-succession', decision: { options: [] } },
      ],
    } as unknown as PlannerOutput['adventure']
    const before = structuredClone(input)

    const result = fixBranchTargetKinds(input)

    expect(result).not.toBe(input)
    expect(input).toEqual(before)
    expect(result.stages[0]!.decision.options.map((option) => option.branchTarget)).toEqual([
      { kind: 'stage', stageId: 'stage-succession' },
      { kind: 'stage', stageId: 'unknown-id' },
      { kind: 'ending', endingId: 'ending-confidence-drains-away' },
      { kind: 'stage', stageId: 'stage-landing' },
      { kind: 'ending', endingId: 'ending-confidence-drains-away' },
    ])
  })
})
