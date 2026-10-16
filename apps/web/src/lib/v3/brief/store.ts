/**
 * The adventures_v3 rows behind the guided brief. The migration (#223) adds
 * `status: 'briefing'` plus `brief_state`, `skeleton_draft` and `title` columns;
 * this store is written against exactly that shape. Writes go through the
 * admin client after an explicit owner check; listing uses the user's client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { briefStateV3Schema, initialBriefStateV3, type BriefStateV3 } from "./schema";

export interface V3BriefRow {
  id: string;
  ownerId: string;
  schoolId: string;
  status: string;
  title: string | null;
  state: BriefStateV3 | null;
}

export interface V3BriefListRow {
  id: string;
  title: string | null;
  status: string;
  updatedAt: string;
}

export interface V3BriefStore {
  /** inserts a `briefing` row with an initial state; returns its id */
  create(input: { schoolId: string; ownerId: string }): Promise<string>;
  load(id: string): Promise<V3BriefRow | null>;
  save(id: string, state: BriefStateV3): Promise<void>;
  /** conditional briefing → generating; sets the title and clears brief_state */
  startFromBrief(id: string, title: string): Promise<boolean>;
  /** deletes the row, only while briefing */
  discard(id: string): Promise<boolean>;
  /** the owner's rows for the /teacher list, excluding archived */
  listForOwner(ownerId: string): Promise<V3BriefListRow[]>;
}

type StoredRow = {
  id: string;
  school_id: string;
  owner_id: string;
  status: string;
  title: string | null;
  brief_state: unknown;
  updated_at: string;
};

function toBriefRow(row: StoredRow): V3BriefRow {
  const state = briefStateV3Schema.safeParse(row.brief_state);
  return {
    id: row.id,
    ownerId: row.owner_id,
    schoolId: row.school_id,
    status: row.status,
    title: row.title,
    state: state.success ? state.data : null,
  };
}

export function supabaseV3BriefStore(client: SupabaseClient): V3BriefStore {
  return {
    async create({ schoolId, ownerId }) {
      const { data, error } = await client
        .from("adventures_v3")
        .insert({ school_id: schoolId, owner_id: ownerId, status: "briefing", brief_state: {} })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      const state = initialBriefStateV3(data.id);
      const { error: updateError } = await client.from("adventures_v3").update({ brief_state: state }).eq("id", data.id);
      if (updateError) throw updateError;
      return data.id;
    },
    async load(id) {
      const { data, error } = await client
        .from("adventures_v3")
        .select("id, school_id, owner_id, status, title, brief_state, updated_at")
        .eq("id", id)
        .maybeSingle<StoredRow>();
      if (error) throw error;
      return data ? toBriefRow(data) : null;
    },
    async save(id, state) {
      const { error } = await client.from("adventures_v3").update({ brief_state: state }).eq("id", id);
      if (error) throw error;
    },
    async startFromBrief(id, title) {
      const { data, error } = await client
        .from("adventures_v3")
        .update({ status: "generating", title, brief_state: null })
        .eq("id", id)
        .eq("status", "briefing")
        .select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async discard(id) {
      const { data, error } = await client.from("adventures_v3").delete().eq("id", id).eq("status", "briefing").select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async listForOwner(ownerId) {
      const { data, error } = await client
        .from("adventures_v3")
        .select("id, title, status, updated_at")
        .eq("owner_id", ownerId)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .returns<Pick<StoredRow, "id" | "title" | "status" | "updated_at">[]>();
      if (error) throw error;
      return (data ?? []).map((row) => ({ id: row.id, title: row.title, status: row.status, updatedAt: row.updated_at }));
    },
  };
}

export function memoryV3BriefStore() {
  const rows = new Map<string, StoredRow>();
  const store: V3BriefStore & { rows: Map<string, StoredRow> } = {
    rows,
    async create({ schoolId, ownerId }) {
      const id = crypto.randomUUID();
      rows.set(id, {
        id,
        school_id: schoolId,
        owner_id: ownerId,
        status: "briefing",
        title: null,
        brief_state: initialBriefStateV3(id),
        updated_at: new Date().toISOString(),
      });
      return id;
    },
    async load(id) {
      const row = rows.get(id);
      return row ? toBriefRow({ ...row, brief_state: JSON.parse(JSON.stringify(row.brief_state)) }) : null;
    },
    async save(id, state) {
      const row = rows.get(id);
      if (!row) throw new Error(`no adventure ${id}`);
      row.brief_state = state;
      row.updated_at = new Date().toISOString();
    },
    async startFromBrief(id, title) {
      const row = rows.get(id);
      if (!row || row.status !== "briefing") return false;
      row.status = "generating";
      row.title = title;
      row.brief_state = null;
      return true;
    },
    async discard(id) {
      const row = rows.get(id);
      if (!row || row.status !== "briefing") return false;
      return rows.delete(id);
    },
    async listForOwner(ownerId) {
      return [...rows.values()]
        .filter((row) => row.owner_id === ownerId && row.status !== "archived")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((row) => ({ id: row.id, title: row.title, status: row.status, updatedAt: row.updated_at }));
    },
  };
  return store;
}
