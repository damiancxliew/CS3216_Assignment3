import { describe, expect, it } from 'vitest'
import { requestsSchemaUpgrade } from '@/lib/v3/review-chat/upgrade-intent'

describe('schema upgrade chat routing', () => {
  it.each(['upgrade this adventure', 'Can you migrate this game?', 'upgrade to the latest schema', 'Upgrade the adventure format', 'upgrade'])('recognizes an explicit upgrade request: %s', (message) => {
    expect(requestsSchemaUpgrade(message)).toBe(true)
  })
  it.each(['Upgrade the captain’s dialogue', 'make the questions easier', 'Tell me what schema version this uses', 'Do not upgrade this game', 'How do I upgrade this adventure?'])('leaves ordinary edits and questions in review chat: %s', (message) => {
    expect(requestsSchemaUpgrade(message)).toBe(false)
  })
})
