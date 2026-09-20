/**
 * Deterministic stand-in for the OpenAI client, so the whole package is testable without a key.
 * It also records every request verbatim, which is how the private-context isolation tests inspect
 * exactly what would have left the server (FR-21).
 */
import type { LlmClient, LlmRequest, LlmResponse } from './types'

export type FakeReply = string | ((request: LlmRequest, callIndex: number) => string)

export interface FakeLlmClientOptions {
  /** Replies returned in order. The last one repeats once the script runs out. */
  replies: readonly FakeReply[]
}

export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = []
  private callIndex = 0

  constructor(private readonly options: FakeLlmClientOptions) {
    if (options.replies.length === 0) throw new Error('FakeLlmClient needs at least one reply')
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request)
    const index = Math.min(this.callIndex, this.options.replies.length - 1)
    this.callIndex += 1
    const reply = this.options.replies[index] as FakeReply
    const content = typeof reply === 'function' ? reply(request, this.callIndex - 1) : reply
    return {
      content,
      usage: {
        promptTokens: request.system.length + request.user.length,
        completionTokens: content.length,
      },
    }
  }

  get lastRequest(): LlmRequest | undefined {
    return this.requests[this.requests.length - 1]
  }
}
