import { GameEvent, PlayerView } from '@adventure/play-contract'
import { describe, expect, it } from 'vitest'

import { EngineError, createState, engine, project } from '../src'
import { Harness } from './fixtures/harness'
import { LETTER_KEY, mini } from './fixtures/mini'

const MINUTE = 60_000

describe('flow', () => {
  it('opens with the briefing, then the stage opening, then play with the timer', async () => {
    const game = new Harness(mini)
    expect(project(mini, game.state)).toMatchObject({ phase: 'briefing', stage: null, briefing: { name: 'Ahmad' } })
    const opening = await game.act({ type: 'continue' })
    expect(opening.stage).toMatchObject({ index: 0, centralQuestion: 'Will A agree?', intro: { narration: 'Stage one opens.', predictionReveal: null } })
    expect(opening.characters).toEqual([])
    expect(opening.timer).toBeNull()
    const playing = await game.act({ type: 'continue' })
    expect(playing.stage?.intro).toBeNull()
    expect(playing.timer).toEqual({ endsAt: game.now + 10 * MINUTE, durationMs: 10 * MINUTE })
    expect(playing.characters.map((character) => character.id)).toEqual(['a', 'm'])
    expect(playing.characters[0]).toMatchObject({ stanceId: 'a2', portraitKey: 'a:a2' })
    expect(playing.characters[1]).toMatchObject({ stanceId: null, portraitKey: 'm' })
    expect(playing.documents.map((document) => document.id)).toEqual(['memo'])
  })

  it('never mutates the state it is given, and refuses illegal actions with an EngineError', async () => {
    const state = createState(mini, 'seed')
    const before = structuredClone(state)
    const deps = { llm: new Harness(mini).llm, now: 0, rng: { next: () => 0, int: () => 0, pick: () => null } }
    await engine.step({ spec: mini, state, action: { type: 'continue' } }, deps)
    expect(state).toEqual(before)
    await expect(engine.step({ spec: mini, state, action: { type: 'act', actId: 'frank' } }, deps)).rejects.toMatchObject({ code: 'illegal_phase' })
    await expect(engine.step({ spec: mini, state, action: { type: 'resolve' } as never }, deps)).rejects.toBeInstanceOf(EngineError)
  })

  it('only lets the student talk to characters in their room', async () => {
    const game = new Harness(mini)
    await game.start()
    await expect(game.act({ type: 'message', characterId: 'b', text: 'Hello' })).rejects.toMatchObject({ code: 'not_present' })
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await expect(game.act({ type: 'message', characterId: 'b', text: 'Hello' })).resolves.toBeDefined()
    await expect(game.act({ type: 'enterRoom', roomId: 'nowhere' })).rejects.toMatchObject({ code: 'unknown_id' })
  })
})

