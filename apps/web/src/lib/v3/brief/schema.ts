/**
 * The v3 teacher brief as a conversation. Like v2's `lib/brief/schema.ts`:
 * a fixed slot order, filled by code only — the model is consulted in
 * `turn.ts` when an answer isn't plain. Client-safe: no model access here.
 */
import { z } from "zod";
import { guidedModeEnabled } from "@/lib/v3/flag";

export const SLOT_ORDER = ["sources", "episode", "focus", "readingLevel", "timer", "mode", "allowlist", "confirm"] as const;
export type SlotName = (typeof SLOT_ORDER)[number];
export type Slot = { name: SlotName };
export type BriefSourcePolicy = { allowAny: boolean; extraDomains: string[] };

export const SLOT_KEYS = {
  episode: "episode",
  focus: "focus",
  readingLevel: "readingLevel",
  timer: "timerMinutes",
  mode: "mode",
} as const;

export const EPISODE_MAX = 200;
export const FOCUS_MAX = 600;

/** The brief while it is being filled. A missing key is a question still to ask. */
export const briefDraftV3Schema = z.object({
  /** Set once the teacher says the sources are all in and the assistant has read them. */
  sources: z
    .object({
      summary: z.string().trim().min(1).max(800),
      episodeProposal: z.string().trim().min(1).max(EPISODE_MAX),
    })
    .optional(),
  /** The historical episode the adventure is about. */
  episode: z.string().trim().min(1).max(EPISODE_MAX).optional(),
  /** Optional guidance for the generator; "" means the teacher skipped it. */
  focus: z.string().max(FOCUS_MAX).optional(),
  readingLevel: z.enum(["sec", "jc"]).optional(),
  timerMinutes: z.union([z.number().int().min(10).max(120), z.null()]).optional(),
  mode: z.enum(["standard", "quick", "guided"]).optional(),
  sourcePolicy: z.union([
    z.object({ allowAny: z.boolean(), extraDomains: z.array(z.string().max(253)).max(20) }),
    z.null(),
  ]).optional(),
});
export type BriefDraftV3 = z.infer<typeof briefDraftV3Schema>;

/** What `startFromBrief` needs: every slot filled (focus may be the empty string). */
export function completeDraft(
  draft: BriefDraftV3,
): draft is Required<Omit<BriefDraftV3, "focus" | "sourcePolicy">> & {
  focus: string;
  timerMinutes: number | null;
  sourcePolicy?: BriefSourcePolicy;
} {
  return (
    draft.sources !== undefined &&
    draft.episode !== undefined &&
    draft.focus !== undefined &&
    draft.readingLevel !== undefined &&
    draft.timerMinutes !== undefined &&
    draft.mode !== undefined &&
    draft.sourcePolicy !== null
  );
}

export type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  /** The slot this message belongs to, so a slot's own exchange can be replayed to the model. */
  slot: string;
  /** A value the assistant proposed for the slot, acceptable as-is with no model call. */
  proposedText?: string;
};

export const chatMessageSchema: z.ZodType<ChatMessage> = z.object({
  role: z.enum(["assistant", "user"]),
  text: z.string().max(4000),
  slot: z.string().max(20),
  proposedText: z.string().max(FOCUS_MAX).optional(),
});

/** A source as the chat lists it; the text stays in the source store. */
export const briefSourceV3Schema = z.object({
  id: z.string().max(200),
  title: z.string().max(200),
  kind: z.enum(["pdf", "text"]),
});
export type BriefSourceV3 = z.infer<typeof briefSourceV3Schema>;

export const briefStateV3Schema = z.object({
  adventureId: z.string().uuid(),
  draft: briefDraftV3Schema,
  messages: z.array(chatMessageSchema).max(200),
  sources: z.array(briefSourceV3Schema).max(20),
});
export type BriefStateV3 = z.infer<typeof briefStateV3Schema>;

export function initialBriefStateV3(adventureId: string): BriefStateV3 {
  return {
    adventureId,
    draft: {},
    messages: [{ role: "assistant", text: QUESTIONS.sources, slot: "sources" }],
    sources: [],
  };
}

