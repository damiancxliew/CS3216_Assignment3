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
import { READING_BANDS } from "@adventure/generation/spec";

import { generateFromSources as runGeneration } from "@/lib/adventures/generate-from-sources";
import { generateAssetsForVersion } from "@/lib/assets/generate";
import { persistSpecVersion, SpecPersistError } from "@/lib/adventures/persist-spec";
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

const newAdventure = z.object({
  title: z.string().trim().min(1, "Give the adventure a title").max(120),
  setting: z.string().trim().max(200).optional(),
});

export async function createAdventure(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const parsed = newAdventure.safeParse({
    title: formData.get("title"),
    setting: formData.get("setting") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { data, error } = await supabase
    .from("adventure")
    .insert({
      owner_id: user.id,
      title: parsed.data.title,
      setting: parsed.data.setting || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(`/teacher/${data.id}`);
}

/**
 * Both source routes land here so a pasted passage and an uploaded PDF are
 * stored identically: pages are the unit of citation (D1/FR-1), so `page_map`
 * always carries per-page text, whatever the teacher dropped in.
 */
async function insertSource(
  adventureId: string,
  storageKey: string,
  doc: ExtractedDocument,
): Promise<ActionResult> {
  const admin = createAdminClient();
  const { error } = await admin.from("source").insert({
    adventure_id: adventureId,
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
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

function extractionMessage(error: unknown): string {
  if (error instanceof ExtractionError) return error.message;
  return error instanceof Error ? error.message : "Could not read that source";
}

export async function addTextSource(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const title = String(formData.get("title") ?? "").trim() || "Pasted source";
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Paste the source text first" };

  let doc: ExtractedDocument;
  try {
    doc = await extractDocument({
      id: slugify(title, "pasted-source"),
      title,
      kind: "text",
      text: body,
    });
  } catch (error) {
    return { error: extractionMessage(error) };
  }

  return insertSource(adventureId, `inline:${crypto.randomUUID()}`, doc);
}

const UPLOAD_KINDS: Record<string, "pdf" | "text"> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
};

/**
 * Upload route for the material a teacher already has: a PDF handout, or a
 * plain-text/markdown passage. The PDF's text layer is extracted server-side —
 * a scanned image has none, and the teacher is told to paste instead rather
 * than getting an adventure grounded in nothing.
 */
export async function addFileSource(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a PDF or text file first" };
  }
  if (file.size > LIMITS.maxUploadBytes) {
    return {
      error: `That file is ${(file.size / 1_048_576).toFixed(1)} MB; the limit is ${LIMITS.maxUploadBytes / 1_048_576} MB`,
    };
  }

  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const kind =
    UPLOAD_KINDS[file.type] ??
    (extension === "pdf" ? "pdf" : ["txt", "md"].includes(extension) ? "text" : null);
  if (!kind) return { error: "Only PDF, .txt and .md files are supported" };

  const title = String(formData.get("title") ?? "").trim() || file.name;
  const bytes = new Uint8Array(await file.arrayBuffer());

  let doc: ExtractedDocument;
  try {
    doc = await extractDocument(
      kind === "pdf"
        ? { id: slugify(file.name), title, kind, bytes }
        : { id: slugify(file.name), title, kind, text: new TextDecoder().decode(bytes) },
    );
  } catch (error) {
    return { error: extractionMessage(error) };
  }

  return insertSource(adventureId, `upload:${crypto.randomUUID()}/${file.name}`, doc);
}

const generationBrief = z.object({
  setting: z.string().trim().min(1, "Describe the setting").max(200),
  studentRole: z.string().trim().min(1, "Say who the student plays").max(200),
  learningObjectives: z
    .string()
    .transform((s) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    .pipe(z.array(z.string().max(300)).min(1, "Give at least one learning objective").max(6, "At most six learning objectives")),
  band: z.enum(READING_BANDS),
  ageMin: z.coerce.number().int().min(7).max(19),
  ageMax: z.coerce.number().int().min(7).max(19),
  stageCount: z.coerce.number().pipe(z.union([z.literal(1), z.literal(2), z.literal(3)])),
});

/**
 * D1–D4 → P5: run the planner over the adventure's stored sources and land the
 * result as the next draft version. The brief (setting, role, objectives,
 * reading level) is the part of the planner's input the adventure row does not
 * hold; FR-1a makes the reading level mandatory, so it is required here too.
 */
export async function generateFromSources(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await requireOwnership(adventureId);

  const parsed = generationBrief.safeParse({
    setting: formData.get("setting"),
    studentRole: formData.get("studentRole"),
    learningObjectives: formData.get("learningObjectives") ?? "",
    band: formData.get("band"),
    ageMin: formData.get("ageMin"),
    ageMax: formData.get("ageMax"),
    stageCount: formData.get("stageCount") ?? 3,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { band, ageMin, ageMax, ...rest } = parsed.data;
  if (ageMin > ageMax) return { error: "The age range is upside down" };

  if (!process.env.OPENAI_API_KEY) {
    return { error: "Generation is not configured on this server (OPENAI_API_KEY is missing)" };
  }

  const admin = createAdminClient();
  const [{ data: adventure }, { data: sources }] = await Promise.all([
    admin
      .from("adventure")
      .select("title, default_timer_seconds")
      .eq("id", adventureId)
      .single<{ title: string; default_timer_seconds: number }>(),
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
  if (!adventure) return { error: "Adventure not found" };

  const result = await runGeneration({
    admin,
    adventureId,
    adventure,
    sources: sources ?? [],
    brief: { ...rest, readingLevel: { band, ageMin, ageMax } },
    llm: new OpenAiLlmClient(),
    createdBy: user.id,
  });
  if (!result.ok) return { error: result.error };

  revalidatePath(`/teacher/${adventureId}`);
  const notes = [
    ...result.missingInformation.map((m) => `Missing from the sources: ${m}`),
    ...result.warnings,
  ];
  return notes.length > 0
    ? { notice: `Draft v${result.version.version} generated. ${notes.join(" · ")}` }
    : { notice: `Draft v${result.version.version} generated.` };
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
  } catch {
    return { error: "That isn’t valid JSON" };
  }

  const admin = createAdminClient();
  try {
    await persistSpecVersion(admin, adventureId, candidate, {
      generatorVersion: "imported",
      createdBy: user.id,
    });
  } catch (error) {
    if (error instanceof SpecPersistError) {
      const detail = error.issues
        .slice(0, 3)
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ");
      return { error: detail ? `${error.message} — ${detail}` : error.message };
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
  if (error) return { error: error.message };

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
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

export async function rotateShareToken(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("rotate_share_token", {
    p_adventure_id: adventureId,
  });
  if (error) return { error: error.message };

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
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/** Edits land on the draft version; the published one is frozen by trigger. */
export async function updateStage(
  adventureId: string,
  stageId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "A stage needs a title" };

  const timer = parseTimer(formData.get("timer_seconds"));
  if (timer === "invalid") {
    return { error: "Leave the timer empty to inherit, or give seconds (0 disables)" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("stage")
    .update({
      title,
      shared_context: String(formData.get("shared_context") ?? ""),
      timer_seconds: timer,
    })
    .eq("id", stageId);
  if (error) return { error: describeFrozen(error.message) };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

export async function updateAgent(
  adventureId: string,
  agentId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A stakeholder needs a name" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("agent")
    .update({
      name,
      role: String(formData.get("role") ?? "") || null,
      public_position: String(formData.get("public_position") ?? "") || null,
    })
    .eq("id", agentId);
  if (error) return { error: describeFrozen(error.message) };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

function describeFrozen(message: string): string {
  return message.includes("immutable")
    ? "This version is published and frozen. Choose “Edit as a new version” first."
    : message;
}
