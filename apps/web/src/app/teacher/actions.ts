"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  ExtractionError,
  extractDocument,
  LIMITS,
  slugify,
  type ExtractedDocument,
} from "@adventure/generation";
import { OpenAiImageService } from "@adventure/generation/assets";
import { OpenAiLlmClient } from "@adventure/generation/llm";

import {
  generateFromSources as runGeneration,
  type SourceRow,
  sourcesToDocuments,
} from "@/lib/adventures/generate-from-sources";
import { generateAssetsForVersion } from "@/lib/assets/generate";
import { applySpecEdit, type SpecEdit } from "@/lib/teacher/edit-spec";
import { persistSpecVersion, SpecPersistError } from "@/lib/adventures/persist-spec";
import {
  type BriefInput,
  type BriefSource,
  type BriefState,
  briefStateSchema,
  completeBrief,
  currentSlot,
  initialBriefState,
  readingLevelSchema,
  stageOutlineSchema,
} from "@/lib/brief/schema";
import { runBriefTurn, type TurnResult } from "@/lib/brief/turn";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Every action here re-establishes who is asking from the session cookie and
 * lets the database decide what they may touch: the RPCs are owner-checked
 * (P4) and the direct writes run as the signed-in user under RLS. The service
 * role only appears where authoring content is written on the teacher's
 * behalf, after their ownership has been confirmed.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teacher");
  return { supabase, user };
}

// `adventure_select` also admits a student with an attempt on a published
// adventure, so visibility is not ownership: the owner is matched explicitly
// before any service-role write is made on the teacher's behalf.
async function requireOwnership(adventureId: string) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("adventure")
    .select("id")
    .eq("id", adventureId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) redirect("/teacher");
  return { supabase, user };
}

/** `notice` is for a success that still has something to tell the teacher (FR-3: missing information is reported, never hidden). */
export type ActionResult = { error?: string; notice?: string };

/**
 * The teacher's brief (PRD §6) is agreed in conversation, one turn per call.
 * The adventure row exists from the first question so the sources uploaded
 * mid-conversation have somewhere to live, and the conversation is mirrored
 * onto that row after every turn so it can be resumed. The reading level is
 * mandatory (FR-1a) because the conversation will not finish without it.
 */
export async function startBrief(): Promise<TurnResult> {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("adventure")
    .insert({ owner_id: user.id, title: "Untitled adventure" })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    console.error("could not create teacher adventure", error);
    return { ok: false, error: "Couldn’t start a new adventure. Please try again." };
  }
  return saveBrief(initialBriefState(data.id));
}

/** Re-establishes ownership of the adventure the conversation belongs to and re-validates the state the client sent back. */
async function requireBrief(state: BriefState): Promise<{ state: BriefState } | { error: string }> {
  const parsed = briefStateSchema.safeParse(state);
  if (!parsed.success) return { error: "The conversation got out of step — reload to start again" };
  await requireOwnership(parsed.data.adventureId);
  return { state: parsed.data };
}

/** The sources uploaded so far, both as the chat lists them and as the documents the assistant reads. */
async function loadBriefSources(adventureId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("source")
    .select("id, title, kind, page_map, content_hash")
    .eq("adventure_id", adventureId)
    .order("created_at")
    .returns<(SourceRow & { page_map: { pages?: number } | null })[]>();
  const rows = data ?? [];
  const list: BriefSource[] = rows.map((row) => ({ id: row.id, title: row.title ?? "Untitled", pages: row.page_map?.pages ?? 0 }));
  return { list, documents: sourcesToDocuments(rows).documents };
}

async function saveBrief(state: BriefState): Promise<TurnResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("adventure").update({ brief_state: state }).eq("id", state.adventureId);
  if (error) {
    console.error("could not save adventure setup", state.adventureId, error);
    return { ok: false, error: "Couldn’t save your progress. Please try again." };
  }
  return { ok: true, state };
}

