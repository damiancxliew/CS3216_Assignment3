/**
 * The v3 generation pipeline as job steps on Damian's runner: sources → skeleton →
 * (teacher review in standard mode) → details → endings → reveal → check → save.
 * Leftover check errors don't fail a pass: `check` redoes the blamed parts once, and save
 * lands whatever is left as a draft (publish refuses a spec with errors). Each step
 * loads documents from the source store, so document text never lands in step
 * outputs. On the last attempt a thrown error also marks the adventure failed.
 */
import { checkSpec, validateSkeleton, validateSpec } from "@adventure/spec-v3";
import type { AdventureSpec, CheckIssue, SkeletonShape } from "@adventure/spec-v3";
import type { Json, StepContext, StepDefinition } from "@adventure/jobs";
import { defineStep } from "@adventure/jobs";

import { v3SchoolAllowed } from "@/lib/v3/flag";

import type { GenerationDeps } from "./deps";
import type { GenerationBrief } from "./types";

const PASS_BUDGET_MS = 240_000;

/** Job row names (the `name` of the enqueued step); definitions are `v3.gen.*`. */
export const V3_GENERATION_STEP_NAMES = ["sources", "skeleton", "details", "endings", "reveal", "check", "save"] as const;

function asError(prefix: string, issues: { code?: string; path: string; message: string }[]): Error {
  const list = issues.slice(0, 5).map((issue) => `${issue.code ?? "invalid"}: ${issue.message}`).join("; ");
  return new Error(`${prefix} failed — ${list}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`);
}

function specErrors(spec: AdventureSpec): CheckIssue[] {
  const validated = validateSpec(spec);
  return validated.ok ? checkSpec(validated.spec).errors : validated.issues.map((i) => ({ code: "schema", path: i.path, message: i.message }));
}

type Parts = Parameters<GenerationDeps["passes"]["check"]>[0]["parts"];

