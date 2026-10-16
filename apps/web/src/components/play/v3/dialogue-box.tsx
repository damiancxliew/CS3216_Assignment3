"use client";

import type { CharacterView, DefiningMomentView, MessageView } from "@adventure/play-contract";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

type DialogueMessage = MessageView & {
  speaker?: string;
  insertedNoteText?: string | null;
};

type TalkProps = {
  mode: "talk";
  character: CharacterView;
  messages: DialogueMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onOpenNotes: () => void;
  onClose: () => void;
};

type MomentProps = {
  mode: "moment";
  moment: DefiningMomentView;
  busy: boolean;
  onAct: (actId: string) => void;
  onPredict: (outcomeId: string) => void;
};

export type DialogueBoxProps = TalkProps | MomentProps;

const boxClass =
  "absolute inset-x-2 bottom-2 z-20 flex max-h-[55%] flex-col overflow-hidden rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] font-sans text-[#1f2433] shadow-[4px_4px_0_#1f2433] sm:inset-x-4 sm:bottom-4";

function wordCount(text: string) {
  return text.match(/\S+/g)?.length ?? 0;
}

export function typewriterSlice(text: string, words: number): string {
  const count = Math.floor(words);
  if (count <= 0) return "";
  const matches = Array.from(text.matchAll(/\S+/g));
  if (count >= matches.length) return text;
  const last = matches[count - 1];
  return last?.index === undefined ? "" : text.slice(0, last.index + last[0].length);
}

export function useTypewriter(text: string, animate: boolean) {
  const total = wordCount(text);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [progress, setProgress] = useState(() => ({ text, words: total }));
  const intervalRef = useRef<number | null>(null);
  const words = progress.text === text ? progress.words : 0;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!animate || reducedMotion || total === 0) {
      setProgress({ text, words: total });
      return;
    }

    setProgress({ text, words: 0 });
    let visibleWords = 0;
    const timer = window.setInterval(() => {
      visibleWords = Math.min(total, visibleWords + 1);
      setProgress({ text, words: visibleWords });
      if (visibleWords >= total) {
        window.clearInterval(timer);
        intervalRef.current = null;
      }
    }, 45);
    intervalRef.current = timer;
    return () => {
      window.clearInterval(timer);
      if (intervalRef.current === timer) intervalRef.current = null;
    };
  }, [animate, reducedMotion, text, total]);

  const done = !animate || reducedMotion || words >= total;
  const shown = typewriterSlice(text, done ? total : words);
  const skip = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setProgress({ text, words: total });
  }, [text, total]);
  return { shown, done, skip };
}

export function nextChoiceIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return ((index + delta) % count + count) % count;
}

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isSkipKey(event: KeyboardEvent) {
  const key = event.key.toLowerCase();
  return key === "enter" || key === "e" || event.key === " " || event.code === "Space";
}

