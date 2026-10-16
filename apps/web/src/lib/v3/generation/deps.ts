/**
 * Dependencies for the v3 generation job steps: the LLM + search clients, source
 * storage, the adventure row writer and the generation passes themselves. Tests
 * inject fakes via `v3GenerationSteps(() => fakeDeps)`; production uses
 * `defaultGenerationDeps()`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdventureSpec } from "@adventure/spec-v3";
import type { ExtractedDocument } from "@adventure/generation";
import type { LlmClient, LlmUsage } from "@adventure/generation/llm";
import { OpenAiLlmClient } from "@adventure/generation/llm";
import type { OutsideSource } from "@adventure/generation";
import { createOpenAiWebSearch, runSources } from "@adventure/generation";
import type { WebSearchClient } from "@adventure/generation";
import { generateDetails, generateEndings, generateReveal, generateSkeleton } from "@adventure/generation/v3";

import { recordLlmUsage, withJsonUsage } from "@/lib/usage/ledger";
import { createAdminClient } from "@/lib/supabase/admin";

import type { GenerationBrief } from "./types";

export interface V3SourceStore {
  /** uploads + outside, in insertion order */
  load(adventureId: string): Promise<ExtractedDocument[]>;
  saveUploads(adventureId: string, uploads: { doc: ExtractedDocument; storageKey: string }[]): Promise<void>;
  /** upsert keyed (adventureId, doc.id); retry-safe */
  saveOutside(adventureId: string, sources: OutsideSource[], documents: ExtractedDocument[]): Promise<void>;
  /** copies every stored row (uploads and outside docs) to another adventure */
  copyUploads(fromId: string, toId: string): Promise<void>;
}

export interface V3AdventureRow {
  id: string;
  schoolId: string;
  ownerId: string;
  status: "briefing" | "generating" | "needs_review" | "draft" | "published" | "failed" | "archived";
}

export interface V3AdventureWriter {
  get(id: string): Promise<V3AdventureRow | null>;
  /** conditional update; true if a row changed */
  setStatus(id: string, to: V3AdventureRow["status"], from: V3AdventureRow["status"][]): Promise<boolean>;
  /** returns spec_version; the same spec twice → the same version (the DB trigger only bumps on change) */
  saveSpec(id: string, spec: AdventureSpec): Promise<number>;
}

export interface GenerationDeps {
  llm(brief: GenerationBrief): LlmClient;
  search(brief: GenerationBrief): WebSearchClient;
  recordSearchUsage(brief: GenerationBrief, usage: LlmUsage, model: string | null): Promise<void>;
  sources: V3SourceStore;
  adventures: V3AdventureWriter;
  passes: {
    sources: typeof runSources;
    skeleton: typeof generateSkeleton;
    details: typeof generateDetails;
    endings: typeof generateEndings;
    reveal: typeof generateReveal;
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
  };
}

/** sources_v3 does not exist yet (Damian is adding it); fail loudly rather than silently drop. */
const unavailableSources: V3SourceStore = {
  async load() {
    throw new Error("sources_v3 is not available yet");
  },
  async saveUploads() {
    throw new Error("sources_v3 is not available yet");
  },
  async saveOutside() {
    throw new Error("sources_v3 is not available yet");
  },
  async copyUploads() {
    throw new Error("sources_v3 is not available yet");
  },
};

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
    sources: unavailableSources,
    adventures: supabaseV3AdventureWriter(createAdminClient),
    passes: { sources: runSources, skeleton: generateSkeleton, details: generateDetails, endings: generateEndings, reveal: generateReveal },
  };
}

// --- in-memory stores for tests ---------------------------------------------------------------

export function memoryV3SourceStore() {
  const rows = new Map<string, { doc: ExtractedDocument; storageKey: string; outside?: OutsideSource }[]>();
  return {
    rows,
    async load(adventureId: string) {
      return (rows.get(adventureId) ?? []).map((row) => row.doc);
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
    async copyUploads(fromId: string, toId: string) {
      const list = rows.get(toId) ?? [];
      for (const row of rows.get(fromId) ?? []) if (!list.some((existing) => existing.doc.id === row.doc.id)) list.push({ ...row });
      rows.set(toId, list);
    },
  } satisfies V3SourceStore & { rows: Map<string, { doc: ExtractedDocument; storageKey: string; outside?: OutsideSource }[]> };
}

export function memoryV3AdventureWriter(initial: V3AdventureRow[] = []) {
  const rows = new Map<string, { row: V3AdventureRow; spec: AdventureSpec | null; specVersion: number }>();
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
  } satisfies V3AdventureWriter & { rows: Map<string, { row: V3AdventureRow; spec: AdventureSpec | null; specVersion: number }> };
}
