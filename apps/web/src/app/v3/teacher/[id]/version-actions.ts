"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { v3PublishDeps } from "@/lib/play/v3/http";
import { canStaffAdventure } from "@/lib/play/v3/access";
import { v3Enabled } from "@/lib/v3/flag";

export async function getV3SavedVersions(id: string) {
  if (!v3Enabled()) return { ok: false as const, message: "Not found." };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false as const, message: "Sign in again." };
  const deps = v3PublishDeps();
  const adventure = await deps.store.loadAdventure(id);
  if (!adventure || !(await canStaffAdventure(deps.store, adventure, user.id, deps.env))) return { ok: false as const, message: "Not found." };
  const admin = createAdminClient();
  const versions: { version: number; title: string; createdAt: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("adventure_versions_v3")
      .select("version,created_at,title:spec->>title").eq("adventure_id", id).order("version", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) versions.push({ version: row.version, title: row.title ?? `Version ${row.version}`, createdAt: row.created_at });
    if ((data?.length ?? 0) < 1000) break;
  }
  const [publications, attempts] = await Promise.all([deps.store.listPublications(id), deps.store.listAttempts(id)]);
  return {
    ok: true as const, latest: adventure.specVersion, publishedVersion: adventure.publishedVersion ?? null,
    published: adventure.status === "published",
    versions: versions.map((row) => ({ ...row,
      publication: publications.find((p) => p.version === row.version) ?? null,
      versionId: publications.find((p) => p.version === row.version)?.id ?? null,
      attempts: attempts.filter((a) => a.specVersion === row.version).length,
    })),
  };
}