/** The first unfilled slot in order; `confirm` once everything is in. */
export function currentSlot(draft: BriefDraftV3): Slot {
  for (const name of SLOT_ORDER) {
    if (name === "confirm") return { name: "confirm" };
    if (name === "sources") {
      if (draft.sources === undefined) return { name };
      continue;
    }
    if (name === "allowlist") {
      if (draft.sourcePolicy === null) return { name };
      continue;
    }
    if (draft[SLOT_KEYS[name]] === undefined) return { name };
  }
  return { name: "confirm" };
}

/** Clears a slot so the machine asks it again. */
export function clearSlot(draft: BriefDraftV3, slot: Slot): BriefDraftV3 {
  if (slot.name === "confirm" || slot.name === "sources") return draft;
  if (slot.name === "allowlist") return { ...draft, sourcePolicy: null };
  const next = { ...draft };
  delete next[SLOT_KEYS[slot.name]];
  return next;
}

/** What the teacher did this turn. */
export type BriefInputV3 =
  | { text: string }
  /** Accept the last proposal for the current slot. */
  | { accept: true }
  /** Reopen a slot from the summary. */
  | { change: string };

/** The teacher's chip on the sources step; any text there means the same thing. */
export const SOURCES_DONE = "That’s all of them";

export const QUESTIONS: Record<SlotName, string> = {
  sources:
    "Let’s start with the material your students will play from. Upload a PDF, .txt or .md, or paste a passage — as many as you like. Everything the adventure says will be cited from these. Tell me when they’re all in and I’ll read them.",
  episode: "Which episode should the adventure be about?",
  focus: "Anything students should take away, or anything to emphasise or avoid? (optional)",
  readingLevel: "Which reading level is the class?",
  timer: "How long should the adventure run? Students see a countdown for each stage.",
  mode: "How do you want to check the adventure?",
  allowlist:
    "I look for outside sources only on trusted sites — national archives, the National Library Board, Roots.sg, universities, museums and encyclopaedias. Add other sites (for example biblioasia.nlb.gov.sg, example.org), or allow any credible cited source.",
  confirm: "Here’s the brief. Create the adventure, or change anything first.",
};

export const TIMER_RECOMMENDED = "45 minutes (recommended)";
export const TIMER_OFF = "No timer";
export const ALLOWLIST_DEFAULT = "Use the default sites";
export const ALLOWLIST_ANY = "Allow any credible cited source";
export const ANY_SOURCE_WARNING =
  "Generation may cite pages from any site it finds. Review the content of each site before you use the adventure with students.";

const READING_LEVEL_LABELS: Record<"sec" | "jc", string> = { sec: "Sec", jc: "JC" };
const MODE_LABELS: Record<"standard" | "quick" | "guided", string> = {
  standard: "Standard: check the skeleton first",
  quick: "Quick: check everything at the end",
  guided: "Guided (check after every pass)",
};
export { READING_LEVEL_LABELS, MODE_LABELS };

export function timerLabel(minutes: number | null): string {
  return minutes === null ? "Off" : `${minutes} minutes`;
}

/** Quick replies the console offers for a slot; the text is what gets sent. */
export function quickReplies(draft: BriefDraftV3, slot: Slot): string[] {
  switch (slot.name) {
    case "sources":
      // the console shows this only once at least one source is in
      return [SOURCES_DONE];
    case "episode":
      return draft.sources ? ["Use this"] : [];
    case "focus":
      return ["Skip"];
    case "readingLevel":
      return ["Sec", "JC"];
    case "timer":
      return [TIMER_RECOMMENDED, TIMER_OFF];
    case "mode":
      return [MODE_LABELS.standard, MODE_LABELS.quick, ...(guidedModeEnabled() ? ["Guided: check after every pass"] : [])];
    case "allowlist":
      return [ALLOWLIST_DEFAULT, ALLOWLIST_ANY];
    case "confirm":
      return ["Create"];
  }
}

export function sourcePolicyLabel(policy: BriefSourcePolicy | undefined): string {
  if (policy?.allowAny) return "Any credible cited source";
  if (!policy || policy.extraDomains.length === 0) return "Default sites";
  return `Default sites + ${policy.extraDomains.join(", ")}`;
}
