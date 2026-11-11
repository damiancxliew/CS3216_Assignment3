"use client";

import { BookOpen, Check, Lock, MapPin, MessageCircle, Star, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { pixelFont } from "./pixel-font";
import { useTopLayer } from "./pocket-ui";
import type { QuestStep } from "./quest-steps";
import styles from "./quest-ui.module.css";

function stepState(step: QuestStep, next: QuestStep | null) {
  if (step.done) return "done";
  if (next && step.id === next.id) return "next";
  if (step.locked) return "locked";
  return "todo";
}

function StepIcon({ step, state }: { step: QuestStep; state: string }) {
  if (state === "done") return <Check size={16} strokeWidth={3} aria-hidden />;
  if (state === "locked") return <Lock size={13} strokeWidth={2.5} aria-hidden />;
  if (step.kind === "talk") return <MessageCircle size={state === "next" ? 16 : 14} strokeWidth={2.5} aria-hidden />;
  if (step.kind === "decide") return <Star size={state === "next" ? 16 : 14} strokeWidth={2.5} fill="currentColor" aria-hidden />;
  return <BookOpen size={state === "next" ? 16 : 14} strokeWidth={2.5} aria-hidden />;
}

const STATE_LABEL: Record<string, string> = { done: "done", next: "next step", locked: "locked", todo: "to do" };

/** The quest checklist. Only the next step is a button: it walks, opens, or starts the decision. */
export function QuestSteps({ steps, next, canActivate, onActivate, disabled = false }: {
  steps: QuestStep[];
  next: QuestStep | null;
  canActivate: (step: QuestStep) => boolean;
  onActivate: (step: QuestStep) => void;
  disabled?: boolean;
}) {
  return (
    <ol aria-label="Quest steps" className={styles.steps}>
      {steps.map((step) => {
        const state = stepState(step, next);
        const sub = step.lockReason ?? step.where;
        const actionable = state === "next" && canActivate(step);
        const content = <>
          <span className={styles.icon} aria-hidden><StepIcon step={step} state={state} /></span>
          <span className={styles.body}>
            {state === "next" ? <span className={`${pixelFont.className} ${styles.nextTag}`} aria-hidden>Next</span> : null}
            <span className={styles.text}>{step.text}</span>
            {/* Only the next step keeps its "where" line visible; the rest stay one line so the card stays small. */}
            {sub && state !== "done" && state !== "next" ? <span className="sr-only">: {sub}</span> : null}
            {sub && state === "next" ? <span className={styles.sub}>{step.lockReason ? null : step.where?.startsWith("In ") || step.where?.startsWith("Here") ? <MapPin size={11} aria-hidden /> : null}{sub}</span> : null}
          </span>
          <span className="sr-only">: {STATE_LABEL[state]}</span>
          {actionable ? <span className={`${pixelFont.className} ${styles.go}`} aria-hidden>▶</span> : null}
        </>;
        return (
          <li key={step.id}>
            {actionable
              ? <button type="button" disabled={disabled} className={styles.step} data-state={state} data-kind={step.kind} onClick={() => onActivate(step)}>{content}</button>
              : <div className={styles.step} data-state={state} data-kind={step.kind}>{content}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/** Collapsed card: just the next step. */
export function QuestPeek({ next, onActivate, canActivate, disabled = false }: {
  next: QuestStep | null;
  canActivate: (step: QuestStep) => boolean;
  onActivate: (step: QuestStep) => void;
  disabled?: boolean;
}) {
  if (!next) return null;
  const content = <>
    <span className={styles.icon} aria-hidden><StepIcon step={next} state="next" /></span>
    <span className="min-w-0 flex-1 truncate text-[14px] font-bold leading-snug sm:line-clamp-2 sm:whitespace-normal">
      <span className={`${pixelFont.className} mr-1.5 text-[13px] font-bold uppercase tracking-wide text-[#a8442a]`}>Next:</span>
      {next.text}
    </span>
  </>;
  return canActivate(next)
    ? <button type="button" disabled={disabled} className={styles.peek} onClick={() => onActivate(next)}>{content}</button>
    : <div className={styles.peek}>{content}</div>;
}

export type QuestToastItem = { id: string; text: string };

/** Queues "step complete" tickets; each shows for `ms`, and waits while `paused` (a reader is open). */
export function useQuestToasts(steps: QuestStep[] | null, scope: string, paused: boolean, ms = 3200) {
  const seen = useRef<{ scope: string; done: Set<string> } | null>(null);
  const [queue, setQueue] = useState<QuestToastItem[]>([]);
  const doneKey = steps?.filter((step) => step.done).map((step) => step.id).join("|") ?? "";
  useEffect(() => {
    if (!steps) return;
    const done = new Set(steps.filter((step) => step.done).map((step) => step.id));
    if (seen.current?.scope !== scope) {
      seen.current = { scope, done };
      setQueue([]);
      return;
    }
    const fresh = steps.filter((step) => step.done && !seen.current!.done.has(step.id));
    seen.current.done = done;
    if (fresh.length) setQueue((current) => [...current, ...fresh.map((step) => ({ id: `${scope}:${step.id}`, text: step.text }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `doneKey` captures what changed in `steps`.
  }, [doneKey, scope]);
  const current = paused ? null : queue[0] ?? null;
  const dismiss = useCallback(() => setQueue((list) => list.slice(1)), []);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(dismiss, ms);
    return () => window.clearTimeout(timer);
  }, [current, dismiss, ms]);
  return { current, dismiss };
}

export function QuestToast({ text, inline = false }: { text: string; inline?: boolean }) {
  const popover = useRef<HTMLDivElement>(null);
  useTopLayer(popover, !inline);
  return (
    <div ref={popover} popover={inline ? undefined : "manual"} className={`${styles.toast} ${inline ? styles.inline : ""}`}>
      <div className={styles.toastCard}>
        <span className={styles.toastTick} aria-hidden><Check size={20} strokeWidth={3.5} /></span>
        <span>
          <span className={`${pixelFont.className} ${styles.toastKicker}`}>Quest step done</span>
          <span className={styles.toastText}>{text}</span>
        </span>
      </div>
      <span className="sr-only" role="status">Quest step done: {text}</span>
    </div>
  );
}

export function DecisionCallToAction({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-haspopup="dialog" disabled={disabled} onClick={onClick} className={`${pixelFont.className} ${styles.cta} pointer-events-auto disabled:opacity-60`}>
      <span className={styles.ctaStar} aria-hidden><Star size={18} strokeWidth={2.5} fill="currentColor" /></span>
      <span>{label}</span>
    </button>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className={`${pixelFont.className} ${styles.key}`}>{children}</kbd>;
}

const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"]);
const COACH_MS = 12_000;

/**
 * First-stage controls hint for people who have never played. Dismisses itself once the player moves,
 * after a few seconds, or on close, and stays dismissed for the attempt.
 */
export function ControlsCoachMark({ storageKey, touch, active, mapRoot, roomId }: {
  storageKey: string;
  touch: boolean;
  /** The map is ready and nothing modal is open. */
  active: boolean;
  /** Pointer presses inside this element count as moving. */
  mapRoot: React.RefObject<HTMLElement | null>;
  roomId: string | null;
}) {
  const [dismissed, setDismissed] = useState(true);
  const firstRoom = useRef(roomId);
  useEffect(() => {
    try { setDismissed(window.sessionStorage.getItem(storageKey) === "1"); }
    catch { setDismissed(false); }
  }, [storageKey]);
  const dismiss = useCallback(() => {
    setDismissed(true);
    try { window.sessionStorage.setItem(storageKey, "1"); } catch { /* storage unavailable */ }
  }, [storageKey]);
  const visible = active && !dismissed;
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(dismiss, COACH_MS);
    const controller = new AbortController();
    document.addEventListener("keydown", (event) => { if (MOVE_KEYS.has(event.key)) dismiss(); }, { signal: controller.signal });
    mapRoot.current?.querySelector("canvas")?.addEventListener("pointerdown", dismiss, { signal: controller.signal });
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [dismiss, mapRoot, visible]);
  useEffect(() => {
    if (roomId !== firstRoom.current && !dismissed) dismiss();
  }, [dismiss, dismissed, roomId]);
  if (!visible) return null;
  return (
    <div role="note" aria-label="How to play" className={`${styles.coach} pointer-events-auto`}>
      <span className={styles.coachItems}>
        {touch ? <>
          <span className={styles.coachItem}><Key>Tap</Key> the map to walk</span>
          <span className={styles.coachItem}><Key>Tap</Key> a person to talk</span>
        </> : <>
          <span className={styles.coachItem}><Key>WASD</Key><span>/</span><Key>↑↓←→</Key> or click the map to move</span>
          <span className={styles.coachItem}><Key>E</Key> talk</span>
          <span className={styles.coachItem}>Notes: bottom right</span>
        </>}
      </span>
      <button type="button" aria-label="Dismiss controls hint" onClick={dismiss} className={styles.coachClose}><X size={16} aria-hidden /></button>
    </div>
  );
}
