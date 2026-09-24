/**
 * Inline editing on the dossier: `spec_version.json` is the source of truth
 * (both play and the dossier read it), so every edit patches the json, then
 * mirrors the relational rows the runtime joins on, then recompiles the maps.
 * Recompiling is not cosmetic — `set_version_maps` stamps `compiled_spec = json`
 * and the publish trigger refuses a version whose stamp is stale (P4), so an
 * edit that skipped it would silently break publishing.
 */
import { compileAdventure } from "@adventure/game-integration";
import { randomUUID } from "node:crypto";
import { validateAdventureSpec, type AdventureSpec } from "@adventure/generation/spec";
import type { MapThemeId } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SpecEdit =
  | { kind: "stage"; stageId: string; title: string; sharedContext: string; timerSeconds: number | null; mapTheme?: MapThemeId }
  | { kind: "stakeholder"; stakeholderId: string; name: string; role: string; summary: string }
  | { kind: "agentPosition"; stageId: string; agentId: string; publicPosition: string }
  | { kind: "room"; stageId: string; roomId: string; name: string; purpose: string }
  | { kind: "evidence"; stageId: string; evidenceId: string; name: string; text: string }
  | { kind: "objective"; stageId: string; objectiveId: string; title: string }
  | { kind: "decision"; stageId: string; title: string; prompt: string; optionLabels: { id: string; label: string }[] }
  | { kind: "ending"; endingId: string; title: string; summary: string; divergence: string; reflectionQuestions: string[] }
  | { kind: "assumption"; assumptionId: string; text: string; reason: string };

type EditResult = { ok: true; spec: AdventureSpec } | { ok: false; error: string };

const err = (message: string): EditResult => ({ ok: false, error: message });

