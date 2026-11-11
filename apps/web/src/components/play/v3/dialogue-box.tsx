"use client";
import type { PortraitBase } from "@/lib/play/v3/portraits";

import type { CharacterView, DefiningMomentView, MessageView } from "@adventure/play-contract";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";

import { StanceTag, type StanceShift } from "@/components/play/v3/story-lines";
import { MediaCredit } from "./media-credit";
import { portraitUrl, portraitMetadata } from "@/lib/play/v3/portraits";
import { nameInitials } from "@/lib/play/v3/initials";
import { pixelFont } from "./pixel-font";
import { ChoiceButton, choiceKeyIndex, PocketRibbon } from "./pocket-ui";

export { pixelFont };

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
  stanceShift?: StanceShift | null;
  /** `onSettled(false)` hands the line back to the input, so a failed send never loses what the student wrote. */
  onSend: (text: string, onSettled: (succeeded: boolean) => void) => void;
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

const boxFrameClass =
  "absolute left-1/2 z-20 flex max-h-[58%] w-[calc(100%-1rem)] max-w-[76rem] -translate-x-1/2 overflow-hidden rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] font-sans text-[#1f2433] shadow-[0_6px_0_rgb(31_36_51/0.55),0_18px_40px_rgb(0_0_0/0.25)] sm:w-[calc(100%-3rem)]";

export const boxClass = `${boxFrameClass} bottom-2 sm:bottom-4`;

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

/** Moves the cursor in `delta`'s direction to the next choice that can be picked, wrapping around. */
export function nextAvailableIndex(index: number, delta: number, available: readonly boolean[]): number {
  for (let step = 1; step <= available.length; step += 1) {
    const candidate = nextChoiceIndex(index, delta * step, available.length);
    if (available[candidate]) return candidate;
  }
  return index;
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
  const initials = nameInitials(character.name);

  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [url]);

  // A server-rendered <img> can fail before hydration attaches onError; catch that case on mount.
  useEffect(() => {
    const element = image.current;
    if (src && element?.complete && element.naturalWidth === 0) setFailedUrl(src);
  }, [src]);

  return (
    <div className="w-14 shrink-0 min-[480px]:w-20 sm:w-28 lg:w-36"><div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden border-4 border-[#1f2433] bg-[#2a2f3d] [image-rendering:pixelated] min-[480px]:h-20 min-[480px]:w-20 sm:h-28 sm:w-28 lg:h-36 lg:w-36">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- portraits use generated storage URLs
        <img ref={image} src={src} alt={portraitMetadata(character.portraitKey, portraitBase)?.alt ?? ""} className="h-full w-full object-cover" onError={() => setFailedUrl(src)} />
      ) : (
        <span className={`${pixelFont.className} text-2xl font-bold text-[#fffaf0] sm:text-4xl`}>
          {initials || "?"}
        </span>
      )}
    </div><MediaCredit media={portraitMetadata(character.portraitKey, portraitBase)} /></div>
  );
}

export function NameTag({ children }: { children: string }) {
  return (
    <span className={`${pixelFont.className} inline-block max-w-full whitespace-normal break-words bg-[#1f2433] px-3 py-1 text-sm font-bold text-[#fffaf0] sm:px-4 sm:text-lg`}>
      {children}
    </span>
  );
}

export function ContinueIndicator() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-1 right-2 select-none text-2xl leading-none text-[#d85f35] motion-reduce:animate-none animate-bounce"
    >
      ▼
    </span>
  );
}

