import { z } from "zod";

import { errorResponse, playDeps, publicJson, readJson, requireUserId } from "@/lib/play/http";
import { postDecision } from "@/lib/play/service";
import { decisionRequestSchema } from "@/lib/turn-api/contract";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * The I3 request plus the option-set version the player was looking at, so a
 * commit against a set the world has moved past is rejected, not executed
 * (K6/FR-14). Without it the server checks availability only.
 */
const requestSchema = decisionRequestSchema.extend({ optionsVersion: z.string().min(1).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const parsed = requestSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse({ code: "invalid_request", message: "Expected { optionId }." });

  const result = await postDecision(playDeps(), id, userId, parsed.data);
  if (!result.ok) return errorResponse(result.error);
  return publicJson({ accepted: true, resolution: result.value, state: result.state });
}
