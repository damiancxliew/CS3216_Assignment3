import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const REFLECTION_PROMPT_KEYS = ["factor", "turning-point", "evidence", "inevitability"] as const;
export type ReflectionPromptKey = typeof REFLECTION_PROMPT_KEYS[number];
export const STANCES = ["inevitable", "likely", "open", "unlikely"] as const;
export type Stance = typeof STANCES[number];
export const STANCE_LABELS: Record<Stance, string> = {
  inevitable: "Inevitable",
  likely: "Likely",
  open: "Still open",
  unlikely: "Unlikely",
};
export type ReadingBand = "primary" | "lower-secondary" | "upper-secondary" | "pre-university";
export type ReflectionAnswer = {
  promptKey: ReflectionPromptKey;
  choice: string | null;
  choiceLabel: string | null;
  stance: Stance | null;
  response: string;
  counter: string | null;
};
export const MIN_RESPONSE_CHARS = 20;
export const MAX_FACTOR_CHARS = 60;

export const REFLECTION_PROMPTS: Record<ReflectionPromptKey, { title: string; pickLabel: string }> = {
  factor: {
    title: "Which factor was most important in what happened?",
    pickLabel: "Name the factor in a few words",
  },
  "turning-point": {
    title: "Which of your decisions created the biggest turning point?",
    pickLabel: "Choose one of your decisions",
  },
  evidence: {
    title: "Which piece of evidence most changed your interpretation?",
    pickLabel: "Choose one piece of evidence",
  },
  inevitability: {
    title: "By the final stage, was the historical outcome inevitable?",
    pickLabel: "Choose your judgement",
  },
};

const STARTERS: Record<ReflectionPromptKey, string> = {
  factor: "I think ___ mattered most because the evidence shows ___.",
  "turning-point": "This decision was the turning point because after it ___.",
  evidence: "Before reading this I thought ___. It changed my view because ___.",
  inevitability: "I think the outcome was ___ because ___.",
};

const UPPER_SECONDARY_HINT = "Point: make your claim. Evidence: give one detail from a scroll or source. Explain: show how that detail supports your claim.";
const PRE_UNIVERSITY_HINT = "Weigh it against at least one alternative, and say why yours matters more.";

export function scaffoldFor(
  key: ReflectionPromptKey,
  band: ReadingBand,
): { starter: string | null; hint: string | null; askCounter: boolean } {
  if (band === "pre-university") {
    return { starter: null, hint: PRE_UNIVERSITY_HINT, askCounter: true };
  }
  if (band === "upper-secondary") {
    return { starter: STARTERS[key], hint: UPPER_SECONDARY_HINT, askCounter: false };
  }
  return { starter: STARTERS[key], hint: null, askCounter: false };
}

export type ReflectionDebrief = {
  path: { stageIndex: number; stageTitle: string; chose: string | null }[];
  documentedHistory: { citations: { sourceTitle: string; page: number }[] };
  collectedEvidence: { id: string; name: string }[];
};

export function evidenceOptions(debrief: ReflectionDebrief): { id: string; label: string }[] {
  return [
    ...debrief.collectedEvidence.map((entry) => ({ id: entry.id, label: entry.name })),
    ...debrief.documentedHistory.citations.map((citation, index) => ({
      id: `citation-${index}`,
      label: `${citation.sourceTitle}, page ${citation.page}`,
    })),
  ];
}

export function turningPointOptions(debrief: ReflectionDebrief): { id: string; label: string }[] {
  return debrief.path.map((stage, index) => ({
    id: String(stage.stageIndex),
    label: `Stage ${index + 1} · ${stage.stageTitle}: ${stage.chose ?? "the clock decided"}`,
  }));
}

export type ReflectionRequirements = Record<ReflectionPromptKey, { choice: boolean; stance: boolean }>;

export function requirementsFor(debrief: ReflectionDebrief): ReflectionRequirements {
  return {
    factor: { choice: true, stance: false },
    "turning-point": { choice: turningPointOptions(debrief).length > 0, stance: false },
    evidence: { choice: evidenceOptions(debrief).length > 0, stance: false },
    inevitability: { choice: false, stance: true },
  };
}

export function isReflectionAnswerComplete(
  key: ReflectionPromptKey,
  answer: ReflectionAnswer | undefined,
  debrief: ReflectionDebrief,
): boolean {
  if (!answer || answer.response.trim().length < MIN_RESPONSE_CHARS) return false;
  const requirement = requirementsFor(debrief)[key];
  if (requirement.choice && !answer.choice?.trim()) return false;
  if (requirement.stance && !answer.stance) return false;
  return true;
}

