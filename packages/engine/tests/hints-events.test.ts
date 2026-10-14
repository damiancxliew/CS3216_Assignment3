import { GameEvent, PlayerView } from '@adventure/play-contract'
import { describe, expect, it } from 'vitest'

import { EngineSpec, type EngineSpec as EngineSpecType, type SpecStoryEvent } from '../src'
import { Harness } from './fixtures/harness'
import { mini } from './fixtures/mini'

const MINUTE = 60_000

const openQuestions: EngineSpecType['openQuestions'] = [
  { id: 'question-a1', stageId: 's1', text: 'What does A want?', discoveryIds: ['d-a1'] },
  { id: 'question-a2', stageId: 's1', text: 'What does A fear?', discoveryIds: ['d-a2'] },
]

const hintAngles: EngineSpecType['hintAngles'] = [
  { id: 'angle-a1', discoveryId: 'd-a1', kind: 'ask', text: 'Ask A about the trade.' },
]

const stuckEvent: SpecStoryEvent = {
  id: 'stuck-news',
  stageId: 's1',
  when: { stuck: true },
  effect: 'news',
  text: 'A trader brings news.',
}

type SpecOverrides = Partial<Pick<EngineSpecType, 'timer' | 'discoveries' | 'openQuestions' | 'hintAngles' | 'storyEvents'>>

function makeSpec(overrides: SpecOverrides = {}): EngineSpecType {
  return EngineSpec.parse({
    ...structuredClone(mini),
    openQuestions,
    hintAngles,
    storyEvents: [stuckEvent],
    ...overrides,
  })
}

function parseOutput(game: Harness, view: Awaited<ReturnType<Harness['act']>>): void {
  PlayerView.parse(view)
  for (const event of game.events) GameEvent.parse(event)
}

type HarnessAction = Parameters<Harness['act']>[0]

async function act(game: Harness, action: HarnessAction) {
  const view = await game.act(action)
  parseOutput(game, view)
  return view
}

async function start(game: Harness) {
  await act(game, { type: 'continue' })
  return act(game, { type: 'continue' })
}

async function checkTurn(game: Harness, script: Parameters<Harness['check']>[0] = {}) {
  const view = await game.check(script)
  parseOutput(game, view)
  return view
}

async function tick(game: Harness) {
  return act(game, { type: 'tick' })
}

