/** Thin client over the Turn API. Every call returns the full state, so the page never reconciles deltas. */
import type { PlayState, PlayerWorldAction } from "@/lib/play/session";
import type { PublicEffect, PublicMessage } from "@/lib/turn-api/contract";

export type ApiFailure = { code: string; message: string };

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; error: ApiFailure }> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = (body as { error?: ApiFailure } | null)?.error ?? { code: "unknown", message: `HTTP ${response.status}` };
    return { ok: false, error };
  }
  return { ok: true, body: body as T };
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
