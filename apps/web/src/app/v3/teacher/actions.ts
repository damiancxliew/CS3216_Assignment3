"use server";

/**
 * Teacher-facing v3 actions: the guided brief (start, turn, source upload,
 * discard, confirm, restart), skeleton approval and generation progress.
 * Everything is behind V3_ENABLED plus the school allowlist; state is loaded
 * from the store on the server, never trusted from the client.
 */
import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { extractDocument, ExtractionError, LIMITS, slugify } from "@adventure/generation";
import type { ExtractedDocument } from "@adventure/generation";
import { supabaseJobStore } from "@adventure/jobs";

import { getJobs, kickTick } from "@/lib/jobs/runner";
import { tickUrl } from "@/lib/jobs/tick";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { v3SchoolAllowed } from "@/lib/v3/flag";
import { requireStaff, requireBriefingRow, runV3BriefTurn } from "@/lib/v3/brief/service";
import type { BriefInputV3, BriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { dedupeUploadIds } from "@/lib/v3/generation/dedupe";
import { allowKick, shouldKick } from "@/lib/v3/generation/heal";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { approveSkeleton, discardSkeletonDraft, getGenerationProgress, restartGeneration, saveSkeletonDraft, startFromBrief } from "@/lib/v3/generation/service";

const UPLOAD_KINDS: Record<string, "pdf" | "text"> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
};

const clientPagesSchema = z.array(z.string()).min(1).max(LIMITS.maxPages);

const notFound = { error: "not_found" } as const;

/** Per-adventure throttle for poll-triggered kicks (per instance). */
const pollKicks = new Map<string, number>();

let loggedNoKickUrl = false;

/** Kick the job tick from the request's host; never throws — the timer is the safety net. */
async function kickAfter() {
  if (!process.env.JOBS_TICK_URL) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (!host) {
      if (!loggedNoKickUrl) {
        console.error("JOBS_TICK_URL is unset and the request has no host header — skipping the tick kick");
        loggedNoKickUrl = true;
      }
      return;
    }
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
    after(() => kickTick(tickUrl(`${proto}://${host}`)));
    return;
  }
  after(() => kickTick(tickUrl("")));
}

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

/** Opens a guided brief — reusing the owner's most recent untouched row if there is one. */
export async function startV3Brief() {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  if (!v3SchoolAllowed(auth.schoolId)) return notFound;

  const store = supabaseV3BriefStore(createAdminClient());
  try {
    const existing = await store.findUntouched(auth.userId);
    if (existing) return { adventureId: existing };
    const adventureId = await store.create({
      schoolId: auth.schoolId,
      ownerId: auth.userId,
    });
    return { adventureId };
  } catch (error) {
    console.error("could not create v3 brief", error);
    return { error: "Couldn’t start a new adventure. Please try again." };
  }
}

export async function v3BriefTurn(adventureId: string, input: BriefInputV3) {
  return runV3BriefTurn(adventureId, input);
}

/** Adds one uploaded or pasted source to a briefing, deduped against the ids already there. */
export async function addV3BriefSource(adventureId: string, formData: FormData) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  const context = await requireBriefingRow(adventureId, auth.userId);
  if (!context || context.row.status !== "briefing" || !context.row.state) return notFound;

  const extracted = await extractUpload(formData);
  if ("error" in extracted) return { ok: false as const, error: extracted.error };

  const state = context.row.state;
  const doc = dedupeUploadIds([
    ...state.sources.map((source) => ({ doc: { id: source.id } as ExtractedDocument, storageKey: "" })),
    extracted,
  ]).at(-1)!.doc;

  try {
    await defaultGenerationDeps().sources.saveUploads(adventureId, [{ doc, storageKey: extracted.storageKey }]);
  } catch (error) {
    console.error("could not save v3 brief source", error);
    return { ok: false as const, error: "Couldn’t save that source. Please try again." };
  }

  const next: BriefStateV3 = {
    ...state,
    sources: [...state.sources, { id: doc.id, title: doc.title, kind: doc.kind === "pdf" ? "pdf" : "text" }],
  };
  await context.store.save(adventureId, next);
  return { ok: true as const, state: next };
}

export async function discardV3Brief(adventureId: string) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  const context = await requireBriefingRow(adventureId, auth.userId);
  if (!context || context.row.status !== "briefing") return notFound;

  const discarded = await context.store.discard(adventureId);
  return discarded ? { ok: true as const } : { error: "Couldn’t discard this setup. Please try again." };
}

/** The confirm slot's "Create": transitions briefing → generating and queues the steps. */
export async function createFromV3Brief(adventureId: string) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;

  const result = await startFromBrief(
    defaultGenerationDeps(),
    getJobs(),
    supabaseV3BriefStore(createAdminClient()),
    auth.userId,
    adventureId,
    process.env,
  );
  if ("error" in result) return result;
  await kickAfter();
  return result;
}

/** "Start again" on a failed adventure: a fresh briefing row with uploads and the old brief. */
export async function restartV3Generation(adventureId: string) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;

  return restartGeneration(
    defaultGenerationDeps(),
    supabaseV3BriefStore(createAdminClient()),
    supabaseJobStore(createAdminClient()),
    auth.userId,
    adventureId,
    process.env,
  );
}

/** Autosaves the teacher's in-progress skeleton edits (raw JSON; may be mid-edit broken). */
export async function saveV3SkeletonDraft(adventureId: string, draft: unknown) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  const result = await saveSkeletonDraft(defaultGenerationDeps(), auth.userId, adventureId, draft, process.env);
  return "ok" in result ? { ok: true as const, savedAt: new Date().toISOString() } : result;
}

/** Reverts to the generated skeleton by clearing the saved draft. */
export async function discardV3SkeletonDraft(adventureId: string) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  return discardSkeletonDraft(defaultGenerationDeps(), auth.userId, adventureId, process.env);
}

export async function approveV3Skeleton(adventureId: string, skeleton?: unknown) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;

  const store = supabaseJobStore(createAdminClient());
  const result = await approveSkeleton(defaultGenerationDeps(), getJobs(), store, auth.userId, adventureId, skeleton, process.env);
  if ("error" in result) return result;

  await kickAfter();
  return result;
}

export async function getV3GenerationProgress(adventureId: string) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;

  const supabase = await createClient();
  // the user's client: RLS covers owner, org admin and sysadmin
  const { data } = await supabase
    .from("adventures_v3")
    .select("id, school_id, owner_id, status")
    .eq("id", adventureId)
    .maybeSingle<{ id: string; school_id: string; owner_id: string; status: "briefing" | "generating" | "needs_review" | "draft" | "published" | "failed" | "archived" }>();
  if (!data) return notFound;

  const adventure = { id: data.id, schoolId: data.school_id, ownerId: data.owner_id, status: data.status };
  if (!v3SchoolAllowed(adventure.schoolId)) return notFound;

  // self-healing: a ready step with no in-flight tick gets a spare kick from the poll
  if (adventure.status === "generating") {
    const jobs = getJobs();
    const progress = await jobs.getProgress(adventureId);
    const now = Date.now();
    if (progress && shouldKick(progress.steps, now) && allowKick(pollKicks, adventureId, now)) {
      await kickAfter().catch(() => {});
    }
  }

  const store = supabaseJobStore(createAdminClient());
  return getGenerationProgress(defaultGenerationDeps(), getJobs(), store, adventure);
}
