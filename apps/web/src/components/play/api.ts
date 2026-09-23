/** Thin client over the Turn API. Every call returns the full state, so the page never reconciles deltas. */
import type { PlayState, PlayerWorldAction } from "@/lib/play/session";
import type { PublicEffect, PublicMessage } from "@/lib/turn-api/contract";

export type ApiFailure = { code: string; message: string };

export type ServerTiming = Record<string, number>;

function parseServerTiming(header: string | null): ServerTiming {
  if (!header) return {};
  return Object.fromEntries(header.split(",").flatMap((entry) => {
    const [name, ...parameters] = entry.trim().split(";");
    const duration = parameters.find((parameter) => parameter.trim().startsWith("dur="))?.trim().slice(4);
    const parsed = duration ? Number(duration) : Number.NaN;
    return name && Number.isFinite(parsed) ? [[name, parsed]] : [];
  }));
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T; timings: ServerTiming } | { ok: false; error: ApiFailure; timings: ServerTiming }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    return { ok: false, error: { code: "network_error", message: "Could not reach the server. Please try again." }, timings: {} };
  }
  const timings = parseServerTiming(response.headers.get("server-timing"));
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = (body as { error?: ApiFailure } | null)?.error ?? { code: "unknown", message: `HTTP ${response.status}` };
    return { ok: false, error, timings };
  }
  if (body === null || typeof body !== "object") return { ok: false, error: { code: "invalid_response", message: "The server returned an invalid response. Please try again." }, timings };
  return { ok: true, body: body as T, timings };
}

export const playApi = {
  state: (attemptId: string) => call<PlayState>(`/api/attempt/${attemptId}/state`, { cache: "no-store" }),
  message: (attemptId: string, input: { roomId: string; body: string; addresseeId?: string | null }) =>
    call<{ accepted: true; newMessages: PublicMessage[]; state: PlayState }>(`/api/attempt/${attemptId}/message`, { method: "POST", body: JSON.stringify(input) }),
  action: (attemptId: string, action: PlayerWorldAction) =>
    call<{ accepted: true; refused: string | null; state: PlayState }>(`/api/attempt/${attemptId}/action`, { method: "POST", body: JSON.stringify(action) }),
  decide: (attemptId: string, input: { optionId: string; optionsVersion: string }) =>
    call<{ accepted: true; resolution: { announcement: string; effects: PublicEffect[]; nextStageId: string | null; ending: boolean }; state: PlayState }>(
      `/api/attempt/${attemptId}/decision`,
      { method: "POST", body: JSON.stringify(input) },
    ),
};
