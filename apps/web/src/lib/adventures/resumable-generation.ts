import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { compileAdventure, createSpatialStageWorld } from "@adventure/game-integration";
import { OpenAiLlmClient } from "@adventure/generation/llm";
import {
  DEFAULT_PLANNER_CONFIG,
  MAX_REPAIRS,
  generateAdventure,
  type PlannerConfig,
  type TeacherInputRaw,
} from "@adventure/generation/planner";
import type { ExtractedDocument } from "@adventure/generation/ingest";
import type { AdventureSpec, SpecIssue } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import { persistSpecVersion, SpecPersistError } from "./persist-spec";
import { sourcesToDocuments, type SourceRow } from "./generate-from-sources";

type PrivateJob = {
  adventure_id: string;
  teacher: TeacherInputRaw;
  source_snapshot: Array<{ id: string; contentHash: string }>;
  planner_config: PlannerConfig;
  layout_seed: string;
  created_by: string | null;
  attempt: number;
  last_output: string | null;
  issues: SpecIssue[];
  spec: AdventureSpec | null;
  missing_information: string[];
  warnings: string[];
  lease_token: string | null;
};

export type GenerationStepResult = { state: "running" | "completed" | "failed"; message?: string };

async function updatePublicJob(admin: SupabaseClient, adventureId: string, state: "running" | "completed" | "failed", phase: string, message: string | null = null): Promise<void> {
  const { error } = await admin.from("generation_job").update({ state, phase, message, updated_at: new Date().toISOString() }).eq("adventure_id", adventureId);
  if (error) throw error;
}

async function failJob(admin: SupabaseClient, adventureId: string, message: string): Promise<GenerationStepResult> {
  await updatePublicJob(admin, adventureId, "failed", "failed", message);
  await admin.from("generation_job_state").delete().eq("adventure_id", adventureId);
  return { state: "failed", message };
}

function validatePlayable(spec: AdventureSpec, layoutSeed: string): SpecIssue[] {
  const compilation = compileAdventure(spec, layoutSeed);
  if (!compilation.ok) return compilation.issues;
  for (let index = 0; index < compilation.stages.length; index += 1) {
    try {
      createSpatialStageWorld(spec, index, compilation.stages[index]!);
    } catch (error) {
      return [{ path: `$.stages.${index}`, message: error instanceof Error ? error.message : String(error) }];
    }
  }
  return [];
}

/** Start a durable job. The browser advances its plan, repair and save steps separately. */
export async function startGenerationJob(admin: SupabaseClient, input: {
  adventureId: string;
  teacher: TeacherInputRaw;
  documents: ExtractedDocument[];
  warnings: string[];
  createdBy: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error: privateError } = await admin.from("generation_job_state").insert({
    adventure_id: input.adventureId,
    teacher: input.teacher,
    source_snapshot: input.documents.map((document) => ({ id: document.id, contentHash: document.contentHash })),
    planner_config: { ...DEFAULT_PLANNER_CONFIG, reasoningEffort: "low" },
    layout_seed: randomUUID(),
    created_by: input.createdBy,
    attempt: 0,
    last_output: null,
    issues: [],
    spec: null,
    missing_information: [],
    warnings: input.warnings,
    lease_token: null,
    lease_expires_at: null,
  });
  if (privateError) throw privateError;
  const { error: publicError } = await admin.from("generation_job").upsert({
    adventure_id: input.adventureId,
    state: "running",
    phase: "preparing",
    message: null,
    started_at: now,
    updated_at: now,
  });
  if (publicError) {
    await admin.from("generation_job_state").delete().eq("adventure_id", input.adventureId);
    throw publicError;
  }
}

