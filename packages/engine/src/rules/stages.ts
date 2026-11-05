/**
 * Stage transitions [G2.1, P9.8] and the timer [P1, P1.2]. An earlier outcome never branches into a separate
 * stage: it changes the next stage's situation (stances, who is where, documents, the opening narration).
 * Stances carry across stages unless the situation sets them; characters remember (P11.3).
 */
import { currentMoment, currentStage, type StepContext } from '../context'
import type { SpecStage } from '../spec'
import type { EngineState } from '../state'
import { openMoment } from './moment'
import { decisionPreparation } from './preparation'

function matchingSituation(state: Pick<EngineState, 'outcomes'>, stage: SpecStage) {
  return stage.situations.find((situation) => state.outcomes[situation.whenOutcome.momentId] === situation.whenOutcome.outcomeId)
}

export function stageDocumentPlacement(state: Pick<EngineState, 'outcomes'>, stage: SpecStage) {
  const situation = matchingSituation(state, stage)
  return { ...stage.documentPlacement, ...situation?.documentPlacement }
}

/** Set up the current stage. Play starts on the `continue` past its opening. */
export function enterStage(ctx: StepContext): void {
  const { state, spec } = ctx
  const stage = currentStage(ctx)
  const situation = matchingSituation(state, stage)
  const placement = { ...stage.placement, ...situation?.placement }
  const documentPlacement = stageDocumentPlacement(state, stage)
  for (const character of spec.characters) {
    const existing = state.characters[character.id]
    const explicitStance = situation?.stances?.[character.id]
    const stanceId = explicitStance ?? existing?.stanceId ?? character.initialStanceId
    state.characters[character.id] = {
      stanceId: character.tier === 'major' ? stanceId : null,
      roomId: placement[character.id] ?? null,
      challenged: existing?.challenged ?? 0,
      replies: existing?.replies ?? 0,
      ...(existing?.trustRecoveryStanceId === undefined ? {} : { trustRecoveryStanceId: explicitStance === undefined ? existing.trustRecoveryStanceId : null }),
    }
  }
  state.documentRooms = {}
  for (const [documentId, room] of Object.entries(documentPlacement)) {
    if (state.heldDocuments.includes(documentId)) continue
    if (room === 'held') state.heldDocuments.push(documentId)
    else state.documentRooms[documentId] = room
  }
  state.playerRoomId = stage.startRoomId
  state.stageOpening = situation?.openingNarration ?? stage.openingNarration
  state.stageIntroPending = true
  state.stageStartedAt = null
  state.stageEndsAt = null
  state.openDocumentId = null
  state.pendingChecks = []
  state.moment = null
  ctx.touch()
}

/** Dismiss the stage opening: the clock starts now. */
export function startStagePlay(ctx: StepContext): void {
  const { state } = ctx
  state.stageIntroPending = false
  state.stageStartedAt = ctx.now
  const duration = stageDurationMs(ctx)
  state.stageEndsAt = duration === null ? null : ctx.now + duration
  state.hints = { lastProgressAt: ctx.now, level: 0, pausedSince: null }
  if (state.stageOpening !== null) ctx.say('narration', state.stageOpening)
  ctx.touch()
}

export function stageDurationMs(ctx: { spec: StepContext['spec']; state: StepContext['state'] }): number | null {
  const minutes = ctx.spec.timer.stageMinutes[ctx.state.stageIndex] ?? ctx.spec.timer.stageMinutes.at(-1)
  return ctx.spec.timer.enabled && minutes !== undefined ? Math.round(minutes * 60_000) : null
}

/** The final call: when the timer runs out, the defining moment comes to the student; they still choose. */
export function applyTimer(ctx: StepContext): boolean {
  const { state } = ctx
  if (state.phase !== 'stage' || state.stageIntroPending || state.moment !== null || state.stageEndsAt === null) return false
  if (ctx.now < state.stageEndsAt) return false
  const stageId = currentStage(ctx).id
  state.finalCallStages ??= []
  if (!state.finalCallStages.includes(stageId)) {
    state.finalCallStages.push(stageId)
    ctx.say('narration', currentMoment(ctx).finalCallNarration)
    ctx.touch()
  }
  // Checked stages offer a final decision; they never close an active investigation automatically.
  if (currentStage(ctx).preparation !== undefined) return false
  if (!decisionPreparation(ctx).ready) return false
  openMoment(ctx, 'finalCall')
  return true
}
