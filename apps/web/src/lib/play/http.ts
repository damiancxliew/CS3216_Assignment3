/**
 * Glue between the route handlers and the play service: who is asking, which
 * store and model to use, and how a `SessionError` maps onto the I3 error
 * envelope. Route files stay a few lines each.
 */
import { createOpenAiClient } from "@adventure/orchestration";
import { NextResponse } from "next/server";

import { findForbiddenKeys, type ApiError } from "@/lib/turn-api/contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import type { PlayServiceDeps } from "./service";
import type { SessionError } from "./session";
import { SupabasePlayStore } from "./store";

const STATUS: Record<SessionError["code"], number> = {
  not_found: 404,
  invalid_request: 400,
  stale_option: 409,
  stale_state: 409,
  rate_limited: 429,
  incompatible_version: 409,
  stage_closed: 409,
};

export function errorResponse(error: SessionError | ApiError["error"], status = STATUS[error.code as SessionError["code"]] ?? 400) {
  return NextResponse.json({ error }, { status });
}

/** Signed-in user id, or an `unauthorized` response. */
export async function requireUserId(): Promise<string | NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? errorResponse({ code: "unauthorized", message: "Sign in to play." }, 401);
}

let deps: PlayServiceDeps | null = null;

/** One store and one model client per server process; both are stateless across requests. */
export function playDeps(): PlayServiceDeps {
  if (!deps) deps = { store: new SupabasePlayStore(createAdminClient()), llm: createOpenAiClient() };
  return deps;
}

/**
 * Last line of defence for FR-21: a payload that somehow carries a forbidden
 * key is refused rather than sent. This should never fire; that is the point.
 */
export function publicJson(payload: unknown, init?: ResponseInit) {
  const leaks = findForbiddenKeys(payload);
  if (leaks.length > 0) {
    console.error("Turn API refused to send a payload with private keys", leaks);
    return NextResponse.json({ error: { code: "invalid_request", message: "Response withheld." } }, { status: 500 });
  }
  return NextResponse.json(payload, init);
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
