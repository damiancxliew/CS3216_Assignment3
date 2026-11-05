"use client";

import type { CharacterView, MessageView } from "@adventure/play-contract";
import { ArrowDown, ArrowUp, Lightbulb, ScrollText, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import styles from "@/components/play/v3/story-lines.module.css";

export const STORY_TOAST_MS = 6_000;
const STANCE_SHIFT_MS = 6_000;

export type StanceShift = "up" | "down";

const STORY_KINDS: ReadonlySet<MessageView["kind"]> = new Set(["thought", "narration", "notice"]);

export function isStoryLine(message: Pick<MessageView, "kind">): boolean {
  return STORY_KINDS.has(message.kind);
}

/**
 * What the talk box shows: the room's conversation, the open character's reactions, and any hint or story
 * line that arrived after the box opened (older ones were already shown on the map).
 */
export function talkLines<T extends MessageView>(
  messages: readonly T[],
  roomId: string | null,
  characterId: string,
  seenAtOpen: ReadonlySet<string>,
): T[] {
  return messages.filter((message) => {
    if (message.roomId !== roomId) return false;
    if (message.kind === "player" || message.kind === "character") return true;
    if (message.kind === "notice") return message.characterId === characterId;
    return !seenAtOpen.has(message.id);
  });
}

export function storyKicker(message: Pick<MessageView, "kind" | "characterId">, characters: readonly Pick<CharacterView, "id" | "name">[]): string {
  if (message.kind === "thought") return "A thought";
  if (message.kind === "notice") return characters.find((character) => character.id === message.characterId)?.name ?? "A reaction";
  return "Meanwhile";
}

/** Queues hints, story events and reactions that arrive while the student is on the map, one at a time. */
export function useStoryToasts(messages: MessageView[], live: boolean) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<MessageView[]>([]);

  useEffect(() => {
    const lines = messages.filter(isStoryLine);
    if (seen.current === null) {
      seen.current = new Set(lines.map((line) => line.id));
      return;
    }
    const fresh = lines.filter((line) => !seen.current!.has(line.id));
    if (fresh.length === 0) return;
    for (const line of fresh) seen.current.add(line.id);
    if (live) setQueue((current) => [...current, ...fresh]);
  }, [messages, live]);

  useEffect(() => {
    if (!live) setQueue([]);
  }, [live]);

  const current = queue[0] ?? null;
  const dismiss = useCallback(() => setQueue((items) => items.slice(1)), []);

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(dismiss, STORY_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);

  return { current, dismiss };
}

export function stanceShifts(
  before: ReadonlyMap<string, number>,
  characters: readonly Pick<CharacterView, "id" | "stance">[],
): Map<string, StanceShift> {
  const shifts = new Map<string, StanceShift>();
  for (const character of characters) {
    const level = character.stance?.level;
    const previous = before.get(character.id);
    if (level === undefined || previous === undefined || level === previous) continue;
    shifts.set(character.id, level > previous ? "up" : "down");
  }
  return shifts;
}

/** Remembers which characters' stances just moved, and which way, for a few seconds. */
export function useStanceShifts(characters: CharacterView[]): ReadonlyMap<string, StanceShift> {
  const levels = useRef(new Map<string, number>());
  const [shifts, setShifts] = useState<ReadonlyMap<string, StanceShift>>(new Map());

  useEffect(() => {
    const fresh = stanceShifts(levels.current, characters);
    for (const character of characters) {
      if (character.stance) levels.current.set(character.id, character.stance.level);
    }
    if (fresh.size === 0) return;
    setShifts((current) => new Map([...current, ...fresh]));
    const timer = window.setTimeout(() => {
      setShifts((current) => {
        const next = new Map(current);
        for (const id of fresh.keys()) next.delete(id);
        return next;
      });
    }, STANCE_SHIFT_MS);
    return () => window.clearTimeout(timer);
  }, [characters]);

  return shifts;
}

export function StanceTag({ label, shift }: { label: string; shift?: StanceShift | null }) {
  return (
    <span
      className={`${styles.stance} ${shift === "up" ? styles.up : shift === "down" ? styles.down : ""}`}
      aria-label={`Stance: ${label}${shift ? (shift === "up" ? ", just warmed to you" : ", just cooled towards you") : ""}`}
    >
      {shift === "up" ? <ArrowUp size={13} aria-hidden="true" /> : shift === "down" ? <ArrowDown size={13} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

export function StoryToast({
  message,
  characters,
  shift,
  onDismiss,
}: {
  message: MessageView;
  characters: readonly CharacterView[];
  shift?: StanceShift | null;
  onDismiss: () => void;
}) {
  const popover = useRef<HTMLDivElement>(null);

  // The top layer keeps the line above an open scroll, which is itself a modal dialog.
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

  const kicker = storyKicker(message, characters);
  const stance = message.kind === "notice" ? characters.find((character) => character.id === message.characterId)?.stance : null;
  const Icon = message.kind === "thought" ? Lightbulb : message.kind === "notice" ? UserRound : ScrollText;
  return (
    <div ref={popover} popover="manual" className={styles.toast} data-kind={message.kind}>
      <button type="button" className={styles.card} onClick={onDismiss} aria-label={`${kicker}: ${message.text}. Dismiss`}>
        <span className={styles.icon} aria-hidden="true"><Icon size={20} /></span>
        <span className={styles.body}>
          <span className={styles.kicker}>
            {kicker}
            {stance ? <StanceTag label={stance.label} shift={shift} /> : null}
          </span>
          <span className={styles.text}>{message.text}</span>
        </span>
      </button>
      <span className="sr-only" role="status">{kicker}: {message.text}</span>
    </div>
  );
}
