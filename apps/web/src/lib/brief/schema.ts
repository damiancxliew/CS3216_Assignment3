/**
 * The teacher's brief as a conversation (PRD §6, FR-1a). The brief is filled
 * slot by slot in a fixed order; this module is the client-safe half — the
 * shapes, the slot order and the scripted questions — with no model access.
 * `turn.ts` runs a turn against an `LlmClient`.
 */
import { z } from "zod";

import { READING_BANDS } from "@adventure/generation/spec";

export const STAGE_COUNTS = [1, 2, 3] as const;

/** Mirrors `LIMITS.maxUploadBytes` from `@adventure/generation`, which can't be imported client-side (it pulls in `node:crypto`/`unpdf`). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const stageOutlineSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** One line: the situation and the decision the student faces in this stage. */
  focus: z.string().trim().min(1).max(300),
});
export type StageOutline = z.infer<typeof stageOutlineSchema>;

export const readingLevelSchema = z.object({
  band: z.enum(READING_BANDS),
  ageMin: z.number().int().min(7).max(19),
  ageMax: z.number().int().min(7).max(19),
});
export type ReadingLevel = z.infer<typeof readingLevelSchema>;

/**
 * What the assistant took from the sources once the teacher said they were all
 * in: a summary it plans from, and its opening suggestion for each of the
 * typed slots. Filling this fills the `sources` slot.
 */
export const sourceDigestSchema = z.object({
  summary: z.string().trim().min(1).max(800),
  title: z.string().trim().min(1).max(120),
  setting: z.string().trim().min(1).max(200),
  studentRole: z.string().trim().min(1).max(200),
});
export type SourceDigest = z.infer<typeof sourceDigestSchema>;

/** The brief while it is being filled. A missing key is a question still to ask. */
export const briefDraftSchema = z.object({
  sources: sourceDigestSchema.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  setting: z.string().trim().min(1).max(200).optional(),
  studentRole: z.string().trim().min(1).max(200).optional(),
  learningObjectives: z.array(z.string().trim().min(1).max(300)).min(1).max(6).optional(),
  band: z.enum(READING_BANDS).optional(),
  ages: z.object({ ageMin: z.number().int().min(7).max(19), ageMax: z.number().int().min(7).max(19) }).optional(),
  stageCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** One entry per stage once `stageCount` is set; `null` is a stage still to discuss. */
  stageOutline: z.array(stageOutlineSchema.nullable()).max(3).optional(),
});
export type BriefDraft = z.infer<typeof briefDraftSchema>;

/** What `finishBrief` needs: every slot filled. */
export const completeBriefSchema = z.object({
  title: z.string().trim().min(1).max(120),
  setting: z.string().trim().min(1).max(200),
  studentRole: z.string().trim().min(1).max(200),
  learningObjectives: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  readingLevel: readingLevelSchema.refine((r) => r.ageMin <= r.ageMax, { message: "The age range is upside down" }),
  stageOutline: z.array(stageOutlineSchema).min(1).max(3),
});
export type CompleteBrief = z.infer<typeof completeBriefSchema>;

export function completeBrief(draft: BriefDraft): CompleteBrief | null {
  const parsed = completeBriefSchema.safeParse({
    title: draft.title,
    setting: draft.setting,
    studentRole: draft.studentRole,
    learningObjectives: draft.learningObjectives,
    readingLevel: draft.band && draft.ages ? { band: draft.band, ...draft.ages } : undefined,
    stageOutline: draft.stageOutline,
  });
  return parsed.success && draft.stageOutline?.length === draft.stageCount ? parsed.data : null;
}

/** Slots in the order they are asked. `stage` repeats once per stage; `confirm` is the summary. */
export const SLOT_ORDER = ["sources", "title", "setting", "studentRole", "learningObjectives", "band", "ages", "stageCount", "stage", "confirm"] as const;
export type SlotName = (typeof SLOT_ORDER)[number];

type ScalarSlotName = Exclude<SlotName, "stage">;
export type Slot = { [N in ScalarSlotName]: { name: N } }[ScalarSlotName] | { name: "stage"; index: number };

export function slotKey(slot: Slot): string {
  return slot.name === "stage" ? `stage:${slot.index}` : slot.name;
}

export function parseSlotKey(key: string): Slot | null {
  const stage = /^stage:(\d)$/.exec(key);
  if (stage) return { name: "stage", index: Number(stage[1]) };
  return (SLOT_ORDER as readonly string[]).includes(key) && key !== "stage" ? ({ name: key } as Slot) : null;
}

/** The first unfilled slot in order; `confirm` once everything is in. */
export function currentSlot(draft: BriefDraft): Slot {
  if (draft.sources === undefined) return { name: "sources" };
  if (draft.title === undefined) return { name: "title" };
  if (draft.setting === undefined) return { name: "setting" };
  if (draft.studentRole === undefined) return { name: "studentRole" };
  if (draft.learningObjectives === undefined) return { name: "learningObjectives" };
  if (draft.band === undefined) return { name: "band" };
  if (draft.ages === undefined) return { name: "ages" };
  if (draft.stageCount === undefined) return { name: "stageCount" };
  const outline = draft.stageOutline ?? [];
  for (let index = 0; index < draft.stageCount; index += 1) if (!outline[index]) return { name: "stage", index };
  return { name: "confirm" };
}

