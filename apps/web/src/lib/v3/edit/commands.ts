import { z } from "zod";
import { AdventureSpec, type AdventureSpec as Spec } from "@adventure/spec-v3";

const path = z
  .array(z.union([z.string(), z.number().int().nonnegative()]))
  .min(1)
  .max(30);
export const V3Edit = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("set"), path, value: z.unknown() }),
  z.strictObject({
    type: z.literal("insert"),
    path,
    index: z.number().int().nonnegative(),
    value: z.unknown(),
  }),
  z.strictObject({ type: z.literal("remove"), path }),
  z.strictObject({
    type: z.literal("move"),
    path,
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("convertDocument"),
    documentId: z.string(),
  }),
  z.strictObject({
    type: z.literal("replaceExcerpt"),
    documentId: z.string(),
    sourceId: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal("sourcePolicy"),
    value: AdventureSpec.shape.authoring.unwrap().shape.sourcePolicy.unwrap(),
  }),
]);
export type V3Edit = z.infer<typeof V3Edit>;
export type EditPath = (string | number)[];
export type CapturedSource = { id: string; title: string; text: string };
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export function atPath(value: unknown, path: EditPath): unknown {
  for (const key of path) {
    if (
      forbidden.has(String(key)) ||
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, key)
    )
      throw Error("Unknown field");
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}
function ids(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "id" && typeof item === "string" ? [item] : ids(item),
  );
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Pure command reducer, also used for local previews. Only the server supplies source text. */
export function applyV3Edits(
  base: Spec,
  edits: readonly V3Edit[],
  sources: CapturedSource[],
  local = false,
): Spec {
  const draft = structuredClone(base);
  const evidenceOperations = new Map<
    string,
    { real: boolean; body: string; sourceLabel: string; citations: unknown }
  >();
  for (const edit of edits) {
    if (edit.type === "sourcePolicy") {
      (draft.authoring ??= {}).sourcePolicy = edit.value;
      continue;
    }
    if (edit.type === "convertDocument" || edit.type === "replaceExcerpt") {
      const doc = draft.documents.find((d) => d.id === edit.documentId);
      if (!doc) throw Error("Document unavailable");

      if (edit.type === "convertDocument") {
        doc.real = false;
        doc.sourceLabel = "invented";
        doc.citations = [];
      } else {
        const source = sources.find((s) => s.id === edit.sourceId);
        if (!source || edit.end > source.text.length || edit.start >= edit.end)
          throw Error("Captured source selection unavailable");
        doc.body = source.text.slice(edit.start, edit.end);
        doc.real = true;
        doc.sourceLabel = source.title;
        doc.citations = [{ sourceId: source.id, quote: doc.body }];
        doc.keyPassages = [];
      }
      evidenceOperations.set(doc.id, {
        real: doc.real,
        body: doc.body,
        sourceLabel: doc.sourceLabel,
        citations: structuredClone(doc.citations),
      });
      continue;
    }
    if (
      ["id", "sources", "authoring"].includes(String(edit.path[0])) ||
      edit.path.some((k) => forbidden.has(String(k)))
    )
      throw Error("Protected field");
    if (edit.type === "move" || edit.type === "insert") {
      const list = atPath(draft, edit.path);
      if (!Array.isArray(list)) throw Error("Expected list");
      if (edit.type === "insert") {
        if (edit.index > list.length) throw Error("Invalid insertion");
        list.splice(edit.index, 0, structuredClone(edit.value));
      } else {
        if (edit.from >= list.length || edit.to >= list.length)
          throw Error("Invalid order");
        list.splice(edit.to, 0, list.splice(edit.from, 1)[0]);
      }
    } else {
      const parent = atPath(draft, edit.path.slice(0, -1)) as Record<
        string | number,
        unknown
      >;
      const key = edit.path.at(-1)!;
      if (
        ["id", "citations", "sourceLabel"].includes(String(key)) ||
        (key === "real" && edit.path[0] === "documents")
      )
        throw Error("Protected evidence or identity");
      if (edit.type === "remove") {
        if (Array.isArray(parent) && typeof key === "number")
          parent.splice(key, 1);
        else delete parent[key];
      } else {
        if (!same(ids(parent[key]), ids(edit.value)))
          throw Error(
            "Use add/remove commands to change entities; existing IDs are stable",
          );
        parent[key] = structuredClone(edit.value);
      }
    }
  }
  const parsed = local ? draft : AdventureSpec.parse(draft);
  // Parent replacement and insertion must not bypass document evidence rules.
  for (const doc of parsed.documents) {
    const old = base.documents.find((d) => d.id === doc.id);
    const operation = evidenceOperations.get(doc.id);
    if (operation) {
      if (
        doc.real !== operation.real ||
        doc.sourceLabel !== operation.sourceLabel ||
        !same(doc.citations, operation.citations) ||
        (operation.real && doc.body !== operation.body)
      )
        throw Error("Protected evidence changed after source operation");
      continue;
    }
    if (doc.real && (!old || !old.real || doc.body !== old.body))
      throw Error(
        "Real document bodies require a captured-source replacement or explicit invented conversion",
      );
    if (
      old &&
      (doc.real !== old.real ||
        doc.sourceLabel !== old.sourceLabel ||
        !same(doc.citations, old.citations))
    )
      throw Error("Evidence is server managed");
    if (!old && (doc.real || doc.citations?.length))
      throw Error("New documents must be invented");
  }
  return parsed;
}
