/**
 * Dev-only fake generation passes so the v3 flow can be clicked through without
 * OpenAI. Enabled when `V3_FAKE_PASSES` is set AND NODE_ENV !== "production";
 * `V3_FAKE_PASSES=fail:<pass>` makes that pass return ok: false with one issue,
 * so the failed page can be exercised.
 *
 * The skeleton is the golden 1819 spec projected onto SkeletonSpec's keys;
 * details/endings/reveal hand back the golden spec. Every pass waits ~3 s so
 * the progress page is visible.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateSkeleton, validateSpec } from "@adventure/spec-v3";
import { finalRepair } from "@adventure/generation/v3";
import type { AdventureSpec, SkeletonShape } from "@adventure/spec-v3";
import type { ExtractedDocument, OutsideSource } from "@adventure/generation";

import type { GenerationDeps } from "./deps";

const FAKE_COST = 0.01;
const FAKE_DELAY_MS = 3_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function goldenSpec(): AdventureSpec {
  const candidates = [
    resolve(process.cwd(), "fixtures/golden-1819.json"),
    resolve(process.cwd(), "../../fixtures/golden-1819.json"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error("golden-1819.json not found from " + process.cwd());
  const validated = validateSpec(JSON.parse(readFileSync(path, "utf8")));
  if (!validated.ok) throw new Error("golden-1819.json does not validate");
  return validated.spec;
}

type Shape = { [key: string]: true | Shape | Shape[] };

/** Deep key-pick: keeps only the named keys, recursing where the shape is nested. */
function pick(obj: unknown, shape: Shape): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  const source = obj as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(shape)
      .filter(([key]) => key in source)
      .map(([key, sub]) => {
        const value = source[key];
        if (sub === true) return [key, value];
        if (Array.isArray(sub)) return [key, (value as unknown[]).map((item) => pick(item, sub[0]!))];
        return [key, pick(value, sub)];
      }),
  );
}

const SKELETON_SHAPE: Shape = {
  id: true,
  title: true,
  readingLevel: true,
  arc: true,
  role: {
    name: true, position: true, relationships: true, reputation: true, stakes: true,
    privateBrief: { goals: true, fears: true, constraints: true, knows: true },
    situation: true,
  },
  sources: [{ id: true, title: true, origin: true }],
  characters: [{ id: true, name: true, title: true, real: true, tier: true, persona: { publicPosition: true, privateAgenda: true } }],
  stages: [
    {
      id: true, title: true, timePlace: true, centralQuestion: true,
      rooms: [{ id: true, name: true, description: true }],
      startRoomId: true, placement: true, definingMomentId: true,
    },
  ],
  discoveries: [{ id: true, stageId: true, holder: { characterId: true, documentId: true }, text: true, note: true, core: true, sourceLabel: true, citations: true }],
  documents: [{ id: true, kind: true, title: true, real: true }],
  definingMoments: [
    {
      id: true, stageId: true, deciderId: true, scene: true,
      acts: [{ id: true, text: true }],
      outcomes: [{ id: true, summary: true, closesEndingIds: true, endingId: true, secret: true, historical: true }],
      rules: [{ actId: true, outcomeId: true }],
    },
  ],
  endings: [{ id: true, type: true, title: true, summary: true, sourceLabel: true, citations: true }],
};

/** Projects the full golden spec onto SkeletonSpec's strict shape. */
export function goldenSkeleton(spec: AdventureSpec): SkeletonShape {
  // the skeleton lists core discoveries only (its schema fixes core to true)
  const coreOnly = { ...(spec as unknown as Record<string, unknown>), discoveries: spec.discoveries.filter((d) => d.core === true) };
  const projected = {
    ...(pick(coreOnly, SKELETON_SHAPE) as Record<string, unknown>),
    arc: `${spec.title} — one episode, its decisions, and how it really went.`,
  };
  const validated = validateSkeleton(projected);
  if (!validated.ok) throw new Error(`golden skeleton projection failed: ${JSON.stringify(validated.issues.slice(0, 3))}`);
  return validated.spec;
}

const failIssue = (pass: string) => [{ code: "fake-failure", path: pass, message: `Fake failure requested via V3_FAKE_PASSES=fail:${pass}` }];

/** Every citation quote in the spec, wherever it appears (discoveries, endings, phrases…). */
function* citationItems(node: unknown): Generator<{ sourceId: string; quote: string }> {
  if (typeof node !== "object" || node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) yield* citationItems(item);
    return;
  }
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.citations)) {
    for (const citation of record.citations as { sourceId?: string; quote?: string }[])
      if (typeof citation.quote === "string" && typeof citation.sourceId === "string") yield { sourceId: citation.sourceId, quote: citation.quote };
  }
  for (const value of Object.values(record)) yield* citationItems(value);
}

