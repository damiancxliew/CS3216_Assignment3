import type { PreviewInsight } from "@adventure/engine";
import type { Action, PlayerView } from "@adventure/play-contract";
import type { V3Edit } from "@/lib/v3/edit/commands";

import { failureOf, readBody, type V3PlayClient, type V3PlayResult } from "./client";

type PreviewResponseBody = {
  token?: unknown;
  view?: unknown;
  pendingCheckIds?: unknown;
  insight?: unknown;
};

export type PreviewDraftEdits = { version: number; edits: V3Edit[] };
export type PreviewClientOptions = {
  /** The teacher's unsaved edits, read before every request so the next step plays them. */
  draft?: () => PreviewDraftEdits | null;
  onInsight?: (insight: PreviewInsight) => void;
};

export function createV3PreviewClient(
  adventureId: string,
  initialToken: string,
  initialView: PlayerView,
  fetchImpl: typeof fetch = fetch,
  options: PreviewClientOptions = {},
): V3PlayClient {
  const base = `/api/v3/preview/${encodeURIComponent(adventureId)}`;
  let token = initialToken;
  let view = initialView;
  let revision = 0;
  let pending: string[] = [];
  let chain: Promise<void> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = chain.then(operation, operation);
    chain = result.then(() => undefined, () => undefined);
    return result;
  }

  function withDraft(body: Record<string, unknown>) {
    const draft = options.draft?.();
    return draft && draft.edits.length > 0 ? { ...body, draft } : body;
  }

  async function post(path: string, body: Record<string, unknown>): Promise<V3PlayResult> {
    try {
      const response = await fetchImpl(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(withDraft(body)),
      });
      const raw = await readBody(response);
      const result = raw as (typeof raw & PreviewResponseBody) | null;
      if (
        response.status === 200 &&
        typeof result?.token === "string" &&
        result.token.length > 0 &&
        result.view !== null &&
        typeof result.view === "object"
      ) {
        token = result.token;
        view = result.view as PlayerView;
        pending = Array.isArray(result.pendingCheckIds)
          ? result.pendingCheckIds.filter((id): id is string => typeof id === "string")
          : [];
        revision += 1;
        if (result.insight && typeof result.insight === "object") options.onInsight?.(result.insight as PreviewInsight);
        return { ok: true, revision, view };
      }
      return failureOf(response, raw);
    } catch {
      return { ok: false, kind: "error", message: "Could not reach the server. Please try again." };
    }
  }

  return {
    act(_revision: number, action: Action): Promise<V3PlayResult> {
      return serialize(() => post(`${base}/actions`, { token, action }));
    },
    refresh(): Promise<V3PlayResult> {
      return serialize(async () => {
        for (const messageId of [...pending]) {
          if (!pending.includes(messageId)) continue;
          const result = await post(`${base}/check`, { token, messageId });
          if (!result.ok) return result;
        }
        return { ok: true, revision, view };
      });
    },
  };
}
