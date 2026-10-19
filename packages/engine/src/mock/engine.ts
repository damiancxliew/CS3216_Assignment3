/**
 * `@adventure/engine/mock`: the engine interface with scripted content and no model calls, for building
 * screens before the real engine exists. Deterministic: the same actions at the same `now` give the same views.
 *
 * What it scripts (enough to draw every screen):
 * - briefing, then `continue` into stage 1 (an intro, then the timer starts on the second `continue`);
 * - `message` replies from a fixed list; every message leaves `pendingCheck` set until the next action
 *   (poll with `tick`), and the second message to the Temenggong then adds a note and a stance notice;
 * - a message containing "told me" or "I know" is challenged;
 * - `openDocument` + `selectPassage` over the key passage adds a note;
 * - `insertNote` to Raffles changes his stance;
 * - `endStage` (or the timer, on `tick`) opens the defining moment; `act`, then `predict`;
 * - stage 2 opens with the prediction revealed; then epilogue, Interview (one push-back) and reveal.
 */
import type {
  Action,
  DefiningMomentView,
  DocumentView,
  GameEvent,
  InterviewView,
  MessageView,
  NoteView,
  Phase,
  PlayerView,
} from '@adventure/play-contract'

import { EngineError } from '../errors'
import type { Engine, StepDeps, StepInput, StepResult } from '../types'
import { briefing, characters, documents, epilogue, interview, reveal, stages } from './script'

export const MOCK_STAGE_MS = 15 * 60_000
const MOCK_STANCE_LABELS = ['wary', 'warming', 'trusting']

export interface MockState {
  seed: string
  phase: Phase
  stageIndex: number
  introPending: boolean
  roomId: string | null
  stances: Record<string, string>
  messageCounts: Record<string, number>
  messages: MessageView[]
  notes: NoteView[]
  held: string[]
  openDocumentId: string | null
  pending: { characterId: string; count: number } | null
  moment: { status: 'choosing' | 'predicting'; actId: string | null; nudge: string | null } | null
  lastPrediction: { predicted: string; actual: string; because: string } | null
  timerEndsAt: number | null
  interview: Pick<InterviewView, 'answer' | 'pushBack' | 'response' | 'closing' | 'closed'>
  ended: boolean
  seq: number
}

type MockSpec = unknown

const stageAt = (state: MockState) => {
  const stage = stages[state.stageIndex]
  if (stage === undefined) throw new EngineError('illegal_phase', 'no stage')
  return stage
}

function fail(code: ConstructorParameters<typeof EngineError>[0], message: string): never {
  throw new EngineError(code, message)
}

export function createMockState(seed: string): MockState {
  return {
    seed,
    phase: 'briefing',
    stageIndex: 0,
    introPending: false,
    roomId: null,
    stances: { temenggong: 's1', raffles: 's1', hussein: 's1' },
    messageCounts: {},
    messages: [],
    notes: [],
    held: [],
    openDocumentId: null,
    pending: null,
    moment: null,
    lastPrediction: null,
    timerEndsAt: null,
    interview: { answer: null, pushBack: null, response: null, closing: null, closed: false },
    ended: false,
    seq: 0,
  }
}