/**
 * One fake "outside" document per spec source, whose text is every citation
 * quote that cites it — so approve's quote check passes in fake mode.
 */
export function fakeOutsideSources(spec: AdventureSpec): { sources: OutsideSource[]; documents: ExtractedDocument[] } {
  const quotesBySource = new Map<string, string[]>();
  for (const item of citationItems(spec)) {
    const list = quotesBySource.get(item.sourceId) ?? [];
    if (!list.includes(item.quote)) list.push(item.quote);
    quotesBySource.set(item.sourceId, list);
  }
  const sources: OutsideSource[] = [];
  const documents: ExtractedDocument[] = [];
  for (const source of spec.sources) {
    const text = (quotesBySource.get(source.id) ?? [source.title]).join("\n\n");
    sources.push({ id: source.id, title: source.title, origin: "outside", url: `https://example.invalid/${source.id}` });
    documents.push({
      id: source.id,
      title: source.title,
      kind: "text",
      contentHash: createHash("sha256").update(text).digest("hex"),
      pages: [{ page: 1, text }],
      pageCount: 1,
      charCount: text.length,
      warnings: [],
    });
  }
  return { sources, documents };
}

/** Returns the fake passes, or null when fakes are off. */
export function fakeGenerationPasses(env: NodeJS.ProcessEnv = process.env): GenerationDeps["passes"] | null {
  const flag = env.V3_FAKE_PASSES;
  if (!flag || env.NODE_ENV === "production") return null;
  const failAt = flag.startsWith("fail:") ? flag.slice(5) : null;

  return {
    sources: async () => {
      await sleep(FAKE_DELAY_MS);
      if (failAt === "sources") throw new Error("Fake failure requested via V3_FAKE_PASSES=fail:sources");
      const { sources, documents } = fakeOutsideSources(goldenSpec());
      return { sources, documents, rejected: [], usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, costUsd: FAKE_COST };
    },
    skeleton: async () => {
      await sleep(FAKE_DELAY_MS);
      if (failAt === "skeleton") return { ok: false as const, issues: failIssue("skeleton"), warnings: [], metrics: { calls: [], totalCostUsd: FAKE_COST } };
      return { ok: true as const, skeleton: goldenSkeleton(goldenSpec()), issues: [], warnings: [], metrics: { calls: [], totalCostUsd: FAKE_COST } };
    },
    details: async (input: { skeleton: SkeletonShape }) => {
      await sleep(FAKE_DELAY_MS);
      if (failAt === "details") return { ok: false as const, issues: failIssue("details"), warnings: [], metrics: { calls: [], totalCostUsd: FAKE_COST } };
      // an edited skeleton's title carries onto the draft, so approve-with-edit is visible
      const draft = { ...goldenSpec(), title: input.skeleton.title };
      return {
        ok: true as const,
        draft,
        issues: [],
        warnings: [{ code: "fake-warning", path: "details", message: "Sample warning from the fake details pass." }],
        slantedDocuments: [],
        mergedDuplicates: [],
        pendingPasses: ["endings", "reveal"],
        metrics: { calls: [], totalCostUsd: FAKE_COST },
      };
    },
    endings: async () => {
      await sleep(FAKE_DELAY_MS);
      if (failAt === "endings") return { ok: false as const, issues: failIssue("endings"), warnings: [], metrics: { calls: [], totalCostUsd: FAKE_COST } };
      return {
        ok: true as const,
        spec: goldenSpec(),
        issues: [],
        warnings: [{ code: "fake-warning", path: "endings", message: "Sample warning from the fake endings pass." }],
        pendingPasses: ["reveal"],
        metrics: { calls: [], totalCostUsd: FAKE_COST },
      };
    },
    // the fake specs check clean, so the final repair is never reached
    check: finalRepair,
    reveal: async () => {
      await sleep(FAKE_DELAY_MS);
      if (failAt === "reveal") return { ok: false as const, issues: failIssue("reveal"), warnings: [], metrics: { calls: [], totalCostUsd: FAKE_COST } };
      return {
        ok: true as const,
        spec: goldenSpec(),
        issues: [],
        warnings: [{ code: "fake-warning", path: "reveal", message: "Sample warning from the fake reveal pass." }],
        pendingPasses: [],
        metrics: { calls: [], totalCostUsd: FAKE_COST },
      };
    },
  } as unknown as GenerationDeps["passes"];
}
