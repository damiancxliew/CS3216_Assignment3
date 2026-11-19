"use client";
import type { ResolvedImage } from "@/lib/v3/media/resolvers";

import type { V3StageScenery } from "@/lib/play/v3/scenery";
import type { PortraitBase } from "@/lib/play/v3/portraits";
import { ArrowLeft, PanelRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef } from "react";
import type { PlayerView } from "@adventure/play-contract";

import styles from "@/components/play/adventure-chrome.module.css";
import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import { createV3PreviewClient, type PreviewClientOptions } from "@/lib/play/v3/preview-client";
import type { PlayFocus } from "@/components/play/v3/play-focus";

export function V3PreviewHeaderActions({ adventureId, panel,
}: { adventureId: string;
  /** The teacher's edit panel beside the game. */
  panel?: { open: boolean; toggle(): void };
}) {
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
      {panel ? (
        <button
          type="button"
          aria-pressed={panel.open}
          aria-label={panel.open ? "Hide edit panel" : "Show edit panel"}
          onClick={panel.toggle}
          className={`${actionClass} ${panel.open ? "!bg-[#ffe0a2] !text-[#1f2433]" : ""}`}
        >
          <PanelRight className="h-4 w-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Edit panel</span>
        </button>
      ) : null}
      {panel ? (
        // A full load, so the editor starts fresh and recovers the draft edited here.
        <a href={`/v3/teacher/${adventureId}`} aria-label="Back to adventure" className={actionClass}>
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Back to adventure</span>
        </a>
      ) : (
      <Link
          href={`/v3/teacher/${adventureId}`}
          aria-label="Back to adventure"
          className={actionClass}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Back to adventure</span>
        </Link>
      )}
    </div>
  );
}

export function V3PreviewClient({
  adventureId,
  initialToken,
  scenery = [],
  initialView,
  portraitBase,
  stageArtBase,
  stageImages,
  draft,
  onUpdate,
  onFocusChange,
  panel,
}: {
  draft?: PreviewClientOptions["draft"];
  onUpdate?: PreviewClientOptions["onUpdate"];
  onFocusChange?: (focus: PlayFocus) => void;
  panel?: { open: boolean; toggle(): void };
  adventureId: string;
  initialToken: string;
  scenery?: V3StageScenery[];
  initialView: PlayerView;
  portraitBase?: PortraitBase;
  stageArtBase?: string | null;
  stageImages?: ResolvedImage[];
}) {
  // Read through refs so a new draft never recreates the client and restarts the game.
  const latest = useRef({ draft, onUpdate });
  latest.current = { draft, onUpdate };
  const makeClient = useCallback(
    () => createV3PreviewClient(adventureId, initialToken, initialView, fetch, {
      draft: () => latest.current.draft?.() ?? null,
      onUpdate: (update) => latest.current.onUpdate?.(update),
    }),
    [adventureId, initialToken, initialView],
  );

  return (
    <V3PlayClient
      scenery={scenery}
      portraitBase={portraitBase}
      stageArtBase={stageArtBase}
      stageImages={stageImages}
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
      headerActions={<V3PreviewHeaderActions adventureId={adventureId} panel={panel} />}
      onFocusChange={onFocusChange}
    />
  );
}