describe('discoveries become notes', () => {
  it('records a conveyed discovery only after the post-turn check, in the role voice', async () => {
    const game = new Harness(mini)
    await game.start()
    const replied = await game.act({ type: 'message', characterId: 'a', text: 'What do you want?' })
    expect(replied.messages.at(-1)).toMatchObject({ kind: 'character', characterId: 'a', text: 'A reply.' })
    expect(replied.notes).toEqual([])
    expect(replied.pendingCheck).toBe(true)
    const checked = await game.check({ conveyed: ['d-a1'] })
    expect(checked.pendingCheck).toBe(false)
    expect(checked.notes.map((note) => note.text)).toEqual(['A wants a share of the trade.'])
    expect(game.eventsOf('discovery')).toEqual([expect.objectContaining({ discoveryId: 'd-a1', core: true, via: 'conversation' })])
  })

  it('shows the character only revealable discoveries, and ignores anything else the check names', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'message', characterId: 'a', text: 'Tell me everything.' })
    const user = game.llm.requests.find((request) => request.schemaName === 'v3_character_reply')?.user ?? ''
    expect(user).toContain('A wants a share.')
    expect(user).not.toContain('A fears Riau.')
    expect(user).toContain('his fears')
    expect(game.state.pendingChecks[0]?.revealable.map((fact) => fact.id)).toEqual(['d-a1'])
    // A conveyed id outside the snapshot (here, a condition not met) creates nothing.
    const [pending] = game.state.pendingChecks
    await game.act({
      type: 'postTurn',
      messageId: pending?.messageId ?? '',
      result: { conveyed: ['d-a2', 'd-a1', 'nope'], assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: 'none', reason: null } },
    })
    expect(game.state.discovered).toEqual(['d-a1'])
  })

  it('keeps holding back an earlier stage\'s undiscovered topics, and stops offering them', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'endStage' })
    await game.act({ type: 'act', actId: 'frank' })
    await game.act({ type: 'predict', outcomeId: 'o-delay' })
    await game.act({ type: 'continue' })
    await game.act({ type: 'message', characterId: 'a', text: 'What do you fear?' })
    const user = game.llm.lastRequest?.user ?? ''
    expect(user.slice(user.indexOf('<<<NOT YET'))).toContain('his fears')
    expect(user).not.toContain('A wants a share.')
    expect(game.state.pendingChecks[0]?.revealable).toEqual([])
  })

  it('applies a post-turn check at most once', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'message', characterId: 'a', text: 'Hi' })
    const messageId = game.state.pendingChecks[0]?.messageId ?? ''
    const result = { conveyed: ['d-a1'], assertedUndiscovered: true, assertion: 'x', moderation: { flagged: false, category: 'none' as const, reason: null } }
    await game.act({ type: 'postTurn', messageId, result })
    const after = structuredClone(game.state)
    await game.act({ type: 'postTurn', messageId, result })
    expect(game.state).toEqual(after)
    expect(game.eventsOf('challenge')).toHaveLength(1)
  })

  it('bounds the pending checks', async () => {
    const game = new Harness(mini)
    await game.start()
    for (let i = 0; i < 3; i += 1) await game.act({ type: 'message', characterId: 'a', text: `Hi ${i}` })
    await expect(game.act({ type: 'message', characterId: 'a', text: 'Again' })).rejects.toMatchObject({ code: 'pending' })
  })

  it('flags abusive messages for the teacher', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.say('a', 'Something abusive', { flagged: 'abusive' })
    expect(game.eventsOf('flag')).toEqual([expect.objectContaining({ category: 'abusive' })])
  })
})

describe('unearned assertions and the trust trigger', () => {
  it('counts challenges, and two cost a major character one stance step', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.say('a', 'Your brother told me you will sign.', { asserted: true })
    expect(game.state.characters.a?.stanceId).toBe('a2')
    expect(game.state.discovered).toEqual([])
    await game.say('a', 'I know the Dutch are coming.', { asserted: true })
    expect(game.state.characters.a?.stanceId).toBe('a1')
    expect(game.eventsOf('stanceChange')).toEqual([expect.objectContaining({ characterId: 'a', from: 'a2', to: 'a1', cause: 'trust' })])
    expect(game.view?.messages.at(-1)).toMatchObject({ kind: 'notice', text: 'A seems to trust you a little less.' })
    expect(game.state.characters.a?.challenged).toBe(0)
  })

  it('never lowers a minor character, who has no stance', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.say('m', 'You lie', { asserted: true })
    await game.say('m', 'You lie again', { asserted: true })
    expect(game.eventsOf('challenge')).toHaveLength(2)
    expect(game.eventsOf('stanceChange')).toEqual([])
  })
})

