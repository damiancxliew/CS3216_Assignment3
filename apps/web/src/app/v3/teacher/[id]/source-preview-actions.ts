"use server";

import { z } from "zod";
import { requireStaff } from "@/lib/v3/brief/service";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessV3Authoring } from "@/lib/v3/access";

export type BriefSourcePreview = {
  title: string;
  kind: string;
  /** "outside" sources were read from a website; their text can include leftover page code. */
  origin: "upload" | "outside";
  pages: { page: number; text: string }[];
};

/** Read only the selected adventure/source pair after checking authoring access. */
export async function previewBriefSource(adventureId: string, sourceId: string): Promise<
  { ok: true; source: BriefSourcePreview } | { ok: false; error: string }
> {
  const unavailable = { ok: false as const, error: "This source is unavailable." };
  if (!z.string().uuid().safeParse(adventureId).success || !z.string().min(1).max(200).safeParse(sourceId).success) return unavailable;
  const auth = await requireStaff();
  if ("error" in auth) return unavailable;
  try {
    const admin = createAdminClient();
    const row = await supabaseV3BriefStore(admin).load(adventureId);
    if (!row || !canAccessV3Authoring(auth.viewer, row)) return unavailable;
    const { data, error } = await admin.from("sources_v3")
      .select("title, kind, origin, pages")
      .eq("adventure_id", adventureId)
      .eq("source_key", sourceId)
      .maybeSingle<{ title: string; kind: string; origin: string; pages: { page: number; text: string }[] | null }>();
    if (error) return { ok: false, error: "Couldn’t load this source. Please try again." };
    if (!data) return unavailable;
    return { ok: true, source: {
      title: data.title, kind: data.kind, origin: data.origin === "outside" ? "outside" : "upload",
      pages: (data.pages ?? []).map(({ page, text }) => ({ page, text })),
    } };
  } catch {
    return { ok: false, error: "Couldn’t load this source. Please try again." };
  }
}
