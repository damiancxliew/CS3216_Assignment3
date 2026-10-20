"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { button, control, Thinking } from "@/components/ui";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import type { ReviewChatResult } from "@/lib/v3/review-chat/types";
import { suggestReviewChangeAction } from "./chat-actions";
import { useReviewChat } from "./review-chat-context";

type Suggestion = Extract<ReviewChatResult, { ok: true }> & {
  key: string;
  revision: string;
};
export function ReviewChatComposer({
  adventureId,
  onConversation,
}: {
  adventureId: string;
  onConversation(state: BriefStateV3): void;
}) {
  const context = useReviewChat();
  const target = context?.target;
  const current = useRef(target);
  current.current = target;
  const [text, setText] = useState("");
  const [restored, setRestored] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
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
  const canSend = Boolean(target && !target.pending && text.trim() && !pending);
  const send = async () => {
    const snapshot = current.current?.current();
    if (!snapshot || !canSend) return;
    setPending(true);
    setMessage("");
    setSuggestion(null);
    try {
      const result = await suggestReviewChangeAction(
        adventureId,
        snapshot.input,
        text,
      );
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
      setText("");
      if (result.proposal)
        setSuggestion({
          ...result,
          key: snapshot.key,
          revision: snapshot.revision,
        });
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
  return (
    <div className="space-y-3">
      {valid ? (
        <section
          aria-label="Suggested changes"
          className="creation-card max-h-44 md:max-h-80 space-y-3 overflow-y-auto rounded-control border border-line-strong bg-paper p-3 text-sm"
        >
          <h3 className="font-bold">Suggested changes</h3>
          {valid.preview.map((change, index) => (
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
              className={button.quiet}
              disabled={Boolean(target?.pending)}
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
                latest.apply(valid.proposal);
                setSuggestion(null);
                setMessage(
                  "Applied. Review the cards before saving or continuing.",
                );
              }}
            >
              Apply changes
            </button>
            <button
              type="button"
              className={button.subtle}
              onClick={() => {
                setSuggestion(null);
                setMessage("Kept your current edits.");
              }}
            >
              Keep my edits
            </button>
          </div>
        </section>
      ) : null}
      {pending ? <Thinking label="Preparing a suggestion…" /> : null}
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
        className="flex items-end gap-2"
      >
        <textarea
          aria-label="Message"
          placeholder="Ask for a change…"
          value={text}
          maxLength={4000}
          disabled={pending}
          rows={2}
          className={`${control} max-h-40 min-h-0 flex-1 resize-y text-sm`}
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
        <button
          type="submit"
          aria-label="Send message"
          title="Send message"
          disabled={!canSend}
          className={button.quiet + " shrink-0 !px-3"}
        >
          <ArrowUp size={18} aria-hidden />
        </button>
      </form>
      {!target && !pending ? (
        <p className="text-xs text-muted">
          You can send this when the next review is ready.
        </p>
      ) : null}
    </div>
  );
}
