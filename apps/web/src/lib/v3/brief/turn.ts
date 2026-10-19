/**
 * One turn of the v3 brief conversation. Mirrors v2's `lib/brief/turn.ts`: the
 * slot order is fixed in code, the model is consulted only when the answer
 * isn't plain (episode/focus), and only the code fills a slot. Revisit reopens
 * only already-answered slots.
 *
 * Source documents arrive as `ExtractedDocument`s and go in the user turn via
 * `formatDocuments`, never the system prompt. Kept free of Next.js so it runs
 * under vitest with a `FakeLlmClient`.
 */
import { z } from "zod";

import type { ExtractedDocument } from "@adventure/generation/ingest";
import { DEFAULT_MODELS, type LlmClient } from "@adventure/generation/llm";
import { formatDocuments } from "@adventure/generation/planner";

import { consultSystem, DIGEST_SYSTEM, type ConsultedSlot } from "./prompts";
import {
  type BriefDraftV3,
  type BriefInputV3,
  type BriefStateV3,
  type ChatMessage,
  clearSlot,
  currentSlot,
  EPISODE_MAX,
  FOCUS_MAX,
  QUESTIONS,
  SLOT_KEYS,
  type Slot,
  timerLabel,
} from "./schema";

export type TurnResultV3 = { ok: true; state: BriefStateV3 } | { ok: false; error: string };

export const BRIEF_MODEL = DEFAULT_MODELS.mid;

/** Source text per model call. Reading the sources gets more room than shaping one answer. */
const DIGEST_DOCUMENT_CHARS = 80_000;
const SLOT_DOCUMENT_CHARS = 30_000;

const UNAVAILABLE = "The assistant couldn’t answer just now. Try again in a moment.";

type TurnDeps = { llm: LlmClient; documents: readonly ExtractedDocument[] };

export async function briefTurnV3(state: BriefStateV3, input: BriefInputV3, deps: TurnDeps): Promise<TurnResultV3> {
  const slot = currentSlot(state.draft);
  const messages = [...state.messages];
  const ctx: Context = { state, messages, ...deps };

  if ("change" in input) {
    const name = input.change;
    if (!SLOT_NAMES.includes(name as Slot["name"]) || name === "confirm" || name === "sources")
      return { ok: false, error: "That isn’t something you can change" };
    const target = { name: name as Exclude<Slot["name"], "sources" | "confirm"> };
    return ask(clearSlot(state.draft, target), ctx);
  }
  if (slot.name === "confirm") return { ok: false, error: "The brief is complete — create it, or pick something to change" };

  const key = slot.name;
  const text = "accept" in input ? "Use this" : input.text.trim();
  if ("accept" in input) {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.slot === key);
    if (!last?.proposedText) return { ok: false, error: "Nothing to accept yet" };
    messages.push({ role: "user", text: "Use this", slot: key });
    if (slot.name === "focus") return ask({ ...state.draft, focus: last.proposedText }, ctx);
    if (slot.name === "episode") return ask({ ...state.draft, episode: last.proposedText.slice(0, EPISODE_MAX) }, ctx);
    return { ok: false, error: "Nothing to accept yet" };
  }

  if (!text) return { ok: false, error: "Type an answer first" };
  messages.push({ role: "user", text, slot: key });

  switch (slot.name) {
    case "sources": {
      if (ctx.documents.length === 0) {
        messages.push({ role: "assistant", text: "Upload or paste at least one source first — the adventure has nothing to cite without it.", slot: key });
        return { ok: true, state: { ...state, messages } };
      }
      const digest = await readSources(ctx);
      if (!digest.ok) return digest;
      messages.push({ role: "assistant", text: digest.reply, slot: key });
      return ask({ ...state.draft, sources: digest.sources }, ctx);
    }
    case "episode":
    case "focus": {
      // "Skip" fills the optional focus slot with no model call.
      if (slot.name === "focus" && /^\s*skip\s*$/i.test(text)) return ask({ ...state.draft, focus: "" }, ctx);
      // "Use this" accepts the last proposal with no model call.
      if (/^\s*use this\s*$/i.test(text)) {
        const last = [...messages].reverse().find((m) => m.role === "assistant" && m.slot === key && m.proposedText);
        if (last?.proposedText) {
          const value = slot.name === "episode" ? { episode: last.proposedText.slice(0, EPISODE_MAX) } : { focus: last.proposedText.slice(0, FOCUS_MAX) };
          return ask({ ...state.draft, ...value }, ctx);
        }
      }
      const outcome = await consult(state.draft, slot.name, ctx);
      if (!outcome.ok) return outcome;
      return settle(outcome, state.draft, ctx);
    }
    case "readingLevel": {
      const parsed = /^\s*(sec|secondary|jc|junior college)\s*$/i.exec(text);
      if (!parsed) {
        messages.push({ role: "assistant", text: "Choose Sec or JC.", slot: key });
        return { ok: true, state: { ...state, messages } };
      }
      const readingLevel = parsed[1]!.toLowerCase().startsWith("j") ? "jc" : "sec";
      return ask({ ...state.draft, readingLevel }, ctx);
    }
    case "timer": {
      const timerMinutes = parseTimerAnswer(text);
      if (timerMinutes === undefined) {
        messages.push({
          role: "assistant",
          text: "Choose 45 minutes or No timer, or type a length between 10 and 120 minutes.",
          slot: key,
        });
        return { ok: true, state: { ...state, messages } };
      }
      return ask({ ...state.draft, timerMinutes }, ctx);
    }
    case "mode": {
      const parsed = /standard|quick|guided/i.exec(text);
      if (!parsed) {
        messages.push({ role: "assistant", text: "Choose Standard, Quick or Guided.", slot: key });
        return { ok: true, state: { ...state, messages } };
      }
      return ask({ ...state.draft, mode: parsed[0].toLowerCase() as "standard" | "quick" | "guided" }, ctx);
    }
  }
}

