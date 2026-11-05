/**
 * Defining moments [P9], outcomes by rule [P9.3, G6] and closing endings [P9.9, G6.3].
 *
 * An act is offered while at least one outcome its rules can produce is still open. A secret act appears only
 * when enough of its unlock conditions hold [P9.11]. The outcome is the first matching rule for the act,
 * preferring open outcomes, with no randomness. Predictions list the moment's outcomes minus secret and
 * closed ones [P3.3].
 */
import { evaluate } from '../conditions'
import { currentMoment, fail, isFinalMoment, lookup, type StepContext } from '../context'
import type { EngineSpec, SpecAct, SpecMoment, SpecOutcome } from '../spec'
import type { EngineState } from '../state'
import { missingCore } from './knowledge'
import { requireDecisionPreparation } from './preparation'

function scope(spec: EngineSpec, state: EngineState, now: number) {
  return { spec, state, now }
}

export function outcomeOpen(state: EngineState, outcome: SpecOutcome): boolean {
  return outcome.endingId === undefined || !state.closedEndings.includes(outcome.endingId)
}

function outcomesOf(moment: SpecMoment, actId: string): SpecOutcome[] {
  const ids = new Set(moment.rules.filter((rule) => rule.actId === actId).map((rule) => rule.outcomeId))
  return moment.outcomes.filter((outcome) => ids.has(outcome.id))
}

export function secretUnlocked(spec: EngineSpec, state: EngineState, act: SpecAct, now: number): boolean {
  if (act.secret === undefined) return true
  const met = act.secret.unlock.filter((condition) => evaluate(condition, scope(spec, state, now))).length
  return met >= act.secret.minMet
}

export function availableActs(spec: EngineSpec, state: EngineState, moment: SpecMoment, now: number): SpecAct[] {
  return moment.acts.filter(
    (act) => secretUnlocked(spec, state, act, now) && outcomesOf(moment, act.id).some((outcome) => outcomeOpen(state, outcome)),
  )
}

export function predictionOptions(state: EngineState, moment: SpecMoment): SpecOutcome[] {
  return moment.outcomes.filter((outcome) => outcome.secret !== true && outcomeOpen(state, outcome))
}

export function resolveOutcome(spec: EngineSpec, state: EngineState, moment: SpecMoment, actId: string, now: number): SpecOutcome {
  const matching = moment.rules
    .filter((rule) => rule.actId === actId && evaluate(rule.when, scope(spec, state, now)))
    .map((rule) => moment.outcomes.find((outcome) => outcome.id === rule.outcomeId))
    .filter((outcome): outcome is SpecOutcome => outcome !== undefined)
  return matching.find((outcome) => outcomeOpen(state, outcome)) ?? matching[0] ?? fail('act_unavailable', `no outcome rule matches act ${actId}`)
}

/** Bring the defining moment to the student: on `endStage`, or as the final call when the timer runs out. */
export function openMoment(ctx: StepContext, reason: 'student' | 'finalCall'): void {
  requireDecisionPreparation(ctx)
  const moment = currentMoment(ctx)
  const { state } = ctx
  if (reason === 'finalCall' && !ctx.state.finalCallStages?.includes(ctx.spec.stages[ctx.state.stageIndex]!.id)) ctx.say('narration', moment.finalCallNarration)
  state.openDocumentId = null
  state.hints.pausedSince = null
  // The countdown has done its job once the moment is here.
  state.stageEndsAt = null
  const nudge = missingCore(ctx).length > 0 ? moment.nudge : null
  state.moment = { momentId: moment.id, status: 'choosing', availableActIds: [], actId: null, outcomeId: null, nudge }
  refreshActs(ctx)
  ctx.say('narration', moment.scene, { characterId: moment.deciderId })
  if (nudge !== null) ctx.say('narration', nudge)
  ctx.touch()
}

/** Keep the offered acts current while the student is choosing. Part of the fixpoint loop. */
export function refreshActs(ctx: StepContext): void {
  const current = ctx.state.moment
  if (current === null || current.status !== 'choosing') return
  const ids = availableActs(ctx.spec, ctx.state, lookup.moment(ctx.spec, current.momentId), ctx.now).map((act) => act.id)
  if (ids.join() === current.availableActIds.join()) return
  current.availableActIds = ids
  ctx.touch()
}

export function chooseAct(ctx: StepContext, actId: string): void {
  const { state, spec } = ctx
  if (state.moment?.status !== 'choosing') fail('illegal_phase', 'there is no act to choose now')
  const moment = lookup.moment(spec, state.moment.momentId)
  const act = state.moment.availableActIds.includes(actId) ? moment.acts.find((candidate) => candidate.id === actId) : undefined
  if (act === undefined) fail('act_unavailable', `act ${actId} is not available`)
  const outcome = resolveOutcome(spec, state, moment, act.id, ctx.now)
  state.acts[moment.id] = act.id
  state.moment = { ...state.moment, status: 'predicting', actId: act.id, outcomeId: outcome.id }
  ctx.emit({ type: 'act', momentId: moment.id, actId: act.id })
  ctx.say('narration', act.reaction, { characterId: moment.deciderId })
  ctx.touch()
}

/** Record the prediction and apply the outcome. Returns the outcome and whether the game moves to the epilogue. */
export function predict(ctx: StepContext, outcomeId: string): { outcome: SpecOutcome; final: boolean } {
  const { state, spec } = ctx
  if (state.moment?.status !== 'predicting' || state.moment.outcomeId === null) fail('illegal_phase', 'there is no prediction to make now')
  const moment = lookup.moment(spec, state.moment.momentId)
  const predicted = predictionOptions(state, moment).find((outcome) => outcome.id === outcomeId) ?? fail('unknown_id', `outcome ${outcomeId} is not a prediction option`)
  const outcome = moment.outcomes.find((candidate) => candidate.id === state.moment?.outcomeId) ?? fail('unknown_id', 'resolved outcome missing')
  state.predictions[moment.id] = predicted.id
  ctx.emit({ type: 'prediction', momentId: moment.id, outcomeId: predicted.id })

  const final = isFinalMoment(spec, moment)
  const closed = outcome.closesEndingIds.filter((endingId) => !state.closedEndings.includes(endingId))
  state.closedEndings.push(...closed)
  state.outcomes[moment.id] = outcome.id
  ctx.emit({ type: 'outcome', momentId: moment.id, outcomeId: outcome.id, endingId: final ? (outcome.endingId ?? null) : null, closedEndingIds: closed })
  state.lastPrediction = { predicted: predicted.predictionText, actual: outcome.summary, because: outcome.because }
  state.moment = null
  state.stageEndsAt = null
  state.openDocumentId = null
  if (final) state.endingId = outcome.endingId ?? null
  ctx.touch()
  return { outcome, final }
}
