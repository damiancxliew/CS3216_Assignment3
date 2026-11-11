"use client";

import type { RoleBriefingView, StageView } from "@adventure/play-contract";
import { ArrowRight, BookOpen, Check, ChevronDown, Lock, MapPin, MessageCircle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { bigQuestion, roleWhenWhere, splitFictional } from "@/lib/play/v3/cinematic";
import type { PlayerLook } from "@/lib/play/v3/player-look";
import styles from "./brief.module.css";
import { pixelFont } from "./pixel-font";
import { PlayerPortrait } from "./player-portrait";
import { NotesGlyph, PocketLogo, PocketTag, pocketStyles } from "./pocket-ui";

/** The role card's mission line: the student's first goal, else what is at stake. */
export function roleMission(briefing: Pick<RoleBriefingView, "privateBrief" | "stakes" | "situation">): string {
  return briefing.privateBrief.goals.find((goal) => goal.trim())?.trim()
    || briefing.stakes.trim()
    || briefing.situation.trim();
}

export type StageTrackStop = { index: number; label: string; caption: string; state: "done" | "current" | "locked" };

/**
 * Past stages are done, the current one is named, later ones stay locked so nothing is spoiled.
 * Before the first stage opens only the count is known: numbered stops, the first one current.
 */
export function stageTrack(stage: Pick<StageView, "index" | "count" | "title" | "timePlace"> | { count: number }): StageTrackStop[] {
  if (!("index" in stage)) {
    return Array.from({ length: stage.count }, (_, index) => ({ index, label: `Stage ${index + 1}`, caption: index === 0 ? "Up next" : "Locked", state: index === 0 ? "current" as const : "locked" as const }));
  }
  return Array.from({ length: stage.count }, (_, index) => index < stage.index
    ? { index, label: `Stage ${index + 1}`, caption: "Done", state: "done" as const }
    : index === stage.index
      ? { index, label: stage.timePlace.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[0] ?? `Stage ${index + 1}`, caption: stage.title, state: "current" as const }
      : { index, label: `Stage ${index + 1}`, caption: "Locked", state: "locked" as const });
}

export function StageTrack({ stops, tone = "dark" }: { stops: StageTrackStop[]; tone?: "dark" | "paper" }) {
  if (stops.length < 2) return null;
  return (
    <ol aria-label="Your journey" className={styles.track} data-tone={tone} style={{ ["--stops" as string]: stops.length }}>
      {stops.map((stop) => (
        <li key={stop.index} className={styles.stop} data-state={stop.state} aria-current={stop.state === "current" ? "step" : undefined}>
          <span aria-hidden className={`${pixelFont.className} ${styles.node}`}>
            {stop.state === "locked" ? <Lock size={tone === "paper" ? 14 : 18} strokeWidth={2.5} /> : stop.state === "done" ? <Check size={tone === "paper" ? 16 : 20} strokeWidth={3} /> : stop.index + 1}
          </span>
          <span className={`${pixelFont.className} ${styles.stopLabel}`}>{stop.label}</span>
          <span className={styles.stopCaption}>{stop.caption}</span>
        </li>
      ))}
    </ol>
  );
}

/** At most three groups behind "More", the ones a player actually comes back for. */
export function roleMoreGroups(briefing: RoleBriefingView): { title: string; items: string[] }[] {
  const clean = (items: string[]) => items.map((item) => item.trim()).filter(Boolean);
  return [
    { title: "Your goals", items: clean(briefing.privateBrief.goals) },
    { title: "People you know", items: clean(briefing.relationships) },
    { title: "Remember", items: clean(briefing.privateBrief.constraints) },
  ].filter((group) => group.items.length > 0);
}

export const ROLE_ACTIONS = ["Read sources", "Talk to people", "Show your notes"] as const;

function RoleActionIcon({ action }: { action: (typeof ROLE_ACTIONS)[number] }) {
  if (action === "Read sources") return <BookOpen size={14} strokeWidth={2.5} aria-hidden />;
  if (action === "Talk to people") return <MessageCircle size={14} strokeWidth={2.5} aria-hidden />;
  return <NotesGlyph size={16} />;
}

export function RoleCard({ briefing, stage, stageCount, look, artUrl, beginLabel, onBegin, onClose, showLogo = false, busy = false }: {
  briefing: RoleBriefingView;
  stage: StageView | null;
  /** Number of stages, for the journey track before the first stage opens. */
  stageCount?: number;
  look: PlayerLook;
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
  const [artFailed, setArtFailed] = useState(false);
  const titleId = useId();
  const mission = roleMission(briefing);
  const question = bigQuestion(briefing, stage);
  const where = roleWhenWhere(briefing, stage);
  const { position, fictional } = splitFictional(briefing.position);
  const track = stage ? stageTrack(stage) : stageCount && stageCount > 1 ? stageTrack({ count: stageCount }) : [];
  const more = onClose ? roleMoreGroups(briefing) : [];

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
      aria-describedby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (onClose) onClose();
      }}
      className={`${pocketStyles.root} ${styles.dialog}`}
    >
      {artUrl && !artFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- stage art uses generated storage URLs
        <img src={artUrl} alt="" aria-hidden className={styles.art} onError={() => setArtFailed(true)} />
      ) : null}
      <div aria-hidden className={styles.shade} />
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Close role brief" className={`${pocketStyles.hud} ${styles.close}`}>
          <X size={24} aria-hidden />
        </button>
      ) : null}

      <div className={styles.wrap} data-closable={onClose ? "" : undefined}>
        {showLogo ? <PocketLogo width={150} /> : null}

        {question ? (
          <section aria-label="The big question" className={styles.question}>
            <PocketTag float className="left-1/2 -translate-x-1/2 whitespace-nowrap">The big question</PocketTag>
            <p className={`${pixelFont.className} ${styles.questionText}`}>{question}</p>
          </section>
        ) : null}

        <section className={styles.card}>
          <div className={styles.who}>
            <div className={styles.portrait}>
              <PlayerPortrait look={look} name={briefing.name} className={`${pixelFont.className} ${styles.portraitFace}`} />
            </div>
            <div className="min-w-0">
              <PocketTag>Role card</PocketTag>
              <h2 id={titleId} className={`${pixelFont.className} ${styles.name}`}>You play {briefing.name}</h2>
              {position ? (
                <p className={`${pixelFont.className} ${styles.position}`}>
                  {position}
                  {fictional ? <span className={styles.fictional}>Fictional</span> : null}
                </p>
              ) : null}
              {where ? <p className={styles.where}><MapPin size={15} aria-hidden className="shrink-0" />{where}</p> : null}
            </div>
          </div>

          {mission ? (
            <div className={styles.mission}>
              <h3 className={`${pixelFont.className} ${styles.label}`}>Your mission</h3>
              <p className={styles.missionText}>{mission}</p>
            </div>
          ) : null}

          <ul aria-label="What you can do" className={styles.chips}>
            {ROLE_ACTIONS.map((action) => (
              <li key={action} className={styles.chip}><span className={styles.chipIcon} aria-hidden><RoleActionIcon action={action} /></span>{action}</li>
            ))}
          </ul>

          <div className={styles.actions}>
            <button ref={begin} type="button" disabled={busy} onClick={onBegin} className={`${pixelFont.className} ${styles.primary}`}>
              {beginLabel} <ArrowRight size={20} aria-hidden />
            </button>
          </div>

          {more.length ? (
            <details className={styles.more}>
              <summary>More about your role <ChevronDown size={16} aria-hidden className={`${styles.moreChevron} transition-transform motion-reduce:transition-none`} /></summary>
              <div className={styles.moreGrid}>
                {more.map((group) => (
                  <section key={group.title} className={styles.moreGroup}>
                    <h3 className={`${pixelFont.className} ${styles.label}`}>{group.title}</h3>
                    <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                ))}
              </div>
            </details>
          ) : null}
        </section>

        <StageTrack stops={track} />
      </div>
    </dialog>
  );
}
