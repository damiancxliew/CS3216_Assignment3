import { PlayerView } from '@adventure/play-contract'
import { describe, expect, it } from 'vitest'

import { EngineSpec, project } from '../src'
import { INTERVIEW_CLOSING } from '../src/interview'
import { Harness } from './fixtures/harness'
import { mini } from './fixtures/mini'

async function reachInterview(game: Harness): Promise<PlayerView> {
  await game.start()
  await game.act({ type: 'endStage' })
  await game.act({ type: 'act', actId: 'frank' })
  await game.act({ type: 'predict', outcomeId: 'o-delay' })
  await game.act({ type: 'continue' })
  await game.act({ type: 'endStage' })
  await game.act({ type: 'act', actId: 'recognise' })
  await game.act({ type: 'predict', outcomeId: 'o-hist' })
  return PlayerView.parse(await game.act({ type: 'continue' }))
}

async function finish(
  game: Harness,
  options: {
    firstPrediction?: string
    secondPrediction?: string
    firstVerdict?: string
    firstText?: string
    secondVerdict?: string
    secondText?: string
  } = {},
): Promise<PlayerView> {
  await game.act({ type: 'endStage' })
  await game.act({ type: 'act', actId: 'frank' })
  await game.act({ type: 'predict', outcomeId: options.firstPrediction ?? 'o-delay' })
  await game.act({ type: 'continue' })
  await game.act({ type: 'endStage' })
  await game.act({ type: 'act', actId: 'recognise' })
  await game.act({ type: 'predict', outcomeId: options.secondPrediction ?? 'o-hist' })
  await game.act({ type: 'continue' })
  await game.act({
    type: 'interviewAnswer',
    verdictId: options.firstVerdict ?? 'yes',
    evidenceNoteIds: [],
    ...(options.firstText === undefined ? {} : { text: options.firstText }),
  })
  await game.act({
    type: 'interviewAnswer',
    verdictId: options.secondVerdict ?? 'partly',
    evidenceNoteIds: [],
    ...(options.secondText === undefined ? {} : { text: options.secondText }),
  })
  return PlayerView.parse(await game.act({ type: 'continue' }))
}

describe('Interview voice', () => {
  it('voices the push-back, preserves the prompt contract, strips student angle brackets, and closes once', async () => {
    const game = new Harness(mini)
    game.interviewLine = 'Push back in my own voice.'
    await reachInterview(game)

    const pushed = await game.act({
      type: 'interviewAnswer',
      verdictId: 'yes',
      evidenceNoteIds: [],
      text: '<script>alert(1)</script>',
    })
    expect(pushed.interview?.pushBack).toBe('Push back in my own voice.')
    const request = game.llm.requests.find((candidate) => candidate.schemaName === 'v3_interview_line')
    expect(request?.system).toContain('You are A clerk.')
    expect(request?.system).toContain('Task: push back once on their answer.')
    expect(request?.user).toContain('<question>Was it fair?</question>')
    expect(request?.user).toContain('<their_answer>Yes. — scriptalert(1)/script</their_answer>')
    expect(request?.user).not.toContain('<script>')
    expect(request?.user).not.toContain('</script>')

    game.interviewLine = 'Closing in my own voice.'
    const closed = await game.act({ type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: [] })
    expect(closed.interview?.closing).toBe('Closing in my own voice.')
    expect(game.state.transcript.filter((message) => message.text === 'Push back in my own voice.')).toHaveLength(1)
    await expect(game.act({ type: 'interviewAnswer', verdictId: 'yes', evidenceNoteIds: [] })).rejects.toMatchObject({ code: 'illegal_phase' })
  })

  it('falls back to the rule text when the voiced push-back is invalid JSON', async () => {
    const game = new Harness(mini)
    game.invalidInterviewLine = true
    await reachInterview(game)

    const pushed = await game.act({ type: 'interviewAnswer', verdictId: 'yes', evidenceNoteIds: [] })
    expect(pushed.interview?.pushBack).toBe('Some would say: A fears Riau. What do you make of that?')
    expect(game.llm.requests.filter((request) => request.schemaName === 'v3_interview_line')).toHaveLength(3)
  })

  it('voices the closing and falls back to the standard closing when it fails', async () => {
    const game = new Harness(mini)
    await reachInterview(game)
    await game.act({ type: 'interviewAnswer', verdictId: 'yes', evidenceNoteIds: [] })
    game.invalidInterviewLine = true

    const closed = await game.act({ type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: [] })
    expect(closed.interview?.closing).toBe(INTERVIEW_CLOSING)
    const closingRequest = game.llm.requests.filter((request) => request.schemaName === 'v3_interview_line').at(-1)
    expect(closingRequest?.system).toContain('Task: close the interview.')
    expect(closingRequest?.user).toContain('<their_final_answer>Partly.</their_final_answer>')
  })
})