export function parseTimerAnswer(text: string): number | null | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s*\(recommended\)\s*$/, "").trim();
  if (/^(no timer|no|none|off)$/.test(normalized)) return null;

  const minutes = /^(\d+)\s*(m|min|mins|minute|minutes)?$/.exec(normalized);
  if (minutes) {
    const value = Number(minutes[1]);
    return Number.isInteger(value) && value >= 10 && value <= 120 ? value : undefined;
  }

  const hours = /^(an?|\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)$/.exec(normalized);
  if (!hours) return undefined;
  const value = (hours[1] === "a" || hours[1] === "an" ? 1 : Number(hours[1])) * 60;
  return Number.isInteger(value) && value >= 10 && value <= 120 ? value : undefined;
}

const SLOT_NAMES: string[] = ["sources", "episode", "focus", "readingLevel", "timer", "mode", "confirm"];

/**
 * Where a consulted slot leaves the conversation: back at a slot the teacher
 * asked to revisit, on to the next question, or still on this one.
 */
async function settle(outcome: Extract<Consulted, { ok: true }>, draft: BriefDraftV3, ctx: Context): Promise<TurnResultV3> {
  const { state, messages } = ctx;
  messages.push(outcome.followUp);
  if (outcome.revisit) return ask(clearSlot(draft, outcome.revisit), ctx);
  if (outcome.filled) return ask(outcome.draft, ctx);
  return { ok: true, state: { ...state, messages } };
}

type Context = {
  state: BriefStateV3;
  messages: ChatMessage[];
  llm: LlmClient;
  documents: readonly ExtractedDocument[];
};

/** Opens the next unfilled slot with its scripted question. */
async function ask(draft: BriefDraftV3, ctx: Context): Promise<TurnResultV3> {
  const { state, messages } = ctx;
  const next = currentSlot(draft);
  const proposedText = next.name === "episode" ? draft.sources?.episodeProposal : undefined;
  messages.push({
    role: "assistant",
    text: openingLine(next, draft),
    slot: next.name,
    ...(proposedText ? { proposedText } : {}),
  });
  return { ok: true, state: { ...state, draft, messages } };
}

function openingLine(slot: Slot, draft: BriefDraftV3): string {
  if (slot.name === "episode" && draft.sources) return "Here’s the episode I’d build this around. Use it, or type your own.";
  return QUESTIONS[slot.name];
}

// ---------------------------------------------------------------------------
// The sources digest
// ---------------------------------------------------------------------------

const digestReply = z.object({
  reply: z.string(),
  summary: z.string(),
  episode: z.string(),
});

