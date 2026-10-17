import { describe, expect, it } from 'vitest'

import { buildRepairPrompt } from '../src/planner/prompt'

describe('buildRepairPrompt allowed ids', () => {
  it('lists declared ids and explains how to repair unknown references', () => {
    const previousOutput = JSON.stringify({
      adventure: {
        endings: [
          { id: 'ending-treaty', title: 'Treaty accepted' },
          { id: 'ending-resistance', title: 'Resistance holds' },
        ],
        stages: [
          { id: 'stage-landing', index: 0, title: 'The Landing' },
        ],
      },
    })
    const prompt = buildRepairPrompt(previousOutput, [{
      path: '$.adventure.stages.2.decision.options.2.branchTarget.endingId',
      message: 'unknown ending "ending-divided-front-page"',
    }], 1, 2)

    expect(prompt).toContain('## Allowed ids')
    expect(prompt).toContain('ending-treaty')
    expect(prompt).toContain('ending-resistance')
    expect(prompt).toContain('either repoint the option at one of the ending ids listed above, or declare the missing ending')
  })

  it('explains how an unknown stage id can be corrected to an ending target', () => {
    const previousOutput = JSON.stringify({
      adventure: {
        endings: [{ id: 'ending-confidence-drains-away', title: 'Confidence drains away' }],
        stages: [{ id: 'stage-landing', index: 0, title: 'The Landing' }],
      },
    })
    const prompt = buildRepairPrompt(previousOutput, [{
      path: '$.adventure.stages.0.decision.options.2.branchTarget.stageId',
      message: 'unknown stage "ending-confidence-drains-away"',
    }], 1, 2)

    expect(prompt).toContain('## Allowed ids')
    expect(prompt).toContain('ending-confidence-drains-away')
    expect(prompt).toContain('"kind": "ending"')
  })

  it('still returns a prompt when previous output is not JSON', () => {
    expect(() => buildRepairPrompt('{not json', [{
      path: '$.adventure.stages.0.decision.options.0.branchTarget.endingId',
      message: 'unknown ending "ending-missing"',
    }], 1, 2)).not.toThrow()
    expect(buildRepairPrompt('{not json', [{
      path: '$.adventure.stages.0.decision.options.0.branchTarget.endingId',
      message: 'unknown ending "ending-missing"',
    }], 1, 2)).not.toContain('## Allowed ids')
  })
})
