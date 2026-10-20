import { redirect } from "next/navigation";
import { OpenAiLlmClient } from "@adventure/generation/llm";
import { type SourceRow, sourcesToDocuments } from "@/lib/adventures/generate-from-sources";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withJsonUsage } from "@/lib/usage/ledger";
import { type BriefInput, type BriefState, type BriefSource, briefStateSchema } from "./schema";
import { runBriefTurn, type TurnResult } from "./turn";
import { replyStreamOptions, type ReplyListener } from "@/lib/brief/stream";

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
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) redirect("/teacher");
  return { supabase, user };
}

export async function requireBrief(state: BriefState): Promise<{ state: BriefState; userId: string } | { error: string }> {
  const parsed = briefStateSchema.safeParse(state);
  if (!parsed.success) return { error: "The conversation got out of step — reload to start again" };
  const { user } = await requireOwnership(parsed.data.adventureId);
  return { state: parsed.data, userId: user.id };
}

/** The sources uploaded so far, both as the chat lists them and as the documents the assistant reads. */
export async function loadBriefSources(adventureId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("source")
    .select("id, title, kind, page_map, content_hash")
    .eq("adventure_id", adventureId)
    .order("created_at")
    .returns<(SourceRow & { page_map: { pages?: number } | null })[]>();
  const rows = data ?? [];
  const list: BriefSource[] = rows.map((row) => ({ id: row.id, title: row.title ?? "Untitled", pages: row.page_map?.pages ?? 0 }));
  return { list, documents: sourcesToDocuments(rows).documents };
}

export async function saveBrief(state: BriefState): Promise<TurnResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("adventure").update({ brief_state: state }).eq("id", state.adventureId);
  if (error) {
    console.error("could not save adventure setup", state.adventureId, error);
    return { ok: false, error: "Couldn’t save your progress. Please try again." };
  }
  return { ok: true, state };
}

export async function runStreamingBriefTurn(state: BriefState, input: BriefInput, onReply?: ReplyListener): Promise<TurnResult> {
  const checked = await requireBrief(state);
  if ("error" in checked) return { ok: false, error: checked.error };
  if (!process.env.OPENAI_API_KEY) {
    console.error("adventure assistant unavailable: OPENAI_API_KEY is missing");
    return { ok: false, error: "This feature is temporarily unavailable. Please try again later." };
  }
  const { list, documents } = await loadBriefSources(checked.state.adventureId);
  const result = await runBriefTurn(
    { ...checked.state, sources: list },
    input,
    withJsonUsage(new OpenAiLlmClient({ timeoutMs: 90_000, ...replyStreamOptions(onReply) }), {
      purpose: "brief",
      adventureId: checked.state.adventureId,
      userId: checked.userId,
    }),
    documents,
  );
  return result.ok ? saveBrief(result.state) : result;
}

