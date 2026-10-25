import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MediaSnapshot,
  type MediaSnapshot as Snapshot,
} from "@adventure/spec-v3";
import type { MediaTarget, ReadyCandidate } from "./resolvers";
export type MediaCandidate = {
  id: string;
  adventureId: string;
  creatorId: string;
  target: MediaTarget;
  origin: Snapshot["origin"];
  state: "pending" | "ready" | "failed";
  snapshot: Snapshot | null;
  specVersion: number;
  failure: string | null;
  costUsd: number;
  createdAt: string;
};
export type ReserveMedia = {
  adventureId: string;
  creatorId: string;
  target: MediaTarget;
  origin: Snapshot["origin"];
  specVersion: number;
  idempotencyKey: string;
  inputHash: string;
  input: Record<string, unknown>;
  permission?: { basis: string; confirmedBy: string; confirmedAt: string };
};
export interface MediaRepository {
  reserve(input: ReserveMedia): Promise<MediaCandidate>;
  get(adventureId: string, id: string): Promise<MediaCandidate | null>;
  list(adventureId: string): Promise<MediaCandidate[]>;
  complete(
    adventureId: string,
    id: string,
    snapshot: Snapshot,
    costUsd?: number,
  ): Promise<void>;
  fail(
    adventureId: string,
    id: string,
    message: string,
    costUsd?: number,
  ): Promise<void>;
}
type Row = {
  id: string;
  adventure_id: string;
  creator_id: string;
  target_kind: MediaTarget["kind"];
  target_key: string;
  origin: Snapshot["origin"];
  state: MediaCandidate["state"];
  snapshot: unknown;
  spec_version: number;
  failure: string | null;
  cost_usd: number;
  created_at: string;
  input_hash: string;
};
// Explicit projection: never send input prompts or private permissions to playback or gallery.
const columns =
  "id,adventure_id,creator_id,target_kind,target_key,origin,state,snapshot,spec_version,failure,cost_usd,created_at,input_hash";
function candidate(row: Row): MediaCandidate {
  return {
    id: row.id,
    adventureId: row.adventure_id,
    creatorId: row.creator_id,
    target: { kind: row.target_kind, key: row.target_key },
    origin: row.origin,
    state: row.state,
    snapshot: row.snapshot ? MediaSnapshot.parse(row.snapshot) : null,
    specVersion: row.spec_version,
    failure: row.failure,
    costUsd: Number(row.cost_usd),
    createdAt: row.created_at,
  };
}
export function supabaseMediaRepository(
  admin: SupabaseClient,
): MediaRepository {
  return {
    async reserve(input) {
      const { data, error } = await admin
        .rpc("reserve_media_v3", {
          p_adventure_id: input.adventureId,
          p_creator_id: input.creatorId,
          p_target_kind: input.target.kind,
          p_target_key: input.target.key,
          p_origin: input.origin,
          p_version: input.specVersion,
          p_key: input.idempotencyKey,
          p_hash: input.inputHash,
          p_input: input.input,
          p_permission: input.permission ?? null,
        })
        .single<Row>();
      if (error) {
        if (error.message.includes("Idempotency"))
          throw Error(
            "Idempotency conflict: use a new request key for different inputs.",
          );
        throw error;
      }
      if (data.input_hash !== input.inputHash)
        throw Error(
          "Idempotency conflict: use a new request key for different inputs.",
        );
      return candidate(data);
    },
    async get(adventureId, id) {
      const { data, error } = await admin
        .from("adventure_media_v3")
        .select(columns)
        .eq("adventure_id", adventureId)
        .eq("id", id)
        .maybeSingle<Row>();
      if (error) throw error;
      return data ? candidate(data) : null;
    },
    async list(adventureId) {
      const { data, error } = await admin
        .from("adventure_media_v3")
        .select(columns)
        .eq("adventure_id", adventureId)
        .order("created_at", { ascending: false })
        .limit(1000)
        .returns<Row[]>();
      if (error) throw error;
      return (data ?? []).map(candidate);
    },
    async complete(adventureId, id, snapshot, costUsd = 0) {
      const parsed = MediaSnapshot.parse(snapshot);
      const { error } = await admin
        .from("adventure_media_v3")
        .update({
          state: "ready",
          snapshot: parsed,
          cost_usd: costUsd,
          updated_at: new Date().toISOString(),
        })
        .eq("adventure_id", adventureId)
        .eq("id", id)
        .eq("state", "pending");
      if (error) throw error;
    },
    async fail(adventureId, id, message, costUsd = 0) {
      const { error } = await admin
        .from("adventure_media_v3")
        .update({
          state: "failed",
          failure: message,
          cost_usd: costUsd,
          updated_at: new Date().toISOString(),
        })
        .eq("adventure_id", adventureId)
        .eq("id", id)
        .eq("state", "pending");
      if (error) throw error;
    },
  };
}
/** Save always checks adventure ownership and target compatibility again, even for known IDs. */
export async function resolveMediaCandidates(
  repo: MediaRepository,
  adventureId: string,
  ids: string[],
): Promise<Record<string, ReadyCandidate>> {
  const entries = await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const item = await repo.get(adventureId, id);
      if (
        !item ||
        item.adventureId !== adventureId ||
        item.state !== "ready" ||
        !item.snapshot ||
        item.snapshot.candidateId !== id
      )
        throw Error("Ready candidate unavailable for this adventure.");
      return [
        id,
        { id, adventureId, target: item.target, snapshot: item.snapshot },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
