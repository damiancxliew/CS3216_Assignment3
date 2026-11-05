"use client";

import { boxClass, ContinueIndicator, NameTag, pixelFont } from "@/components/play/v3/dialogue-box";
import { nameInitials } from "@/lib/play/v3/initials";

function PlayerLine({ text }: { text: string }) {
  return (
    <p className="my-2 ml-auto w-fit max-w-[85%] whitespace-pre-line break-words rounded-lg rounded-br-none bg-[#e7edff] px-3 py-1.5 text-[15px] leading-relaxed sm:text-[17px]">
      <span className="sr-only">You: </span>
      {text}
    </p>
  );
}

/** The bottom dialogue box for one speaker's line, in the style of the talk and defining-moment box. */
export function SpeakerBox({
  speaker,
  tag,
  note,
  text,
  before = null,
  after = null,
  done,
  busy = false,
  continueLabel,
  onAdvance,
}: {
  speaker: string;
  tag?: string | null;
  /** A small line above the text, such as the epilogue's "not the record" label. */
  note?: string | null;
  text: string;
  /** The student's own earlier line, shown above this one (the answer a push-back replies to). */
  before?: string | null;
  /** The student's line that is on its way, shown below with a thinking mark. */
  after?: string | null;
  done: boolean;
  busy?: boolean;
  /** Shown with ▼ once the line has finished; omit when the next step is a choice panel. */
  continueLabel?: string;
  onAdvance: () => void;
}) {
  const initials = nameInitials(speaker);
  return (
    <section
      aria-label={`${speaker} says`}
      onClick={onAdvance}
      className={`${boxClass} cursor-pointer flex-row items-stretch gap-2 px-2 py-2 sm:gap-5 sm:px-5 sm:py-4`}
    >
      <div className="flex shrink-0 items-center">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border-4 border-[#1f2433] bg-[#2a2f3d] min-[480px]:h-24 min-[480px]:w-24 sm:h-28 sm:w-28 lg:h-36 lg:w-36">
          <span className={`${pixelFont.className} text-2xl font-bold text-[#fffaf0] sm:text-4xl`}>{initials || "?"}</span>
        </div>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2 pr-2 pt-1">
          <NameTag>{speaker}</NameTag>
          {tag ? (
            <span className={`${pixelFont.className} inline-block rounded-full border-2 border-[#9a6a0d] bg-[#f2b33d] px-3 py-0.5 text-xs font-bold uppercase tracking-[0.06em] text-[#2b1d05]`}>
              {tag}
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-7 pr-2">
          {note ? <p className="text-xs font-bold uppercase tracking-wide text-[#5c6472]">{note}</p> : null}
          {before ? <PlayerLine text={before} /> : null}
          <p aria-live="polite" className={`${pixelFont.className} mt-1 whitespace-pre-line text-lg leading-snug sm:text-2xl`}>
            {text}
          </p>
          {after ? (
            <>
              <PlayerLine text={after} />
              <p role="status" className="mt-2 text-sm font-bold text-[#5c6472]">
                {speaker} is thinking<span aria-hidden="true" className="motion-safe:animate-pulse">…</span>
              </p>
            </>
          ) : null}
        </div>
        {done && continueLabel ? (
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onAdvance();
            }}
            className={`${pixelFont.className} absolute bottom-0 right-7 min-h-8 px-2 text-base font-bold text-[#d85f35] disabled:opacity-50 sm:text-lg`}
          >
            {continueLabel}
          </button>
        ) : null}
        {done && continueLabel ? <ContinueIndicator /> : null}
      </div>
    </section>
  );
}
