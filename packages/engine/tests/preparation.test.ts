import { describe, expect, it } from 'vitest'

import { project, type EngineSpec } from '../src'
import { Harness } from './fixtures/harness'
import { LETTER_KEY, mini } from './fixtures/mini'

function checkedSpec(): EngineSpec {
  const spec = structuredClone(mini)
  const question = (id: string) => ({
    id, prompt: 'What can the key line support?',
    options: [{ id: 'supported', text: 'The limited claim.' }, { id: 'b', text: 'A wider claim.' }, { id: 'c', text: 'The contrary claim.' }],
    correctOptionId: 'supported', support: [LETTER_KEY], explanation: 'The source supports the limited claim.',
  })
  spec.documents[0]!.readingCheck = {
    discoveryId: 'd-letter', variants: [question('q1'), question('q2'), question('q3'), question('q4')],
    recovery: question('correction'), recoveryDiscoveryIds: ['d-b1'],
  }
  spec.stages[0]!.preparation = {
    characters: { a: [{ discoveryIds: ['d-letter'], minMet: 1 }] },
    decision: [{ discoveryIds: ['d-letter'], minMet: 1 }, { discoveryIds: ['d-a1', 'd-b1'], minMet: 1 }],
    essentialCharacters: [{ characterId: 'a', discoveryIds: ['d-a1'] }, { characterId: 'b', discoveryIds: ['d-b1'] }],
  }
  return spec
}

async function openLetter(game: Harness): Promise<void> {
  await game.act({ type: 'enterRoom', roomId: 'r2' })
  await game.act({ type: 'openDocument', documentId: 'letter' })
}

function answer(questionId = 'q1', choiceId = 'supported', selection = LETTER_KEY, recovery = false) {
  return { type: 'submitReadingCheck' as const, documentId: 'letter', questionId, choiceId, ...selection, recovery }
}

