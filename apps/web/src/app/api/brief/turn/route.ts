import { z } from "zod";
import { briefStateSchema } from "@/lib/brief/schema";
import { runStreamingBriefTurn } from "@/lib/brief/service";
import { briefStreamResponse } from "@/lib/brief/stream";

export const maxDuration = 180;
const bodySchema = z.object({
  state: briefStateSchema,
  input: z.union([z.object({ text: z.string().trim().min(1).max(4000) }), z.object({ accept: z.literal(true) }), z.object({ change: z.string().max(20) })]),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message" }, { status: 400 });
  return briefStreamResponse((onReply) => runStreamingBriefTurn(parsed.data.state, parsed.data.input, onReply));
}
