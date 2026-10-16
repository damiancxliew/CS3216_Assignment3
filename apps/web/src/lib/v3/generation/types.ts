export type GenerationMode = "quick" | "standard";

export interface GenerationBrief {
  adventureId: string;
  schoolId: string;
  ownerId: string;
  episode: string;
  teacherNotes?: string;
  readingLevel: "sec" | "jc";
  mode: GenerationMode;
}
