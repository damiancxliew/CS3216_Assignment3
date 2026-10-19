"use client";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import type { CharacterView, DefiningMomentView, MessageView } from "@adventure/play-contract";
import { Pixelify_Sans } from "next/font/google";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

import { portraitUrl } from "@/lib/play/v3/portraits";

export const pixelFont = Pixelify_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

type DialogueMessage = MessageView & {
  speaker?: string;
  insertedNoteText?: string | null;
};

type TalkProps = {
  mode: "talk";
  character: CharacterView;
  portraitBase: PortraitBase;
  messages: DialogueMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onOpenNotes: () => void;
  onClose: () => void;
};

type MomentProps = {
  mode: "moment";
  moment: DefiningMomentView;
  decider?: CharacterView;
  portraitBase: PortraitBase;
  busy: boolean;
  onAct: (actId: string) => void;
  onPredict: (outcomeId: string) => void;
};

export type DialogueBoxProps = TalkProps | MomentProps;

export const boxClass =
  "absolute bottom-2 left-1/2 z-20 flex max-h-[55%] w-[calc(100%-1rem)] max-w-[56rem] -translate-x-1/2 overflow-hidden rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] font-sans text-[#1f2433] shadow-[4px_4px_0_#1f2433] sm:bottom-4 sm:w-[calc(100%-2rem)]";

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

function DialoguePortrait({ character, portraitBase }: { character: CharacterView; portraitBase: PortraitBase }) {
  const url = portraitUrl(character.portraitKey, portraitBase);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const src = url !== failedUrl ? url : null;
  const initials = character.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  useEffect(() => {
    setFailedUrl(null);
  }, [url]);

  return (
    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border-4 border-[#1f2433] bg-[#2a2f3d] min-[480px]:h-24 min-[480px]:w-24 sm:h-28 sm:w-28">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- portraits use generated storage URLs
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailedUrl(src)} />
      ) : (
        <span className={`${pixelFont.className} text-2xl font-bold text-[#fffaf0] sm:text-4xl`}>
          {initials || "?"}
        </span>
      )}
    </div>
  );
}

export function NameTag({ children }: { children: string }) {
  return (
    <span className={`${pixelFont.className} inline-block max-w-full whitespace-normal break-words bg-[#1f2433] px-3 py-1 text-sm font-bold text-[#fffaf0] sm:text-base`}>
      {children}
    </span>
  );
}

export function ContinueIndicator() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-1 right-2 select-none text-xl leading-none text-[#e36b33] motion-reduce:animate-none animate-bounce"
    >
      ▼
    </span>
  );
}

