import {
  checkSpec,
  validateSpec,
  type AdventureSpec,
  type CheckIssue,
  type SpecDocument,
  type SpecSource,
  type Condition,
} from "@adventure/spec-v3";
import type { ExtractedDocument } from "@adventure/generation";

export type ReviewTab = "stages" | "characters" | "documents" | "endings";
export type ReviewTarget = { tab: ReviewTab; itemId: string; anchor: string };
export const reviewAnchor = (id: string) => `review-${encodeURIComponent(id)}`;

/** Display-only enrichment: never write recovered provenance into a saved version. */
export function reviewSources(
  spec: AdventureSpec,
  documents: ExtractedDocument[],
): SpecSource[] {
  const sources = new Map(
    spec.sources.map((source) => [source.id, { ...source }]),
  );
  for (const doc of documents) {
    const saved = sources.get(doc.id);
    sources.set(doc.id, {
      id: doc.id,
      title: doc.title || saved?.title || doc.id,
      origin: doc.origin ?? saved?.origin ?? "teacher",
      ...(doc.url || saved?.url ? { url: doc.url || saved?.url } : {}),
    });
  }
  return [...sources.values()];
}

export function reviewErrors(
  raw: unknown,
  savedErrors: CheckIssue[] = [],
): CheckIssue[] {
  const parsed = validateSpec(raw);
  const current = parsed.ok
    ? checkSpec(parsed.spec).errors
    : parsed.issues.map((issue) => ({ ...issue, code: "schema" }));
  const unique = new Map(
    [...current, ...savedErrors].map((issue) => [
      `${issue.code}|${issue.path}|${issue.message}`,
      issue,
    ]),
  );
  return [...unique.values()];
}

/** Each nested entity points to its owning detail pane and its own heading. */
export function reviewTargets(spec: AdventureSpec): Map<string, ReviewTarget> {
  const targets = new Map<string, ReviewTarget>();
  const put = (id: string, tab: ReviewTab, itemId: string) =>
    targets.set(id, { tab, itemId, anchor: reviewAnchor(id) });
  const stageIds = new Set(spec.stages.map((stage) => stage.id));
  const characterIds = new Set(
    spec.characters.map((character) => character.id),
  );
  for (const stage of spec.stages) {
    put(stage.id, "stages", stage.id);
    for (const room of stage.rooms) put(room.id, "stages", stage.id);
  }
  for (const discovery of spec.discoveries)
    if (stageIds.has(discovery.stageId))
      put(discovery.id, "stages", discovery.stageId);
  for (const event of spec.storyEvents)
    if (stageIds.has(event.stageId)) put(event.id, "stages", event.stageId);
  for (const moment of spec.definingMoments) {
    if (!stageIds.has(moment.stageId)) continue;
    put(moment.id, "stages", moment.stageId);
    for (const act of moment.acts) put(act.id, "stages", moment.stageId);
    for (const outcome of moment.outcomes)
      put(outcome.id, "stages", moment.stageId);
  }
  for (const character of spec.characters) {
    put(character.id, "characters", character.id);
    for (const stance of character.stances)
      put(stance.id, "characters", character.id);
    for (const slant of character.slants)
      put(slant.id, "characters", character.id);
  }
  for (const trigger of spec.triggers)
    if (characterIds.has(trigger.characterId))
      put(trigger.id, "characters", trigger.characterId);
  for (const doc of spec.documents) {
    put(doc.id, "documents", doc.id);
    for (const passage of doc.keyPassages) put(passage.id, "documents", doc.id);
  }
  for (const ending of spec.endings) {
    put(ending.id, "endings", ending.id);
    for (const verdict of ending.interview.verdicts)
      put(verdict.id, "endings", ending.id);
  }
  return targets;
}

export function issueTarget(
  spec: AdventureSpec,
  issue: CheckIssue,
  targets = reviewTargets(spec),
): ReviewTarget | undefined {
  const [part, localPath] = issue.path.includes("/")
    ? issue.path.split(/\/(.*)/s)
    : [undefined, issue.path];
  if (part) {
    // Part-local array indices cannot be looked up in the assembled spec.
    const [kind, id] = part.split(":");
    if (["stage", "persona", "moment", "ending"].includes(kind))
      return targets.get(id);
    return issue.ids?.map((id) => targets.get(id)).find(Boolean);
  }
  const keys = (localPath ?? "").replace(/\[(\d+)\]/g, ".$1").split(".");
  let node: unknown = spec;
  let target: ReviewTarget | undefined;
  for (const key of keys) {
    if (!node || typeof node !== "object") break;
    node = (node as Record<string, unknown>)[key];
    if (
      node &&
      typeof node === "object" &&
      "id" in node &&
      typeof node.id === "string"
    )
      target = target
        ? { ...target, anchor: reviewAnchor(node.id) }
        : targets.get(node.id);
  }
  return target ?? issue.ids?.map((id) => targets.get(id)).find(Boolean);
}

/** Split on every boundary so adjacent, overlapping and Unicode passages preserve the body exactly. */
export function documentSegments(
  doc: Pick<SpecDocument, "body" | "keyPassages">,
) {
  const clamp = (n: number) => Math.max(0, Math.min(doc.body.length, n));
  const points = [
    ...new Set([
      0,
      doc.body.length,
      ...doc.keyPassages.flatMap((p) => [clamp(p.start), clamp(p.end)]),
    ]),
  ].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, i) => {
    const end = points[i + 1];
    return {
      start,
      text: doc.body.slice(start, end),
      passageIds: doc.keyPassages
        .filter((p) => p.start <= start && p.end >= end)
        .map((p) => p.id),
    };
  });
}

export function safeSourceUrl(url: string | undefined): string | undefined {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (["https:", "http:"].includes(parsed.protocol)) return parsed.href;
  } catch {
    /* show the title without a link */
  }
}

export function conditionText(
  condition: Condition,
  name: (id: string) => string = (id) => id,
): string {
  if ("all" in condition)
    return condition.all
      .map((c) => `(${conditionText(c, name)})`)
      .join(" and ");
  if ("any" in condition)
    return condition.any.map((c) => `(${conditionText(c, name)})`).join(" or ");
  if ("not" in condition) return `Not (${conditionText(condition.not, name)})`;
  if ("discovered" in condition)
    return `Discover ${name(condition.discovered)}`;
  if ("stanceAtLeast" in condition)
    return `${name(condition.stanceAtLeast.characterId)} reaches at least ${name(condition.stanceAtLeast.stanceId)}`;
  if ("stanceIs" in condition)
    return `${name(condition.stanceIs.characterId)} is ${name(condition.stanceIs.stanceId)}`;
  if ("notePassed" in condition)
    return `Pass ${name(condition.notePassed.discoveryId)} to ${name(condition.notePassed.characterId)}`;
  if ("slantConfronted" in condition)
    return `Confront ${name(condition.slantConfronted)}`;
  if ("act" in condition) return `Choose ${name(condition.act.actId)}`;
  if ("outcome" in condition)
    return `Reach ${name(condition.outcome.outcomeId)}`;
  if ("inRoom" in condition) return `Enter ${name(condition.inRoom)}`;
  return `After ${condition.elapsedAtLeast} seconds`;
}
