/**
 * The bridge between generation (I1 spec v2, Di Heng) and the relational
 * schema the product plays from (P1): writes a validated spec into a new
 * *draft* `spec_version` plus its stages, rooms, agents, private context,
 * evidence, objectives and decision options.
 *
 * Three rules it exists to enforce:
 *  - Drafts only. Published versions are frozen by trigger (P4), so this never
 *    writes into one — a teacher who regenerates gets a new version number.
 *  - All of the version or none of it. The rows are written one statement at a
 *    time, so a failure part-way through would otherwise leave a draft whose
 *    json promises rows that were never inserted; the version row is deleted
 *    on the way out and the children cascade with it.
 *  - Spec ids are slugs, database ids are uuids. Every reference (an agent's
 *    starting room, an option's branch target, an objective's prerequisites) is
 *    rewritten to the uuid of the row that was actually inserted, so nothing
 *    downstream has to resolve slugs against the json blob.
 */
import { compileAdventure, createSpatialStageWorld } from "@adventure/game-integration";
import { randomUUID } from "node:crypto";
import { validateAdventureSpec } from "@adventure/generation/spec";
import type { AdventureSpec } from "@adventure/generation/spec";
import type { SupabaseClient } from "@supabase/supabase-js";

export class SpecPersistError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "SpecPersistError";
  }
}

export type PersistedVersion = {
  specVersionId: string;
  version: number;
  /** Spec slug → database uuid, for every row this call inserted. */
  ids: Map<string, string>;
};

/**
 * Every insert here is `... .select("id").single()`; this unwraps Supabase's
 * `{ data, error }` into the id, or throws.
 */
async function insertOne(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ id: string }> {
  const { data, error } = await query;
  if (error) throw new SpecPersistError(error.message);
  if (!data) throw new SpecPersistError("insert returned no row");
  return data as { id: string };
}

/**
 * Writes `candidate` as the adventure's next draft version. Requires a service
 * role client: authoring content is server-written, clients only read it (P2).
 */
export async function persistSpecVersion(
  admin: SupabaseClient,
  adventureId: string,
  candidate: unknown,
  options: { generatorVersion: string; createdBy?: string | null; layoutSeed?: string } = {
    generatorVersion: "spec-v2",
  },
): Promise<PersistedVersion> {
  const validation = validateAdventureSpec(candidate);
  if (!validation.ok) {
    throw new SpecPersistError(
      `spec is invalid and was not persisted (${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"})`,
      validation.issues,
    );
  }
  const spec: AdventureSpec = validation.spec;
  const compilation = compileAdventure(spec, options.layoutSeed ?? randomUUID());
  if (!compilation.ok) throw new SpecPersistError("spec cannot be compiled and was not persisted", compilation.issues);
  for (let index = 0; index < compilation.stages.length; index += 1) createSpatialStageWorld(spec, index, compilation.stages[index]!);

  const { data: existing, error: versionError } = await admin
    .from("spec_version")
    .select("version, published_at")
    .eq("adventure_id", adventureId)
    .order("version", { ascending: false })
    .limit(1);
  if (versionError) throw new SpecPersistError(versionError.message);

  const latest = existing?.[0];
  if (latest && latest.published_at === null) {
    throw new SpecPersistError(
      "this adventure already has an unpublished draft; publish or discard it first",
    );
  }
  const version = (latest?.version ?? 0) + 1;

  const specVersion = await insertOne(
    admin
      .from("spec_version")
      .insert({
        adventure_id: adventureId,
        version,
        json: spec,
        generator_version: options.generatorVersion,
        created_by: options.createdBy ?? null,
      })
      .select("id")
      .single(),
  );

  try {
    const ids = await writeSpecRows(admin, specVersion.id, spec);
    const { error: mapsError } = await admin.rpc("set_version_maps", { p_spec_version_id: specVersion.id, p_maps: compilation.stages });
    if (mapsError) throw new SpecPersistError(mapsError.message);
    return { specVersionId: specVersion.id, version, ids };
  } catch (error) {
    await admin.from("spec_version").delete().eq("id", specVersion.id);
    throw error;
  }
}

