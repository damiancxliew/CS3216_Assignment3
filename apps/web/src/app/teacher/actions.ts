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
import { isCurrentSpriteRecord, OpenAiImageService } from "@adventure/generation/assets";
import { OpenAiLlmClient } from "@adventure/generation/llm";
import { MAP_STYLES, validatePublishedSpec } from "@adventure/generation/spec";

import { type SourceRow, sourcesToDocuments } from "@/lib/adventures/generate-from-sources";
import { advanceGenerationJob, startGenerationJob } from "@/lib/adventures/resumable-generation";
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
} from "@/lib/brief/schema";
import { runBriefTurn, type TurnResult } from "@/lib/brief/turn";
import { parseBriefEdit } from "@/lib/brief/edit";
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

/** Save the edited brief and start a resumable generation job in one action. */
export async function generateFromSources(adventureId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await requireOwnership(adventureId);
  const brief = parseBriefEdit(formData);
  if (!brief) return { error: "Check the brief: fill every field, use 1–6 objectives, and keep ages in order." };
  if (!process.env.OPENAI_API_KEY) return { error: "This feature is temporarily unavailable. Please try again later." };
  const admin = createAdminClient();
  let briefSaved = false;
  try {
    const [adventureResult, sourcesResult, activeResult, draftResult] = await Promise.all([
      admin.from("adventure")
        .select("default_timer_seconds")
        .eq("id", adventureId)
        .single<{ default_timer_seconds: number }>(),
      admin.from("source")
        .select("id, title, kind, page_map, content_hash")
        .eq("adventure_id", adventureId)
        .order("created_at")
        .returns<SourceRow[]>(),
      admin.from("generation_job_state").select("adventure_id").eq("adventure_id", adventureId).maybeSingle(),
      admin.from("spec_version").select("id").eq("adventure_id", adventureId).is("published_at", null).limit(1),
    ]);
    if (adventureResult.error || !adventureResult.data) return { error: "Couldn’t load this adventure. Please try again." };
    if (sourcesResult.error) return { error: "Couldn’t load the sources. Please try again." };
    if (activeResult.error || draftResult.error) return { error: "Couldn’t check generation status. Please try again." };
    if ((draftResult.data ?? []).length > 0) return { error: "Publish or discard the current draft before generating another." };
    if (activeResult.data) return { error: "Story generation is already in progress. Your edits were not saved." };

    const { documents, skipped } = sourcesToDocuments(sourcesResult.data ?? []);
    if (documents.length === 0) return { error: "Add at least one readable source before generating." };

    const { error: saveError } = await supabase.from("adventure").update({
      title: brief.title,
      setting: brief.setting,
      student_role: brief.studentRole,
      learning_objectives: brief.learningObjectives,
      reading_level: brief.readingLevel,
      stage_outline: brief.stageOutline,
    }).eq("id", adventureId);
    if (saveError) {
      console.error("could not update adventure brief", adventureId, saveError);
      return { error: "Couldn’t save the brief. Please try again." };
    }
    briefSaved = true;

    await startGenerationJob(admin, {
      adventureId,
      createdBy: user.id,
      documents,
      warnings: skipped.map((source) => `Skipped source ${source}`),
      teacher: {
        title: brief.title,
        defaultTimerSeconds: adventureResult.data.default_timer_seconds,
        setting: brief.setting,
        studentRole: brief.studentRole,
        learningObjectives: brief.learningObjectives,
        readingLevel: brief.readingLevel,
        stageOutline: brief.stageOutline,
        stageCount: brief.stageOutline.length as 1 | 2 | 3,
      },
    });
    revalidatePath("/teacher");
    revalidatePath(`/teacher/${adventureId}`);
    return { notice: "Story generation started. You can leave this page and return to continue it." };
  } catch (error) {
    console.error("could not start adventure generation", adventureId, error);
    return { error: briefSaved ? "Brief saved, but generation couldn’t start. Please try again." : "Couldn’t start story generation. Please try again." };
  }
}