/** The synchronous core, shared by `step` and the canned views. */
export function advanceMock(previous: MockState, action: Action, now: number): { state: MockState; events: GameEvent[] } {
  const state = structuredClone(previous)
  const events: GameEvent[] = []
  const stageIndex = state.phase === 'briefing' ? null : state.stageIndex
  const say = (kind: MessageView['kind'], text: string, extra: Partial<Pick<MessageView, 'characterId' | 'insertedNoteId'>> = {}) => {
    state.seq += 1
    state.messages.push({
      id: `m${state.seq}`,
      kind,
      characterId: extra.characterId ?? null,
      roomId: state.roomId,
      text,
      insertedNoteId: extra.insertedNoteId ?? null,
      at: now,
    })
  }
  const addNote = (discoveryId: string, text: string, source: NoteView['source']) => {
    if (state.notes.some((note) => note.text === text)) return
    state.seq += 1
    const id = `n${state.seq}`
    state.notes.push({ id, text, source, stageIndex: state.stageIndex, at: now })
    events.push({ type: 'discovery', at: now, stageIndex, discoveryId, noteId: id, core: true, via: source === 'document' ? 'passage' : 'conversation' })
  }
  const shiftStance = (characterId: string, notice: string) => {
    const ladder = characters[characterId]?.stances
    const from = state.stances[characterId]
    if (!ladder || from === undefined) return
    const to = ladder[Math.min(ladder.indexOf(from) + 1, ladder.length - 1)] as string
    if (to === from) return
    state.stances[characterId] = to
    say('notice', notice, { characterId })
    events.push({ type: 'stanceChange', at: now, stageIndex, characterId, from, to, cause: 'trigger', triggerId: `${characterId}-t1` })
  }
  const setPhase = (to: Phase) => {
    state.phase = to
    events.push({ type: 'phase', at: now, stageIndex: state.stageIndex, to })
  }
  const openMoment = () => {
    const stage = stageAt(state)
    state.moment = { status: 'choosing', actId: null, nudge: state.notes.length < 2 ? stage.nudge : null }
    say('narration', stage.scene, { characterId: stage.deciderId })
  }
  const requireStage = () => {
    if (state.phase !== 'stage' || state.introPending) fail('illegal_phase', `${action.type} needs an open stage`)
  }
  const presentHere = (characterId: string) => {
    const room = stageAt(state).placement[characterId]
    if (room === undefined) fail('unknown_id', `no character ${characterId} in this stage`)
    if (room !== state.roomId) fail('not_present', `${characterId} is not in this room`)
  }

  // The scripted post-turn check lands on the next action, as the real one lands from `after()`.
  if (state.pending !== null) {
    const { characterId, count } = state.pending
    state.pending = null
    if (characterId === 'temenggong' && count === 2) {
      addNote('d-price', 'The Temenggong wants his people to keep a share of the trade.', 'conversation')
      shiftStance('temenggong', 'The Temenggong leans back, a little less guarded.')
    }
  }

  switch (action.type) {
    case 'continue': {
      if (state.phase === 'briefing') {
        setPhase('stage')
        state.introPending = true
        state.roomId = stageAt(state).startRoomId
      } else if (state.phase === 'stage' && state.introPending) {
        state.introPending = false
        state.timerEndsAt = now + MOCK_STAGE_MS
        say('narration', stageAt(state).narration)
      } else if (state.phase === 'epilogue') {
        setPhase('interview')
        say('narration', interview.question, { characterId: null })
      } else if (state.phase === 'interview' && state.interview.closed) {
        setPhase('reveal')
        state.ended = true
      } else fail('illegal_phase', 'nothing to continue past')
      break
    }
    case 'tick': {
      if (state.phase === 'stage' && !state.introPending && state.moment === null && state.timerEndsAt !== null && now >= state.timerEndsAt) {
        say('narration', stageAt(state).finalCall)
        openMoment()
      }
      break
    }
    case 'enterRoom': {
      requireStage()
      if (!stageAt(state).rooms.some((room) => room.id === action.roomId)) fail('unknown_id', `no room ${action.roomId}`)
      state.roomId = action.roomId
      break
    }
    case 'message': {
      requireStage()
      if (state.moment !== null) fail('illegal_phase', 'the defining moment has begun')
      presentHere(action.characterId)
      const character = characters[action.characterId] as (typeof characters)[string]
      const count = (state.messageCounts[action.characterId] ?? 0) + 1
      state.messageCounts[action.characterId] = count
      say('player', action.text, { characterId: action.characterId })
      const challenged = /\b(told me|i know)\b/i.test(action.text)
      say('character', challenged ? 'Do you? Then why do I hear it from you, and not from him?' : (character.replies[(count - 1) % character.replies.length] as string), {
        characterId: action.characterId,
      })
      if (challenged) events.push({ type: 'challenge', at: now, stageIndex, characterId: action.characterId })
      state.pending = { characterId: action.characterId, count }
      break
    }
    case 'insertNote': {
      requireStage()
      presentHere(action.characterId)
      const note = state.notes.find((candidate) => candidate.id === action.noteId) ?? fail('not_held', `no note ${action.noteId}`)
      say('player', action.text ?? note.text, { characterId: action.characterId, insertedNoteId: note.id })
      if (action.characterId === 'raffles') {
        shiftStance('raffles', 'Raffles goes quiet for a moment.')
        say('character', 'A share of the trade? Then he can be bargained with. Good.', { characterId: 'raffles' })
      } else {
        say('character', 'I have heard as much.', { characterId: action.characterId })
      }
      break
    }
    case 'openDocument': {
      requireStage()
      const document = documents[action.documentId] ?? fail('unknown_id', `no document ${action.documentId}`)
      if (!state.held.includes(document.id)) {
        if (stageAt(state).documentPlacement[document.id] !== state.roomId) fail('not_present', 'that document is not here')
        state.held.push(document.id)
      }
      state.openDocumentId = document.id
      break
    }
    case 'closeDocument': {
      if (state.openDocumentId === action.documentId) state.openDocumentId = null
      break
    }
    case 'selectPassage': {
      requireStage()
      if (!state.held.includes(action.documentId)) fail('not_held', 'pick the document up first')
      const document = documents[action.documentId] as (typeof documents)[string]
      const { start, end } = document.keyPassage
      if (action.start < end && action.end > start) addNote('d-payment', document.note, 'document')
      break
    }
    case 'endStage': {
      requireStage()
      if (state.moment !== null) fail('illegal_phase', 'the defining moment has already begun')
      openMoment()
      break
    }
    case 'act': {
      if (state.moment?.status !== 'choosing') fail('illegal_phase', 'no act to choose now')
      const act = stageAt(state).acts.find((candidate) => candidate.id === action.actId) ?? fail('act_unavailable', `no act ${action.actId}`)
      state.moment = { ...state.moment, status: 'predicting', actId: act.id }
      say('narration', act.reaction)
      events.push({ type: 'act', at: now, stageIndex, momentId: `moment-${state.stageIndex}`, actId: act.id })
      break
    }
    case 'predict': {
      if (state.moment?.status !== 'predicting') fail('illegal_phase', 'no prediction to make now')
      const stage = stageAt(state)
      const predicted = stage.outcomes.find((outcome) => outcome.id === action.outcomeId) ?? fail('unknown_id', `no outcome ${action.outcomeId}`)
      // The script lists each stage's outcomes in the same order as its acts: act i leads to outcome i.
      const actual = stage.outcomes[stage.acts.findIndex((act) => act.id === state.moment?.actId)] ?? (stage.outcomes[0] as (typeof stage.outcomes)[number])
      const momentId = `moment-${state.stageIndex}`
      const final = state.stageIndex === stages.length - 1
      events.push({ type: 'prediction', at: now, stageIndex, momentId, outcomeId: predicted.id })
      events.push({ type: 'outcome', at: now, stageIndex, momentId, outcomeId: actual.id, endingId: final ? `ending-${actual.id}` : null, closedEndingIds: [] })
      state.lastPrediction = { predicted: predicted.text, actual: actual.summary, because: actual.because }
      state.moment = null
      state.timerEndsAt = null
      state.openDocumentId = null
      if (final) {
        setPhase('epilogue')
      } else {
        state.stageIndex += 1
        state.introPending = true
        state.roomId = stageAt(state).startRoomId
        events.push({ type: 'phase', at: now, stageIndex: state.stageIndex, to: 'stage' })
      }
      break
    }
    case 'interviewAnswer': {
      if (state.phase !== 'interview' || state.interview.closed) fail('illegal_phase', 'no Interview question open')
      if (!interview.verdicts.some((verdict) => verdict.id === action.verdictId)) fail('unknown_id', `no verdict ${action.verdictId}`)
      const answer = { verdictId: action.verdictId, evidenceNoteIds: action.evidenceNoteIds, text: action.text ?? null }
      const first = state.interview.answer === null
      events.push({ type: 'verdict', at: now, stageIndex: state.stageIndex, endingId: 'ending-treaty', verdictId: answer.verdictId, evidenceNoteIds: answer.evidenceNoteIds, stage: first ? 'initial' : 'final', text: answer.text })
      say('player', answer.text ?? (interview.verdicts.find((verdict) => verdict.id === answer.verdictId)?.text as string))
      if (first) {
        state.interview.answer = answer
        state.interview.pushBack = interview.pushBack
        say('character', interview.pushBack)
      } else {
        state.interview.response = answer
        state.interview.closing = interview.closing
        state.interview.closed = true
        say('character', interview.closing)
      }
      break
    }
  }
  return { state, events }
}

