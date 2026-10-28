"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/v3/brief/service";
import { v3SchoolAllowed } from "@/lib/v3/flag";
import { canAccessV3Authoring } from "@/lib/v3/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_SPEC_BYTES, parseSpecImport } from "@/lib/v3/spec-transfer";
import { MAX_ARCHIVE_BYTES, readSpecArchive, restoreArchiveMedia } from "@/lib/v3/spec-archive";
import { createAssetStore } from "@/lib/assets/store";

export async function importAdventureJson(_previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  return importAdventureFile(form);
}

export async function updateAdventureFromFile(id: string, expectedVersion: number, expectedPublished: number | null, _previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  return importAdventureFile(form, { id, expectedVersion, expectedPublished });
}

async function importAdventureFile(form: FormData, target?: { id: string; expectedVersion: number; expectedPublished: number | null }): Promise<{ error?: string }> {
  const auth = await requireStaff();
  if ("error" in auth || (!target && !v3SchoolAllowed(auth.schoolId))) return { error: "You don’t have access to import adventures." };
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a ZIP or JSON file to import." };
  const zip = file.name.toLowerCase().endsWith(".zip");
  if (file.size > (zip ? MAX_ARCHIVE_BYTES : MAX_SPEC_BYTES)) return { error: zip ? "Choose a ZIP smaller than 15 MB." : "Choose a JSON file smaller than 10 MB." };
  let bundle;
  const admin = createAdminClient();
  const id = target?.id ?? randomUUID();
  if (target) {
    if (!Number.isSafeInteger(target.expectedVersion) || target.expectedVersion < 1) return { error: "Reload the adventure before importing." };
    const { data: current, error } = await admin.from("adventures_v3").select("owner_id,school_id,spec_version,published_version,status").eq("id", id).maybeSingle();
    if (error || !current || !canAccessV3Authoring(auth.viewer, { ownerId: current.owner_id, schoolId: current.school_id }) || !["draft", "published", "archived"].includes(current.status)) return { error: "Adventure not found." };
    if (current.spec_version !== target.expectedVersion || current.published_version !== target.expectedPublished) return { error: "This adventure changed. Reload before importing." };
  }
  const uploaded: string[] = [];
  let storage: ReturnType<typeof createAssetStore> | undefined;
  async function cleanupMedia() {
    const results = await Promise.allSettled(uploaded.map((key) => storage?.remove?.(key)));
    for (const result of results) if (result.status === "rejected") console.error("could not remove failed import media", result.reason);
  }
  try {
    if (zip) {
      const archive = await readSpecArchive(new Uint8Array(await file.arrayBuffer()));
      storage = createAssetStore(admin);
      bundle = await restoreArchiveMedia(archive, id, async (key, bytes, mime) => {
        uploaded.push(key);
        return storage!.put(key, bytes, mime);
      });
    } else bundle = parseSpecImport(await file.text());
  } catch (error) {
    await cleanupMedia();
    if (zip) console.error("could not read adventure ZIP", error);
    return { error: zip ? "Could not import ZIP. Use an exported adventure ZIP with adventure.json, valid images and sprites, up to 15 MB (40 MB expanded)." : error instanceof Error ? error.message : "Could not read that JSON file." };
  }
  // Imported raw specs also use the editor's complete pre-publication checks.
  bundle.spec.authoring ??= {};
  bundle.spec.authoring.importId = randomUUID();

  if (target) {
    const { data, error } = await admin.rpc("import_adventure_version_v3", {
      p_id: id, p_expected_version: target.expectedVersion, p_expected_published: target.expectedPublished,
      p_spec: bundle.spec, p_sources: bundle.sources,
    });
    if (error || !data?.saved) {
      await cleanupMedia();
      if (error) console.error("could not import adventure update", error);
      return { error: error ? "Could not import this update. The adventure was not changed." : "This adventure changed. Reload before importing." };
    }
    revalidatePath(`/v3/teacher/${id}`, "layout");
    revalidatePath("/teacher");
    redirect(`/v3/teacher/${id}?view=editor`);
  }

  const { data, error } = await admin.from("adventures_v3").insert({
    id,
    school_id: auth.schoolId, owner_id: auth.userId,
    status: "draft", title: bundle.spec.title, spec: bundle.spec,
  }).select("id").single<{ id: string }>();
  if (error || !data) {
    await cleanupMedia();
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
      await cleanupMedia();
      return { error: "Could not import source text. Please try again." };
    }
  }
  revalidatePath("/teacher");
  redirect(`/v3/teacher/${data.id}?view=editor`);
}
