"use client";

import type { PortraitBase } from "@/lib/play/v3/portraits";
import Link from "next/link";
import { useCallback } from "react";
import type { PlayerView } from "@adventure/play-contract";

import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { createV3PreviewClient } from "@/lib/play/v3/preview-client";

export function V3PreviewClient({
  adventureId,
  initialToken,
  initialView,
  portraitBase,
}: {
  adventureId: string;
  initialToken: string;
  initialView: PlayerView;
  portraitBase?: PortraitBase;
}) {
  const makeClient = useCallback(
    () => createV3PreviewClient(adventureId, initialToken, initialView),
    [adventureId, initialToken, initialView],
  );

  return (
    <V3PlayClient
      portraitBase={portraitBase}
      attemptId={`preview-${adventureId}`}
      initialRevision={0}
      initialView={initialView}
      makeClient={makeClient}
      busyLabel="Working…"
      notice={
        <div className="mx-auto mt-4 flex max-w-4xl flex-wrap items-center justify-between gap-3 rounded-xl border border-signal bg-signal-wash px-4 py-3 text-sm font-semibold text-ink">
          <span>Student preview · Progress is not saved.</span>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-9 rounded-lg px-2 underline"
            >
              Restart
            </button>
            <Link
              href={`/v3/teacher/${adventureId}`}
              className="min-h-9 rounded-lg px-2 py-2 underline"
            >
              ← Back to adventure
            </Link>
          </div>
        </div>
      }
    />
  );
}