/** Neutral, period-agnostic openers so the NPC speaks first; chosen by character id, shown client-side only. */
export function openingLine(character: Pick<CharacterView, "id" | "name" | "title">): string {
  const first = character.name.split(/\s+/)[0] ?? character.name;
  const variants = [
    `${first} looks up. \u201CYes? What do you need?\u201D`,
    `${first} turns to you. \u201CYou wanted a word? Go on.\u201D`,
    `${first} sets the work aside. \u201CI can spare a moment. What is it?\u201D`,
    `${first} meets your eye. \u201CSpeak plainly. What would you like to know?\u201D`,
  ];
  const hash = [...character.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return variants[hash % variants.length]!;
}

function purposeLine(character: CharacterView): string {
  const first = character.name.split(/\s+/)[0] ?? character.name;
  // The preparation hint is a to-do for elsewhere on the map (the quest card shows it), not this talk's purpose.
  const hint: string | undefined = undefined;
  if (hint) return hint;
  return `Find out what ${first} knows. Ask a question, or show a note to challenge them.`;
}

function TalkDialogue({ character, portraitBase, messages, busy, stanceShift = null, onSend, onOpenNotes, onClose }: TalkProps) {
  const [text, setText] = useState("");
  const [sendFailed, setSendFailed] = useState(false);
  const [sentTexts, setSentTexts] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const hasCharacterLine = messages.some((message) => message.kind === "character" && message.characterId === character.id);
  const opening = hasCharacterLine ? null : openingLine(character);
  const starters = (character.starters ?? []).filter((starter) => !sentTexts.includes(starter));
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
  // The newest line from anyone but the student reads large, like an RPG text box; older lines step back.
  const latestLineId = [...messages].reverse().find((message) => message.kind !== "player")?.id ?? null;

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
    setSendFailed(false);
    setSentTexts((current) => [...current, message]);
    onSend(message, (succeeded) => {
      if (succeeded) return;
      setSendFailed(true);
      setSentTexts((current) => current.filter((sent) => sent !== message));
      setText((current) => current.trim() ? current : message);
      input.current?.focus();
    });
    setText("");
  }

  return (
    <section
      aria-label={`Conversation with ${character.name}`}
      className={`${boxClass} h-[min(22rem,55%)] flex-row items-stretch gap-2 px-2 py-2 sm:h-[min(24rem,55%)] sm:gap-5 sm:px-5 sm:py-4`}
    >
      <div className="flex shrink-0 items-start pt-1">
        <DialoguePortrait character={character} portraitBase={portraitBase} />
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-start pr-9 pb-2 pt-1">
          <h2 className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
            <NameTag>{character.name}</NameTag>
            {character.stance ? <StanceTag label={character.stance.label} level={character.stance.level} shift={stanceShift} /> : null}
            {character.title && character.title !== character.name ? <span className="hidden text-xs text-[#6b5f4c] sm:inline">{character.title}</span> : null}
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
          {opening ? (
            <article className={`max-w-[95%] break-words ${latestLineId === null ? "" : "opacity-75"}`}>
              <p className={`whitespace-pre-wrap ${latestLineId === null ? "text-[17px] font-medium leading-relaxed sm:text-[20px]" : "text-[15px] leading-relaxed sm:text-[17px]"}`}>{opening}</p>
            </article>
          ) : null}
          {messages.map((message) => {
            const fromPlayer = message.kind === "player";
            const latest = message.id === latestLineId;
            const speaker = fromPlayer
              ? null
              : message.speaker ?? (message.characterId === character.id ? character.name : null);
            return (
            <article
              key={message.id}
              className={fromPlayer
                ? "ml-auto w-fit max-w-[85%] break-words rounded-lg rounded-br-none border-2 border-[#3659cf]/30 bg-[#e7edff] px-3 py-1.5"
                : `max-w-[95%] break-words ${latest ? "" : "opacity-75"}`}
            >
              {fromPlayer ? <p className="sr-only">You</p> : null}
              {speaker && !(latest && message.kind === "character") ? (
                <p className="mb-0.5 text-xs font-bold uppercase tracking-wide text-[#5c6472]">{speaker}</p>
              ) : null}
              {message.text ? (
                <p className={`whitespace-pre-wrap ${latest && !fromPlayer ? "text-[17px] font-medium leading-relaxed sm:text-[20px]" : "text-[15px] leading-relaxed sm:text-[17px]"} ${message.kind === "narration" || message.kind === "thought" ? "italic text-[#3b4252]" : message.kind === "notice" ? "font-semibold italic text-[#8a5a1c]" : ""}`}>
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
          })}
          {sendFailed && !busy ? (
            <p role="alert" className="text-sm font-bold text-[#a3341f]">
              That didn&apos;t reach {character.name}. Your question is back in the box. Try sending it again.
            </p>
          ) : null}
          {busy && lastMessage?.kind === "player" ? (
            <p role="status" className="text-sm font-bold text-[#5c6472]">
              {character.name} is thinking<span aria-hidden="true" className="motion-safe:animate-pulse">…</span>
            </p>
          ) : null}
        </div>

        <p className="mt-1 shrink-0 truncate text-xs leading-snug text-[#5c6472] sm:whitespace-normal sm:text-sm" title={purposeLine(character)}>{purposeLine(character)}</p>
        {starters.length > 0 && !busy ? (
          <ul aria-label="Question ideas" className="mt-1.5 flex shrink-0 gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible">
            {starters.map((starter) => (
              <li key={starter} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setText(starter);
                    input.current?.focus();
                  }}
                  className="min-h-9 whitespace-nowrap rounded-lg border-2 sm:whitespace-normal border-[#1f2433]/60 bg-[#fffaf0] px-2.5 py-1 text-left text-xs font-semibold text-[#1f2433] hover:bg-[#ffe58a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3659cf] sm:text-sm"
                >
                  {starter}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={submit} className="mt-2 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t-2 border-[#1f2433]/20 pt-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label htmlFor="v3-message" className="sr-only">Ask {character.name} a question</label>
          <input
            ref={input}
            id="v3-message"
            autoComplete="off"
            value={text}
            maxLength={1000}
            aria-busy={busy}
            onChange={(event) => setText(event.target.value)}
            placeholder={`Ask ${character.name} a question`}
            className="min-h-11 min-w-0 rounded-lg border-[3px] border-[#1f2433] bg-white px-2.5 text-[15px] text-[#1f2433] placeholder:text-[#6b6f7a] sm:px-3"
          />
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className={`${pixelFont.className} min-h-11 rounded-lg border-[3px] border-[#1f2433] bg-[#d85f35] px-3 text-base font-bold text-white shadow-[0_3px_0_#1f2433] hover:bg-[#c04f28] active:translate-y-[2px] active:shadow-none disabled:opacity-50 sm:px-5`}
          >
            {busy ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            onClick={onOpenNotes}
            title="Show a note to back up what you say. People react to evidence."
            className={`${pixelFont.className} col-span-2 min-h-11 rounded-lg border-[3px] border-[#1f2433] bg-[#fff3cf] px-3 text-base font-bold shadow-[0_3px_0_#1f2433] hover:bg-[#ffe58a] active:translate-y-[2px] active:shadow-none sm:col-span-1`}
          >
          Show a note
          </button>
        </form>
      </div>
    </section>
  );
}

function MomentDialogue({ moment, decider, portraitBase, busy, onAct, onPredict }: MomentProps) {
  const section = useRef<HTMLElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { shown: reactionShown, done: reactionDone, skip: skipReaction } = useTypewriter(
    moment.reaction ?? "",
    moment.status === "predicting" && Boolean(moment.reaction),
  );
  const choices = moment.status === "choosing"
    ? moment.acts.map((act) => ({ id: act.id, text: act.text, available: act.available !== false }))
    : moment.predictionOptions.map((option) => ({ id: option.outcomeId, text: option.text, available: true }));
  const firstAvailable = Math.max(0, choices.findIndex((choice) => choice.available));
  const chosenAct = moment.chosenActId ? moment.acts.find((act) => act.id === moment.chosenActId) ?? null : null;

  useEffect(() => {
    setSelectedIndex(firstAvailable);
  }, [moment.status, firstAvailable]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector("dialog[open]") || isTextEntryTarget(event.target)) return;
      // Global decision shortcuts must not activate while using another control, such as the Journal.
      if (event.target instanceof HTMLElement && event.target.closest("button, a, [role='tab']") && !section.current?.contains(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const delta = key === "ArrowUp" || key === "w" ? -1 : key === "ArrowDown" || key === "s" ? 1 : 0;
      const select = key === "Enter" || event.key === " " || event.code === "Space";
      const skip = !reactionDone && isSkipKey(event);
      // A/B/C move the cursor to that choice; Enter still confirms, so one stray key can't decide the stage.
      const lettered = event.altKey || event.ctrlKey || event.metaKey ? -1 : choiceKeyIndex(event.key, choices.length);
      if (delta === 0 && !select && !skip && lettered < 0) return;

      event.preventDefault();
      if (busy) return;
      if (skip) {
        skipReaction();
        return;
      }
      if (lettered >= 0) {
        if (choices[lettered]?.available) setSelectedIndex(lettered);
        return;
      }
      if (delta !== 0) {
        setSelectedIndex((current) => nextAvailableIndex(current, delta, choices.map((item) => item.available)));
        return;
      }
      const choice = choices[selectedIndex];
      if (!choice?.available) return;
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

  const predicting = moment.status === "predicting";
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-20 sm:top-6">
        <PocketRibbon>{predicting ? "Predict" : "Decision"}</PocketRibbon>
      </div>
      <section
        ref={section}
        aria-label="A defining moment"
        className={`${boxClass} flex-row items-stretch gap-2 px-2 py-2 sm:gap-5 sm:px-5 sm:py-4`}
      >
        {decider ? (
          <div className="flex shrink-0 items-start pt-1">
            <DialoguePortrait character={decider} portraitBase={portraitBase} />
          </div>
        ) : null}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2 pr-2 pt-1 sm:gap-3">
            <NameTag>{decider?.name ?? moment.deciderName ?? "A defining moment"}</NameTag>
            {decider?.stance ? <StanceTag label={decider.stance.label} level={decider.stance.level} /> : null}
            <span className={`${pixelFont.className} text-xs font-bold uppercase tracking-[0.1em] text-[#a8442a]`}>A defining moment</span>
          </div>
          <div
            onClickCapture={handleBodyClickCapture}
            className="relative min-h-0 flex-1 overflow-y-auto pb-2 pr-2"
          >
            <h2 className="text-[17px] font-semibold leading-snug sm:text-[20px]">{moment.scene}</h2>
            {moment.nudge ? <p className="mt-1 text-sm leading-relaxed text-[#6b5f4c]">{moment.nudge}</p> : null}

            {predicting ? (
              <>
                {chosenAct ? (
                  <p className="ml-auto mt-2 w-fit max-w-[85%] break-words rounded-lg rounded-br-none border-2 border-[#3659cf]/30 bg-[#e7edff] px-3 py-1.5 text-[15px] leading-relaxed sm:text-[17px]">
                    <span className="sr-only">You chose: </span>
                    {chosenAct.text}
                  </p>
                ) : null}
                {moment.reaction ? (
                  <p aria-live="polite" className="mt-2 whitespace-pre-wrap text-[15px] italic leading-relaxed text-[#3b4252] sm:text-[17px]">
                    <span className="sr-only">{moment.reaction}</span>
                    <span aria-hidden="true">{reactionShown}</span>
                  </p>
                ) : null}
                <h3 className={`${pixelFont.className} mt-3 text-base font-bold sm:text-lg`}>
                  Predict: what will {moment.deciderName || "they"} decide?
                </h3>
                <p className="text-xs text-[#6b5f4c] sm:text-sm">Your guess won&apos;t change what happens.</p>
              </>
            ) : null}

            <div
              role="listbox"
              aria-label={predicting ? "Choose a prediction" : "Choose an action"}
              className="mt-3 grid gap-2.5"
            >
              {choices.map((choice, index) => (
                <ChoiceButton
                  key={choice.id}
                  index={index}
                  text={choice.text}
                  selected={selectedIndex === index}
                  closed={!choice.available}
                  disabled={busy}
                  onHover={() => {
                    if (!busy && choice.available) setSelectedIndex(index);
                  }}
                  onSelect={() => {
                    if (busy || !choice.available) return;
                    if (predicting) onPredict(choice.id);
                    else onAct(choice.id);
                  }}
                />
              ))}
            </div>
            <p className="mt-2 hidden text-xs text-[#6b5f4c] sm:block">
              Press A–{"ABCDEF"[Math.max(0, Math.min(choices.length, 6) - 1)]} or the arrow keys to choose, then Enter.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

export function DialogueBox(props: DialogueBoxProps) {
  return props.mode === "talk"
    ? <TalkDialogue {...props} />
    : <MomentDialogue {...props} />;
}
