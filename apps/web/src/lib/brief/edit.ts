import { completeBriefSchema, type CompleteBrief } from "./schema";

/** Convert the Overview form to the same validated brief used at creation. */
export function parseBriefEdit(formData: FormData): CompleteBrief | null {
  const stageCount = Number(formData.get("stage_count"));
  if (![1, 2, 3].includes(stageCount)) return null;

  const parsed = completeBriefSchema.safeParse({
    title: formData.get("title"),
    setting: formData.get("setting"),
    studentRole: formData.get("student_role"),
    learningObjectives: String(formData.get("learning_objectives") ?? "")
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean),
    readingLevel: {
      band: formData.get("band"),
      ageMin: Number(formData.get("age_min")),
      ageMax: Number(formData.get("age_max")),
    },
    stageOutline: Array.from({ length: stageCount }, (_, index) => ({
      title: formData.get(`stage_${index}_title`),
      focus: formData.get(`stage_${index}_focus`),
    })),
  });
  return parsed.success ? parsed.data : null;
}
