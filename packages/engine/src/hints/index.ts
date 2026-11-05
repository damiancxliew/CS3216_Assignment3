/** Escalating hints guide stuck students to missing core evidence, pausing during reading and ending with story. */
import { currentStage, type StepContext } from '../context'
import { fireStoryEvent } from '../events'
import { missingCore } from '../rules/knowledge'
import { preparationHint, preparationHintTarget } from '../rules/preparation'

export function evaluateHints(ctx: StepContext): void {
  const { state, spec, now } = ctx
  if (state.phase !== 'stage' || state.stageIntroPending || state.moment !== null || state.stageStartedAt === null) return

  const hints = state.hints
  if (hints.lastProgressAt !== null && hints.lastProgressAt !== hints.progressSeen) {
    hints.progressSeen = hints.lastProgressAt
    hints.stuckFrom = hints.lastProgressAt
  }
  hints.stuckFrom ??= hints.lastProgressAt ?? now

  if (hints.pausedSince !== null || state.pendingChecks.length > 0) {
    hints.pauseFrom ??= hints.pausedSince ?? now
    return
  }
  if (hints.pauseFrom !== null && hints.pauseFrom !== undefined) {
    hints.stuckFrom = (hints.stuckFrom ?? hints.lastProgressAt ?? now) + now - hints.pauseFrom
    hints.pauseFrom = null
  }

  const preparationTarget = preparationHintTarget(ctx, undefined, now)
  const missing = missingCore(ctx)
  if (preparationTarget !== undefined && !missing.some((discovery) => discovery.id === preparationTarget.id)) missing.unshift(preparationTarget)
  if (missing.length === 0) return

  const stageId = currentStage(ctx).id
  const target = preparationTarget ??
    missing.find(
      (discovery) =>
        spec.openQuestions.some((question) => question.stageId === stageId && question.discoveryIds.includes(discovery.id)) ||
        spec.hintAngles.some((angle) => angle.discoveryId === discovery.id),
    ) ?? missing[0]
  if (target === undefined) return

  const intervalStart = hints.stuckFrom ?? now
  const threshold =
    state.stageEndsAt === null
      ? 120_000
      : Math.min(180_000, Math.max(45_000, (0.5 * (state.stageEndsAt - intervalStart)) / missing.length))
  if (now - intervalStart < threshold) return

  let shownLevel: 1 | 2 | 3 | undefined
  for (let level = hints.level + 1; level <= 3; level += 1) {
    if (level === 1) {
      const question = spec.openQuestions.find((candidate) => candidate.stageId === stageId && candidate.discoveryIds.includes(target.id))
      if (question !== undefined) {
        ctx.say('thought', question.text)
        shownLevel = 1
        break
      }
      const guidance = preparationHint(ctx, undefined, now)
      if (preparationTarget !== undefined && guidance !== null) {
        ctx.say('thought', guidance)
        shownLevel = 1
        break
      }
    } else if (level === 2) {
      const angle = spec.hintAngles.find((candidate) => candidate.discoveryId === target.id)
      if (angle !== undefined) {
        ctx.say('thought', angle.text)
        shownLevel = 2
        break
      }
    } else {
      const event = spec.storyEvents.find(
        (candidate) => candidate.stageId === stageId && 'stuck' in candidate.when && !state.firedStoryEvents.includes(candidate.id),
      )
      if (event !== undefined) {
        fireStoryEvent(ctx, event)
        shownLevel = 3
        break
      }
    }
  }

  if (shownLevel === undefined) return
  ctx.emit({ type: 'hint', level: shownLevel, targetDiscoveryId: target.id })
  hints.level = shownLevel
  hints.stuckFrom = now
}
