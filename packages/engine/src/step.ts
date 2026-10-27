/**
 * `createState` and `step`: the rules engine [C11, C12]. Rules decide everything that is true or changes;
 * the model only words character replies (and is checked afterwards, `postTurn`).
 *
 * One step:
 *   1. parse the action (a client `Action`, or the server-only `postTurn`);
 *   2. copy the state, so a refused action leaves the caller's state untouched;
 *   3. run time rules first (the final call), then the action's handler;
 *   4. run the rule loop to a fixpoint (state-watching triggers, act availability, story events, hints);
 *   5. return the new state, the events it produced and the projected view.
 */
import { Action } from '@adventure/play-contract'
import { z } from 'zod'

import { createContext, currentStage, fail, lookup, type EngineAction, type StepContext } from './context'
import { reply, requireConversation } from './conversation'
import { EngineError } from './errors'
import { evaluateStoryEvents } from './events'
import { evaluateHints } from './hints'
import { handleInterviewAnswer, startInterview } from './interview'
import { applyPostTurn, PostTurnActionSchema } from './postTurn'
import { project } from './project'
import { noteText } from './rules/knowledge'
import { chooseAct, openMoment, predict, refreshActs } from './rules/moment'
import { selectPassage } from './rules/passages'
import { refreshReadingChecks, submitReadingCheck } from './rules/reading'
import { applyTimer, enterStage, startStagePlay } from './rules/stages'
import { onNotePassed, settleTriggers } from './rules/triggers'
import type { EngineSpec } from './spec'
import { STATE_VERSION, type EngineState } from './state'
import type { StepDeps, StepInput, StepResult } from './types'

export const MAX_RULE_ROUNDS = 10

/**
 * `step` accepts the server-only `postTurn` as well as client actions. The API must parse request bodies with
 * `Action` from play-contract before calling `step`, so a client can never send `postTurn` itself.
 */
const EngineActionSchema = z.union([Action, PostTurnActionSchema])

export function createState(spec: EngineSpec, seed: string): EngineState {
  const characters: EngineState['characters'] = {}
  for (const character of spec.characters) {
    characters[character.id] = { stanceId: character.tier === 'major' ? character.initialStanceId : null, roomId: null, challenged: 0, replies: 0 }
  }
  return {
    v: STATE_VERSION,
    seed,
    phase: 'briefing',
    stageIndex: 0,
    stageIntroPending: false,
    stageOpening: null,
    stageStartedAt: null,
    stageEndsAt: null,
    playerRoomId: null,
    characters,
    discovered: [],
    notes: [],
    heldDocuments: [],
    documentRooms: {},
    openDocumentId: null,
    passedOn: [],
    confrontedSlants: [],
    firedTriggers: [],
    firedStoryEvents: [],
    transcript: [],
    pendingChecks: [],
    moment: null,
    acts: {},
    outcomes: {},
    predictions: {},
    closedEndings: [],
    lastPrediction: null,
    endingId: null,
    hints: { lastProgressAt: null, level: 0, pausedSince: null },
    interview: { answer: null, pushBack: null, response: null, closing: null, closed: false },
    ended: false,
    seq: 0,
  }
}

function setPhase(ctx: StepContext, to: EngineState['phase']): void {
  ctx.state.phase = to
  ctx.emit({ type: 'phase', to })
  ctx.touch()
}

/** Investigation ends when the defining moment begins: no walking, picking up or close reading after that. */
function requirePlaying(ctx: StepContext, what: string): void {
  if (ctx.state.phase !== 'stage' || ctx.state.stageIntroPending) fail('illegal_phase', `${what} needs an open stage`)
  if (ctx.state.moment !== null) fail('illegal_phase', `${what} is over: the defining moment has begun`)
}