async function existingSavedVersion(admin: SupabaseClient, job: PrivateJob): Promise<{ version: number } | null> {
  const { data, error } = await admin.from("spec_version")
    .select("version, json, generator_version, created_by")
    .eq("adventure_id", job.adventure_id)
    .is("published_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number; json: unknown; generator_version: string; created_by: string | null }>();
  if (error) throw error;
  const expectedGenerator = `planner:${job.planner_config.model}@${job.planner_config.promptVersion}`;
  return data && data.generator_version === expectedGenerator && data.created_by === job.created_by && isDeepStrictEqual(data.json, job.spec)
    ? { version: data.version }
    : null;
}

async function loadSnapshotDocuments(admin: SupabaseClient, job: PrivateJob): Promise<ExtractedDocument[]> {
  const { data, error } = await admin.from("source")
    .select("id, title, kind, page_map, content_hash")
    .eq("adventure_id", job.adventure_id)
    .order("created_at")
    .returns<SourceRow[]>();
  if (error) throw error;
  const available = new Map(sourcesToDocuments(data ?? []).documents.map((document) => [document.id, document]));
  return job.source_snapshot.map(({ id, contentHash }) => {
    const document = available.get(id);
    if (!document || document.contentHash !== contentHash) throw new Error("Sources changed during generation; start a new generation job.");
    return document;
  });
}

/** A single invocation does one model attempt OR saves a validated spec. */
export async function advanceGenerationJob(admin: SupabaseClient, adventureId: string): Promise<GenerationStepResult> {
  const leaseToken = randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc("claim_generation_job_step", {
    p_adventure_id: adventureId,
    p_token: leaseToken,
  }).maybeSingle<PrivateJob>();
  if (claimError) throw claimError;
  if (!claimed) return { state: "running" };

  const job = claimed;
  try {
    if (job.spec) {
      await updatePublicJob(admin, adventureId, "running", "saving");
      let version = await existingSavedVersion(admin, job);
      if (!version) {
        const saved = await persistSpecVersion(admin, adventureId, job.spec, {
          generatorVersion: `planner:${job.planner_config.model}@${job.planner_config.promptVersion}`,
          createdBy: job.created_by,
          layoutSeed: job.layout_seed,
        });
        version = { version: saved.version };
      }
      const notes = [...job.missing_information.map((item) => `Missing from the sources: ${item}`), ...job.warnings];
      const message = `Draft v${version.version} generated.${notes.length ? ` ${notes.join(" · ")}` : ""}`;
      await updatePublicJob(admin, adventureId, "completed", "completed", message);
      const { error: cleanupError } = await admin.from("generation_job_state").delete().eq("adventure_id", adventureId).eq("lease_token", leaseToken);
      if (cleanupError) console.error("could not clean up completed generation job", adventureId, cleanupError);
      return { state: "completed", message };
    }

    await updatePublicJob(admin, adventureId, "running", job.attempt === 0 ? "planning" : "repairing");
    const documents = await loadSnapshotDocuments(admin, job);
    const result = await generateAdventure({
      teacher: job.teacher,
      documents,
      llm: new OpenAiLlmClient({ timeoutMs: 240_000, maxRetries: 0 }),
      config: { ...job.planner_config, maxRepairs: 0 },
      validatePlayable: (spec) => validatePlayable(spec, job.layout_seed),
      ...(job.attempt > 0 && job.last_output !== null
        ? { resume: { attempt: job.attempt, previousOutput: job.last_output, issues: job.issues } }
        : {}),
      onProgress: (phase) => updatePublicJob(admin, adventureId, "running", phase),
    });

    if (result.status === "ok") {
      const { error } = await admin.from("generation_job_state").update({
        spec: result.spec,
        missing_information: result.missingInformation,
        warnings: [...job.warnings, ...result.warnings],
        lease_token: null,
        lease_expires_at: null,
      }).eq("adventure_id", adventureId).eq("lease_token", leaseToken);
      if (error) throw error;
      await updatePublicJob(admin, adventureId, "running", "saving");
      return { state: "running" };
    }

    if ((result.reason === "invalid-after-repair" || result.reason === "unparseable") && job.attempt < MAX_REPAIRS) {
      const { error } = await admin.from("generation_job_state").update({
        attempt: job.attempt + 1,
        last_output: result.lastOutput ?? "",
        issues: result.issues,
        lease_token: null,
        lease_expires_at: null,
      }).eq("adventure_id", adventureId).eq("lease_token", leaseToken);
      if (error) throw error;
      await updatePublicJob(admin, adventureId, "running", "repairing");
      return { state: "running" };
    }

    console.error("adventure generation step failed", adventureId, result.reason, result.issues.slice(0, 3));
    const message = result.reason === "invalid-after-repair"
      ? "The generated adventure needs more work. Review the sources and try again."
      : result.reason === "llm-error"
        ? "Adventure generation failed during a model call. Please try again."
        : "Adventure generation did not finish. Please try again.";
    return failJob(admin, adventureId, message);
  } catch (error) {
    console.error("adventure generation step failed unexpectedly", adventureId, error);
    if (job.spec && !(error instanceof SpecPersistError)) {
      // A save or progress write may have succeeded just before the connection
      // failed. Retain the spec so the next call can recognize that draft.
      const { error: releaseError } = await admin.from("generation_job_state").update({
        lease_token: null,
        lease_expires_at: null,
      }).eq("adventure_id", adventureId).eq("lease_token", leaseToken);
      if (releaseError) console.error("could not release generation lease", adventureId, releaseError);
      return { state: "running", message: "Saving the draft will retry." };
    }
    const message = error instanceof SpecPersistError
      ? "Couldn’t save the generated adventure. Please try again."
      : "Generation stopped unexpectedly. Please try again.";
    return failJob(admin, adventureId, message);
  }
}
