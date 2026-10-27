"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/v3/brief/service";
import { v3SchoolAllowed } from "@/lib/v3/flag";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_SPEC_BYTES, parseSpecImport } from "@/lib/v3/spec-transfer";

export async function importAdventureJson(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const auth = await requireStaff();
  if ("error" in auth || !v3SchoolAllowed(auth.schoolId)) return { error: "You don’t have access to import adventures." };
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a JSON file to import." };
  if (file.size > MAX_SPEC_BYTES) return { error: "Choose a JSON file smaller than 10 MB." };
  let bundle;
  try { bundle = parseSpecImport(await file.text()); }
  catch (error) { return { error: error instanceof Error ? error.message : "Could not read that JSON file." }; }
  // Imported raw specs also use the editor's complete pre-publication checks.
  bundle.spec.authoring ??= {};

  const admin = createAdminClient();
  const { data, error } = await admin.from("adventures_v3").insert({
    school_id: auth.schoolId, owner_id: auth.userId,
    status: "draft", title: bundle.spec.title, spec: bundle.spec,
  }).select("id").single<{ id: string }>();
  if (error || !data) {
    console.error("could not import v3 adventure", error);
    return { error: "Could not import the adventure. Please try again." };
  }
  if (bundle.sources.length) {
    const { error: sourceError } = await admin.from("sources_v3").insert(bundle.sources.map((source) => ({
      adventure_id: data.id, source_key: source.id, origin: source.origin === "outside" ? "outside" : "upload",
      kind: source.kind, title: source.title, storage_key: `inline:import/${data.id}/${source.id}`,
      url: source.url ?? null,
      content_hash: createHash("sha256").update(JSON.stringify(source.pages)).digest("hex"), pages: source.pages,
    })));
    if (sourceError) {
      const { error: cleanupError } = await admin.from("adventures_v3").delete().eq("id", data.id);
      console.error("could not import v3 sources", sourceError, cleanupError);
      return { error: "Could not import source text. Please try again." };
    }
  }
  revalidatePath("/teacher");
  redirect(`/v3/teacher/${data.id}?view=editor`);
}
