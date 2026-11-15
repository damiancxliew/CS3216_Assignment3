import { PlayerView } from '@adventure/play-contract'
import { describe, expect, it, vi } from 'vitest'

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

  it('preserves held-first and general rule push-backs when Decisions is unavailable', async () => {
    const heldGame = new Harness(mini)
    await reachInterview(heldGame)
    heldGame.state.discovered.push('d-a2')
    const held = await heldGame.act({ type: 'interviewAnswer', verdictId: 'yes', evidenceNoteIds: [] })
    expect(held.interview?.pushBack).toBe('Yet you noted: "A fears Riau.". Doesn\'t that cut the other way?')

    const generalGame = new Harness(mini)
    await reachInterview(generalGame)
    const general = await generalGame.act({ type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: [] })
    expect(general.interview?.pushBack).toBe('Others would disagree.')
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

  it('skips an addressed held counterpoint and chooses the next core counterpoint', async () => {
    const cloned = structuredClone(mini)
    const verdict = cloned.endings[0]?.interview.verdicts.find((candidate) => candidate.id === 'yes')
    if (!verdict) throw new Error('mini fixture is missing the yes verdict')
    verdict.counterPoints = ['d-a2', 'd-a1']
    const game = new Harness(EngineSpec.parse(cloned))
    await reachInterview(game)
    game.state.discovered.push('d-a2')

    const decide = vi.fn(async () => ({
      probabilities: { addressed_0: 0.9 },
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, reasoningTokens: 0 },
    }))
    Object.assign(game.llm, { decide })

    const pushed = await game.act({
      type: 'interviewAnswer',
      verdictId: 'yes',
      evidenceNoteIds: [],
      text: 'I know A fears Riau, but the trade still matters.',
    })

    expect(decide).toHaveBeenCalledTimes(1)
    expect(pushed.interview?.pushBack).toBe('Some would say: A wants a share. What do you make of that?')
  })

  it('uses the general counter when all candidates are addressed and skips checking untyped answers', async () => {
    const game = new Harness(mini)
    await reachInterview(game)
    const decide = vi.fn(async () => ({
      probabilities: { addressed_0: 1 },
      usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, reasoningTokens: 0 },
    }))
    Object.assign(game.llm, { decide })

    const untyped = await game.act({ type: 'interviewAnswer', verdictId: 'yes', evidenceNoteIds: [] })
    expect(decide).not.toHaveBeenCalled()
    expect(untyped.interview?.pushBack).toBe('Some would say: A fears Riau. What do you make of that?')

    const closed = await game.act({ type: 'interviewAnswer', verdictId: 'partly', evidenceNoteIds: [] })
    expect(decide).not.toHaveBeenCalled()
    expect(closed.interview?.closing).toBe('Thank you for telling me.')

    const another = new Harness(mini)
    await reachInterview(another)
    Object.assign(another.llm, { decide })
    const answered = await another.act({
      type: 'interviewAnswer',
      verdictId: 'yes',
      evidenceNoteIds: [],
      text: 'I know that fear, and I have weighed it.',
    })
    expect(answered.interview?.pushBack).toBe('Others would disagree.')
  })

  it('flags typed answers against their player message and gives reply checks no counterpoints', async () => {
    const game = new Harness(mini)
    await reachInterview(game)
    const requests: { questions: { name: string }[] }[] = []
    const decide = vi.fn(async (request: { questions: { name: string }[] }) => {
      requests.push(request)
      return {
        probabilities: { flag_abusive: 0.9 },
        usage: { promptTokens: 1, completionTokens: 1, cachedPromptTokens: 0, reasoningTokens: 0 },
      }
    })
    Object.assign(game.llm, { decide })

    const first = await game.act({
      type: 'interviewAnswer',
      verdictId: 'yes',
      evidenceNoteIds: [],
      text: 'You are a fool.',
    })
    const firstPlayerId = first.messages.filter((message) => message.kind === 'player').at(-1)?.id
    expect(game.eventsOf('flag')).toContainEqual(expect.objectContaining({
      type: 'flag',
      messageId: firstPlayerId,
      category: 'abusive',
      reason: 'Flagged as abusive by the automatic check.',
    }))
    expect(JSON.stringify(first)).not.toContain('"type":"flag"')

    const second = await game.act({
      type: 'interviewAnswer',
      verdictId: 'partly',
      evidenceNoteIds: [],
      text: 'You are still a fool.',
    })
    const secondPlayerId = second.messages.filter((message) => message.kind === 'player').at(-1)?.id
    expect(game.eventsOf('flag')).toContainEqual(expect.objectContaining({
      type: 'flag',
      messageId: secondPlayerId,
      category: 'abusive',
    }))
    expect(requests).toHaveLength(2)
    expect(requests[1]?.questions.map(({ name }) => name)).toEqual([
      'flag_abusive',
      'flag_threat',
      'flag_hateful',
      'flag_provocative',
      'flag_sexual',
      'flag_self_harm',
    ])
    expect(JSON.stringify(second)).not.toContain('"type":"flag"')
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
