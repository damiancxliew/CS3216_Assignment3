import type { AssetManifest } from "@adventure/generation/assets";
import type { CompiledStage } from "@adventure/game-core";
import type { AdventureSpec } from "@adventure/generation/spec";

export type CachedVersion = {
  specVersionId: string;
  spec: AdventureSpec;
  compiledStages: CompiledStage[];
};

export type CachedStage = {
  id: string;
  index: number;
  spec_id: string | null;
  spec_version_id: string;
};

export type CachedStageRow = {
  id: string;
  index: number;
  spec_id: string | null;
};

type CacheEntry =
  | { kind: "version"; value: CachedVersion }
  | { kind: "stage"; value: CachedStage }
  | { kind: "stages"; value: CachedStageRow[] }
  | { kind: "assets"; value: AssetManifest };

const MAX_ENTRIES = 16;
const entries = new Map<string, CacheEntry>();

function put(key: string, entry: CacheEntry): void {
  entries.delete(key);
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, entry);
}

export function getVersion(adventureId: string, version: number): CachedVersion | undefined {
  const entry = entries.get(`${adventureId}:${version}`);
  return entry?.kind === "version" ? entry.value : undefined;
}

export function setVersion(adventureId: string, version: number, value: CachedVersion): void {
  put(`${adventureId}:${version}`, { kind: "version", value });
}

export function getStage(specVersionId: string, stageId: string): CachedStage | undefined {
  const entry = entries.get(`${specVersionId}:stage:${stageId}`);
  return entry?.kind === "stage" ? entry.value : undefined;
}

export function setStage(specVersionId: string, stageId: string, value: CachedStage): void {
  put(`${specVersionId}:stage:${stageId}`, { kind: "stage", value });
}

export function getStages(specVersionId: string): CachedStageRow[] | undefined {
  const entry = entries.get(`${specVersionId}:stages`);
  return entry?.kind === "stages" ? entry.value : undefined;
}

export function setStages(specVersionId: string, value: CachedStageRow[]): void {
  put(`${specVersionId}:stages`, { kind: "stages", value });
}

export function getAssets(specVersionId: string): AssetManifest | undefined {
  const entry = entries.get(`${specVersionId}:assets`);
  return entry?.kind === "assets" ? entry.value : undefined;
}

export function setAssets(specVersionId: string, value: AssetManifest | null): void {
  if (!value || value.records.some((record) => record.status === "pending")) return;
  put(`${specVersionId}:assets`, { kind: "assets", value });
}

export function clearVersionCache(): void {
  entries.clear();
}
