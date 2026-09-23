import { z } from "zod";

import { errorResponse, playDeps, publicJson, readJson, requireUserId, withPlayPerf } from "@/lib/play/http";
import { postAction } from "@/lib/play/service";
import { createTimings } from "@/lib/play/timing";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const point = z.object({ x: z.number().int(), y: z.number().int() }).strict();

/**
 * Player world actions beyond speech and the decision: the allow-listed
 * movement and door actions (FR-20), examining evidence in the room, and
 * reporting the tile the client is standing on so a resume redraws it. The
 * server owns room membership; the client owns the walk between tiles.
 */
const actionRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move_step"), stageId: z.string().min(1), from: point, to: point }).strict(),
  z.object({ type: z.literal("move_room"), toRoomId: z.string().min(1), position: point.optional() }),
  z.object({ type: z.literal("open_door"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("close_door"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("knock"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("inspect"), evidenceId: z.string().min(1) }),
  z.object({ type: z.literal("share_evidence"), evidenceId: z.string().min(1) }),
  z.object({ type: z.literal("position"), position: point }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const timings = createTimings();
  const userId = await timings.time("auth", requireUserId);
  if (typeof userId !== "string") return withPlayPerf(userId, timings, { route: "action", type: "unknown", attemptId: id });

  const parsed = actionRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return withPlayPerf(errorResponse({ code: "invalid_request", message: "Unknown action." }), timings, { route: "action", type: "unknown", attemptId: id });

  const result = await postAction({ ...playDeps(), timings }, id, userId, parsed.data);
  const response = result.ok ? publicJson({ accepted: true, refused: result.value.refused, state: result.state }) : errorResponse(result.error);
  return withPlayPerf(response, timings, { route: "action", type: parsed.data.type, attemptId: id });
}
