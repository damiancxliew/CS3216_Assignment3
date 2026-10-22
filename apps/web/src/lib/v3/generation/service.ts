/**
 * Orchestration for the v3 generation job: a confirmed brief enqueues the pass
 * steps (quick = all seven, standard = sources + skeleton, guided = one pass at a time),
 * approve resumes a reviewed skeleton, and progress reads the step rows.
 * No Next imports — deps and the flag env are injected.
 */
import { checkSkeleton, validateSkeleton } from "@adventure/spec-v3";
import { quoteIssues, sourceTexts } from "@adventure/generation/v3";
import type { AdventureSpec, CheckIssue, SkeletonShape } from "@adventure/spec-v3";
import type { createJobs, EnqueueStep, JobStep, Json } from "@adventure/jobs";

import type { Viewer } from "@/lib/auth/viewer";
import { v3SchoolAllowed } from "@/lib/v3/flag";
import { completeDraft, type BriefStateV3 } from "@/lib/v3/brief/schema";
import type { V3BriefStore } from "@/lib/v3/brief/store";

import type { GenerationDeps, V3AdventureRow } from "./deps";
import type { GenerationBrief } from "./types";
import { finalCheckErrors, type FinalCheckOutput } from "./check-errors";

import { capturedSources } from "@/lib/v3/edit/apply";
import { checkTeacherEdits, validateEditedSpec } from "@/lib/v3/edit/validation";
import { V3Edit } from "@/lib/v3/edit/commands";
import type { TeacherEdits } from "./steps";

type Jobs = Pick<ReturnType<typeof createJobs>, "enqueue" | "getProgress">;
/** raw step rows — needed for the stored brief (skeleton input) and step outputs. */
export type StepStore = { list(jobId: string): Promise<JobStep[]>; outputs(jobId: string, names: string[]): Promise<Record<string, Json>> };

const STEP_INPUT = (brief: GenerationBrief): Json => brief as unknown as Json;

const QUICK_STEPS = ["sources", "skeleton", "details", "endings", "reveal", "check", "save"] as const;
const STANDARD_STEPS = ["sources", "skeleton"] as const;

const STEP_DEPS: Record<string, string[]> = {
  skeleton: ["sources"],
  details: ["skeleton"],
  endings: ["details"],
  reveal: ["details", "endings"],
  check: ["details", "endings", "reveal"],
  save: ["check"],
};

/** Enqueues the generation steps for a confirmed brief. The caller owns the row's status. */
export async function enqueueGeneration(jobs: Jobs, brief: GenerationBrief): Promise<void> {
  const names = brief.mode === "quick" ? QUICK_STEPS : brief.mode === "guided" ? ["sources"] : STANDARD_STEPS;
  const steps: EnqueueStep[] = names.map((name) => ({
    name,
    step: `v3.gen.${name}`,
    input: name === "details" ? ({ brief } as unknown as Json) : STEP_INPUT(brief),
  }));
  await jobs.enqueue(brief.adventureId, steps, STEP_DEPS);
}