export function projectMock(state: MockState): PlayerView {
  const inStage = state.phase === 'stage'
  const stage = inStage ? stageAt(state) : null
  const moment = stage !== null && state.moment !== null ? momentView(state, stage) : null
  const document = (id: string): DocumentView => {
    const { keyPassage: _keyPassage, note: _note, ...visible } = documents[id] as (typeof documents)[string]
    return { ...visible, open: state.openDocumentId === id }
  }
  return {
    phase: state.phase,
    briefing,
    stage:
      stage === null
        ? null
        : {
            index: state.stageIndex,
            count: stages.length,
            title: stage.title,
            timePlace: stage.timePlace,
            centralQuestion: stage.centralQuestion,
            intro: state.introPending ? { narration: stage.narration, predictionReveal: state.lastPrediction } : null,
          },
    rooms: stage?.rooms.map((room) => ({ ...room })) ?? [],
    currentRoomId: inStage ? state.roomId : null,
    characters:
      stage === null || state.introPending
        ? []
        : Object.entries(stage.placement)
            .filter(([, room]) => room === state.roomId)
            .map(([id]) => {
              const character = characters[id] as (typeof characters)[string]
              const stanceId = character.stances === null ? null : (state.stances[id] ?? null)
              const level = stanceId === null ? -1 : (character.stances?.indexOf(stanceId) ?? -1)
              const stance = level < 0 ? null : { label: MOCK_STANCE_LABELS[level] ?? stanceId!, level }
              return { id, name: character.name, title: character.title, stanceId, stance, portraitKey: stanceId === null ? id : `${id}:${stanceId}` }
            }),
    messages: state.messages.map((message) => ({ ...message })),
    notes: state.notes.map((note) => ({ ...note })),
    documents: state.held.map(document),
    documentsHere:
      stage === null || state.introPending
        ? []
        : Object.entries(stage.documentPlacement)
            .filter(([, room]) => room === state.roomId)
            .map(([id]) => {
              const { kind, title } = documents[id] as (typeof documents)[string]
              return { id, kind, title, read: state.held.includes(id) }
            }),
    definingMoment: moment,
    timer: inStage && state.timerEndsAt !== null ? { endsAt: state.timerEndsAt, durationMs: MOCK_STAGE_MS } : null,
    pendingCheck: state.pending !== null,
    epilogue: state.phase === 'epilogue' || state.phase === 'interview' || state.phase === 'reveal' ? { ...epilogue } : null,
    interview:
      state.phase === 'interview' || state.phase === 'reveal'
        ? { interviewer: interview.interviewer, question: interview.question, verdicts: interview.verdicts.map((verdict) => ({ ...verdict })), ...structuredClone(state.interview) }
        : null,
    reveal: state.phase === 'reveal' ? revealView() : null,
    ended: state.ended,
  }
}

