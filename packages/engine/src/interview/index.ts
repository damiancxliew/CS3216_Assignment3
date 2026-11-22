/**
 * The Interview [E2]. **Owner: Damian.** E2.4.1 chooses the counterpoint, E2.4.2 and E2.6 let the
 * interviewer put it in their own voice, with the rule text as the fallback.
 */
import type { InterviewView } from '@adventure/play-contract'
import { checkInterviewAnswer } from '@adventure/orchestration/v3'

import { fail, type StepContext } from '../context'
import type { EngineSpec, SpecEnding } from '../spec'
import type { EngineState, InterviewAnswerState } from '../state'
import { interviewerLine } from './voice'

export const INTERVIEW_CLOSING = 'Thank you. I will set that down as you said it.'

export function endingOf(spec: EngineSpec, state: EngineState): SpecEnding | null {
  return spec.endings.find((ending) => ending.id === state.endingId) ?? null
}

export function startInterview(ctx: StepContext): void {
  const ending = endingOf(ctx.spec, ctx.state) ?? fail('illegal_phase', 'no ending reached')
  ctx.state.interview = { answer: null, pushBack: null, response: null, closing: null, closed: false }
  ctx.say('character', ending.interview.question)
}

interface PushBackCandidate {
  id: string
  text: string
  held: boolean
}

/** E2.4.1: held counterpoints first, then undiscovered core counterpoints, in rule order. */
function pushBackCandidates(ctx: StepContext, ending: SpecEnding, verdictId: string): PushBackCandidate[] {
  const verdict = ending.interview.verdicts.find((candidate) => candidate.id === verdictId)
  const candidates = (verdict?.counterPoints ?? []).flatMap((id) => {
    const discovery = ctx.spec.discoveries.find((candidate) => candidate.id === id)
    if (discovery === undefined) return []
    const held = ctx.state.discovered.includes(id)
    return held || discovery.core ? [{ id, text: discovery.text, held }] : []
  })
  return [...candidates.filter((candidate) => candidate.held), ...candidates.filter((candidate) => !candidate.held)]
}

/** E2.4.1: skip points the student has already dealt with; then use the general counter. */
function pushBackFor(
  ctx: StepContext,
  ending: SpecEnding,
  candidates: readonly PushBackCandidate[],
  addressed: readonly string[],
): string {
  const candidate = candidates.find(({ id }) => !addressed.includes(id))
  if (candidate === undefined) return ending.interview.generalCounter
  if (candidate.held) {
    const note = ctx.spec.discoveries.find((discovery) => discovery.id === candidate.id)?.note
    return `Yet you noted: "${note}". Doesn't that cut the other way?`
  }
  return `Some would say: ${candidate.text} What do you make of that?`
}

function emitInterviewFlag(
  ctx: StepContext,
  messageId: string,
  moderation: { flagged: boolean; category: string; reason: string | null } | undefined,
): void {
  if (moderation?.flagged && moderation.category !== 'none') {
    ctx.emit({
      type: 'flag',
      messageId,
      category: moderation.category as 'abusive' | 'threat' | 'hateful' | 'provocative' | 'sexual' | 'self_harm',
      reason: moderation.reason,
    })
  }
}

export async function handleInterviewAnswer(ctx: StepContext, action: { verdictId: string; evidenceNoteIds: string[]; text?: string | undefined }): Promise<void> {
  const { state } = ctx
  if (state.phase !== 'interview' || state.interview.closed) fail('illegal_phase', 'no Interview question is open')
  const ending = endingOf(ctx.spec, state) ?? fail('illegal_phase', 'no ending reached')
  const verdict = ending.interview.verdicts.find((candidate) => candidate.id === action.verdictId) ?? fail('unknown_id', `no verdict ${action.verdictId}`)
  for (const noteId of action.evidenceNoteIds) if (!state.notes.some((note) => note.id === noteId)) fail('not_held', `no note ${noteId}`)
  const answer: InterviewAnswerState = { verdictId: verdict.id, evidenceNoteIds: [...new Set(action.evidenceNoteIds)], text: action.text ?? null }
  const answerForInterviewer = action.text ? `${verdict.text} — ${action.text.replace(/[<>]/g, '')}` : verdict.text
  const first = state.interview.answer === null
  ctx.emit({ type: 'verdict', endingId: ending.id, verdictId: verdict.id, evidenceNoteIds: answer.evidenceNoteIds, stage: first ? 'initial' : 'final', text: answer.text })
  const playerMessage = ctx.say('player', answer.text ?? verdict.text)
  if (first) {
    state.interview.answer = answer
    const candidates = pushBackCandidates(ctx, ending, verdict.id)
    let addressed: string[] = []
    if (action.text?.trim()) {
      const checked = await checkInterviewAnswer(ctx.llm, {
        interviewer: ending.interview.interviewer,
        question: ending.interview.question,
        verdict: verdict.text,
        answer: action.text,
        counterpoints: candidates.map(({ id, text }) => ({ id, text })),
      })
      if (checked !== null) {
        addressed = checked.addressed
        emitInterviewFlag(ctx, playerMessage.id, checked.moderation)
      }
    }
    const point = pushBackFor(ctx, ending, candidates, addressed)
    state.interview.pushBack = (await interviewerLine(ctx, ending, 'pushBack', { answer: answerForInterviewer, counterpoint: point })) ?? point
    ctx.say('character', state.interview.pushBack)
  } else {
    state.interview.response = answer
    const check = action.text?.trim()
      ? checkInterviewAnswer(ctx.llm, {
          interviewer: ending.interview.interviewer,
          question: ending.interview.question,
          verdict: verdict.text,
          answer: action.text,
          counterpoints: [],
        })
      : Promise.resolve(null)
    const [checked, closing] = await Promise.all([
      check,
      interviewerLine(ctx, ending, 'closing', { answer: answerForInterviewer }),
    ])
    if (checked !== null) emitInterviewFlag(ctx, playerMessage.id, checked.moderation)
    state.interview.closing = closing ?? INTERVIEW_CLOSING
    state.interview.closed = true
    ctx.say('character', state.interview.closing)
  }
  ctx.touch()
}

export function projectInterview(spec: EngineSpec, state: EngineState): InterviewView | null {
  if (state.phase !== 'interview' && state.phase !== 'reveal') return null
  const ending = endingOf(spec, state)
  if (ending === null) return null
  return {
    interviewer: ending.interview.interviewer,
    question: ending.interview.question,
    verdicts: ending.interview.verdicts.map(({ id, text }) => ({ id, text })),
    ...structuredClone(state.interview),
  }
}