describe('passing notes on, triggers and slants', () => {
  it('fires a notePassed trigger, hands over a document, and tells the persona to react', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.say('a', 'What do you want?', { conveyed: ['d-a1'] })
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    const view = await game.act({ type: 'insertNote', characterId: 'b', noteId: game.noteFor('d-a1') })
    expect(game.state.characters.b?.stanceId).toBe('b2')
    expect(view.messages.find((message) => message.kind === 'notice')).toMatchObject({ text: 'B goes quiet.', characterId: 'b' })
    expect(view.documents.map((document) => document.id)).toContain('gift')
    const system = game.llm.lastRequest?.system ?? ''
    expect(system).toContain('changed how you see things')
    expect(system).toContain('A gift')
    expect(view.messages.find((message) => message.insertedNoteId !== null)).toMatchObject({ kind: 'player', characterId: 'b' })
  })

  it('refuses to pass on a note the student does not hold', async () => {
    const game = new Harness(mini)
    await game.start()
    await expect(game.act({ type: 'insertNote', characterId: 'a', noteId: 'n999' })).rejects.toMatchObject({ code: 'not_held' })
  })

  it('confronting a major character\'s slant fires their trigger and unlocks what that stance allows', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    await game.act({ type: 'selectPassage', documentId: 'letter', ...LETTER_KEY })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    expect(game.state.confrontedSlants).toContain('slant-a')
    expect(game.state.characters.a?.stanceId).toBe('a3')
    expect(game.state.pendingChecks.at(-1)?.revealable.map((fact) => fact.id)).toEqual(['d-a1', 'd-a2'])
  })

  it('confronting a minor character\'s slant unlocks a note with no stance change', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    await game.act({ type: 'selectPassage', documentId: 'letter', ...LETTER_KEY })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'm', noteId: game.noteFor('d-letter') })
    expect(game.state.discovered).toContain('d-m2')
    expect(game.eventsOf('discovery').at(-1)).toMatchObject({ discoveryId: 'd-m2', via: 'slant' })
    expect(game.eventsOf('stanceChange')).toEqual([])
  })

  it('reaches the hidden top stance only through its explicit trigger, and only when its requirement holds', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.say('b', 'Orders?', { conveyed: ['d-b1'] })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-b1') })
    await game.check()
    expect(game.state.characters.a?.stanceId).toBe('a2')
    expect(game.state.firedTriggers).not.toContain('t-a-top')
    // Raise A to a3 with the slant trigger, then the same note reaches the hidden a4.
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    await game.act({ type: 'selectPassage', documentId: 'letter', ...LETTER_KEY })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check()
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-b1') })
    expect(game.state.characters.a?.stanceId).toBe('a4')
  })
})

describe('documents and close reading', () => {
  it('picks up a document only in its room, and reading alone makes no note', async () => {
    const game = new Harness(mini)
    await game.start()
    await expect(game.act({ type: 'openDocument', documentId: 'letter' })).rejects.toMatchObject({ code: 'not_present' })
    const room = await game.act({ type: 'enterRoom', roomId: 'r2' })
    expect(room.documentsHere).toEqual([{ id: 'letter', kind: 'letter', title: 'A letter' }])
    const open = await game.act({ type: 'openDocument', documentId: 'letter' })
    expect(open.documents.find((document) => document.id === 'letter')).toMatchObject({ open: true, real: true, sourceLabel: 'A letter, 1819' })
    expect(open.documentsHere).toEqual([])
    expect(open.notes).toEqual([])
    const closed = await game.act({ type: 'closeDocument', documentId: 'letter' })
    expect(closed.documents.find((document) => document.id === 'letter')?.open).toBe(false)
  })

  it('makes a note when the selection covers enough of a key passage, and not for a select-all', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    const body = mini.documents[0]?.body ?? ''
    await game.act({ type: 'selectPassage', documentId: 'letter', start: 0, end: body.length })
    expect(game.state.notes).toEqual([])
    await game.act({ type: 'selectPassage', documentId: 'letter', start: 0, end: 10 })
    expect(game.state.notes).toEqual([])
    await game.act({ type: 'selectPassage', documentId: 'letter', start: LETTER_KEY.start + 4, end: LETTER_KEY.start + 30 })
    expect(game.view?.notes.map((note) => note.source)).toEqual(['document'])
    await expect(game.act({ type: 'selectPassage', documentId: 'letter', start: 0, end: body.length + 5 })).rejects.toMatchObject({ code: 'invalid_action' })
  })
})

