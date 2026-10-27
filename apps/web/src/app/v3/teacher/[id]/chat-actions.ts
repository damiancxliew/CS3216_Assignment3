"use server";
import { z } from "zod";
import { OpenAiLlmClient } from "@adventure/generation/llm";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { v3Enabled } from "@/lib/v3/flag";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { canAccessV3Authoring } from "@/lib/v3/access";
import { briefStateV3Schema, initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { withJsonUsage } from "@/lib/usage/ledger";
import {
  fakeRequestedEditor,
  proposeRequestedChanges,
} from "@/lib/v3/review-chat/propose";
import {
  reviewChatInput,
  type ReviewChatResult,
} from "@/lib/v3/review-chat/types";
import { loadReviewChatTarget } from "@/lib/v3/review-chat/target";
import { changePreview } from "@/lib/v3/review-chat/preview";

const failure = (message: string): ReviewChatResult => ({ ok: false, message });

export async function suggestReviewChangeAction(
  adventureId: string,
  rawInput: unknown,
  rawText: string,
): Promise<ReviewChatResult> {
  if (!v3Enabled() || !z.string().uuid().safeParse(adventureId).success)
    return failure("Not found.");
  const viewer = await getViewer(await createClient());
  const { user } = viewer;
  if (!user) return failure("Sign in again. Your message is still here.");
  if (!isStaff(viewer) && !viewer.isSysadmin) return failure("Not found.");
  const admin = createAdminClient();
  const briefs = supabaseV3BriefStore(admin);
  const row = await briefs.load(adventureId);
  if (!row || !canAccessV3Authoring(viewer, row))
    return failure("Not found.");
  const parsed = reviewChatInput.safeParse(rawInput);
  const text = z.string().trim().min(1).max(4000).safeParse(rawText);
  if (!parsed.success || !text.success)
    return failure("Write a request of up to 4,000 characters.");
  const input = parsed.data;
  const state = row.state ?? initialBriefStateV3(adventureId);
  if (state.messages.length > 198)
    return failure(
      "This conversation is full. You can still edit the cards directly.",
    );
  const llm =
    process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production"
      ? fakeRequestedEditor()
      : withJsonUsage(
          new OpenAiLlmClient({ timeoutMs: 240_000, maxRetries: 0 }),
          {
            purpose: "generation",
            adventureV3Id: adventureId,
            organizationId: row.schoolId,
            userId: user.id,
          },
        );
  const target = await loadReviewChatTarget(admin, row, user.id, input);
  if (!target.ok) return target;
  const { current, roots, validate, proposal, stillCurrent } = target;
  const result = await proposeRequestedChanges(
    { llm },
    {
      text: text.data,
      subject: input.pass,
      current,
      roots,
      selection: input.pass === "sources",
      history: state.messages
        .filter((message) => message.slot === "review")
        .slice(-8)
        .map(({ role, text }) => ({ role, text })),
      validate,
    },
  );
  if (!result.ok) return result;
  if (!(await stillCurrent()))
    return failure(
      "This review changed while I was preparing the suggestion. Send the request again for the current step.",
    );
  const latest = await briefs.load(adventureId);
  if (
    !latest ||
    !canAccessV3Authoring(viewer, latest) ||
    latest.status !== row.status ||
    JSON.stringify(latest.state) !== JSON.stringify(row.state)
  )
    return failure(
      "The conversation changed while I was working. Your message is still here. Reload before trying again.",
    );
  const next = briefStateV3Schema.parse({
    ...state,
    messages: [
      ...state.messages,
      { role: "user", text: text.data, slot: "review" },
      { role: "assistant", text: result.notes, slot: "review" },
    ],
  });
  // Compare-and-swap prevents two chat tabs from overwriting each other's messages.
  const update = admin
    .from("adventures_v3")
    .update({ brief_state: next })
    .eq("id", adventureId)
    .eq("status", row.status)
    .eq("updated_at", latest.updatedAt!);
  const saved = await update.select("id");
  if (saved.error)
    return failure(
      "Could not save this conversation. Your message is still here. Try again.",
    );
  if (!saved.data?.length)
    return failure(
      "The adventure changed while I was working. Your message is still here. Try again.",
    );
  return {
    ok: true,
    preview: result.changes.map((change) => changePreview(current, change)),
    notes: result.notes,
    proposal: result.changes.length ? proposal(result.changes) : null,
    state: next,
  };
}