describe('reading checks', () => {
  it('withholds notes from highlighting and grants the supported discovery once after a correct check', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    await game.act({ type: 'selectPassage', documentId: 'letter', ...LETTER_KEY })
    expect(game.state.discovered).not.toContain('d-letter')
    const passed = await game.act(answer())
    expect(passed.documents.find((d) => d.id === 'letter')?.readingCheck?.status).toBe('passed')
    expect(game.state.discovered).toContain('d-letter')
    await game.act(answer())
    expect(game.eventsOf('discovery').filter((event) => event.discoveryId === 'd-letter')).toHaveLength(1)
    expect(game.eventsOf('readingCheck')).toHaveLength(1)
  })

  it('rejects broad highlights and requires correction before a different variant', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    const body = game.spec.documents[0]!.body
    const failed = await game.act(answer('q1', 'supported', { start: 0, end: body.length }))
    expect(failed.documents.find((d) => d.id === 'letter')?.readingCheck).toMatchObject({ status: 'needsReview', question: null, explanation: null })
    expect(game.state.discovered).not.toContain('d-letter')
    await expect(game.act(answer())).rejects.toMatchObject({ code: 'preparation_required' })
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'openDocument', documentId: 'letter' })
    expect(game.view?.documents.find((d) => d.id === 'letter')?.readingCheck?.status).toBe('needsReview')
    await game.act(answer('correction', 'supported', LETTER_KEY, true))
    expect(game.state.discovered).not.toContain('d-letter')
    expect(game.view?.documents.find((d) => d.id === 'letter')?.readingCheck?.question?.id).toBe('q2')
    await expect(game.act(answer('q1'))).rejects.toMatchObject({ code: 'invalid_action' })
    await game.act(answer('q2'))
    expect(game.state.readingChecks?.letter?.attempts.map((attempt) => attempt.correct)).toEqual([false, true, true])
  })

  it('permits a fresh variant only after a new relevant discovery, not an old or unrelated one', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    await game.act(answer('q1', 'b'))
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.say('b', 'What do your orders say?', { conveyed: ['d-b1'] })
    expect(game.view?.documents.find((d) => d.id === 'letter')?.readingCheck?.question?.id).toBe('q2')
    await game.act({ type: 'openDocument', documentId: 'letter' })
    await game.act(answer('q2', 'b'))
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.say('b', 'Repeat your orders.', { conveyed: ['d-b1'] })
    expect(game.view?.documents.find((d) => d.id === 'letter')?.readingCheck?.status).toBe('needsReview')
  })

  it('bounds raw offsets and does not expose keys, support spans, or future variants', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    const reading = game.view?.documents.find((d) => d.id === 'letter')?.readingCheck
    expect(JSON.stringify(reading)).not.toMatch(/correctOptionId|"support":|explanation.*limited claim|q2/)
    const before = structuredClone(game.state)
    await expect(game.act(answer('q4'))).rejects.toMatchObject({ code: 'invalid_action' })
    await expect(game.act(answer('q1', 'forged'))).rejects.toMatchObject({ code: 'invalid_action' })
    await expect(game.act(answer('q1', 'supported', { start: -1, end: 10 }))).rejects.toMatchObject({ code: 'invalid_action' })
    expect(game.state).toEqual(before)
  })

  it('grades the raw selection rather than expanding a short fragment to the accepted sentence', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    await game.act(answer('q1', 'supported', { start: LETTER_KEY.start, end: LETTER_KEY.start + 4 }))
    expect(game.state.discovered).not.toContain('d-letter')
    expect(game.view?.documents.find((document) => document.id === 'letter')?.readingCheck?.status).toBe('needsReview')
    await game.act(answer('correction', 'b', LETTER_KEY, true))
    expect(game.view?.documents.find((document) => document.id === 'letter')?.readingCheck?.question).toBeNull()
    await game.act(answer('correction', 'supported', LETTER_KEY, true))
    await expect(game.act(answer('correction', 'supported', LETTER_KEY, true))).rejects.toMatchObject({ code: 'invalid_action' })
  })

  it('cycles distinct variants after genuine correction while preserving the first failure through JSON storage', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    for (const id of ['q1', 'q2', 'q3', 'q4']) {
      await game.act(answer(id, 'b'))
      game.state = JSON.parse(JSON.stringify(game.state))
      await game.act(answer('correction', 'supported', LETTER_KEY, true))
    }
    expect(game.view?.documents.find((document) => document.id === 'letter')?.readingCheck?.question?.id).toBe('q1')
    expect(game.state.readingChecks?.letter?.attempts[0]).toMatchObject({ questionId: 'q1', correct: false, recovery: false })
    expect(game.state.readingChecks?.letter?.attempts).toHaveLength(8)
    expect(game.state.discovered).toEqual([])
  })

  it('requires the source to be open and held, and leaves attempts unchanged for invalid requests', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await expect(game.act(answer())).rejects.toMatchObject({ code: 'not_held' })
    await openLetter(game)
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await expect(game.act(answer())).rejects.toMatchObject({ code: 'invalid_action' })
    expect(game.state.readingChecks).toBeUndefined()
  })

  it('requires a focused supporting passage for additional notes after the main check passes', async () => {
    const spec = checkedSpec()
    const document = spec.documents[0]!
    const extraStart = document.body.indexOf('Closing words')
    document.keyPassages.push({ id: 'kp-extra', start: extraStart, end: document.body.length })
    spec.discoveries.push({ id: 'd-extra', stageId: 's1', holder: { documentId: 'letter', keyPassageId: 'kp-extra' }, text: 'The writer closes the letter.', note: 'The letter has a closing statement.', core: false, sourceLabel: 'A letter, 1819' })
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'selectPassage', documentId: 'letter', start: 0, end: document.body.length })
    expect(game.state.discovered).not.toContain('d-extra')
    await game.act({ type: 'selectPassage', documentId: 'letter', start: extraStart, end: extraStart + 4 })
    expect(game.state.discovered).not.toContain('d-extra')
    const contextStart = document.body.lastIndexOf('Words of no consequence', extraStart)
    await game.act({ type: 'selectPassage', documentId: 'letter', start: contextStart, end: document.body.length })
    expect(game.state.discovered).toContain('d-extra')
    expect(game.eventsOf('discovery').filter((event) => event.discoveryId === 'd-extra')).toHaveLength(1)
  })
})