describe('defining moments, outcomes and endings', () => {
  it('nudges when core discoveries are missing, and resolves by rule', async () => {
    const game = new Harness(mini)
    await game.start()
    const moment = await game.act({ type: 'endStage' })
    expect(moment.definingMoment).toMatchObject({ status: 'choosing', nudge: 'Do you know what A wants?', acts: [{ id: 'frank' }, { id: 'warn' }] })
    await expect(game.act({ type: 'message', characterId: 'a', text: 'Wait' })).rejects.toMatchObject({ code: 'illegal_phase' })
    const reacted = await game.act({ type: 'act', actId: 'frank' })
    expect(reacted.definingMoment).toMatchObject({ status: 'predicting', reaction: 'A nods.', chosenActId: 'frank' })
    expect(reacted.definingMoment?.predictionOptions.map((option) => option.outcomeId)).toEqual(['o-agree', 'o-refuse', 'o-delay'])
    expect(JSON.stringify(reacted)).not.toContain('he was unsure')
    const next = await game.act({ type: 'predict', outcomeId: 'o-agree' })
    expect(game.state.outcomes.m1).toBe('o-delay')
    expect(next.stage).toMatchObject({ index: 1, intro: { predictionReveal: { predicted: 'He will agree.', actual: 'A delayed.', because: 'he was unsure' } } })
  })

  it('closes endings, removes acts that can only reach them, and applies the next stage\'s situation', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'endStage' })
    await game.act({ type: 'act', actId: 'warn' })
    const next = await game.act({ type: 'predict', outcomeId: 'o-refuse' })
    expect(game.state.closedEndings).toEqual(['e-hist'])
    expect(game.eventsOf('outcome').at(-1)).toMatchObject({ outcomeId: 'o-refuse', closedEndingIds: ['e-hist'], endingId: null })
    expect(next.stage?.intro?.narration).toBe('After the refusal, stage two opens.')
    expect(game.state.characters.a?.stanceId).toBe('a1')
    await game.act({ type: 'continue' })
    const moment = await game.act({ type: 'endStage' })
    expect(moment.definingMoment?.acts.map((act) => act.id)).toEqual(['wait', 'alone'])
    await game.act({ type: 'act', actId: 'wait' })
    expect(game.view?.definingMoment?.predictionOptions.map((option) => option.outcomeId)).toEqual(['o-alt1', 'o-alt2'])
  })

  it('shows the secret act only when enough unlock conditions hold, and never as a prediction', async () => {
    const game = new Harness(mini)
    await game.start()
    // Reach a4 (hidden top) and discover d-a3: two of three conditions.
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.say('b', 'Orders?', { conveyed: ['d-b1'] })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    await game.act({ type: 'selectPassage', documentId: 'letter', ...LETTER_KEY })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check()
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-b1') })
    await game.check()
    await game.say('a', 'Your plan?', { conveyed: ['d-a3'] })
    expect(game.state.discovered).toContain('d-a3')
    await game.act({ type: 'endStage' })
    await game.act({ type: 'act', actId: 'frank' })
    await game.act({ type: 'predict', outcomeId: 'o-agree' })
    await game.act({ type: 'continue' })
    const moment = await game.act({ type: 'endStage' })
    expect(moment.definingMoment?.acts.map((act) => act.id)).toContain('secret')
    await game.act({ type: 'act', actId: 'secret' })
    expect(game.view?.definingMoment?.predictionOptions.map((option) => option.outcomeId)).not.toContain('o-secret')
    await game.act({ type: 'predict', outcomeId: 'o-hist' })
    expect(game.state.endingId).toBe('e-secret')
  })

  it('ends investigation when the moment begins: no walking, picking up or selecting, but held documents can be re-read', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    const moment = await game.act({ type: 'endStage' })
    expect(moment.timer).toBeNull()
    await expect(game.act({ type: 'selectPassage', documentId: 'letter', ...LETTER_KEY })).rejects.toMatchObject({ code: 'illegal_phase' })
    await expect(game.act({ type: 'enterRoom', roomId: 'r1' })).rejects.toMatchObject({ code: 'illegal_phase' })
    await expect(game.act({ type: 'endStage' })).rejects.toMatchObject({ code: 'illegal_phase' })
    expect((await game.act({ type: 'openDocument', documentId: 'letter' })).documents.find((document) => document.id === 'letter')?.open).toBe(true)
    expect(game.state.discovered).toEqual([])
  })

  it('refuses an act that is not on offer', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.act({ type: 'endStage' })
    await expect(game.act({ type: 'act', actId: 'secret' })).rejects.toMatchObject({ code: 'act_unavailable' })
  })
})

