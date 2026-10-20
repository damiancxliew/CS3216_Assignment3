import { z } from "zod";
import { runV3BriefTurn } from "@/lib/v3/brief/service";
import { briefStreamResponse } from "@/lib/brief/stream";

export const maxDuration = 180;
const bodySchema = z.object({
  adventureId: z.string().uuid(),
  input: z.union([z.object({ text: z.string().trim().min(1).max(4000) }), z.object({ accept: z.literal(true) }), z.object({ change: z.string().max(20) })]),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });
  return briefStreamResponse((onReply) => runV3BriefTurn(parsed.data.adventureId, parsed.data.input, onReply));
}