function TalkDialogue({ character, portraitBase, messages, busy, onSend, onOpenNotes, onClose }: TalkProps) {
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

  const pinnedToLatest = useRef(true);
  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.kind === "player" && !seenAtOpen.current.has(lastMessage.id)) {
    pinnedToLatest.current = true;
  }

  useEffect(() => {
    const element = body.current;
    if (element && pinnedToLatest.current) element.scrollTop = element.scrollHeight;
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

  return (
    <section
      aria-label={`Conversation with ${character.name}`}
      className={`${boxClass} h-[min(22rem,55%)] flex-row items-stretch gap-2 px-2 py-2 sm:h-[min(23rem,55%)] sm:gap-3 sm:px-3 sm:py-3`}
    >
      <div className="flex shrink-0 items-center">
        <DialoguePortrait character={character} portraitBase={portraitBase} />
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start pr-9 pb-2 pt-1">
          <h2 className="min-w-0 flex-1">
            <NameTag>{character.name}</NameTag>
          </h2>
        </header>
        <button
          type="button"
          aria-label="Close conversation (Esc)"
          onClick={onClose}
          className="absolute right-0 top-0 z-10 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-2xl font-bold leading-none hover:bg-[#1f2433]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf]"
        >
          ×
        </button>
        <div
          ref={body}
          aria-live="polite"
          onScroll={(event) => {
            const element = event.currentTarget;
            pinnedToLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
          onClickCapture={(event) => {
            if (typingDone) return;
            event.preventDefault();
            event.stopPropagation();
            skipTyping();
          }}
          className="relative min-h-[3.5rem] min-w-0 flex-1 space-y-3 overflow-y-auto pb-7 pr-2 text-sm leading-relaxed sm:text-base"
        >
          {messages.length ? messages.map((message) => {
            const fromPlayer = message.kind === "player";
            const speaker = fromPlayer
              ? null
              : message.speaker ?? (message.characterId === character.id ? character.name : null);
            return (
            <article
              key={message.id}
              className={fromPlayer
                ? "ml-auto w-fit max-w-[85%] break-words rounded-lg rounded-br-none bg-[#e7edff] px-3 py-1.5"
                : "max-w-[95%] break-words"}
            >
              {fromPlayer ? <p className="sr-only">You</p> : null}
              {speaker ? (
                <p className="mb-0.5 text-xs font-bold uppercase tracking-wide text-[#5c6472]">{speaker}</p>
              ) : null}
              {message.text ? (
                <p className={`whitespace-pre-wrap text-[15px] leading-relaxed sm:text-[17px] ${message.kind === "narration" || message.kind === "thought" ? "italic text-[#3b4252]" : ""}`}>
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
            );
          }) : (
            <p className={`${pixelFont.className} py-2 text-base leading-relaxed text-[#1f2433] sm:text-lg`}>
              Say hello, or ask {character.name} a question.
            </p>
          )}
          {busy && lastMessage?.kind === "player" ? (
            <p role="status" className="text-sm font-bold text-[#5c6472]">
              {character.name} is thinking<span aria-hidden="true" className="motion-safe:animate-pulse">…</span>
            </p>
          ) : null}
        </div>

        <form onSubmit={submit} className="mt-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t-2 border-[#1f2433]/20 pt-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
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
      </div>
    </section>
  );
}

function MomentDialogue({ moment, decider, portraitBase, busy, onAct, onPredict }: MomentProps) {
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
    <section
      aria-label="A defining moment"
      className={`${boxClass} flex-row items-stretch gap-2 px-2 py-2 sm:gap-3 sm:px-3 sm:py-3`}
    >
      {decider ? (
        <div className="flex shrink-0 items-center">
          <DialoguePortrait character={decider} portraitBase={portraitBase} />
        </div>
      ) : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 pb-2 pr-2 pt-1">
          <NameTag>A defining moment</NameTag>
        </div>
        <div
          onClickCapture={handleBodyClickCapture}
          className="relative min-h-0 flex-1 overflow-y-auto pb-7 pr-2"
        >
          <h2 className={`${pixelFont.className} text-base font-bold leading-snug sm:text-lg`}>{moment.scene}</h2>
          {moment.nudge ? <p className="mt-1 text-xs leading-relaxed text-[#5c6472] sm:text-sm">{moment.nudge}</p> : null}

          {moment.status === "predicting" ? (
            <>
              {moment.reaction ? (
                <p aria-live="polite" className={`${pixelFont.className} mt-2 whitespace-pre-wrap text-base leading-relaxed sm:text-lg`}>
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
                  className={`grid min-h-10 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-2 py-1.5 text-left leading-snug transition ${
                    selected
                      ? "bg-[#e7edff] text-[#3659cf]"
                      : "text-[#1f2433] hover:bg-[#1f2433]/5"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <span aria-hidden="true" className="text-sm font-black text-[#e36b33]">
                    {selected ? "▶" : ""}
                  </span>
                  <span className={`${pixelFont.className} text-sm font-semibold sm:text-base`}>{choice.text}</span>
                </button>
              );
            })}
          </div>
        </div>
        {moment.status === "choosing" || reactionDone ? <ContinueIndicator /> : null}
      </div>
    </section>
  );
}

export function DialogueBox(props: DialogueBoxProps) {
  return props.mode === "talk"
    ? <TalkDialogue {...props} />
    : <MomentDialogue {...props} />;
}
