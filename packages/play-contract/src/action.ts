/**
 * Everything a student can do in a v3 game. Student input is untrusted (C10): every object is strict,
 * every string is bounded, and the API parses a request body with `Action` before the engine sees it.
 *
 * Server-only actions (the post-turn check result) are deliberately absent. The engine defines them
 * itself, so a client can never forge a discovery by posting one.
 */
import { z } from 'zod'

import { Id } from './ids'

export const MAX_MESSAGE_LENGTH = 1000
export const MAX_NOTE_COMMENT_LENGTH = 500
export const MAX_INTERVIEW_TEXT_LENGTH = 1500
export const MAX_EVIDENCE_NOTES = 5

const text = (max: number) => z.string().trim().min(1).max(max)
/** Documents are at most a few thousand characters; the bound keeps a hostile offset from reaching the engine. */
const offset = z.number().int().nonnegative().max(100_000)

/** Free conversation with a character in the student's room. */
export const MessageAction = z.strictObject({
  type: z.literal('message'),
  characterId: Id,
  text: text(MAX_MESSAGE_LENGTH),
})

/** Pass one of the student's notes on, optionally with a few words (P8, P8.1). Also how a slant is confronted. */
export const InsertNoteAction = z.strictObject({
  type: z.literal('insertNote'),
  characterId: Id,
  noteId: Id,
  text: text(MAX_NOTE_COMMENT_LENGTH).optional(),
})

/** Select part of a held document; overlapping a key passage makes a note (P13.2). Offsets are into `body`, end exclusive. */
export const SelectPassageAction = z
  .strictObject({
    type: z.literal('selectPassage'),
    documentId: Id,
    start: offset,
    end: offset,
  })
  .refine((action) => action.end > action.start, { message: 'end must be after start', path: ['end'] })

export const SubmitReadingCheckAction = z.strictObject({
  type: z.literal('submitReadingCheck'),
  documentId: Id,
  questionId: Id,
  choiceId: Id,
  start: offset,
  end: offset,
  recovery: z.boolean().optional(),
}).refine(action => action.end > action.start, { message: 'Select supporting evidence.', path: ['end'] })

export const ContinueReadingCheckAction = z.strictObject({
  type: z.literal('continueReadingCheck'), documentId: Id, questionId: Id,
})

/** The student arrived in a room. Walking itself stays on the client. */
export const EnterRoomAction = z.strictObject({ type: z.literal('enterRoom'), roomId: Id })

/** Pick up (if placed in the room) and open a document. Reading pauses the stuck clock (P5.1.3). */
export const OpenDocumentAction = z.strictObject({ type: z.literal('openDocument'), documentId: Id })

export const CloseDocumentAction = z.strictObject({ type: z.literal('closeDocument'), documentId: Id })

/** Start the defining moment when ready (P1.1, P9.5). */
export const EndStageAction = z.strictObject({ type: z.literal('endStage') })

/** Choose a go-between act at the defining moment (P9.1). */
export const ActAction = z.strictObject({ type: z.literal('act'), actId: Id })

/** One-tap prediction of what the real figure will decide (P3.2). */
export const PredictAction = z.strictObject({ type: z.literal('predict'), outcomeId: Id })

/** An Interview answer: a verdict, notes as evidence and optional words. Used again to respond to the push-back (E2.1–E2.5). */
export const InterviewAnswerAction = z.strictObject({
  type: z.literal('interviewAnswer'),
  verdictId: Id,
  evidenceNoteIds: z.array(Id).max(MAX_EVIDENCE_NOTES),
  text: text(MAX_INTERVIEW_TEXT_LENGTH).optional(),
})

/** Move past a screen with no choice: briefing, a stage opening, the epilogue, the Interview's close. */
export const ContinueAction = z.strictObject({ type: z.literal('continue') })

/** Sent every ~15 s and on load so time rules run without a student action (timer, final call, hints, timed events). */
export const TickAction = z.strictObject({ type: z.literal('tick') })

export const Action = z.discriminatedUnion('type', [
  MessageAction,
  InsertNoteAction,
  SelectPassageAction,
  SubmitReadingCheckAction,
  ContinueReadingCheckAction,
  EnterRoomAction,
  OpenDocumentAction,
  CloseDocumentAction,
  EndStageAction,
  ActAction,
  PredictAction,
  InterviewAnswerAction,
  ContinueAction,
  TickAction,
])
export type Action = z.infer<typeof Action>
export type ActionType = Action['type']

export const ACTION_TYPES = [
  'message',
  'insertNote',
  'selectPassage',
  'submitReadingCheck',
  'continueReadingCheck',
  'enterRoom',
  'openDocument',
  'closeDocument',
  'endStage',
  'act',
  'predict',
  'interviewAnswer',
  'continue',
  'tick',
] as const satisfies readonly ActionType[]
