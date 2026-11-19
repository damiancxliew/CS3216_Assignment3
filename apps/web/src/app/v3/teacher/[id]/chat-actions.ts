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
import { atPath, type V3Edit } from "@/lib/v3/edit/commands";
import {
  answerReviewQuestion,
  fakeReviewQuestionAnswerer,
  fakeTargetedEditor,
  fakeRequestedEditor,
  proposeTargetedChanges,
  proposeRequestedChanges,
  type RequestedChanges,
  type TargetedChangeGroup,
} from "@/lib/v3/review-chat/propose";
import {
  reviewChatInput,
  type ReviewChatResult,
} from "@/lib/v3/review-chat/types";
import { loadReviewChatTarget } from "@/lib/v3/review-chat/target";
import { changePreview } from "@/lib/v3/review-chat/preview";
import {
  findEditTargets,
  type FindEditTargetsResult,
} from "@/lib/v3/review-chat/locate";
import {
  editableItems,
  pathLabel,
  textFields,
  type Path,
} from "@/lib/v3/review-chat/outline";
import { withChangeLog } from "@/lib/v3/review-chat/history";

const failure = (message: string): ReviewChatResult => ({ ok: false, message });
const selectedTargetsSchema = z.array(
  z.array(z.union([z.string().max(80), z.number().int().nonnegative()])).min(1).max(12),
).min(1).max(20_000);

