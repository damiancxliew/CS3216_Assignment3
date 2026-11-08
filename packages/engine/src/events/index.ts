/** Story events [P12, P14]. Each event fires once, in spec order, with one of the fixed effects. */
import { evaluate } from '../conditions'
import { currentStage, type StepContext } from '../context'
import { openMoment } from '../rules/moment'
import { stageDurationMs } from '../rules/stages'
import { decisionPreparation } from '../rules/preparation'
import type { SpecStoryEvent } from '../spec'

export function fireStoryEvent(ctx: StepContext, event: SpecStoryEvent): void {
  const { state } = ctx
  if (state.firedStoryEvents.includes(event.id)) return

  const characterId = 'characterId' in event ? (event.characterId ?? null) : null
  ctx.say('narration', event.text, { characterId })
  state.firedStoryEvents.push(event.id)
  ctx.emit({ type: 'storyEvent', eventId: event.id })

  switch (event.effect) {
    case 'summons':
    case 'news':
      break
    case 'move': {
      const character = state.characters[event.characterId]
      if (character !== undefined && currentStage(ctx).rooms.some((room) => room.id === event.toRoomId)) {
        character.roomId = event.toRoomId
      }
      break
    }
    case 'deliverDocument':
      if (!state.heldDocuments.includes(event.documentId)) {
        state.heldDocuments.push(event.documentId)
        delete state.documentRooms[event.documentId]
      }
      break
    case 'beginMoment':
      if (state.moment === null && decisionPreparation(ctx).ready && !('timerOut' in event.when)) openMoment(ctx, 'student')
      break
  }

  ctx.touch()
}

function shouldFire(ctx: StepContext, event: SpecStoryEvent, elapsed: number): boolean {
  const { state } = ctx
  if ('atSeconds' in event.when) return state.moment === null && elapsed >= event.when.atSeconds * 1000
  if ('condition' in event.when) return state.moment === null && evaluate(event.when.condition, { spec: ctx.spec, state, now: ctx.now })
  if ('stuck' in event.when) return false

  // A timerOut event may still fire while choosing if the student opened the moment early.
  const duration = stageDurationMs(ctx)
  return duration !== null && elapsed >= duration && (state.moment === null || state.moment.status === 'choosing')
}

export function evaluateStoryEvents(ctx: StepContext): void {
  const { state } = ctx
  if (state.phase !== 'stage' || state.stageIntroPending || state.stageStartedAt === null) return

  const stageId = currentStage(ctx).id
  const elapsed = ctx.now - state.stageStartedAt
  for (const event of ctx.spec.storyEvents) {
    if (event.stageId !== stageId || state.firedStoryEvents.includes(event.id) || !shouldFire(ctx, event, elapsed)) continue
    fireStoryEvent(ctx, event)
  }
}
