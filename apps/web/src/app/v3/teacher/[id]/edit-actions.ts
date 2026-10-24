"use server";
import {
  resolveMediaCandidates,
  supabaseMediaRepository,
} from "@/lib/v3/media/repository";
import { supabaseJobStore } from "@adventure/jobs";
import { validateSpec, type AdventureSpec } from "@adventure/spec-v3";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { defaultGenerationDeps, supabaseV3SourceStore,
} from "@/lib/v3/generation/deps";
import { saveAdventureEdits, type SaveV3Result } from "@/lib/v3/edit/service";
import type { V3Edit } from "@/lib/v3/edit/commands";
import { capturedSources } from "@/lib/v3/edit/apply";
import { canStaffAdventure } from "@/lib/play/v3/access";
import { proposeEditFix } from "@/lib/v3/edit/ai-fix";
import { editFixLlm } from "@/lib/v3/edit/ai-deps";
import { v3Enabled } from "@/lib/v3/flag";

export async function saveV3AdventureEdits(
  adventureId: string,
  expectedVersion: number,
  edits: V3Edit[],
): Promise<SaveV3Result> {
  if (!v3Enabled()) return { ok: false, code: "access", message: "Not found." };
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user)
    return {
      ok: false,
      code: "access",
      message: "Sign in again to save. Your local work is still here.",
    };
  const admin = createAdminClient();
  const generation = defaultGenerationDeps();
  const result = await saveAdventureEdits(
    {
      store: new SupabaseV3PlayStore(admin),
      media: supabaseMediaRepository(admin),
      queueStageArt: generation.queueStageArt,
      validationContext: async (id) => {
        const outputs = await supabaseJobStore(admin).outputs(id, [
          "details",
          "endings",
          "reveal",
        ]);
        type Output = {
          parts?: Record<string, unknown>;
          slantedDocuments?: { documentId: string; note: string }[];
        };
        const details = outputs.details as Output | undefined;
        const endings = outputs.endings as Output | undefined;
        const reveal = outputs.reveal as Output | undefined;
        if (!details?.parts && !endings?.parts && !reveal?.parts)
          return undefined;
        return {
          slantedDocuments: details?.slantedDocuments ?? [],
          generationParts: {
            ...details?.parts,
            ...endings?.parts,
            ...reveal?.parts,
          },
        } as NonNullable<
          NonNullable<AdventureSpec["authoring"]>["validationContext"]
        >;
      },
      sources: async (id) =>
        capturedSources(await supabaseV3SourceStore(() => admin).load(id)),
    },
    user.id,
    adventureId,
    expectedVersion,
    edits,
  );
  if (result.ok) revalidatePath(`/v3/teacher/${adventureId}`, "layout");
  return result;
}

export async function fixV3EditsWithAiAction(
  adventureId: string,
  expectedVersion: number,
  edits: V3Edit[],
) {
  if (!v3Enabled()) return { error: "not_found" };
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) return { error: "not_found" };
  const admin = createAdminClient();
  const store = new SupabaseV3PlayStore(admin);
  const adventure = await store.loadAdventure(adventureId);
  if (
    !adventure ||
    !(await canStaffAdventure(store, adventure, user.id)) ||
    !["draft", "published", "archived"].includes(adventure.status)
  )
    return { error: "not_found" };
  if (adventure.specVersion !== expectedVersion)
    return {
      error: "This adventure changed. Reload to use the saved version.",
    };
  const parsed = validateSpec(adventure.spec);
  if (!parsed.ok) return { error: "Invalid stored adventure." };
  return proposeEditFix(
    { llm: editFixLlm(adventureId, adventure.schoolId, user.id) },
    {
      media: {
        candidates: await resolveMediaCandidates(
          supabaseMediaRepository(admin),
          adventureId,
          edits.flatMap((edit) =>
            edit.type === "stageImage" || edit.type === "portraitImage"
              ? edit.candidateId
                ? [edit.candidateId]
                : []
              : edit.type === "walkingSprite" &&
                  edit.selection.kind === "candidate"
                ? [edit.selection.id]
                : [],
          ),
        ),
      },
      base: parsed.spec,
      edits,
      sources: capturedSources(
        await supabaseV3SourceStore(() => admin).load(adventureId),
      ),
      savedErrors: await store.loadCheckErrors(adventureId),
    },
  );
}