export async function briefTurn(state: BriefState, input: BriefInput): Promise<TurnResult> {
  const checked = await requireBrief(state);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (!process.env.OPENAI_API_KEY) {
    console.error("adventure assistant unavailable: OPENAI_API_KEY is missing");
    return { ok: false, error: "This feature is temporarily unavailable. Please try again later." };
  }
  const { list, documents } = await loadBriefSources(checked.state.adventureId);
  const result = await runBriefTurn({ ...checked.state, sources: list }, input, new OpenAiLlmClient({ timeoutMs: 90_000 }), documents);
  return result.ok ? saveBrief(result.state) : result;
}

/**
 * The upload step of the conversation. A PDF's text layer is extracted
 * server-side — a scanned image has none, and the teacher is told to paste
 * instead rather than getting an adventure grounded in nothing. Pages are the
 * unit of citation (D1/FR-1), so `page_map` always carries per-page text,
 * whatever the teacher dropped in.
 */
export async function addBriefSource(state: BriefState, formData: FormData): Promise<TurnResult> {
  const checked = await requireBrief(state);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (currentSlot(checked.state.draft).name !== "sources") {
    return { ok: false, error: "Reopen the sources step from the summary to add another" };
  }

  const extracted = await extractUpload(formData);
  if ("error" in extracted) return { ok: false, error: extracted.error };
  const { doc, storageKey } = extracted;

  const admin = createAdminClient();
  const { error } = await admin.from("source").insert({
    adventure_id: checked.state.adventureId,
    kind: doc.kind,
    title: doc.title,
    storage_key: storageKey,
    content_hash: doc.contentHash,
    page_map: {
      pages: doc.pageCount,
      chars: doc.charCount,
      warnings: doc.warnings,
      page_texts: doc.pages,
      text: doc.pages.map((p) => p.text).join("\f"),
    },
  });
  if (error) {
    console.error("could not save uploaded teacher source", checked.state.adventureId, error);
    return { ok: false, error: "Couldn’t save that source. Please try again." };
  }

  const { list } = await loadBriefSources(checked.state.adventureId);
  const pages = `${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"}`;
  const warnings = doc.warnings.length > 0 ? ` ${doc.warnings.join(" ")}` : "";
  return saveBrief({
    ...checked.state,
    sources: list,
    messages: [
      ...checked.state.messages,
      { role: "user", text: `Added “${doc.title}”`, slot: "sources" },
      { role: "assistant", text: `Got “${doc.title}”, ${pages}.${warnings} Add another, or tell me that’s all of them.`, slot: "sources" },
    ],
  });
}

const UPLOAD_KINDS: Record<string, "pdf" | "text"> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
};

/** Per-page text the client extracted from a PDF itself; untrusted, so the caps are re-checked by `extractDocument`. */
const clientPagesSchema = z.array(z.string()).min(1).max(LIMITS.maxPages);

/** A pasted passage and an uploaded file come out identical, so the two are never stored differently. */
async function extractUpload(formData: FormData): Promise<{ doc: ExtractedDocument; storageKey: string } | { error: string }> {
  const body = String(formData.get("body") ?? "").trim();
  const file = formData.get("file");

  try {
    const rawPages = formData.get("pages");
    if (rawPages !== null) {
      const parsed = clientPagesSchema.safeParse(JSON.parse(String(rawPages)));
      if (!parsed.success) return { error: "Could not read that PDF — paste the text instead" };
      const filename = String(formData.get("filename") ?? "").trim();
      if (!filename) return { error: "Could not read that PDF — paste the text instead" };
      const doc = await extractDocument({ id: slugify(filename), title: filename, kind: "pdf", pages: parsed.data });
      return { doc, storageKey: `upload:${crypto.randomUUID()}/${filename}` };
    }
    if (body) {
      const doc = await extractDocument({ id: slugify("Pasted source", "pasted-source"), title: "Pasted source", kind: "text", text: body });
      return { doc, storageKey: `inline:${crypto.randomUUID()}` };
    }
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF or text file, or paste the text" };
    if (file.size > LIMITS.maxUploadBytes) {
      return { error: `That file is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${LIMITS.maxUploadBytes / 1_048_576} MB` };
    }
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    const kind = UPLOAD_KINDS[file.type] ?? (extension === "pdf" ? "pdf" : ["txt", "md"].includes(extension) ? "text" : null);
    if (!kind) return { error: "Only PDF, .txt and .md files are supported" };

    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await extractDocument(
      kind === "pdf"
        ? { id: slugify(file.name), title: file.name, kind, bytes }
        : { id: slugify(file.name), title: file.name, kind, text: new TextDecoder().decode(bytes) },
    );
    return { doc, storageKey: `upload:${crypto.randomUUID()}/${file.name}` };
  } catch (error) {
    if (error instanceof ExtractionError) return { error: error.message };
    console.error("could not extract uploaded teacher source", error);
    return { error: "Couldn’t read that source. Check the file and try again." };
  }
}