export function v3GenerationSteps(getDeps: () => GenerationDeps): StepDefinition<Json, Json>[] {
  /** wrap a run body: check the school flag, then mark the adventure failed on a last-attempt throw. */
  const guarded = <I extends Json, O extends Json>(maxAttempts: number, body: (ctx: StepContext<I>, deps: GenerationDeps, brief: GenerationBrief) => Promise<O>) =>
    async (ctx: StepContext<I>): Promise<O> => {
      const deps = getDeps();
      const brief = (ctx.name === "details" ? (ctx.input as unknown as { brief: GenerationBrief }).brief : (ctx.input as unknown as GenerationBrief));
      if (!v3SchoolAllowed(brief.schoolId)) throw new Error(`v3 generation is not enabled for school ${brief.schoolId}`);
      try {
        return await body(ctx, deps, brief);
      } catch (error) {
        if (ctx.attempt >= maxAttempts) {
          try {
            await deps.adventures.setStatus(brief.adventureId, "failed", ["generating", "needs_review"]);
          } catch {
            // best-effort status flip; the original error is what matters
          }
        }
        throw error;
      }
    };

  const sourcesStep = defineStep<Json, Json>(
    "v3.gen.sources",
    guarded(2, async (_ctx, deps, brief) => {
      const result = await deps.passes.sources(
        { episode: brief.episode, ...(brief.teacherNotes !== undefined ? { teacherNotes: brief.teacherNotes } : {}) },
        { search: deps.search(brief) },
      );
      await deps.sources.saveOutside(brief.adventureId, result.sources, result.documents);
      await deps.recordSearchUsage(brief, result.usage, null);
      return {
        outsideSourceIds: result.sources.map((s) => s.id),
        rejected: result.rejected,
        costUsd: result.costUsd,
      } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const skeletonStep = defineStep<Json, Json>(
    "v3.gen.skeleton",
    guarded(2, async (_ctx, deps, brief) => {
      const documents = await deps.sources.load(brief.adventureId);
      const result = await deps.passes.skeleton(
        { episode: brief.episode, ...(brief.teacherNotes !== undefined ? { teacherNotes: brief.teacherNotes } : {}), readingLevel: brief.readingLevel, documents },
        { llm: deps.llm(brief), budgetMs: PASS_BUDGET_MS },
      );
      if (!result.ok || result.skeleton === undefined) throw asError("skeleton pass", result.issues);
      if (brief.mode === "standard") await deps.adventures.setStatus(brief.adventureId, "needs_review", ["generating"]);
      return { skeleton: result.skeleton, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const detailsStep = defineStep<Json, Json>(
    "v3.gen.details",
    guarded(2, async (ctx, deps, brief) => {
      const documents = await deps.sources.load(brief.adventureId);
      const raw = (ctx.input as { skeleton?: unknown } | null)?.skeleton ?? (ctx.outputs.skeleton as { skeleton: unknown } | undefined)?.skeleton;
      const validated = validateSkeleton(raw);
      if (!validated.ok) throw asError("skeleton input", validated.issues);
      const result = await deps.passes.details(
        {
          skeleton: validated.spec,
          documents,
          readingLevel: brief.readingLevel,
          ...(brief.timerMinutes !== undefined ? { timerMinutes: brief.timerMinutes } : {}),
        },
        { llm: deps.llm(brief) },
      );
      if (result.draft === undefined) throw asError("details pass", result.issues);
      return {
        draft: result.draft,
        skeleton: validated.spec,
        parts: result.parts ?? {},
        slantedDocuments: result.slantedDocuments,
        mergedDuplicates: result.mergedDuplicates,
        warnings: result.warnings,
        costUsd: result.metrics.totalCostUsd,
      } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const endingsStep = defineStep<Json, Json>(
    "v3.gen.endings",
    guarded(2, async (ctx, deps, brief) => {
      const documents = await deps.sources.load(brief.adventureId);
      const draft = (ctx.outputs.details as { draft: AdventureSpec }).draft;
      const result = await deps.passes.endings(
        { draft, documents, readingLevel: brief.readingLevel },
        { llm: deps.llm(brief), budgetMs: PASS_BUDGET_MS },
      );
      if (result.spec === undefined) throw asError("endings pass", result.issues);
      return { spec: result.spec, parts: result.parts ?? {}, warnings: result.warnings, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const revealStep = defineStep<Json, Json>(
    "v3.gen.reveal",
    guarded(2, async (ctx, deps, brief) => {
      const documents = await deps.sources.load(brief.adventureId);
      const spec = (ctx.outputs.endings as { spec: AdventureSpec }).spec;
      const slantedDocuments = (ctx.outputs.details as { slantedDocuments: { stageId: string; documentId: string; note: string }[] }).slantedDocuments;
      const result = await deps.passes.reveal(
        { draft: spec, sources: documents, slantedDocuments, readingLevel: brief.readingLevel },
        { llm: deps.llm(brief), budgetMs: PASS_BUDGET_MS },
      );
      if (result.spec === undefined) throw asError("reveal pass", result.issues);
      return { spec: result.spec, parts: result.parts ?? {}, warnings: result.warnings, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const checkStep = defineStep<Json, Json>(
    "v3.gen.check",
    guarded(2, async (ctx, deps, brief) => {
      const reveal = ctx.outputs.reveal as unknown as { spec: AdventureSpec; parts?: Parts };
      const details = ctx.outputs.details as unknown as { skeleton?: SkeletonShape; parts?: Parts };
      const endings = ctx.outputs.endings as unknown as { parts?: Parts };
      const errors = specErrors(reveal.spec);
      // outputs from before parts were saved have nothing to redo
      const parts = details.parts !== undefined ? { ...details.parts, ...endings.parts, ...reveal.parts } : undefined;
      const partErrors = Object.entries(parts ?? {}).flatMap(([part, record]) => record.issues.map((issue) => ({ part, issue })));
      const asIs = { spec: reveal.spec, errors, partErrors, repaired: [], costUsd: 0 };
      if ((errors.length === 0 && partErrors.length === 0) || parts === undefined || details.skeleton === undefined) return asIs as unknown as Json;
      const documents = await deps.sources.load(brief.adventureId);
      const result = await deps.passes.check(
        {
          skeleton: details.skeleton,
          documents,
          readingLevel: brief.readingLevel,
          ...(brief.timerMinutes !== undefined ? { timerMinutes: brief.timerMinutes } : {}),
          parts,
        },
        { llm: deps.llm(brief) },
      );
      // a repair that leaves more errors than it found is dropped
      const kept =
        result.errors.length + result.partErrors.length <= errors.length + partErrors.length
          ? { spec: result.spec, errors: result.errors, partErrors: result.partErrors }
          : { spec: reveal.spec, errors, partErrors };
      return { ...kept, repaired: result.repaired, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const saveStep = defineStep<Json, Json>(
    "v3.gen.save",
    guarded(3, async (ctx, deps, brief) => {
      // jobs queued before the check step existed save the reveal spec
      const spec = ((ctx.outputs.check ?? ctx.outputs.reveal) as unknown as { spec: AdventureSpec }).spec;
      const validated = validateSpec(spec);
      if (!validated.ok) throw asError("final spec", validated.issues);
      const version = await deps.adventures.saveSpec(brief.adventureId, validated.spec);
      await deps.adventures.setStatus(brief.adventureId, "draft", ["generating"]);
      try {
        await deps.queuePortraits(brief.adventureId, version);
      } catch (error) {
        console.error("Failed to queue v3 portraits", error);
      }
      try {
        await deps.queueStageArt(brief.adventureId, version);
      } catch (error) {
        console.error("Failed to queue v3 stage art", error);
      }
      return { version };
    }),
    { maxAttempts: 3 },
  );

  return [sourcesStep, skeletonStep, detailsStep, endingsStep, revealStep, checkStep, saveStep];
}
