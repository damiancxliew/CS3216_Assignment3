"use client";

import type { RoleBriefingView, StageView } from "@adventure/play-contract";
import { ArrowRight, Lock, Star, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { pixelFont } from "./pixel-font";
import { PocketLogo, PocketTag, pocketStyles } from "./pocket-ui";

/** The role card's mission line: the student's first goal, else what is at stake. */
export function roleMission(briefing: Pick<RoleBriefingView, "privateBrief" | "stakes" | "situation">): string {
  return briefing.privateBrief.goals.find((goal) => goal.trim())?.trim()
    || briefing.stakes.trim()
    || briefing.situation.trim();
}

export type StageTrackStop = { index: number; label: string; caption: string; state: "done" | "current" | "locked" };

/** Past stages are done, the current one is named, later ones stay locked so nothing is spoiled. */
export function stageTrack(stage: Pick<StageView, "index" | "count" | "title" | "timePlace">): StageTrackStop[] {
  return Array.from({ length: stage.count }, (_, index) => index < stage.index
    ? { index, label: `Stage ${index + 1}`, caption: "Done", state: "done" as const }
    : index === stage.index
      ? { index, label: stage.timePlace.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[0] ?? `Stage ${index + 1}`, caption: stage.title, state: "current" as const }
      : { index, label: `Stage ${index + 1}`, caption: "Locked", state: "locked" as const });
}

function List({ title, items }: { title: string; items: string[] }) {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (!clean.length) return null;
  return (
    <section>
      <h3 className={`${pixelFont.className} text-sm font-bold uppercase tracking-[0.1em] text-[#a8442a]`}>{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px] leading-relaxed">
        {clean.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}

export function RoleCard({ briefing, stage, portraitUrl, artUrl, beginLabel, onBegin, onClose, showLogo = false, busy = false }: {
  briefing: RoleBriefingView;
  stage: StageView | null;
  portraitUrl: string | null;
  artUrl: string | null;
  beginLabel: string;
  onBegin: () => void;
  /** Omitted on the opening, where the only way forward is to begin. */
  onClose?: () => void;
  showLogo?: boolean;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const begin = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [artFailed, setArtFailed] = useState(false);
  const titleId = useId();
  const mission = roleMission(briefing);
  const track = stage ? stageTrack(stage) : [];
  const question = stage?.centralQuestion.trim();

  useEffect(() => {
    const element = dialog.current;
    if (!element || typeof element.showModal !== "function") return;
    if (!element.open) element.showModal();
    begin.current?.focus({ preventScroll: true });
    return () => { if (element.open) element.close(); };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={onClose ? "Role brief" : "Adventure opening"}
      onCancel={(event) => {
        event.preventDefault();
        if (onClose) onClose();
      }}
      className={`${pocketStyles.root} fixed inset-0 z-[60] m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-[#1b2030] p-0 text-[#1f2433] backdrop:bg-[#10141d]/70`}
    >
      {artUrl && !artFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- stage art uses generated storage URLs
        <img src={artUrl} alt="" aria-hidden className="pointer-events-none fixed inset-0 h-full w-full object-cover opacity-60 blur-[2px]" onError={() => setArtFailed(true)} />
      ) : null}
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgb(16_20_29/0.25),rgb(16_20_29/0.75))]" />

      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col items-stretch justify-center gap-6 px-3 py-6 sm:gap-8 sm:px-6 sm:py-10">
        {onClose ? (
          <div className="absolute right-3 top-3 z-10 sm:right-6 sm:top-6">
            <button type="button" onClick={onClose} aria-label="Close role brief" className={pocketStyles.hud}>
              <X size={24} aria-hidden />
            </button>
          </div>
        ) : null}
        {showLogo ? <div className="mx-auto"><PocketLogo width={260} /></div> : null}

        {question ? (
          <section aria-label="The big question" className={`${pocketStyles.panel} mx-auto w-full max-w-4xl bg-[#fff1c7] px-5 pb-4 pt-6 text-center`}>
            <PocketTag float className="left-1/2 -translate-x-1/2">The big question</PocketTag>
            <p className={`${pixelFont.className} text-xl font-bold leading-snug sm:text-3xl`}>{question}</p>
          </section>
        ) : null}

        <section className={`${pocketStyles.panel} ${pocketStyles.panelRaised} grid gap-5 p-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-8 sm:p-6`}>
          <div className="mx-auto grid aspect-square w-40 place-items-center overflow-hidden rounded-lg border-4 border-[#1f2433] bg-[repeating-linear-gradient(0deg,#4aa3b0_0_14px,#3e95a3_14px_28px)] sm:w-full">
            {portraitUrl && !portraitFailed ? (
              // eslint-disable-next-line @next/next/no-img-element -- pixel faces and generated portraits
              <img src={portraitUrl} alt="" className="h-[86%] w-[86%] object-contain [image-rendering:pixelated]" onError={() => setPortraitFailed(true)} />
            ) : (
              <span className={`${pixelFont.className} text-6xl font-bold text-[#fffaf0]`}>{briefing.name.trim()[0] ?? "?"}</span>
            )}
          </div>
          <div className="min-w-0">
            <PocketTag>Role card</PocketTag>
            <h2 id={titleId} className={`${pixelFont.className} mt-3 text-3xl font-bold leading-tight sm:text-5xl`}>You play {briefing.name}</h2>
            {briefing.position.trim() ? <p className={`${pixelFont.className} mt-2 text-lg font-bold text-[#3659cf] sm:text-2xl`}>{briefing.position}</p> : null}
            {stage?.timePlace ? <p className={`${pixelFont.className} mt-1 text-base text-[#6b5f4c] sm:text-lg`}>{stage.timePlace}</p> : null}
            {mission ? (
              <div className="mt-4 border-t-[3px] border-[#d9c7a0] pt-3">
                <h3 className={`${pixelFont.className} text-sm font-bold uppercase tracking-[0.12em] text-[#d85f35]`}>Mission</h3>
                <p className="mt-1 text-base leading-relaxed sm:text-lg">{mission}</p>
              </div>
            ) : null}
            {more ? (
              <div className="mt-4 grid gap-4 border-t-[3px] border-[#d9c7a0] pt-4">
                {briefing.situation.trim() ? <section><h3 className={`${pixelFont.className} text-sm font-bold uppercase tracking-[0.1em] text-[#a8442a]`}>The situation</h3><p className="mt-1 text-[15px] leading-relaxed">{briefing.situation}</p></section> : null}
                {briefing.stakes.trim() && briefing.stakes.trim() !== mission ? <section><h3 className={`${pixelFont.className} text-sm font-bold uppercase tracking-[0.1em] text-[#a8442a]`}>What is at stake</h3><p className="mt-1 text-[15px] leading-relaxed">{briefing.stakes}</p></section> : null}
                {briefing.reputation.trim() ? <section><h3 className={`${pixelFont.className} text-sm font-bold uppercase tracking-[0.1em] text-[#a8442a]`}>Your reputation</h3><p className="mt-1 text-[15px] leading-relaxed">{briefing.reputation}</p></section> : null}
                <List title="Your goals" items={briefing.privateBrief.goals} />
                <List title="Your fears" items={briefing.privateBrief.fears} />
                <List title="What you already know" items={briefing.privateBrief.knows} />
                <List title="What you cannot do" items={briefing.privateBrief.constraints} />
                <List title="People you know" items={briefing.relationships} />
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                ref={begin}
                type="button"
                disabled={busy}
                onClick={onBegin}
                className={`${pixelFont.className} inline-flex min-h-12 items-center gap-2 rounded-lg border-[3px] border-[#1f2433] bg-[#d85f35] px-5 text-lg font-bold text-white shadow-[0_4px_0_#1f2433] hover:bg-[#c04f28] active:translate-y-[2px] active:shadow-none disabled:opacity-60`}
              >
                {beginLabel} <ArrowRight size={20} aria-hidden />
              </button>
              <button type="button" aria-expanded={more} onClick={() => setMore((open) => !open)} className={`${pixelFont.className} min-h-12 rounded-lg border-[3px] border-[#1f2433] bg-[#fffaf0] px-4 text-base font-bold shadow-[0_3px_0_#1f2433] hover:bg-white`}>
                {more ? "Less about your role" : "More about your role"}
              </button>
            </div>
          </div>
        </section>

        {track.length > 1 ? (
          <ol aria-label="Your journey" className="relative mx-auto grid w-full max-w-4xl gap-4" style={{ gridTemplateColumns: `repeat(${track.length}, minmax(0, 1fr))` }}>
            <span aria-hidden className="absolute left-[12%] right-[12%] top-[calc(100%-2.6rem)] border-t-4 border-dashed border-[#fffaf0]/90" />
            {track.map((stop) => (
              <li key={stop.index} aria-current={stop.state === "current" ? "step" : undefined} className="relative flex flex-col items-center gap-3 text-center">
                <span className={`${pocketStyles.panel} w-full px-2 py-2 ${stop.state === "locked" ? "opacity-80" : ""}`}>
                  <span className={`${pixelFont.className} block text-base font-bold sm:text-xl`}>{stop.label}</span>
                  <span className={`${pixelFont.className} block truncate text-sm text-[#6b5f4c] sm:text-base`}>{stop.caption}</span>
                </span>
                <span aria-hidden className={`grid h-16 w-16 place-items-center rounded-full border-4 ${stop.state === "current" ? "border-[#ffe66d] bg-[#ffd75a] shadow-[0_0_0_6px_rgb(255_230_109/0.45)]" : stop.state === "done" ? "border-[#1f2433] bg-[#d7f0e2]" : "border-[#1f2433] bg-[#8d8a84]"}`}>
                  {stop.state === "locked" ? <Lock size={26} className="text-[#2a2f3d]" /> : <Star size={28} className={stop.state === "current" ? "fill-[#d85f35] text-[#a8442a]" : "fill-[#258663] text-[#165a41]"} />}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </dialog>
  );
}
