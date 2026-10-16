"use client";

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
      className="absolute inset-x-2 bottom-2 z-20 cursor-pointer font-sans text-[#1f2433] sm:inset-x-4 sm:bottom-4"
    >
      {tag ? (
        <span className="mb-2 ml-2 inline-flex max-w-full rounded-md border-2 border-[#1f2433] bg-[#ffd65a] px-3 py-1 text-xs font-black uppercase tracking-wide shadow-[2px_2px_0_#1f2433] sm:ml-28">
          <span className="truncate">{tag}</span>
        </span>
      ) : null}
      <div className="flex max-h-[45dvh] min-h-[8.5rem] overflow-hidden rounded-xl border-4 border-[#1f2433] bg-[#fffaf0] shadow-[4px_4px_0_#1f2433]">
        <div className="hidden w-24 shrink-0 place-items-center border-r-4 border-[#1f2433] bg-[#e9dcc0] text-3xl font-black sm:grid">
          {initials || "?"}
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <span className="self-start rounded-br-lg bg-[#1f2433] px-4 py-1.5 text-sm font-black text-[#fffaf0]">{speaker}</span>
          {note ? <p className="px-5 pt-2 text-xs font-bold uppercase tracking-wide text-[#1f2433]/60">{note}</p> : null}
          <p aria-live="polite" className="min-h-0 flex-1 overflow-y-auto whitespace-pre-line px-5 pt-3 pb-8 text-base font-medium leading-7 sm:text-lg">
            {text}
          </p>
          {done && continueLabel ? (
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onAdvance();
              }}
              className="absolute right-3 bottom-2 flex min-h-9 items-center gap-1 rounded-md px-2 text-sm font-black disabled:opacity-50"
            >
              {continueLabel} <span aria-hidden className="animate-bounce">▼</span>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
