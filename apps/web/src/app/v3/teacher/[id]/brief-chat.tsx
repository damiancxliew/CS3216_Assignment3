"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useBriefStream } from "@/lib/brief/use-brief-stream";
import { button, control, ErrorText, Pending, Thinking } from "@/components/ui";
import {
  type BriefInputV3,
  type BriefStateV3,
  currentSlot,
  quickReplies,
  READING_LEVEL_LABELS,
  MODE_LABELS,
  ANY_SOURCE_WARNING,
  SOURCES_DONE,
  sourcePolicyLabel,
  timerLabel,
} from "@/lib/v3/brief/schema";

import { addV3BriefSource, createFromV3Brief, discardV3Brief } from "../actions";
import { ConfirmButton } from "./confirm-button";
import { ReviewChatComposer } from "./review-chat-composer";
import { ChatSendButton } from "./chat-send-button";

/**
 * The v3 guided brief: the transcript, the controls the current slot allows,
 * and the summary once the draft is complete. State lives on the server; each
 * turn posts the input and renders the state that comes back.
 */
export function V3BriefChat({ initial, active = true, statusMessage, generating = false, onStateChange, onGenerationStart, onGenerationError, compact = false }: {
  compact?: boolean; initial: BriefStateV3; active?: boolean; statusMessage?: string; generating?: boolean; onStateChange?: (state: BriefStateV3) => void; onGenerationStart?: () => void; onGenerationError?: () => void;
}) {
  const [state, setState] = useState<BriefStateV3>(initial);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [actionPending, startTransition] = useTransition();
  const stream = useBriefStream((next: BriefStateV3) => {
    setState(next);
    onStateChange?.(next);
  }, setError);
  const pending = actionPending || stream.streaming;
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const slot = currentSlot(state.draft);
  const replies = quickReplies(state.draft, slot).filter(() => !(slot.name === "sources" && state.sources.length === 0));

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.messages.length, stream.preview, pending, statusMessage]);

  useEffect(() => {
    autoGrow(composer.current, 240);
  }, [text]);

  function run(work: () => Promise<{ ok: true; state: BriefStateV3 } | { ok: false; error: string } | { error: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if ("state" in result && result.ok) {
          setState(result.state);
          onStateChange?.(result.state);
          setText("");
        } else if ("error" in result && result.error) {
          setError(result.error);
        }
      } catch (e) {
        console.error("v3 brief request failed", e);
        setError("Couldn’t complete that request. Please try again.");
      }
    });
  }

  function send(input: BriefInputV3) {
    if (pending) return;
    const sentText = "text" in input ? input.text.trim() : "accept" in input ? "Use this" : undefined;
    const previousText = text;
    setText("");
    void stream.send("/api/v3/brief/turn", { adventureId: state.adventureId, input }, sentText ? { role: "user", text: sentText, slot: slot.name } : undefined)
      .then((ok) => { if (!ok) setText((current) => current || previousText); });
  }

  function upload(formData: FormData, form: HTMLFormElement) {
    run(async () => {
      const result = await addV3BriefSource(state.adventureId, formData);
      if ("ok" in result && result.ok) {
        form.reset();
        return result;
      }
      return { ok: false as const, error: "error" in result ? result.error : "Couldn’t save that source." };
    });
  }

  function create() {
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

  const thinking = generating ? "Preparing your adventure" : slot.name === "sources" ? "Reading your sources" : "Updating your brief";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {active ? <div className="flex justify-end">
        <ConfirmButton
          label="Discard this brief"
          title="Discard this brief?"
          body="The conversation and any sources you added are thrown away."
          confirmLabel="Discard"
          disabled={pending}
          onConfirm={() =>
            startTransition(async () => {
              const result = await discardV3Brief(state.adventureId);
              if ("error" in result) setError(result.error);
              else router.push("/teacher");
            })
          }
        />
      </div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 [overflow-wrap:anywhere]" data-conversation-scroll>
        <ol className="flex flex-col gap-3 text-base" aria-live="polite">
          {[...state.messages, ...(stream.preview as BriefStateV3["messages"])].map((message, index) => (
            <li
              key={index}
              className={
                message.role === "user"
                  ? `${compact ? "ml-4" : "ml-10 sm:ml-24"} self-end rounded-surface rounded-br-sm bg-ink px-4 py-3 text-paper shadow-sm`
                  : `${compact ? "mr-4" : "mr-10 sm:mr-24"} self-start rounded-surface rounded-bl-sm border border-line bg-paper px-4 py-3 text-ink shadow-sm`
              }
            >
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.role === "assistant" && message.proposedText ? (
                <p className="mt-3 border-l-2 border-line-strong pl-3 font-semibold">{message.proposedText}</p>
              ) : null}
            </li>
          ))}
          {pending && !generating ? (
            <li className="mr-10 self-start px-4 py-2 sm:mr-24">
              <Thinking label={thinking} />
            </li>
          ) : null}
        </ol>
        {!active && statusMessage ? <div className="mt-4 px-4 py-2 text-center text-sm text-muted" role="status">{statusMessage}</div> : null}
        {active && slot.name === "sources" && state.sources.length > 0 ? <SourceList sources={state.sources} /> : null}
        {active && slot.name === "confirm" ? <details className="mt-4 text-sm"><summary className="w-fit cursor-pointer font-semibold text-muted">Change the brief</summary><Summary state={state} pending={pending} onChange={(change) => send({ change })} /></details> : null}
        <div ref={endRef} />
      </div>

      <footer className={`flex min-h-0 ${compact ? "shrink" : "shrink-0"} flex-col gap-3 border-t border-line pt-4`}>
        {error ? <ErrorText>{error}</ErrorText> : null}
        {!active || slot.name === "confirm" ? (
          <>
          {active ? <div className="flex flex-wrap gap-2">
            <button type="button" onClick={create} disabled={pending} className={button.primary}>
              {pending ? <Pending>Creating the adventure…</Pending> : "Create"}
            </button>
          </div> : null}
          <ReviewChatComposer adventureId={state.adventureId} onConversation={next => { setState(next); onStateChange?.(next); }} />
          </>
        ) : slot.name === "sources" ? (
          <SourceStep pending={pending} replies={replies} onUpload={upload} onDone={() => send({ text: SOURCES_DONE })} />
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
                  <button key={reply} type="button" onClick={() => send({ text: reply })} disabled={pending} className={button.subtle}>
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
      </footer>
    </div>
  );
}

function autoGrow(field: HTMLTextAreaElement | null, maxPx: number) {
  if (!field) return;
  field.style.height = "0px";
  field.style.height = `${Math.min(field.scrollHeight, maxPx)}px`;
}

function SourceList({ sources }: { sources: BriefStateV3["sources"] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {sources.map((source) => (
        <li key={source.id} className="inline-flex items-center gap-2 text-sm text-muted">
          <FileText className="h-4 w-4 text-signal" aria-hidden />
          {source.title}
          <span className="text-xs uppercase">{source.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function SourceStep({
  pending,
  replies,
  onUpload,
  onDone,
}: {
  pending: boolean;
  replies: string[];
  onUpload: (formData: FormData, form: HTMLFormElement) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onUpload(new FormData(event.currentTarget), event.currentTarget);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            name="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            aria-label="PDF, .txt or .md"
            disabled={pending}
            className={`${control} flex-1 file:mr-3 file:rounded-control file:border-0 file:bg-ink file:px-3 file:py-1 file:text-sm file:font-semibold file:text-paper`}
          />
          <button type="submit" disabled={pending} className={button.subtle}>
            Add source
          </button>
        </div>
        <textarea name="body" rows={3} placeholder="…or paste a passage here and press Add source" className={control + " resize-y py-3"} disabled={pending} />
      </form>
      <div className="flex flex-wrap gap-2">
        {replies.map((reply) => (
          <button key={reply} type="button" onClick={onDone} disabled={pending} className={button.primary}>
            {pending ? <Pending>Reading…</Pending> : reply}
          </button>
        ))}
      </div>
    </div>
  );
}

function Summary({ state, pending, onChange }: { state: BriefStateV3; pending: boolean; onChange: (slot: string) => void }) {
  const draft = state.draft;
  const rows: { slot: string; label: string; value: string; warning?: string }[] = [
    { slot: "episode", label: "Episode", value: draft.episode ?? "" },
    { slot: "focus", label: "Focus", value: draft.focus === "" ? "—" : (draft.focus ?? "—") },
    { slot: "readingLevel", label: "Reading level", value: draft.readingLevel ? READING_LEVEL_LABELS[draft.readingLevel] : "" },
    { slot: "timer", label: "Timer", value: draft.timerMinutes !== undefined ? timerLabel(draft.timerMinutes) : "" },
    { slot: "mode", label: "Mode", value: draft.mode ? MODE_LABELS[draft.mode] : "" },
    {
      slot: "allowlist",
      label: "Outside sources",
      value: sourcePolicyLabel(draft.sourcePolicy ?? undefined),
      ...(draft.sourcePolicy?.allowAny ? { warning: ANY_SOURCE_WARNING } : {}),
    },
  ];
  return (
    <div className="mt-4 rounded-surface border-2 border-line bg-surface p-5">
      <dl className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.slot} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <dt className="text-xs font-black uppercase tracking-[0.14em] text-muted">{row.label}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-ink">{row.value}</dd>
              {row.warning ? <p className="mt-1 text-xs text-signal">{row.warning}</p> : null}
            </div>
            <button type="button" onClick={() => onChange(row.slot)} disabled={pending} className={button.subtle + " shrink-0"}>
              Change
            </button>
          </div>
        ))}
      </dl>
    </div>
  );
}
