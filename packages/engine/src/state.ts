/**
 * The whole of an attempt, stored as `attempts_v3.state` (jsonb). Plain JSON only: no class instances, no
 * functions, no `undefined`, so it survives a database round trip unchanged. Only the engine creates or
 * changes it; `project` decides what the client may see of it.
 */
import type { MessageView, Phase } from '@adventure/play-contract'
import type { PostTurnResult, StudentTurn } from '@adventure/orchestration/v3'

export const STATE_VERSION = 1

export interface CharacterState {
  stanceId: string | null
  /** Room in the current stage, or null when not present. */
  roomId: string | null
  /** Challenged claims since the last trust drop (G4.3, P8.4). */
  challenged: number
  /** Replies so far, for pacing how often they ask for what they want. */
  replies: number
}

export interface NoteState {
  id: string
  discoveryId: string
  source: 'conversation' | 'document'
  stageIndex: number
  at: number
}

/** A reply waiting for its post-turn check. Everything the check needs is snapshotted at reply time. */
export interface PendingCheck {
  /** The student's message id; the key `postTurn` refers to. */
  messageId: string
  characterId: string
  stageIndex: number
  revealable: { id: string; text: string }[]
  studentNotes: string[]
  turn: StudentTurn
  reply: string
}

export interface MomentState {
  momentId: string
  status: 'choosing' | 'predicting'
  /** Acts on offer, refreshed on every step while choosing (closed endings, secret unlocks). */
  availableActIds: string[]
  actId: string | null
  outcomeId: string | null
  nudge: string | null
}

export interface InterviewAnswerState {
  verdictId: string
  evidenceNoteIds: string[]
  text: string | null
}

/** Owned by Damian's `src/interview`. */
export interface InterviewState {
  answer: InterviewAnswerState | null
  pushBack: string | null
  response: InterviewAnswerState | null
  closing: string | null
  closed: boolean
}

/** Owned by Damian's `src/hints`. The engine keeps `lastProgressAt` current. */
export interface HintState {
  /** Last new note or stance change (P5.1). */
  lastProgressAt: number | null
  /** Highest hint level shown since the last progress. */
  level: number
  /** When the student opened a document or started waiting for a reply (P5.1.3), or null. */
  pausedSince: number | null
  stuckFrom?: number | null
  progressSeen?: number | null
  pauseFrom?: number | null
}

export interface EngineState {
  v: typeof STATE_VERSION
  seed: string
  phase: Phase
  stageIndex: number
  /** The stage opening (consequences, prediction revealed) is showing; play starts on `continue`. */
  stageIntroPending: boolean
  stageOpening: string | null
  stageStartedAt: number | null
  stageEndsAt: number | null
  playerRoomId: string | null
  characters: Record<string, CharacterState>
  discovered: string[]
  notes: NoteState[]
  heldDocuments: string[]
  /** Documents lying in rooms of the current stage, not yet picked up: documentId → roomId. */
  documentRooms: Record<string, string>
  openDocumentId: string | null
  passedOn: { discoveryId: string; characterId: string }[]
  confrontedSlants: string[]
  firedTriggers: string[]
  firedStoryEvents: string[]
  transcript: MessageView[]
  pendingChecks: PendingCheck[]
  moment: MomentState | null
  acts: Record<string, string>
  outcomes: Record<string, string>
  predictions: Record<string, string>
  closedEndings: string[]
  lastPrediction: { predicted: string; actual: string; because: string } | null
  endingId: string | null
  hints: HintState
  interview: InterviewState
  ended: boolean
  /** Counter for message and note ids. */
  seq: number
}

/** Server-only: the post-turn check result applied from `after()`. Never part of `Action`. */
export interface PostTurnAction {
  type: 'postTurn'
  messageId: string
  result: PostTurnResult
}