/** Writes every relational row of `spec` under an existing draft version. */
async function writeSpecRows(
  admin: SupabaseClient,
  specVersionId: string,
  spec: AdventureSpec,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const uuid = (slug: string): string => {
    const id = ids.get(slug);
    if (!id) throw new SpecPersistError(`spec references unknown id "${slug}"`);
    return id;
  };

  const stakeholderById = new Map(spec.stakeholders.map((s) => [s.id, s]));

  for (const stage of spec.stages) {
    const row = await insertOne(
      admin
        .from("stage")
        .insert({
          spec_version_id: specVersionId,
          spec_id: stage.id,
          index: stage.index,
          title: stage.title,
          shared_context: stage.sharedContext.text,
          timer_seconds: stage.timerSeconds,
          ambient_overlay: (stage.ambientOverlay ?? spec.ambientOverlay).id,
          overlay_intensity: (stage.ambientOverlay ?? spec.ambientOverlay).intensity,
        })
        .select("id")
        .single(),
    );
    ids.set(stage.id, row.id);
  }

  for (const stage of spec.stages) {
    for (const room of stage.rooms) {
      const row = await insertOne(
        admin
          .from("room")
          .insert({
            stage_id: uuid(stage.id),
            spec_id: room.id,
            name: room.name,
            purpose: room.purpose,
            door_default: room.doorDefault,
          })
          .select("id")
          .single(),
      );
      ids.set(room.id, row.id);
    }

    for (const agent of stage.agents) {
      const stakeholder = stakeholderById.get(agent.stakeholderId);
      const row = await insertOne(
        admin
          .from("agent")
          .insert({
            stage_id: uuid(stage.id),
            spec_id: agent.id,
            name: stakeholder?.name ?? agent.stakeholderId,
            role: stakeholder?.role ?? null,
            public_position: agent.publicPosition.text,
            model_tier: agent.modelTier,
            start_room_id: uuid(agent.startRoomId),
          })
          .select("id")
          .single(),
      );
      ids.set(agent.id, row.id);

      // Persona, motivations, hidden interests and knowledge horizon go to the
      // service-role-only table: no client role can read it at all (FR-21).
      const { privateContext } = agent;
      const { error } = await admin.from("agent_private_context").insert({
        agent_id: row.id,
        private_context: [
          privateContext.persona,
          privateContext.motivations,
          privateContext.hiddenInterests,
        ].join("\n\n"),
        knowledge_horizon: privateContext.knowledgeHorizon,
      });
      if (error) throw new SpecPersistError(error.message);
    }

    for (const evidence of stage.evidence) {
      const row = await insertOne(
        admin
          .from("evidence")
          .insert({
            stage_id: uuid(stage.id),
            spec_id: evidence.id,
            room_id: uuid(evidence.roomId),
            text: evidence.content.text,
            source_span: evidence.content.spans,
          })
          .select("id")
          .single(),
      );
      ids.set(evidence.id, row.id);
    }
  }

  // Objectives reference other objectives, so they are inserted once every
  // objective in the stage has a uuid.
  for (const stage of spec.stages) {
    for (const objective of stage.objectives) {
      const row = await insertOne(
        admin
          .from("objective")
          .insert({
            stage_id: uuid(stage.id),
            spec_id: objective.id,
            title: objective.title,
            requires: [],
          })
          .select("id")
          .single(),
      );
      ids.set(objective.id, row.id);
    }
  }

  for (const stage of spec.stages) {
    for (const objective of stage.objectives) {
      const { error } = await admin
        .from("objective")
        .update({
          requires: objective.requires.map(uuid),
          // An agent or a piece of evidence in the same stage.
          target_id: ids.get(objective.targetId) ?? null,
        })
        .eq("id", uuid(objective.id));
      if (error) throw new SpecPersistError(error.message);
    }

    for (const option of stage.decision.options) {
      // An ending is not a stage row: the branch is recorded in the stage's
      // branch map instead, and `branch_target` stays null.
      const branchTarget =
        option.branchTarget.kind === "stage" ? uuid(option.branchTarget.stageId) : null;
      const row = await insertOne(
        admin
          .from("decision_option")
          .insert({
            stage_id: uuid(stage.id),
            spec_id: option.id,
            label: option.label,
            preconditions: option.preconditions.map((p) => ids.get(p) ?? p),
            branch_target: branchTarget,
          })
          .select("id")
          .single(),
      );
      ids.set(option.id, row.id);
    }

    const branchMap = Object.fromEntries(
      stage.decision.options.map((option) => [
        uuid(option.id),
        option.branchTarget.kind === "stage"
          ? { kind: "stage", stageId: uuid(option.branchTarget.stageId) }
          : { kind: "ending", endingId: option.branchTarget.endingId },
      ]),
    );
    const { error } = await admin
      .from("stage")
      .update({ branch_map: branchMap })
      .eq("id", uuid(stage.id));
    if (error) throw new SpecPersistError(error.message);
  }

  // The play route joins the json against these rows on every turn, so a
  // version that is missing any of them is not worth keeping.
  const { data: gaps, error: gapError } = await admin.rpc("spec_version_gaps", {
    p_spec_version_id: specVersionId,
  });
  if (gapError) throw new SpecPersistError(gapError.message);
  const missing = (gaps ?? []) as string[];
  if (missing.length > 0) {
    throw new SpecPersistError(
      `the spec was only written in part (${missing.length} row${missing.length === 1 ? "" : "s"} missing, e.g. ${missing[0]})`,
    );
  }

  return ids;
}
