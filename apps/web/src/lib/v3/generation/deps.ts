/**
 * Dependencies for the v3 generation job steps: the LLM + search clients, source
 * storage, the adventure row writer and the generation passes themselves. Tests
 * inject fakes via `v3GenerationSteps(() => fakeDeps)`; production uses
 * `defaultGenerationDeps()`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseJobStore } from "@adventure/jobs";
import type { AdventureSpec } from "@adventure/spec-v3";
import type { ExtractedDocument } from "@adventure/generation";
import type { LlmClient, LlmUsage } from "@adventure/generation/llm";
import { OpenAiLlmClient } from "@adventure/generation/llm";
import type { OutsideSource } from "@adventure/generation";
import { createOpenAiWebSearch, runSources } from "@adventure/generation";
import type { WebSearchClient } from "@adventure/generation";
import { generateDetails, generateEndings, generateReveal, finalRepair, generateSkeleton } from "@adventure/generation/v3";

import { recordLlmUsage, withJsonUsage } from "@/lib/usage/ledger";
import { createAdminClient } from "@/lib/supabase/admin";
import { portraitsStep } from "@/lib/v3/portraits/step";

import type { GenerationBrief } from "./types";
import { fakeGenerationPasses } from "./fake-passes";

export interface V3SourceStore {
  /** uploads + outside, in insertion order */
  load(adventureId: string): Promise<ExtractedDocument[]>;
  saveUploads(adventureId: string, uploads: { doc: ExtractedDocument; storageKey: string }[]): Promise<void>;
  /** upsert keyed (adventureId, doc.id); retry-safe */
  saveOutside(adventureId: string, sources: OutsideSource[], documents: ExtractedDocument[]): Promise<void>;
  removeOutside(adventureId: string, ids: string[]): Promise<void>;
  /** copies every stored row (uploads and outside docs) to another adventure */
  copyUploads(fromId: string, toId: string): Promise<void>;
}

export interface V3AdventureRow {
  id: string;
  schoolId: string;
  ownerId: string;
  status: "briefing" | "generating" | "needs_review" | "draft" | "published" | "failed" | "archived";
}

export type PauseDraft = { pass: string; edits: unknown[] };

export interface V3AdventureWriter {
  loadPauseDraft(id: string): Promise<PauseDraft | null>;
  savePauseDraft(id: string, draft: PauseDraft): Promise<void>;
  clearPauseDraft(id: string): Promise<void>;
  get(id: string): Promise<V3AdventureRow | null>;
  /** conditional update; true if a row changed */
  setStatus(id: string, to: V3AdventureRow["status"], from: V3AdventureRow["status"][]): Promise<boolean>;
  /** returns spec_version; the same spec twice → the same version (the DB trigger only bumps on change) */
  saveSpec(id: string, spec: AdventureSpec): Promise<number>;
  /** the teacher's saved skeleton draft (raw JSON; it may be semantically broken), or null */
  loadSkeletonDraft(id: string): Promise<unknown>;
  saveSkeletonDraft(id: string, draft: unknown): Promise<void>;
  clearSkeletonDraft(id: string): Promise<void>;
}

export interface GenerationDeps {
  llm(brief: GenerationBrief): LlmClient;
  search(brief: GenerationBrief): WebSearchClient;
  recordSearchUsage(brief: GenerationBrief, usage: LlmUsage, model: string | null): Promise<void>;
  queuePortraits(adventureId: string, version: number): Promise<void>;
  sources: V3SourceStore;
  adventures: V3AdventureWriter;
  passes: {
    sources: typeof runSources;
    skeleton: typeof generateSkeleton;
    details: typeof generateDetails;
    endings: typeof generateEndings;
    reveal: typeof generateReveal;
    check: typeof finalRepair;
  };
}

// --- production deps (clients are built lazily so importing steps.ts needs no env) ---------

