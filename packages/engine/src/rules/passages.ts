/**
 * Close reading [P13.1, P13.2]: reading creates nothing; selecting a passage that overlaps a key passage
 * creates its note. Deterministic, with no model. Partial phrases and surrounding context are accepted;
 * discovery grants remain idempotent when the student highlights the same evidence again.
 */
import { evaluate } from '../conditions'
import type { StepContext } from '../context'
import type { SpecDocument } from '../spec'
import { grantDiscovery } from './knowledge'

export function matchesKeyPassage(passage: { start: number; end: number }, start: number, end: number): boolean {
  return Math.min(end, passage.end) > Math.max(start, passage.start)
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
