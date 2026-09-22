import { z } from "zod";

import { errorResponse, playDeps, publicJson, readJson, requireUserId } from "@/lib/play/http";
import { postMessage } from "@/lib/play/service";
import { messageRequestSchema } from "@/lib/turn-api/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The I3 request plus an optional addressee, so the player can pick who in the room they are talking to. */
const requestSchema = messageRequestSchema.extend({ addresseeId: z.string().min(1).nullable().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse({ code: "invalid_request", message: "Expected { roomId, body }." });

  const result = await postMessage(playDeps(), id, userId, parsed.data);
  if (!result.ok) return errorResponse(result.error);
  return publicJson({ accepted: true, newMessages: result.value, state: result.state });
}