function supabaseV3AdventureWriter(getClient: () => SupabaseClient): V3AdventureWriter {
  return {
    async get(id) {
      const { data, error } = await getClient()
        .from("adventures_v3")
        .select("id, school_id, owner_id, status")
        .eq("id", id)
        .maybeSingle<{ id: string; school_id: string; owner_id: string; status: V3AdventureRow["status"] }>();
      if (error) throw error;
      if (!data) return null;
      return { id: data.id, schoolId: data.school_id, ownerId: data.owner_id, status: data.status };
    },
    async setStatus(id, to, from) {
      const { data, error } = await getClient()
        .from("adventures_v3")
        .update({ status: to })
        .eq("id", id)
        .in("status", from)
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async saveSpec(id, spec) {
      const { data, error } = await getClient()
        .from("adventures_v3")
        .update({ spec })
        .eq("id", id)
        .select("spec_version")
        .single<{ spec_version: number }>();
      if (error) throw error;
      return data.spec_version;
    },
    async loadPauseDraft(id) {
      const { data, error } = await getClient().from("adventures_v3").select("pause_draft").eq("id", id).maybeSingle<{ pause_draft: PauseDraft | null }>();
      if (error) throw error;
      return data?.pause_draft ?? null;
    },
    async savePauseDraft(id, draft) {
      const { error } = await getClient().from("adventures_v3").update({ pause_draft: draft }).eq("id", id);
      if (error) throw error;
    },
    async clearPauseDraft(id) {
      const { error } = await getClient().from("adventures_v3").update({ pause_draft: null }).eq("id", id);
      if (error) throw error;
    },
    async loadSkeletonDraft(id) {
      const { data, error } = await getClient().from("adventures_v3").select("skeleton_draft").eq("id", id).maybeSingle<{ skeleton_draft: unknown }>();
      if (error) throw error;
      return data?.skeleton_draft ?? null;
    },
    async saveSkeletonDraft(id, draft) {
      const { error } = await getClient().from("adventures_v3").update({ skeleton_draft: draft }).eq("id", id);
      if (error) throw error;
    },
    async clearSkeletonDraft(id) {
      const { error } = await getClient().from("adventures_v3").update({ skeleton_draft: null }).eq("id", id);
      if (error) throw error;
    },
  };
}

type SourceRow = {
  source_key: string;
  origin: "upload" | "outside";
  kind: string;
  title: string;
  storage_key: string | null;
  url: string | null;
  content_hash: string;
  pages: { page: number; text: string }[];
};

/** sources_v3 (#207): source_key is the document id cited by the spec; pages are the citation unit. */
export function supabaseV3SourceStore(getClient: () => SupabaseClient): V3SourceStore {
  return {
    async load(adventureId) {
      const { data, error } = await getClient()
        .from("sources_v3")
        .select("source_key, origin, kind, title, storage_key, url, content_hash, pages")
        .eq("adventure_id", adventureId)
        .order("created_at")
        .order("source_key")
        .returns<SourceRow[]>();
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.source_key,
        title: row.title,
        origin: row.origin === "outside" ? "outside" as const : "teacher" as const,
        ...(row.url ? { url: row.url } : {}),
        kind: row.kind as ExtractedDocument["kind"],
        contentHash: row.content_hash,
        pages: row.pages ?? [],
        pageCount: (row.pages ?? []).length,
        charCount: (row.pages ?? []).reduce((sum, page) => sum + page.text.length, 0),
        warnings: [],
      }));
    },
    async saveUploads(adventureId, uploads) {
      if (uploads.length === 0) return;
      const { error } = await getClient().from("sources_v3").upsert(
        uploads.map(({ doc, storageKey }) => ({
          adventure_id: adventureId,
          source_key: doc.id,
          origin: "upload" as const,
          kind: doc.kind,
          title: doc.title,
          storage_key: storageKey,
          content_hash: doc.contentHash,
          pages: doc.pages,
        })),
        { onConflict: "adventure_id,source_key" },
      );
      if (error) throw error;
    },
    async saveOutside(adventureId, sources, documents) {
      if (documents.length === 0) return;
      const urlById = new Map(sources.map((source) => [source.id, source.url]));
      const { error } = await getClient().from("sources_v3").upsert(
        documents.map((doc) => ({
          adventure_id: adventureId,
          source_key: doc.id,
          origin: "outside" as const,
          kind: doc.kind,
          title: doc.title,
          url: urlById.get(doc.id) ?? null,
          content_hash: doc.contentHash,
          pages: doc.pages,
        })),
        { onConflict: "adventure_id,source_key" },
      );
      if (error) throw error;
    },
    async removeOutside(adventureId, ids) {
      if (!ids.length) return;
      const { error } = await getClient().from("sources_v3").delete().eq("adventure_id", adventureId).eq("origin", "outside").in("source_key", ids);
      if (error) throw error;
    },
    async copyUploads(fromId, toId) {
      const { data, error } = await getClient()
        .from("sources_v3")
        .select("source_key, origin, kind, title, storage_key, url, content_hash, pages")
        .eq("adventure_id", fromId)
        .returns<SourceRow[]>();
      if (error) throw error;
      if (!data || data.length === 0) return;
      const { error: insertError } = await getClient().from("sources_v3").upsert(
        data.map((row) => ({
          adventure_id: toId,
          source_key: row.source_key,
          origin: row.origin,
          kind: row.kind,
          title: row.title,
          storage_key: row.storage_key,
          url: row.url,
          content_hash: row.content_hash,
          pages: row.pages,
        })),
        { onConflict: "adventure_id,source_key" },
      );
      if (insertError) throw insertError;
    },
  };
}

