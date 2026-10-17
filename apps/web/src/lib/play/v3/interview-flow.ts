import type { InterviewView } from "@adventure/play-contract";

/** What the interviewer is saying in the dialogue box, and what the student does next. */
export type InterviewLine =
  | { kind: "question"; text: string; next: "answer" }
  | { kind: "pushBack"; text: string; next: "respond" }
  | { kind: "closing"; text: string; next: "continue" };

export const DEFAULT_CLOSING = "Thank you. That's a fair answer.";

export function interviewLine(interview: InterviewView): InterviewLine {
  if (interview.closed) return { kind: "closing", text: interview.closing ?? DEFAULT_CLOSING, next: "continue" };
  if (interview.answer && interview.pushBack && !interview.response) {
    return { kind: "pushBack", text: interview.pushBack, next: "respond" };
  }
  return { kind: "question", text: interview.question, next: "answer" };
}

/** The response to the push-back starts from the first answer, so keeping it is one Enter press. */
export function interviewDraftStart(interview: InterviewView) {
  const from = interview.response ?? interview.answer;
  return {
    verdictIndex: Math.max(0, interview.verdicts.findIndex((verdict) => verdict.id === from?.verdictId)),
    evidenceNoteIds: from?.evidenceNoteIds ?? [],
  };
}