describe('preparation and essential conversations', () => {
  it('blocks messages and notes until relevant groups are met, with accurate capped counts', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    expect(game.view?.characters.find((c) => c.id === 'a')?.preparation).toMatchObject({ completed: 0, required: 1, ready: false })
    await expect(game.act({ type: 'message', characterId: 'a', text: 'Hello' })).rejects.toMatchObject({ code: 'preparation_required' })
    game.state.discovered.push('d-b1')
    game.state.notes.push({ id: 'note', discoveryId: 'd-b1', source: 'conversation', stageIndex: 0, at: game.now })
    await expect(game.act({ type: 'insertNote', characterId: 'a', noteId: 'note' })).rejects.toMatchObject({ code: 'preparation_required' })
    expect(game.state.passedOn).toEqual([])
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'message', characterId: 'a', text: 'How does the letter affect your plans?' })
    expect(game.view?.characters.find((c) => c.id === 'a')?.preparation?.ready).toBe(true)
  })

  it('requires all essential substantive exchanges, even after their facts were previously learned', async () => {
    const game = new Harness(checkedSpec())
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.say('a', 'Hello', { conveyed: ['d-a1'], substantive: false })
    await expect(game.act({ type: 'endStage' })).rejects.toMatchObject({ code: 'preparation_required' })
    await game.act({ type: 'message', characterId: 'a', text: 'Why is a share of trade important to you?' })
    expect(game.view?.stage?.preparation?.essentialConversations[0]?.complete).toBe(false)
    await game.check({ conveyed: ['d-a1'], substantive: true })
    expect(game.view?.stage?.preparation?.essentialConversations[0]?.complete).toBe(true)
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.say('b', 'Explain the orders you received.', { conveyed: ['d-b1'], substantive: true })
    expect(game.view?.stage?.preparation?.ready).toBe(true)
    await game.act({ type: 'endStage' })
    expect(game.state.moment?.status).toBe('choosing')
  })

  it('announces expiry once, permits continued investigation, and lets the student decide without the remaining preparation', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    spec.stages[0]!.preparation!.decision = [{ discoveryIds: ['d-letter'], minMet: 1 }]
    spec.storyEvents.push({ id: 'timer-moment', stageId: 's1', when: { timerOut: true }, effect: 'beginMoment', text: 'The time has come.' })
    const game = new Harness(spec)
    await game.start()
    await expect(game.act({ type: 'endStage' })).rejects.toMatchObject({ code: 'preparation_required' })
    game.advance(600_001)
    await game.act({ type: 'tick' })
    expect(game.state.moment).toBeNull()
    expect(game.view?.stage?.preparation).toMatchObject({ timerExpired: true, ready: true, completed: 0 })
    expect(game.view?.stage?.preparation?.essentialConversations.some((conversation) => conversation.complete)).toBe(false)
    await game.act({ type: 'tick' })
    expect(game.state.transcript.filter((m) => m.text === spec.definingMoments[0]!.finalCallNarration)).toHaveLength(1)
    await game.say('a', 'What do you seek from trade?', { conveyed: ['d-a1'], substantive: true })
    expect(game.state.moment).toBeNull()
    expect(game.state.discovered).not.toContain('d-letter')
    await game.act({ type: 'endStage' })
    expect(game.state.moment?.status).toBe('choosing')
    expect(game.state.moment?.nudge).toBe(spec.definingMoments[0]!.nudge)
  })

  it('loads legacy attempts without adding requirements or leaking private state', async () => {
    const game = new Harness(mini)
    await game.start()
    delete game.state.readingChecks
    delete game.state.essentialConversations
    const view = project(mini, game.state)
    expect(view.stage).not.toHaveProperty('preparation')
    await game.act({ type: 'endStage' })
    expect(game.state.moment?.status).toBe('choosing')
  })

  it('caps alternative counts and requires every essential designated fact across asynchronous replies', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    spec.stages[0]!.preparation!.decision = [{ discoveryIds: ['d-a1', 'd-b1', 'd-letter'], minMet: 1 }]
    spec.stages[0]!.preparation!.essentialCharacters = [{ characterId: 'a', discoveryIds: ['d-a1', 'd-a2'] }]
    const game = new Harness(spec)
    await game.start()
    game.state.characters.a!.stanceId = 'a3'
    await game.say('a', 'What share do you seek?', { conveyed: ['d-a1'], substantive: true })
    expect(game.view?.stage?.preparation).toMatchObject({ completed: 1, required: 1, ready: false })
    await game.act({ type: 'message', characterId: 'a', text: 'Why do you fear Riau?' })
    expect(game.view?.stage?.preparation?.ready).toBe(false)
    const pendingId = game.state.pendingChecks[0]!.messageId
    await game.act({ type: 'postTurn', messageId: pendingId, result: { conveyed: ['d-a2', 'd-letter'], substantive: true, assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: 'none', reason: null } } })
    expect(game.state.discovered).not.toContain('d-letter')
    expect(game.view?.stage?.preparation).toMatchObject({ completed: 1, required: 1, ready: true })
    expect(game.eventsOf('essentialConversation')).toHaveLength(1)
    await game.act({ type: 'postTurn', messageId: pendingId, result: { conveyed: ['d-a1', 'd-a2'], substantive: true, assertedUndiscovered: false, assertion: null, moderation: { flagged: false, category: 'none', reason: null } } })
    expect(game.eventsOf('essentialConversation')).toHaveLength(1)
  })

  it('counts relevant shared-note and slant replies only after substantive confirmation', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    spec.stages[0]!.preparation!.decision = []
    spec.stages[0]!.preparation!.essentialCharacters = [{ characterId: 'm', discoveryIds: ['d-m2'] }]
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'm', noteId: game.noteFor('d-letter') })
    expect(game.state.discovered).toContain('d-m2')
    expect(game.view?.stage?.preparation?.ready).toBe(false)
    await game.check({ conveyed: ['d-m2'], substantive: true })
    expect(game.view?.stage?.preparation?.ready).toBe(true)
    expect(game.eventsOf('essentialConversation')).toEqual([expect.objectContaining({ characterId: 'm' })])
  })

  it('does not expand a character reply to undiscovered facts held by another source', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    // The spec validator also rejects this, but a bad designation cannot widen character knowledge.
    spec.stages[0]!.preparation!.essentialCharacters = [{ characterId: 'a', discoveryIds: ['d-b1', 'd-letter'] }]
    const game = new Harness(spec)
    await game.start()
    await game.act({ type: 'message', characterId: 'a', text: 'What evidence can you explain?' })
    expect(game.state.pendingChecks[0]?.essential ?? []).toEqual([])
    expect(game.llm.lastRequest?.user).not.toContain('B has orders.')
    expect(game.llm.lastRequest?.user).not.toContain('The letter says the key line.')
  })

  it('cannot start a decision through story events until preparation is met', async () => {
    const spec = checkedSpec()
    spec.storyEvents.push({ id: 'force', stageId: 's1', when: { atSeconds: 1 }, effect: 'beginMoment', text: 'A summons you.' })
    const game = new Harness(spec)
    await game.start()
    game.advance(2_000)
    await game.act({ type: 'tick' })
    expect(game.state.moment).toBeNull()
    expect(game.view?.stage?.preparation?.ready).toBe(false)
  })

  it('directs local locked-character hints through prerequisites instead of revealing facts', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters.a = [{ discoveryIds: ['d-b1'], minMet: 1 }]
    spec.stages[0]!.preparation!.characters.b = [{ discoveryIds: ['d-letter'], minMet: 1 }]
    const game = new Harness(spec)
    await game.start()
    const hint = game.view?.characters.find((character) => character.id === 'a')?.preparation?.hint
    expect(hint).toContain('A letter')
    expect(hint).toContain('Tent')
    expect(hint).not.toContain('B has orders')
    game.advance(180_000)
    await game.act({ type: 'tick' })
    expect(game.eventsOf('hint')[0]?.targetDiscoveryId).toBe('d-letter')
  })

  it('directs students to share an already acquired prerequisite instead of rereading it', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = { a: [{ discoveryIds: ['d-b1'], minMet: 1 }] }
    spec.discoveries.find((discovery) => discovery.id === 'd-b1')!.condition = { notePassed: { characterId: 'b', discoveryId: 'd-letter' } }
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    expect(game.view?.characters.find((character) => character.id === 'a')?.preparation?.hint).toContain('Show your note from “A letter” to B in Tent')
  })

  it('guides an unfinished essential fact after another fact in the same conversation has been confirmed', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation = { characters: {}, decision: [], essentialCharacters: [{ characterId: 'a', discoveryIds: ['d-a1', 'd-a2'] }] }
    spec.discoveries.find((discovery) => discovery.id === 'd-a2')!.condition = { discovered: 'd-letter' }
    const game = new Harness(spec)
    await game.start()
    await game.say('a', 'Why do you want a share?', { conveyed: ['d-a1'], substantive: true })
    expect(game.view?.stage?.preparation?.hint).toContain('Read “A letter” in Tent')
    game.advance(180_000)
    await game.act({ type: 'tick' })
    expect(game.eventsOf('hint').at(-1)?.targetDiscoveryId).toBe('d-letter')
  })

  it('prioritises remaining essential conversations over waived evidence after the timer expires', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    const game = new Harness(spec)
    await game.start()
    game.advance(600_001)
    await game.act({ type: 'tick' })
    expect(game.view?.stage?.preparation?.hint).toContain('Speak with A')
  })

  it('offers a timed decision without forcing it, including through a timer-triggered story event', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    spec.storyEvents.push({ id: 'force', stageId: 's1', when: { timerOut: true }, effect: 'beginMoment', text: 'A summons you.' })
    const game = new Harness(spec)
    await game.start()
    await game.say('a', 'What share do you need?', { conveyed: ['d-a1'], substantive: true })
    await game.act({ type: 'enterRoom', roomId: 'r2' })
    await game.say('b', 'What do your orders require?', { conveyed: ['d-b1'], substantive: true })
    game.advance(600_001)
    await game.act({ type: 'tick' })
    expect(game.state.moment).toBeNull()
    expect(game.view?.stage?.preparation?.ready).toBe(true)
    await game.act({ type: 'openDocument', documentId: 'letter' })
    expect(game.state.openDocumentId).toBe('letter')
    await game.act({ type: 'endStage' })
    expect(game.state.moment?.status).toBe('choosing')
  })

  it('allows a supported note correction to recover trust lost after a one-shot trigger, without raising its ceiling', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    spec.stages[0]!.preparation!.decision = []
    spec.stages[0]!.preparation!.essentialCharacters = [{ characterId: 'a', discoveryIds: ['d-a2'] }]
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check({ substantive: true })
    expect(game.state.characters.a?.stanceId).toBe('a3')
    await game.say('a', 'An unsupported claim.', { asserted: true })
    await game.say('a', 'Another unsupported claim.', { asserted: true })
    expect(game.state.characters.a?.stanceId).toBe('a2')
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter'), text: 'The letter corrects my earlier claim.' })
    expect(game.state.characters.a?.stanceId).toBe('a2')
    await game.check({ substantive: true })
    expect(game.state.characters.a?.stanceId).toBe('a3')
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check({ substantive: true })
    expect(game.state.characters.a?.stanceId).toBe('a3')
    expect(game.eventsOf('stanceChange').filter((event) => event.triggerId === 't-a-slant')).toHaveLength(1)
    await game.say('a', 'What does Riau mean for your plans?', { conveyed: ['d-a2'], substantive: true })
    expect(game.view?.stage?.preparation?.ready).toBe(true)
  })

  it('does not restore trust for an unrelated note, an unconfirmed exchange, or legacy play', async () => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation!.characters = {}
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.say('m', 'What ships did you see?', { conveyed: ['d-m1'] })
    await game.say('a', 'An unsupported claim.', { asserted: true })
    await game.say('a', 'Another unsupported claim.', { asserted: true })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-m1') })
    await game.check({ substantive: true })
    expect(game.state.characters.a?.stanceId).toBe('a1')
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    expect(game.state.characters.a?.stanceId).toBe('a2') // Authored one-shot slant trigger still applies.
    await game.check({ substantive: false })
    expect(game.state.characters.a?.trustRecoveryStanceId).toBeNull()
    const legacy = new Harness(mini)
    await legacy.start()
    await legacy.say('a', 'An unsupported claim.', { asserted: true })
    await legacy.say('a', 'Another unsupported claim.', { asserted: true })
    expect(legacy.state.characters.a?.trustRecoveryStanceId).toBeUndefined()
  })

  it.each(['a1', 'a2'])('does not restore a trust ceiling after a situation explicitly sets %s', async (resetStance) => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation = { characters: {}, decision: [], essentialCharacters: [] }
    spec.stages[1]!.preparation = { characters: {}, decision: [], essentialCharacters: [] }
    spec.stages[1]!.situations[0]!.stances = { a: resetStance }
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check({ substantive: true })
    await game.say('a', 'Unsupported claim.', { asserted: true })
    await game.say('a', 'Another unsupported claim.', { asserted: true })
    expect(game.state.characters.a?.trustRecoveryStanceId).toBe('a3')
    await game.act({ type: 'endStage' })
    await game.act({ type: 'act', actId: 'warn' })
    await game.act({ type: 'predict', outcomeId: 'o-refuse' })
    await game.act({ type: 'continue' })
    expect(game.state.characters.a?.stanceId).toBe(resetStance)
    expect(game.state.characters.a?.trustRecoveryStanceId).toBeNull()
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check({ substantive: true })
    expect(game.state.characters.a?.stanceId).toBe(resetStance)
  })

  it.each([
    { name: 'relative lowering', effect: { stanceDelta: -1 as const }, expected: 'a2' },
    { name: 'absolute authored reset', effect: { toStance: 'a1' }, expected: 'a1' },
  ])('preserves authored $name when correcting an earlier trust loss', async ({ effect, expected }) => {
    const spec = checkedSpec()
    spec.stages[0]!.preparation = { characters: {}, decision: [], essentialCharacters: [] }
    spec.triggers.push({ id: 'authored-lower', characterId: 'a', on: { discovered: 'd-m1' }, effect, notice: 'A reacts to the news.' })
    const game = new Harness(spec)
    await game.start()
    await openLetter(game)
    await game.act(answer())
    await game.act({ type: 'closeDocument', documentId: 'letter' })
    await game.act({ type: 'enterRoom', roomId: 'r1' })
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check({ substantive: true })
    await game.say('a', 'Unsupported claim.', { asserted: true })
    await game.say('a', 'Another unsupported claim.', { asserted: true })
    expect(game.state.characters.a?.stanceId).toBe('a2')
    await game.say('m', 'Which ships did you see?', { conveyed: ['d-m1'] })
    expect(game.state.characters.a?.stanceId).toBe('a1')
    await game.act({ type: 'insertNote', characterId: 'a', noteId: game.noteFor('d-letter') })
    await game.check({ substantive: true })
    expect(game.state.characters.a?.stanceId).toBe(expected)
  })
})
