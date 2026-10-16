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
import { OpenAiLlmClient } from "@adventure/generation/llm";
import { supabaseJobStore } from "@adventure/jobs";

import { getViewer, isStaff, type Viewer } from "@/lib/auth/viewer";
import { getJobs, kickTick } from "@/lib/jobs/runner";
import { tickUrl } from "@/lib/jobs/tick";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withJsonUsage } from "@/lib/usage/ledger";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { briefTurnV3 } from "@/lib/v3/brief/turn";
import type { BriefInputV3, BriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { dedupeUploadIds } from "@/lib/v3/generation/dedupe";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { approveSkeleton, getGenerationProgress, restartGeneration, startFromBrief } from "@/lib/v3/generation/service";

const UPLOAD_KINDS: Record<string, "pdf" | "text"> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
};

const clientPagesSchema = z.array(z.string()).min(1).max(LIMITS.maxPages);

const notFound = { error: "not_found" } as const;

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

async function requireStaff(): Promise<{ viewer: Viewer; userId: string; schoolId: string } | { error: string }> {
  if (!v3Enabled()) return notFound;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer) || !viewer.membership) return notFound;
  return { viewer, userId: viewer.user.id, schoolId: viewer.membership.organizationId };
}

/** Loads a briefing row and checks the caller owns it and the school is allowed. */
async function requireBriefingRow(adventureId: string, userId: string) {
  const store = supabaseV3BriefStore(createAdminClient());
  const row = await store.load(adventureId);
  if (!row || row.ownerId !== userId || !v3SchoolAllowed(row.schoolId)) return null;
  return { store, row };
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

/** Opens a new guided brief: a `briefing` row the chat then fills in. */
export async function startV3Brief() {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  if (!v3SchoolAllowed(auth.schoolId)) return notFound;

  try {
    const adventureId = await supabaseV3BriefStore(createAdminClient()).create({
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
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  const context = await requireBriefingRow(adventureId, auth.userId);
  if (!context || context.row.status !== "briefing" || !context.row.state) return notFound;

  if (!process.env.OPENAI_API_KEY) {
    console.error("v3 brief assistant unavailable: OPENAI_API_KEY is missing");
    return { ok: false as const, error: "This feature is temporarily unavailable. Please try again later." };
  }

  let documents: ExtractedDocument[] = [];
  try {
    documents = await defaultGenerationDeps().sources.load(adventureId);
  } catch {
    // sources_v3 is not available yet; the digest then behaves as if no sources
  }

  const result = await briefTurnV3(context.row.state, input, {
    llm: withJsonUsage(new OpenAiLlmClient({ timeoutMs: 90_000 }), {
      purpose: "brief",
      organizationId: context.row.schoolId,
      userId: auth.userId,
    }),
    documents,
  });
  if (!result.ok) return result;
  await context.store.save(adventureId, result.state);
  return result;
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

  const store = supabaseJobStore(createAdminClient());
  return getGenerationProgress(defaultGenerationDeps(), getJobs(), store, adventure);
}