export function defaultGenerationDeps(): GenerationDeps {
  return {
    llm(brief) {
      // Never pass adventureId: llm_usage.adventure_id is an FK to the v2 adventure table.
      return withJsonUsage(new OpenAiLlmClient({ timeoutMs: 240_000, maxRetries: 0 }), {
        purpose: "generation",
        organizationId: brief.schoolId,
        userId: brief.ownerId,
      });
    },
    search() {
      return createOpenAiWebSearch();
    },
    async recordSearchUsage(brief, usage, model) {
      await recordLlmUsage(createAdminClient, {
        purpose: "generation",
        call: "source_search",
        model,
        ...usage,
        organizationId: brief.schoolId,
        userId: brief.ownerId,
      });
    },
    async queuePortraits(adventureId, version) {
      const step = portraitsStep(adventureId, version);
      try {
        await supabaseJobStore(createAdminClient()).enqueue(adventureId, [
          {
            name: step.name,
            step: step.step ?? step.name,
            input: step.input ?? null,
            deps: [],
            maxAttempts: 6,
          },
        ]);
      } catch (error) {
        if (typeof error === "object" && error !== null) {
          const duplicate = error as { code?: unknown; message?: unknown };
          if (
            duplicate.code === "23505" &&
            typeof duplicate.message === "string" &&
            duplicate.message.includes('constraint "job_steps_job_id_name_key"')
          ) {
            return;
          }
        }
        throw error;
      }
    },
    sources: supabaseV3SourceStore(createAdminClient),
    adventures: supabaseV3AdventureWriter(createAdminClient),
    passes:
      // dev-only: V3_FAKE_PASSES swaps in canned passes so the flow runs without OpenAI
      fakeGenerationPasses() ?? { sources: runSources, skeleton: generateSkeleton, details: generateDetails, endings: generateEndings, reveal: generateReveal, check: finalRepair },
  };
}

// --- in-memory stores for tests ---------------------------------------------------------------

export function memoryV3SourceStore() {
  const rows = new Map<string, { doc: ExtractedDocument; storageKey: string; outside?: OutsideSource }[]>();
  return {
    rows,
    async load(adventureId: string) {
      return (rows.get(adventureId) ?? []).map((row) => ({ ...row.doc, origin: row.outside ? "outside" as const : "teacher" as const, ...(row.outside ? { url: row.outside.url } : {}) }));
    },
    async saveUploads(adventureId: string, uploads: { doc: ExtractedDocument; storageKey: string }[]) {
      const list = rows.get(adventureId) ?? [];
      for (const upload of uploads) if (!list.some((row) => row.doc.id === upload.doc.id)) list.push({ doc: upload.doc, storageKey: upload.storageKey });
      rows.set(adventureId, list);
    },
    async saveOutside(adventureId: string, sources: OutsideSource[], documents: ExtractedDocument[]) {
      const list = rows.get(adventureId) ?? [];
      const byId = new Map(sources.map((s, i) => [documents[i]!.id, s]));
      for (const doc of documents) {
        const existing = list.findIndex((row) => row.doc.id === doc.id);
        const entry = { doc, storageKey: `outside:${doc.id}`, outside: byId.get(doc.id) };
        if (existing >= 0) list[existing] = entry;
        else list.push(entry);
      }
      rows.set(adventureId, list);
    },
    async removeOutside(adventureId: string, ids: string[]) {
      rows.set(adventureId, (rows.get(adventureId) ?? []).filter(row => !row.outside || !ids.includes(row.doc.id)));
    },
    async copyUploads(fromId: string, toId: string) {
      const list = rows.get(toId) ?? [];
      for (const row of rows.get(fromId) ?? []) if (!list.some((existing) => existing.doc.id === row.doc.id)) list.push({ ...row });
      rows.set(toId, list);
    },
  } satisfies V3SourceStore & { rows: Map<string, { doc: ExtractedDocument; storageKey: string; outside?: OutsideSource }[]> };
}

export function memoryV3AdventureWriter(initial: V3AdventureRow[] = []) {
  const rows = new Map<string, { row: V3AdventureRow; spec: AdventureSpec | null; specVersion: number }>();
  const skeletonDrafts = new Map<string, unknown>();
  const pauseDrafts = new Map<string, PauseDraft>();
  for (const row of initial) rows.set(row.id, { row: { ...row }, spec: null, specVersion: 0 });
  return {
    rows,
    async get(id: string) {
      const entry = rows.get(id);
      return entry ? { ...entry.row } : null;
    },
    async setStatus(id: string, to: V3AdventureRow["status"], from: V3AdventureRow["status"][]) {
      const entry = rows.get(id);
      if (!entry || !from.includes(entry.row.status)) return false;
      entry.row.status = to;
      return true;
    },
    async saveSpec(id: string, spec: AdventureSpec) {
      const entry = rows.get(id);
      if (!entry) throw new Error(`no adventure ${id}`);
      if (JSON.stringify(entry.spec) !== JSON.stringify(spec)) {
        entry.spec = spec;
        entry.specVersion += 1;
      }
      return entry.specVersion;
    },
    async loadPauseDraft(id: string) { return structuredClone(pauseDrafts.get(id) ?? null); },
    async savePauseDraft(id: string, draft: PauseDraft) { pauseDrafts.set(id, structuredClone(draft)); },
    async clearPauseDraft(id: string) { pauseDrafts.delete(id); },
    skeletonDrafts,
    async loadSkeletonDraft(id: string) {
      return skeletonDrafts.get(id) ?? null;
    },
    async saveSkeletonDraft(id: string, draft: unknown) {
      skeletonDrafts.set(id, draft);
    },
    async clearSkeletonDraft(id: string) {
      skeletonDrafts.delete(id);
    },
  } satisfies V3AdventureWriter & { rows: Map<string, { row: V3AdventureRow; spec: AdventureSpec | null; specVersion: number }>; skeletonDrafts: Map<string, unknown> };
}
