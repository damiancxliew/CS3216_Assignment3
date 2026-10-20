"use client";

import type { Action, PlayerView } from "@adventure/play-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { createV3PlayClient } from "@/lib/play/v3/client";
import type { V3PlayClient } from "@/lib/play/v3/client";
import { withPendingPlayerLine, withoutPendingLines } from "@/lib/play/v3/pending-lines";

// Back off while the post-turn check is still running; it usually lands in 2–4 s, rarely after ~30 s.
const PENDING_REFRESH_DELAYS = [2_000, 3_000, 5_000, 8_000, 12_000, 20_000];

/** Background actions (the timer tick) must not lock the controls, flash "Saving…" or touch the banner. */
function isBackground(action: Action): boolean {
  return action.type === "tick";
}

type QueuedAction = {
  action: Action;
  onSettled?: (succeeded: boolean) => void;
};

export function useV3Play(
  attemptId: string,
  initialView: PlayerView,
  initialRevision: number,
  makeClient?: () => V3PlayClient,
) {
  const client = useRef<V3PlayClient | null>(null);
  if (client.current === null) client.current = makeClient ? makeClient() : createV3PlayClient(attemptId);
  const [view, setView] = useState(initialView);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: string; message: string } | null>(null);
  const revisionRef = useRef(initialRevision);
  const queue = useRef<QueuedAction[]>([]);
  const processing = useRef(false);
  const busyRef = useRef(false);
  const pendingCount = useRef(0);

  const adopt = useCallback((nextView: PlayerView, nextRevision: number) => {
    revisionRef.current = nextRevision;
    setView(nextView);
    setRevision(nextRevision);
  }, []);

  const refreshPending = useCallback(async () => {
    for (const delay of PENDING_REFRESH_DELAYS) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (document.visibilityState !== "visible") continue;
      const result = await client.current!.refresh();
      if (!result.ok) continue;
      adopt(result.view, result.revision);
      if (!result.view.pendingCheck) return;
    }
  }, [adopt]);

  const send = useCallback((action: Action, onSettled?: (succeeded: boolean) => void) => {
    queue.current.push({ action, onSettled });
    if (action.type === "message" || action.type === "insertNote") {
      pendingCount.current += 1;
      const id = String(pendingCount.current);
      setView((current) => withPendingPlayerLine(current, action, id, Date.now()));
    }
    if (!isBackground(action)) {
      busyRef.current = true;
      setBusy(true);
    }
    if (processing.current) return;
    processing.current = true;
    void (async () => {
      while (queue.current.length > 0) {
        const next = queue.current.shift()!;
        const result = await client.current!.act(revisionRef.current, next.action);
        const background = isBackground(next.action);
        if (result.ok) {
          adopt(result.view, result.revision);
          if (!background) setBanner(null);
          next.onSettled?.(true);
          if (result.view.pendingCheck) void refreshPending();
          continue;
        }
        next.onSettled?.(false);
        if (background) {
          // A missed tick is harmless; the next one catches up. Don't drop what the student queued behind it.
          if (result.kind === "stale") adopt(result.view, result.revision);
          continue;
        }
        if (result.kind === "stale") {
          adopt(result.view, result.revision);
          setBanner({ kind: result.kind, message: "The game moved on — refreshed." });
        } else {
          setView(withoutPendingLines);
          setBanner({ kind: result.kind, message: result.message });
        }
        for (const queued of queue.current) queued.onSettled?.(false);
        queue.current = [];
        break;
      }
      processing.current = false;
      busyRef.current = false;
      setBusy(false);
    })();
  }, [adopt, refreshPending]);

  useEffect(() => {
    if (view.phase !== "stage" || view.timer === null) return;
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !busyRef.current &&
        !processing.current &&
        queue.current.length === 0
      ) {
        send({ type: "tick" });
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [send, view.phase, view.timer]);

  return { view, revision, busy, banner, send, clearBanner: () => setBanner(null) };
}