export function isReflectionComplete(answers: ReflectionAnswer[], debrief: ReflectionDebrief): boolean {
  const byKey = new Map(answers.map((answer) => [answer.promptKey, answer]));
  return REFLECTION_PROMPT_KEYS.every((key) => isReflectionAnswerComplete(key, byKey.get(key), debrief));
}

const answerInputSchema = z.object({
  promptKey: z.enum(REFLECTION_PROMPT_KEYS),
  choice: z.string().trim().max(200).nullable().optional(),
  choiceLabel: z.string().trim().max(300).nullable().optional(),
  stance: z.enum(STANCES).nullable().optional(),
  response: z.string().trim().max(2000),
  counter: z.string().trim().max(2000).nullable().optional(),
});

export function resolveAnswer(
  input: unknown,
  debrief: ReflectionDebrief,
): { ok: true; answer: ReflectionAnswer } | { ok: false; error: string } {
  const parsed = answerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check your answer and try again." };

  const promptKey = parsed.data.promptKey;
  const choice = parsed.data.choice || null;
  const response = parsed.data.response;
  const counter = parsed.data.counter || null;
  const stance = parsed.data.stance ?? null;
  if (response.length < MIN_RESPONSE_CHARS) {
    return { ok: false, error: "Write at least a sentence (20 characters)." };
  }
  if (promptKey !== "inevitability" && stance !== null) {
    return { ok: false, error: "A judgement is only used for the inevitability question." };
  }
  if (promptKey === "factor") {
    if (!choice) return { ok: false, error: "Name the factor that mattered most." };
    if (choice.length > MAX_FACTOR_CHARS) {
      return { ok: false, error: `Keep the factor to ${MAX_FACTOR_CHARS} characters or fewer.` };
    }
    return {
      ok: true,
      answer: { promptKey, choice, choiceLabel: choice, stance: null, response, counter },
    };
  }
  if (promptKey === "inevitability") {
    if (!stance) return { ok: false, error: "Choose a judgement about the outcome." };
    return {
      ok: true,
      answer: { promptKey, choice: null, choiceLabel: null, stance, response, counter },
    };
  }

  const options = promptKey === "turning-point" ? turningPointOptions(debrief) : evidenceOptions(debrief);
  if (!options.length) {
    return {
      ok: true,
      answer: { promptKey, choice: null, choiceLabel: null, stance: null, response, counter },
    };
  }
  const selected = options.find((option) => option.id === choice);
  if (!selected) return { ok: false, error: "Choose one of the listed options." };
  return {
    ok: true,
    answer: { promptKey, choice: selected.id, choiceLabel: selected.label, stance: null, response, counter },
  };
}

export async function loadReflections(supabase: SupabaseClient, attemptId: string): Promise<ReflectionAnswer[]> {
  const { data, error } = await supabase
    .from("attempt_reflection")
    .select("prompt_key, choice, choice_label, stance, response, counter")
    .eq("attempt_id", attemptId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    promptKey: row.prompt_key as ReflectionPromptKey,
    choice: row.choice,
    choiceLabel: row.choice_label,
    stance: row.stance as Stance | null,
    response: row.response,
    counter: row.counter,
  })).sort((a, b) => REFLECTION_PROMPT_KEYS.indexOf(a.promptKey) - REFLECTION_PROMPT_KEYS.indexOf(b.promptKey));
}

export type ReflectionRow = {
  attempt_id: string;
  prompt_key: ReflectionPromptKey;
  choice: string | null;
  choice_label: string | null;
  stance: Stance | null;
  response: string;
  counter: string | null;
  updated_at: string;
};

export type ReflectionSummary = {
  respondents: number;
  complete: number;
  factors: { phrase: string; count: number; attemptIds: string[] }[];
  turningPoints: { label: string; count: number; attemptIds: string[] }[];
  evidence: { label: string; count: number; attemptIds: string[] }[];
  stances: { stance: Stance; label: string; count: number; attemptIds: string[] }[];
  keywords: { word: string; count: number }[];
  answers: { attemptId: string; byKey: Partial<Record<ReflectionPromptKey, ReflectionAnswer>>; updatedAt: string }[];
};

const STOPWORDS = new Set([
  "about", "after", "also", "am", "an", "and", "are", "as", "at", "be", "been", "before", "being", "because",
  "but", "by", "can", "could", "did", "do", "does", "for", "from", "had", "has", "have", "he", "her", "here",
  "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "me", "more", "most", "my", "no",
  "not", "of", "on", "one", "or", "other", "our", "out", "she", "so", "some", "than", "that", "the", "their",
  "them", "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "up", "us", "very",
  "was", "we", "were", "what", "when", "where", "which", "while", "who", "will", "with", "would", "you", "your",
  "think", "mattered", "evidence", "shows", "decision", "turning", "point", "reading", "thought", "changed", "view",
  "outcome", "only", "made", "still", "stage", "final", "another", "different", "showing", "likely", "possible", "remained",
]);

