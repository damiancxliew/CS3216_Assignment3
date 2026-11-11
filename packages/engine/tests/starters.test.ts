import { describe, expect, it } from 'vitest'

import { hintToStarter } from '../src/starters'

describe('hintToStarter', () => {
  it('turns ask-hints into first-person questions', () => {
    expect(hintToStarter('Ask Percival why he is so sure of his plan.', 'Arthur Percival')).toBe('Why are you so sure of your plan?')
    expect(hintToStarter('Ask Bennett about a counterattack.', 'Gordon Bennett')).toBe('What can you tell me about a counterattack?')
    expect(hintToStarter('Ask Percival how bad the situation is.', 'Arthur Percival')).toBeNull()
  })
  it('skips hints that do not fit', () => {
    expect(hintToStarter('Read the telegram again.', 'Arthur Percival')).toBeNull()
    expect(hintToStarter('Ask Percival: "Will you change the plan?"', 'Arthur Percival')).toBeNull()
    expect(hintToStarter('Ask Percival why the staff distrust him.', 'Arthur Percival')).toBeNull()
  })
})
