/**
 * The Interview [E2]. **Owner: Damian.** E2.4.1 chooses the counterpoint, E2.4.2 and E2.6 let the
 * interviewer put it in their own voice, with the rule text as the fallback.
 */
import type { InterviewView } from '@adventure/play-contract'

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

/** E2.4.1: a note the student holds that cuts against the verdict, then a missed core discovery, then the general counter. */
function pushBackFor(ctx: StepContext, ending: SpecEnding, verdictId: string): string {
  const verdict = ending.interview.verdicts.find((candidate) => candidate.id === verdictId)
  const held = verdict?.counterPoints.find((id) => ctx.state.discovered.includes(id))
  if (held !== undefined) return `Yet you noted: "${ctx.spec.discoveries.find((discovery) => discovery.id === held)?.note}". Doesn't that cut the other way?`
  const missed = verdict?.counterPoints.find((id) => ctx.spec.discoveries.some((discovery) => discovery.id === id && discovery.core) && !ctx.state.discovered.includes(id))
  if (missed !== undefined) return `Some would say: ${ctx.spec.discoveries.find((discovery) => discovery.id === missed)?.text} What do you make of that?`
  return ending.interview.generalCounter
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
  ctx.say('player', answer.text ?? verdict.text)
  if (first) {
    state.interview.answer = answer
    const point = pushBackFor(ctx, ending, verdict.id)
    state.interview.pushBack = (await interviewerLine(ctx, ending, 'pushBack', { answer: answerForInterviewer, counterpoint: point })) ?? point
    ctx.say('character', state.interview.pushBack)
  } else {
    state.interview.response = answer
    state.interview.closing = (await interviewerLine(ctx, ending, 'closing', { answer: answerForInterviewer })) ?? INTERVIEW_CLOSING
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
