import { describe, expect, expectTypeOf, it } from 'vitest'

import { ACTION_TYPES, Action, ClassSummary, DefiningMomentView, DocumentHereView, GameEvent, MAX_MESSAGE_LENGTH, PlayerView } from '../src'

const examples: Action[] = [
  { type: 'message', characterId: 'temenggong', text: 'Why did you leave Riau?' },
  { type: 'insertNote', characterId: 'raffles', noteId: 'n1' },
  { type: 'insertNote', characterId: 'raffles', noteId: 'n1', text: 'You should hear this.' },
  { type: 'selectPassage', documentId: 'd1', start: 10, end: 80 },
  { type: 'enterRoom', roomId: 'balai' },
  { type: 'openDocument', documentId: 'd1' },
  { type: 'closeDocument', documentId: 'd1' },
  { type: 'endStage' },
  { type: 'act', actId: 'a1' },
  { type: 'predict', outcomeId: 'o1' },
  { type: 'interviewAnswer', verdictId: 'v1', evidenceNoteIds: ['n1', 'n2'] },
  { type: 'continue' },
  { type: 'tick' },
]

describe('Action', () => {
  it('accepts one example of every action type', () => {
    for (const example of examples) expect(Action.parse(example)).toEqual(example)
    expect(new Set(examples.map((example) => example.type))).toEqual(new Set(ACTION_TYPES))
  })

  it('rejects unknown types, including the server-only post-turn result', () => {
    expect(Action.safeParse({ type: 'postTurn', messageId: 'm1', result: {} }).success).toBe(false)
    expect(Action.safeParse({ type: 'resolve' }).success).toBe(false)
  })

  it('rejects unknown keys, so a client cannot smuggle fields to the engine', () => {
    expect(Action.safeParse({ type: 'act', actId: 'a1', outcomeId: 'o9' }).success).toBe(false)
  })

  it('bounds free text and trims it', () => {
    expect(Action.safeParse({ type: 'message', characterId: 'c', text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }).success).toBe(false)
    expect(Action.safeParse({ type: 'message', characterId: 'c', text: '   ' }).success).toBe(false)
    expect(Action.parse({ type: 'message', characterId: 'c', text: '  hello ' })).toMatchObject({ text: 'hello' })
  })

  it('rejects an empty or backwards passage selection', () => {
    expect(Action.safeParse({ type: 'selectPassage', documentId: 'd', start: 5, end: 5 }).success).toBe(false)
    expect(Action.safeParse({ type: 'selectPassage', documentId: 'd', start: 9, end: 2 }).success).toBe(false)
    expect(Action.safeParse({ type: 'selectPassage', documentId: 'd', start: 0, end: 1e9 }).success).toBe(false)
  })

  it('caps the evidence notes in an Interview answer', () => {
    const evidenceNoteIds = ['1', '2', '3', '4', '5', '6']
    expect(Action.safeParse({ type: 'interviewAnswer', verdictId: 'v', evidenceNoteIds }).success).toBe(false)
  })

  it('has no server-only action in its type', () => {
    expectTypeOf<Extract<Action, { type: 'postTurn' }>>().toEqualTypeOf<never>()
  })
})

describe('GameEvent', () => {
  it('parses each event kind', () => {
    const base = { at: 1, stageIndex: 0 }
    const events = [
      { ...base, type: 'discovery', discoveryId: 'd', noteId: 'n', core: true, via: 'conversation' },
      { ...base, type: 'stanceChange', characterId: 'c', from: 's1', to: 's2', cause: 'trigger', triggerId: 't' },
      { ...base, type: 'challenge', characterId: 'c' },
      { ...base, type: 'act', momentId: 'm', actId: 'a' },
      { ...base, type: 'prediction', momentId: 'm', outcomeId: 'o' },
      { ...base, type: 'outcome', momentId: 'm', outcomeId: 'o', endingId: null, closedEndingIds: ['e3'] },
      { ...base, type: 'verdict', endingId: 'e', verdictId: 'v', evidenceNoteIds: [], stage: 'initial', text: null },
      { ...base, type: 'hint', level: 2, targetDiscoveryId: 'd' },
      { ...base, type: 'storyEvent', eventId: 'se' },
      { ...base, type: 'flag', messageId: 'm', category: 'abusive', reason: null },
      { ...base, type: 'phase', to: 'epilogue' },
    ]
    for (const event of events) expect(GameEvent.parse(event)).toEqual(event)
  })
})

describe('PlayerView and ClassSummary', () => {
  it('parse minimal values', () => {
    const view: PlayerView = {
      phase: 'briefing',
      briefing: {
        name: 'Ahmad',
        position: 'Interpreter',
        relationships: [],
        reputation: '',
        stakes: '',
        privateBrief: { goals: [], fears: [], constraints: [], knows: [] },
        situation: '',
      },
      stage: null,
      rooms: [],
      currentRoomId: null,
      characters: [],
      speakers: [],
      messages: [],
      notes: [],
      documents: [],
      documentsHere: [],
      definingMoment: null,
      timer: null,
      pendingCheck: false,
      epilogue: null,
      interview: null,
      reveal: null,
      ended: false,
    }
    expect(PlayerView.parse(view)).toEqual(view)
    expect(DocumentHereView.parse({ id: 'document-1', kind: 'letter', title: 'A letter', read: true })).toEqual({
      id: 'document-1',
      kind: 'letter',
      title: 'A letter',
      read: true,
    })

    const summary: ClassSummary = {
      adventureId: 'golden-1819',
      attempts: 0,
      completed: 0,
      stuck: [],
      predictions: [],
      verdicts: [],
      discoveries: [],
      endings: [],
      answers: [],
      flags: [],
    }
    expect(ClassSummary.parse(summary)).toEqual(summary)
  })
})

describe('DefiningMomentView', () => {
  it('requires the decider name', () => {
    const moment = {
      momentId: 'm1',
      scene: 'The moment opens.',
      deciderId: 'temenggong',
      deciderName: 'Temenggong Abdul Rahman',
      status: 'choosing',
      acts: [],
      nudge: null,
      chosenActId: null,
      reaction: null,
      predictionOptions: [],
    }
    expect(DefiningMomentView.parse(moment)).toEqual(moment)
    const { deciderName, ...withoutName } = moment
    expect(deciderName).toBe('Temenggong Abdul Rahman')
    expect(DefiningMomentView.safeParse(withoutName).success).toBe(false)
  })
})