describe('Reveal assembly', () => {
  it('hides secret endings and adds an unconfronted slant correction for a character the student met', async () => {
    const cloned = structuredClone(mini)
    cloned.definingMoments[0]?.outcomes.find((outcome) => outcome.id === 'o-delay')?.closesEndingIds.push('e-secret')
    const spec = EngineSpec.parse(cloned)
    const game = new Harness(spec)
    await game.start()
    await game.say('a', 'Hello')

    const reveal = await finish(game)
    expect(reveal.reveal?.pathVsHistory[0]?.closedEndings).not.toContain('Hidden')
    expect(reveal.reveal?.corrections).toEqual([
      'A\'s view that "The island is mine." was one-sided: The letter says the key line.',
      'A slanted.',
    ])
    expect(PlayerView.parse(reveal)).toBeDefined()
  })

  it('skips a slant correction when its contradictory discovery is missing', async () => {
    const cloned = structuredClone(mini)
    const slant = cloned.characters.find((character) => character.id === 'a')?.slants[0]
    if (slant === undefined) throw new Error('mini fixture has no slant for A')
    slant.contradictedBy = ['missing-discovery']
    const spec = EngineSpec.parse(cloned)
    const game = new Harness(spec)
    await game.start()
    await game.say('a', 'Hello')

    const reveal = await finish(game)
    expect(reveal.reveal?.corrections).toEqual(['A slanted.'])
  })

  it('does not add a correction for a slant the student confronted', async () => {
    const game = new Harness(mini)
    await game.start()
    await game.say('a', 'Hello')
    game.state.confrontedSlants.push('slant-a')

    const reveal = await finish(game)
    expect(reveal.reveal?.corrections).toEqual(['A slanted.'])
  })

  it('explains matched and unmatched prediction playback', async () => {
    const game = new Harness(mini)
    await game.start()
    const reveal = await finish(game, { secondPrediction: 'o-alt1' })

    expect(reveal.reveal?.more.playback.predictions).toEqual([
      'You predicted: He will wait. That is what happened.',
      'You predicted: He will wait. What happened: Recognised.',
    ])
  })

  it('includes verdict and free-text Interview playback', async () => {
    const game = new Harness(mini)
    await game.start()
    const reveal = await finish(game, { firstText: 'First thought.', secondText: 'Final thought.' })

    expect(reveal.reveal?.more.playback.interview).toEqual([
      'Your first answer: Yes. — First thought.',
      'After the push-back: Partly. — Final thought.',
    ])
  })

  it('keeps the full reveal view parseable as PlayerView', async () => {
    const game = new Harness(mini)
    const initial = PlayerView.parse(project(mini, game.state))
    const started = PlayerView.parse(await game.start())
    const reveal = await finish(game)

    expect(initial.phase).toBe('briefing')
    expect(started.phase).toBe('stage')
    expect(reveal.phase).toBe('reveal')
    expect(reveal.reveal).not.toBeNull()
  })
})
