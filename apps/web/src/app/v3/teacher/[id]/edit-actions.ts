"use server";
import { supabaseJobStore } from "@adventure/jobs";
import type { AdventureSpec } from "@adventure/spec-v3";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseV3PlayStore } from "@/lib/play/v3/store";
import { supabaseV3SourceStore } from "@/lib/v3/generation/deps";
import { saveAdventureEdits, type SaveV3Result } from "@/lib/v3/edit/service";
import type { V3Edit } from "@/lib/v3/edit/commands";
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
  const result = await saveAdventureEdits(
    {
      store: new SupabaseV3PlayStore(admin),
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
        (await supabaseV3SourceStore(() => admin).load(id)).map((d) => ({
          id: d.id,
          title: d.title,
          text: d.pages.map((p) => p.text).join("\n"),
        })),
    },
    user.id,
    adventureId,
    expectedVersion,
    edits,
  );
  if (result.ok) revalidatePath(`/v3/teacher/${adventureId}`, "layout");
  return result;
}
