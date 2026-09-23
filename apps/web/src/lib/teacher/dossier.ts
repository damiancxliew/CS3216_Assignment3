/**
 * The teacher-facing dossier: a sanitized, render-ready projection of the
 * stored spec plus the artwork generated for it. `spec_version` is revoked
 * from `authenticated`, so the JSON is read with the service role after the
 * page has confirmed ownership — and everything returned here is a plain
 * value with `privateContext`/`knowledgeHorizon` absent by construction
 * (FR-21), safe to hand to any component. `null` when the stored JSON no
 * longer validates (older fixtures), so the page can fall back quietly.
 */
import type { AssetManifest, AssetRecord } from "@adventure/generation/assets";
import { resolveStageSettings, validatePublishedSpec, type AdventureSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadManifest } from "@/lib/assets/supabase";
import { characterFor, facesetUrl } from "@/lib/play/appearance";

export type ImageStatus = "generated" | "placeholder" | "pending" | "failed";

export type DossierStakeholder = {
  id: string;
  name: string;
  role: string;
  summary: string;
  /** Generated art when it settled, else the curated faceset (D6). */
  imageUrl: string;
  imageStatus: ImageStatus;
  assetId: string | null;
};

export type DossierRoom = {
  id: string;
  name: string;
  purpose: string;
  kind: string;
  size: string;
  landmark: { name: string; description: string } | null;
  imageUrl: string | null;
  imageStatus: ImageStatus;
  assetId: string | null;
};

export type DossierStage = {
  id: string;
  index: number;
  title: string;
  sharedContext: string;
  ambientOverlay: { id: string; intensity: number } | null;
  rooms: DossierRoom[];
  /** Public position only — private context never reaches this object (FR-21). */
  agents: { stakeholderId: string; publicPosition: string }[];
  evidence: {
    id: string;
    name: string;
    text: string;
    spans: { sourceTitle: string; page: number; quote: string }[];
    imageUrl: string | null;
    imageStatus: ImageStatus;
    assetId: string | null;
  }[];
  objectives: { id: string; title: string }[];
  /** Options without `branchTarget`/`preconditions`: where play goes next is a spoiler. */
  decision: { title: string; prompt: string; options: { label: string; stance: string }[] };
};

export type Dossier = {
  stakeholders: DossierStakeholder[];
  stages: DossierStage[];
  endings: {
    id: string;
    title: string;
    summary: string;
    historicalOutcome: string;
    divergence: string;
    reflectionQuestions: string[];
  }[];
  /** Named `reason`, not `rationale`: the Turn API contract forbids that key in client payloads (FR-21). */
  assumptions: { id: string; text: string; reason: string }[];
  assets: { eligible: number; generated: number; pending: number; failed: number; costUsd: number };
};

function imageStatus(record: AssetRecord | undefined): ImageStatus {
  if (!record) return "placeholder";
  if (record.status === "ready" || record.status === "cached") return "generated";
  if (record.status === "pending") return "pending";
  return "failed"; // failed | filtered | skipped-cap
}

/** The manifest row for a spec entity, if artwork was ever attempted for it. */
function recordFor(manifest: AssetManifest | null, entityId: string): AssetRecord | undefined {
  return manifest?.records.find((r) => r.entityId === entityId);
}

/**
 * Pure projection — split from `buildDossier` so tests can exercise it without
 * a database. `manifest` may be `null` (artwork never ran).
 */
export function dossierFromSpec(spec: AdventureSpec, manifest: AssetManifest | null): Dossier {
  const sourceTitle = new Map(spec.sources.map((s) => [s.id, s.title]));

  const stakeholders: DossierStakeholder[] = spec.stakeholders.map((s) => {
    const record = recordFor(manifest, s.id);
    const status = imageStatus(record);
    return {
      id: s.id,
      name: s.name,
      role: s.role,
      summary: s.summary.text,
      imageUrl: status === "generated" ? record!.url : facesetUrl(characterFor(s)),
      imageStatus: status,
      assetId: record?.assetId ?? null,
    };
  });

  const stages: DossierStage[] = spec.stages.map((stage) => ({
    id: stage.id,
    index: stage.index,
    title: stage.title,
    sharedContext: stage.sharedContext.text,
    ambientOverlay: resolveStageSettings(spec, stage).ambientOverlay,
    rooms: stage.rooms.map((room) => {
      const record = recordFor(manifest, room.id);
      const status = imageStatus(record);
      return {
        id: room.id,
        name: room.name,
        purpose: room.purpose,
        kind: room.kind,
        size: room.size,
        landmark: room.landmark,
        imageUrl: status === "generated" ? record!.url : null,
        imageStatus: status,
        assetId: record?.assetId ?? null,
      };
    }),
    agents: stage.agents.map((agent) => ({
      stakeholderId: agent.stakeholderId,
      publicPosition: agent.publicPosition.text,
    })),
    evidence: stage.evidence.map((item) => {
      const record = recordFor(manifest, item.id);
      const status = imageStatus(record);
      return {
        id: item.id,
        name: item.name,
        text: item.content.text,
        spans: item.content.spans.map((span) => ({
          sourceTitle: sourceTitle.get(span.sourceId) ?? span.sourceId,
          page: span.page,
          quote: span.quote,
        })),
        imageUrl: status === "generated" ? record!.url : null,
        imageStatus: status,
        assetId: record?.assetId ?? null,
      };
    }),
    objectives: stage.objectives.map((o) => ({ id: o.id, title: o.title })),
    decision: {
      title: stage.decision.title,
      prompt: stage.decision.prompt,
      options: stage.decision.options.map((o) => ({ label: o.label, stance: o.stance })),
    },
  }));

  const records = manifest?.records ?? [];
  return {
    stakeholders,
    stages,
    endings: spec.endings.map((e) => ({
      id: e.id,
      title: e.title,
      summary: e.summary,
      historicalOutcome: e.historicalOutcome.text,
      divergence: e.divergence,
      reflectionQuestions: e.reflectionQuestions,
    })),
    assumptions: spec.assumptions.map((a) => ({ id: a.id, text: a.text, reason: a.rationale })),
    assets: {
      eligible: spec.assetEligibility.length,
      generated: records.filter((r) => r.status === "ready" || r.status === "cached").length,
      pending: records.filter((r) => r.status === "pending").length,
      failed: records.filter((r) => r.status === "failed" || r.status === "filtered" || r.status === "skipped-cap").length,
      costUsd: records.reduce((sum, r) => sum + r.costUsd, 0),
    },
  };
}

export async function buildDossier(
  admin: SupabaseClient,
  { adventureId, specVersionId }: { adventureId: string; specVersionId: string },
): Promise<Dossier | null> {
  const { data: version } = await admin
    .from("spec_version")
    .select("id, version, json")
    .eq("id", specVersionId)
    .eq("adventure_id", adventureId)
    .maybeSingle<{ id: string; version: number; json: unknown }>();
  if (!version) return null;

  const validated = validatePublishedSpec(version.json);
  if (!validated.ok) return null;

  const manifest = await loadManifest(admin, version.id, adventureId, version.version);
  return dossierFromSpec(validated.spec, manifest);
}
