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

import { pathOwner } from "@adventure/generation/v3";
import { applyTeacherEdits, capturedSources } from "@/lib/v3/edit/apply";
import type { V3Edit } from "@/lib/v3/edit/commands";

import type { GenerationDeps } from "./deps";
import type { GenerationBrief } from "./types";

export type TeacherEdits = Partial<Record<"details" | "endings" | "reveal", V3Edit[]>>;
const editsOf = (input: Json) => (input as unknown as { teacherEdits?: TeacherEdits })?.teacherEdits ?? {};
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
      const input = ctx.input as unknown as GenerationBrief | { brief: GenerationBrief };
      const brief = "brief" in input ? input.brief : input;

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
    guarded(2, async (ctx, deps, brief) => {
      const result = await deps.passes.sources(
        {
          episode: brief.episode,
          ...(brief.teacherNotes !== undefined ? { teacherNotes: brief.teacherNotes } : {}),
          ...(brief.sourcePolicy ? { policy: brief.sourcePolicy } : {}),
        },
        { search: deps.search(brief), signal: ctx.signal },
      );
      await deps.sources.saveOutside(brief.adventureId, result.sources, result.documents);
      await deps.recordSearchUsage(brief, result.usage, null);
      await deps.recordSourceOutcome?.(brief, result);
      if (brief.mode === "guided") await deps.adventures.setStatus(brief.adventureId, "needs_review", ["generating"]);
      return {
        outsideSourceIds: result.sources.map((s) => s.id),
        rejected: result.rejected,
        diagnostics: result.diagnostics ?? [],
        summary: result.summary ?? null,
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
      if (brief.mode === "standard" || brief.mode === "guided") await deps.adventures.setStatus(brief.adventureId, "needs_review", ["generating"]);
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
      if (brief.mode === "guided") await deps.adventures.setStatus(brief.adventureId, "needs_review", ["generating"]);
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
      const draft = applyTeacherEdits((ctx.outputs.details as { draft: AdventureSpec }).draft, editsOf(ctx.input).details ?? [], capturedSources(documents));
      const result = await deps.passes.endings(
        { draft, documents, readingLevel: brief.readingLevel },
        { llm: deps.llm(brief), budgetMs: PASS_BUDGET_MS },
      );
      if (result.spec === undefined) throw asError("endings pass", result.issues);
      if (brief.mode === "guided") await deps.adventures.setStatus(brief.adventureId, "needs_review", ["generating"]);
      return { spec: result.spec, parts: result.parts ?? {}, warnings: result.warnings, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const revealStep = defineStep<Json, Json>(
    "v3.gen.reveal",
    guarded(2, async (ctx, deps, brief) => {
      const documents = await deps.sources.load(brief.adventureId);
      const spec = applyTeacherEdits((ctx.outputs.endings as { spec: AdventureSpec }).spec, editsOf(ctx.input).endings ?? [], capturedSources(documents));
      const slantedDocuments = (ctx.outputs.details as { slantedDocuments: { stageId: string; documentId: string; note: string }[] }).slantedDocuments;
      const result = await deps.passes.reveal(
        { draft: spec, sources: documents, slantedDocuments, readingLevel: brief.readingLevel },
        { llm: deps.llm(brief), budgetMs: PASS_BUDGET_MS },
      );
      if (result.spec === undefined) throw asError("reveal pass", result.issues);
      if (brief.mode === "guided") await deps.adventures.setStatus(brief.adventureId, "needs_review", ["generating"]);
      return { spec: result.spec, parts: result.parts ?? {}, warnings: result.warnings, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const checkStep = defineStep<Json, Json>(
    "v3.gen.check",
    guarded(2, async (ctx, deps, brief) => {
      const reveal = ctx.outputs.reveal as unknown as { spec: AdventureSpec; parts?: Parts };
      const details = ctx.outputs.details as unknown as { draft: AdventureSpec; skeleton?: SkeletonShape; parts?: Parts };
      const endings = ctx.outputs.endings as unknown as { spec: AdventureSpec; parts?: Parts };
      const documents = await deps.sources.load(brief.adventureId);
      const sources = capturedSources(documents);
      const teacherEdits = editsOf(ctx.input);
      const edited = applyTeacherEdits(reveal.spec, teacherEdits.reveal ?? [], sources);
      const errors = specErrors(edited);
      // outputs from before parts were saved have nothing to redo
      const parts = details.parts !== undefined ? { ...details.parts, ...endings.parts, ...reveal.parts } : undefined;
      const partErrors = Object.entries(parts ?? {}).flatMap(([part, record]) => record.issues.map((issue) => ({ part, issue })));
      const teacherEdited = [...new Set((["details", "endings", "reveal"] as const).flatMap(pass => {
        const spec = pass === "details" ? details.draft : pass === "endings" ? endings.spec : reveal.spec;
        if (!details.skeleton || !spec || !parts) return [];
        return (teacherEdits[pass] ?? []).map(edit => {
          const path = "path" in edit ? edit.path.join(".") : "documentId" in edit ? `documents.${spec.documents.findIndex(d => d.id === edit.documentId)}` : "authoring.sourcePolicy";
          return pathOwner(path, { skeleton: details.skeleton!, spec, parts });
        }).filter((part): part is string => part !== null);
      }))];
      const asIs = { spec: edited, errors, partErrors, teacherEdited, repaired: [], costUsd: 0 };
      if ((errors.length === 0 && partErrors.length === 0) || parts === undefined || Object.keys(parts).length === 0 || details.skeleton === undefined) return asIs as unknown as Json;
      const result = await deps.passes.check(
        {
          skeleton: details.skeleton,
          documents,
          readingLevel: brief.readingLevel,
          ...(brief.timerMinutes !== undefined ? { timerMinutes: brief.timerMinutes } : {}),
          parts,
          frozen: teacherEdited,
        },
        { llm: deps.llm(brief) },
      );
      let final = result.spec;
      try {
        for (const pass of ["details", "endings", "reveal"] as const) final = applyTeacherEdits(final, teacherEdits[pass] ?? [], sources);
      } catch (error) {
        console.error("Could not replay teacher edits after repair", error);
        return { ...asIs, costUsd: result.metrics.totalCostUsd } as unknown as Json;
      }
      const finalErrors = brief.mode === "guided" ? specErrors(final) : result.errors;
      // A repair that leaves more errors than it found is dropped.
      const kept = finalErrors.length + result.partErrors.length <= errors.length + partErrors.length
        ? { spec: final, errors: finalErrors, partErrors: result.partErrors }
        : { spec: edited, errors, partErrors };
      return { ...kept, teacherEdited, repaired: result.repaired, costUsd: result.metrics.totalCostUsd } as unknown as Json;
    }),
    { maxAttempts: 2 },
  );

  const saveStep = defineStep<Json, Json>(
    "v3.gen.save",
    guarded(3, async (ctx, deps, brief) => {
      // jobs queued before the check step existed save the reveal spec
      const spec = ((ctx.outputs.check ?? ctx.outputs.reveal) as unknown as { spec: AdventureSpec }).spec;
      const sourcePolicy = brief.sourcePolicy;
      const specForValidation =
        sourcePolicy && (sourcePolicy.allowAny || sourcePolicy.extraDomains.length > 0)
          ? { ...spec, authoring: { ...(spec.authoring ?? {}), sourcePolicy } }
          : spec;
      // Fake-pass outside sources use example.invalid URLs, so leave default policy unset.
      const validated = validateSpec(specForValidation);
      if (!validated.ok) throw asError("final spec", validated.issues);
      // New adventures start neutral; image jobs only create explicit candidates.
      (validated.spec.authoring ??= {}).stageImages = Object.fromEntries(validated.spec.stages.map(stage => [stage.id, { type: "fallback" as const }]));
      const version = await deps.adventures.saveSpec(brief.adventureId, validated.spec);
      await deps.adventures.setStatus(brief.adventureId, "draft", ["generating"]);
      try {
        await deps.queuePortraits(brief.adventureId, version);
      } catch (error) {
        console.error("Failed to queue v3 portraits", error);
      }
      return { version };
    }),
    { maxAttempts: 3 },
  );

  return [sourcesStep, skeletonStep, detailsStep, endingsStep, revealStep, checkStep, saveStep];
}
