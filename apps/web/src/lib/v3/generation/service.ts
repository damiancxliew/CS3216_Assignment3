/**
 * Orchestration for the v3 generation job: a confirmed brief enqueues the pass
 * steps (quick = all six, standard = sources + skeleton, then teacher review),
 * approve resumes a reviewed skeleton, and progress reads the step rows.
 * No Next imports — deps and the flag env are injected.
 */
import { checkSkeleton, validateSkeleton } from "@adventure/spec-v3";
import { quoteIssues, sourceTexts } from "@adventure/generation/v3";
import type { CheckIssue, SkeletonShape } from "@adventure/spec-v3";
import type { createJobs, EnqueueStep, JobStep, Json } from "@adventure/jobs";

import type { Viewer } from "@/lib/auth/viewer";
import { v3SchoolAllowed } from "@/lib/v3/flag";
import { completeDraft, type BriefStateV3 } from "@/lib/v3/brief/schema";
import type { V3BriefStore } from "@/lib/v3/brief/store";

import type { GenerationDeps, V3AdventureRow } from "./deps";
import type { GenerationBrief } from "./types";

type Jobs = Pick<ReturnType<typeof createJobs>, "enqueue" | "getProgress">;
/** raw step rows — needed for the stored brief (skeleton input) and step outputs. */
export type StepStore = { list(jobId: string): Promise<JobStep[]>; outputs(jobId: string, names: string[]): Promise<Record<string, Json>> };

const STEP_INPUT = (brief: GenerationBrief): Json => brief as unknown as Json;

const QUICK_STEPS = ["sources", "skeleton", "details", "endings", "reveal", "save"] as const;
const STANDARD_STEPS = ["sources", "skeleton"] as const;

const STEP_DEPS: Record<string, string[]> = {
  skeleton: ["sources"],
  details: ["skeleton"],
  endings: ["details"],
  reveal: ["details", "endings"],
  save: ["reveal"],
};

/** Enqueues the generation steps for a confirmed brief. The caller owns the row's status. */
export async function enqueueGeneration(jobs: Jobs, brief: GenerationBrief): Promise<void> {
  const names = brief.mode === "quick" ? QUICK_STEPS : STANDARD_STEPS;
  const steps: EnqueueStep[] = names.map((name) => ({
    name,
    step: `v3.gen.${name}`,
    input: name === "details" ? ({ brief } as unknown as Json) : STEP_INPUT(brief),
  }));
  await jobs.enqueue(brief.adventureId, steps, STEP_DEPS);
}

/** Rebuilds the stored brief from the skeleton (or sources) step's input. */
async function storedBrief(store: StepStore, adventureId: string): Promise<GenerationBrief | null> {
  const rows = await store.list(adventureId);
  const row = rows.find((r) => r.name === "skeleton") ?? rows.find((r) => r.name === "sources");
  return (row?.input as GenerationBrief | null) ?? null;
}

/**
 * Confirms a finished brief: the conditional briefing → generating transition
 * (a double click loses it and enqueues nothing), then the generation steps.
 * Title = the episode the teacher agreed.
 */
export async function startFromBrief(
  deps: GenerationDeps,
  jobs: Jobs,
  briefStore: V3BriefStore,
  userId: string,
  adventureId: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true } | { error: string }> {
  const row = await briefStore.load(adventureId);
  if (row === null || row.ownerId !== userId) return { error: "not_found" };
  if (!v3SchoolAllowed(row.schoolId, env)) return { error: "not_found" };
  if (row.status !== "briefing") return { error: "not awaiting confirmation" };

  const draft = row.state?.draft;
  if (!draft || !completeDraft(draft) || (row.state?.sources.length ?? 0) === 0) return { error: "The brief isn’t complete yet" };

  const brief: GenerationBrief = {
    adventureId,
    schoolId: row.schoolId,
    ownerId: userId,
    episode: draft.episode,
    ...(draft.focus !== "" ? { teacherNotes: draft.focus } : {}),
    readingLevel: draft.readingLevel,
    timerMinutes: draft.timerMinutes,
    mode: draft.mode,
  };

  if (!(await briefStore.startFromBrief(adventureId, draft.episode))) return { error: "already started" };

  try {
    await enqueueGeneration(jobs, brief);
  } catch (error) {
    // put the brief back so the teacher can retry the confirm
    if (row.state) await briefStore.save(adventureId, row.state).catch(() => {});
    await deps.adventures.setStatus(adventureId, "briefing", ["generating"]).catch(() => {});
    return { error: error instanceof Error ? error.message : "could not queue generation" };
  }
  return { ok: true };
}

/**
 * "Start again" on a failed adventure: a fresh briefing row with the uploads
 * copied over and the old brief reopened at the confirm slot, so the teacher
 * lands on the summary and can change anything before regenerating.
 */
