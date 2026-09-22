import { z } from "zod";

import { errorResponse, playDeps, publicJson, readJson, requireUserId } from "@/lib/play/http";
import { postAction } from "@/lib/play/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const point = z.object({ x: z.number().int(), y: z.number().int() });

/**
 * Player world actions beyond speech and the decision: the allow-listed
 * movement and door actions (FR-20), examining evidence in the room, and
 * reporting the tile the client is standing on so a resume redraws it. The
 * server owns room membership; the client owns the walk between tiles.
 */
const actionRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move_room"), toRoomId: z.string().min(1), position: point.optional() }),
  z.object({ type: z.literal("open_door"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("close_door"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("knock"), roomId: z.string().min(1) }),
  z.object({ type: z.literal("inspect"), evidenceId: z.string().min(1) }),
  z.object({ type: z.literal("position"), position: point }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const parsed = actionRequestSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse({ code: "invalid_request", message: "Unknown action." });

  const result = await postAction(playDeps(), id, userId, parsed.data);
  if (!result.ok) return errorResponse(result.error);
  return publicJson({ accepted: true, refused: result.value.refused, state: result.state });
}
