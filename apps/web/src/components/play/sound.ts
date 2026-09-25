"use client";

/**
 * Sound for the play view. Music and ambience are chosen by the renderer from
 * the stage's atmosphere; this hook turns *changes* in state into one-shot cues
 * (a reply arrived, evidence found, a door opened or closed, a goal was met,
 * a new stage began, the clock is nearly out) and keeps the mute preference
 * across visits. UI moments that leave no trace in state — sending a message,
 * knocking, opening or closing a panel, deciding — are pushed imperatively via
 * `playCue`. Each cue has a stable key so the renderer plays it exactly once,
 * and the list is bounded so it never grows.
 */
import type { SoundCueId } from "@adventure/game-client";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayState } from "@/lib/play/session";

const MUTE_KEY = "play.muted";
const MAX_CUES = 24;
const ALERT_AT_SECONDS = 60;

export type SoundCue = { key: string; id: SoundCueId };

export function useSoundCues(state: PlayState, notice: string | null) {
  const [muted, setMuted] = useState(false);
  const [cues, setCues] = useState<SoundCue[]>([]);
  const previous = useRef<PlayState | null>(null);
  const alerted = useRef<string | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      /* private mode: default to sound on */
    }
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const push = useCallback((...added: SoundCue[]) => {
    if (added.length === 0) return;
    setCues((current) => [...current, ...added].slice(-MAX_CUES));
  }, []);

  // Cues from what changed since the last state.
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (!before) return;
    const added: SoundCue[] = [];
    const sameStage = before.stage.id === state.stage.id;

    if (sameStage && state.journal.length > before.journal.length) added.push({ key: `evidence:${state.stage.id}:${state.journal.length}`, id: "evidence" });
    if (state.announcements.length > before.announcements.length) added.push({ key: `resolution:${state.announcements.length}`, id: "resolution" });
    if (sameStage && state.transcript.length > before.transcript.length && state.transcript[state.transcript.length - 1]?.authorType === "agent") {
      added.push({ key: `voice:${state.stage.id}:${state.transcript.length}`, id: "voice" });
    }
    if (sameStage) {
      const metCount = state.stage.objectives.filter((o) => o.met).length;
      if (metCount > before.stage.objectives.filter((o) => o.met).length) added.push({ key: `goal:${state.stage.id}:${metCount}`, id: "goal" });
      for (const room of state.rooms) {
        const was = before.rooms.find((r) => r.id === room.id);
        if (was && was.doorOpen !== room.doorOpen) added.push({ key: `door:${room.id}:${state.revision}`, id: room.doorOpen ? "door-open" : "door-close" });
      }
    } else {
      added.push({ key: `stage:${state.stage.id}`, id: "stage" });
    }
    push(...added);
  }, [state, push]);

  // A refusal ("the door is closed") gets a soft cancel sound.
  useEffect(() => {
    if (notice) push({ key: `refused:${notice}:${state.revision}`, id: "refused" });
  }, [notice, state.revision, push]);

  // One alert per stage when the timer drops under a minute.
  useEffect(() => {
    if (!state.timer.enabled || state.timer.secondsRemaining === null) return;
    if (state.timer.secondsRemaining > ALERT_AT_SECONDS || alerted.current === state.stage.id) return;
    const delay = Math.max(0, (state.timer.secondsRemaining - ALERT_AT_SECONDS) * 1000);
    const handle = window.setTimeout(() => {
      alerted.current = state.stage.id;
      push({ key: `alert:${state.stage.id}`, id: "alert" });
    }, delay);
    return () => window.clearTimeout(handle);
  }, [state.timer.enabled, state.timer.secondsRemaining, state.stage.id, push]);

  // UI-driven cues that do not show up as a state diff (clicking knock, opening
  // a panel) get a unique key each time so the renderer plays every one.
  const playCue = useCallback(
    (id: SoundCueId) => push({ key: `${id}:${(counter.current += 1)}`, id }),
    [push],
  );

  return { muted, toggleMuted, cues, playCue };
}
