import type { PlannerOutput } from './schema'

/** The model sometimes labels an ending id as a stage (or the reverse). When the id unambiguously names the other kind, fix the label instead of spending a repair. */
export function fixBranchTargetKinds(adventure: PlannerOutput['adventure']): PlannerOutput['adventure'] {
  const stageIds = new Set(adventure.stages.map((stage) => stage.id))
  const endingIds = new Set(adventure.endings.map((ending) => ending.id))

  return {
    ...adventure,
    stages: adventure.stages.map((stage) => {
      let changed = false
      const options = stage.decision.options.map((option) => {
        const { branchTarget } = option
        if (branchTarget.kind === 'stage' && !stageIds.has(branchTarget.stageId) && endingIds.has(branchTarget.stageId)) {
          changed = true
          return { ...option, branchTarget: { kind: 'ending', endingId: branchTarget.stageId } as const }
        }
        if (branchTarget.kind === 'ending' && !endingIds.has(branchTarget.endingId) && stageIds.has(branchTarget.endingId)) {
          changed = true
          return { ...option, branchTarget: { kind: 'stage', stageId: branchTarget.endingId } as const }
        }
        return option
      })
      return changed ? { ...stage, decision: { ...stage.decision, options } } : stage
    }),
  }
}
