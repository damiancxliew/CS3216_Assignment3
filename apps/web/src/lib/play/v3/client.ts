import type { Action, PlayerView } from "@adventure/play-contract";

export type V3PlayResult =
  | { ok: true; revision: number; view: PlayerView }
  | { ok: false; kind: "stale"; revision: number; view: PlayerView }
  | { ok: false; kind: "rate_limited" | "attempt_limit" | "error"; message: string };

type ResponseBody = {
  revision?: unknown;
  view?: unknown;
  error?: { code?: unknown; message?: unknown };
};

function messageOf(body: ResponseBody | null): string {
  return typeof body?.error?.message === "string"
    ? body.error.message
    : "Something went wrong. Please try again.";
}

async function readBody(response: Response): Promise<ResponseBody | null> {
  const body: unknown = await response.json().catch(() => null);
  return body !== null && typeof body === "object" ? body as ResponseBody : null;
}

function successOf(response: Response, body: ResponseBody | null): V3PlayResult | null {
  if (
    response.status === 200 &&
    typeof body?.revision === "number" &&
    body.view !== null &&
    typeof body.view === "object"
  ) {
    return { ok: true, revision: body.revision, view: body.view as PlayerView };
  }
  return null;
}

function failureOf(response: Response, body: ResponseBody | null): V3PlayResult {
  if (response.status === 409 && body?.error?.code === "stale_state" &&
    typeof body.revision === "number" && body.view !== null && typeof body.view === "object") {
    return { ok: false, kind: "stale", revision: body.revision, view: body.view as PlayerView };
  }
  if (response.status === 429 && body?.error?.code === "rate_limited") {
    return { ok: false, kind: "rate_limited", message: messageOf(body) };
  }
  if (response.status === 429 && body?.error?.code === "attempt_limit") {
    return { ok: false, kind: "attempt_limit", message: messageOf(body) };
  }
  return { ok: false, kind: "error", message: messageOf(body) };
}

export function createV3PlayClient(attemptId: string, fetchImpl: typeof fetch = fetch) {
  const base = `/api/v3/attempts/${encodeURIComponent(attemptId)}`;

  async function request(path: string, init?: RequestInit): Promise<V3PlayResult> {
    try {
      const response = await fetchImpl(path, {
        ...init,
        headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      });
      const body = await readBody(response);
      return successOf(response, body) ?? failureOf(response, body);
    } catch {
      return { ok: false, kind: "error", message: "Could not reach the server. Please try again." };
    }
  }

  return {
    act(revision: number, action: Action): Promise<V3PlayResult> {
      return request(`${base}/actions`, {
        method: "POST",
        body: JSON.stringify({ revision, action }),
      });
    },
    refresh(): Promise<V3PlayResult> {
      return request(base, { method: "GET", cache: "no-store" });
    },
  };
}

export type V3PlayClient = ReturnType<typeof createV3PlayClient>;