/** Rebuilds the stored brief from the skeleton (or sources) step's input. */
export async function storedBrief(store: StepStore, adventureId: string): Promise<GenerationBrief | null> {
  const rows = await store.list(adventureId);
  const row = rows.find((r) => r.name === "skeleton") ?? rows.find((r) => r.name === "sources");
  const input = (row?.input ?? null) as unknown as GenerationBrief | { brief: GenerationBrief } | null;
  return input && "brief" in input ? input.brief : input;
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
    ...(draft.sourcePolicy ? { sourcePolicy: draft.sourcePolicy } : {}),
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
        ...(oldBrief?.sourcePolicy ? { sourcePolicy: oldBrief.sourcePolicy } : {}),
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

export async function skeletonIssues(deps: GenerationDeps, adventureId: string, raw: unknown): Promise<CheckIssue[]> {
  const validated = validateSkeleton(raw);
  if (!validated.ok) return validated.issues.map((i) => ({ code: "schema", path: i.path, message: i.message }));
  const check = checkSkeleton(validated.spec);
  if (check.errors.length > 0) return check.errors;
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
  return quoteFailures;
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
    const issues = await skeletonIssues(deps, adventureId, editedSkeleton);
    if (issues.length) return { error: "invalid skeleton", issues };
    const validated = validateSkeleton(editedSkeleton);
    if (validated.ok) edited = validated.spec;
  }

  // rebuild the brief from the skeleton step's stored input
  const brief = await storedBrief(store, adventureId);
  if (brief === null) return { error: "generation brief not found" };

  if (brief.mode === "guided" && pausedPass(await store.list(adventureId)) !== "skeleton") return { error: "not awaiting skeleton review" };

  // guards double clicks: enqueue_job_steps raises on a duplicate step name anyway
  if (!(await deps.adventures.setStatus(adventureId, "generating", ["needs_review"]))) return { error: "already approved" };

  try {
    await jobs.enqueue(
      adventureId,
      [
        { name: "details", step: "v3.gen.details", input: { brief, ...(edited !== undefined ? { skeleton: edited } : {}) } as unknown as Json },
        { name: "endings", step: "v3.gen.endings", input: STEP_INPUT(brief) },
        { name: "reveal", step: "v3.gen.reveal", input: STEP_INPUT(brief) },
        { name: "check", step: "v3.gen.check", input: STEP_INPUT(brief) },
        { name: "save", step: "v3.gen.save", input: STEP_INPUT(brief) },
      ].filter(step => brief.mode !== "guided" || step.name === "details"),
      { details: ["skeleton"], endings: ["details"], reveal: ["details", "endings"], check: ["details", "endings", "reveal"], save: ["check"] },
    );
  } catch (error) {
    await deps.adventures.setStatus(adventureId, "needs_review", ["generating"]);
    return { error: error instanceof Error ? error.message : "could not queue generation" };
  }
  await deps.adventures.clearSkeletonDraft(adventureId).catch(() => {});
  return { ok: true };
}

export interface GenerationProgress {
  mode: GenerationBrief["mode"];
  pausedAt?: GuidedPass;
  status: V3AdventureRow["status"];
  steps: { name: string; status: string; attempts: number; error: string | null }[];
  costUsd: number;
  warnings: (CheckIssue & { pass: string })[];
  /** errors left after the final check-and-repair; the review screen shows them (#209) */
  checkErrors?: CheckIssue[];
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
  const outputs = await store.outputs(adventure.id, ["sources", "skeleton", "details", "endings", "reveal", "check", "save"]);
  const retryCost = (await deps.adventures.sourceRuns?.(adventure.id) ?? []).filter(run => run.idempotency_key !== "initial-sources").reduce((sum, run) => sum + Number(run.cost_usd), 0);
  const costUsd = retryCost + (await deps.adventures.mediaCost?.(adventure.id) ?? 0) + Object.values(outputs).reduce((sum: number, output) => sum + (((output ?? null) as { costUsd?: number | null } | null)?.costUsd ?? 0), 0);
  const warnings: (CheckIssue & { pass: string })[] = [];
  for (const pass of ["details", "endings", "reveal"] as const) {
    const output = outputs[pass] as { warnings?: CheckIssue[] } | undefined;
    for (const warning of output?.warnings ?? []) warnings.push({ ...warning, pass });
  }
  const brief = await storedBrief(store, adventure.id);
  const pausedAt = adventure.status === "needs_review" ? pausedPass(await store.list(adventure.id)) : null;
  return {
    mode: brief?.mode ?? "quick",
    ...(pausedAt ? { pausedAt } : {}),
    status: adventure.status,
    steps: (progress?.steps ?? []).map((s) => ({ name: s.name, status: s.status, attempts: s.attempts, error: s.error })),
    costUsd,
    warnings,
    ...(outputs.check !== undefined
      ? { checkErrors: finalCheckErrors(outputs.check as FinalCheckOutput) }
      : {}),
    ...(adventure.status === "needs_review" && pausedAt === "skeleton"
      ? await (async () => {
          const draft = await deps.adventures.loadSkeletonDraft(adventure.id);
          if (draft !== null && draft !== undefined) return { skeleton: draft, hasDraft: true };
          return outputs.skeleton !== undefined ? { skeleton: (outputs.skeleton as { skeleton: unknown }).skeleton } : {};
        })()
      : {}),
  };
}