function momentView(state: MockState, stage: (typeof stages)[number]): DefiningMomentView {
  const moment = state.moment as NonNullable<MockState['moment']>
  const act = stage.acts.find((candidate) => candidate.id === moment.actId)
  return {
    momentId: `moment-${state.stageIndex}`,
    scene: stage.scene,
    deciderId: stage.deciderId,
    deciderName: characters[stage.deciderId]?.name ?? stage.deciderId,
    status: moment.status,
    acts: stage.acts.map(({ id, text }) => ({ id, text })),
    nudge: moment.nudge,
    chosenActId: moment.actId,
    reaction: act?.reaction ?? null,
    predictionOptions: moment.status === 'predicting' ? stage.outcomes.map(({ id, text }) => ({ outcomeId: id, text })) : [],
  }
}

function revealView(): NonNullable<PlayerView['reveal']> {
  return {
    whatHappened: reveal.whatHappened,
    pathVsHistory: stages.map((stage, stageIndex) => ({
      stageIndex,
      yours: stage.outcomes[0]?.summary ?? '',
      history: stage.outcomes[0]?.summary ?? '',
      matched: true,
      closedEndings: [],
    })),
    corrections: [...reveal.corrections],
    missedCore: [],
    more: {
      interpretations: ['Some historians stress British strategy; others stress the Malay rulers\' own interests.'],
      sources: { teacher: ['Classroom handout'], other: [], invented: ['Dialogue', 'The role of Ahmad'] },
      couldHaveGone: ['Had Raffles waited for Calcutta, the Dutch might have occupied the island first.'],
      secretPathExisted: true,
      playback: { acts: [], predictions: [], interview: [] },
    },
    teacherQuestions: [],
  }
}

/** The engine interface over the script. `spec` and `deps.llm`/`deps.rng` are ignored. */
export function createMockEngine(): Engine<MockSpec, MockState> {
  return {
    createState: (_spec, seed) => createMockState(seed),
    project: (_spec, state) => projectMock(state),
    async step({ state, action }: StepInput<MockSpec, MockState>, { now }: StepDeps): Promise<StepResult<MockState>> {
      const next = advanceMock(state, action, now)
      return { state: next.state, events: next.events, view: projectMock(next.state) }
    },
  }
}