describe('timer and final call', () => {
  it('brings the defining moment when the timer runs out, and drops the action that arrived too late', async () => {
    const game = new Harness(mini)
    await game.start()
    game.advance(10 * MINUTE - 1)
    expect((await game.act({ type: 'tick' })).definingMoment).toBeNull()
    game.advance(1)
    const late = await game.act({ type: 'message', characterId: 'a', text: 'One more thing' })
    expect(late.definingMoment).toMatchObject({ status: 'choosing' })
    expect(late.messages.map((message) => message.text)).toContain('Time is up: A will answer now.')
    expect(late.messages.map((message) => message.text)).not.toContain('One more thing')
    expect(late.timer).toBeNull()
  })

  it('has no timer when the teacher turns it off', async () => {
    const game = new Harness({ ...mini, timer: { enabled: false, stageMinutes: [] } })
    const view = await game.start()
    expect(view.timer).toBeNull()
    game.advance(600 * MINUTE)
    expect((await game.act({ type: 'tick' })).definingMoment).toBeNull()
  })
})

describe('end of game', () => {
  it('plays epilogue, Interview with one push-back, and the reveal', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.say('a', 'What do you want?', { conveyed: ['d-a1'] })
    await game.act({ type: 'endStage' })
    await game.act({ type: 'act', actId: 'frank' })
    await game.act({ type: 'predict', outcomeId: 'o-delay' })
    await game.act({ type: 'continue' })
    await game.act({ type: 'endStage' })
    await game.act({ type: 'act', actId: 'recognise' })
    const epilogue = await game.act({ type: 'predict', outcomeId: 'o-hist' })
    expect(epilogue).toMatchObject({ phase: 'epilogue', epilogue: { title: 'History', text: 'The historical epilogue.' }, stage: null })
    const interview = await game.act({ type: 'continue' })
    expect(interview.interview).toMatchObject({ question: 'Was it fair?', closed: false })
    const pushBack = await game.act({ type: 'interviewAnswer', verdictId: 'no', evidenceNoteIds: [game.noteFor('d-a1')] })
    expect(pushBack.interview?.pushBack).toContain('A wants a share of the trade.')
    await expect(game.act({ type: 'continue' })).rejects.toMatchObject({ code: 'illegal_phase' })
    const closed = await game.act({ type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: [], text: 'Only partly.' })
    expect(closed.interview?.closed).toBe(true)
    const reveal = await game.act({ type: 'continue' })
    expect(reveal).toMatchObject({ phase: 'reveal', ended: true, reveal: { whatHappened: 'It happened.', corrections: ['A slanted.'] } })
    expect(reveal.reveal?.missedCore).toEqual(['A fears Riau.', 'B will decide alone.'])
    expect(reveal.reveal?.pathVsHistory[0]).toMatchObject({ yours: 'A delayed.', history: 'A agreed.', matched: false })
    expect(game.eventsOf('verdict').map((event) => event.stage)).toEqual(['initial', 'final'])
  })
})

describe('contract', () => {
  it('every view and event of a full run parses against play-contract', async () => {
    const game = new Harness(mini)
    const views: PlayerView[] = [project(mini, game.state)]
    views.push(await game.start())
    views.push(await game.say('a', 'Hi', { conveyed: ['d-a1'] }))
    views.push(await game.act({ type: 'endStage' }))
    views.push(await game.act({ type: 'act', actId: 'frank' }))
    views.push(await game.act({ type: 'predict', outcomeId: 'o-delay' }))
    for (const view of views) PlayerView.parse(view)
    for (const event of game.events) GameEvent.parse(event)
  })
})