function fakeDecisionClient() {
  return new FakeDecisionClient((request: DecisionRequest) => {
    const content = (request.input as {
      content?: { type: string; data?: unknown; text?: string }[];
    }[])[0]?.content;
    const message = content?.filter(({ type }) => type === "input_text").at(-1)?.text ?? "";
    const requestText = message.replace(/^Teacher's (?:message|edit request):\s*/i, "").trim();
    const isReply = requestText.endsWith("?") ||
      /^(thanks|thank you|ok|great|looks good)/i.test(requestText);
    const terms = new Set(
      (requestText.match(/[a-z0-9]+/gi) ?? [])
        .map((word) => word.toLowerCase().replace(/s$/, "")),
    );
    const stable = content?.find(block => block.type === "input_text" && block.text?.startsWith("{"))?.text;
    const json: unknown = stable ? JSON.parse(stable) : undefined;
    const data = json && typeof json === "object"
      ? Object.values(json as Record<string, unknown>).find(Array.isArray)
      : undefined;
    const candidates = Array.isArray(data) ? data : [];
    return Object.fromEntries(request.questions.map(({ name }, index) => {
      if (name === "change") return [name, isReply ? 0 : 1];
      const candidate = candidates[index];
      const text = candidate && typeof candidate === "object"
        ? Object.values(candidate as Record<string, unknown>).join(" ").toLowerCase()
        : "";
      const candidateTerms = new Set(
        (text.match(/[a-z0-9]+/gi) ?? []).map((word) => word.toLowerCase().replace(/s$/, "")),
      );
      const matches = [...terms].filter((term) => candidateTerms.has(term)).length;
      return [name, matches ? Math.min(1, 0.5 + (matches - 1) * 0.2) : 0];
    }));
  });
}

export async function suggestReviewChangeAction(
  adventureId: string,
  rawInput: unknown,
  rawText: string,
  rawTargets?: unknown,
  rawMode?: unknown,
): Promise<ReviewChatResult> {
  if (!z.string().uuid().safeParse(adventureId).success)
    return failure("Not found.");
  const viewer = await getViewer(await createClient());
  const { user } = viewer;
  if (!user) return failure("Sign in again, then retry your message.");
  if (!isStaff(viewer) && !viewer.isSysadmin) return failure("Not found.");
  const admin = createAdminClient();
  const briefs = supabaseV3BriefStore(admin);
  const row = await briefs.load(adventureId);
  if (!row || !canAccessV3Authoring(viewer, row))
    return failure("Not found.");
  const parsed = reviewChatInput.safeParse(rawInput);
  const text = z.string().trim().min(1).max(4000).safeParse(rawText);
  const mode = z.enum(["reply"]).optional().safeParse(rawMode);
  if (!parsed.success || !text.success || !mode.success)
    return failure("Write a request of up to 4,000 characters.");
  const input = parsed.data;
  const replyMode = mode.data === "reply";
  if (replyMode && input.pass !== "draft")
    return failure("Plain replies are only available for saved drafts.");
  if (replyMode && rawTargets !== undefined)
    return failure("A reply cannot target fields.");
  let targets: Path[] | undefined;
  if (rawTargets !== undefined && input.pass === "draft") {
    const selected = selectedTargetsSchema.safeParse(rawTargets);
    if (!selected.success)
      return failure("That content can no longer be changed. Try your request again.");
    targets = selected.data;
  }
  const state = row.state ?? initialBriefStateV3(adventureId);
  if (state.messages.length > 198)
    return failure(
      "This conversation is full. You can still edit the cards directly.",
    );
  const llm: LlmClient =
    process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production"
      ? replyMode
        ? fakeReviewQuestionAnswerer()
        : targets
          ? fakeTargetedEditor()
          : fakeRequestedEditor()
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
  const history = state.messages
    .filter((message) => message.slot === "review")
    .slice(-8)
    .map(({ role, text }) => ({ role, text: text.split("\n\nTargets: ")[0]! }));
  let notes: string;
  let changes: Extract<V3Edit, { type: "set" }>[] = [];
  let groups: TargetedChangeGroup[] | undefined;
  const context = input.pass === "draft" ? input.context : undefined;
  // The preview's focus reaches the models as an earlier note, never as the stored message.
  const modelHistory = context
    ? [{ role: "user" as const, text: `(What I'm looking at in the preview)\n${context}` }, ...history]
    : history;
  if (replyMode) {
    const result = await answerReviewQuestion(
      { llm },
      { text: text.data, current, history: modelHistory },
    );
    if (!result.ok) return result;
    notes = result.notes;
  } else {
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
        return failure("That content can no longer be changed. Try your request again.");
      result = await proposeTargetedChanges(
        { llm },
        {
          text: text.data,
          current,
          targets,
          history: modelHistory,
          validate,
        },
      );
      const shouldWiden = !result.ok ? result.widen : result.changes.length === 0;
      if (shouldWiden) {
        const decide = process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production"
          ? fakeDecisionClient()
          : withDecisionUsage(new OpenAiDecisionClient(), { purpose: "generation", adventureV3Id: adventureId, organizationId: row.schoolId, userId: user.id });
        const wider = await findEditTargets({ decide }, { spec: current, text: text.data, history, wide: true, context });
        if (!wider.ok || wider.intent !== "change") return failure("I couldn't make that change. Try naming the stage, character or document.");
        const originalPaths = new Set(targets.map(path => JSON.stringify(path)));
        const widerPaths = new Set(wider.targets.map(({ path }) => JSON.stringify(path)));
        const sameTargets = originalPaths.size === widerPaths.size &&
          [...originalPaths].every(path => widerPaths.has(path));
        if (sameTargets) {
          if (!result.ok) return failure("I couldn't make that change. Try naming the stage, character or document.");
        } else {
          result = await proposeTargetedChanges({ llm }, { text: text.data, current, targets: wider.targets.map(field => field.path), history: modelHistory, validate });
          if (!result.ok && result.widen) return failure("I couldn't make that change. Try naming the stage, character or document.");
        }
      }
    } else {
      result = await proposeRequestedChanges(
        { llm },
        {
          text: text.data,
          subject: input.pass,
          current,
          roots,
          selection: input.pass === "sources",
          history: modelHistory,
          validate,
        },
      );
    }
    if (!result.ok) return result;
    notes = result.notes;
    changes = result.changes;
    groups = result.groups;
  }
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
      "The conversation changed while I was working. Reload before trying again.",
    );
  const assistantText = changes.length
    ? withChangeLog(notes, changes.flatMap((change, index) => {
        if (change.type !== "set" || typeof change.value !== "string") return [];
        let before: unknown;
        try {
          before = atPath(current, change.path);
        } catch {
          return [];
        }
        if (typeof before !== "string") return [];
        return [{
          label: groups?.find(group => group.edits.includes(index))?.label ??
            pathLabel(change.path),
          before,
          after: change.value,
        }];
      }))
    : notes;
  const next = briefStateV3Schema.parse({
    ...state,
    messages: [
      ...state.messages,
      {
        role: "user",
        text: text.data,
        slot: "review",
      },
      { role: "assistant", text: assistantText, slot: "review" },
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
      "Could not save this conversation. Try again.",
    );
  if (!saved.data?.length)
    return failure(
      "The adventure changed while I was working. Try again.",
    );
  return {
    ok: true,
    preview: changes.map((change) =>
      changePreview(current, change, changes),
    ),
    ...(groups !== undefined
      ? {
          groups: groups.map((group) => ({
            ...group,
            edits: group.edits.map((index) =>
              index + (input.pass === "draft" ? input.edits.length : 0),
            ),
          })),
        }
      : {}),
    notes,
    proposal: changes.length ? proposal(changes) : null,
    state: next,
  };
}

export async function findEditTargetsAction(
  adventureId: string,
  rawInput: unknown,
  rawText: string,
): Promise<FindEditTargetsResult> {
  if (!z.string().uuid().safeParse(adventureId).success)
    return { ok: false, message: "Not found." };
  const viewer = await getViewer(await createClient());
  const { user } = viewer;
  if (!user)
    return { ok: false, message: "Sign in again, then retry your message." };
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
  const history = (row.state?.messages ?? [])
    .filter((message) => message.slot === "review")
    .slice(-4)
    .map(({ role, text }) => ({ role, text: text.split("\n\nTargets: ")[0]! }));
  return findEditTargets(
    { decide: decisionClient, ...(process.env.V3_FAKE_PASSES && process.env.NODE_ENV !== "production" ? {} : { llm: withJsonUsage(new OpenAiLlmClient({ timeoutMs: 30_000, maxRetries: 0 }), { purpose: "generation", adventureV3Id: adventureId, organizationId: row.schoolId, userId: user.id }) }) },
    { spec: target.current, text: text.data, history, context: parsed.data.context },
  );
}
