import { z } from "zod";
import type { AdventureSpec } from "@adventure/spec-v3";
import { atPath, type EditPath } from "./commands";

export function unwrap(schema: z.ZodType): z.ZodType {
  const def = schema._zod.def;
  if (
    def.type === "optional" ||
    def.type === "nullable" ||
    def.type === "default"
  )
    return unwrap((schema as z.ZodOptional<z.ZodType>).unwrap());
  if (def.type === "lazy")
    return unwrap((schema as z.ZodLazy<z.ZodType>).unwrap());
  return schema;
}
function minimumLength(schema: z.ZodType): number {
  for (const check of schema._zod.def.checks ?? []) {
    const def = check._zod.def as {
      check: string;
      minimum?: number;
      length?: number;
    };
    if (def.check === "min_length") return def.minimum ?? 0;
    if (def.check === "length_equals") return def.length ?? 0;
  }
  return 0;
}
export function template(schema: z.ZodType, depth = 0): unknown {
  if (depth > 15) return undefined;
  if (schema._zod.def.type === "optional") return undefined;
  if (schema._zod.def.type === "nullable") return null;
  const value = unwrap(schema);
  switch (value._zod.def.type) {
    case "object":
      return Object.fromEntries(
        Object.entries((value as z.ZodObject).shape)
          .map(([key, field]) => [
            key,
            key === "id"
              ? `teacher-${crypto.randomUUID()}`
              : template(field as z.ZodType, depth + 1),
          ])
          .filter(([, item]) => item !== undefined),
      );
    case "array": {
      const list = value as z.ZodArray;
      const minimum = minimumLength(list);
      return Array.from({ length: Math.min(Number(minimum), 10) }, () =>
        template(list.element as z.ZodType, depth + 1),
      );
    }
    case "record":
      return {};
    case "union":
      return template((value as z.ZodUnion).options[0] as z.ZodType, depth + 1);
    case "enum":
      return (value as z.ZodEnum).options[0];
    case "literal":
      return (value as z.ZodLiteral).values.values().next().value;
    case "boolean":
      return false;
    case "number":
      return Math.max(1, Number(value._zod.bag.minimum ?? 0));
    default:
      return minimumLength(value) ? "unresolved" : "";
  }
}
export const fieldLabel = (key: string) =>
  key
    .replace(/Ids?$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
export type ReferenceContext = {
  stageId?: string;
  characterId?: string;
  momentId?: string;
  documentId?: string;
  questionId?: string;
};
export function referenceContext(
  spec: AdventureSpec,
  path: EditPath,
): ReferenceContext {
  const context: ReferenceContext = {};
  if (path[0] === "characters")
    context.characterId = spec.characters[Number(path[1])]?.id;
  if (path[0] === "definingMoments") {
    const moment = spec.definingMoments[Number(path[1])];
    context.momentId = moment?.id;
    context.stageId = moment?.stageId;
  }
  if (path[0] === "stages") context.stageId = spec.stages[Number(path[1])]?.id;
  if (path[0] === "documents") {
    const document = spec.documents[Number(path[1])];
    context.documentId = document?.id;
    const question = path.includes("variants")
      ? document?.readingCheck?.variants[Number(path[path.indexOf("variants") + 1])]
      : path.includes("recovery") ? document?.readingCheck?.recovery : undefined;
    context.questionId = question?.id;
  }
  if (path[0] === "triggers")
    context.characterId = spec.triggers[Number(path[1])]?.characterId;
  if (path[0] === "storyEvents")
    context.stageId = spec.storyEvents[Number(path[1])]?.stageId;
  if (path[0] === "discoveries")
    context.stageId = spec.discoveries[Number(path[1])]?.stageId;
  if (path.at(-2) === "stances") context.characterId = String(path.at(-1));
  try {
    const parent = atPath(spec, path.slice(0, -1));
    if (parent && typeof parent === "object") {
      for (const key of ["characterId", "momentId", "documentId"] as const)
        if (
          key in parent &&
          typeof (parent as Record<string, unknown>)[key] === "string"
        )
          context[key] = (parent as Record<string, string>)[key];
    }
  } catch {
    /* A newly-added optional field can be incomplete while editing. */
  }
  return context;
}
export function references(
  spec: AdventureSpec,
  key: string,
  context: ReferenceContext = {},
): { value: string; label: string }[] | undefined {
  const list = <T extends { id: string }>(
    items: T[],
    title: (item: T) => string,
  ) => items.map((item) => ({ value: item.id, label: title(item) || item.id }));
  if (["characterId", "deciderId"].includes(key))
    return list(spec.characters, (c) => c.name);
  if (
    [
      "roomId",
      "toRoomId",
      "startRoomId",
      "inRoom",
      "placement",
      "documentPlacement",
    ].includes(key)
  )
    return [
      ...list(
        spec.stages
          .filter((s) => !context.stageId || s.id === context.stageId)
          .flatMap((s) => s.rooms),
        (r) => r.name,
      ),
      ...(key === "documentPlacement"
        ? [{ value: "held", label: "Held at start" }]
        : []),
    ];
  if (["stageId"].includes(key)) return list(spec.stages, (s) => s.title);
  if (["definingMomentId", "momentId"].includes(key))
    return list(spec.definingMoments, (m) => m.scene);
  if (["actId"].includes(key))
    return list(
      spec.definingMoments
        .filter((m) => !context.momentId || m.id === context.momentId)
        .flatMap((m) => m.acts),
      (a) => a.text,
    );
  if (["outcomeId"].includes(key))
    return list(
      spec.definingMoments
        .filter((m) => !context.momentId || m.id === context.momentId)
        .flatMap((m) => m.outcomes),
      (o) => o.summary,
    );
  if (["endingId", "closesEndingIds"].includes(key))
    return list(spec.endings, (e) => e.title);
  if (["stanceId", "initialStanceId", "toStance", "stances"].includes(key))
    return spec.characters
      .filter((c) => !context.characterId || c.id === context.characterId)
      .flatMap((c) =>
        c.stances.map((s) => ({ value: s.id, label: `${c.name}: ${s.label}` })),
      );
  if (
    [
      "discoveryId",
      "discoveryIds",
      "discovered",
      "notePassed",
      "contradictedBy",
      "unlocksDiscoveryId",
      "counterPoints",
      "recoveryDiscoveryIds",
    ].includes(key)
  )
    return list(spec.discoveries, (d) => d.topic || d.note);
  if (["documentId", "handsOver"].includes(key))
    return list(spec.documents, (d) => d.title);
  if (["keyPassageId"].includes(key))
    return spec.documents
      .filter((d) => !context.documentId || d.id === context.documentId)
      .flatMap((d) =>
        d.keyPassages.map((p) => ({
          value: p.id,
          label: `${d.title}: ${d.body.slice(p.start, p.end)}`,
        })),
      );
  if (key === "slantConfronted")
    return list(
      spec.characters.flatMap((c) => c.slants),
      (s) => s.claim,
    );
  if (key === "correctOptionId")
    return spec.documents
      .filter((document) => !context.documentId || document.id === context.documentId)
      .flatMap((document) => document.readingCheck ? [...document.readingCheck.variants, document.readingCheck.recovery] : [])
      .filter((question) => question.id === context.questionId)
      .flatMap((question) => question.options.map((option) => ({ value: option.id, label: option.text })));
}
export function dependentPaths(
  spec: unknown,
  id: string,
  path: EditPath = [],
): string[] {
  if (typeof spec === "string")
    return spec === id && path.at(-1) !== "id" ? [path.join(".")] : [];
  if (!spec || typeof spec !== "object") return [];
  return Object.entries(spec).flatMap(([key, item]) => [
    ...(key === id ? [path.concat(key).join(".")] : []),
    ...dependentPaths(
      item,
      id,
      path.concat(Array.isArray(spec) ? Number(key) : key),
    ),
  ]);
}