export type GuidedPass = "sources" | "skeleton" | "details" | "endings" | "reveal";
export type EditablePass = Extract<GuidedPass, "details" | "endings" | "reveal">;
const PIPELINE = ["sources", "skeleton", "details", "endings", "reveal", "check", "save"] as const;
export function pausedPass(steps: JobStep[]): GuidedPass | null {
  for (let index = 4; index >= 0; index--) {
    const pass = PIPELINE[index];
    if (steps.some(row => row.name === pass && row.status === "succeeded") && !steps.some(row => row.name === PIPELINE[index + 1])) return pass as GuidedPass;
  }
  return null;
}

export type PauseView =
  | { pass: "sources"; index: 1; uploads: { id: string; title: string }[]; outside: { id: string; title: string; url: string }[]; rejected: { url: string; reason: string }[]; excluded?: string[]; importing?: boolean; noResults?: boolean }
  | { pass: "skeleton"; index: 2 }
  | { pass: EditablePass; index: 3 | 4 | 5; base: AdventureSpec; edits: V3Edit[]; errors: CheckIssue[]; warnings: CheckIssue[] };

/** Caller has checked access to the adventure. The base is the raw pass output. */
export async function loadPause(deps: GenerationDeps, store: StepStore, adventure: V3AdventureRow): Promise<PauseView | null> {
  if (adventure.status !== "needs_review") return null;
  if ((await storedBrief(store, adventure.id))?.mode !== "guided") return null;
  const pass = pausedPass(await store.list(adventure.id));
  if (!pass) return null;
  if (pass === "skeleton") return { pass, index: 2 };
  const outputs = await store.outputs(adventure.id, [pass]);
  const documents = pass === "sources" && deps.sources.loadAll ? await deps.sources.loadAll(adventure.id) : await deps.sources.load(adventure.id);
  if (pass === "sources") {
    const runs = (await deps.adventures.sourceRuns?.(adventure.id) ?? []).filter(run => run.idempotency_key !== "initial-sources");
    const output = outputs.sources as { summary?: { discovered: number }; rejected?: { url: string; reason: string }[] } | undefined;
    return { pass, index: 1,
      uploads: documents.filter(d => d.origin !== "outside").map(d => ({ id: d.id, title: d.title })),
      outside: documents.filter(d => d.origin === "outside").map(d => ({ id: d.id, title: d.title, url: d.url ?? "" })),
      rejected: [...(output?.rejected ?? []), ...runs.flatMap(run => run.results.rejected ?? [])],
      excluded: await deps.sources.excluded?.(adventure.id) ?? [],
      importing: runs.some(run => ["pending", "running"].includes(run.state)),
      noResults: output?.summary?.discovered === 0 && !runs.length };
  }
  const output = outputs[pass] as unknown as { draft?: AdventureSpec; spec?: AdventureSpec } | undefined;
  const base = pass === "details" ? output?.draft : output?.spec;
  if (!base) return null;
  const draft = await deps.adventures.loadPauseDraft(adventure.id);
  return { pass, index: pass === "details" ? 3 : pass === "endings" ? 4 : 5, base,
    edits: draft?.pass === pass ? draft.edits.map(edit => V3Edit.parse(edit)) : [],
    ...validateEditedSpec(base, capturedSources(documents)) };
}

/** Every pause mutation requires the owner, flag, guided mode and the exact completed pass. */
export async function requirePause(deps: GenerationDeps, store: StepStore, userId: string, adventureId: string, pass: GuidedPass, env: NodeJS.ProcessEnv): Promise<V3AdventureRow | null> {
  const adventure = await deps.adventures.get(adventureId);
  if (!adventure || adventure.ownerId !== userId || !v3SchoolAllowed(adventure.schoolId, env) || adventure.status !== "needs_review") return null;
  if ((await storedBrief(store, adventureId))?.mode !== "guided" || pausedPass(await store.list(adventureId)) !== pass) return null;
  return adventure;
}

