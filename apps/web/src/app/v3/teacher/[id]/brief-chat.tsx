"use client";

import { ArrowDown, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useImperativeHandle, useRef, useState, useTransition, type Ref, type ReactNode } from "react";

import { useBriefStream } from "@/lib/brief/use-brief-stream";
import { button, control, ErrorText, Thinking } from "@/components/ui";
import {
  type BriefInputV3,
  type BriefStateV3,
  currentSlot,
  quickReplies,
  SOURCES_DONE,
} from "@/lib/v3/brief/schema";

import { createFromV3Brief, discardV3Brief } from "../actions";
import { ReviewChatComposer } from "./review-chat-composer";
import { ChatSendButton } from "./chat-send-button";
import { SourceUpload } from "./source-upload";
import { visibleReviewText } from "@/lib/v3/review-chat/history";
import type { BriefUploads } from "./use-brief-uploads";
import styles from "./creation-workspace.module.css";

export type BriefChatActions = { change(slot: string): void; create(): void; discard(): void };

/**
 * The conversation pane. While the brief is active (always inside the creation
 * workspace, which owns the state and uploads) it shows the controls the
 * current slot allows; afterwards it is the review chat composer. State lives
 * on the server; each turn posts the input and renders the state that comes back.
 */
export function V3BriefChat({ initial, active = true, statusMessage, generating = false, reviewIdleHint, onStateChange, onGenerationStart, onGenerationError, compact = false, controlledState, uploads, actionsRef, onBusyChange }: {
  controlledState?: BriefStateV3; uploads?: BriefUploads; actionsRef?: Ref<BriefChatActions>; onBusyChange?: (busy: boolean) => void;
  compact?: boolean; initial: BriefStateV3; active?: boolean; statusMessage?: string; generating?: boolean; reviewIdleHint?: string;
  onStateChange?: (state: BriefStateV3) => void; onGenerationStart?: () => void; onGenerationError?: () => void;
}) {
  const [localState, setState] = useState<BriefStateV3>(initial);
  const state = controlledState ?? localState;
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionPending, startTransition] = useTransition();
  const stream = useBriefStream((next: BriefStateV3) => {
    setState(next);
    onStateChange?.(next);
  }, setError);
  const pending = actionPending || stream.streaming || Boolean(uploads?.busy);
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const [scrollBox, setScrollBox] = useState<HTMLDivElement | null>(null);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusRequested = useRef(false);

  const slot = currentSlot(state.draft);
  const replies = quickReplies(state.draft, slot);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.messages.length, stream.preview, pending, statusMessage]);

  useEffect(() => {
    const box = scrollBox;
    if (!box) return;
    const update = () => setAwayFromEnd(box.scrollHeight - box.scrollTop - box.clientHeight > 80);
    update();
    box.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => { box.removeEventListener("scroll", update); observer.disconnect(); };
  }, [scrollBox]);

  function scrollToEnd() {
    const box = scrollBox;
    if (!box) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: box.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }

  useEffect(() => {
    autoGrow(composer.current, 240);
  }, [text]);

  useEffect(() => { onBusyChange?.(pending); }, [onBusyChange, pending]);
  useEffect(() => {
    if (focusRequested.current && composer.current && !pending) {
      composer.current.focus();
      focusRequested.current = false;
    }
  }, [slot.name, pending]);
  useImperativeHandle(actionsRef, () => ({
    change(slot) { if (!pending && !generating) { focusRequested.current = true; send({ change: slot }); } },
    create,
    discard,
  }));

  function send(input: BriefInputV3) {
    if (pending) return;
    const sentText = "text" in input ? input.text.trim() : "accept" in input ? "Use this" : undefined;
    const previousText = text;
    setText("");
    void stream.send("/api/v3/brief/turn", { adventureId: state.adventureId, input }, sentText ? { role: "user", text: sentText, slot: slot.name } : undefined)
      .then((ok) => { if (!ok) setText((current) => current || previousText); });
  }

  function create() {
    if (pending || generating) return;
    setError(null);
    onGenerationStart?.();
    startTransition(async () => {
      try {
        const result = await createFromV3Brief(state.adventureId);
        if ("error" in result) { setError(result.error); onGenerationError?.(); }
        else router.refresh();
      } catch {
        setError("Could not start generation. Please try again.");
        onGenerationError?.();
      }
    });
  }

  function discard() {
    if (pending || generating) return;
    startTransition(async () => {
      const result = await discardV3Brief(state.adventureId);
      if ("error" in result) setError(result.error);
      else router.push("/teacher");
    });
  }

  const sourcesStep = active && slot.name === "sources";
  const thinking = generating ? "Preparing your adventure" : slot.name === "sources" ? "Reading your sources" : "Updating your brief";

  const userClassName = compact
    ? "ml-8 self-end rounded-surface rounded-br-sm bg-record-wash px-3 py-2 text-ink"
    : `${styles.bubble} ${styles.userBubble}`;
  const body = (reviewForm?: ReactNode, reviewAt?: (index: number) => ReactNode) => (
    <div className={`flex min-h-0 flex-1 flex-col ${compact ? "gap-4" : styles.chatBody}`}>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={setScrollBox} className={`min-h-0 flex-1 overflow-y-auto [overflow-wrap:anywhere] ${compact ? "px-1 pb-4" : styles.transcript}`} data-conversation-scroll>
        <ol className={`flex flex-col ${compact ? "gap-3 text-base" : styles.messages}`} aria-live="polite">
          {[...state.messages, ...(stream.preview as BriefStateV3["messages"])].map((message, index) => {
            const text = visibleReviewText(message);
            return (
              <Fragment key={index}>
              {reviewAt?.(index)}
              <li
                className={compact
                  ? message.role === "user"
                    ? "ml-8 self-end rounded-surface rounded-br-sm bg-record-wash px-3 py-2 text-ink"
                    : "self-start py-0.5 text-ink"
                  : `${styles.bubble} ${message.role === "user" ? styles.userBubble : "self-start"}`}
              >
                <p className="whitespace-pre-wrap">{text}</p>
                {message.role === "assistant" && message.proposedText ? (
                  <p className="mt-3 border-l-2 border-line-strong pl-3 font-semibold">{message.proposedText}</p>
                ) : null}
              </li>
              </Fragment>
            );
          })}
          {reviewAt?.(state.messages.length)}
          {pending && !uploads?.busy && !generating ? (
            <li className="mr-10 self-start px-4 py-2 sm:mr-24">
              <Thinking label={thinking} />
            </li>
          ) : null}
        </ol>
        {!active && statusMessage ? <div className="mt-4 px-4 py-2 text-center text-sm text-muted" role="status">{statusMessage}</div> : null}
        <div ref={endRef} />
      </div>
      <button
        type="button"
        aria-label="Scroll to latest message"
        aria-hidden={!awayFromEnd}
        tabIndex={awayFromEnd ? 0 : -1}
        onClick={scrollToEnd}
        className={`absolute bottom-2 left-1/2 flex size-8 -translate-x-1/2 items-center justify-center rounded-full bg-surface/95 text-muted shadow-[0_2px_8px_color-mix(in_srgb,var(--shadow)_14%,transparent)] transition-opacity duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none ${awayFromEnd ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        <ArrowDown size={16} aria-hidden />
      </button>
      </div>

      <footer className={`flex min-h-0 ${compact ? "shrink flex-col gap-3 pt-3" : `shrink-0 flex-col ${styles.composer} ${sourcesStep ? styles.composerWithActions : ""}`}`}>
        {error ? <div className="col-span-full"><ErrorText>{error}</ErrorText></div> : null}
        <div className={compact ? "contents" : styles.composerMain}>
        {!active ? (
          reviewForm
        ) : slot.name === "confirm" ? (
          <p className="text-sm text-muted">Use the pencil icons on the cards to change your brief.</p>
        ) : slot.name === "sources" ? (
          uploads ? <SourceUpload uploads={uploads} disabled={actionPending || stream.streaming || generating} /> : null
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim() && !pending) send({ text });
            }}
          >
            {replies.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {replies.map((reply) => (
                  <button key={reply} type="button" onClick={() => send({ text: reply })} disabled={pending} className={button.subtle + " !text-sm !font-semibold !py-1"}>
                    {reply}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <textarea
                ref={composer}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (text.trim() && !pending) send({ text });
                  }
                }}
                rows={1}
                aria-label="Your answer"
                disabled={pending}
                placeholder="Type your answer…"
                className={control + " min-h-0 flex-1 resize-none py-3"}
              />
              <ChatSendButton label="Send" disabled={pending || !text.trim()} hint={pending ? "Updating the brief…" : !text.trim() ? "Type an answer to send." : "Send message"} />
            </div>
          </form>
        )}
        </div>
        {sourcesStep && !compact && uploads ? <div className={styles.composerActions}>
          <button
            type="button"
            aria-label="All sources added"
            title="All sources added"
            className={styles.sourcesDone}
            disabled={pending || generating || uploads.busy || state.sources.length === 0}
            onClick={() => send({ text: SOURCES_DONE })}
          ><Check size={18} aria-hidden /></button>
        </div> : null}
      </footer>
    </div>
  );
  return active ? body() : <ReviewChatComposer adventureId={state.adventureId} idleHint={reviewIdleHint} messageCount={state.messages.length} userClassName={userClassName} onConversation={next => { setState(next); onStateChange?.(next); }} render={body} />;
}

function autoGrow(field: HTMLTextAreaElement | null, maxPx: number) {
  if (!field) return;
  field.style.height = "0px";
  field.style.height = `${Math.min(field.scrollHeight, maxPx)}px`;
}
