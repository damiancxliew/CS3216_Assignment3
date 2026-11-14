import type { DecisionClient, DecisionRequest } from "@adventure/generation/llm";

import {
  editableItems,
  pathLabel,
  textFields,
  type Path,
  type TextField,
} from "./outline";

export type EditTarget = {
  path: Path;
  label: string;
  score: number;
  selected: boolean;
};

export type FindEditTargetsResult =
  | { ok: true; intent: "reply" }
  | { ok: true; intent: "change"; targets: EditTarget[] }
  | { ok: false; message: string };

const NO_TARGET =
  "I couldn't tell which part to change. Name the stage, character or document, or mark a field with its target button.";
const CHANGE_INTENT_INSTRUCTIONS =
  "A teacher is chatting about their history adventure. Does the teacher's message ask for the adventure's saved content to be changed? Answer yes for requests, instructions or complaints about the content (including conditional ones like \"if so, trim it\", and statements that something is too long, too hard or sounds wrong). Answer no for questions, requests for an opinion, a summary or an explanation in chat, thanks, approval, or other comments that do not ask for a change.";

type Scored<T> = T & { score: number; index: number };

function score(probabilities: Record<string, number>, name: string): number {
  const value = probabilities[name];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

const ITEM_KINDS: Record<string, string> = {
  stages: "Stage",
  characters: "Character",
  documents: "Document",
  discoveries: "Discovery",
  definingMoments: "Decision",
  endings: "Ending",
  teacherQuestions: "Discussion question",
};

function describedItemLabel(key: string, label: string): string {
  const [collection, rawIndex] = key.split(".");
  const kind = ITEM_KINDS[collection ?? ""];
  if (!kind || !/^\d+$/.test(rawIndex ?? "")) return label;
  if (new RegExp(`^${kind}\\b`, "i").test(label)) return label;
  return `${kind} ${Number(rawIndex) + 1}: ${label}`;
}

function decisionInput(
  data: unknown,
  text: string,
  options?: {
    history?: { role: "assistant" | "user"; text: string }[];
    prefix?: string;
  },
): DecisionRequest["input"] {
  const content = [
    ...(data === undefined
      ? []
      : [{
          type: "input_json" as const,
          data: data as Record<string, unknown>,
        }]),
    ...(options?.history?.length
      ? [{
          type: "input_text" as const,
          text: `Earlier conversation:\n${options.history.map(({ role, text }) =>
            `${role === "user" ? "Teacher" : "Assistant"}: ${text.replace(/\r?\n/g, " ")}`,
          ).join("\n")}`,
        }]
      : []),
    {
      type: "input_text" as const,
      text: `${options?.prefix ?? "Teacher's edit request"}: ${text}`,
    },
  ];
  return [
    {
      role: "user",
      content,
    },
  ];
}

function fieldLabel(field: TextField, itemPath: Path, itemLabel: string): string {
  const relative = field.path.slice(itemPath.length);
  return relative.length ? pathLabel(relative) : itemLabel;
}

export async function findEditTargets(
  deps: { decide: DecisionClient },
  input: {
    spec: unknown;
    text: string;
    history?: { role: "assistant" | "user"; text: string }[];
  },
): Promise<FindEditTargetsResult> {
  const items = editableItems(input.spec).slice(0, 400);
  const itemLabels = items.map(({ key, label }) => describedItemLabel(key, label));

  const intentDecision = await deps.decide.decide({
    input: decisionInput(undefined, input.text, {
      history: input.history,
      prefix: "Teacher's message",
    }),
    questions: [{ name: "change", instructions: CHANGE_INTENT_INSTRUCTIONS }],
  });
  if (score(intentDecision.probabilities, "change") < 0.5)
    return { ok: true, intent: "reply" };
  if (!items.length) return { ok: false, message: NO_TARGET };

  const itemDecision = await deps.decide.decide({
    input: decisionInput(
      {
        outline: items.map(({ key, preview }, index) => ({
          key,
          label: itemLabels[index]!,
          preview,
        })),
      },
      input.text,
      { history: input.history, prefix: "Teacher's message" },
    ),
    questions: items.map(({ key }, index) => ({
      name: `i${index}`,
      instructions: `Is the teacher asking for the text of item "${key}" (${itemLabels[index]!}) to be changed? A question, opinion request, summary request or thanks is not a request to change it.`,
    })),
  });
  const rankedItems: Scored<(typeof items)[number]>[] = items
    .map((item, index) => ({
      ...item,
      index,
      score: score(itemDecision.probabilities, `i${index}`),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const pickedItems = rankedItems.filter((item) => item.score >= 0.5).slice(0, 3);
  if (!pickedItems.length) return { ok: false, message: NO_TARGET };

  const fields = pickedItems.flatMap((item, itemRank) =>
    textFields(input.spec, item.path)
      .filter((field) => !field.locked)
      .map((field) => ({ ...field, item, itemRank })),
  ).slice(0, 400);
  if (!fields.length) return { ok: false, message: NO_TARGET };

  const fieldDecision = await deps.decide.decide({
    input: decisionInput(
      {
        fields: fields.map(({ path, item, text, ...field }) => ({
          key: path.join("."),
          itemLabel: item.label,
          fieldLabel: fieldLabel({ path, text, ...field }, item.path, item.label),
          text: text.slice(0, 600),
        })),
      },
      input.text,
    ),
    questions: fields.map(({ path, item }, index) => ({
      name: `f${index}`,
      instructions: `To carry out the teacher's edit request, must the text of field "${path.join(".")}" (${item.label} · ${pathLabel(path.slice(item.path.length))}) change?`,
    })),
  });
  const scoredFields = fields.map((field, index) => ({
    ...field,
    index,
    score: score(fieldDecision.probabilities, `f${index}`),
  }));
  let selectedFields = scoredFields.filter((field) => field.score >= 0.5)
    .sort((a, b) => a.itemRank - b.itemRank || b.score - a.score || a.index - b.index);
  if (!selectedFields.length) {
    selectedFields = [scoredFields.sort((a, b) => b.score - a.score || a.index - b.index)[0]!];
  }
  return {
    ok: true,
    intent: "change",
    targets: selectedFields.map(({ path, label, score: probability }) => ({
      path,
      label,
      score: probability,
      selected: true,
    })),
  };
}
