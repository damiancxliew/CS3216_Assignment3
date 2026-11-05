"use client";

import type { SoundCueId } from "@adventure/game-client";
import type { PlayerView } from "@adventure/play-contract";
import { useCallback, useEffect, useRef, useState } from "react";

const MUTE_KEY = "play.muted";
const MAX_CUES = 24;
const ALERT_AT_MS = 60_000;

export type V3SoundCue = { key: string; id: SoundCueId };

export function v3CuesBetween(before: PlayerView, after: PlayerView): V3SoundCue[] {
  const stageIndex = after.stage?.index;
  if (stageIndex === undefined || before.stage?.index !== stageIndex) return [];

  const cues: V3SoundCue[] = [];
  if (after.notes.length > before.notes.length) {
    cues.push({ key: `evidence:${stageIndex}:${after.notes.length}`, id: "evidence" });
  }

  after.messages.slice(before.messages.length).forEach((message, index) => {
    const count = before.messages.length + index + 1;
    if (message.kind === "character") {
      cues.push({ key: `accept:${stageIndex}:${count}`, id: "accept" });
    } else if (message.kind === "narration" || message.kind === "notice") {
      cues.push({ key: `resolution:${stageIndex}:${count}`, id: "resolution" });
    }
  });

  return cues;
}

export function useV3SoundCues(view: PlayerView, error: string | null) {
  const [muted, setMuted] = useState(true);
  const [cues, setCues] = useState<V3SoundCue[]>([]);
  const previousView = useRef<PlayerView | null>(null);
  const previousError = useRef<string | null>(null);
  const refusedCount = useRef(0);
  const alertedStage = useRef<number | null>(null);

  useEffect(() => {
    try {
      setMuted(window.localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      setMuted(false);
    }
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        // Private browsing can disable localStorage.
      }
      return next;
    });
  }, []);

  const push = useCallback((...added: V3SoundCue[]) => {
    if (added.length) setCues((current) => [...current, ...added].slice(-MAX_CUES));
  }, []);

  useEffect(() => {
    const before = previousView.current;
    previousView.current = view;
    if (before) push(...v3CuesBetween(before, view));
  }, [view, push]);

  useEffect(() => {
    const before = previousError.current;
    previousError.current = error;
    if (error && error !== before) {
      refusedCount.current += 1;
      push({
        key: `refused:${view.stage?.index ?? -1}:${refusedCount.current}`,
        id: "refused",
      });
    }
  }, [error, push, view.stage?.index]);

  const timerStageIndex = view.stage?.index;
  const timerEndsAt = view.timer?.endsAt;
  useEffect(() => {
    const stageIndex = timerStageIndex;
    if (stageIndex === undefined || !timerEndsAt || alertedStage.current === stageIndex) return;

    const addAlert = () => {
      if (alertedStage.current === stageIndex) return;
      alertedStage.current = stageIndex;
      push({ key: `alert:${stageIndex}`, id: "alert" });
    };
    const remaining = new Date(timerEndsAt).getTime() - Date.now();
    const delay = remaining - ALERT_AT_MS;
    if (delay <= 0) {
      addAlert();
      return;
    }

    const handle = window.setTimeout(addAlert, delay);
    return () => window.clearTimeout(handle);
  }, [timerStageIndex, timerEndsAt, push]);

  return { muted, toggleMuted, cues };
}
