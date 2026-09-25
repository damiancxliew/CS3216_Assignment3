import { errorResponse, playDeps, publicJson, requireUserId, withPlayPerf } from "@/lib/play/http";
import { getState } from "@/lib/play/service";
import { createTimings } from "@/lib/play/timing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const timings = createTimings();
  const userId = await timings.time("auth", requireUserId);
  if (typeof userId !== "string") return withPlayPerf(userId, timings, { route: "state", attemptId: id });

  const result = await getState({ ...playDeps(id), timings }, id, userId);
  const response = result.ok ? publicJson(result.state) : errorResponse(result.error);
  return withPlayPerf(response, timings, { route: "state", attemptId: id });
}
