import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { EngineState } from "@adventure/engine";

type PreviewStateContext = {
  userId: string;
  adventureId: string;
  spec: unknown;
};

function hmacKey(secret?: string): Buffer {
  const value = secret ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to sign preview state.");
  return createHash("sha256").update(`v3-preview-state:${value}`).digest();
}

function messageFor(context: PreviewStateContext, payload: string): string {
  const serializedSpec = JSON.stringify(context.spec);
  if (serializedSpec === undefined) throw new Error("Preview spec cannot be serialized.");
  const specHash = createHash("sha256").update(serializedSpec).digest("hex");
  return ["v3-preview", context.userId, context.adventureId, specHash, payload].join("\n");
}

export function signPreviewState(
  state: EngineState,
  context: PreviewStateContext,
  secret?: string,
): string {
  const serializedState = JSON.stringify(state);
  if (serializedState === undefined) throw new Error("Preview state cannot be serialized.");
  const payload = Buffer.from(serializedState).toString("base64url");
  const signature = createHmac("sha256", hmacKey(secret))
    .update(messageFor(context, payload))
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyPreviewState(
  token: string,
  context: PreviewStateContext,
  secret?: string,
): EngineState | null {
  const key = hmacKey(secret);
  try {
    if (typeof token !== "string") return null;
    const [payload, signature, extra] = token.split(".");
    if (
      extra !== undefined ||
      !payload ||
      !signature ||
      !/^[A-Za-z0-9_-]+$/.test(payload) ||
      !/^[A-Za-z0-9_-]+$/.test(signature)
    ) {
      return null;
    }

    const supplied = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", key)
      .update(messageFor(context, payload))
      .digest();
    if (
      supplied.length !== expected.length ||
      supplied.toString("base64url") !== signature ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    const bytes = Buffer.from(payload, "base64url");
    if (bytes.toString("base64url") !== payload) return null;
    const state: unknown = JSON.parse(bytes.toString("utf8"));
    return state !== null && typeof state === "object" && !Array.isArray(state)
      ? state as EngineState
      : null;
  } catch {
    return null;
  }
}
