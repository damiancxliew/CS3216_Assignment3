"use client";

import type { NoteView } from "@adventure/play-contract";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "@/components/play/v3/note-pickup.module.css";

export const NOTE_PICKUP_MS = 4_000;

export function unseenNotes<T extends Pick<NoteView, "id">>(seen: ReadonlySet<string>, notes: readonly T[]): T[] {
  return notes.filter((note) => !seen.has(note.id));
}

/** Queues notes gained after the screen first rendered, one pickup at a time. */
export function useNotePickups(notes: NoteView[]) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<NoteView[]>([]);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(notes.map((note) => note.id));
      return;
    }
    const fresh = unseenNotes(seen.current, notes);
    if (fresh.length === 0) return;
    for (const note of fresh) seen.current.add(note.id);
    setQueue((current) => [...current, ...fresh]);
  }, [notes]);

  const current = queue[0] ?? null;
  const dismiss = useCallback(() => setQueue((items) => items.slice(1)), []);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(dismiss, NOTE_PICKUP_MS);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  return { current, dismiss };
}

export function NotePickup({ note, onOpen }: { note: NoteView; onOpen: () => void }) {
  const popover = useRef<HTMLDivElement>(null);

  // The top layer keeps the pickup above an open scroll, which is itself a modal dialog.
  useEffect(() => {
    const element = popover.current;
    if (!element || typeof element.showPopover !== "function") return;
    try {
      element.showPopover();
    } catch {
      return;
    }
    return () => {
      try {
        element.hidePopover();
      } catch {
        // Already hidden.
      }
    };
  }, []);

  return (
    <div ref={popover} popover="manual" className={styles.pickup}>
      <button type="button" className={styles.card} onClick={onOpen} aria-label={`New note: ${note.text}. Open notes`}>
        <span className={styles.icon} aria-hidden="true"><Sparkles size={22} /></span>
        <span className={styles.body}>
          <span className={styles.kicker}>New note · {note.source === "document" ? "from a document" : "from a conversation"}</span>
          <span className={styles.text}>{note.text}</span>
        </span>
      </button>
      <span className="sr-only" role="status">New note: {note.text}</span>
    </div>
  );
}
