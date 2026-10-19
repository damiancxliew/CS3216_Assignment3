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

import { fakeGenerationPasses } from "@/lib/v3/generation/fake-passes";
import { dedupeUploadIds } from "@/lib/v3/generation/dedupe";
import { memoryV3AdventureWriter, memoryV3SourceStore } from "@/lib/v3/generation/deps";
import type { GenerationDeps } from "@/lib/v3/generation/deps";
import { portraitsStep } from "@/lib/v3/portraits/step";
import { memoryV3BriefStore } from "@/lib/v3/brief/store";
import { initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { continueFromSources, continuePause, loadPause, pausedPass, savePauseEdits, approveSkeleton, getGenerationProgress, restartGeneration, saveSkeletonDraft, startFromBrief, viewerSeesCost } from "@/lib/v3/generation/service";
import { PASS_LABELS, PASS_ORDER, stepDisplayStatus } from "@/lib/v3/generation/labels";
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
  const portraitStore = memoryJobStore();
  const queuePortraits = vi.fn(async (adventureId: string, version: number) => {
    const step = portraitsStep(adventureId, version);
    try {
      await portraitStore.enqueue(adventureId, [
        {
          name: step.name,
          step: step.step ?? step.name,
          input: step.input ?? null,
          deps: [],
          maxAttempts: 6,
        },
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === `duplicate step name: ${step.name}`) return;
      throw error;
    }
  });
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
    check: vi.fn(async (input: { parts: unknown }) => ({ spec, parts: input.parts, errors: [], unresolved: [], partErrors: [], repaired: [], metrics: { calls: [], totalCostUsd: 0 } })),
    ...overrides,
  };
  const deps: GenerationDeps = {
    llm: () => ({ completeJson: async () => { throw new Error("no llm in tests") } }),
    search: () => ({ search: async () => ({ hits: [], usage, model: "m" }) }),
    recordSearchUsage: vi.fn(async () => {}),
    queuePortraits,
    sources,
    adventures,
    passes: passes as unknown as GenerationDeps["passes"],
  };
  return { deps, sources, adventures, passes, portraitStore, queuePortraits };
}

async function makeJob(overrides: Partial<GenerationDeps["passes"]> = {}) {
  const { deps, sources, adventures, passes, portraitStore, queuePortraits } = fakeDeps(overrides);
  const store = memoryJobStore();
  const jobs = createJobs(store, v3GenerationSteps(() => deps));
  const briefStore = memoryV3BriefStore();
  return { deps, sources, adventures, passes, portraitStore, queuePortraits, store, jobs, briefStore };
}

type Harness = Awaited<ReturnType<typeof makeJob>>;

/** A briefing row with one upload and a draft at the confirm slot — what the chat leaves behind. */
async function briefingAtConfirm(
  { briefStore, sources, adventures }: Harness,
  mode: "quick" | "standard" | "guided" = "quick",
  { owner = ownerId, school = schoolId, timerMinutes = 45 }: { owner?: string; school?: string; timerMinutes?: number | null } = {},
) {
  const adventureId = await briefStore.create({ schoolId: school, ownerId: owner });
  adventures.rows.set(adventureId, { row: { id: adventureId, schoolId: school, ownerId: owner, status: "briefing" as const }, spec: null, specVersion: 0 });
  await sources.saveUploads(adventureId, [{ doc: uploadDoc, storageKey: "upload:x/handout.txt" }]);
  await briefStore.save(adventureId, {
    ...initialBriefStateV3(adventureId),
    draft: {
      sources: { summary: "A handout about 1819.", episodeProposal: "Founding of Singapore, 1819" },
      episode: "Founding of Singapore, 1819",
      focus: "",
      readingLevel: "sec",
      timerMinutes,
      mode,
    },
    sources: [{ id: "handout", title: "handout", kind: "text" }],
  });
  return adventureId;
}

/** startFromBrief with the harness' own stores — the path the confirm button takes. */
async function start(
  harness: Harness,
  mode: "quick" | "standard" | "guided" = "quick",
  options: { owner?: string; school?: string; timerMinutes?: number | null } = {},
) {
  const adventureId = await briefingAtConfirm(harness, mode, options);
  const result = await startFromBrief(harness.deps, harness.jobs, harness.briefStore, options.owner ?? ownerId, adventureId, env);
  // the brief store and the writer are two views of one table in production; sync them here
  if ("ok" in result) harness.adventures.rows.get(adventureId)!.row.status = "generating";
  return { adventureId, result };
}

