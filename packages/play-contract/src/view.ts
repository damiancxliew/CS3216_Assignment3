/**
 * What the client is allowed to see. `engine.project` builds this from public fields only; nothing here
 * may carry an undiscovered discovery, a persona, a stance name, a slant, a key passage, an outcome rule,
 * or a secret act or ending before it is unlocked or reached.
 *
 * Optional parts are `null` rather than absent, so the client never has to tell "missing" from "empty".
 */
import { z } from 'zod'

import { Id, StageIndex, Timestamp } from './ids'

export const PHASES = ['briefing', 'stage', 'epilogue', 'interview', 'reveal'] as const
export const Phase = z.enum(PHASES)
export type Phase = z.infer<typeof Phase>

export const RoleBriefingView = z.object({
  name: z.string(),
  position: z.string(),
  relationships: z.array(z.string()),
  reputation: z.string(),
  stakes: z.string(),
  privateBrief: z.object({
    goals: z.array(z.string()),
    fears: z.array(z.string()),
    constraints: z.array(z.string()),
    knows: z.array(z.string()),
  }),
  situation: z.string(),
})
export type RoleBriefingView = z.infer<typeof RoleBriefingView>

/** Shown when a stage opens: the consequences of the last stage and how the prediction turned out (P3.4, P3.5). */
export const StageIntroView = z.object({
  narration: z.string(),
  predictionReveal: z
    .object({
      predicted: z.string(),
      actual: z.string(),
      because: z.string(),
    })
    .nullable(),
})

export const StageView = z.object({
  index: StageIndex,
  count: z.number().int().positive(),
  title: z.string(),
  timePlace: z.string(),
  /** Always visible during the stage (P7). */
  centralQuestion: z.string(),
  /** Non-null until the student continues past the stage opening. */
  intro: StageIntroView.nullable(),
})
export type StageView = z.infer<typeof StageView>

export const RoomView = z.object({ id: Id, name: z.string() })

/** A character in the student's current room. `stanceId` picks the portrait; it is never shown as text (P6.5). */
export const CharacterView = z.object({
  id: Id,
  name: z.string(),
  title: z.string(),
  stanceId: Id.nullable(),
  /** `${characterId}` for characters without stances, `${characterId}:${stanceId}` otherwise. */
  portraitKey: z.string(),
})
export type CharacterView = z.infer<typeof CharacterView>

export const MESSAGE_KINDS = ['player', 'character', 'thought', 'notice', 'narration'] as const

/**
 * One line in the story. `thought` is a hint shown as the role's own thought (P5.6); `notice` is the subtle
 * stance-change line (P6.4); `narration` covers story events, the final call and reactions.
 */
export const MessageView = z.object({
  id: Id,
  kind: z.enum(MESSAGE_KINDS),
  characterId: Id.nullable(),
  roomId: Id.nullable(),
  text: z.string(),
  insertedNoteId: Id.nullable(),
  stageIndex: StageIndex.nullable(),
  at: Timestamp,
})
export type MessageView = z.infer<typeof MessageView>

/** The student's notes are the source of truth for what they know (P8). Both sources work the same (P8.5). */
export const NoteView = z.object({
  id: Id,
  text: z.string(),
  source: z.enum(['conversation', 'document']),
  stageIndex: StageIndex,
  at: Timestamp,
})
export type NoteView = z.infer<typeof NoteView>

export const DOCUMENT_KINDS = ['newspaper', 'letter', 'telegram', 'speech', 'minutes', 'memoir', 'treaty', 'report', 'other'] as const

export const ProvenanceView = z.object({
  masthead: z.string().nullable(),
  date: z.string().nullable(),
  sender: z.string().nullable(),
  recipient: z.string().nullable(),
  place: z.string().nullable(),
})

/** A held document. Key passages are never included: finding them is the student's work (P13.2). */
export const DocumentView = z.object({
  id: Id,
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string(),
  provenance: ProvenanceView,
  body: z.string(),
  /** Real excerpts get a subtle mark, and their source on request (P4.1). */
  real: z.boolean(),
  sourceLabel: z.string().nullable(),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
  open: z.boolean(),
})
export type DocumentView = z.infer<typeof DocumentView>

/** A document lying in the current room; read documents remain visible on the floor. */
export const DocumentHereView = z.object({ id: Id, kind: z.enum(DOCUMENT_KINDS), title: z.string(), read: z.boolean() })

