import OpenAI from 'openai'
import type { DecisionCreateParams } from 'openai/resources/decisions'

import type { LlmUsage } from './client'

export interface DecisionQuestion {
  name: string
  instructions: string
}

export interface DecisionRequest {
  input: unknown
  questions: DecisionQuestion[]
}

export interface DecisionResponse {
  probabilities: Record<string, number>
  usage: LlmUsage
  model: string
  latencyMs: number
}

export interface DecisionClient {
  decide(request: DecisionRequest): Promise<DecisionResponse>
}

export const DECISION_MODEL = 'gpt-6-luna'

export class OpenAiDecisionClient implements DecisionClient {
  private readonly client: OpenAI

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
    this.client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 })
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    if (request.questions.length > 400) {
      throw new Error('Decisions requests cannot contain more than 400 questions')
    }
    const started = Date.now()
    const response = await this.client.decisions.create({
      model: DECISION_MODEL,
      input: request.input as DecisionCreateParams['input'],
      questions: request.questions.map(({ name, instructions }) => ({
        type: 'predicate',
        name,
        instructions,
      })),
    })
    const probabilities: Record<string, number> = {}
    response.answers.forEach((answer, index) => {
      if (answer.type !== 'predicate') return
      const name = answer.name ?? request.questions[index]?.name
      if (name) probabilities[name] = answer.probability
    })
    return {
      probabilities,
      usage: {
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.input_tokens_details.cached_tokens,
        outputTokens: response.usage.output_tokens,
        reasoningTokens: response.usage.output_tokens_details.reasoning_tokens,
      },
      model: response.model,
      latencyMs: Date.now() - started,
    }
  }
}

export class FakeDecisionClient implements DecisionClient {
  readonly requests: DecisionRequest[] = []
  private readonly resolve: (request: DecisionRequest) => Record<string, number>

  constructor(
    replies:
      | ((request: DecisionRequest) => Record<string, number>)
      | Record<string, number>[],
  ) {
    const queue = Array.isArray(replies) ? [...replies] : null
    this.resolve = typeof replies === 'function'
      ? replies
      : () => queue?.shift() ?? {}
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    this.requests.push(request)
    return {
      probabilities: this.resolve(request),
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      model: DECISION_MODEL,
      latencyMs: 0,
    }
  }
}
