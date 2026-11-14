"use client";
import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { compactButton as button, control, Thinking } from "@/components/ui";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import type { ReviewChatResult } from "@/lib/v3/review-chat/types";
import {
  findEditTargetsAction,
  suggestReviewChangeAction,
} from "./chat-actions";
import { useReviewChat } from "./review-chat-context";
import { reviewPrimary } from "./creation-styles";
import { ChatSendButton } from "./chat-send-button";
import { requestsSchemaUpgrade } from "@/lib/v3/review-chat/upgrade-intent";

type Suggestion = Extract<ReviewChatResult, { ok: true }> & {
  key: string;
  revision: string;
};
export function ReviewChatComposer({
  adventureId,
  idleHint = "You can send this when the next review is ready.",
  onConversation,
}: {
  adventureId: string;
  /** Why sending is unavailable when no review is open. */
  idleHint?: string;
  onConversation(state: BriefStateV3): void;
}) {
  const context = useReviewChat();
  const target = context?.target;
  const upgrade = context?.upgrade;
  const chips = context?.chips ?? [];
  const isDraft = Boolean(context?.isDraft);
  const current = useRef(target);
  current.current = target;
  const [text, setText] = useState("");
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState("Preparing a suggestion…");
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<Set<number>>(new Set());
  const storageKey = `v3-review-message:${adventureId}`;
  useEffect(() => {
    try {
      setText(sessionStorage.getItem(storageKey) ?? "");
    } catch {
      /* Drafting still works when browser storage is unavailable. */
    }
    setRestored(true);
  }, [storageKey]);
  useEffect(() => {
    if (!restored) return;
    try {
      if (text) sessionStorage.setItem(storageKey, text);
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Keep the in-memory draft. */
    }
  }, [storageKey, text, restored]);
  useEffect(() => setSuggestion(null), [target?.key, target?.revision]);
  useEffect(() => setMessage(""), [target?.key]);
  const upgradeRequest = Boolean(upgrade && (upgrade.active || requestsSchemaUpgrade(text)));
  const targetedDraft = isDraft && !upgradeRequest;
  const canSend = Boolean((upgradeRequest ? !upgrade?.pending : target && !target.pending) && text.trim() && !pending);
  const sendHint = !target && !upgrade
    ? idleHint
    : pending
      ? activity
      : target?.pending
        ? "Wait for the current action to finish."
        : !text.trim()
          ? "Write a message to send."
          : "Send message";
  const send = async () => {
    if (!canSend) return;
    if (upgradeRequest && upgrade) {
      setPending(true);
      setActivity("Preparing a suggestion…");
      setSuggestion(null);
      setMessage("");
      try {
        setMessage(await upgrade.route(text));
        setText("");
      } catch {
        setMessage("Could not prepare the upgrade. Your message is still here. Try again.");
      } finally {
        setPending(false);
      }
      return;
    }
    const snapshot = current.current?.current();
    if (!snapshot || !canSend) return;
    setPending(true);
    setMessage("");
    setSuggestion(null);
    setSelectedGroups(new Set());
    try {
      let result: ReviewChatResult;
      let replyMode = false;
      if (targetedDraft && chips.length === 0) {
        setActivity("Reading your request…");
        const intent = await findEditTargetsAction(adventureId, snapshot.input, text);
        if (!intent.ok) {
          setMessage(intent.message);
          return;
        }
        const latest = current.current?.current();
        if (
          !latest ||
          latest.key !== snapshot.key ||
          latest.revision !== snapshot.revision
        ) {
          setMessage(
            "Your edits changed while I was reading your request. Send it again for the current version.",
          );
          return;
        }
        if (intent.intent === "reply") {
          replyMode = true;
          setActivity("Writing a reply…");
          result = await suggestReviewChangeAction(
            adventureId,
            snapshot.input,
            text,
            undefined,
            "reply",
          );
        } else {
          setActivity("Writing the change…");
          result = await suggestReviewChangeAction(
            adventureId,
            snapshot.input,
            text,
            intent.targets.map(({ path }) => path),
          );
        }
      } else {
        setActivity(targetedDraft ? "Writing the change…" : "Preparing a suggestion…");
        result = await suggestReviewChangeAction(
          adventureId,
          snapshot.input,
          text,
          targetedDraft ? chips.map(({ path }) => path) : undefined,
        );
      }
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      onConversation(result.state);
      const latest = current.current?.current();
      if (
        !latest ||
        latest.key !== snapshot.key ||
        latest.revision !== snapshot.revision
      ) {
        setMessage(
          "Your edits changed while I was working. Send the request again to use the current version.",
        );
        return;
      }
      if (!targetedDraft || result.proposal || replyMode) setText("");
      if (result.proposal) {
        setSelectedGroups(new Set((result.groups ?? []).map((_, index) => index)));
        setSuggestion({
          ...result,
          key: snapshot.key,
          revision: snapshot.revision,
        });
      } else if (!replyMode) {
        setMessage(result.notes);
      }
    } catch {
      setMessage(
        "Could not prepare a suggestion. Your message is still here. Try again.",
      );
    } finally {
      setPending(false);
    }
  };
  const valid =
    suggestion &&
    target?.key === suggestion.key &&
    target.revision === suggestion.revision
      ? suggestion
      : null;
  const selectedGroupCount =
    valid?.groups?.filter((_, index) => selectedGroups.has(index)).length ?? 0;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {valid ? (
        <section
          aria-label="Suggested changes"
          className="creation-card min-h-0 max-h-44 md:max-h-80 space-y-3 overflow-y-auto rounded-control border border-line-strong bg-paper p-3 text-sm"
        >
          <h3 className="font-bold">Suggested changes</h3>
          {valid.groups
            ? valid.groups.map((group, groupIndex) => {
                const selected = selectedGroups.has(groupIndex);
                return (
                  <div key={`${group.label}-${groupIndex}`} className="space-y-1 border-t border-line pt-2">
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={`flex w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left font-semibold ${selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-muted"}`}
                      onClick={() => setSelectedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(groupIndex)) next.delete(groupIndex);
                        else next.add(groupIndex);
                        return next;
                      })}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-current" aria-hidden>
                        {selected ? <Check size={12} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">{group.label}</span>
                    </button>
                    {group.preview.map((previewIndex) => {
                      const change = valid.preview[previewIndex];
                      return change ? (
                        <div key={previewIndex} className="space-y-1 pl-2">
                          <p className="text-muted">
                            <span className="font-semibold">Current: </span>
                            {change.before}
                          </p>
                          <p>
                            <span className="font-semibold">Suggested: </span>
                            {change.after}
                          </p>
                        </div>
                      ) : null;
                    })}
                  </div>
                );
              })
            : valid.preview.map((change, index) => (
                <div key={index} className="space-y-1 border-t border-line pt-2">
                  <p className="font-semibold">{change.label}</p>
                  <p className="text-muted">
                    <span className="font-semibold">Current: </span>
                    {change.before}
                  </p>
                  <p>
                    <span className="font-semibold">Suggested: </span>
                    {change.after}
                  </p>
                </div>
              ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={reviewPrimary}
              disabled={Boolean(target?.pending) || Boolean(valid.groups?.length && selectedGroupCount === 0)}
              onClick={() => {
                const latest = current.current?.current();
                if (
                  !latest ||
                  latest.pending ||
                  latest.key !== valid.key ||
                  latest.revision !== valid.revision ||
                  !valid.proposal
                )
                  return;
                if (valid.groups && valid.proposal.pass === "draft") {
                  const excluded = new Set(
                    valid.groups.flatMap((group, index) =>
                      selectedGroups.has(index) ? [] : group.edits,
                    ),
                  );
                  latest.apply({
                    ...valid.proposal,
                    edits: valid.proposal.edits.filter(
                      (_, index) => !excluded.has(index),
                    ),
                  });
                } else {
                  latest.apply(valid.proposal);
                }
                setSuggestion(null);
                context?.clearChips();
                setMessage("Applied to the cards.");
              }}
            >
              Apply changes
            </button>
            <button
              type="button"
              className={button.subtle}
              onClick={() => {
                setSuggestion(null);
                context?.clearChips();
                setMessage("Kept your current edits.");
              }}
            >
              Keep my edits
            </button>
          </div>
        </section>
      ) : null}
      {pending ? <Thinking label={activity} /> : null}
      {message ? (
        <p role="status" className="text-sm text-muted">
          {message}
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex shrink-0 flex-col gap-2"
      >
        {targetedDraft && chips.length ? (
          <div className="space-y-1">
            <p className="text-xs text-muted">Only these fields will change</p>
            <div
              role="group"
              aria-label="Chat edit targets"
              className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto overscroll-contain py-1 pr-1 [scrollbar-gutter:stable] scroll-py-2"
            >
              {chips.map((chip) => (
                <div
                  key={chip.path.join(".")}
                  title={chip.label}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-line-strong bg-paper px-2.5 py-1 text-xs font-semibold text-ink"
                >
                  <span className="min-w-0 max-w-full truncate">{chip.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    disabled={pending}
                    className="shrink-0 rounded-full px-1 text-base leading-none text-muted hover:bg-line hover:text-ink"
                    onClick={() => context?.toggleChip(chip.path, chip.label)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <textarea
            aria-label="Message"
            placeholder="Ask a question or request a change…"
            value={text}
            maxLength={4000}
            disabled={pending}
            rows={1}
            className={control + " min-h-0 flex-1 resize-none py-3"}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <ChatSendButton
            label="Send message"
            disabled={!canSend}
            hint={sendHint}
          />
        </div>
      </form>
    </div>
  );
}