describe('hints', () => {
  it('shows the first open-question hint at the 150-second threshold without granting a discovery', async () => {
    const game = new Harness(makeSpec())
    await start(game)

    game.advance(149_000)
    expect((await tick(game)).messages.filter((message) => message.kind === 'thought')).toEqual([])
    expect(game.eventsOf('hint')).toEqual([])

    game.advance(2_000)
    const view = await tick(game)
    expect(view.messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A want?')
    expect(game.eventsOf('hint')).toMatchObject([{ level: 1, targetDiscoveryId: 'd-a1' }])
    expect(game.state.discovered).toEqual([])
  })

  it('waits a fresh threshold from the first hint before showing the angle', async () => {
    const game = new Harness(makeSpec())
    await start(game)
    game.advance(151_000)
    await tick(game)

    game.advance(112_249)
    expect((await tick(game)).messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A want?')
    expect(game.eventsOf('hint')).toHaveLength(1)

    game.advance(1)
    const view = await tick(game)
    expect(view.messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('Ask A about the trade.')
    expect(game.eventsOf('hint')).toMatchObject([
      { level: 1, targetDiscoveryId: 'd-a1' },
      { level: 2, targetDiscoveryId: 'd-a1' },
    ])
    expect(game.state.discovered).toEqual([])
  })

  it('ends escalation with a stuck story event and shows no more hints until progress', async () => {
    const game = new Harness(makeSpec())
    await start(game)
    game.advance(151_000)
    await tick(game)
    game.advance(112_250)
    await tick(game)
    game.advance(84_188)

    const view = await tick(game)
    expect(view.messages.at(-1)).toMatchObject({ kind: 'narration', characterId: null, text: stuckEvent.text })
    expect(game.eventsOf('storyEvent')).toMatchObject([{ eventId: stuckEvent.id }])
    expect(game.eventsOf('hint')).toMatchObject([
      { level: 1, targetDiscoveryId: 'd-a1' },
      { level: 2, targetDiscoveryId: 'd-a1' },
      { level: 3, targetDiscoveryId: 'd-a1' },
    ])
    expect(game.state.discovered).toEqual([])

    game.advance(100_000)
    await tick(game)
    expect(game.eventsOf('hint')).toHaveLength(3)
    expect(game.eventsOf('storyEvent')).toHaveLength(1)
    expect(game.state.discovered).toEqual([])
  })

  it('resets escalation to level one after a discovery', async () => {
    const game = new Harness(makeSpec())
    await start(game)
    game.advance(151_000)
    await tick(game)

    await act(game, { type: 'message', characterId: 'a', text: 'What do you know?' })
    await checkTurn(game, { conveyed: ['d-a1'] })
    expect(game.state.discovered).toEqual(['d-a1'])
    expect(game.state.hints.level).toBe(0)

    game.advance(179_999)
    expect(game.eventsOf('hint')).toHaveLength(1)
    await tick(game)
    expect(game.eventsOf('hint')).toHaveLength(1)

    game.advance(1)
    const view = await tick(game)
    expect(view.messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A fear?')
    expect(game.eventsOf('hint')).toMatchObject([
      { level: 1, targetDiscoveryId: 'd-a1' },
      { level: 1, targetDiscoveryId: 'd-a2' },
    ])
    expect(game.state.discovered).toEqual(['d-a1'])
  })

  it('pauses the clock while a document is open and while a post-turn check is pending', async () => {
    const documentGame = new Harness(makeSpec())
    await start(documentGame)
    documentGame.advance(100_000)
    await act(documentGame, { type: 'enterRoom', roomId: 'r2' })
    expect((await act(documentGame, { type: 'openDocument', documentId: 'letter' })).documents.find((document) => document.id === 'letter')?.open).toBe(true)

    documentGame.advance(150_000)
    expect((await tick(documentGame)).messages.filter((message) => message.kind === 'thought')).toEqual([])
    await act(documentGame, { type: 'closeDocument', documentId: 'letter' })
    documentGame.advance(12_499)
    await tick(documentGame)
    expect(documentGame.eventsOf('hint')).toEqual([])
    documentGame.advance(1)
    expect((await tick(documentGame)).messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A want?')

    const pendingGame = new Harness(makeSpec())
    await start(pendingGame)
    pendingGame.advance(100_000)
    await act(pendingGame, { type: 'message', characterId: 'a', text: 'Tell me more.' })
    expect(pendingGame.state.pendingChecks).toHaveLength(1)
    pendingGame.advance(150_000)
    await tick(pendingGame)
    expect(pendingGame.eventsOf('hint')).toEqual([])
    await checkTurn(pendingGame)
    pendingGame.advance(12_499)
    await tick(pendingGame)
    expect(pendingGame.eventsOf('hint')).toEqual([])
    pendingGame.advance(1)
    expect((await tick(pendingGame)).messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A want?')
  })

  it('uses a 120-second threshold when there is no stage timer', async () => {
    const game = new Harness(makeSpec({ timer: { enabled: false, stageMinutes: [] } }))
    await start(game)

    game.advance(119_999)
    expect((await tick(game)).messages.filter((message) => message.kind === 'thought')).toEqual([])
    game.advance(1)
    expect((await tick(game)).messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A want?')
  })

  it('uses the 45-second lower clamp when little time remains', async () => {
    const game = new Harness(makeSpec({ timer: { enabled: true, stageMinutes: [1] } }))
    await start(game)

    game.advance(44_999)
    expect((await tick(game)).messages.filter((message) => message.kind === 'thought')).toEqual([])
    game.advance(1)
    expect((await tick(game)).messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('What does A want?')
  })

  it('shows no hints with no missing core discovery, during the stage intro, or after the moment begins', async () => {
    const noCore = structuredClone(mini).discoveries.map((discovery) =>
      discovery.stageId === 's1' ? { ...discovery, core: false } : discovery,
    )
    const noCoreGame = new Harness(makeSpec({ discoveries: noCore }))
    await start(noCoreGame)
    noCoreGame.advance(300_000)
    await tick(noCoreGame)
    expect(noCoreGame.eventsOf('hint')).toEqual([])

    const introGame = new Harness(makeSpec())
    await act(introGame, { type: 'continue' })
    introGame.advance(300_000)
    await tick(introGame)
    expect(introGame.state.stageIntroPending).toBe(true)
    expect(introGame.eventsOf('hint')).toEqual([])

    const momentGame = new Harness(makeSpec())
    await start(momentGame)
    await act(momentGame, { type: 'endStage' })
    momentGame.advance(300_000)
    await tick(momentGame)
    expect(momentGame.state.moment).not.toBeNull()
    expect(momentGame.eventsOf('hint')).toEqual([])
  })

  it('skips an unavailable level and reports the level that was actually shown', async () => {
    const game = new Harness(makeSpec({ openQuestions: [], storyEvents: [] }))
    await start(game)
    game.advance(150_000)

    const view = await tick(game)
    expect(view.messages.filter((message) => message.kind === 'thought').at(-1)?.text).toBe('Ask A about the trade.')
    expect(game.eventsOf('hint')).toMatchObject([{ level: 2, targetDiscoveryId: 'd-a1' }])
  })
})

describe('story events', () => {
  it('fires an atSeconds event once and a summons does not move its character', async () => {
    const event: SpecStoryEvent = {
      id: 'summons-b',
      stageId: 's1',
      when: { atSeconds: 5 },
      effect: 'summons',
      characterId: 'b',
      text: 'B asks you to come.',
    }
    const game = new Harness(makeSpec({ storyEvents: [event] }))
    await start(game)

    game.advance(4_999)
    await tick(game)
    expect(game.eventsOf('storyEvent')).toEqual([])
    game.advance(1)
    const view = await tick(game)
    expect(game.eventsOf('storyEvent')).toMatchObject([{ eventId: event.id }])
    expect(game.state.characters.b?.roomId).toBe('r2')
    expect(view.characters.map((character) => character.id)).not.toContain('b')
    expect(view.messages.at(-1)).toMatchObject({ kind: 'narration', characterId: 'b', text: event.text })

    await tick(game)
    expect(game.eventsOf('storyEvent')).toHaveLength(1)
  })

  it('fires condition events when a discovery is made', async () => {
    const event: SpecStoryEvent = {
      id: 'discovery-news',
      stageId: 's1',
      when: { condition: { discovered: 'd-a1' } },
      effect: 'news',
      text: 'News arrives after A tells you.',
    }
    const game = new Harness(makeSpec({ storyEvents: [event] }))
    await start(game)
    await act(game, { type: 'message', characterId: 'a', text: 'What do you know?' })
    await checkTurn(game, { conveyed: ['d-a1'] })

    expect(game.eventsOf('storyEvent')).toMatchObject([{ eventId: event.id }])
    expect(game.view?.messages.at(-1)).toMatchObject({ kind: 'narration', characterId: null, text: event.text })
  })

  it('moves a character into the player room, and skips a destination outside the stage', async () => {
    const move: SpecStoryEvent = {
      id: 'move-b',
      stageId: 's1',
      when: { atSeconds: 0 },
      effect: 'move',
      characterId: 'b',
      toRoomId: 'r1',
      text: 'B comes into the hall.',
    }
    const moved = new Harness(makeSpec({ storyEvents: [move] }))
    const movedView = await start(moved)
    expect(moved.state.characters.b?.roomId).toBe('r1')
    expect(movedView.characters.map((character) => character.id)).toContain('b')

    const invalidMove: SpecStoryEvent = { ...move, id: 'move-outside', toRoomId: 'outside' }
    const notMoved = new Harness(makeSpec({ storyEvents: [invalidMove] }))
    await start(notMoved)
    expect(notMoved.state.characters.b?.roomId).toBe('r2')
    expect(notMoved.eventsOf('storyEvent')).toMatchObject([{ eventId: invalidMove.id }])
  })

  it('delivers a document into the projected held-document view', async () => {
    const event: SpecStoryEvent = {
      id: 'deliver-letter',
      stageId: 's1',
      when: { atSeconds: 0 },
      effect: 'deliverDocument',
      documentId: 'letter',
      characterId: 'a',
      text: 'A gives you the letter.',
    }
    const game = new Harness(makeSpec({ storyEvents: [event] }))
    const view = await start(game)

    expect(game.state.heldDocuments).toContain('letter')
    expect(game.state.documentRooms.letter).toBeUndefined()
    expect(view.documents.find((document) => document.id === 'letter')).toMatchObject({ id: 'letter', open: false })
    expect(view.messages.at(-1)).toMatchObject({ characterId: 'a', text: event.text })
  })

  it('begins the defining moment when a story event requests it', async () => {
    const event: SpecStoryEvent = {
      id: 'begin-moment',
      stageId: 's1',
      when: { atSeconds: 0 },
      effect: 'beginMoment',
      text: 'The decision can no longer wait.',
    }
    const game = new Harness(makeSpec({ storyEvents: [event] }))
    const view = await start(game)

    expect(view.definingMoment).not.toBeNull()
    expect(game.state.moment?.status).toBe('choosing')
    expect(game.eventsOf('storyEvent')).toMatchObject([{ eventId: event.id }])
  })

  it('gates events during the intro and after the moment, except for timerOut', async () => {
    const introEvent: SpecStoryEvent = { id: 'intro-event', stageId: 's1', when: { atSeconds: 0 }, effect: 'news', text: 'The opening news arrives.' }
    const lateEvent: SpecStoryEvent = { id: 'late-event', stageId: 's1', when: { atSeconds: 10 }, effect: 'news', text: 'Later news arrives.' }
    const otherStageEvent: SpecStoryEvent = { id: 'other-stage', stageId: 's2', when: { atSeconds: 0 }, effect: 'news', text: 'News from another stage.' }
    const timerEvent: SpecStoryEvent = { id: 'timer-event', stageId: 's1', when: { timerOut: true }, effect: 'news', text: 'Time is up.' }
    const game = new Harness(makeSpec({ storyEvents: [introEvent, lateEvent, otherStageEvent, timerEvent] }))

    await act(game, { type: 'continue' })
    expect(game.eventsOf('storyEvent')).toEqual([])
    game.advance(1_000)
    await tick(game)
    expect(game.eventsOf('storyEvent')).toEqual([])

    await act(game, { type: 'continue' })
    expect(game.eventsOf('storyEvent')).toMatchObject([{ eventId: introEvent.id }])
    await act(game, { type: 'endStage' })
    game.advance(9_000)
    await tick(game)
    expect(game.eventsOf('storyEvent').map((event) => event.eventId)).toEqual([introEvent.id])

    game.advance(10 * MINUTE)
    await tick(game)
    expect(game.eventsOf('storyEvent').map((event) => event.eventId)).toEqual([introEvent.id, timerEvent.id])
    await tick(game)
    expect(game.eventsOf('storyEvent')).toHaveLength(2)
  })
})