export const DefiningMomentView = z.object({
  momentId: Id,
  scene: z.string(),
  deciderId: Id,
  /** The decider's display name, so the prediction prompt can name them when they aren't in the room. */
  deciderName: z.string(),
  /** `choosing`: pick an act. `predicting`: the reaction is shown, pick a prediction. */
  status: z.enum(['choosing', 'predicting']),
  /** 2–4 written acts, plus the secret act once unlocked (P9.1, P9.11). Never labelled. */
  /**
   * While choosing: every written act, with `available: false` on acts that can no longer happen, so the student
   * sees them struck out. A secret act appears only once unlocked.
   */
  acts: z.array(z.object({ id: Id, text: z.string(), available: z.boolean().optional() })),
  /** A non-blocking reminder when core discoveries are missing (P9.6). */
  nudge: z.string().nullable(),
  chosenActId: Id.nullable(),
  /** The characters' immediate reaction to the act (P9.7). */
  reaction: z.string().nullable(),
  /** The moment's outcomes as predictions, without secret or closed ones (P3.3). Empty until `predicting`. */
  predictionOptions: z.array(z.object({ outcomeId: Id, text: z.string() })),
})
export type DefiningMomentView = z.infer<typeof DefiningMomentView>

/** `project` has no clock, so the client counts down to `endsAt` itself. */
export const TimerView = z.object({ endsAt: Timestamp, durationMs: z.number().int().positive() })

/** How the student's own run ended, labelled as their simulation (E1). */
export const EpilogueView = z.object({ title: z.string(), text: z.string(), label: z.string() })

export const InterviewAnswerView = z.object({
  verdictId: Id,
  evidenceNoteIds: z.array(Id),
  text: z.string().nullable(),
})

/** The Interview (E2). Shape owned by Kevin; content filled by Damian's `engine/src/interview`. */
export const InterviewView = z.object({
  interviewer: z.string(),
  question: z.string(),
  verdicts: z.array(z.object({ id: Id, text: z.string() })),
  answer: InterviewAnswerView.nullable(),
  pushBack: z.string().nullable(),
  response: InterviewAnswerView.nullable(),
  closing: z.string().nullable(),
  closed: z.boolean(),
})
export type InterviewView = z.infer<typeof InterviewView>

/** The reveal (E3). Shape owned by Kevin; content filled by Damian's `engine/src/reveal`. */
export const RevealView = z.object({
  /** Shown by default (E3.8). */
  whatHappened: z.string(),
  pathVsHistory: z.array(
    z.object({ stageIndex: StageIndex, yours: z.string(), history: z.string(), matched: z.boolean(), closedEndings: z.array(z.string()) }),
  ),
  corrections: z.array(z.string()),
  missedCore: z.array(z.string()),
  /** On request (E3.8). */
  more: z.object({
    interpretations: z.array(z.string()),
    sources: z.object({ teacher: z.array(z.string()), other: z.array(z.string()), invented: z.array(z.string()) }),
    couldHaveGone: z.array(z.string()),
    secretPathExisted: z.boolean(),
    playback: z.object({ acts: z.array(z.string()), predictions: z.array(z.string()), interview: z.array(z.string()) }),
  }),
  /** The teacher's own end-of-game questions (T1). */
  teacherQuestions: z.array(z.string()),
})
export type RevealView = z.infer<typeof RevealView>

export const PlayerView = z.object({
  phase: Phase,
  /** Always available, so the student can re-read their brief. */
  briefing: RoleBriefingView,
  stage: StageView.nullable(),
  rooms: z.array(RoomView),
  currentRoomId: Id.nullable(),
  /** Characters in the current room only. */
  characters: z.array(CharacterView),
  /** Characters who appear in the transcript (have a line with their characterId), so the log can name people outside the current room; only characters the student has already met. */
  speakers: z.array(z.object({ id: Id, name: z.string(), title: z.string() })),
  messages: z.array(MessageView),
  notes: z.array(NoteView),
  documents: z.array(DocumentView),
  documentsHere: z.array(DocumentHereView),
  definingMoment: DefiningMomentView.nullable(),
  timer: TimerView.nullable(),
  /** A post-turn check is still running; poll for the notes or notices it may add. */
  pendingCheck: z.boolean(),
  epilogue: EpilogueView.nullable(),
  interview: InterviewView.nullable(),
  reveal: RevealView.nullable(),
  ended: z.boolean(),
})
export type PlayerView = z.infer<typeof PlayerView>
