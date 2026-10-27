import { createRng } from '@adventure/orchestration'
import { supportsReadingSelection } from '@adventure/spec-v3'
import type { Action, DocumentView } from '@adventure/play-contract'

import { evaluate } from '../conditions'
import { fail, lookup, type StepContext } from '../context'
import type { SpecDocument } from '../spec'
import type { EngineState, ReadingCheckState } from '../state'
import { grantDiscovery, markProgress } from './knowledge'

function initialReadingState(): ReadingCheckState {
  return { status: 'unanswered', variantIndex: 0, discoveredAtFailure: [], attempts: [] }
}

function canRetry(document: SpecDocument, state: EngineState, progress: ReadingCheckState): boolean {
  return document.readingCheck?.recoveryDiscoveryIds.some((id) => state.discovered.includes(id) && !progress.discoveredAtFailure.includes(id)) ?? false
}

function advance(progress: ReadingCheckState, count: number): void {
  progress.status = 'unanswered'
  progress.variantIndex = (progress.variantIndex + 1) % count
}

/** A newly acquired related fact buys one new variant, never repeated reuse of an old note. */
export function refreshReadingChecks(ctx: StepContext): void {
  for (const document of ctx.spec.documents) {
    const progress = ctx.state.readingChecks?.[document.id]
    if (document.readingCheck === undefined || progress?.status !== 'needsReview' || !canRetry(document, ctx.state, progress)) continue
    advance(progress, document.readingCheck.variants.length)
    ctx.touch()
  }
}

export function readingCheckView(document: SpecDocument, state: EngineState): DocumentView['readingCheck'] {
  const check = document.readingCheck
  if (check === undefined) return undefined
  const progress = state.readingChecks?.[document.id] ?? initialReadingState()
  const lastAttempt = progress.attempts.at(-1)
  const publicQuestion = (question: typeof check.recovery) => {
    // Rebuild the same shuffle from the private attempt seed on every projection.
    // No new persisted state is needed, and grading continues to use option IDs.
    const rng = createRng(JSON.stringify(['reading-options', state.seed, document.id, question.id]))
    const options = question.options.map(({ id, text }) => ({ id, text }))
    for (let index = options.length - 1; index > 0; index--) {
      const other = rng.int(0, index)
      ;[options[index], options[other]] = [options[other]!, options[index]!]
    }
    return { id: question.id, prompt: question.prompt, options }
  }
  return {
    status: progress.status,
    question: progress.status === 'unanswered' ? publicQuestion(check.variants[progress.variantIndex]!) : null,
    // The active variant stays fixed until its correction is accepted.
    recovery: progress.status === 'needsReview' ? publicQuestion(check.variants[progress.variantIndex]!) : null,
    feedback: progress.status === 'needsReview'
      ? lastAttempt?.recovery && !lastAttempt.correct
        ? 'That correction is not supported. Re-read the source, then choose an answer and highlight one or two sentences that support it.'
        : 'Review the source. Complete the correction or investigate related evidence before trying again.'
      : null,
    explanation: progress.status === 'passed' ? check.variants[progress.variantIndex]!.explanation : null,
  }
}

export function submitReadingCheck(ctx: StepContext, action: Extract<Action, { type: 'submitReadingCheck' }>): void {
  const { state } = ctx
  const document = lookup.document(ctx.spec, action.documentId)
  const check = document.readingCheck ?? fail('invalid_action', 'this document has no reading check')
  if (!state.heldDocuments.includes(document.id)) fail('not_held', 'pick the document up first')
  if (state.openDocumentId !== document.id) fail('invalid_action', 'open the document before answering')
  if (action.start < 0 || action.end > document.body.length || action.start >= action.end) fail('invalid_action', 'selection is outside the document')
  state.readingChecks ??= {}
  const progress = state.readingChecks[document.id] ??= initialReadingState()
  // An already accepted delivery is safe to replay, but cannot produce another event or note.
  if (progress.status === 'passed') return
  const recovery = action.recovery === true
  if (!recovery && progress.status === 'needsReview') fail('preparation_required', 'review this source before trying another question')
  if (recovery && progress.status !== 'needsReview') fail('invalid_action', 'no correction is needed')
  const question = check.variants[progress.variantIndex]!
  if (action.questionId !== question.id || !question.options.some((option) => option.id === action.choiceId)) fail('invalid_action', 'Question changed. Close and reopen this source to refresh it.')
  const correct = action.choiceId === question.correctOptionId && supportsReadingSelection(document.body, question.support, action.start, action.end)
  progress.attempts.push({ at: ctx.now, questionId: question.id, choiceId: action.choiceId, start: action.start, end: action.end, correct, recovery })
  ctx.emit({ type: 'readingCheck', documentId: document.id, questionId: question.id, correct, recovery })
  if (correct && recovery) {
    advance(progress, check.variants.length)
    markProgress(ctx)
  } else if (correct) {
    const discovery = lookup.discovery(ctx.spec, check.discoveryId)
    if (!evaluate(discovery.condition, { spec: ctx.spec, state, now: ctx.now })) fail('preparation_required', 'more preparation is needed for this source')
    progress.status = 'passed'
    grantDiscovery(ctx, discovery, 'passage')
  } else {
    progress.status = 'needsReview'
    progress.discoveredAtFailure = [...state.discovered]
  }
  ctx.touch()
}
