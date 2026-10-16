/**
 * The v3 generation job: steps on the memory job runner, memory source/adventure
 * stores, vi.fn passes returning canned results. The spec is fixtures/golden-1819.json
 * (validates clean); the skeleton is the same file — a full spec is a valid SkeletonShape.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkSpec, validateSkeleton, validateSpec } from "@adventure/spec-v3";
import type { AdventureSpec, SkeletonShape } from "@adventure/spec-v3";
import type { ExtractedDocument, OutsideSource } from "@adventure/generation";
import type { LlmUsage } from "@adventure/generation/llm";
import { createJobs, memoryJobStore } from "@adventure/jobs";

import { dedupeUploadIds } from "@/lib/v3/generation/dedupe";
import { memoryV3AdventureWriter, memoryV3SourceStore } from "@/lib/v3/generation/deps";
import type { GenerationDeps } from "@/lib/v3/generation/deps";
import { approveSkeleton, getGenerationProgress, startGeneration } from "@/lib/v3/generation/service";
import { v3GenerationSteps } from "@/lib/v3/generation/steps";
import type { GenerationBrief } from "@/lib/v3/generation/types";

const ROOT = resolve(__dirname, "../..");
const spec = validateSpec(JSON.parse(readFileSync(resolve(ROOT, "fixtures/golden-1819.json"), "utf8"))).spec as AdventureSpec;
// no skeleton fixture exists in the repo; build a minimal valid SkeletonShape
const skeleton = validateSkeleton({
  id: "adv",
  title: "The Test",
  readingLevel: "sec",
  arc: "An arc.",
  role: spec.role,
  sources: [{ id: "handout", title: "handout", origin: "teacher" }],
  characters: [
    { id: "raffles", name: "Raffles", title: "Lieutenant-Governor", real: true, tier: "major", persona: { publicPosition: "p", privateAgenda: "a" } },
    { id: "farquhar", name: "Farquhar", title: "Resident", real: true, tier: "major", persona: { publicPosition: "p", privateAgenda: "a" } },
  ],
  stages: [
    {
      id: "s1",
      title: "First",
      timePlace: "Feb 1819",
      centralQuestion: "q1",
      rooms: [
        { id: "r1", name: "Dock", description: "d" },
        { id: "r2", name: "Office", description: "d" },
      ],
      startRoomId: "r1",
      placement: { farquhar: "r1" },
      definingMomentId: "m1",
    },
  ],
  discoveries: [
    { id: "d-core1", stageId: "s1", holder: { characterId: "farquhar" }, text: "Core one.", note: "n", core: true, sourceLabel: "from the teacher", citations: [{ sourceId: "handout", quote: "teacher text" }] },
  ],
  documents: [{ id: "doc-1", kind: "report", title: "R1", real: false }],
  definingMoments: [
    {
      id: "m1",
      stageId: "s1",
      deciderId: "farquhar",
      scene: "A schooner is sighted.",
      acts: [
        { id: "a1-hold", text: "Hold the flag" },
        { id: "a1-yield", text: "Yield quietly" },
      ],
      outcomes: [
        { id: "o1-hold", summary: "The flag stays.", endingId: "e-historical", historical: true, closesEndingIds: [] },
        { id: "o1-yield", summary: "The flag falls.", endingId: "e-alt1", closesEndingIds: [] },
        { id: "o1-stall", summary: "Farquhar stalls.", endingId: "e-alt2", closesEndingIds: [] },
      ],
      rules: [
        { actId: "a1-hold", outcomeId: "o1-hold" },
        { actId: "a1-yield", outcomeId: "o1-yield" },
        { actId: "a1-yield", outcomeId: "o1-stall" },
      ],
    },
  ],
  endings: [
    { id: "e-historical", type: "historical", title: "The Port Holds", summary: "It survives.", sourceLabel: "from the teacher", citations: [{ sourceId: "handout", quote: "teacher text" }] },
    { id: "e-alt1", type: "alternative", title: "Flag Down", summary: "It folds.", sourceLabel: "invented" },
    { id: "e-alt2", type: "alternative", title: "Long Talks", summary: "Deferred.", sourceLabel: "invented" },
  ],
} satisfies Record<string, unknown>).spec as SkeletonShape;

const schoolId = "school-1";
const ownerId = "user-1";
const env = { V3_ENABLED: "1", V3_SCHOOL_IDS: schoolId } as NodeJS.ProcessEnv;

const uploadDoc: ExtractedDocument = {
  id: "handout",
  title: "handout",
  kind: "text",
  contentHash: "h1",
  pageCount: 1,
  charCount: 20,
  pages: [{ page: 1, text: "teacher text" }],
  warnings: [],
};
const outsideDoc: ExtractedDocument = { ...uploadDoc, id: "outside-1" };
const outsideSource: OutsideSource = { id: "outside-1", title: "Outside", origin: "outside", url: "https://example.com/a" };
const usage: LlmUsage = { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0 };

function fakeDeps(overrides: Partial<GenerationDeps["passes"]> = {}) {
  const sources = memoryV3SourceStore();
  const adventures = memoryV3AdventureWriter();
  const passes = {
    sources: vi.fn(async () => ({ sources: [outsideSource], documents: [outsideDoc], rejected: [], usage, costUsd: 0.001 })),
    skeleton: vi.fn(async () => ({ ok: true, skeleton, issues: [], warnings: [], metrics: { calls: [], totalCostUsd: 0.1 } })),
    details: vi.fn(async () => ({
      ok: true,
      draft: spec,
      issues: [],
      warnings: [{ code: "w1", path: "triggers", message: "detail warning" }],
      slantedDocuments: [{ stageId: "s1", documentId: "doc-1", note: "slanted" }],
      mergedDuplicates: [],
      pendingPasses: ["endings", "reveal"],
      metrics: { calls: [], totalCostUsd: 0.2 },
    })),
    endings: vi.fn(async () => ({
      ok: true,
      spec,
      issues: [],
      warnings: [{ code: "w2", path: "conditionalRules.0", message: "ending warning" }],
      pendingPasses: ["reveal"],
      metrics: { calls: [], totalCostUsd: 0.3 },
    })),
    reveal: vi.fn(async () => ({ ok: true, spec, issues: [], warnings: [], pendingPasses: [], metrics: { calls: [], totalCostUsd: 0.4 } })),
    ...overrides,
  };
  const deps: GenerationDeps = {
    llm: () => ({ completeJson: async () => { throw new Error("no llm in tests") } }),
    search: () => ({ search: async () => ({ hits: [], usage, model: "m" }) }),
    recordSearchUsage: vi.fn(async () => {}),
    sources,
    adventures,
    passes: passes as unknown as GenerationDeps["passes"],
  };
  return { deps, sources, adventures, passes };
}

async function makeJob(overrides: Partial<GenerationDeps["passes"]> = {}) {
  const { deps, sources, adventures, passes } = fakeDeps(overrides);
  const store = memoryJobStore();
  const jobs = createJobs(store, v3GenerationSteps(() => deps));
  return { deps, sources, adventures, passes, store, jobs };
}

function form(mode: "quick" | "standard" = "quick") {
  return { episode: "Founding of Singapore, 1819", readingLevel: "sec" as const, mode, uploads: [{ doc: uploadDoc, storageKey: "upload:x/handout.txt" }] };
}

const ctx = (adventures: ReturnType<typeof memoryV3AdventureWriter>) => ({
  userId: ownerId,
  schoolId,
  createAdventure: async () => {
    const id = crypto.randomUUID();
    adventures.rows.set(id, { row: { id, schoolId, ownerId, status: "generating" as const }, spec: null, specVersion: 0 });
    return id;
  },
});

beforeEach(() => {
  process.env.V3_ENABLED = "1";
  process.env.V3_SCHOOL_IDS = schoolId;
});

describe("v3 generation job", () => {
  it("quick: runs all six steps in order and lands the spec as a draft", async () => {
    const { deps, jobs, adventures, sources, passes, store } = await makeJob();
    const result = await startGeneration(deps, jobs, ctx(adventures), form("quick"), env);
    expect("adventureId" in result).toBe(true);
    if (!("adventureId" in result)) return;
    const adventureId = result.adventureId;

    const progress = await jobs.drain({ jobId: adventureId });
    expect(progress?.status).toBe("succeeded");
    expect(progress?.steps.map((s) => s.name)).toEqual(["sources", "skeleton", "details", "endings", "reveal", "save"]);
    expect(progress?.steps.every((s) => s.status === "succeeded")).toBe(true);

    // each pass got the uploads plus the outside docs
    const docIds = passes.skeleton.mock.calls[0]![0].documents.map((d: ExtractedDocument) => d.id);
    expect(docIds).toEqual(["handout", "outside-1"]);
    expect(passes.details.mock.calls[0]![0].documents.map((d: ExtractedDocument) => d.id)).toEqual(["handout", "outside-1"]);

    // reveal received details' slantedDocuments; saveSpec got the reveal spec
    expect(passes.reveal.mock.calls[0]![0].slantedDocuments).toEqual([{ stageId: "s1", documentId: "doc-1", note: "slanted" }]);
    expect(passes.reveal.mock.calls[0]![0].draft).toBe(spec);
    const entry = adventures.rows.get(adventureId)!;
    expect(entry.row.status).toBe("draft");
    expect(entry.spec).toEqual(spec);
    expect(entry.specVersion).toBe(1);
    await expect(adventures.get(adventureId)).resolves.toMatchObject({ status: "draft" });
    void store;
    void sources;
  });

  describe("standard", () => {
    it("stops after skeleton with needs_review; approval with an edit resumes to draft", async () => {
      const { deps, jobs, adventures, passes, store } = await makeJob();
      const result = await startGeneration(deps, jobs, ctx(adventures), form("standard"), env);
      if (!("adventureId" in result)) throw new Error("start failed");
      const adventureId = result.adventureId;

      await jobs.drain({ jobId: adventureId });
      const adventure = (await adventures.get(adventureId))!;
      expect(adventure.status).toBe("needs_review");
      expect(passes.details).not.toHaveBeenCalled();

      const progress1 = await getGenerationProgress(deps, jobs, store, adventure);
      expect(progress1.status).toBe("needs_review");
      expect(progress1.skeleton).toEqual(skeleton);

      const edited = { ...skeleton, title: "Edited title" };
      const approve = await approveSkeleton(deps, jobs, store, ownerId, adventureId, edited, env);
      expect(approve).toEqual({ ok: true });

      await jobs.drain({ jobId: adventureId });
      expect(passes.details.mock.calls[0]![0].skeleton.title).toBe("Edited title");
      expect((await adventures.get(adventureId))!.status).toBe("draft");
    });

    it("approval without an edit uses the stored skeleton", async () => {
      const { deps, jobs, adventures, passes, store } = await makeJob();
      const result = await startGeneration(deps, jobs, ctx(adventures), form("standard"), env);
      if (!("adventureId" in result)) throw new Error("start failed");
      const adventureId = result.adventureId;
      await jobs.drain({ jobId: adventureId });

      expect(await approveSkeleton(deps, jobs, store, ownerId, adventureId, undefined, env)).toEqual({ ok: true });
      await jobs.drain({ jobId: adventureId });
      expect(passes.details.mock.calls[0]![0].skeleton.title).toBe(skeleton.title);
      expect((await adventures.get(adventureId))!.status).toBe("draft");
    });
  });

  describe("approveSkeleton guards", () => {
    it("a second approve errors and enqueues nothing; approve while generating errors; non-owner errors", async () => {
      const { deps, jobs, adventures, store, passes } = await makeJob();
      const result = await startGeneration(deps, jobs, ctx(adventures), form("standard"), env);
      if (!("adventureId" in result)) throw new Error("start failed");
      const adventureId = result.adventureId;

      // still generating → error
      expect(await approveSkeleton(deps, jobs, store, ownerId, adventureId, undefined, env)).toMatchObject({ error: expect.any(String) });
      // non-owner → error
      expect(await approveSkeleton(deps, jobs, store, "someone-else", adventureId, undefined, env)).toMatchObject({ error: expect.any(String) });

      await jobs.drain({ jobId: adventureId });
      expect(await approveSkeleton(deps, jobs, store, ownerId, adventureId, undefined, env)).toEqual({ ok: true });
      // second click → already approved, no new steps
      expect(await approveSkeleton(deps, jobs, store, ownerId, adventureId, undefined, env)).toMatchObject({ error: "already approved" });
      await jobs.drain({ jobId: adventureId });
      expect(passes.details).toHaveBeenCalledTimes(1);
    });

    it("an invalid skeleton returns issues and changes nothing", async () => {
      const { deps, jobs, adventures, store } = await makeJob();
      const result = await startGeneration(deps, jobs, ctx(adventures), form("standard"), env);
      if (!("adventureId" in result)) throw new Error("start failed");
      const adventureId = result.adventureId;
      await jobs.drain({ jobId: adventureId });

      const approve = await approveSkeleton(deps, jobs, store, ownerId, adventureId, { bad: true }, env);
      expect(approve).toMatchObject({ error: expect.any(String) });
      expect((approve as { issues?: unknown[] }).issues!.length).toBeGreaterThan(0);
      expect((await adventures.get(adventureId))!.status).toBe("needs_review");
    });
  });

  it("retries a flaky pass; saveOutside twice is idempotent; save twice keeps the version", async () => {
    let calls = 0;
    const flakyDetails = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return (await fakeDeps().passes.details)();
    });
    const { deps, jobs, adventures, sources, passes } = await makeJob({ details: flakyDetails as never });
    const result = await startGeneration(deps, jobs, ctx(adventures), form("quick"), env);
    if (!("adventureId" in result)) throw new Error("start failed");
    const adventureId = result.adventureId;

    const progress = await jobs.drain({ jobId: adventureId });
    expect(progress?.status).toBe("succeeded");
    expect(progress?.steps.find((s) => s.name === "details")?.attempts).toBe(2);
    void passes;

    // saveOutside ran twice (sources step ran once — simulate a retry by calling it again)
    await sources.saveOutside(adventureId, [outsideSource], [outsideDoc]);
    expect((sources.rows.get(adventureId) ?? []).filter((r) => r.doc.id === "outside-1")).toHaveLength(1);

    // running saveSpec twice with the same spec keeps the version
    const writer = adventures;
    const v1 = await writer.saveSpec(adventureId, spec);
    const v2 = await writer.saveSpec(adventureId, spec);
    expect(v1).toBe(v2);
  });

  it("a pass that fails on every attempt fails the job and the adventure", async () => {
    const failingSkeleton = vi.fn(async () => ({ ok: false, skeleton: undefined, issues: [{ code: "e1", path: "x", message: "bad skeleton" }], warnings: [], metrics: { calls: [], totalCostUsd: 0 } }));
    const { deps, jobs, adventures, passes, store } = await makeJob({ skeleton: failingSkeleton as never });
    const result = await startGeneration(deps, jobs, ctx(adventures), form("quick"), env);
    if (!("adventureId" in result)) throw new Error("start failed");
    const adventureId = result.adventureId;

    const progress = await jobs.drain({ jobId: adventureId });
    expect(progress?.status).toBe("failed");
    expect(failingSkeleton).toHaveBeenCalledTimes(2);
    expect(passes.details).not.toHaveBeenCalled();
    expect((await adventures.get(adventureId))!.status).toBe("failed");

    const report = await getGenerationProgress(deps, jobs, store, (await adventures.get(adventureId))!);
    expect(report.status).toBe("failed");
    expect(report.steps.find((s) => s.name === "skeleton")?.error).toContain("bad skeleton");
  });

  describe("flags", () => {
    it("start with V3 off or the school unlisted errors and enqueues nothing", async () => {
      const { deps, jobs, adventures, store } = await makeJob();
      const r1 = await startGeneration(deps, jobs, ctx(adventures), form(), { V3_ENABLED: "0" } as NodeJS.ProcessEnv);
      expect(r1).toMatchObject({ error: expect.any(String) });
      const r2 = await startGeneration(deps, jobs, ctx(adventures), form(), { V3_ENABLED: "1", V3_SCHOOL_IDS: "other" } as NodeJS.ProcessEnv);
      expect(r2).toMatchObject({ error: expect.any(String) });
      expect((await store.list("anything")).length).toBe(0);
      expect(adventures.rows.size).toBe(0);
    });

    it("a step whose school was removed from the allowlist throws", async () => {
      const { deps, jobs, adventures } = await makeJob();
      const result = await startGeneration(deps, jobs, ctx(adventures), form("quick"), env);
      if (!("adventureId" in result)) throw new Error("start failed");
      process.env.V3_SCHOOL_IDS = "other-school";
      const progress = await jobs.drain({ jobId: result.adventureId });
      expect(progress?.status).toBe("failed");
      expect(progress?.steps[0]?.error).toContain("not enabled");
    });
  });

  it("progress sums costUsd and tags warnings with their pass", async () => {
    const { deps, jobs, adventures, store } = await makeJob();
    const result = await startGeneration(deps, jobs, ctx(adventures), form("quick"), env);
    if (!("adventureId" in result)) throw new Error("start failed");
    const adventureId = result.adventureId;
    await jobs.drain({ jobId: adventureId });

    const progress = await getGenerationProgress(deps, jobs, store, (await adventures.get(adventureId))!);
    // 0.001 (sources) + 0.1 + 0.2 + 0.3 + 0.4
    expect(progress.costUsd).toBeCloseTo(1.001, 3);
    expect(progress.warnings).toEqual([
      expect.objectContaining({ code: "w1", pass: "details" }),
      expect.objectContaining({ code: "w2", pass: "endings" }),
    ]);
    expect(progress.steps).toHaveLength(6);
  });

  it("fails the adventure instead of orphaning it when saveUploads throws", async () => {
    const { deps, jobs, adventures, sources, store } = await makeJob();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(sources, "saveUploads").mockRejectedValue(new Error("sources_v3 is not available yet"));

    const result = await startGeneration(deps, jobs, ctx(adventures), form("quick"), env);
    expect("error" in result && result.error).toBe("Couldn't start generation. Please try again.");

    const entry = [...adventures.rows.values()][0]!;
    expect(entry.row.status).toBe("failed");
    // nothing enqueued
    await expect(store.list(entry.row.id)).resolves.toEqual([]);
    await expect(jobs.getProgress(entry.row.id)).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("dedupeUploadIds", () => {
  const doc = (id: string): ExtractedDocument => ({ ...uploadDoc, id });
  it("appends -2, -3 to repeated ids, in order", () => {
    const uploads = [
      { doc: doc("pasted-source"), storageKey: "inline:1" },
      { doc: doc("handout"), storageKey: "upload:2/a" },
      { doc: doc("pasted-source"), storageKey: "inline:3" },
      { doc: doc("handout"), storageKey: "upload:4/a" },
      { doc: doc("pasted-source"), storageKey: "inline:5" },
    ];
    expect(dedupeUploadIds(uploads).map((u) => u.doc.id)).toEqual(["pasted-source", "handout", "pasted-source-2", "handout-2", "pasted-source-3"]);
    // originals untouched
    expect(uploads[0]!.doc.id).toBe("pasted-source");
  });
});
