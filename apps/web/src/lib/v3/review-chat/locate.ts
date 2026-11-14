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

const NO_TARGET =
  "I couldn't tell which part to change. Mark a field with the target icon, then send again.";

type Scored<T> = T & { score: number; index: number };

function score(probabilities: Record<string, number>, name: string): number {
  const value = probabilities[name];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function decisionInput(data: unknown, text: string): DecisionRequest["input"] {
  return [
    {
      role: "user",
      content: [
        { type: "input_json", data: data as Record<string, unknown> },
        { type: "input_text", text: `Teacher's edit request: ${text}` },
      ],
    },
  ];
}

function fieldLabel(field: TextField, itemPath: Path, itemLabel: string): string {
  const relative = field.path.slice(itemPath.length);
  return relative.length ? pathLabel(relative) : itemLabel;
}

export async function findEditTargets(
  deps: { decide: DecisionClient },
  input: { spec: unknown; text: string },
): Promise<{ ok: true; targets: EditTarget[] } | { ok: false; message: string }> {
  const items = editableItems(input.spec);
  if (!items.length) return { ok: false, message: NO_TARGET };

  const itemDecision = await deps.decide.decide({
    input: decisionInput(
      {
        outline: items.map(({ key, label, preview }) => ({
          key,
          label,
          preview,
        })),
      },
      input.text,
    ),
    questions: items.map(({ key, label }, index) => ({
      name: `i${index}`,
      instructions: `To carry out the teacher's edit request, must the text of item "${key}" (${label}) change?`,
    })),
  });
  const rankedItems: Scored<(typeof items)[number]>[] = items
    .map((item, index) => ({
      ...item,
      index,
      score: score(itemDecision.probabilities, `i${index}`),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let pickedItems = rankedItems.filter((item) => item.score >= 0.5).slice(0, 3);
  if (!pickedItems.length && rankedItems[0] && rankedItems[0].score >= 0.3) {
    pickedItems = [rankedItems[0]];
  }
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
  let selectedFields = scoredFields.filter((field) => field.score >= 0.3)
    .sort((a, b) => a.itemRank - b.itemRank || b.score - a.score || a.index - b.index);
  let forceSelection = false;
  if (!selectedFields.length) {
    selectedFields = [scoredFields.sort((a, b) => b.score - a.score || a.index - b.index)[0]!];
    forceSelection = true;
  }
  return {
    ok: true,
    targets: selectedFields.map(({ path, label, score: probability }) => ({
      path,
      label,
      score: probability,
      selected: forceSelection || probability >= 0.5,
    })),
  };
}
