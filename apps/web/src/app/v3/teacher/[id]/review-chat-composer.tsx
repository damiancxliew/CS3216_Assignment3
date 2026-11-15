"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Maximize2, X, Pencil, RotateCcw } from "lucide-react";
import { control, Thinking } from "@/components/ui";
import type { BriefStateV3 } from "@/lib/v3/brief/schema";
import type { ReviewChatResult } from "@/lib/v3/review-chat/types";
import {
  findEditTargetsAction,
  suggestReviewChangeAction,
} from "./chat-actions";
import { useReviewChat } from "./review-chat-context";
import { ChatSendButton } from "./chat-send-button";
import { DiffText, ReviewChangesDialog } from "./review-changes-dialog";
import { wordDiff } from "@/lib/v3/review-chat/word-diff";
import { requestsSchemaUpgrade } from "@/lib/v3/review-chat/upgrade-intent";

type Suggestion = Extract<ReviewChatResult, { ok: true }> & {
  key: string;
  revision: string;
  anchor: number;
};
type LocalTurn = { id: number; text: string; anchor: number; status: string; error?: boolean };
export function ReviewChatComposer({
  adventureId,
  idleHint = "You can send this when the next review is ready.",
  onConversation,
  messageCount,
  userClassName,
  render,
}: {
  adventureId: string;
  /** Why sending is unavailable when no review is open. */
  idleHint?: string;
  onConversation(state: BriefStateV3): void;
  messageCount: number;
  userClassName: string;
  render(form: ReactNode, at: (index: number) => ReactNode): ReactNode;
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
  const [turns, setTurns] = useState<LocalTurn[]>([]);
  const [collapsed, setCollapsed] = useState<{ anchor: number; text: string } | null>(null);
  const sequence = useRef(0);
  const end = useRef<HTMLSpanElement>(null);
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
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [turns, activity, suggestion, collapsed]);
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
  const send = async (retryText?: string) => {
    const request = retryText ?? text;
    const upgrading = Boolean(upgrade && (upgrade.active || requestsSchemaUpgrade(request)));
    if (pending || !request.trim() || (upgrading ? upgrade?.pending : !target || target.pending)) return;
    const snapshot = current.current?.current();
    if (!upgrading && !snapshot) return;
    const id = ++sequence.current;
    setTurns(previous => [...previous, { id, text: request, anchor: messageCount, status: "" }]);
    if (retryText === undefined) {
      setText("");
      try { sessionStorage.removeItem(storageKey); } catch { /* Keep the in-memory draft. */ }
    }
    const setMessage = (status: string, error = true) => setTurns(previous => previous.map(turn => turn.id === id ? { ...turn, status, error } : turn));
    if (upgrading && upgrade) {
      setPending(true);
      setActivity("Preparing a suggestion…");
      setSuggestion(null);
      setReviewOpen(false);
      try {
        setMessage(await upgrade.route(request), false);
      } catch {
        setMessage("Could not prepare the upgrade. Try again.");
      } finally {
        setPending(false);
      }
      return;
    }
    if (!snapshot) return;
    setPending(true);
    setSuggestion(null);
    setReviewOpen(false);
    try {
      let result: ReviewChatResult;
      if (targetedDraft) {
        setActivity("Reading your request…");
        const intent = await findEditTargetsAction(adventureId, snapshot.input, request);
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
          setActivity("Writing a reply…");
          result = await suggestReviewChangeAction(
            adventureId,
            snapshot.input,
            request,
            undefined,
            "reply",
          );
        } else {
          setActivity("Writing the change…");
          result = await suggestReviewChangeAction(
            adventureId,
            snapshot.input,
            request,
            intent.targets.map(({ path }) => path),
          );
        }
      } else {
        setActivity("Preparing a suggestion…");
        result = await suggestReviewChangeAction(
          adventureId,
          snapshot.input,
          request,
        );
      }
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
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
      onConversation(result.state);
      setTurns(previous => previous.filter(turn => turn.id !== id));
      setCollapsed(null);
      if (result.proposal) {
        setSuggestion({
          ...result,
          key: snapshot.key,
          revision: snapshot.revision,
          anchor: result.state.messages.length,
        });
      }
    } catch {
      setMessage(
        "Could not prepare a suggestion. Try again.",
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
    setCollapsed({ anchor: valid.anchor, text: "Applied to the cards." });
    latest.apply(valid.proposal);
    setSuggestion(null);
    setReviewOpen(false);
  };
  const discardSuggestion = () => {
    if (valid) setCollapsed({ anchor: valid.anchor, text: "Kept your current edits." });
    setSuggestion(null);
    setReviewOpen(false);
  };
  const card = valid ? (
        <section
          aria-label="Suggested changes"
          className="flex min-h-0 flex-col overflow-hidden text-sm"
        >
          <header className="flex items-center gap-2 px-3 py-2">
            <div className="flex min-w-0 flex-1 items-baseline gap-1">
              <h3 className="font-semibold">Suggested changes</h3>
              <span className="text-xs text-muted">· {groups.length} fields</span>
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
          <div className="min-h-0 max-h-44 flex flex-col gap-2 overflow-y-auto md:max-h-96">
            {groups.map((group, index) => {
              return (
                <div
                  key={`${group.label}-${index}`}
                  className="flex flex-col gap-2 rounded-control bg-paper px-3 py-2"
                >
                  <p className="text-xs font-semibold text-muted">
                    {group.label}
                  </p>
                  {group.preview.map((previewIndex) => {
                    const change = valid.preview[previewIndex];
                    if (!change) return null;
                    const parts = wordDiff(change.before, change.after);
                    return (
                      <div
                        key={`${previewIndex}-${change.label}`}
                        className="space-y-2"
                      >
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                            Current
                          </p>
                          <DiffText
                            parts={parts}
                            mode="current"
                            className="line-clamp-4 whitespace-pre-wrap leading-relaxed"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                            Suggested
                          </p>
                          <DiffText
                            parts={parts}
                            mode="suggested"
                            className="line-clamp-4 whitespace-pre-wrap leading-relaxed"
                          />
                        </div>
                      </div>
                    );
                  })}
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
      ) : null;
  const at = (index: number) => <>
    {valid?.anchor === index ? <li className="min-w-0 self-stretch">{card}</li> : null}
    {collapsed?.anchor === index ? <li role="status" className="text-sm text-muted">{collapsed.text}</li> : null}
    {turns.filter(turn => turn.anchor === index).map(turn => <Fragment key={turn.id}>
      <li className={userClassName}><p className="whitespace-pre-wrap">{turn.text}</p></li>
      <li className="self-start py-0.5 text-ink" data-review-assistant>
        {turn.status ? <><p role="status" className={turn.error ? "text-danger" : "whitespace-pre-wrap"}>{turn.status}</p>
          {turn.error ? <div className="mt-1 flex gap-1">
            <button type="button" aria-label="Retry" disabled={pending} className="rounded-control p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-50" onClick={() => { setTurns(previous => previous.filter(item => item.id !== turn.id)); void send(turn.text); }}><RotateCcw size={14} aria-hidden /></button>
            <button type="button" aria-label="Edit message" className="rounded-control p-1.5 text-muted hover:bg-sunken hover:text-ink" onClick={() => { setTurns(previous => previous.filter(item => item.id !== turn.id)); setText(previous => previous || turn.text); }}><Pencil size={14} aria-hidden /></button>
          </div> : null}</> : <Thinking label={activity} />}
        <span ref={end} />
      </li>
    </Fragment>)}
  </>;
  return render(
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
            rows={1}
            className={control + " min-h-0 min-w-0 flex-1 resize-none py-3 placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap"}
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
    , at
  );
}
