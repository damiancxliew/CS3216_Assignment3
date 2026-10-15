import type { EngineState } from "@adventure/engine";
import type { Action, PlayerView } from "@adventure/play-contract";

import { failureOf, readBody, type V3PlayClient, type V3PlayResult } from "./client";

type PreviewResponseBody = {
  state?: unknown;
  view?: unknown;
  pendingCheckIds?: unknown;
};

export function createV3PreviewClient(
  adventureId: string,
  initialState: EngineState,
  initialView: PlayerView,
  fetchImpl: typeof fetch = fetch,
): V3PlayClient {
  const base = `/api/v3/preview/${encodeURIComponent(adventureId)}`;
  let state = initialState;
  let view = initialView;
  let revision = 0;
  let pending: string[] = [];
  let chain: Promise<void> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = chain.then(operation, operation);
    chain = result.then(() => undefined, () => undefined);
    return result;
  }

  async function post(path: string, body: Record<string, unknown>): Promise<V3PlayResult> {
    try {
      const response = await fetchImpl(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await readBody(response);
      const result = raw as (typeof raw & PreviewResponseBody) | null;
      if (
        response.status === 200 &&
        result?.state !== null &&
        typeof result?.state === "object" &&
        result.view !== null &&
        typeof result.view === "object"
      ) {
        state = result.state as EngineState;
        view = result.view as PlayerView;
        pending = Array.isArray(result.pendingCheckIds)
          ? result.pendingCheckIds.filter((id): id is string => typeof id === "string")
          : [];
        revision += 1;
        return { ok: true, revision, view };
      }
      return failureOf(response, raw);
    } catch {
      return { ok: false, kind: "error", message: "Could not reach the server. Please try again." };
    }
  }

  return {
    act(_revision: number, action: Action): Promise<V3PlayResult> {
      return serialize(() => post(`${base}/actions`, { state, action }));
    },
    refresh(): Promise<V3PlayResult> {
      return serialize(async () => {
        for (const messageId of [...pending]) {
          if (!pending.includes(messageId)) continue;
          const result = await post(`${base}/check`, { state, messageId });
          if (!result.ok) return result;
        }
        return { ok: true, revision, view };
      });
    },
  };
}
