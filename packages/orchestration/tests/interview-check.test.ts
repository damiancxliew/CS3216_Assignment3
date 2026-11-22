import { describe, expect, it, vi } from 'vitest'

import type { DecisionRequest, DecisionResponse, LlmClient } from '../src/llm/types'
import {
  CHECK_DECISION_THRESHOLD,
  MODERATION_DECISION_QUESTIONS,
  checkExchange,
  checkInterviewAnswer,
  moderationFromProbabilities,
  type CheckInput,
  type InterviewCheckInput,
} from '../src/v3'

const usage = { promptTokens: 10, completionTokens: 4, cachedPromptTokens: 0, reasoningTokens: 0 }
const decisionResponse = (probabilities: Record<string, number>): DecisionResponse => ({ probabilities, usage })

const interviewInput: InterviewCheckInput = {
  interviewer: 'A museum guide',
  question: 'Why did Singapore fall?',
  verdict: 'The Japanese moved fast.',
  answer: 'The fleet was lost, but the defenders still had choices.',
  counterpoints: [
    { id: 'fleet', text: 'The promised fleet never came.' },
    { id: 'water', text: 'Water and ammunition ran out.' },
    { id: 'air', text: 'Japanese aircraft sank the ships.' },
  ],
}

const postTurnInput: CheckInput = {
  characterName: 'Raffles',
  roleName: 'Ahmad',
  revealable: [
    { id: 'fact-a', text: 'Raffles was instructed to avoid a quarrel with the Dutch.' },
    { id: 'fact-b', text: 'Hussein was the elder son.' },
  ],
  studentNotes: [],
  turn: { kind: 'message', text: 'What were your instructions?' },
  reply: 'I was told to tread carefully.',
}

function llmWithDecide(decide: (request: DecisionRequest) => Promise<DecisionResponse>): LlmClient {
  return {
    complete: vi.fn(async () => {
      throw new Error('completion should not run')
    }),
    decide,
  }
}

describe('shared moderation decisions', () => {
  it('returns no flag when no probability reaches the threshold', () => {
    expect(moderationFromProbabilities({ flag_abusive: 0.49 })).toEqual({
      flagged: false,
      category: 'none',
      reason: null,
    })
  })

  it('returns the single flagged category with its fixed reason', () => {
    expect(moderationFromProbabilities({ flag_threat: CHECK_DECISION_THRESHOLD })).toEqual({
      flagged: true,
      category: 'threat',
      reason: 'Flagged as a threat by the automatic check.',
    })
  })

  it('prefers severity over a higher probability', () => {
    expect(moderationFromProbabilities({ flag_threat: 0.5, flag_provocative: 1 })).toMatchObject({
      flagged: true,
      category: 'threat',
    })
  })

  it('breaks equal-severity ties by probability', () => {
    expect(moderationFromProbabilities({ flag_abusive: 0.7, flag_hateful: 0.8 })).toMatchObject({
      flagged: true,
      category: 'hateful',
    })
  })

  it('treats missing and NaN probabilities as zero', () => {
    expect(moderationFromProbabilities({ flag_abusive: Number.NaN, flag_threat: 0.49 })).toEqual({
      flagged: false,
      category: 'none',
      reason: null,
    })
  })
})

describe('Interview check', () => {
  it('returns addressed candidates in candidate order and shares moderation decisions', async () => {
    const decide = vi.fn(async (_request: DecisionRequest) =>
      decisionResponse({
        addressed_0: 0.5,
        addressed_1: 0.49,
        addressed_2: 0.9,
        flag_abusive: 0.8,
        flag_threat: 0.6,
      }),
    )

    const result = await checkInterviewAnswer(llmWithDecide(decide), interviewInput)

    expect(result).toMatchObject({
      addressed: ['fleet', 'air'],
      moderation: {
        flagged: true,
        category: 'threat',
        reason: 'Flagged as a threat by the automatic check.',
      },
    })
  })

  it('asks addressed questions first, followed by the shared moderation questions', async () => {
    const decide = vi.fn(async (_request: DecisionRequest) => decisionResponse({}))
    await checkInterviewAnswer(llmWithDecide(decide), interviewInput)

    expect(decide.mock.calls[0]?.[0].questions.map(({ name }) => name)).toEqual([
      'addressed_0',
      'addressed_1',
      'addressed_2',
      ...MODERATION_DECISION_QUESTIONS.map(({ name }) => name),
    ])
  })

  it('returns null when Decisions is missing, throws, or the answer is blank', async () => {
    const noDecisions: LlmClient = { complete: vi.fn() }
    expect(await checkInterviewAnswer(noDecisions, interviewInput)).toBeNull()

    const throwing = llmWithDecide(async () => {
      throw new Error('unavailable')
    })
    expect(await checkInterviewAnswer(throwing, interviewInput)).toBeNull()
    expect(
      await checkInterviewAnswer(throwing, { ...interviewInput, answer: '  \n' }),
    ).toBeNull()
  })
})

describe('post-turn question ordering', () => {
  it('keeps conveyed facts, substantive, asserted, and moderation in the existing order', async () => {
    const decide = vi.fn(async (_request: DecisionRequest) => decisionResponse({}))
    await checkExchange(llmWithDecide(decide), postTurnInput)

    expect(decide.mock.calls[0]?.[0].questions.map(({ name }) => name)).toEqual([
      'conveyed_0',
      'conveyed_1',
      'substantive',
      'asserted',
      ...MODERATION_DECISION_QUESTIONS.map(({ name }) => name),
    ])
    expect(decide.mock.calls[0]?.[0].questions[0]?.instructions).toContain(postTurnInput.revealable[0]!.text)
  })
})
