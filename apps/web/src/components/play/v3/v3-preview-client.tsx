"use client";

import type { PortraitBase } from "@/lib/play/v3/portraits";
import type { V3StageMapContext } from "@/lib/play/v3/map-context";
import { ArrowLeft, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import type { PlayerView } from "@adventure/play-contract";

import styles from "@/components/play/adventure-chrome.module.css";
import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { createV3PreviewClient } from "@/lib/play/v3/preview-client";

export function V3PreviewHeaderActions({ adventureId }: { adventureId: string }) {
  const actionClass = `${styles.tool} inline-flex min-h-9 items-center justify-center gap-2 px-2.5 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffe0a2]`;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Restart preview"
        onClick={() => window.location.reload()}
        className={actionClass}
      >
        <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Restart preview</span>
      </button>
      <Link
        href={`/v3/teacher/${adventureId}`}
        aria-label="Back to adventure"
        className={actionClass}
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">Back to adventure</span>
      </Link>
    </div>
  );
}

export function V3PreviewClient({
  adventureId,
  initialToken,
  initialView,
  portraitBase,
  stageArtBase,
  mapContext,
}: {
  adventureId: string;
  initialToken: string;
  initialView: PlayerView;
  portraitBase?: PortraitBase;
  stageArtBase?: string | null;
  mapContext?: V3StageMapContext[] | null;
}) {
  const makeClient = useCallback(
    () => createV3PreviewClient(adventureId, initialToken, initialView),
    [adventureId, initialToken, initialView],
  );

  return (
    <V3PlayClient
      portraitBase={portraitBase}
      stageArtBase={stageArtBase}
      mapContext={mapContext}
      attemptId={`preview-${adventureId}`}
      initialRevision={0}
      initialView={initialView}
      makeClient={makeClient}
      busyLabel="Working…"
      revealFooter={
        <Link
          href="/teacher"
          className="min-h-12 rounded-xl border-2 border-ink bg-surface px-5 py-3 font-black text-ink shadow-[0_3px_0_var(--ink)] hover:bg-world-wash"
        >
          Back to adventures
        </Link>
      }
      headerActions={<V3PreviewHeaderActions adventureId={adventureId} />}
    />
  );
}