function formatIssues(issues: { path: string; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((i) => `${i.path}: ${i.message}`)
    .join("; ");
}

/**
 * Patches one entity inside `spec`. Ids are never touched, so artwork rows and
 * `assetEligibility` stay valid; grounded fields keep their spans and
 * assumption ids — the teacher edits prose only. Unknown ids are errors, never
 * silent no-ops. The input is never mutated, even on the failure path.
 */
export function applyEditToSpec(spec: AdventureSpec, edit: SpecEdit): EditResult {
  const next = structuredClone(spec);

  switch (edit.kind) {
    case "stage": {
      const stage = next.stages.find((s) => s.id === edit.stageId);
      if (!stage) return err(`unknown stage "${edit.stageId}"`);
      stage.title = edit.title;
      stage.sharedContext.text = edit.sharedContext;
      stage.timerSeconds = edit.timerSeconds;
      if (edit.mapTheme) stage.mapTheme = edit.mapTheme;
      break;
    }
    case "stakeholder": {
      const person = next.stakeholders.find((s) => s.id === edit.stakeholderId);
      if (!person) return err(`unknown stakeholder "${edit.stakeholderId}"`);
      person.name = edit.name;
      person.role = edit.role;
      person.summary.text = edit.summary;
      break;
    }
    case "agentPosition": {
      const stage = next.stages.find((s) => s.id === edit.stageId);
      const agent = stage?.agents.find((a) => a.id === edit.agentId);
      if (!stage || !agent) return err(`unknown agent "${edit.agentId}" in stage "${edit.stageId}"`);
      agent.publicPosition.text = edit.publicPosition;
      break;
    }
    case "room": {
      const stage = next.stages.find((s) => s.id === edit.stageId);
      const room = stage?.rooms.find((r) => r.id === edit.roomId);
      if (!stage || !room) return err(`unknown room "${edit.roomId}" in stage "${edit.stageId}"`);
      room.name = edit.name;
      room.purpose = edit.purpose;
      break;
    }
    case "evidence": {
      const stage = next.stages.find((s) => s.id === edit.stageId);
      const item = stage?.evidence.find((e) => e.id === edit.evidenceId);
      if (!stage || !item) return err(`unknown evidence "${edit.evidenceId}" in stage "${edit.stageId}"`);
      item.name = edit.name;
      item.content.text = edit.text;
      break;
    }
    case "objective": {
      const stage = next.stages.find((s) => s.id === edit.stageId);
      const objective = stage?.objectives.find((o) => o.id === edit.objectiveId);
      if (!stage || !objective) return err(`unknown objective "${edit.objectiveId}" in stage "${edit.stageId}"`);
      objective.title = edit.title;
      break;
    }
    case "decision": {
      const stage = next.stages.find((s) => s.id === edit.stageId);
      if (!stage) return err(`unknown stage "${edit.stageId}"`);
      stage.decision.title = edit.title;
      stage.decision.prompt = edit.prompt;
      for (const { id, label } of edit.optionLabels) {
        const option = stage.decision.options.find((o) => o.id === id);
        if (!option) return err(`unknown decision option "${id}" in stage "${edit.stageId}"`);
        option.label = label;
      }
      break;
    }
    case "ending": {
      const ending = next.endings.find((e) => e.id === edit.endingId);
      if (!ending) return err(`unknown ending "${edit.endingId}"`);
      ending.title = edit.title;
      ending.summary = edit.summary;
      ending.divergence = edit.divergence;
      ending.reflectionQuestions = edit.reflectionQuestions;
      break;
    }
    case "assumption": {
      const assumption = next.assumptions.find((a) => a.id === edit.assumptionId);
      if (!assumption) return err(`unknown assumption "${edit.assumptionId}"`);
      assumption.text = edit.text;
      assumption.rationale = edit.reason;
      break;
    }
  }

  // Full refinements, not the shape-only published check: the result must be
  // a spec the planner could have written.
  const validated = validateAdventureSpec(next);
  if (!validated.ok) return err(formatIssues(validated.issues));
  return { ok: true, spec: validated.spec };
}

/** The `stage`/`room`/`evidence`/`objective`/`decision_option`/`agent` rows mirrored per edit kind. */
async function mirrorEdit(admin: SupabaseClient, specVersionId: string, spec: AdventureSpec, edit: SpecEdit): Promise<string | null> {
  const run = async (query: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await query;
    return error ? error.message : null;
  };
  const stageUuid = async (specStageId: string): Promise<string | null> => {
    const { data } = await admin
      .from("stage")
      .select("id")
      .eq("spec_version_id", specVersionId)
      .eq("spec_id", specStageId)
      .maybeSingle<{ id: string }>();
    return data?.id ?? null;
  };

  switch (edit.kind) {
    case "stage": {
      const stage = spec.stages.find((s) => s.id === edit.stageId)!;
      return run(
        admin
          .from("stage")
          .update({ title: stage.title, shared_context: stage.sharedContext.text, timer_seconds: stage.timerSeconds })
          .eq("spec_version_id", specVersionId)
          .eq("spec_id", edit.stageId),
      );
    }
    case "stakeholder": {
      // `agent.name`/`role` are denormalised from the stakeholder at persist
      // time, so a rename rewrites every agent row that casts them.
      const person = spec.stakeholders.find((s) => s.id === edit.stakeholderId)!;
      const { data: stages } = await admin
        .from("stage")
        .select("id, spec_id")
        .eq("spec_version_id", specVersionId)
        .returns<{ id: string; spec_id: string | null }[]>();
      const bySpecId = new Map((stages ?? []).map((s) => [s.spec_id, s.id]));
      for (const stage of spec.stages) {
        for (const agent of stage.agents) {
          if (agent.stakeholderId !== edit.stakeholderId) continue;
          const failure = await run(
            admin.from("agent").update({ name: person.name, role: person.role }).eq("stage_id", bySpecId.get(stage.id) ?? "").eq("spec_id", agent.id),
          );
          if (failure) return failure;
        }
      }
      return null;
    }
    case "agentPosition": {
      const uuid = await stageUuid(edit.stageId);
      if (!uuid) return `no stage row for "${edit.stageId}"`;
      const agent = spec.stages.find((s) => s.id === edit.stageId)!.agents.find((a) => a.id === edit.agentId)!;
      return run(admin.from("agent").update({ public_position: agent.publicPosition.text }).eq("stage_id", uuid).eq("spec_id", edit.agentId));
    }
    case "room": {
      const uuid = await stageUuid(edit.stageId);
      if (!uuid) return `no stage row for "${edit.stageId}"`;
      const room = spec.stages.find((s) => s.id === edit.stageId)!.rooms.find((r) => r.id === edit.roomId)!;
      return run(admin.from("room").update({ name: room.name, purpose: room.purpose }).eq("stage_id", uuid).eq("spec_id", edit.roomId));
    }
    case "evidence": {
      const uuid = await stageUuid(edit.stageId);
      if (!uuid) return `no stage row for "${edit.stageId}"`;
      const item = spec.stages.find((s) => s.id === edit.stageId)!.evidence.find((e) => e.id === edit.evidenceId)!;
      return run(admin.from("evidence").update({ text: item.content.text }).eq("stage_id", uuid).eq("spec_id", edit.evidenceId));
    }
    case "objective": {
      const uuid = await stageUuid(edit.stageId);
      if (!uuid) return `no stage row for "${edit.stageId}"`;
      const objective = spec.stages.find((s) => s.id === edit.stageId)!.objectives.find((o) => o.id === edit.objectiveId)!;
      return run(admin.from("objective").update({ title: objective.title }).eq("stage_id", uuid).eq("spec_id", edit.objectiveId));
    }
    case "decision": {
      const uuid = await stageUuid(edit.stageId);
      if (!uuid) return `no stage row for "${edit.stageId}"`;
      const decision = spec.stages.find((s) => s.id === edit.stageId)!.decision;
      for (const { id } of edit.optionLabels) {
        const option = decision.options.find((o) => o.id === id)!;
        const failure = await run(admin.from("decision_option").update({ label: option.label }).eq("stage_id", uuid).eq("spec_id", id));
        if (failure) return failure;
      }
      return null;
    }
    // Endings and assumptions live only in the json; nothing to mirror.
    case "ending":
    case "assumption":
      return null;
  }
}

export async function applySpecEdit(
  admin: SupabaseClient,
  { adventureId, specVersionId }: { adventureId: string; specVersionId: string },
  edit: SpecEdit,
): Promise<{ error?: string }> {
  const { data: version } = await admin
    .from("spec_version")
    .select("id, version, json, published_at, compiled_stages")
    .eq("id", specVersionId)
    .eq("adventure_id", adventureId)
    .maybeSingle<{ id: string; version: number; json: unknown; published_at: string | null; compiled_stages: unknown }>();
  if (!version) return { error: "That version is not part of this adventure" };
  if (version.published_at !== null) {
    return { error: "This version is published and frozen. Choose “Edit as a new version” first." };
  }

  const stored = validateAdventureSpec(version.json);
  if (!stored.ok) return { error: "This version predates the editor — regenerate it to edit." };

  const patched = applyEditToSpec(stored.spec, edit);
  if (!patched.ok) return { error: patched.error };
  const next = patched.spec;

  // Reuse the stored layout seed so a text edit cannot reshuffle the floor
  // plans; `randomUUID` only when the version was never compiled.
  const seed =
    (version.compiled_stages as { map?: { seed?: string } }[] | null)?.[0]?.map?.seed ?? randomUUID();
  const compilation = compileAdventure(next, seed);
  if (!compilation.ok) return { error: formatIssues(compilation.issues) };

  const { error: updateError } = await admin
    .from("spec_version")
    .update({ json: next })
    .eq("id", version.id)
    .is("published_at", null);
  if (updateError) return { error: updateError.message };

  // After the json write, so `compiled_spec` stamps against the new json.
  const { error: mapsError } = await admin.rpc("set_version_maps", { p_spec_version_id: version.id, p_maps: compilation.stages });
  if (mapsError) return { error: mapsError.message };

  const failure = await mirrorEdit(admin, version.id, next, edit);
  if (failure) return { error: failure };
  return {};
}
