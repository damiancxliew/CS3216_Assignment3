/**
 * Orchestration for the v3 generation job: start (quick = all six steps, standard =
 * sources + skeleton, then teacher review), approve the skeleton, and read progress.
 * No Next imports — deps and the flag env are injected.
 */
import { checkSkeleton, validateSkeleton } from "@adventure/spec-v3";
import type { CheckIssue, SkeletonShape } from "@adventure/spec-v3";
import type { createJobs, EnqueueStep, JobStep, Json } from "@adventure/jobs";

import { v3SchoolAllowed } from "@/lib/v3/flag";

import type { GenerationDeps, V3AdventureRow } from "./deps";
import type { GenerationBrief, GenerationMode } from "./types";

type Jobs = Pick<ReturnType<typeof createJobs>, "enqueue" | "getProgress">;
/** raw step rows — needed for the stored brief (skeleton input) and step outputs. */
type Store = { list(jobId: string): Promise<JobStep[]>; outputs(jobId: string, names: string[]): Promise<Record<string, Json>> };

export interface StartForm {
  episode: string;
  teacherNotes?: string;
  readingLevel: "sec" | "jc";
  mode: GenerationMode;
  uploads: { doc: Parameters<GenerationDeps["sources"]["saveUploads"]>[1][number]["doc"]; storageKey: string }[];
}

export interface StartContext {
  userId: string;
  schoolId: string;
  /** inserts the adventures_v3 row (status defaults to `generating`) and returns its id */
  createAdventure: () => Promise<string>;
}

const STEP_INPUT = (brief: GenerationBrief): Json => brief as unknown as Json;

export async function startGeneration(
  deps: GenerationDeps,
  jobs: Jobs,
  ctx: StartContext,
  form: StartForm,
  env: NodeJS.ProcessEnv,
): Promise<{ adventureId: string } | { error: string }> {
  if (!v3SchoolAllowed(ctx.schoolId, env)) return { error: "v3 generation is not enabled for this school" };
  if (form.episode.trim() === "") return { error: "An episode is required" };
  if (form.uploads.length === 0) return { error: "Upload at least one source" };

  const adventureId = await ctx.createAdventure();
  try {
    await deps.sources.saveUploads(adventureId, form.uploads);

    const brief: GenerationBrief = {
      adventureId,
      schoolId: ctx.schoolId,
      ownerId: ctx.userId,
      episode: form.episode,
      ...(form.teacherNotes !== undefined ? { teacherNotes: form.teacherNotes } : {}),
      readingLevel: form.readingLevel,
      mode: form.mode,
    };

    // quick: all six steps; standard: sources + skeleton, then the teacher reviews
    const names = form.mode === "quick" ? ["sources", "skeleton", "details", "endings", "reveal", "save"] : ["sources", "skeleton"];
    const depsOf: Record<string, string[]> = {
      skeleton: ["sources"],
      details: ["skeleton"],
      endings: ["details"],
      reveal: ["details", "endings"],
      save: ["reveal"],
    };
    const steps: EnqueueStep[] = names.map((name) => ({
      name,
      step: `v3.gen.${name}`,
      input: name === "details" ? ({ brief } as unknown as Json) : STEP_INPUT(brief),
    }));
    await jobs.enqueue(adventureId, steps, depsOf);
  } catch (error) {
    // don't leave the row generating forever — the timer would never see a step
    console.error("v3 generation start failed after creating the adventure", error);
    await deps.adventures.setStatus(adventureId, "failed", ["generating"]);
    return { error: "Couldn't start generation. Please try again." };
  }
  return { adventureId };
}

export async function approveSkeleton(
  deps: GenerationDeps,
  jobs: Jobs,
  store: Store,
  userId: string,
  adventureId: string,
  editedSkeleton: unknown | undefined,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true } | { error: string; issues?: CheckIssue[] }> {
  const adventure = await deps.adventures.get(adventureId);
  if (adventure === null || adventure.ownerId !== userId) return { error: "not_found" };
  if (!v3SchoolAllowed(adventure.schoolId, env)) return { error: "not_found" };
  if (adventure.status === "generating") return { error: "already approved" };
  if (adventure.status !== "needs_review") return { error: "not awaiting review" };

  let edited: SkeletonShape | undefined;
  if (editedSkeleton !== undefined) {
    const validated = validateSkeleton(editedSkeleton);
    if (!validated.ok) return { error: "invalid skeleton", issues: validated.issues.map((i) => ({ code: "schema", path: i.path, message: i.message })) };
    const check = checkSkeleton(validated.spec);
    if (check.errors.length > 0) return { error: "invalid skeleton", issues: check.errors };
    edited = validated.spec;
  }

  // rebuild the brief from the skeleton step's stored input
  const skeletonRow = (await store.list(adventureId)).find((row) => row.name === "skeleton");
  const brief = skeletonRow?.input as GenerationBrief | null;
  if (brief === null || brief === undefined) return { error: "generation brief not found" };

  // guards double clicks: enqueue_job_steps raises on a duplicate step name anyway
  if (!(await deps.adventures.setStatus(adventureId, "generating", ["needs_review"]))) return { error: "already approved" };

  try {
    await jobs.enqueue(
      adventureId,
      [
        { name: "details", step: "v3.gen.details", input: { brief, ...(edited !== undefined ? { skeleton: edited } : {}) } as unknown as Json },
        { name: "endings", step: "v3.gen.endings", input: STEP_INPUT(brief) },
        { name: "reveal", step: "v3.gen.reveal", input: STEP_INPUT(brief) },
        { name: "save", step: "v3.gen.save", input: STEP_INPUT(brief) },
      ],
      { details: ["skeleton"], endings: ["details"], reveal: ["details", "endings"], save: ["reveal"] },
    );
  } catch (error) {
    await deps.adventures.setStatus(adventureId, "needs_review", ["generating"]);
    return { error: error instanceof Error ? error.message : "could not queue generation" };
  }
  return { ok: true };
}

export interface GenerationProgress {
  status: V3AdventureRow["status"];
  steps: { name: string; status: string; attempts: number; error: string | null }[];
  costUsd: number;
  warnings: (CheckIssue & { pass: string })[];
  skeleton?: unknown;
}

/** The caller has already done the access check on `adventure`. */
export async function getGenerationProgress(
  deps: GenerationDeps,
  jobs: Jobs,
  store: Store,
  adventure: V3AdventureRow,
): Promise<GenerationProgress> {
  const progress = await jobs.getProgress(adventure.id);
  const outputs = await store.outputs(adventure.id, ["sources", "skeleton", "details", "endings", "reveal", "save"]);
  const costUsd = Object.values(outputs).reduce((sum: number, output) => sum + (((output ?? null) as { costUsd?: number | null } | null)?.costUsd ?? 0), 0);
  const warnings: (CheckIssue & { pass: string })[] = [];
  for (const pass of ["details", "endings", "reveal"] as const) {
    const output = outputs[pass] as { warnings?: CheckIssue[] } | undefined;
    for (const warning of output?.warnings ?? []) warnings.push({ ...warning, pass });
  }
  return {
    status: adventure.status,
    steps: (progress?.steps ?? []).map((s) => ({ name: s.name, status: s.status, attempts: s.attempts, error: s.error })),
    costUsd,
    warnings,
    ...(adventure.status === "needs_review" && outputs.skeleton !== undefined ? { skeleton: (outputs.skeleton as { skeleton: unknown }).skeleton } : {}),
  };
}