/** The brief is settled: write it onto the row and clear the conversation. */
export async function finishBrief(state: BriefState): Promise<ActionResult> {
  const checked = await requireBrief(state);
  if ("error" in checked) return { error: checked.error };
  const brief = completeBrief(checked.state.draft);
  if (!brief) return { error: "The brief isn’t finished yet" };
  const { list } = await loadBriefSources(checked.state.adventureId);
  if (list.length === 0) return { error: "Add at least one source before creating the adventure" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("adventure")
    .update({
      title: brief.title,
      setting: brief.setting,
      student_role: brief.studentRole,
      learning_objectives: brief.learningObjectives,
      reading_level: brief.readingLevel,
      stage_outline: brief.stageOutline,
      brief_state: null,
    })
    .eq("id", checked.state.adventureId);
  if (error) {
    console.error("could not finish adventure setup", checked.state.adventureId, error);
    return { error: "Couldn’t create the adventure. Please try again." };
  }

  revalidatePath("/teacher");
  redirect(`/teacher/${checked.state.adventureId}`);
}

/** Throws away an unfinished brief and the sources uploaded to it. A confirmed adventure is never deleted here. */
export async function discardBrief(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.from("adventure").delete().eq("id", adventureId).not("brief_state", "is", null);
  if (error) {
    console.error("could not discard unfinished adventure", adventureId, error);
    return { error: "Couldn’t discard this setup. Please try again." };
  }
  revalidatePath("/teacher");
  return {};
}

/** The brief as stored on the adventure row; `null` for an adventure created before the brief was mandatory. */
const storedBrief = z.object({
  setting: z.string().min(1),
  student_role: z.string().min(1),
  learning_objectives: z.array(z.string()).min(1).max(6),
  reading_level: readingLevelSchema,
  stage_outline: z.array(stageOutlineSchema).max(3),
});

// Vercel stops this route after 300 seconds. Generation may make repair calls,
// so all model work shares a smaller budget and leaves time to persist the
// finished spec and return a normal ActionResult to the browser.
const GENERATION_MODEL_BUDGET_MS = 250_000;
const GENERATION_CALL_TIMEOUT_MS = 120_000;

/**
 * D1–D4 → P5: run the planner over the adventure's stored sources and land the
 * result as the next draft version. The brief (setting, role, objectives,
 * reading level, stage plan) was agreed when the adventure was created and is
 * read from the row, so every generation of the same adventure starts from
 * the same brief.
 */
export async function generateFromSources(adventureId: string): Promise<ActionResult> {
  const { user } = await requireOwnership(adventureId);

  if (!process.env.OPENAI_API_KEY) {
    console.error("adventure generation unavailable: OPENAI_API_KEY is missing", adventureId);
    return { error: "This feature is temporarily unavailable. Please try again later." };
  }

  const admin = createAdminClient();
  let jobStarted = false;
  const updateJob = async (state: "running" | "completed" | "failed", phase: "preparing" | "planning" | "checking" | "repairing" | "saving" | "completed" | "failed") => {
    const { error } = await admin.from("generation_job").update({ state, phase, updated_at: new Date().toISOString() }).eq("adventure_id", adventureId);
    if (error) console.error("could not update generation progress", adventureId, error);
  };

  try {
    const [adventureResult, sourcesResult] = await Promise.all([
      admin
        .from("adventure")
        .select("title, default_timer_seconds, setting, student_role, learning_objectives, reading_level, stage_outline")
        .eq("id", adventureId)
        .single<{ title: string; default_timer_seconds: number } & Record<string, unknown>>(),
      admin
        .from("source")
        .select("id, title, kind, page_map, content_hash")
        .eq("adventure_id", adventureId)
        .order("created_at")
        .returns<
          {
            id: string;
            title: string | null;
            kind: string;
            page_map: unknown;
            content_hash: string | null;
          }[]
        >(),
    ]);
    if (adventureResult.error) {
      console.error("could not load adventure for generation", adventureId, adventureResult.error);
      return { error: "Couldn’t load this adventure. Please try again." };
    }
    if (sourcesResult.error) {
      console.error("could not load sources for generation", adventureId, sourcesResult.error);
      return { error: "Couldn’t load the sources. Please try again." };
    }

    const adventure = adventureResult.data;
    if (!adventure) return { error: "Adventure not found" };

    const brief = storedBrief.safeParse(adventure);
    if (!brief.success) {
      return { error: "This adventure can’t be regenerated. Create a new adventure to use the guided setup." };
    }
    const { setting, student_role, learning_objectives, reading_level, stage_outline } = brief.data;

    const { data: existingJob } = await admin.from("generation_job")
      .select("state, updated_at")
      .eq("adventure_id", adventureId)
      .maybeSingle<{ state: string; updated_at: string }>();
    if (existingJob?.state === "running" && Date.now() - Date.parse(existingJob.updated_at) < 360_000) {
      return { notice: "Story generation is already in progress." };
    }
    const now = new Date().toISOString();
    const { error: jobError } = await admin.from("generation_job").upsert({
      adventure_id: adventureId,
      state: "running",
      phase: "preparing",
      started_at: now,
      updated_at: now,
    });
    if (jobError) {
      console.error("could not start generation progress", adventureId, jobError);
      return { error: "Couldn’t start story generation. Please try again." };
    }
    jobStarted = true;

    const result = await runGeneration({
      admin,
      adventureId,
      adventure,
      sources: sourcesResult.data ?? [],
      brief: {
        setting,
        studentRole: student_role,
        learningObjectives: learning_objectives,
        readingLevel: reading_level,
        stageOutline: stage_outline,
        stageCount: stage_outline.length === 0 ? 3 : (stage_outline.length as 1 | 2 | 3),
      },
      // Recorded medium-reasoning runs reached 278–296 seconds before their
      // database writes. Low reasoning keeps the same validation/repair loop
      // while leaving enough of the route budget to save a successful draft.
      plannerConfig: { reasoningEffort: "low" },
      onProgress: (phase) => updateJob("running", phase),
      llm: new OpenAiLlmClient({
        timeoutMs: GENERATION_CALL_TIMEOUT_MS,
        maxRetries: 0,
        deadlineMs: GENERATION_MODEL_BUDGET_MS,
      }),
      createdBy: user.id,
    });
    if (!result.ok) {
      await updateJob("failed", "failed");
      if (result.result?.status === "failed" && result.result.reason === "invalid-teacher-input") {
        console.error("adventure setup could not be used for generation", adventureId, result);
        return { error: "Review the adventure setup and try again." };
      }
      if (result.result?.status === "failed" && result.result.reason === "llm-error") {
        console.error("adventure model request failed", adventureId, result.result);
        return { error: "Adventure generation failed. Please try again." };
      }
      if (result.result?.status === "failed" && result.result.reason === "refusal") {
        console.error("adventure generation was refused", adventureId, result.result);
        return { error: "Couldn’t generate an adventure from these sources. Review them and try again." };
      }
      if (result.result?.status === "failed" && result.result.reason === "unparseable") {
        console.error("adventure generation returned an unusable result", adventureId, result.result);
        return { error: "Adventure generation didn’t finish. Please try again." };
      }
      if (result.result?.status === "failed" && result.result.reason === "invalid-after-repair") {
        console.error("generated adventure failed validation", adventureId, result.result);
        return { error: "The generated adventure needs more work. Please try again." };
      }
      if (result.result) {
        console.error("could not save generated adventure", adventureId, result);
        return { error: "Couldn’t save the generated adventure. Please try again." };
      }
      console.error("adventure generation could not start", adventureId, result);
      return { error: "Couldn’t generate the adventure. Check the sources and try again." };
    }

    await updateJob("completed", "completed");
    revalidatePath(`/teacher/${adventureId}`);
    const notes = [
      ...result.missingInformation.map((m) => `Missing from the sources: ${m}`),
      ...result.warnings,
    ];
    return notes.length > 0
      ? { notice: `Draft v${result.version.version} generated. ${notes.join(" · ")}` }
      : { notice: `Draft v${result.version.version} generated.` };
  } catch (error) {
    if (jobStarted) await updateJob("failed", "failed");
    console.error("adventure generation failed unexpectedly", adventureId, error);
    return {
      error: "Generation didn’t finish. Refresh the page to check for a draft, then try again if needed.",
    };
  }
}

/**
 * Imports an adventure spec v2 as the next draft version — the same seam
 * `generateFromSources` uses, for a spec produced elsewhere (e.g. the
 * generation CLI or a hand-authored fixture).
 */
export async function importSpec(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await requireOwnership(adventureId);

  let candidate: unknown;
  try {
    candidate = JSON.parse(String(formData.get("spec") ?? ""));
  } catch (error) {
    console.error("invalid imported adventure file", adventureId, error);
    return { error: "This file isn’t in a supported format." };
  }

  const admin = createAdminClient();
  try {
    await persistSpecVersion(admin, adventureId, candidate, {
      generatorVersion: "imported",
      createdBy: user.id,
    });
  } catch (error) {
    if (error instanceof SpecPersistError) {
      if (error.issues.length === 0 && error.message !== "this adventure already has an unpublished draft; publish or discard it first") {
        console.error("could not import adventure file", adventureId, error);
        return { error: "Couldn’t import this adventure. Please check the file and try again." };
      }
      const detail = error.issues
        .slice(0, 3)
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ");
      if (error.issues.length > 0) {
        return { error: detail ? `This adventure file needs changes: ${detail}` : "This adventure file needs changes." };
      }
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

export async function publishAdventure(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("publish_adventure", {
    p_adventure_id: adventureId,
  });
  if (error) {
    console.error("could not publish adventure", adventureId, error);
    return { error: "Couldn’t publish this adventure. Please try again." };
  }

  // Story-specific images (portraits, landmarks, props) are generated after the response is sent:
  // publish never blocks on them, and a failure leaves the curated placeholder in place (D6/FR-6a).
  const { data: published } = await supabase.from("adventure").select("published_version").eq("id", adventureId).single<{ published_version: number }>();
  if (published?.published_version && process.env.OPENAI_API_KEY) {
    const version = published.published_version;
    after(async () => {
      try {
        const result = await generateAssetsForVersion({ admin: createAdminClient(), images: new OpenAiImageService(), adventureId, version });
        console.info("asset generation", adventureId, `v${version}`, result);
      } catch (error) {
        console.error("asset generation failed", adventureId, `v${version}`, error);
      }
    });
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/** Editing a published adventure means a new draft version, never an edit in place (P4). */
export async function startEdit(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("create_draft_version", {
    p_adventure_id: adventureId,
  });
  if (error) {
    console.error("could not create adventure draft", adventureId, error);
    return { error: "Couldn’t create a draft. Please try again." };
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/**
 * D5/D6: artwork is also available before publish — the teacher can ask for
 * the draft (or published) version's images up front, so the page is already a
 * visual dossier when students arrive. Runs inside `after(...)` like publish:
 * the manifest rows land `pending` first and settle one by one.
 */
export async function generateArtwork(adventureId: string): Promise<ActionResult> {
  await requireOwnership(adventureId);

  if (!process.env.OPENAI_API_KEY) {
    console.error("artwork generation unavailable: OPENAI_API_KEY is missing", adventureId);
    return { error: "This feature is temporarily unavailable. Please try again later." };
  }

  const admin = createAdminClient();
  const { data: adventure } = await admin
    .from("adventure")
    .select("published_version")
    .eq("id", adventureId)
    .single<{ published_version: number | null }>();
  const { data: versions } = await admin
    .from("spec_version")
    .select("id, version, published_at")
    .eq("adventure_id", adventureId)
    .order("version", { ascending: false })
    .returns<{ id: string; version: number; published_at: string | null }[]>();
  const shown = (versions ?? []).find((v) => v.published_at === null) ?? (versions ?? []).find((v) => v.version === adventure?.published_version);
  if (!shown) return { error: "Generate an adventure version first to create artwork." };

  const { data: pending } = await admin
    .from("asset")
    .select("asset_id")
    .eq("spec_version_id", shown.id)
    .eq("status", "pending")
    .limit(1)
    .returns<{ asset_id: string }[]>();
  if (pending && pending.length > 0) {
    return { notice: `Artwork is already being generated for version ${shown.version}` };
  }

  const version = shown.version;
  after(async () => {
    try {
      const result = await generateAssetsForVersion({ admin: createAdminClient(), images: new OpenAiImageService(), adventureId, version });
      console.info("artwork generation", adventureId, `v${version}`, result);
    } catch (error) {
      console.error("artwork generation failed", adventureId, `v${version}`, error);
    }
  });
  return { notice: `Artwork is being generated for version ${version}; the page will update as each piece lands.` };
}

/**
 * Re-draws one asset. The cache row for its prompt hash is dropped first so
 * the same prompt cannot come straight back from `asset_cache`; the run itself
 * then writes the fresh result back to the cache. Artwork rows are not part
 * of the frozen spec, so regenerating a published version's art is legal (P4).
 */
export async function regenerateAsset(adventureId: string, specVersionId: string, assetId: string): Promise<ActionResult> {
  await requireOwnership(adventureId);

  if (!process.env.OPENAI_API_KEY) {
    console.error("artwork regeneration unavailable: OPENAI_API_KEY is missing", adventureId);
    return { error: "This feature is temporarily unavailable. Please try again later." };
  }

  const admin = createAdminClient();
  const { data: version } = await admin
    .from("spec_version")
    .select("id, version")
    .eq("id", specVersionId)
    .eq("adventure_id", adventureId)
    .maybeSingle<{ id: string; version: number }>();
  if (!version) return { error: "That version is not part of this adventure" };

  const { data: record } = await admin
    .from("asset")
    .select("prompt_hash")
    .eq("spec_version_id", specVersionId)
    .eq("asset_id", assetId)
    .maybeSingle<{ prompt_hash: string }>();
  if (!record) return { error: "That artwork does not exist yet — generate the set first" };

  await admin.from("asset_cache").delete().eq("prompt_hash", record.prompt_hash);

  const versionNumber = version.version;
  after(async () => {
    try {
      const result = await generateAssetsForVersion({
        admin: createAdminClient(),
        images: new OpenAiImageService(),
        adventureId,
        version: versionNumber,
        onlyAssetIds: [assetId],
        ignoreCache: true,
      });
      console.info("asset regeneration", adventureId, assetId, result);
    } catch (error) {
      console.error("asset regeneration failed", adventureId, assetId, error);
    }
  });
  return { notice: "Regenerating; the page will update when the new image lands." };
}

export async function rotateShareToken(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("rotate_share_token", {
    p_adventure_id: adventureId,
  });
  if (error) {
    console.error("could not replace adventure share link", adventureId, error);
    return { error: "Couldn’t replace the link. Please try again." };
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/**
 * Timer settings (P6/D12/FR-16). An empty field inherits the adventure
 * default, 0 disables the timer for that stage; both are meaningful, so the
 * form distinguishes "" from "0" rather than falling back to a truthiness check.
 */
function parseTimer(raw: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const seconds = Number(text);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : "invalid";
}

export async function updateDefaultTimer(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);

  const seconds = parseTimer(formData.get("default_timer_seconds"));
  if (seconds === "invalid" || seconds === null) {
    return { error: "Give a whole number of seconds (0 disables timers)" };
  }

  const { error } = await supabase
    .from("adventure")
    .update({ default_timer_seconds: seconds })
    .eq("id", adventureId);
  if (error) {
    console.error("could not save default adventure timer", adventureId, error);
    return { error: "Couldn’t save the timer. Please try again." };
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/**
 * Inline edits from the dossier. The draft's `spec_version.json` is the source
 * of truth — the relational rows are mirrored afterwards — and the maps are
 * recompiled so `compiled_spec` never drifts from the json the publish trigger
 * checks (P4). Published versions refuse; the trigger would reject anyway.
 */
async function applyEdit(adventureId: string, specVersionId: string, edit: SpecEdit): Promise<ActionResult> {
  await requireOwnership(adventureId);
  const result = await applySpecEdit(createAdminClient(), { adventureId, specVersionId }, edit);
  if (result.error) {
    if (/^(unknown |no stage row)/.test(result.error)) {
      console.error("could not locate adventure item for edit", adventureId, specVersionId, edit, result.error);
      return { error: "This item could not be found. Refresh the page and try again." };
    }
    return { error: result.error };
  }
  revalidatePath(`/teacher/${adventureId}`);
  return { notice: "Saved." };
}

/**
 * Whether a finished attempt can be followed by a fresh one. The database is
 * what enforces it — both the share link and the ending's own button create
 * attempts through owner-checked RPCs — so this only records the decision.
 */
export async function updateRetries(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);

  const choice = String(formData.get("allow_retries") ?? "");
  if (choice !== "on" && choice !== "off") return { error: "Choose whether retries are allowed" };

  const { error } = await supabase
    .from("adventure")
    .update({ allow_retries: choice === "on" })
    .eq("id", adventureId);
  if (error) {
    console.error("could not save adventure retry setting", adventureId, error);
    return { error: "Couldn’t save this setting. Please try again." };
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

export async function editStage(adventureId: string, specVersionId: string, stageId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const timer = parseTimer(formData.get("timer_seconds"));
  if (timer === "invalid") return { error: "Leave the timer empty to inherit, or give seconds (0 disables)" };
  const mapTheme = text(formData, "map_theme");
  if (mapTheme !== "classic" && mapTheme !== "desert" && mapTheme !== "winter" && mapTheme !== "forest" && mapTheme !== "coast") return { error: "Choose a listed map theme" };
  return applyEdit(adventureId, specVersionId, { kind: "stage", stageId, title: text(formData, "title"), sharedContext: text(formData, "shared_context"), timerSeconds: timer, mapTheme });
}

export async function editStakeholder(adventureId: string, specVersionId: string, stakeholderId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return applyEdit(adventureId, specVersionId, { kind: "stakeholder", stakeholderId, name: text(formData, "name"), role: text(formData, "role"), summary: text(formData, "summary") });
}

export async function editAgentPosition(adventureId: string, specVersionId: string, stageId: string, agentId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return applyEdit(adventureId, specVersionId, { kind: "agentPosition", stageId, agentId, publicPosition: text(formData, "public_position") });
}

export async function editRoom(adventureId: string, specVersionId: string, stageId: string, roomId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return applyEdit(adventureId, specVersionId, { kind: "room", stageId, roomId, name: text(formData, "name"), purpose: text(formData, "purpose") });
}

export async function editEvidence(adventureId: string, specVersionId: string, stageId: string, evidenceId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return applyEdit(adventureId, specVersionId, { kind: "evidence", stageId, evidenceId, name: text(formData, "name"), text: text(formData, "text") });
}

export async function editObjective(adventureId: string, specVersionId: string, stageId: string, objectiveId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return applyEdit(adventureId, specVersionId, { kind: "objective", stageId, objectiveId, title: text(formData, "title") });
}

export async function editDecision(adventureId: string, specVersionId: string, stageId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ids = formData.getAll("option_id").map(String);
  const labels = formData.getAll("option_label").map((v) => String(v).trim());
  const optionLabels = ids.map((id, i) => ({ id, label: labels[i] ?? "" }));
  return applyEdit(adventureId, specVersionId, { kind: "decision", stageId, title: text(formData, "title"), prompt: text(formData, "prompt"), optionLabels });
}

export async function editEnding(adventureId: string, specVersionId: string, endingId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const reflectionQuestions = text(formData, "reflection_questions").split("\n").map((q) => q.trim()).filter(Boolean);
  return applyEdit(adventureId, specVersionId, { kind: "ending", endingId, title: text(formData, "title"), summary: text(formData, "summary"), divergence: text(formData, "divergence"), reflectionQuestions });
}

export async function editAssumption(adventureId: string, specVersionId: string, assumptionId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return applyEdit(adventureId, specVersionId, { kind: "assumption", assumptionId, text: text(formData, "text"), reason: text(formData, "reason") });
}
