"use client";

import { useCallback } from "react";

import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";
import type { PortraitBase } from "@/lib/play/v3/portraits";
import type { V3StageScenery } from "@/lib/play/v3/scenery";
import type { ResolvedImage } from "@/lib/v3/media/resolvers";
import type { FortressSnapshot } from "./engine";

export function FortressPlay({ initial, scenery, portraitBase, stageImages }: {
  initial: FortressSnapshot;
  scenery: V3StageScenery[];
  portraitBase: PortraitBase;
  stageImages: ResolvedImage[];
}) {
  const makeClient = useCallback((): PlayClient => {
    let snapshot = initial;
    return {
      refresh: async () => ({ ok: true, revision: snapshot.revision, view: snapshot.view }),
      act: async (_revision, action) => {
        const response = await fetch("/showcase/fortress/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ snapshot, action }) });
        const body = await response.json();
        if (!response.ok) return { ok: false, kind: "error", message: body?.error?.message ?? "Step failed" };
        snapshot = body as FortressSnapshot;
        return { ok: true, revision: snapshot.revision, view: snapshot.view };
      },
    };
  }, [initial]);
  return (
    <V3PlayClient
      attemptId="showcase-fortress"
      initialView={initial.view}
      initialRevision={initial.revision}
      makeClient={makeClient}
      scenery={scenery}
      portraitBase={portraitBase}
      stageImages={stageImages}
    />
  );
}
