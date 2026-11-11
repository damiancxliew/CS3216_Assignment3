"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Action } from "@adventure/play-contract";
import { advanceMock, createMockState, projectMock, type MockState } from "@adventure/engine/mock";

import { V3PlayClient } from "@/components/play/v3/v3-play-client";
import type { V3PlayClient as PlayClient } from "@/lib/play/v3/client";

/** `?steps=continue,continue` replays actions from the start, so a screenshot can open on any screen. */
function replay(steps: string[]): { state: MockState; revision: number } {
  let state = createMockState("showcase");
  let revision = 0;
  for (const step of steps) {
    const [type, ...rest] = step.split(":");
    const arg = rest.join(":");
    const action = type === "enterRoom" ? { type, roomId: arg }
      : type === "message" ? { type, characterId: arg.split("=")[0], text: arg.split("=")[1] ?? "Hello" }
        : type === "openDocument" || type === "closeDocument" ? { type, documentId: arg }
          : type === "act" ? { type, actId: arg }
            : type === "predict" ? { type, outcomeId: arg }
              : type === "interviewAnswer" ? { type, verdictId: arg, evidenceNoteIds: [] }
              : { type };
    try {
      state = advanceMock(state, Action.parse(action), Date.now()).state;
      revision += 1;
    } catch (error) {
      console.warn("showcase step failed", step, error);
    }
  }
  return { state, revision };
}

export function MockPlay() {
  const params = useSearchParams();
  const steps = (params.get("steps") ?? "").split(",").filter(Boolean);
  const boot = useMemo(() => replay(steps), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const makeClient = useMemo(() => () => {
    let { state, revision } = boot;
    const client: PlayClient = {
      refresh: async () => ({ ok: true, revision, view: projectMock(state) }),
      act: async (_revision, untrusted) => {
        try {
          state = advanceMock(state, Action.parse(untrusted), Date.now()).state;
          revision += 1;
          return { ok: true, revision, view: projectMock(state) };
        } catch (error) {
          return { ok: false, kind: "error", message: error instanceof Error ? error.message : "Mock action failed" };
        }
      },
    };
    return client;
  }, [boot]);
  return (
    <V3PlayClient
      attemptId="showcase-mock"
      initialView={projectMock(boot.state)}
      initialRevision={boot.revision}
      makeClient={makeClient}
    />
  );
}
