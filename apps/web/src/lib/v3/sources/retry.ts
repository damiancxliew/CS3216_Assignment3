import { createHash } from "node:crypto";
import { defineStep, type Json, type JobStore } from "@adventure/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePause, storedBrief } from "../generation/service";
import type { GenerationDeps } from "../generation/deps";

export async function retrySources(
  deps: GenerationDeps,
  store: JobStore,
  userId: string,
  adventureId: string,
  key: string,
  excluded: string[],
) {
  if (
    !(await requirePause(
      deps,
      store,
      userId,
      adventureId,
      "sources",
    ))
  )
    return { error: "Not awaiting sources review." };
  const brief = await storedBrief(store, adventureId);
  if (!brief || !key || key.length > 128)
    return { error: "Invalid retry request." };
  const all = await (deps.sources.loadAll?.(adventureId) ??
    deps.sources.load(adventureId));
  if (
    excluded.some(
      (id) => !all.some((doc) => doc.id === id && doc.origin === "outside"),
    )
  )
    return { error: "Invalid source selection." };
  const hash = createHash("sha256")
    .update(JSON.stringify({ brief, excluded: [...excluded].sort() }))
    .digest("hex");
  const admin = createAdminClient();
  const { error } = await admin.rpc("begin_source_search_v3", {
    p_adventure_id: adventureId,
    p_requester_id: userId,
    p_key: key,
    p_hash: hash,
    p_excluded: excluded,
    p_brief: brief,
  });
  if (error)
    return {
      error: error.message.includes("Idempotency")
        ? "This request key was already used with different inputs."
        : "An import is active or the adventure has continued.",
    };
  return { ok: true as const };
}

export function sourceRetryStep(getDeps: () => GenerationDeps) {
  return defineStep<Json, Json>(
    "v3.sources.retry",
    async ({ input, signal }): Promise<Json> => {
      const { runId, brief } = input as unknown as {
        runId: string;
        brief: Parameters<GenerationDeps["search"]>[0];
      };
      const admin = createAdminClient();
      const deps = getDeps();
      const { data: row, error } = await admin
        .from("source_search_runs_v3")
        .select("state")
        .eq("id", runId)
        .eq("adventure_id", brief.adventureId)
        .single();
      if (error) throw error;
      if (row.state === "ready" || row.state === "failed")
        return { done: true };
      await admin
        .from("source_search_runs_v3")
        .update({ state: "running", updated_at: new Date().toISOString() })
        .eq("id", runId);
      try {
        const result = await deps.passes.sources(
          {
            episode: brief.episode,
            teacherNotes: brief.teacherNotes,
            policy: brief.sourcePolicy,
          },
          { search: deps.search(brief), signal },
        );
        await deps.sources.saveOutside(
          brief.adventureId,
          result.sources,
          result.documents,
        );
        const stored = await (deps.sources.loadAll?.(brief.adventureId) ??
          deps.sources.load(brief.adventureId));
        const acceptedUrls = new Set(
          result.sources.map((source) => source.url),
        );
        const sourceIds = stored
          .filter(
            (source) =>
              source.origin === "outside" && !!source.url && acceptedUrls.has(source.url),
          )
          .map((source) => source.id);
        await deps.recordSearchUsage(brief, result.usage, null);
        const { error: finishError } = await admin
          .from("source_search_runs_v3")
          .update({
            state: "ready",
            diagnostics: result.diagnostics ?? [],
            results: {
              summary: result.summary,
              rejected: result.rejected,
              sourceIds,
            },
            usage: result.usage,
            cost_usd: result.costUsd ?? 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);
        if (finishError) throw finishError;
        return { done: true, costUsd: result.costUsd };
      } catch (cause) {
        const { error: failError } = await admin
          .from("source_search_runs_v3")
          .update({
            state: "failed",
            error: "Source search failed. Try again.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);
        if (failError) throw failError;
        return {
          done: false,
          error: cause instanceof Error ? cause.message : "Search failed",
        };
      }
    },
    { maxAttempts: 2 },
  );
}
