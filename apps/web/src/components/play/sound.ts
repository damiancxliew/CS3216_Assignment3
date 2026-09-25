"use client";

/**
 * Sound for the play view. Ambience is played by the renderer from the stage's
 * atmosphere; music is played here, outside the renderer, so a new stage does
 * not restart it on top of the previous one. `useSoundCues` turns *changes* in
 * state into one-shot cues (a reply arrived, evidence found, a door moved, the
 * clock is nearly out) and keeps the mute preference across visits. Each cue
 * has a stable key so the renderer plays it exactly once, and the list is
 * bounded so it never grows.
 */
import type { SoundCueId } from "@adventure/game-client";
import { selectMusicTrack } from "@adventure/game-client/music";
import { useCallback, useEffect, useRef, useState } from "react";

import { ASSET_BASE } from "@/lib/play/appearance";
import { StageMusic } from "@/lib/play/stage-music";
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
      added.push({ key: `accept:${state.stage.id}:${state.transcript.length}`, id: "accept" });
    }
    if (sameStage) {
      for (const room of state.rooms) {
        const was = before.rooms.find((r) => r.id === room.id);
        if (was && was.doorOpen !== room.doorOpen) added.push({ key: `door:${room.id}:${state.revision}`, id: "door" });
      }
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

  return { muted, toggleMuted, cues };
}

/** The stage's soundtrack, chosen from its atmosphere and stable for the whole stage. */
export function stageMusicUrl(state: PlayState): string | null {
  if (state.status !== "active") return null;
  return `${ASSET_BASE}/audio/music/${selectMusicTrack(state.stage.ambientOverlay, `${state.adventureId}:${state.stage.id}`)}.ogg`;
}

/** Play `url`, crossfading between stages; the player outlives the map renderer. */
export function useStageMusic(url: string | null, muted: boolean) {
  const player = useRef<StageMusic | null>(null);

  useEffect(() => {
    const music = new StageMusic({
      createElement: (src) => {
        const element = new Audio(src);
        element.preload = "auto";
        return element;
      },
    });
    player.current = music;
    const resume = () => music.resume();
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    return () => {
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
      music.stop();
      player.current = null;
    };
  }, []);

  useEffect(() => {
    player.current?.play(url);
  }, [url]);

  useEffect(() => {
    player.current?.setMuted(muted);
  }, [muted]);
}
