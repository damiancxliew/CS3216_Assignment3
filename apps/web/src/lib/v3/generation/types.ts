export type GenerationMode = "quick" | "standard" | "guided";

export interface GenerationBrief {
  adventureId: string;
  schoolId: string;
  ownerId: string;
  episode: string;
  teacherNotes?: string;
  readingLevel: "sec" | "jc";
  timerMinutes?: number | null;
  mode: GenerationMode;
}
