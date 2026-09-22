"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { persistSpecVersion, SpecPersistError } from "@/lib/adventures/persist-spec";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Every action here re-establishes who is asking from the session cookie and
 * lets the database decide what they may touch: the RPCs are owner-checked
 * (P4) and the direct writes run as the signed-in user under RLS. The service
 * role only appears where authoring content is written on the teacher's
 * behalf, after their ownership has been confirmed.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/teacher");
  return { supabase, user };
}

async function requireOwnership(adventureId: string) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("adventure")
    .select("id")
    .eq("id", adventureId)
    .maybeSingle();
  if (!data) redirect("/teacher");
  return { supabase, user };
}

export type ActionResult = { error?: string };

const newAdventure = z.object({
  title: z.string().trim().min(1, "Give the adventure a title").max(120),
  setting: z.string().trim().max(200).optional(),
});

export async function createAdventure(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const parsed = newAdventure.safeParse({
    title: formData.get("title"),
    setting: formData.get("setting") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { data, error } = await supabase
    .from("adventure")
    .insert({
      owner_id: user.id,
      title: parsed.data.title,
      setting: parsed.data.setting || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  redirect(`/teacher/${data.id}`);
}

export async function addTextSource(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Paste the source text first" };

  const admin = createAdminClient();
  const { error } = await admin.from("source").insert({
    adventure_id: adventureId,
    kind: "text",
    title: title || "Pasted source",
    storage_key: `inline:${crypto.randomUUID()}`,
    page_map: { pages: 1, text: body },
  });
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/**
 * Imports an adventure spec v2 as the next draft version. This is the seam the
 * planner (D3) plugs into: it hands over exactly this object, and everything
 * downstream — publish, share, play — is already wired.
 */
export async function importSpec(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await requireOwnership(adventureId);

  let candidate: unknown;
  try {
    candidate = JSON.parse(String(formData.get("spec") ?? ""));
  } catch {
    return { error: "That isn’t valid JSON" };
  }

  const admin = createAdminClient();
  try {
    await persistSpecVersion(admin, adventureId, candidate, {
      generatorVersion: "imported",
      createdBy: user.id,
    });
  } catch (error) {
    if (error instanceof SpecPersistError) {
      const detail = error.issues
        .slice(0, 3)
        .map((i) => `${i.path}: ${i.message}`)
        .join("; ");
      return { error: detail ? `${error.message} — ${detail}` : error.message };
    }
    throw error;
  }

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

export async function publishAdventure(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("publish_adventure", {
    p_adventure_id: adventureId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/** Editing a published adventure means a new draft version, never an edit in place (P4). */
export async function startEdit(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("create_draft_version", {
    p_adventure_id: adventureId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

export async function rotateShareToken(adventureId: string): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);
  const { error } = await supabase.rpc("rotate_share_token", {
    p_adventure_id: adventureId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/**
 * Timer settings (P6/D12/FR-16). An empty field inherits the adventure
 * default, 0 disables the timer for that stage; both are meaningful, so the
 * form distinguishes "" from "0" rather than falling back to a truthiness check.
 */
function parseTimer(raw: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const seconds = Number(text);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : "invalid";
}

export async function updateDefaultTimer(
  adventureId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await requireOwnership(adventureId);

  const seconds = parseTimer(formData.get("default_timer_seconds"));
  if (seconds === "invalid" || seconds === null) {
    return { error: "Give a whole number of seconds (0 disables timers)" };
  }

  const { error } = await supabase
    .from("adventure")
    .update({ default_timer_seconds: seconds })
    .eq("id", adventureId);
  if (error) return { error: error.message };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

/** Edits land on the draft version; the published one is frozen by trigger. */
export async function updateStage(
  adventureId: string,
  stageId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "A stage needs a title" };

  const timer = parseTimer(formData.get("timer_seconds"));
  if (timer === "invalid") {
    return { error: "Leave the timer empty to inherit, or give seconds (0 disables)" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("stage")
    .update({
      title,
      shared_context: String(formData.get("shared_context") ?? ""),
      timer_seconds: timer,
    })
    .eq("id", stageId);
  if (error) return { error: describeFrozen(error.message) };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

export async function updateAgent(
  adventureId: string,
  agentId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireOwnership(adventureId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A stakeholder needs a name" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("agent")
    .update({
      name,
      role: String(formData.get("role") ?? "") || null,
      public_position: String(formData.get("public_position") ?? "") || null,
    })
    .eq("id", agentId);
  if (error) return { error: describeFrozen(error.message) };

  revalidatePath(`/teacher/${adventureId}`);
  return {};
}

function describeFrozen(message: string): string {
  return message.includes("immutable")
    ? "This version is published and frozen. Choose “Edit as a new version” first."
    : message;
}