export async function restartGeneration(
  deps: GenerationDeps,
  briefStore: V3BriefStore,
  store: StepStore,
  userId: string,
  adventureId: string,
  env: NodeJS.ProcessEnv,
): Promise<{ adventureId: string } | { error: string }> {
  const adventure = await deps.adventures.get(adventureId);
  if (adventure === null || adventure.ownerId !== userId) return { error: "not_found" };
  if (!v3SchoolAllowed(adventure.schoolId, env)) return { error: "not_found" };
  if (adventure.status !== "failed") return { error: "only a failed generation can be started again" };

  const oldBrief = await storedBrief(store, adventureId);
  const documents = await deps.sources.load(adventureId);

  const newId = await briefStore.create({ schoolId: adventure.schoolId, ownerId: userId });
  try {
    await deps.sources.copyUploads(adventureId, newId);
    const state: BriefStateV3 = {
      adventureId: newId,
      draft: {
        sources: {
          summary: "The sources carried over from the previous attempt.",
          episodeProposal: oldBrief?.episode ?? "",
        },
        episode: oldBrief?.episode ?? "",
        focus: oldBrief?.teacherNotes ?? "",
        readingLevel: oldBrief?.readingLevel ?? "sec",
        timerMinutes: oldBrief?.timerMinutes === undefined ? 45 : oldBrief.timerMinutes,
        mode: oldBrief?.mode ?? "quick",
      },
      messages: [
        {
          role: "assistant",
          text: "Here’s the brief from the failed attempt — the same sources are attached. Create the adventure again, or change anything first.",
          slot: "confirm",
        },
      ],
      sources: documents.map((doc) => ({ id: doc.id, title: doc.title, kind: doc.kind === "pdf" ? "pdf" : "text" })),
    };
    await briefStore.save(newId, state);
  } catch (error) {
    await briefStore.discard(newId).catch(() => {});
    console.error("could not restart v3 generation", adventureId, error);
    return { error: "Couldn’t restart generation. Please try again." };
  }
  return { adventureId: newId };
}

/** Cost is school-budget information: school admins and sysadmins only. */
/** A teacher's skeleton draft, stored raw — a semantically broken draft is expected mid-edit. */
const SKELETON_DRAFT_MAX_BYTES = 512 * 1024;

export async function saveSkeletonDraft(
  deps: GenerationDeps,
  userId: string,
  adventureId: string,
  draft: unknown,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true } | { error: string }> {
  const adventure = await deps.adventures.get(adventureId);
  if (adventure === null || adventure.ownerId !== userId) return { error: "not_found" };
  if (!v3SchoolAllowed(adventure.schoolId, env)) return { error: "not_found" };
  if (adventure.status !== "needs_review") return { error: "not awaiting review" };
  if (JSON.stringify(draft).length > SKELETON_DRAFT_MAX_BYTES) return { error: "The draft is too large to save" };
  await deps.adventures.saveSkeletonDraft(adventureId, draft);
  return { ok: true };
}

export async function discardSkeletonDraft(
  deps: GenerationDeps,
  userId: string,
  adventureId: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true } | { error: string }> {
  const adventure = await deps.adventures.get(adventureId);
  if (adventure === null || adventure.ownerId !== userId) return { error: "not_found" };
  if (!v3SchoolAllowed(adventure.schoolId, env)) return { error: "not_found" };
  if (adventure.status !== "needs_review") return { error: "not awaiting review" };
  await deps.adventures.clearSkeletonDraft(adventureId);
  return { ok: true };
}

export function viewerSeesCost(viewer: Pick<Viewer, "membership" | "isSysadmin">): boolean {
  return viewer.isSysadmin || viewer.membership?.role === "admin";
}

export async function approveSkeleton(
  deps: GenerationDeps,
  jobs: Jobs,
  store: StepStore,
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
    // every citation quote must occur in the cited source, exactly as the
    // skeleton pass checks its own output (`sources_v3.source_key` is the id)
    const texts = sourceTexts(await deps.sources.load(adventureId));
    const quotes = [
      ...validated.spec.discoveries.flatMap((d, i) =>
        (d.citations ?? []).flatMap((c, j) => (c.quote !== undefined ? [{ path: `discoveries.${i}.citations.${j}.quote`, sourceId: c.sourceId, quote: c.quote }] : [])),
      ),
      ...validated.spec.endings.flatMap((e, i) =>
        (e.citations ?? []).flatMap((c, j) => (c.quote !== undefined ? [{ path: `endings.${i}.citations.${j}.quote`, sourceId: c.sourceId, quote: c.quote }] : [])),
      ),
    ];
    const quoteFailures = quoteIssues(quotes, texts);
    if (quoteFailures.length > 0) return { error: "invalid skeleton", issues: quoteFailures };
    edited = validated.spec;
  }

  // rebuild the brief from the skeleton step's stored input
  const brief = await storedBrief(store, adventureId);
  if (brief === null) return { error: "generation brief not found" };

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
  await deps.adventures.clearSkeletonDraft(adventureId).catch(() => {});
  return { ok: true };
}

export interface GenerationProgress {
  status: V3AdventureRow["status"];
  steps: { name: string; status: string; attempts: number; error: string | null }[];
  costUsd: number;
  warnings: (CheckIssue & { pass: string })[];
  skeleton?: unknown;
  /** a saved teacher draft exists for this skeleton */
  hasDraft?: boolean;
}

/** The caller has already done the access check on `adventure`. */
export async function getGenerationProgress(
  deps: GenerationDeps,
  jobs: Jobs,
  store: StepStore,
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
    ...(adventure.status === "needs_review"
      ? await (async () => {
          const draft = await deps.adventures.loadSkeletonDraft(adventure.id);
          if (draft !== null && draft !== undefined) return { skeleton: draft, hasDraft: true };
          return outputs.skeleton !== undefined ? { skeleton: (outputs.skeleton as { skeleton: unknown }).skeleton } : {};
        })()
      : {}),
  };
}
