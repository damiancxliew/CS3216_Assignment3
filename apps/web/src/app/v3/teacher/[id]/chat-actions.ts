"use server";
import { z } from "zod";
import {
  FakeDecisionClient,
  OpenAiDecisionClient,
  OpenAiLlmClient,
  type DecisionRequest,
  type LlmClient,
} from "@adventure/generation/llm";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { getViewer, isStaff } from "@/lib/auth/viewer";
import { canAccessV3Authoring } from "@/lib/v3/access";
import { briefStateV3Schema, initialBriefStateV3 } from "@/lib/v3/brief/schema";
import { supabaseV3BriefStore } from "@/lib/v3/brief/store";
import { withDecisionUsage, withJsonUsage } from "@/lib/usage/ledger";
import {
  fakeTargetedEditor,
  fakeRequestedEditor,
  proposeTargetedChanges,
  proposeRequestedChanges,
  type RequestedChanges,
} from "@/lib/v3/review-chat/propose";
import {
  reviewChatInput,
  type ReviewChatResult,
} from "@/lib/v3/review-chat/types";
import { loadReviewChatTarget } from "@/lib/v3/review-chat/target";
import { changePreview } from "@/lib/v3/review-chat/preview";
import { findEditTargets, type EditTarget } from "@/lib/v3/review-chat/locate";
import {
  editableItems,
  textFields,
  type Path,
} from "@/lib/v3/review-chat/outline";

const failure = (message: string): ReviewChatResult => ({ ok: false, message });
const selectedTargetsSchema = z.array(
  z.array(z.union([z.string().max(80), z.number().int().nonnegative()])).min(1).max(12),
).min(1).max(20);

type FindTargetsResult =
  | { ok: true; targets: EditTarget[] }
  | { ok: false; message: string };

function fakeDecisionClient() {
  return new FakeDecisionClient((request: DecisionRequest) => {
    const message = (request.input as {
      content?: { type: string; data?: unknown; text?: string }[];
    }[])[0]?.content?.find(({ type }) => type === "input_text")?.text ?? "";
    const terms = new Set(
      (message.replace(/^Teacher's edit request:\s*/i, "").match(/[a-z0-9]+/gi) ?? [])
        .map((word) => word.toLowerCase().replace(/s$/, "")),
    );
    const json = (request.input as {
      content?: { type: string; data?: unknown }[];
    }[])[0]?.content?.find(({ type }) => type === "input_json")?.data;
    const data = json && typeof json === "object"
      ? Object.values(json as Record<string, unknown>).find(Array.isArray)
      : undefined;
    const candidates = Array.isArray(data) ? data : [];
    return Object.fromEntries(request.questions.map(({ name }, index) => {
      const candidate = candidates[index];
      const text = candidate && typeof candidate === "object"
        ? Object.values(candidate as Record<string, unknown>).join(" ").toLowerCase()
        : "";
      const candidateTerms = new Set(
        (text.match(/[a-z0-9]+/gi) ?? []).map((word) => word.toLowerCase().replace(/s$/, "")),
      );
      const matches = [...terms].filter((term) => candidateTerms.has(term)).length;
      return [name, matches ? Math.min(1, 0.35 + (matches - 1) * 0.2) : 0];
    }));
  });
}

export async function suggestReviewChangeAction(
  adventureId: string,
  rawInput: unknown,
  rawText: string,
  rawTargets?: unknown,
): Promise<ReviewChatResult> {
  if (!z.string().uuid().safeParse(adventureId).success)
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
  let targets: Path[] | undefined;
  if (rawTargets !== undefined && input.pass === "draft") {
    const selected = selectedTargetsSchema.safeParse(rawTargets);
    if (!selected.success)
      return failure("One of the selected fields can no longer be changed. Find targets again.");
    targets = selected.data;
  }
  const state = row.state ?? initialBriefStateV3(adventureId);
  if (state.messages.length > 198)
    return failure(
      "This conversation is full. You can still edit the cards directly.",
    );
  const llm: LlmClient =
    process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production"
      ? targets ? fakeTargetedEditor() : fakeRequestedEditor()
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
  let targetLabels: string[] = [];
  const history = state.messages
    .filter((message) => message.slot === "review")
    .slice(-8)
    .map(({ role, text }) => ({ role, text }));
  let result: RequestedChanges;
  if (targets) {
    const editable = editableItems(current).flatMap((item) =>
      textFields(current, item.path)
        .filter((field) => !field.locked)
        .map((field) => ({ path: field.path, label: field.label })),
    );
    const requested = targets.map((path) =>
      editable.find((field) => field.path.join(".") === path.join(".")),
    );
    if (requested.some((field) => !field))
      return failure("One of the selected fields can no longer be changed. Find targets again.");
    targetLabels = requested.map((field) => field!.label);
    result = await proposeTargetedChanges(
      { llm },
      {
        text: text.data,
        current,
        targets,
        history,
        validate,
      },
    );
  } else {
    result = await proposeRequestedChanges(
      { llm },
      {
        text: text.data,
        subject: input.pass,
        current,
        roots,
        selection: input.pass === "sources",
        history,
        validate,
      },
    );
  }
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
      {
        role: "user",
        text: targets
          ? `${text.data}\n\nTargets: ${targetLabels.join(", ")}`
          : text.data,
        slot: "review",
      },
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
    preview: result.changes.map((change) =>
      changePreview(current, change, result.changes),
    ),
    notes: result.notes,
    proposal: result.changes.length ? proposal(result.changes) : null,
    state: next,
  };
}

export async function findEditTargetsAction(
  adventureId: string,
  rawInput: unknown,
  rawText: string,
): Promise<FindTargetsResult> {
  if (!z.string().uuid().safeParse(adventureId).success)
    return { ok: false, message: "Not found." };
  const viewer = await getViewer(await createClient());
  const { user } = viewer;
  if (!user)
    return { ok: false, message: "Sign in again. Your message is still here." };
  if (!isStaff(viewer) && !viewer.isSysadmin)
    return { ok: false, message: "Not found." };
  const admin = createAdminClient();
  const row = await supabaseV3BriefStore(admin).load(adventureId);
  if (!row || !canAccessV3Authoring(viewer, row))
    return { ok: false, message: "Not found." };
  const parsed = reviewChatInput.safeParse(rawInput);
  const text = z.string().trim().min(1).max(4000).safeParse(rawText);
  if (!parsed.success || !text.success)
    return { ok: false, message: "Write a request of up to 4,000 characters." };
  if (parsed.data.pass !== "draft")
    return { ok: false, message: "Target finding is only available for saved drafts." };
  const target = await loadReviewChatTarget(admin, row, user.id, parsed.data);
  if (!target.ok) return target;
  const decisionClient =
    process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production"
      ? fakeDecisionClient()
      : withDecisionUsage(new OpenAiDecisionClient(), {
          purpose: "generation",
          adventureV3Id: adventureId,
          organizationId: row.schoolId,
          userId: user.id,
        });
  return findEditTargets(
    { decide: decisionClient },
    { spec: target.current, text: text.data },
  );
}