/** Advance one model attempt or save step. Each call fits within its own function window. */
export async function advanceGeneration(adventureId: string): Promise<ActionResult> {
  await requireOwnership(adventureId);
  try {
    const result = await advanceGenerationJob(createAdminClient(), adventureId);
    if (result.state === "completed") revalidatePath(`/teacher/${adventureId}`);
    return result.state === "failed" ? { error: result.message } : {};
  } catch (error) {
    console.error("could not advance adventure generation", adventureId, error);
    return { error: "Couldn’t continue story generation. Refresh the page and try again." };
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
  if (!process.env.OPENAI_API_KEY) {
    return { error: "Artwork generation is unavailable. Please try publishing later." };
  }
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("publish_adventure_with_assets", {
    p_adventure_id: adventureId,
  });
  if (error) {
    console.error("could not publish adventure", adventureId, error);
    return { error: "Couldn’t publish this adventure. Please try again." };
  }

  // Publishing closes the draft immediately. New student attempts open only
  // after the artwork and walking sprites have settled.
  const { data: published } = await supabase.from("adventure").select("published_version").eq("id", adventureId).single<{ published_version: number }>();
  if (published?.published_version) {
    const version = published.published_version;
    after(() => finishArtworkGeneration(adventureId, version));
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

async function finishArtworkGeneration(adventureId: string, version: number): Promise<void> {
  try {
    const admin = createAdminClient();
    const result = await generateAssetsForVersion({ admin, images: new OpenAiImageService(), adventureId, version });
    if (!result.ok) throw new Error(result.reason);
    const { error } = await admin.from("adventure")
      .update({ assets_ready: true })
      .eq("id", adventureId)
      .eq("published_version", version);
    if (error) throw error;
    console.info("asset generation complete", adventureId, `v${version}`, result);
    revalidatePath(`/teacher/${adventureId}`);
  } catch (error) {
    console.error("asset generation failed", adventureId, `v${version}`, error);
  }
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
export async function generateArtwork(adventureId: string, specVersionId: string): Promise<ActionResult> {
  await requireOwnership(adventureId);

  if (!process.env.OPENAI_API_KEY) {
    console.error("artwork generation unavailable: OPENAI_API_KEY is missing", adventureId);
    return { error: "This feature is temporarily unavailable. Please try again later." };
  }

  const admin = createAdminClient();
  const { data: versionRow } = await admin
    .from("spec_version")
    .select("id, version, published_at")
    .eq("id", specVersionId)
    .eq("adventure_id", adventureId)
    .maybeSingle<{ id: string; version: number; published_at: string | null }>();
  if (!versionRow) return { error: "That version is not part of this adventure." };

  const { data: pending } = await admin
    .from("asset")
    .select("asset_id, updated_at")
    .eq("spec_version_id", versionRow.id)
    .eq("status", "pending")
    .gte("updated_at", new Date(Date.now() - 600_000).toISOString())
    .limit(1)
    .returns<{ asset_id: string; updated_at: string }[]>();
  if (pending && pending.length > 0) {
    return { notice: `Artwork is already being generated for version ${versionRow.version}.` };
  }

  const version = versionRow.version;
  after(() => finishArtworkGeneration(adventureId, version));
  return { notice: `Artwork is being generated for version ${version}; the page will update as each piece lands.` };
}

/** Re-draw one asset and report its actual outcome to the teacher. */
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
    .select("asset_id")
    .eq("spec_version_id", specVersionId)
    .eq("asset_id", assetId)
    .maybeSingle<{ asset_id: string }>();
  if (!record) return { error: "That artwork does not exist yet — generate the set first" };

  try {
    const result = await generateAssetsForVersion({
      admin,
      images: new OpenAiImageService(),
      adventureId,
      version: version.version,
      onlyAssetIds: [assetId],
      ignoreCache: true,
    });
    if (!result.ok) return { error: `Couldn’t regenerate this image: ${result.reason}.` };
    if (result.generated !== 1) {
      if (result.failed === 0) return { error: "This image is no longer eligible for regeneration." };
      const { data: latest } = await admin.from("asset")
        .select("error")
        .eq("spec_version_id", specVersionId)
        .eq("asset_id", assetId)
        .maybeSingle<{ error: string | null }>();
      revalidatePath(`/teacher/${adventureId}`);
      return { error: latest?.error ?? "Couldn’t regenerate this image. Please try again." };
    }
    revalidatePath(`/teacher/${adventureId}`);
    return { notice: "New image ready." };
  } catch (error) {
    console.error("asset regeneration failed", adventureId, assetId, error);
    return { error: "Couldn’t regenerate this image. Please try again." };
  }
}

/** A teacher may explicitly use a sprite that failed the pose check. */
export async function acceptRejectedSprite(adventureId: string, specVersionId: string, assetId: string): Promise<ActionResult> {
  await requireOwnership(adventureId);
  const admin = createAdminClient();
  const { data: version } = await admin.from("spec_version")
    .select("id, json")
    .eq("id", specVersionId)
    .eq("adventure_id", adventureId)
    .maybeSingle<{ id: string; json: unknown }>();
  if (!version) return { error: "That adventure version was not found." };
  const validated = validatePublishedSpec(version.json);
  if (!validated.ok) return { error: "That adventure version cannot be reviewed." };

  const { data: record } = await admin.from("asset")
    .select("asset_id, entity_id, status, url, placeholder_url, prompt_hash, model, error")
    .eq("spec_version_id", specVersionId)
    .eq("asset_id", assetId)
    .eq("kind", "sprite")
    .maybeSingle<{ asset_id: string; entity_id: string; status: string; url: string; placeholder_url: string; prompt_hash: string; model: string | null; error: string | null }>();
  if (!record || record.status !== "failed" || record.url === record.placeholder_url || !/pose template|mix directions/.test(record.error ?? "")) {
    return { error: "There is no rejected sprite to accept." };
  }
  if (!isCurrentSpriteRecord(validated.spec, {
    assetId: record.asset_id,
    entityId: record.entity_id,
    kind: "sprite",
    status: "failed",
    url: record.url,
    placeholderUrl: record.placeholder_url,
    promptHash: record.prompt_hash,
    model: record.model,
    costUsd: 0,
    error: record.error,
  })) return { error: "This sprite uses an older layout. Regenerate it before review." };

  const { data: accepted, error } = await admin.from("asset")
    .update({ status: "ready", error: null, updated_at: new Date().toISOString() })
    .eq("spec_version_id", specVersionId)
    .eq("asset_id", assetId)
    .eq("kind", "sprite")
    .eq("status", "failed")
    .eq("url", record.url)
    .select("asset_id")
    .maybeSingle<{ asset_id: string }>();
  if (error || !accepted) return { error: "This sprite changed during review. Refresh and try again." };
  revalidatePath(`/teacher/${adventureId}`);
  return { notice: "Sprite accepted. It will appear in the game on refresh." };
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
  const visualStyle = z.enum(MAP_STYLES).safeParse(text(formData, "visual_style") || "auto");
  if (!visualStyle.success) return { error: "Choose a listed environment style" };
  return applyEdit(adventureId, specVersionId, { kind: "stage", stageId, title: text(formData, "title"), sharedContext: text(formData, "shared_context"), timerSeconds: timer, mapTheme, visualStyle: visualStyle.data });
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
