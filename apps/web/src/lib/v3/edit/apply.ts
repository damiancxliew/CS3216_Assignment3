import type { MediaEditContext } from "../media/resolvers";
import { AdventureSpec } from "@adventure/spec-v3";
import type { ExtractedDocument } from "@adventure/generation";
import { applyV3Edits, type V3Edit, type CapturedSource } from "./commands";

export function capturedSources(documents: ExtractedDocument[]): CapturedSource[] {
  return documents.map(d => ({ id: d.id, title: d.title, text: d.pages.map(p => p.text).join("\n") }));
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Mark changed prose at its nearest stable entity, preserving unchanged evidence. */
export function deriveAttribution(
  base: AdventureSpec,
  edited: AdventureSpec,
): void {
  const contributions = [...(base.authoring?.teacherContributions ?? [])];
  const walk = (old: unknown, next: unknown, entity: string, field: string) => {
    if (!next || typeof next !== "object") return;
    if (Array.isArray(next)) {
      next.forEach((item, i) => {
        if (
          typeof item === "string" &&
          (!Array.isArray(old) || !old.includes(item))
        ) {
          const local = `${field}.${i}`;
          if (
            !contributions.some((c) => c.entity === entity && c.field === local)
          )
            contributions.push({ entity, field: local });
        }
        const id =
          item && typeof item === "object" && "id" in item
            ? String(item.id)
            : undefined;
        const prior = Array.isArray(old)
          ? id
            ? old.find((x) => x?.id === id)
            : (old.find((x) => same(x, item)) ?? old[i])
          : undefined;
        walk(prior, item, entity, `${field}.${i}`);
      });
      return;
    }
    const obj = next as Record<string, unknown>;
    const prior =
      old && typeof old === "object" ? (old as Record<string, unknown>) : {};
    if (typeof obj.id === "string") {
      entity =
        entity === base.id || obj.id === base.id
          ? obj.id
          : `${entity}/${obj.id}`;
      field = "";
    }
    let changedProse = false;
    const technical = new Set([
      "id",
      "sourceLabel",
      "citations",
      "authoring",
      "kind",
      "type",
      "effect",
      "tier",
      "readingLevel",
    ]);
    for (const [key, value] of Object.entries(obj)) {
      if (technical.has(key)) continue;
      const local = field ? `${field}.${key}` : key;
      if (
        typeof value === "string" &&
        !key.endsWith("Id") &&
        !same(prior[key], value)
      ) {
        changedProse = true;
        if (
          !contributions.some((c) => c.entity === entity && c.field === local)
        )
          contributions.push({ entity, field: local });
      }
      if (typeof value === "object") walk(prior[key], value, entity, local);
    }
    if (
      "sourceLabel" in obj &&
      !changedProse &&
      !same(obj.sourceLabel, prior.sourceLabel) &&
      !("body" in obj)
    )
      throw Error("Source labels are server managed");
    if (changedProse) {
      if ("sourceLabel" in obj)
        obj.sourceLabel =
          obj.real === false && "body" in obj ? "invented" : "from the teacher";
      if ("citations" in obj && obj.real !== true) obj.citations = [];
    }
    // Citation editing cannot attach old evidence to new prose or fabricate provenance.
    if (
      "citations" in obj &&
      !same(obj.citations, prior.citations) &&
      !changedProse &&
      !("body" in obj)
    )
      throw Error("Citations are server managed");
  };
  walk(base, edited, base.id, "");
  (edited.authoring ??= {}).teacherContributions = contributions;
}

export function applyTeacherEdits(base: AdventureSpec, edits: V3Edit[], sources: CapturedSource[], media: MediaEditContext = {}): AdventureSpec {
  if (edits.length === 0) return base;
  // JSONB can reorder citation keys. Compare two schema-normalized trees so
  // harmless key order changes are not mistaken for teacher evidence edits.
  const normalized = AdventureSpec.parse(base);
  const spec = applyV3Edits(normalized, edits, sources, false, media);
  if (!same(spec, normalized)) {
    deriveAttribution(normalized, spec);
    // Only the last evidence operation for a surviving real document supplies
    // its source label. A later conversion/removal must not restore old cites.
    const evidence = new Map<string, V3Edit>();
    for (const command of edits) {
      if (command.type === "replaceExcerpt" || command.type === "convertDocument") evidence.set(command.documentId, command);
    }
    for (const command of evidence.values()) {
      if (command.type !== "replaceExcerpt") continue;
      const doc = spec.documents.find(d => d.id === command.documentId);
      const source = sources.find(s => s.id === command.sourceId);
      if (doc?.real && source) {
        doc.sourceLabel = source.title;
        doc.citations = [{ sourceId: source.id, quote: doc.body }];
      }
    }
  }
  return spec;
}
