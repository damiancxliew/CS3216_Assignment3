import { describe, expect, it } from 'vitest'
import { reviewClaimEvidence } from '../evals/v3-grounding'
import { FakeLlmClient } from '../src/llm/client'
import type { ExtractedDocument } from '../src/ingest/types'

const quote = 'The treaty was signed on 6 February 1819.'
const documents: ExtractedDocument[] = [{ id: 'src', title: 'Handout', kind: 'text', contentHash: 'h', pageCount: 1, charCount: quote.length, pages: [{ page: 1, text: quote }], warnings: [] }]
const claim = { text: 'Some merchants resented new port dues.', note: 'The merchants disliked the dues.', citations: [{ sourceId: 'src', quote }] }

describe('claim/evidence evaluation', () => {
  it('reports unrelated genuine quotations separately from quote occurrence', async () => {
    const llm = new FakeLlmClient([{ json: { textSupported: false, noteSupported: false, reason: 'The date gives no evidence of merchants or dues.' } }])
    const result = await reviewClaimEvidence(claim, documents, llm)
    expect(result.quoteErrors).toEqual([])
    expect(result.support).toMatchObject({ textSupported: false, noteSupported: false })
    const context = JSON.parse(llm.requests[0]!.user)
    expect(context).toEqual({ text: claim.text, note: claim.note, evidence: claim.citations })
  })

  it('keeps unsupported additions in the student note visible even when the discovery is supported', async () => {
    const llm = new FakeLlmClient([{ json: { textSupported: true, noteSupported: false, reason: 'No evidence that all merchants celebrated.' } }])
    const result = await reviewClaimEvidence({ ...claim, text: quote, note: 'They signed on 6 February and all merchants celebrated.' }, documents, llm)
    expect(result.support).toMatchObject({ textSupported: true, noteSupported: false })
  })

  it('does not pay for a support review when the quote is fabricated or absent', async () => {
    const llm = new FakeLlmClient([])
    const invalid = await reviewClaimEvidence({ ...claim, citations: [{ sourceId: 'src', quote: 'The merchants welcomed new dues.' }] }, documents, llm)
    expect(invalid.quoteErrors).toContainEqual(expect.objectContaining({ code: 'quote-not-in-source' }))
    const missing = await reviewClaimEvidence({ ...claim, citations: [] }, documents, llm)
    expect(missing.quoteErrors).toContainEqual(expect.objectContaining({ code: 'evidence-missing' }))
    expect(invalid.support).toBeNull()
    expect(missing.support).toBeNull()
    expect(llm.requests).toHaveLength(0)
  })

  it('fails an unavailable reviewer instead of treating it as supported', async () => {
    await expect(reviewClaimEvidence(claim, documents, new FakeLlmClient([{ refusal: 'Unavailable' }]))).rejects.toThrow('Unavailable')
  })
})