beforeEach(() => {
  process.env.V3_ENABLED = "1";
  process.env.V3_SCHOOL_IDS = schoolId;
});

describe("v3 generation job", () => {
  it("quick: runs all seven steps in order and lands the spec as a draft", async () => {
    const harness = await makeJob();
    const { deps, jobs, adventures, sources, passes, store, queuePortraits } = harness;
    const { adventureId } = await start(harness, "quick");

    const progress = await jobs.drain({ jobId: adventureId });
    expect(progress?.status).toBe("succeeded");
    expect(progress?.steps.map((s) => s.name)).toEqual(["sources", "skeleton", "details", "endings", "reveal", "check", "save"]);
    expect(progress?.steps.every((s) => s.status === "succeeded")).toBe(true);

    // each pass got the uploads plus the outside docs
    const docIds = passes.skeleton.mock.calls[0]![0].documents.map((d: ExtractedDocument) => d.id);
    expect(docIds).toEqual(["handout", "outside-1"]);
    expect(passes.details.mock.calls[0]![0].documents.map((d: ExtractedDocument) => d.id)).toEqual(["handout", "outside-1"]);
    expect(passes.details.mock.calls[0]![0].timerMinutes).toBe(45);

    // reveal received details' slantedDocuments; saveSpec got the reveal spec
    expect(passes.reveal.mock.calls[0]![0].slantedDocuments).toEqual([{ stageId: "s1", documentId: "doc-1", note: "slanted" }]);
    expect(passes.reveal.mock.calls[0]![0].draft).toBe(spec);
    // a clean spec skips the final repair
    expect(passes.check).not.toHaveBeenCalled();
    const entry = adventures.rows.get(adventureId)!;
    expect(entry.row.status).toBe("draft");
    expect(entry.spec).toEqual(spec);
    expect(entry.specVersion).toBe(1);
    expect(queuePortraits).toHaveBeenCalledOnce();
    expect(queuePortraits).toHaveBeenCalledWith(adventureId, entry.specVersion);
    await expect(adventures.get(adventureId)).resolves.toMatchObject({ status: "draft" });
    void store;
    void sources;
  });

  it("keeps a saved adventure in draft when portrait queueing fails", async () => {
    const harness = await makeJob();
    const { jobs, adventures, queuePortraits } = harness;
    const { adventureId } = await start(harness, "quick");
    queuePortraits.mockRejectedValueOnce(new Error("portrait enqueue failed"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const progress = await jobs.drain({ jobId: adventureId });
      expect(progress?.status).toBe("succeeded");
      expect((await adventures.get(adventureId))?.status).toBe("draft");
      expect(adventures.rows.get(adventureId)?.spec).toEqual(spec);
      expect(consoleError).toHaveBeenCalledWith("Failed to queue v3 portraits", expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });

  it("a save retry with the same version does not enqueue a duplicate portrait step", async () => {
    const harness = await makeJob();
    const { deps, jobs, portraitStore, queuePortraits } = harness;
    const { adventureId } = await start(harness, "quick");
    await jobs.drain({ jobId: adventureId });

    const saveStep = v3GenerationSteps(() => deps).find((step) => step.name === "v3.gen.save")!;
    await expect(
      saveStep.run({
        jobId: adventureId,
        name: "save",
        input: { adventureId, schoolId },
        outputs: { reveal: { spec } },
        attempt: 1,
        signal: new AbortController().signal,
      } as never),
    ).resolves.toEqual({ version: 1 });
    expect(queuePortraits).toHaveBeenCalledTimes(2);
    expect(await portraitStore.list(adventureId)).toHaveLength(1);
  });

  describe("standard", () => {
    it("stops after skeleton with needs_review; approval with an edit resumes to draft", async () => {
      const harness = await makeJob();
      const { deps, jobs, adventures, passes, store } = harness;
      const { adventureId } = await start(harness, "standard");

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
      const harness = await makeJob();
      const { deps, jobs, adventures, passes, store } = harness;
      const { adventureId } = await start(harness, "standard");
      await jobs.drain({ jobId: adventureId });

      expect(await approveSkeleton(deps, jobs, store, ownerId, adventureId, undefined, env)).toEqual({ ok: true });
      await jobs.drain({ jobId: adventureId });
      expect(passes.details.mock.calls[0]![0].skeleton.title).toBe(skeleton.title);
      expect((await adventures.get(adventureId))!.status).toBe("draft");
    });
  });

  describe("approveSkeleton guards", () => {
    it("a second approve errors and enqueues nothing; approve while generating errors; non-owner errors", async () => {
      const harness = await makeJob();
      const { deps, jobs, adventures, store, passes } = harness;
      const { adventureId } = await start(harness, "standard");

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
      const harness = await makeJob();
      const { deps, jobs, adventures, store } = harness;
      const { adventureId } = await start(harness, "standard");
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
    const harness = await makeJob({ details: flakyDetails as never });
    const { deps, jobs, adventures, sources, passes } = harness;
    const { adventureId } = await start(harness, "quick");

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

  describe("final check-and-repair (#209)", () => {
    const broken = () => {
      const out = structuredClone(spec);
      out.documents = [];
      expect(checkSpec(out).errors.length).toBeGreaterThan(1);
      return out;
    };
    const leftover = { code: "ref", path: "discoveries.0.holder", message: "left over" };
    const withLeftovers = (draft: typeof spec) => ({
      details: vi.fn(async () => ({
        ok: false,
        draft: spec,
        issues: [leftover],
        warnings: [],
        slantedDocuments: [],
        mergedDuplicates: [],
        parts: { "stage:s1": { output: { stage: 1 }, issues: [leftover] } },
        metrics: { calls: [], totalCostUsd: 0.2 },
      })) as never,
      reveal: vi.fn(async () => ({ ok: false, spec: draft, issues: [leftover], warnings: [], parts: { reveal: { output: { reveal: 1 }, issues: [] } }, metrics: { calls: [], totalCostUsd: 0.4 } })) as never,
    });

    it("leftover errors don't fail a pass: check redoes the blamed parts and the draft is saved with what's left", async () => {
      const draft = broken();
      const check = vi.fn(async (input: { parts: unknown }) => ({ spec: draft, parts: input.parts, errors: [leftover], unresolved: [leftover], partErrors: [], repaired: ["reveal"], metrics: { calls: [], totalCostUsd: 0.05 } }));
      const harness = await makeJob({ ...withLeftovers(draft), check: check as never });
      const { deps, jobs, adventures, store } = harness;
      const { adventureId } = await start(harness, "quick");

      const progress = await jobs.drain({ jobId: adventureId });
      expect(progress?.status).toBe("succeeded");
      expect(check).toHaveBeenCalledOnce();
      const input = check.mock.calls[0]![0] as unknown as { skeleton: { title: string }; parts: Record<string, unknown>; timerMinutes?: number };
      expect(Object.keys(input.parts).sort()).toEqual(["reveal", "stage:s1"]);
      expect(input.skeleton.title).toBe(skeleton.title);
      expect(input.timerMinutes).toBe(45);

      const entry = adventures.rows.get(adventureId)!;
      expect(entry.row.status).toBe("draft");
      expect(entry.spec).toEqual(draft);
      const report = await getGenerationProgress(deps, jobs, store, (await adventures.get(adventureId))!);
      expect(report.checkErrors).toEqual([leftover]);
      expect(report.costUsd).toBeCloseTo(0.001 + 0.1 + 0.2 + 0.3 + 0.4 + 0.05);
    });

    it("a clean spec with a part whose own check still has issues goes through the repair", async () => {
      const { details } = withLeftovers(spec);
      const harness = await makeJob({ details });
      const { deps, jobs, adventures, passes, store } = harness;
      const { adventureId } = await start(harness, "quick");

      expect((await jobs.drain({ jobId: adventureId }))?.status).toBe("succeeded");
      expect(passes.check).toHaveBeenCalledOnce();
      expect(Object.keys((passes.check.mock.calls[0]![0] as { parts: object }).parts)).toEqual(["stage:s1"]);
      const report = await getGenerationProgress(deps, jobs, store, (await adventures.get(adventureId))!);
      expect(report.checkErrors).toEqual([]);
    });

    it("a repair that leaves more errors than it found is dropped", async () => {
      const draft = broken();
      // more than the spec errors plus the stage part's own issue
      const many = Array.from({ length: checkSpec(draft).errors.length + 2 }, () => leftover);
      const check = vi.fn(async (input: { parts: unknown }) => ({ spec, parts: input.parts, errors: many, unresolved: [], partErrors: [], repaired: ["reveal"], metrics: { calls: [], totalCostUsd: 0 } }));
      const harness = await makeJob({ ...withLeftovers(draft), check: check as never });
      const { jobs, adventures } = harness;
      const { adventureId } = await start(harness, "quick");

      expect((await jobs.drain({ jobId: adventureId }))?.status).toBe("succeeded");
      expect(adventures.rows.get(adventureId)!.spec).toEqual(draft);
    });
  });

  it("a pass that fails on every attempt fails the job and the adventure", async () => {
    const failingSkeleton = vi.fn(async () => ({ ok: false, skeleton: undefined, issues: [{ code: "e1", path: "x", message: "bad skeleton" }], warnings: [], metrics: { calls: [], totalCostUsd: 0 } }));
    const harness = await makeJob({ skeleton: failingSkeleton as never });
    const { deps, jobs, adventures, passes, store } = harness;
    const { adventureId } = await start(harness, "quick");

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
      const harness = await makeJob();
      const { deps, jobs, adventures, store, briefStore } = harness;
      const off = await briefingAtConfirm(harness);
      const r1 = await startFromBrief(deps, jobs, briefStore, ownerId, off, { V3_ENABLED: "0" } as NodeJS.ProcessEnv);
      expect(r1).toMatchObject({ error: expect.any(String) });
      const unlisted = await briefingAtConfirm(harness, "quick", { school: "other-school" });
      const r2 = await startFromBrief(deps, jobs, briefStore, ownerId, unlisted, { V3_ENABLED: "1", V3_SCHOOL_IDS: "other" } as NodeJS.ProcessEnv);
      expect(r2).toMatchObject({ error: expect.any(String) });
      expect((await store.list(off)).length + (await store.list(unlisted)).length).toBe(0);
      expect([...adventures.rows.values()].every((e) => e.row.status === "briefing")).toBe(true);
    });

    it("a step whose school was removed from the allowlist throws", async () => {
      const harness = await makeJob();
      const { jobs } = harness;
      const { adventureId } = await start(harness, "quick");
      process.env.V3_SCHOOL_IDS = "other-school";
      const progress = await jobs.drain({ jobId: adventureId });
      expect(progress?.status).toBe("failed");
      expect(progress?.steps[0]?.error).toContain("not enabled");
    });
  });

  it("progress sums costUsd and tags warnings with their pass", async () => {
    const harness = await makeJob();
    const { deps, jobs, adventures, store } = harness;
    const { adventureId } = await start(harness, "quick");
    await jobs.drain({ jobId: adventureId });

    const progress = await getGenerationProgress(deps, jobs, store, (await adventures.get(adventureId))!);
    // 0.001 (sources) + 0.1 + 0.2 + 0.3 + 0.4
    expect(progress.costUsd).toBeCloseTo(1.001, 3);
    expect(progress.warnings).toEqual([
      expect.objectContaining({ code: "w1", pass: "details" }),
      expect.objectContaining({ code: "w2", pass: "endings" }),
    ]);
    expect(progress.steps).toHaveLength(7);
  });

  it("double-clicking Create starts once: the second call errors and enqueues nothing", async () => {
    const harness = await makeJob();
    const { deps, jobs, briefStore, store } = harness;
    const adventureId = await briefingAtConfirm(harness);
    expect(await startFromBrief(deps, jobs, briefStore, ownerId, adventureId, env)).toEqual({ ok: true });
    const second = await startFromBrief(deps, jobs, briefStore, ownerId, adventureId, env);
    expect(second).toMatchObject({ error: "not awaiting confirmation" });
    expect((await store.list(adventureId)).map((r) => r.name)).toEqual(PASS_ORDER.slice());
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

describe("startFromBrief guards", () => {
  it("non-owner, wrong school env, not briefing and incomplete drafts error", async () => {
    const harness = await makeJob();
    const { deps, jobs, briefStore } = harness;

    const id = await briefingAtConfirm(harness);
    expect(await startFromBrief(deps, jobs, briefStore, "someone-else", id, env)).toMatchObject({ error: "not_found" });
    expect(await startFromBrief(deps, jobs, briefStore, ownerId, id, { V3_ENABLED: "0" } as NodeJS.ProcessEnv)).toMatchObject({ error: "not_found" });

    // incomplete draft (mode unset) stays briefing
    const partial = await briefStore.create({ schoolId, ownerId });
    const partialRow = (await briefStore.load(partial))!;
    await briefStore.save(partial, {
      ...partialRow.state!,
      draft: { sources: { summary: "s", episodeProposal: "e" }, episode: "e", focus: "", readingLevel: "sec" },
      sources: [{ id: "handout", title: "handout", kind: "text" }],
    });
    expect(await startFromBrief(deps, jobs, briefStore, ownerId, partial, env)).toMatchObject({ error: expect.any(String) });
    expect((await briefStore.load(partial))!.status).toBe("briefing");
  });

  it("sets the title, clears the brief, and enqueues 7 steps for quick / 2 for standard", async () => {
    const harness = await makeJob();
    const { deps, jobs, briefStore, store } = harness;

    const quick = await briefingAtConfirm(harness, "quick");
    expect(await startFromBrief(deps, jobs, briefStore, ownerId, quick, env)).toEqual({ ok: true });
    const quickRow = (await briefStore.load(quick))!;
    expect(quickRow.status).toBe("generating");
    expect((quickRow as { title?: string }).title ?? (await briefStore.listForOwner(ownerId)).find((r) => r.id === quick)?.title).toBe("Founding of Singapore, 1819");
    expect(quickRow.state).toBeNull();
    expect((await store.list(quick)).map((r) => r.name)).toEqual(["sources", "skeleton", "details", "endings", "reveal", "check", "save"]);

    const standard = await briefingAtConfirm(harness, "standard");
    expect(await startFromBrief(deps, jobs, briefStore, ownerId, standard, env)).toEqual({ ok: true });
    expect((await store.list(standard)).map((r) => r.name)).toEqual(["sources", "skeleton"]);
  });
});

describe("restartGeneration", () => {
  it("copies the uploads and reopens the old brief at confirm", async () => {
    const harness = await makeJob({ skeleton: vi.fn(async () => ({ ok: false, skeleton: undefined, issues: [{ code: "e", path: "x", message: "no" }], warnings: [], metrics: { calls: [], totalCostUsd: 0 } })) as never });
    const { deps, jobs, briefStore, sources, store } = harness;
    const { adventureId } = await start(harness, "quick", { timerMinutes: null });
    await jobs.drain({ jobId: adventureId });

    const result = await restartGeneration(deps, briefStore, store, ownerId, adventureId, env);
    if (!("adventureId" in result)) throw new Error(`restart failed: ${result.error}`);

    const row = (await briefStore.load(result.adventureId))!;
    expect(row.status).toBe("briefing");
    expect(row.state?.draft.timerMinutes).toBeNull();
    // uploads carried over (the outside doc the sources pass saved comes too — idempotent)
    expect((await sources.load(result.adventureId)).map((d) => d.id)).toEqual(["handout", "outside-1"]);
    // the old brief is at the confirm slot
    expect(row.state?.draft.episode).toBe("Founding of Singapore, 1819");
    expect(row.state?.draft.mode).toBe("quick");
    expect(row.state?.sources.map((s) => s.id)).toEqual(["handout", "outside-1"]);
    expect(row.state?.messages.at(-1)?.slot).toBe("confirm");
  });
});

describe("findUntouched", () => {
  it("returns the owner's most recent briefing row with 0 sources and no user messages", async () => {
    const { briefStore } = await makeJob();
    const first = await briefStore.create({ schoolId, ownerId });
    const second = await briefStore.create({ schoolId, ownerId });
    expect(await briefStore.findUntouched(ownerId)).toBe(second);

    // a user message or a source makes a row "touched"
    const secondRow = (await briefStore.load(second))!;
    await briefStore.save(second, {
      ...secondRow.state!,
      messages: [...secondRow.state!.messages, { role: "user", text: "hi", slot: "sources" }],
    });
    expect(await briefStore.findUntouched(ownerId)).toBe(first);

    const firstRow = (await briefStore.load(first))!;
    await briefStore.save(first, { ...firstRow.state!, sources: [{ id: "s", title: "s", kind: "text" }] });
    expect(await briefStore.findUntouched(ownerId)).toBeNull();

    // non-briefing rows and other owners don't count
    expect(await briefStore.findUntouched("someone-else")).toBeNull();
  });
});

describe("labels and cost visibility", () => {
  it("maps every pass name to a label and row statuses to display statuses", () => {
    expect(PASS_ORDER.map((name) => PASS_LABELS[name])).toEqual([
      "Sources",
      "Skeleton",
      "Stage details and personas",
      "Endings",
      "Reveal",
      "Checks",
      "Saving",
    ]);
    expect(stepDisplayStatus(undefined)).toBe("waiting");
    expect(stepDisplayStatus("pending")).toBe("waiting");
    expect(stepDisplayStatus("ready")).toBe("waiting");
    expect(stepDisplayStatus("running")).toBe("running");
    expect(stepDisplayStatus("succeeded")).toBe("done");
    expect(stepDisplayStatus("failed")).toBe("failed");
  });

  it("viewerSeesCost is true only for school admins and sysadmins", () => {
    const teacher = { membership: { role: "teacher" }, isSysadmin: false };
    const admin = { membership: { role: "admin" }, isSysadmin: false };
    const sysadmin = { membership: { role: "teacher" }, isSysadmin: true };
    expect(viewerSeesCost(teacher as never)).toBe(false);
    expect(viewerSeesCost(admin as never)).toBe(true);
    expect(viewerSeesCost(sysadmin as never)).toBe(true);
  });
});

describe("skeleton drafts", () => {
  it("save/discard guards: non-owner, wrong status and oversize all error", async () => {
    const harness = await makeJob();
    const { deps, adventures } = harness;
    const { adventureId } = await start(harness, "standard");
    await harness.jobs.drain({ jobId: adventureId }); // now needs_review

    expect(await saveSkeletonDraft(deps, "someone-else", adventureId, { x: 1 }, env)).toMatchObject({ error: "not_found" });
    expect(await saveSkeletonDraft(deps, ownerId, adventureId, { x: 1 }, { V3_ENABLED: "1", V3_SCHOOL_IDS: "other" } as NodeJS.ProcessEnv)).toMatchObject({ error: "not_found" });
    const huge = { pad: "x".repeat(513 * 1024) };
    expect(await saveSkeletonDraft(deps, ownerId, adventureId, huge, env)).toMatchObject({ error: expect.any(String) });
    expect(await saveSkeletonDraft(deps, ownerId, adventureId, { title: "T" }, env)).toEqual({ ok: true });
    expect(await deps.adventures.loadSkeletonDraft(adventureId)).toEqual({ title: "T" });

    // a generating row rejects saves
    const { adventureId: generating } = await start(harness, "quick");
    expect(await saveSkeletonDraft(deps, ownerId, generating, { x: 1 }, env)).toMatchObject({ error: expect.any(String) });
    void adventures;
  });

  it("a saved draft is returned by progress, and approve clears it", async () => {
    const harness = await makeJob();
    const { deps, jobs, adventures, store } = harness;
    const { adventureId } = await start(harness, "standard");
    await jobs.drain({ jobId: adventureId });

    const edited = { ...skeleton, title: "Teacher's edit" };
    await saveSkeletonDraft(deps, ownerId, adventureId, edited, env);
    const progress = await getGenerationProgress(deps, jobs, store, (await adventures.get(adventureId))!);
    expect(progress.hasDraft).toBe(true);
    expect((progress.skeleton as SkeletonShape).title).toBe("Teacher's edit");

    expect(await approveSkeleton(deps, jobs, store, ownerId, adventureId, edited, env)).toEqual({ ok: true });
    expect(await deps.adventures.loadSkeletonDraft(adventureId)).toBeNull();
  });

  it("approve with a quote not in the cited source returns issues and enqueues nothing", async () => {
    const harness = await makeJob();
    const { deps, jobs, adventures, store, passes } = harness;
    const { adventureId } = await start(harness, "standard");
    await jobs.drain({ jobId: adventureId });

    const edited = structuredClone(skeleton);
    edited.discoveries[0]!.citations = [{ sourceId: "handout", quote: "words never written" }];
    const result = await approveSkeleton(deps, jobs, store, ownerId, adventureId, edited, env);
    expect(result).toMatchObject({ error: "invalid skeleton" });
    expect((result as { issues: { code: string }[] }).issues[0]!.code).toBe("quote-not-in-source");
    expect((await adventures.get(adventureId))!.status).toBe("needs_review");
    await jobs.drain({ jobId: adventureId });
    expect(passes.details).not.toHaveBeenCalled();
  });
});


describe("guided pauses", () => {
  beforeEach(() => { vi.stubEnv("V3_ENABLED", "1"); vi.stubEnv("V3_SCHOOL_IDS", schoolId); });
  async function atDetails() {
    const harness = await makeJob();
    const { adventureId } = await start(harness, "guided");
    await harness.jobs.drain({ jobId: adventureId });
    await continueFromSources(harness.deps, harness.jobs, harness.store, ownerId, adventureId, [], env);
    await harness.jobs.drain({ jobId: adventureId });
    expect(await approveSkeleton(harness.deps, harness.jobs, harness.store, ownerId, adventureId, undefined, env)).toEqual({ ok: true });
    expect((await harness.store.list(adventureId)).map(row => row.name)).toEqual(["sources", "skeleton", "details"]);
    await harness.jobs.drain({ jobId: adventureId });
    return { ...harness, adventureId };
  }
  it("enqueues one pass at a time, exposes source metadata and guards source removal", async () => {
    const h = await makeJob();
    const { adventureId: id } = await start(h, "guided");
    expect((await h.store.list(id)).map(row => row.name)).toEqual(["sources"]);
    await h.jobs.drain({ jobId: id });
    const adventure = (await h.adventures.get(id))!;
    expect(adventure.status).toBe("needs_review");
    expect(await loadPause(h.deps, h.store, adventure)).toMatchObject({ pass: "sources", index: 1, uploads: [{ id: "handout", title: "handout" }], outside: [{ id: "outside-1", title: outsideDoc.title, url: outsideSource.url }], rejected: [] });
    expect(await getGenerationProgress(h.deps, h.jobs, h.store, adventure)).toMatchObject({ mode: "guided", pausedAt: "sources" });
    for (const ids of [["handout"], ["unknown"]]) expect(await continueFromSources(h.deps, h.jobs, h.store, ownerId, id, ids, env)).toHaveProperty("error");
    expect(await continueFromSources(h.deps, h.jobs, h.store, "outsider", id, [], env)).toHaveProperty("error");
    expect(await continueFromSources(h.deps, h.jobs, h.store, ownerId, id, [outsideDoc.id], env)).toEqual({ ok: true });
    expect((await h.sources.load(id)).map(doc => doc.id)).toEqual([uploadDoc.id]);
    await h.jobs.drain({ jobId: id });
    expect(pausedPass(await h.store.list(id))).toBe("skeleton");
    expect(await loadPause(h.deps, h.store, (await h.adventures.get(id))!)).toEqual({ pass: "skeleton", index: 2 });
  });
  it("refuses removing the last source", async () => {
    const h = await makeJob();
    const { adventureId: id } = await start(h, "guided");
    await h.jobs.drain({ jobId: id });
    h.sources.rows.set(id, h.sources.rows.get(id)!.filter(row => row.outside));
    expect(await continueFromSources(h.deps, h.jobs, h.store, ownerId, id, [outsideDoc.id], env)).toEqual({ error: "Keep at least one source." });
  });
  it("validates before saving or continuing and forwards changesets into the next pass", async () => {
    const h = await atDetails(); const id = h.adventureId;
    const write = vi.spyOn(h.adventures, "savePauseDraft");
    const invalid = [{ type: "set", path: ["definingMoments", 0, "nudge"], value: "" }];
    expect(await savePauseEdits(h.deps, h.store, ownerId, id, "details", invalid, env)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: "empty-field" })]) });
    expect(await continuePause(h.deps, h.jobs, h.store, ownerId, id, "details", invalid, env)).toMatchObject({ error: "invalid edits" });
    expect(write).not.toHaveBeenCalled();
    expect((await h.store.list(id)).map(row => row.name)).not.toContain("endings");
    const edits = [{ type: "set", path: ["stages", 0, "title"], value: "Teacher's stage" }];
    expect(await savePauseEdits(h.deps, h.store, ownerId, id, "details", edits, env)).toMatchObject({ ok: true });
    expect(await loadPause(h.deps, h.store, (await h.adventures.get(id))!)).toMatchObject({ pass: "details", edits });
    expect(await continuePause(h.deps, h.jobs, h.store, ownerId, id, "endings", [], env)).toHaveProperty("error");
    expect(await continuePause(h.deps, h.jobs, h.store, ownerId, id, "details", edits, env)).toEqual({ ok: true });
    expect(await h.adventures.loadPauseDraft(id)).toBeNull();
    const row = (await h.store.list(id)).find(row => row.name === "endings")!;
    expect(row.input).toMatchObject({ teacherEdits: { details: edits } });
    await h.jobs.drain({ jobId: id });
    expect(h.passes.endings.mock.calls[0][0].draft.stages[0].title).toBe("Teacher's stage");
    expect(pausedPass(await h.store.list(id))).toBe("endings");
  });
  it("runs the complete offline guided flow with edits at every spec pause", async () => {
    const h = await makeJob(fakeGenerationPasses({ V3_FAKE_PASSES: "1", NODE_ENV: "test" })!);
    const { adventureId: id } = await start(h, "guided");
    const seen: string[] = [];
    await h.jobs.drain({ jobId: id }); seen.push(pausedPass(await h.store.list(id))!);
    expect(await continueFromSources(h.deps, h.jobs, h.store, ownerId, id, [], env)).toEqual({ ok: true });
    await h.jobs.drain({ jobId: id }); seen.push(pausedPass(await h.store.list(id))!);
    expect(await approveSkeleton(h.deps, h.jobs, h.store, ownerId, id, undefined, env)).toEqual({ ok: true });
    await h.jobs.drain({ jobId: id }); seen.push(pausedPass(await h.store.list(id))!);
    expect(await continuePause(h.deps, h.jobs, h.store, ownerId, id, "details", [{ type: "set", path: ["stages", 0, "title"], value: "Teacher's stage" }], env)).toEqual({ ok: true });
    await h.jobs.drain({ jobId: id }); seen.push(pausedPass(await h.store.list(id))!);
    expect(await continuePause(h.deps, h.jobs, h.store, ownerId, id, "endings", [{ type: "set", path: ["endings", 0, "interview", "question"], value: "Teacher's question?" }], env)).toEqual({ ok: true });
    await h.jobs.drain({ jobId: id }); seen.push(pausedPass(await h.store.list(id))!);
    expect(await continuePause(h.deps, h.jobs, h.store, ownerId, id, "reveal", [{ type: "set", path: ["reveal", "whatHappened"], value: "Teacher's reveal" }], env)).toEqual({ ok: true });
    expect((await h.jobs.drain({ jobId: id }))?.status).toBe("succeeded");
    expect(seen).toEqual(["sources", "skeleton", "details", "endings", "reveal"]);
    expect(h.adventures.rows.get(id)).toMatchObject({ row: { status: "draft" }, spec: { stages: [expect.objectContaining({ title: "Teacher's stage" }), expect.anything()], endings: expect.arrayContaining([expect.objectContaining({ interview: expect.objectContaining({ question: "Teacher's question?" }) })]), reveal: { whatHappened: "Teacher's reveal" } } });
  });
  it("rolls back the status and retains saved edits when enqueue fails", async () => {
    const h = await atDetails(); const id = h.adventureId;
    await savePauseEdits(h.deps, h.store, ownerId, id, "details", [], env);
    const jobs = { ...h.jobs, enqueue: vi.fn(async () => { throw Error("queue unavailable"); }) };
    expect(await continuePause(h.deps, jobs, h.store, ownerId, id, "details", [], env)).toEqual({ error: "queue unavailable" });
    expect((await h.adventures.get(id))!.status).toBe("needs_review");
    expect(await h.adventures.loadPauseDraft(id)).toEqual({ pass: "details", edits: [] });
  });
  it("preserves edits through repair, freezes their owning parts and keeps the edited spec if replay throws", async () => {
    for (const replayFails of [false, true]) {
      const h = await atDetails(); const id = h.adventureId;
      const edits = [{ type: "set", path: ["stages", 0, "title"], value: "Teacher's stage" }];
      // Force repair with a part-local obligation; no live LLM is used.
      const details = (await h.store.outputs(id, ["details"])).details as unknown as { parts: unknown };
      details.parts = { [`stage:${spec.stages[0].id}`]: { output: {}, issues: [{ code: "test", path: "stages.0", message: "Retained obligation" }] } };
      h.passes.endings.mockImplementation(async input => ({ ok: true, spec: input.draft, parts: {}, warnings: [], metrics: { calls: [], totalCostUsd: 0 } }) as never);
      h.passes.reveal.mockImplementation(async input => ({ ok: true, spec: input.draft, parts: {}, warnings: [], metrics: { calls: [], totalCostUsd: 0 } }) as never);
      h.passes.check.mockImplementation(async input => ({ spec: replayFails ? { ...spec, stages: [] } : spec, parts: input.parts, errors: [], unresolved: [], partErrors: [], repaired: [], metrics: { calls: [], totalCostUsd: 0 } }) as never);
      await continuePause(h.deps, h.jobs, h.store, ownerId, id, "details", edits, env);
      await h.jobs.drain({ jobId: id });
      await continuePause(h.deps, h.jobs, h.store, ownerId, id, "endings", [], env);
      await h.jobs.drain({ jobId: id });
      await continuePause(h.deps, h.jobs, h.store, ownerId, id, "reveal", [], env);
      await h.jobs.drain({ jobId: id });
      expect(h.passes.check).toHaveBeenCalledOnce();
      expect(h.passes.check.mock.calls[0][0]).toMatchObject({ frozen: [`stage:${spec.stages[0].id}`] });
      expect(h.adventures.rows.get(id)?.spec?.stages[0].title).toBe("Teacher's stage");
      expect((await h.adventures.get(id))!.status).toBe("draft");
    }
  });
});
