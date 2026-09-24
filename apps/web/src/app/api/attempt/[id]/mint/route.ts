import { errorResponse, playDeps, publicJson, requireUserId } from "@/lib/play/http";
import { postMintOptions } from "@/lib/play/service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  if (typeof userId !== "string") return userId;

  const result = await postMintOptions(playDeps(), id, userId);
  if (!result.ok) return errorResponse(result.error);
  return publicJson({ accepted: true, state: result.state });
}