async function handle(ctx: StepContext, action: EngineAction): Promise<void> {
  const { state, spec } = ctx
  switch (action.type) {
    case 'postTurn':
      return applyPostTurn(ctx, action)
    case 'tick':
      return
    case 'continue': {
      if (state.phase === 'briefing') {
        setPhase(ctx, 'stage')
        state.stageIndex = 0
        enterStage(ctx)
      } else if (state.phase === 'stage' && state.stageIntroPending) {
        startStagePlay(ctx)
      } else if (state.phase === 'epilogue') {
        setPhase(ctx, 'interview')
        startInterview(ctx)
      } else if (state.phase === 'interview' && state.interview.closed) {
        setPhase(ctx, 'reveal')
        state.ended = true
      } else fail('illegal_phase', 'nothing to continue past')
      return
    }
    case 'enterRoom': {
      requirePlaying(ctx, 'moving')
      if (!currentStage(ctx).rooms.some((room) => room.id === action.roomId)) fail('unknown_id', `no room ${action.roomId} in this stage`)
      if (state.playerRoomId !== action.roomId) {
        state.playerRoomId = action.roomId
        ctx.touch()
      }
      return
    }
    case 'openDocument': {
      const document = lookup.document(spec, action.documentId)
      // Re-reading a held document stays possible while deciding; picking up a new one does not.
      if (state.heldDocuments.includes(document.id) && state.phase === 'stage' && state.moment !== null) {
        state.openDocumentId = document.id
        ctx.touch()
        return
      }
      requirePlaying(ctx, 'reading')
      if (!state.heldDocuments.includes(document.id)) {
        if (state.documentRooms[document.id] !== state.playerRoomId) fail('not_present', `${document.title} is not here`)
        state.heldDocuments.push(document.id)
        delete state.documentRooms[document.id]
      }
      state.openDocumentId = document.id
      state.hints.pausedSince ??= ctx.now
      ctx.touch()
      return
    }
    case 'closeDocument': {
      if (state.openDocumentId === action.documentId) {
        state.openDocumentId = null
        state.hints.pausedSince = null
        ctx.touch()
      }
      return
    }
    case 'selectPassage': {
      requirePlaying(ctx, 'reading')
      if (!state.heldDocuments.includes(action.documentId)) fail('not_held', 'pick the document up first')
      const document = lookup.document(spec, action.documentId)
      if (action.end > document.body.length) fail('invalid_action', 'selection is outside the document')
      selectPassage(ctx, document, action.start, action.end)
      return
    }
    case 'submitReadingCheck': {
      requirePlaying(ctx, 'reading')
      return submitReadingCheck(ctx, action)
    }
    case 'message': {
      const character = requireConversation(ctx, action.characterId)
      const message = ctx.say('player', action.text, { characterId: character.id })
      return reply(ctx, character, message.id, { kind: 'message', text: action.text })
    }
    case 'insertNote': {
      const character = requireConversation(ctx, action.characterId)
      const note = state.notes.find((candidate) => candidate.id === action.noteId) ?? fail('not_held', `no note ${action.noteId}`)
      const message = ctx.say('player', action.text ?? '', { characterId: character.id, insertedNoteId: note.id })
      const effects = onNotePassed(ctx, character.id, note.discoveryId)
      return reply(ctx, character, message.id, { kind: 'note', note: noteText(spec, note.discoveryId), text: action.text ?? null }, {
        stanceJustChanged: effects.stanceChanged,
        handingOver: effects.handedOver,
        supportedNoteDiscoveryId: note.discoveryId,
      })
    }
    case 'endStage': {
      requirePlaying(ctx, 'the defining moment')
      const remainingMs = state.stageEndsAt === null ? null : Math.max(0, state.stageEndsAt - ctx.now)
      openMoment(ctx, 'student')
      if (state.moment !== null) state.moment.returnable = { remainingMs }
      return
    }
    case 'backToExploring': {
      const moment = state.moment
      if (state.phase !== 'stage' || moment?.status !== 'choosing' || moment.returnable === undefined) fail('illegal_phase', 'there is no decision to step back from')
      if (moment.returnable.remainingMs !== null) state.stageEndsAt = ctx.now + moment.returnable.remainingMs
      state.moment = null
      ctx.touch()
      return
    }
    case 'act':
      return chooseAct(ctx, action.actId)
    case 'predict': {
      const { final } = predict(ctx, action.outcomeId)
      if (final) {
        setPhase(ctx, 'epilogue')
      } else {
        state.stageIndex += 1
        enterStage(ctx)
      }
      return
    }
    case 'interviewAnswer':
      return handleInterviewAnswer(ctx, action)
  }
}

function settle(ctx: StepContext): void {
  for (let round = 0; round < MAX_RULE_ROUNDS; round += 1) {
    const before = ctx.touched
    settleTriggers(ctx)
    refreshReadingChecks(ctx)
    refreshActs(ctx)
    evaluateStoryEvents(ctx)
    applyTimer(ctx)
    if (ctx.touched === before) break
    if (round === MAX_RULE_ROUNDS - 1) throw new Error('engine rules did not settle; check the spec for trigger loops')
  }
  evaluateHints(ctx)
}

export async function step(input: StepInput<EngineSpec, EngineState, EngineAction>, deps: StepDeps): Promise<StepResult<EngineState>> {
  const parsed = EngineActionSchema.safeParse(input.action)
  if (!parsed.success) throw new EngineError('invalid_action', parsed.error.issues.map((issue) => issue.message).join('; '))
  const action = parsed.data as EngineAction
  const ctx = createContext(input.spec, structuredClone(input.state), action, deps)
  refreshReadingChecks(ctx)
  const finalCall = applyTimer(ctx)
  try {
    await handle(ctx, action)
  } catch (error) {
    // The timer ran out just before this action: the final call stands and the action is dropped.
    if (!(finalCall && error instanceof EngineError && error.code === 'illegal_phase')) throw error
  }
  settle(ctx)
  return { state: ctx.state, events: ctx.events, view: project(input.spec, ctx.state) }
}
