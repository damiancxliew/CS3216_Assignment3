"use server";

/**
 * Teacher-facing v3 generation actions: start a generation job, approve the
 * skeleton in standard mode, and poll progress. Everything is behind V3_ENABLED
 * plus the school allowlist.
 */
import { after } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";

import { extractDocument, ExtractionError, LIMITS, slugify } from "@adventure/generation";
import type { ExtractedDocument } from "@adventure/generation";
import { supabaseJobStore } from "@adventure/jobs";

import { getViewer, isStaff } from "@/lib/auth/viewer";
import { getJobs, kickTick } from "@/lib/jobs/runner";
import { tickUrl } from "@/lib/jobs/tick";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { dedupeUploadIds } from "@/lib/v3/generation/dedupe";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { approveSkeleton, getGenerationProgress, startGeneration } from "@/lib/v3/generation/service";

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

export async function startV3Generation(formData: FormData) {
  if (!v3Enabled()) return notFound;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer) || !viewer.membership) return notFound;

  const uploads: { doc: ExtractedDocument; storageKey: string }[] = [];
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const bodies = [formData.get("body"), ...formData.getAll("bodies")].map((b) => String(b ?? "").trim()).filter(Boolean);
  if (files.length === 0 && bodies.length === 0) return { error: "Upload at least one source" };

  // one body and/or files, mirroring v2's extractUpload per entry
  for (const body of bodies) {
    const single = new FormData();
    single.set("body", body);
    const extracted = await extractUpload(single);
    if ("error" in extracted) return extracted;
    uploads.push(extracted);
  }
  for (const file of files) {
    const single = new FormData();
    single.set("file", file);
    const pages = formData.get(`pages:${file.name}`);
    if (pages !== null) single.set("pages", String(pages));
    const extracted = await extractUpload(single);
    if ("error" in extracted) return extracted;
    uploads.push(extracted);
  }

  const episode = String(formData.get("episode") ?? "");
  const teacherNotes = String(formData.get("teacherNotes") ?? "").trim();
  const readingLevel = String(formData.get("readingLevel") ?? "");
  const mode = String(formData.get("mode") ?? "");
  if (readingLevel !== "sec" && readingLevel !== "jc") return { error: "Choose a reading level" };
  if (mode !== "quick" && mode !== "standard") return { error: "Choose a mode" };

  const schoolId = viewer.membership.organizationId;
  const userId = viewer.user.id;
  const result = await startGeneration(
    defaultGenerationDeps(),
    getJobs(),
    {
      userId,
      schoolId,
      createAdventure: async () => {
        const { data, error } = await supabase
          .from("adventures_v3")
          .insert({ school_id: schoolId, owner_id: userId })
          .select("id")
          .single<{ id: string }>();
        if (error) throw new Error(error.message);
        return data.id;
      },
    },
    {
      episode,
      ...(teacherNotes !== "" ? { teacherNotes } : {}),
      readingLevel,
      mode,
      uploads: dedupeUploadIds(uploads),
    },
    process.env,
  );
  if ("error" in result) return result;

  await kickAfter();
  return result;
}

export async function approveV3Skeleton(adventureId: string, skeleton?: unknown) {
  if (!v3Enabled()) return notFound;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer)) return notFound;

  const store = supabaseJobStore(createAdminClient());
  const result = await approveSkeleton(defaultGenerationDeps(), getJobs(), store, viewer.user.id, adventureId, skeleton, process.env);
  if ("error" in result) return result;

  await kickAfter();
  return result;
}

export async function getV3GenerationProgress(adventureId: string) {
  if (!v3Enabled()) return notFound;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer)) return notFound;

  // the user's client: RLS covers owner, org admin and sysadmin
  const { data } = await supabase
    .from("adventures_v3")
    .select("id, school_id, owner_id, status")
    .eq("id", adventureId)
    .maybeSingle<{ id: string; school_id: string; owner_id: string; status: "generating" | "needs_review" | "draft" | "published" | "failed" | "archived" }>();
  if (!data) return notFound;

  const adventure = { id: data.id, schoolId: data.school_id, ownerId: data.owner_id, status: data.status };
  if (!v3SchoolAllowed(adventure.schoolId)) return notFound;

  const store = supabaseJobStore(createAdminClient());
  return getGenerationProgress(defaultGenerationDeps(), getJobs(), store, adventure);
}
