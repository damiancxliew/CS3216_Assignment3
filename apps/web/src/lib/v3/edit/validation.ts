import {
  editableIssues,
  checkSpec,
  type AdventureSpec,
  type CheckIssue,
  type CheckResult,
} from "@adventure/spec-v3";
import { isAllowedUrl } from "@adventure/generation";
import { quoteInSource } from "@adventure/generation/v3";
import type { CapturedSource } from "./commands";

// Only constraints fully rechecked from the saved spec can retire a generation
// blocker. Part-local refs/schema/id obligations need retained generation context.
const rechecked = new Set([
  "empty-field",
  "trust-notice",
  "trigger-count",
  "hidden-stance-guard",
  "rule-count",
  "interpretations-few",
  "teacher-questions",
  "passage-count",
  "passage-unlinked",
  "hint-angle-missing",
  "hint-angle-kind",
  "prediction-long",
  "prediction-duplicate",
  "epilogue",
  "interviewer-character",
  "verdict-duplicate",
  "counter-count",
  "counter-core",
  "historical-diverted",
  "rule-discovered",
]);
export function retainedGenerationErrors(
  spec: AdventureSpec,
  errors: CheckIssue[],
): CheckIssue[] {
  return errors.filter((error) => !rechecked.has(error.code));
}
export function validateEditedSpec(
  spec: AdventureSpec,
  sources: CapturedSource[],
  savedErrors: CheckIssue[] = [],
): CheckResult {
  const result = checkSpec(spec);
  if (!spec.authoring) result.errors.push(...editableIssues(spec));
  const sourcesAvailable = spec.sources.every((s) =>
    sources.some((c) => c.id === s.id),
  );
  result.errors.push(
    ...retainedGenerationErrors(spec, savedErrors).filter(
      (e) =>
        !(
          sourcesAvailable &&
          !e.path.startsWith("reveal/") &&
          ["quote-not-in-source", "real-uncited"].includes(e.code)
        ),
    ),
  );
  const byId = new Map(sources.map((s) => [s.id, s.text]));
  const add = (code: string, path: string, message: string) =>
    result.errors.push({ code, path, message });
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}.${i}`));
      return;
    }
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.citations)) {
      for (const citation of obj.citations as {
        sourceId: string;
        quote?: string;
      }[]) {
        const text = byId.get(citation.sourceId);
        if (text === undefined)
          add(
            "source-unavailable",
            path,
            `Captured source '${citation.sourceId}' is unavailable for verification.`,
          );
        else if (
          citation.quote !== undefined &&
          !quoteInSource(citation.quote, text)
        )
          add(
            "quote-not-in-source",
            path,
            "Citation quote does not occur in its captured source.",
          );
      }
    }
    for (const [key, item] of Object.entries(obj))
      if (key !== "authoring") visit(item, path ? `${path}.${key}` : key);
  };
  visit(spec, "");
  spec.documents.forEach((doc, i) => {
    if (!doc.real) return;
    const cited = (doc.citations ?? [])
      .map((c) => byId.get(c.sourceId))
      .filter((s): s is string => s !== undefined);
    if (!cited.length)
      add(
        "real-uncited",
        `documents.${i}`,
        "A real document requires an available captured source.",
      );
    else if (
      !doc.body.trim() ||
      doc.body
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .some((p) => !cited.some((s) => quoteInSource(p, s)))
    )
      add(
        "quote-not-in-source",
        `documents.${i}.body`,
        "Real document paragraphs must occur in a captured source.",
      );
  });
  spec.characters.forEach((character, i) =>
    character.persona.phrases.forEach((phrase, j) => {
      const cited = (phrase.citations ?? [])
        .map((c) => byId.get(c.sourceId))
        .filter((text): text is string => text !== undefined);
      if (
        cited.length &&
        !cited.some((text) => quoteInSource(phrase.text, text))
      )
        add(
          "quote-not-in-source",
          `characters.${i}.persona.phrases.${j}.text`,
          "Quoted phrase text must occur in a cited captured source.",
        );
    }),
  );
  if (spec.authoring?.sourcePolicy) {
    for (const source of spec.sources)
      if (
        source.origin === "outside" &&
        (!source.url || !isAllowedUrl(source.url, spec.authoring.sourcePolicy))
      )
        add(
          "source-policy",
          "sources",
          `Outside source '${source.title}' is outside the selected policy.`,
        );
  }
  // Stable deduplication without mutating historical generation output.
  result.errors = [
    ...new Map(
      result.errors.map((e) => [`${e.code}|${e.path}|${e.message}`, e]),
    ).values(),
  ];
  return result;
}
