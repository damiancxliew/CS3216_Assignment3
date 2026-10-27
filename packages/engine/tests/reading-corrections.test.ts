import { describe, expect, it } from 'vitest'

import { project, type EngineSpec } from '../src'
import { Harness } from './fixtures/harness'
import { mini } from './fixtures/mini'

const facts = [
  ['Who carries the rice?', 'The rice merchant carries the rice to the village.', 'merchant'],
  ['When does the boat leave?', 'The boat leaves the harbour before sunrise.', 'sunrise'],
  ['Where are the supplies kept?', 'The supplies are kept inside the old warehouse.', 'warehouse'],
  ['What warns the villagers?', 'A church bell warns the villagers when soldiers approach.', 'bell'],
] as const

function checkedSpec(): EngineSpec {
  const spec = structuredClone(mini)
  const document = spec.documents[0]!
  document.body = facts.map(([, sentence]) => sentence).join('\n\n')
  const variants = facts.map(([prompt, sentence, correctOptionId], index) => ({
    id: `q${index + 1}`, prompt,
    options: [
      { id: correctOptionId, text: sentence },
      { id: 'wrong', text: `Unsupported claim ${index + 1}.` },
      { id: 'other', text: `Another unsupported claim ${index + 1}.` },
    ],
    correctOptionId,
    support: [{ start: document.body.indexOf(sentence), end: document.body.indexOf(sentence) + sentence.length }],
    explanation: `The source says: ${sentence}`,
  }))
  document.readingCheck = {
    discoveryId: 'd-letter', variants,
    recovery: { ...variants[0]!, id: 'obsolete-correction', prompt: 'An unrelated authored correction.' },
    recoveryDiscoveryIds: [],
  }
  document.keyPassages = [{ ...document.keyPassages[0]!, ...variants[0]!.support[0]! }]
  return spec
}

async function openLetter(game: Harness): Promise<void> {
  await game.start()
  await game.act({ type: 'enterRoom', roomId: 'r2' })
  await game.act({ type: 'openDocument', documentId: 'letter' })
}

function reading(game: Harness) {
  return project(game.spec, game.state).documents.find(document => document.id === 'letter')!.readingCheck!
}

function answer(game: Harness, index: number, recovery: boolean, correct = true, supportIndex = index) {
  const variants = game.spec.documents[0]!.readingCheck!.variants
  return {
    type: 'submitReadingCheck' as const, documentId: 'letter', questionId: variants[index]!.id,
    choiceId: correct ? variants[index]!.correctOptionId : 'wrong',
    ...variants[supportIndex]!.support[0]!, recovery,
  }
}

describe('question-specific reading corrections', () => {
  it('corrects each consecutive failed question using its own prompt, options and support, including after cycling', async () => {
    const game = new Harness(checkedSpec())
    await openLetter(game)
    const variants = game.spec.documents[0]!.readingCheck!.variants

    for (const index of [0, 1, 2, 3, 0]) {
      await game.act(answer(game, index, false, false))
      const correction = reading(game).recovery!
      expect(correction.id).toBe(variants[index]!.id)
      expect(correction.prompt).toBe(variants[index]!.prompt)
      expect(correction.options).toEqual(expect.arrayContaining(variants[index]!.options))
      expect(correction.options).toHaveLength(variants[index]!.options.length)
      expect(JSON.stringify(correction)).not.toMatch(/correctOptionId|"support"|explanation/)

      // A correct choice with the previous question's evidence must still fail.
      await game.act(answer(game, index, true, true, (index + 3) % variants.length))
      expect(reading(game).status).toBe('needsReview')
      expect(game.state.readingChecks!.letter!.attempts.at(-1)).toMatchObject({ correct: false, recovery: true })

      await game.act(answer(game, index, true))
      expect(reading(game)).toMatchObject({ status: 'unanswered', question: { id: variants[(index + 1) % variants.length]!.id }, recovery: null })
      expect(game.state.discovered).not.toContain('d-letter')
      expect(game.eventsOf('discovery')).toHaveLength(0)
    }
    expect(game.state.readingChecks!.letter!.attempts).toHaveLength(15)
  })

  it('rejects previous and obsolete correction IDs without changing state or advancing twice', async () => {
    const game = new Harness(checkedSpec())
    await openLetter(game)
    await game.act(answer(game, 0, false, false))
    await game.act(answer(game, 0, true))
    const afterCorrection = structuredClone(game.state)
    await expect(game.act(answer(game, 0, true))).rejects.toMatchObject({ code: 'invalid_action' })
    expect(game.state).toEqual(afterCorrection)
    await game.act(answer(game, 1, false, false))

    for (const questionId of ['q1', 'obsolete-correction']) {
      const before = structuredClone(game.state)
      const eventCount = game.events.length
      await expect(game.act({ ...answer(game, 1, true), questionId })).rejects.toMatchObject({ code: 'invalid_action' })
      expect(game.state).toEqual(before)
      expect(game.events).toHaveLength(eventCount)
    }

    await game.act(answer(game, 1, true))
    expect(reading(game).question!.id).toBe('q3')
    expect(game.state.readingChecks!.letter!.attempts).toHaveLength(4)
    expect(game.state.discovered).not.toContain('d-letter')
  })

  it('keeps the current correction after repeated failures, JSON storage and reopening the document', async () => {
    const game = new Harness(checkedSpec())
    await openLetter(game)
    await game.act(answer(game, 0, false, false))
    await game.act(answer(game, 0, true))
    await game.act(answer(game, 1, false, false))

    for (let attempt = 0; attempt < 3; attempt++) {
      await game.act(answer(game, 1, true, false))
      game.state = JSON.parse(JSON.stringify(game.state))
      await game.act({ type: 'closeDocument', documentId: 'letter' })
      await game.act({ type: 'openDocument', documentId: 'letter' })
      expect(reading(game)).toMatchObject({ status: 'needsReview', recovery: { id: 'q2', prompt: facts[1][0] } })
      expect(reading(game).feedback).toBeTruthy()
    }

    expect(game.state.readingChecks!.letter!.attempts.filter(attempt => attempt.recovery && !attempt.correct)).toHaveLength(3)
    await game.act(answer(game, 1, true))
    expect(reading(game).question!.id).toBe('q3')
    expect(game.state.discovered).not.toContain('d-letter')
    await game.act(answer(game, 2, false))
    expect(reading(game).status).toBe('passed')
    expect(game.state.discovered).toContain('d-letter')
  })

  it('uses the active variant for old review states with no recorded attempts', async () => {
    const game = new Harness(checkedSpec())
    await openLetter(game)
    game.state.readingChecks = {
      letter: { status: 'needsReview', variantIndex: 2, discoveredAtFailure: [], attempts: [] },
    }
    game.state = JSON.parse(JSON.stringify(game.state))
    expect(reading(game)).toMatchObject({ status: 'needsReview', recovery: { id: 'q3', prompt: facts[2][0] } })
    await game.act(answer(game, 2, true))
    expect(reading(game).question!.id).toBe('q4')
    expect(game.state.discovered).not.toContain('d-letter')
  })
})
