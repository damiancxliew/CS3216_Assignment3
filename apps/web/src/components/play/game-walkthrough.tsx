"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import styles from "./game-walkthrough.module.css";

const steps = [
  { target: "story", title: "Follow the story", body: "Open the story header to review this stage and what has happened so far." },
  { target: "map", title: "Explore the map", body: "Tap or click to walk. Select a person, document, or landmark to interact. On a keyboard, use the arrow keys or WASD to move." },
  { target: "tools", title: "Keep your notes", body: "Open Notes to review the documents and clues you collect as you explore." },
  { target: "rooms", title: "Move between rooms", body: "Use the room controls to go somewhere, inspect what is nearby, and open doors." },
  { target: "conversation", title: "Talk to people", body: "Get close to someone and type a question. Their replies can help you complete your goals." },
  { target: "goals", title: "Complete your goals", body: "Clear the listed goals by exploring, talking, and using what you learn. Complete all your goals before you decide." },
  { target: "decision", title: "Make a decision", body: "Finishing your goals unlocks a choice. Make a decision to finish this stage and continue the story." },
] as const;

type Layout = "mobile" | "desktop";

export function GameWalkthrough({ layout, onClose }: { layout: Layout; onClose: (layout: Layout) => Promise<boolean> }) {
  const [index, setIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState({ top: 16, left: 16 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const measure = useCallback(() => {
    const target = document.querySelector<HTMLElement>(`[data-walkthrough="${steps[index].target}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    const height = dialog.current?.offsetHeight ?? 240;
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16));
    const below = rect.bottom + 12;
    const above = rect.top - height - 12;
    const top = below + height <= window.innerHeight - 16 ? below
      : above >= 16 ? above
      : Math.max(16, Math.min(below, window.innerHeight - height - 16));
    setTargetRect(rect);
    setPosition({ top, left });
  }, [index]);

  useLayoutEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      const previous = returnFocus.current;
      (previous?.isConnected ? previous : document.querySelector<HTMLElement>('[aria-label="How to play"]'))?.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-walkthrough="${steps[index].target}"]`);
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, measure]);

  useLayoutEffect(() => { if (error) measure(); }, [error, measure]);

  async function close() {
    if (saving) return;
    setSaving(true);
    setError(false);
    const saved = await onClose(layout);
    if (!saved) {
      setError(true);
      setSaving(false);
    }
  }

  const step = steps[index];
  return (
    <div className={styles.overlay}>
      {targetRect ? (
        <div className={styles.spotlight} aria-hidden style={{
          top: Math.max(0, targetRect.top - 4),
          left: Math.max(0, targetRect.left - 4),
          width: Math.min(window.innerWidth - Math.max(0, targetRect.left - 4), targetRect.width + 8),
          height: Math.min(window.innerHeight - Math.max(0, targetRect.top - 4), targetRect.height + 8),
        }} />
      ) : null}
      <div
        ref={dialog}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        aria-describedby="walkthrough-description"
        style={position}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); void close(); }
          if (event.key === "ArrowRight") { event.preventDefault(); if (index < steps.length - 1) setIndex(index + 1); else void close(); }
          if (event.key === "ArrowLeft") { event.preventDefault(); setIndex(Math.max(0, index - 1)); }
          if (event.key === "Tab") {
            const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <p className={styles.count}>How to play · {index + 1} of {steps.length}</p>
        <h2 id="walkthrough-title" className={styles.title}>{step.title}</h2>
        <p id="walkthrough-description" className={styles.body}>{step.body}</p>
        {error ? <p role="alert" className={styles.error}>Couldn’t save your progress. Try again.</p> : null}
        <div className={styles.actions}>
          <button type="button" onClick={() => void close()} disabled={saving}>Skip</button>
          <div>
            {index > 0 ? <button type="button" onClick={() => setIndex(index - 1)} disabled={saving}>Back</button> : null}
            <button type="button" className={styles.next} onClick={() => index < steps.length - 1 ? setIndex(index + 1) : void close()} disabled={saving}>
              {saving ? "Saving…" : index === steps.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
