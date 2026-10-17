import { MAX_EVIDENCE_NOTES, MAX_INTERVIEW_TEXT_LENGTH, type Action } from "@adventure/play-contract";

export type InterviewAnswerAction = Extract<Action, { type: "interviewAnswer" }>;

export type InterviewFormValues = {
  verdictId: string;
  evidenceNoteIds: readonly string[];
  text: string;
};

export type InterviewFormChoices = {
  verdictIds: readonly string[];
  noteIds: readonly string[];
};

export type InterviewFormResult =
  | { ok: true; action: InterviewAnswerAction }
  | { ok: false; error: string };

export function buildInterviewAnswerAction(
  values: InterviewFormValues,
  choices: InterviewFormChoices,
): InterviewFormResult {
  if (!choices.verdictIds.includes(values.verdictId)) {
    return { ok: false, error: "Choose a verdict." };
  }
  if (values.evidenceNoteIds.length > MAX_EVIDENCE_NOTES) {
    return { ok: false, error: `Choose no more than ${MAX_EVIDENCE_NOTES} notes.` };
  }
  if (
    new Set(values.evidenceNoteIds).size !== values.evidenceNoteIds.length ||
    values.evidenceNoteIds.some((id) => !choices.noteIds.includes(id))
  ) {
    return { ok: false, error: "Choose evidence from your notes." };
  }

  const text = values.text.trim();
  if (text.length > MAX_INTERVIEW_TEXT_LENGTH) {
    return { ok: false, error: `Keep your response to ${MAX_INTERVIEW_TEXT_LENGTH} characters or fewer.` };
  }

  return {
    ok: true,
    action: {
      type: "interviewAnswer",
      verdictId: values.verdictId,
      evidenceNoteIds: [...values.evidenceNoteIds],
      ...(text ? { text } : {}),
    },
  };
}
