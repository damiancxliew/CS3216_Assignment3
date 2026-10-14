"use client";

import type { Action, PlayerView } from "@adventure/play-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { createV3PlayClient } from "@/lib/play/v3/client";
import type { V3PlayClient } from "@/lib/play/v3/client";

const PENDING_REFRESH_DELAYS = [2_500, 6_000];

export function useV3Play(attemptId: string, initialView: PlayerView, initialRevision: number) {
  const client = useRef<V3PlayClient | null>(null);
  if (client.current === null) client.current = createV3PlayClient(attemptId);
  const [view, setView] = useState(initialView);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ kind: string; message: string } | null>(null);
  const revisionRef = useRef(initialRevision);
  const queue = useRef<Action[]>([]);
  const processing = useRef(false);
  const busyRef = useRef(false);

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

  const send = useCallback((action: Action) => {
    queue.current.push(action);
    if (processing.current) return;
    processing.current = true;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      while (queue.current.length > 0) {
        const next = queue.current.shift()!;
        const result = await client.current!.act(revisionRef.current, next);
        if (result.ok) {
          adopt(result.view, result.revision);
          setBanner(null);
          if (result.view.pendingCheck) void refreshPending();
          continue;
        }
        if (result.kind === "stale") {
          adopt(result.view, result.revision);
          setBanner({ kind: result.kind, message: "The game moved on — refreshed." });
        } else {
          setBanner({ kind: result.kind, message: result.message });
        }
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
        queue.current.length === 0
      ) {
        send({ type: "tick" });
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [send, view.phase, view.timer]);

  return { view, revision, busy, banner, send, clearBanner: () => setBanner(null) };
}
