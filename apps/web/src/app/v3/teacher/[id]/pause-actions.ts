"use server";
import { retrySources } from "@/lib/v3/sources/retry";
import { supabaseJobStore } from "@adventure/jobs";
import { validateSkeleton } from "@adventure/spec-v3";
import { after } from "next/server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { tickUrl } from "@/lib/jobs/tick";
import { getJobs, kickTick } from "@/lib/jobs/runner";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { continueFromSources, continuePause, savePauseEdits, requirePause, loadPause, skeletonIssues, pausedPass, type EditablePass } from "@/lib/v3/generation/service";
import { capturedSources } from "@/lib/v3/edit/apply";
import { proposeEditFix, proposeSkeletonFix } from "@/lib/v3/edit/ai-fix";
import { editFixLlm } from "@/lib/v3/edit/ai-deps";
import { V3Edit } from "@/lib/v3/edit/commands";
import { z } from "zod";

async function context() {
  if (!v3Enabled()) return null;
  const { data: { user } } = await (await createClient()).auth.getUser();
  return user ? { userId: user.id, deps: defaultGenerationDeps(), store: supabaseJobStore(createAdminClient()) } : null;
}
async function continued(adventureId: string) {
  revalidatePath(`/v3/teacher/${adventureId}`, "layout");
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const url = process.env.JOBS_TICK_URL ?? (host ? tickUrl(`${requestHeaders.get("x-forwarded-proto") ?? "https"}://${host}`) : null);
  if (url) after(() => kickTick(url));
}
export async function continueFromSourcesAction(adventureId: string, removedSourceIds: string[]) {
  const ctx = await context();
  if (!ctx) return { error: "not_found" };
  const result = await continueFromSources(ctx.deps, getJobs(), ctx.store, ctx.userId, adventureId, removedSourceIds, process.env);
  if ("ok" in result) await continued(adventureId);
  return result;
}
export async function savePauseEditsAction(adventureId: string, pass: EditablePass, edits: unknown) {
  const ctx = await context();
  if (!ctx) return { ok: false as const, errors: [{ code: "access", path: "", message: "Not found." }] };
  const result = await savePauseEdits(ctx.deps, ctx.store, ctx.userId, adventureId, pass, edits, process.env);
  if (result.ok) revalidatePath(`/v3/teacher/${adventureId}`, "layout");
  return result;
}
export async function continuePauseAction(adventureId: string, pass: EditablePass, edits: unknown) {
  const ctx = await context();
  if (!ctx) return { error: "not_found" };
  const result = await continuePause(ctx.deps, getJobs(), ctx.store, ctx.userId, adventureId, pass, edits, process.env);
  if ("ok" in result) await continued(adventureId);
  return result;
}
export async function fixPauseEditsWithAiAction(adventureId: string, pass: EditablePass, edits: unknown) {
  const ctx = await context();
  if (!ctx || !["details", "endings", "reveal"].includes(pass)) return { error: "not_found" };
  const adventure = await requirePause(ctx.deps, ctx.store, ctx.userId, adventureId, pass, process.env);
  const pause = adventure ? await loadPause(ctx.deps, ctx.store, adventure) : null;
  if (!adventure || !pause || !("base" in pause)) return { error: "not_found" };
  const parsed = z.array(V3Edit).max(2000).safeParse(edits);
  if (!parsed.success) return { error: "Invalid editing commands." };
  return proposeEditFix({ llm: editFixLlm(adventureId, adventure.schoolId, ctx.userId) }, {
    base: pause.base, edits: parsed.data, sources: capturedSources(await ctx.deps.sources.load(adventureId)),
  });
}
export async function fixSkeletonWithAiAction(adventureId: string, edited: unknown) {
  const ctx = await context();
  if (!ctx) return { error: "not_found" };
  const adventure = await ctx.deps.adventures.get(adventureId);
  // Standard mode also reviews the skeleton; apply the same owner/flag/pass guards.
  if (!adventure || adventure.ownerId !== ctx.userId || !v3SchoolAllowed(adventure.schoolId) || adventure.status !== "needs_review" || pausedPass(await ctx.store.list(adventureId)) !== "skeleton") return { error: "not_found" };
  const output = (await ctx.store.outputs(adventureId, ["skeleton"])).skeleton as { skeleton?: unknown } | undefined;
  const base = validateSkeleton(output?.skeleton);
  if (!base.ok) return { error: "Invalid stored skeleton." };
  return proposeSkeletonFix({ llm: editFixLlm(adventureId, adventure.schoolId, ctx.userId) }, {
    base: base.spec, edited, issues: raw => skeletonIssues(ctx.deps, adventureId, raw),
  });
}

export async function retrySourcesAction(adventureId: string, key: string, excluded: string[]) {
  const ctx = await context();
  if (!ctx) return { error: "Not found." };
  const result = await retrySources(ctx.deps, getJobs(), ctx.store, ctx.userId, adventureId, key, excluded);
  if ("ok" in result) await continued(adventureId);
  return result;
}
export async function saveSourceSelectionAction(adventureId: string, excluded: string[]) {
  const ctx = await context();
  if (!ctx || !await requirePause(ctx.deps, ctx.store, ctx.userId, adventureId, "sources", process.env)) return { error: "Not awaiting review." };
  const all = await ctx.deps.sources.loadAll!(adventureId);
  if (excluded.some(id => !all.some(doc => doc.id === id && doc.origin === "outside"))) return { error: "Invalid selection." };
  const { error } = await createAdminClient().rpc("save_source_selection_v3", { p_adventure_id: adventureId, p_excluded: excluded });
  return error ? { error: "Could not save source selection." } : { ok: true };
}