function TalkDialogue({ character, messages, busy, onSend, onOpenNotes, onClose }: TalkProps) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const seenAtOpen = useRef(new Set(messages.map((message) => message.id)));
  let animatingMessage: DialogueMessage | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (
      !seenAtOpen.current.has(message.id) &&
      ["character", "narration", "notice", "thought"].includes(message.kind)
    ) {
      animatingMessage = message;
      break;
    }
  }

  const { shown: typedText, done: typingDone, skip: skipTyping } =
    useTypewriter(animatingMessage?.text ?? "", Boolean(animatingMessage));

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const element = body.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, typedText]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (typingDone || !isSkipKey(event)) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        target.id === "v3-message" &&
        event.key === "Enter" &&
        !target.value.trim()
      ) {
        event.preventDefault();
        skipTyping();
        return;
      }
      if (isTextEntryTarget(target)) return;
      event.preventDefault();
      skipTyping();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, skipTyping, typingDone]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    onSend(message);
    setText("");
  }

  const initials = character.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <section aria-label={`Conversation with ${character.name}`} className={boxClass}>
      <header className="flex shrink-0 items-center gap-3 border-b-2 border-[#1f2433]/20 px-3 py-2 sm:px-4">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[#1f2433] bg-[#e7edff] text-sm font-black text-[#3659cf]">
          {initials || "?"}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-base font-black sm:text-lg">{character.name}</h2>
        <button
          type="button"
          aria-label="Close conversation (Esc)"
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-2xl font-bold leading-none hover:bg-[#1f2433]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf]"
        >
          ×
        </button>
      </header>

      <div
        ref={body}
        aria-live="polite"
        onClickCapture={(event) => {
          if (typingDone) return;
          event.preventDefault();
          event.stopPropagation();
          skipTyping();
        }}
        className="min-h-[3.5rem] min-w-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed sm:px-4 sm:py-3 sm:text-base"
      >
        {messages.length ? messages.map((message) => (
          <article key={message.id} className="break-words">
            <p className="mb-0.5 text-xs font-black uppercase tracking-wide text-[#5c6472]">
              {message.speaker ?? (message.kind === "player" ? "You" : message.characterId === character.id ? character.name : "Story")}
            </p>
            {message.text ? (
              <p className="whitespace-pre-wrap">
                {message.id === animatingMessage?.id ? (
                  <>
                    <span className="sr-only">{message.text}</span>
                    <span aria-hidden="true">{typedText}</span>
                  </>
                ) : message.text}
              </p>
            ) : null}
            {message.insertedNoteId ? (
              <blockquote className="mt-2 border-l-2 border-[#3659cf] bg-[#e7edff] px-3 py-2 text-sm">
                {message.insertedNoteText ?? "Note shared"}
              </blockquote>
            ) : null}
          </article>
        )) : (
          <p className="py-2 text-sm text-[#5c6472]">Say hello, or ask {character.name} a question.</p>
        )}
      </div>

      <form onSubmit={submit} className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t-2 border-[#1f2433]/20 p-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:p-3">
        <label htmlFor="v3-message" className="sr-only">Ask {character.name} a question</label>
        <input
          ref={input}
          id="v3-message"
          value={text}
          maxLength={1000}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Ask ${character.name} a question`}
          className="min-h-10 min-w-0 rounded-lg border-2 border-[#1f2433]/35 bg-white px-2.5 text-sm text-[#1f2433] placeholder:text-[#5c6472] disabled:opacity-60 sm:px-3"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="min-h-10 rounded-lg border-2 border-[#1f2433] bg-[#3659cf] px-3 text-sm font-black text-white hover:bg-[#2949b5] disabled:opacity-50 sm:px-4"
        >
          {busy ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={onOpenNotes}
          className="col-span-2 min-h-9 rounded-lg border border-[#1f2433]/35 px-3 text-sm font-bold hover:bg-[#1f2433]/5 sm:col-span-1"
        >
          Insert a note
        </button>
      </form>
    </section>
  );
}

function MomentDialogue({ moment, busy, onAct, onPredict }: MomentProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { shown: reactionShown, done: reactionDone, skip: skipReaction } = useTypewriter(
    moment.reaction ?? "",
    moment.status === "predicting" && Boolean(moment.reaction),
  );
  const choices = moment.status === "choosing"
    ? moment.acts.map((act) => ({ id: act.id, text: act.text }))
    : moment.predictionOptions.map((option) => ({ id: option.outcomeId, text: option.text }));

  useEffect(() => {
    setSelectedIndex(0);
  }, [moment.status]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const delta = key === "ArrowUp" || key === "w" ? -1 : key === "ArrowDown" || key === "s" ? 1 : 0;
      const select = key === "Enter" || event.key === " " || event.code === "Space";
      const skip = !reactionDone && isSkipKey(event);
      if (delta === 0 && !select && !skip) return;

      event.preventDefault();
      if (busy) return;
      if (skip) {
        skipReaction();
        return;
      }
      if (delta !== 0) {
        setSelectedIndex((current) => nextChoiceIndex(current, delta, choices.length));
        return;
      }
      const choice = choices[selectedIndex];
      if (!choice) return;
      if (moment.status === "choosing") onAct(choice.id);
      else onPredict(choice.id);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, choices, moment.status, onAct, onPredict, reactionDone, selectedIndex, skipReaction]);

  const handleBodyClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (reactionDone) return;
    event.preventDefault();
    event.stopPropagation();
    skipReaction();
  };

  return (
    <section aria-label="A defining moment" className={boxClass}>
      <div
        onClickCapture={handleBodyClickCapture}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 sm:px-4 sm:py-3"
      >
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#5c6472] sm:text-xs">A defining moment</p>
        <h2 className="mt-1 text-base font-black leading-snug sm:text-lg">{moment.scene}</h2>
        {moment.nudge ? <p className="mt-1 text-xs leading-relaxed text-[#5c6472] sm:text-sm">{moment.nudge}</p> : null}

        {moment.status === "predicting" ? (
          <>
            {moment.reaction ? (
              <p aria-live="polite" className="mt-2 whitespace-pre-wrap text-sm leading-relaxed sm:text-base">
                <span className="sr-only">{moment.reaction}</span>
                <span aria-hidden="true">{reactionShown}</span>
              </p>
            ) : null}
            <h3 className="mt-2 text-sm font-black sm:text-base">
              What will {moment.deciderName || "they"} decide?
            </h3>
          </>
        ) : null}

        <div
          role="listbox"
          aria-label={moment.status === "choosing" ? "Choose an action" : "Choose a prediction"}
          className="mt-2 grid gap-1.5"
        >
          {choices.map((choice, index) => {
            const selected = selectedIndex === index;
            return (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                disabled={busy}
                onMouseEnter={() => {
                  if (!busy) setSelectedIndex(index);
                }}
                onClick={() => {
                  if (busy) return;
                  if (moment.status === "choosing") onAct(choice.id);
                  else onPredict(choice.id);
                }}
                className={`grid min-h-10 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-bold leading-snug transition sm:text-base ${
                  selected
                    ? "bg-[#e7edff] text-[#3659cf]"
                    : "text-[#1f2433] hover:bg-[#1f2433]/5"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span aria-hidden="true" className="text-sm font-black text-[#e36b33]">
                  {selected ? "▶" : ""}
                </span>
                <span>{choice.text}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function DialogueBox(props: DialogueBoxProps) {
  return props.mode === "talk"
    ? <TalkDialogue {...props} />
    : <MomentDialogue {...props} />;
}
