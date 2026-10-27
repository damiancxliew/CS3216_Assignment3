"use server";

import { revalidatePath } from "next/cache";

import { publishAdventure, unpublishAdventure } from "@/lib/play/v3/publish";
import { v3PublishDeps } from "@/lib/play/v3/http";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";
import { publishSelectedVersion } from "@/lib/v3/versions";

export type PublishActionResult = { ok: true; status: string } | { ok: false; message: string };

async function run(
  adventureId: string,
  change: typeof publishAdventure,
  expected?: { version: number; publishedVersion: number | null },
): Promise<PublishActionResult> {
  if (!v3Enabled()) return { ok: false, message: "Not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sign in again to continue." };

  const result = await change(v3PublishDeps(), user.id, adventureId, expected);
  if (result.status !== 200) {
    const body = result.body as { error: { message: string } };
    return { ok: false, message: body.error.message };
  }
  revalidatePath(`/v3/teacher/${adventureId}`, "layout");
  revalidatePath(`/v3/join/${adventureId}`);
  return { ok: true, status: (result.body as { status: string }).status };
}

export async function publishV3Adventure(adventureId: string, expected?: { version: number; publishedVersion: number | null }): Promise<PublishActionResult> {
  return run(adventureId, publishAdventure, expected);
}

export async function unpublishV3Adventure(adventureId: string, expected?: { version: number; publishedVersion: number | null }): Promise<PublishActionResult> {
  return run(adventureId, unpublishAdventure, expected);
}

export async function publishSavedV3Version(adventureId: string, selected: number, expected: { version: number; publishedVersion: number | null }): Promise<PublishActionResult> {
  if (!v3Enabled()) return { ok: false, message: "Not found." };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false, message: "Sign in again." };
  const result = await publishSelectedVersion(v3PublishDeps(), user.id, adventureId, selected, expected);
  if (result.status !== 200) return { ok: false, message: (result.body as { error: { message: string } }).error.message };
  revalidatePath(`/v3/teacher/${adventureId}`, "layout");
  revalidatePath(`/v3/join/${adventureId}`);
  revalidatePath("/teacher");
  return { ok: true, status: "published" };
}

/** Returns the already-issued current release link; never creates or rotates one. */
export async function currentV3StudentLink(adventureId: string): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  if (!v3Enabled()) return { ok: false, message: 'Not found.' };
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { ok: false, message: 'Sign in again.' };
  const deps = v3PublishDeps();
  const { loadPublicationHistory } = await import('@/lib/play/v3/publication-history');
  const history = await loadPublicationHistory(deps, user.id, adventureId);
  const current = history?.rows.find(row => row.live && row.linkKey);
  if (!current) return { ok: false, message: 'Publish the current draft before copying its student link.' };
  return { ok: true, path: `/v3/join/${encodeURIComponent(adventureId)}?release=${encodeURIComponent(current.linkKey)}` };
}
