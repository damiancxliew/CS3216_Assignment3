/**
 * Close reading [P13.1, P13.2]: reading creates nothing; selecting a passage that overlaps a key passage
 * creates its note. Deterministic, with no model. The selection must cover a good part of the key passage
 * and must not be much longer than it, so selecting the whole document finds nothing.
 */
import { evaluate } from '../conditions'
import type { StepContext } from '../context'
import type { SpecDocument } from '../spec'
import { grantDiscovery } from './knowledge'

export const MIN_COVERAGE = 0.4
export const MAX_LENGTH_FACTOR = 2
export const LENGTH_SLACK = 40

export function matchesKeyPassage(passage: { start: number; end: number }, start: number, end: number): boolean {
  const overlap = Math.min(end, passage.end) - Math.max(start, passage.start)
  const length = passage.end - passage.start
  return overlap > 0 && overlap >= MIN_COVERAGE * length && end - start <= MAX_LENGTH_FACTOR * length + LENGTH_SLACK
}

export function selectPassage(ctx: StepContext, document: SpecDocument, start: number, end: number): void {
  for (const passage of document.keyPassages) {
    if (!matchesKeyPassage(passage, start, end)) continue
    const discovery = ctx.spec.discoveries.find(
      (candidate) => 'documentId' in candidate.holder && candidate.holder.documentId === document.id && candidate.holder.keyPassageId === passage.id,
    )
    if (discovery !== undefined && evaluate(discovery.condition, { spec: ctx.spec, state: ctx.state, now: ctx.now })) grantDiscovery(ctx, discovery, 'passage')
  }
}
