import { describe, expect, it } from 'vitest'

import { PERSONA_SYSTEM_PROMPT, STAGE_DETAILS_SYSTEM_PROMPT } from '../src/v3/details/prompt'
import { skeletonSystemPrompt } from '../src/v3/skeleton/prompt'

describe('v3 writing instructions', () => {
  it('keeps source status in metadata while protecting authentic wording and dates', () => {
    const skeleton = skeletonSystemPrompt('sec')
    expect(skeleton).toContain('the interface shows source status separately from real and sourceLabel')
    expect(skeleton).toContain('a modern account of a wartime letter remains a modern account')
    expect(skeleton).toContain('true only if the document\'s actual text appears in the sources')

    expect(STAGE_DETAILS_SYSTEM_PROMPT).toContain('Keep classroom instructions, source evaluation, and explanations of the document\'s invented status out of its title and body')
    expect(STAGE_DETAILS_SYSTEM_PROMPT).toContain('Preserve truthful metadata, including real: false')
    expect(STAGE_DETAILS_SYSTEM_PROMPT).toContain('never present its commentary as the letter itself')
    expect(STAGE_DETAILS_SYSTEM_PROMPT).toContain('including any source-status wording in the original quotation')
  })

  it('uses concise writing guidance for documents and personas without relaxing grounding', () => {
    for (const prompt of [STAGE_DETAILS_SYSTEM_PROMPT, PERSONA_SYSTEM_PROMPT]) {
      expect(prompt).toContain('Write in the voice of the person speaking or writing, for their intended reader')
      expect(prompt).toContain('Every sentence should add something')
      expect(prompt).toContain('Narrow or omit unsupported claims. Never invent a quotation.')
      expect(prompt).not.toContain('$humanizer')
    }
  })
})