export async function continueFromSources(deps: GenerationDeps, jobs: Jobs, store: StepStore, userId: string, adventureId: string, removedSourceIds: string[], env: NodeJS.ProcessEnv): Promise<{ ok: true } | { error: string }> {
  if (!await requirePause(deps, store, userId, adventureId, "sources", env)) return { error: "not awaiting sources review" };
  const documents = await (deps.sources.loadAll?.(adventureId) ?? deps.sources.load(adventureId));
  if (!Array.isArray(removedSourceIds) || removedSourceIds.some(id => !documents.some(doc => doc.id === id && doc.origin === "outside"))) return { error: "Only outside sources from this adventure can be removed." };
  if (!documents.some(doc => !removedSourceIds.includes(doc.id))) return { error: "Keep at least one source." };
  const brief = await storedBrief(store, adventureId);
  if (!brief) return { error: "generation brief not found" };
  const locked = deps.adventures.continueSources
    ? await deps.adventures.continueSources(adventureId, removedSourceIds)
    : await deps.adventures.setStatus(adventureId, "generating", ["needs_review"]);
  if (!locked) return { error: "An import is active or this adventure has already continued." };
  try {
    if (!deps.adventures.continueSources) await deps.sources.removeOutside(adventureId, removedSourceIds);
    await jobs.enqueue(adventureId, [{ name: "skeleton", step: "v3.gen.skeleton", input: STEP_INPUT(brief) }], { skeleton: ["sources"] });
  } catch (error) {
    await deps.adventures.setStatus(adventureId, "needs_review", ["generating"]);
    return { error: error instanceof Error ? error.message : "could not queue generation" };
  }
  return { ok: true };
}

export async function savePauseEdits(deps: GenerationDeps, store: StepStore, userId: string, adventureId: string, pass: EditablePass, rawEdits: unknown, env: NodeJS.ProcessEnv): Promise<{ ok: true; warnings: CheckIssue[] } | { ok: false; errors: CheckIssue[] }> {
  const adventure = ["details", "endings", "reveal"].includes(pass) ? await requirePause(deps, store, userId, adventureId, pass, env) : null;
  const pause = adventure ? await loadPause(deps, store, adventure) : null;
  if (!pause || !("base" in pause)) return { ok: false, errors: [{ code: "access", path: "", message: "Not awaiting this review." }] };
  const checked = checkTeacherEdits(pause.base, rawEdits, capturedSources(await deps.sources.load(adventureId)));
  if (!checked.ok) return checked;
  await deps.adventures.savePauseDraft(adventureId, { pass, edits: checked.edits });
  return { ok: true, warnings: checked.warnings };
}

export async function continuePause(deps: GenerationDeps, jobs: Jobs, store: StepStore, userId: string, adventureId: string, pass: EditablePass, rawEdits: unknown, env: NodeJS.ProcessEnv): Promise<{ ok: true } | { error: string; issues?: CheckIssue[] }> {
  const adventure = ["details", "endings", "reveal"].includes(pass) ? await requirePause(deps, store, userId, adventureId, pass, env) : null;
  const pause = adventure ? await loadPause(deps, store, adventure) : null;
  if (!pause || !("base" in pause)) return { error: "not awaiting this review" };
  const checked = checkTeacherEdits(pause.base, rawEdits, capturedSources(await deps.sources.load(adventureId)));
  if (!checked.ok) return { error: "invalid edits", issues: checked.errors };
  const brief = await storedBrief(store, adventureId);
  if (!brief) return { error: "generation brief not found" };
  const rows = await store.list(adventureId);
  const prior = (rows.find(row => row.name === pass)?.input as unknown as { teacherEdits?: TeacherEdits })?.teacherEdits ?? {};
  const teacherEdits = { ...prior, [pass]: checked.edits };
  const next = pass === "details" ? "endings" : pass === "endings" ? "reveal" : "check";
  if (!await deps.adventures.setStatus(adventureId, "generating", ["needs_review"])) return { error: "already continued" };
  try {
    await jobs.enqueue(adventureId, [
      { name: next, step: `v3.gen.${next}`, input: { brief, teacherEdits } as unknown as Json },
      ...(next === "check" ? [{ name: "save", step: "v3.gen.save", input: STEP_INPUT(brief) }] : []),
    ], STEP_DEPS);
  } catch (error) {
    await deps.adventures.setStatus(adventureId, "needs_review", ["generating"]);
    return { error: error instanceof Error ? error.message : "could not queue generation" };
  }
  await deps.adventures.clearPauseDraft(adventureId);
  return { ok: true };
}