function normalizeFactor(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ")
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

function groupedLabels(rows: ReflectionRow[], key: "turning-point" | "evidence") {
  const groups = new Map<string, { label: string; attempts: Set<string> }>();
  for (const row of rows) {
    if (row.prompt_key !== key || row.choice_label === null) continue;
    let group = groups.get(row.choice_label);
    if (!group) {
      group = { label: row.choice_label, attempts: new Set() };
      groups.set(row.choice_label, group);
    }
    group.attempts.add(row.attempt_id);
  }
  return [...groups.values()]
    .map((group) => ({ label: group.label, count: group.attempts.size, attemptIds: [...group.attempts] }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function summarizeReflections(rows: ReflectionRow[]): ReflectionSummary {
  const attempts = new Map<string, { byKey: Partial<Record<ReflectionPromptKey, ReflectionAnswer>>; updatedAt: string }>();
  const factorGroups = new Map<string, { attempts: Set<string>; spellings: Map<string, number> }>();
  const stanceAttempts = new Map<Stance, Set<string>>(STANCES.map((stance) => [stance, new Set()]));
  const wordAttempts = new Map<string, Set<string>>();

  for (const row of rows) {
    let attempt = attempts.get(row.attempt_id);
    if (!attempt) {
      attempt = { byKey: {}, updatedAt: row.updated_at };
      attempts.set(row.attempt_id, attempt);
    } else if (row.updated_at > attempt.updatedAt) {
      attempt.updatedAt = row.updated_at;
    }
    attempt.byKey[row.prompt_key] = {
      promptKey: row.prompt_key,
      choice: row.choice,
      choiceLabel: row.choice_label,
      stance: row.stance,
      response: row.response,
      counter: row.counter,
    };

    if (row.prompt_key === "factor" && row.choice) {
      const spelling = row.choice.trim();
      const normalized = normalizeFactor(spelling);
      let group = factorGroups.get(normalized);
      if (!group) {
        group = { attempts: new Set(), spellings: new Map() };
        factorGroups.set(normalized, group);
      }
      group.attempts.add(row.attempt_id);
      group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    }
    if (row.prompt_key === "inevitability" && row.stance) {
      stanceAttempts.get(row.stance)?.add(row.attempt_id);
    }
    const words = `${row.response} ${row.counter ?? ""}`.toLowerCase().match(/[a-z][a-z'-]+/g) ?? [];
    for (const word of new Set(words.filter((candidate) => candidate.length >= 4 && !STOPWORDS.has(candidate)))) {
      let wordAttemptIds = wordAttempts.get(word);
      if (!wordAttemptIds) {
        wordAttemptIds = new Set();
        wordAttempts.set(word, wordAttemptIds);
      }
      wordAttemptIds.add(row.attempt_id);
    }
  }

  const factors = [...factorGroups.values()].map((group) => {
    let phrase = "";
    let frequency = -1;
    for (const [spelling, count] of group.spellings) {
      if (count > frequency) {
        phrase = spelling;
        frequency = count;
      }
    }
    return { phrase, count: group.attempts.size, attemptIds: [...group.attempts] };
  }).sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));

  return {
    respondents: attempts.size,
    complete: [...attempts.values()].filter((attempt) => REFLECTION_PROMPT_KEYS.every((key) => attempt.byKey[key])).length,
    factors,
    turningPoints: groupedLabels(rows, "turning-point"),
    evidence: groupedLabels(rows, "evidence"),
    stances: STANCES.map((stance) => ({
      stance,
      label: STANCE_LABELS[stance],
      count: stanceAttempts.get(stance)!.size,
      attemptIds: [...stanceAttempts.get(stance)!],
    })),
    keywords: [...wordAttempts.entries()]
      .map(([word, attemptIds]) => ({ word, count: attemptIds.size }))
      .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
      .slice(0, 40),
    answers: [...attempts.entries()]
      .map(([attemptId, attempt]) => ({ attemptId, byKey: attempt.byKey, updatedAt: attempt.updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

export async function loadReflectionSummary(reader: SupabaseClient, adventureId: string): Promise<ReflectionSummary> {
  const { data, error } = await reader
    .from("attempt_reflection")
    .select("attempt_id, prompt_key, choice, choice_label, stance, response, counter, updated_at, attempt!inner(adventure_id)")
    .eq("attempt.adventure_id", adventureId)
    .returns<ReflectionRow[]>();
  if (error) throw error;
  return summarizeReflections(data ?? []);
}
