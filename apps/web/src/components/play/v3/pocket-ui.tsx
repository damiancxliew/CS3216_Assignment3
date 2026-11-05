"use client";

import { useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { pixelFont } from "@/components/play/v3/pixel-font";
import styles from "@/components/play/v3/pocket-ui.module.css";

export { styles as pocketStyles };

/** Root class for the palette variables; apply once on any surface that hosts Pocket chrome. */
export const pocketRoot = styles.root;

export type PillTone = "danger" | "warn" | "good" | "record" | "world" | "secret" | "ink";

/** Stance ladders run low → high, but the view only exposes the step. Colour by the step, red to green. */
export function stanceTone(level: number | undefined): PillTone {
  if (level === undefined) return "ink";
  if (level <= 0) return "danger";
  if (level === 1) return "warn";
  return "good";
}

export function PocketPanel({ children, className = "", raised = false, as: Tag = "div", ...rest }: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
  as?: "div" | "section" | "article" | "aside";
} & Record<`aria-${string}`, string | undefined>) {
  return (
    <Tag className={`${styles.root} ${styles.panel} ${raised ? styles.panelRaised : ""} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function PocketTag({ children, float = false, className = "" }: { children: ReactNode; float?: boolean; className?: string }) {
  return <span className={`${pixelFont.className} ${styles.tag} ${float ? styles.tagFloat : ""} ${className}`}>{children}</span>;
}

export function PocketPill({ children, tone = "ink", shift, label, className = "" }: {
  children: ReactNode;
  tone?: PillTone;
  shift?: "up" | "down" | null;
  label?: string;
  className?: string;
}) {
  return (
    <span className={`${styles.root} ${styles.pillWrap} ${className}`}>
      <span className={`${pixelFont.className} ${styles.pill}`} data-tone={tone} data-shift={shift ?? undefined} aria-label={label}>
        {children}
      </span>
    </span>
  );
}

export function PocketRibbon({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className={`${styles.root} pointer-events-none`}>
      <p id={id} className={`${pixelFont.className} ${styles.ribbon} ${styles.ribbonIn}`}>{children}</p>
    </div>
  );
}

export function HudButton({ children, badge, label, className = "", ...rest }: {
  children: ReactNode;
  badge?: number | null;
  label: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={`${styles.root} ${styles.hud} ${className}`} {...rest}>
      {children}
      {badge ? <span key={badge} aria-hidden className={`${pixelFont.className} ${styles.badge}`}>{badge > 99 ? "99+" : badge}</span> : null}
    </button>
  );
}

export function StagePill({ index, timePlace, title }: { index: number; timePlace: string; title: string }) {
  const place = timePlace.trim() || title;
  return (
    <p className={`${styles.root} ${pixelFont.className} ${styles.stagePill}`} title={`Stage ${index + 1}: ${title}`}>
      <span>Stage {index + 1} · {place}</span>
    </p>
  );
}

export const CHOICE_KEYS = ["A", "B", "C", "D", "E", "F"] as const;

/** Index for an A–F hotkey, or -1. */
export function choiceKeyIndex(key: string, count: number): number {
  const index = CHOICE_KEYS.indexOf(key.toUpperCase() as (typeof CHOICE_KEYS)[number]);
  return key.length === 1 && index >= 0 && index < count ? index : -1;
}

export function ChoiceButton({ index, text, selected, closed = false, checked, onSelect, onHover, disabled, role = "option" }: {
  index: number;
  text: ReactNode;
  selected: boolean;
  closed?: boolean;
  checked?: boolean;
  onSelect: () => void;
  onHover?: () => void;
  disabled?: boolean;
  role?: "option" | "checkbox";
}) {
  return (
    <button
      type="button"
      role={role}
      {...(role === "option" ? { "aria-selected": selected } : { "aria-checked": Boolean(checked) })}
      tabIndex={selected ? 0 : -1}
      disabled={disabled || closed}
      aria-disabled={closed || undefined}
      data-closed={closed || undefined}
      data-checked={checked || undefined}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`${styles.root} ${styles.choice}`}
    >
      <span aria-hidden className={`${pixelFont.className} ${styles.choiceKey}`}>{checked ? "✓" : CHOICE_KEYS[index] ?? "•"}</span>
      <span className={`${pixelFont.className} ${styles.choiceText}`}>
        {text}
        {closed ? <span className="sr-only"> (no longer possible)</span> : null}
      </span>
    </button>
  );
}

export type ToastTone = "secret" | "note" | "source";

/** A right-hand popover toast. The top layer keeps it above open scrolls, which are modal dialogs. */
export function PocketToast({ tone, kicker, text, icon, onActivate, actionLabel }: {
  tone: ToastTone;
  kicker: string;
  text: string;
  icon: ReactNode;
  onActivate: () => void;
  actionLabel: string;
}) {
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = popover.current;
    if (!element || typeof element.showPopover !== "function") return;
    try { element.showPopover(); } catch { return; }
    return () => { try { element.hidePopover(); } catch { /* already hidden */ } };
  }, []);
  return (
    <div ref={popover} popover="manual" className={`${styles.root} ${styles.toast}`} data-tone={tone}>
      <button type="button" className={styles.toastCard} onClick={onActivate} aria-label={`${kicker}: ${text}. ${actionLabel}`}>
        <span className={styles.toastIcon} aria-hidden>{icon}</span>
        <span className={styles.toastBody}>
          <span className={`${pixelFont.className} ${styles.toastKicker}`}>{kicker}</span>
          <span className={`${pixelFont.className} ${styles.toastText}`}>{text}</span>
        </span>
      </button>
      <span className="sr-only" role="status">{kicker}: {text}</span>
    </div>
  );
}

export function PocketLogo({ className = "", width = 360 }: { className?: string; width?: number }) {
  return (
    <span className={`${styles.root} ${styles.logo} ${className}`} style={{ width }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img src="/brand/pocket-adventures.png" alt="Pocket Adventures" width={720} height={360} />
    </span>
  );
}

/** Pixel note icon used on the notes HUD button and note toasts. */
export function NotesGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      <path d="M3 1h6v1h1v9H3z" fill="#e9e1cf" />
      <path d="M2 2h6v9H2z" fill="#fff" />
      <path d="M2 1h6v1H2zM1 2h1v9H1zM2 11h7v-1H2zM8 2h1v8H8zM9 2h1v1H9zM10 3h1v8h-1zM9 11h1v1H9z" fill="#1f2433" />
      <path d="M3 4h4v1H3zM3 6h4v1H3zM3 8h4v1H3z" fill="#1f2433" />
    </svg>
  );
}

/** Ids in `items` that were not present before, oldest first. */
export function arrivals<T extends { id: string }>(seen: ReadonlySet<string>, items: readonly T[]): T[] {
  return items.filter((item) => !seen.has(item.id));
}

/** Queues items that appear after the first render, one at a time, each for `ms`. */
export function useArrivals<T extends { id: string }>(items: readonly T[], ms: number) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<T[]>([]);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(items.map((item) => item.id));
      return;
    }
    const fresh = arrivals(seen.current, items);
    if (!fresh.length) return;
    for (const item of fresh) seen.current.add(item.id);
    setQueue((current) => [...current, ...fresh]);
  }, [items]);
  const current = queue[0] ?? null;
  const dismiss = useCallback(() => setQueue((list) => list.slice(1)), []);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(dismiss, ms);
    return () => window.clearTimeout(timer);
  }, [current, dismiss, ms]);
  return { current, dismiss };
}
