"use client";

import { boxClass, ContinueIndicator, NameTag, pixelFont } from "@/components/play/v3/dialogue-box";

/** The bottom dialogue box for one speaker's line, in the style of the talk and defining-moment box. */
export function SpeakerBox({
  speaker,
  tag,
  note,
  text,
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
  done: boolean;
  busy?: boolean;
  /** Shown with ▼ once the line has finished; omit when the next step is a choice panel. */
  continueLabel?: string;
  onAdvance: () => void;
}) {
  const initials = speaker.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return (
    <section
      aria-label={`${speaker} says`}
      onClick={onAdvance}
      className={`${boxClass} cursor-pointer flex-row items-stretch gap-2 px-2 py-2 sm:gap-3 sm:px-3 sm:py-3`}
    >
      <div className="flex shrink-0 items-center">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border-4 border-[#1f2433] bg-[#2a2f3d] min-[480px]:h-24 min-[480px]:w-24 sm:h-28 sm:w-28">
          <span className={`${pixelFont.className} text-2xl font-bold text-[#fffaf0] sm:text-4xl`}>{initials || "?"}</span>
        </div>
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2 pr-2 pt-1">
          <NameTag>{speaker}</NameTag>
          {tag ? (
            <span className="inline-block rounded-md border-2 border-[#1f2433] bg-[#ffd65a] px-2 py-0.5 text-xs font-black uppercase tracking-wide">
              {tag}
            </span>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-7 pr-2">
          {note ? <p className="text-xs font-bold uppercase tracking-wide text-[#5c6472]">{note}</p> : null}
          <p aria-live="polite" className={`${pixelFont.className} mt-1 whitespace-pre-line text-base leading-relaxed sm:text-lg`}>
            {text}
          </p>
        </div>
        {done && continueLabel ? (
          <button
            type="button"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              onAdvance();
            }}
            className="absolute bottom-0 right-6 min-h-8 px-2 text-sm font-black text-[#e36b33] disabled:opacity-50"
          >
            {continueLabel}
          </button>
        ) : null}
        {done && continueLabel ? <ContinueIndicator /> : null}
      </div>
    </section>
  );
}
