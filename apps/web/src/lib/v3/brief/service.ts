import { OpenAiLlmClient } from "@adventure/generation/llm";
import type { ExtractedDocument } from "@adventure/generation";
import { getViewer, isStaff, type Viewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withJsonUsage } from "@/lib/usage/ledger";
import { v3Enabled, v3SchoolAllowed } from "@/lib/v3/flag";
import { supabaseV3BriefStore } from "./store";
import { briefTurnV3 } from "./turn";
import type { BriefInputV3 } from "./schema";
import { defaultGenerationDeps } from "@/lib/v3/generation/deps";
import { replyStreamOptions, type ReplyListener } from "@/lib/brief/stream";

const notFound = { error: "not_found" } as const;

export async function requireStaff(): Promise<{ viewer: Viewer; userId: string; schoolId: string } | { error: string }> {
  if (!v3Enabled()) return notFound;
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer.user || !isStaff(viewer) || !viewer.membership) return notFound;
  return { viewer, userId: viewer.user.id, schoolId: viewer.membership.organizationId };
}

/** Loads a briefing row and checks the caller owns it and the school is allowed. */
export async function requireBriefingRow(adventureId: string, userId: string) {
  const store = supabaseV3BriefStore(createAdminClient());
  const row = await store.load(adventureId);
  if (!row || row.ownerId !== userId || !v3SchoolAllowed(row.schoolId)) return null;
  return { store, row };
}

export async function runV3BriefTurn(adventureId: string, input: BriefInputV3, onReply?: ReplyListener) {
  const auth = await requireStaff();
  if ("error" in auth) return auth;
  const context = await requireBriefingRow(adventureId, auth.userId);
  if (!context || context.row.status !== "briefing" || !context.row.state) return notFound;

  if (!process.env.OPENAI_API_KEY) {
    console.error("v3 brief assistant unavailable: OPENAI_API_KEY is missing");
    return { ok: false as const, error: "This feature is temporarily unavailable. Please try again later." };
  }

  let documents: ExtractedDocument[];
  try {
    documents = await defaultGenerationDeps().sources.load(adventureId);
  } catch (error) {
    console.error("could not load v3 brief sources", adventureId, error);
    return { ok: false as const, error: "Your sources can’t be loaded right now. Please try again later." };
  }

  const result = await briefTurnV3(context.row.state, input, {
    llm: withJsonUsage(new OpenAiLlmClient({ timeoutMs: 90_000, ...replyStreamOptions(onReply) }), {
      purpose: "brief",
      organizationId: context.row.schoolId,
      userId: auth.userId,
    }),
    documents,
  });
  if (!result.ok) return result;
  await context.store.save(adventureId, result.state);
  return result;
}

