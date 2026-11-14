"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Maximize2, X } from "lucide-react";
import { control, Thinking } from "@/components/ui";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import type { ReviewChatResult } from "@/lib/v3/review-chat/types";
import {
  findEditTargetsAction,
  suggestReviewChangeAction,
} from "./chat-actions";
import { useReviewChat } from "./review-chat-context";
import { ChatSendButton } from "./chat-send-button";
import { ReviewChangesDialog } from "./review-changes-dialog";
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
  const isDraft = Boolean(context?.isDraft);
  const current = useRef(target);
  current.current = target;
  const [text, setText] = useState("");
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState(false);
  const [activity, setActivity] = useState("Preparing a suggestion…");
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
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
  useEffect(() => {
    setSuggestion(null);
    setReviewOpen(false);
  }, [target?.key, target?.revision]);
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
      setReviewOpen(false);
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
    setReviewOpen(false);
    try {
      let result: ReviewChatResult;
      let replyMode = false;
      if (targetedDraft) {
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
        setActivity("Preparing a suggestion…");
        result = await suggestReviewChangeAction(
          adventureId,
          snapshot.input,
          text,
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
  const groups = valid
    ? valid.groups ??
      valid.preview.map((change, index) => ({
        label: change.label,
        edits: [],
        preview: [index],
      }))
    : [];
  const applySuggestion = () => {
    if (!valid) return;
    const latest = current.current?.current();
    if (
      !latest ||
      latest.pending ||
      latest.key !== valid.key ||
      latest.revision !== valid.revision ||
      !valid.proposal
    )
      return;
    latest.apply(valid.proposal);
    setSuggestion(null);
    setReviewOpen(false);
    setMessage("Applied to the cards.");
  };
  const discardSuggestion = () => {
    setSuggestion(null);
    setReviewOpen(false);
    setMessage("Kept your current edits.");
  };
  return (
    <div className="flex min-h-0 flex-col gap-3">
      {valid ? (
        <section
          aria-label="Suggested changes"
          className="flex min-h-0 flex-col overflow-hidden rounded-surface border border-line bg-surface text-sm"
        >
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <div className="flex-1">
              <h3 className="font-semibold">Suggested changes</h3>
              <p className="text-xs text-muted">· {groups.length} fields</p>
            </div>
            <button
              type="button"
              aria-label="Review changes"
              title="Review changes"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              onClick={() => setReviewOpen(true)}
            >
              <Maximize2 size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Discard suggestion"
              title="Discard suggestion"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-line text-muted hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              onClick={discardSuggestion}
            >
              <X size={16} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Apply suggestion"
              title="Apply suggestion"
              className="inline-flex h-8 w-8 items-center justify-center rounded-control bg-world text-on-accent hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-world disabled:opacity-50"
              disabled={Boolean(target?.pending)}
              onClick={applySuggestion}
            >
              <Check size={16} aria-hidden />
            </button>
          </header>
          <div className="min-h-0 max-h-44 overflow-y-auto divide-y divide-line md:max-h-72">
            {groups.map((group, index) => {
              const first = valid.preview[group.preview[0]];
              return (
                <div key={`${group.label}-${index}`} className="px-3 py-2">
                  <p className="text-xs font-semibold text-muted">
                    {group.label}
                  </p>
                  {first ? (
                    <p className="line-clamp-2">{first.after}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <ReviewChangesDialog
            open={reviewOpen && Boolean(valid)}
            onOpenChange={setReviewOpen}
            preview={valid.preview}
            groups={valid.groups}
            disabled={Boolean(target?.pending)}
            onApply={applySuggestion}
            onDiscard={discardSuggestion}
          />
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