/** Clears a slot so the machine asks it again; stages beyond a cleared count are dropped. */
export function clearSlot(draft: BriefDraft, slot: Slot): BriefDraft {
  if (slot.name === "stage") {
    const outline = [...(draft.stageOutline ?? [])];
    outline[slot.index] = null;
    return { ...draft, stageOutline: outline };
  }
  if (slot.name === "confirm") return draft;
  const next = { ...draft };
  delete next[slot.name];
  if (slot.name === "stageCount") delete next.stageOutline;
  return next;
}

export type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  /** The slot this message belongs to, so a slot's own exchange can be replayed to the model. */
  slot: string;
  /** A stage the assistant suggested; the teacher can accept it without another model call. */
  proposal?: StageOutline;
  /** Objectives the assistant drafted from the teacher's words, likewise acceptable as-is. */
  proposedObjectives?: string[];
  /** A title, setting or student role the assistant read out of the sources, likewise acceptable as-is. */
  proposedText?: string;
};

export const chatMessageSchema: z.ZodType<ChatMessage> = z.object({
  role: z.enum(["assistant", "user"]),
  text: z.string().max(4000),
  slot: z.string().max(20),
  proposal: stageOutlineSchema.optional(),
  proposedObjectives: z.array(z.string().max(300)).max(6).optional(),
  proposedText: z.string().max(200).optional(),
});

/** A source as the chat lists it; the text itself stays in the database and is read there each turn. */
export const briefSourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  pages: z.number().int().min(0),
});
export type BriefSource = z.infer<typeof briefSourceSchema>;

/**
 * The conversation round-trips through the client and is mirrored onto the
 * adventure row after every turn (`adventure.brief_state`), so the row exists
 * from the first question: the sources uploaded mid-conversation hang off it.
 */
export const briefStateSchema = z.object({
  adventureId: z.string().uuid(),
  draft: briefDraftSchema,
  messages: z.array(chatMessageSchema).max(200),
  sources: z.array(briefSourceSchema).max(20),
});
export type BriefState = z.infer<typeof briefStateSchema>;

export function initialBriefState(adventureId: string): BriefState {
  return {
    adventureId,
    draft: {},
    messages: [{ role: "assistant", text: QUESTIONS.sources, slot: "sources" }],
    sources: [],
  };
}

/** What the teacher did this turn. */
export type BriefInput =
  | { text: string }
  /** Accept the last proposal for the current slot. */
  | { accept: true }
  /** Reopen a slot from the summary. */
  | { change: string };

/** The teacher's chip on the sources step; any text there means the same thing. */
export const SOURCES_DONE = "That’s all of them";

export const READING_BAND_LABELS: Record<(typeof READING_BANDS)[number], string> = {
  primary: "Primary",
  "lower-secondary": "Lower secondary",
  "upper-secondary": "Upper secondary",
  "pre-university": "Pre-university",
};

/** The age range each band usually means, offered as a quick reply. */
export const BAND_AGES: Record<(typeof READING_BANDS)[number], { ageMin: number; ageMax: number }> = {
  primary: { ageMin: 9, ageMax: 12 },
  "lower-secondary": { ageMin: 13, ageMax: 14 },
  "upper-secondary": { ageMin: 15, ageMax: 16 },
  "pre-university": { ageMin: 17, ageMax: 18 },
};

/** Scripted questions. Stage questions come from the model; `confirm` is rendered as a summary. */
export const QUESTIONS: Record<Exclude<SlotName, "stage">, string> = {
  sources:
    "Let’s start with the material your students will play from. Upload a PDF, .txt or .md, or paste a passage — as many as you like. Everything the adventure says will be cited from these, page by page. Tell me when they’re all in and I’ll read them.",
  title: "What should the adventure be called?",
  setting: "Where and when does it take place? A place and a date is enough — e.g. “Singapore and Johor, February 1819”.",
  studentRole: "Who does the student play? Someone present at the events but not the one making history — e.g. “Junior interpreter to the expedition”.",
  learningObjectives: "What should students be able to explain or describe by the end? Tell me in your own words; I’ll turn it into up to six objectives.",
  band: "Which reading level is the class?",
  ages: "And which ages? Give a range like “13 to 14”.",
  stageCount: "How many stages? Each stage is one map with a few rooms and ends in one decision. Three gives the story room to branch.",
  confirm: "Here’s the brief. Create the adventure, or change anything first.",
};

/** Quick replies the console offers for a slot; the text is what gets sent. */
export function quickReplies(draft: BriefDraft, slot: Slot): string[] {
  switch (slot.name) {
    case "band":
      return READING_BANDS.map((band) => READING_BAND_LABELS[band]);
    case "ages": {
      const ages = draft.band ? BAND_AGES[draft.band] : null;
      return ages ? [`${ages.ageMin} to ${ages.ageMax}`] : [];
    }
    case "stageCount":
      return STAGE_COUNTS.map(String);
    default:
      return [];
  }
}
