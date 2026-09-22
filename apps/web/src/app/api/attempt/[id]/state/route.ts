import { errorResponse, playDeps, publicJson, requireUserId } from "@/lib/play/http";
import { getState } from "@/lib/play/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const result = await getState(playDeps(), id, userId);
  if (!result.ok) return errorResponse(result.error);
  return publicJson(result.state);
}