/** Reads the uploaded sources once and returns the frame the episode question proposes from. */
async function readSources(ctx: Context): Promise<{ ok: true; sources: NonNullable<BriefDraftV3["sources"]>; reply: string } | { ok: false; error: string }> {
  const { block, budget } = formatDocuments(ctx.documents, DIGEST_DOCUMENT_CHARS);
  let response;
  try {
    response = await ctx.llm.completeJson({
      model: BRIEF_MODEL,
      system: DIGEST_SYSTEM,
      user: [
        "# Source documents (data)",
        block,
        budget.truncated ? "(Some pages were left out for length.)" : "",
        "",
        "# Task",
        "Return the JSON now.",
      ].filter((line) => line !== "").join("\n"),
      schemaName: "brief_v3_sources",
      jsonSchema: z.toJSONSchema(digestReply, { target: "draft-2020-12", io: "output" }),
      maxOutputTokens: 700,
      reasoningEffort: "low",
    });
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
  if (response.refusal || response.json === null) return { ok: false, error: UNAVAILABLE };
  const parsed = digestReply.safeParse(response.json);
  if (!parsed.success) return { ok: false, error: UNAVAILABLE };
  const summary = parsed.data.summary.trim().slice(0, 800);
  const episode = parsed.data.episode.trim().slice(0, EPISODE_MAX);
  if (summary === "" || episode === "") return { ok: false, error: UNAVAILABLE };
  const count = ctx.documents.length;
  const reply = parsed.data.reply.trim() || `I’ve read ${count === 1 ? "the source" : `all ${count} sources`}. ${summary}`;
  return { ok: true, sources: { summary, episodeProposal: episode }, reply };
}

// ---------------------------------------------------------------------------
// The consulted slots: episode and focus
// ---------------------------------------------------------------------------

type Consulted =
  | { ok: true; filled: true; draft: BriefDraftV3; followUp: ChatMessage; revisit?: undefined }
  | { ok: true; filled: false; followUp: ChatMessage; revisit?: Slot }
  | { ok: false; error: string };

const REVISITABLE = ["episode", "focus", "readingLevel", "timer", "mode"] as const;

const consultReply = z.object({
  reply: z.string(),
  /** A value for this slot: the teacher's own answer, or the assistant's proposal when they did not give one. */
  answer: z.string(),
  complete: z.boolean(),
  revisit: z.string().nullable().default(null),
});

/**
 * A slot the teacher asked to go back to: one that is already answered, and
 * not the one being asked. Anything else the model names is ignored.
 */
function revisitTarget(key: string | null, draft: BriefDraftV3): Slot | undefined {
  if (key === null) return undefined;
  const name = REVISITABLE.find((k) => k === key);
  if (!name) return undefined;
  if (name === currentSlot(draft).name) return undefined;
  return draft[SLOT_KEYS[name]] !== undefined ? { name } : undefined;
}

const SLOT_LIMITS: Record<ConsultedSlot, number> = { episode: EPISODE_MAX, focus: FOCUS_MAX };

async function consult(draft: BriefDraftV3, slot: ConsultedSlot, ctx: Context): Promise<Consulted> {
  const key = slot;
  const exchange = ctx.messages.filter((m) => m.slot === key);
  let response;
  try {
    response = await ctx.llm.completeJson({
      model: BRIEF_MODEL,
      system: consultSystem(slot),
      user: userPrompt(draft, slot, exchange, ctx.documents),
      schemaName: `brief_v3_${slot}`,
      jsonSchema: z.toJSONSchema(consultReply, { target: "draft-2020-12", io: "output" }),
      maxOutputTokens: 700,
      reasoningEffort: "low",
    });
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
  if (response.refusal || response.json === null) return { ok: false, error: UNAVAILABLE };
  const parsed = consultReply.safeParse(response.json);
  if (!parsed.success) return { ok: false, error: UNAVAILABLE };

  const answer = parsed.data.answer.trim();
  const usable = answer !== "" || slot === "focus";
  const withinCap = answer.length <= SLOT_LIMITS[slot];
  const followUp: ChatMessage = {
    role: "assistant",
    text: parsed.data.reply.trim() || QUESTIONS[slot],
    slot: key,
    // only a within-cap answer is offerable — "Use this" would otherwise take a truncated value
    ...(answer !== "" && withinCap ? { proposedText: answer } : {}),
  };
  const revisit = revisitTarget(parsed.data.revisit, draft);
  if (revisit) return { ok: true, filled: false, followUp, revisit };
  if (parsed.data.complete && usable && withinCap) {
    return { ok: true, filled: true, draft: { ...draft, [slot]: answer }, followUp };
  }
  // An over-cap or unusable answer can never fill the slot: it stays a proposal.
  return { ok: true, filled: false, followUp };
}

function userPrompt(draft: BriefDraftV3, slot: ConsultedSlot, exchange: readonly ChatMessage[], documents: readonly ExtractedDocument[]): string {
  const { block, budget } = formatDocuments(documents, SLOT_DOCUMENT_CHARS);
  const lines = [
    "# Brief so far (data)",
    `- Episode: ${draft.episode ?? "(not yet)"}`,
    draft.focus !== undefined && draft.focus !== "" ? `- Focus: ${draft.focus}` : "",
    draft.readingLevel ? `- Reading level: ${draft.readingLevel}` : "",
    draft.timerMinutes !== undefined ? `- Timer: ${timerLabel(draft.timerMinutes)}` : "",
    draft.mode ? `- Mode: ${draft.mode}` : "",
    draft.sources ? `- What the sources cover: ${draft.sources.summary}` : "",
    "",
    "# Source documents (data)",
    block || "(none)",
    budget.truncated ? "(Some pages were left out for length.)" : "",
    "",
    `# Conversation about ${slot === "episode" ? "the episode" : "the focus"} (data)`,
    exchange.length > 0 ? exchange.map(transcriptLine).join("\n") : "(nothing yet — open the conversation)",
    exchange.at(-1)?.role === "user" ? "(The last line is the teacher's latest message — the one you are answering.)" : "",
    "",
    "# Task",
    "Return the JSON now.",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

/** One line of the slot's own exchange, with whatever was proposed alongside it. */
function transcriptLine(message: ChatMessage): string {
  const who = message.role === "user" ? "Teacher" : "You";
  return `${who}: ${message.text}${message.proposedText ? `\n${who} proposed: ${message.proposedText}` : ""}`;
}
