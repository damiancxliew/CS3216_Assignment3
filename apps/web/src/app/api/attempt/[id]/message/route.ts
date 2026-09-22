import { NextResponse } from "next/server";

import {
  messageRequestSchema,
  messageResponseSchema,
} from "@/lib/turn-api/contract";
import { AttemptNotFoundError } from "@/lib/turn-api/supabase-runtime";
import { createTurnRuntimeBackend } from "@/lib/turn-api/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = messageRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Expected { roomId, body }." } },
      { status: 400 },
    );
  }

  const backend = await createTurnRuntimeBackend();
  if (backend === null) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to access this attempt." } },
      { status: 401 },
    );
  }

  let posted;
  try {
    posted = await backend.postMessage(id, parsed.data.roomId, parsed.data.body);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      return NextResponse.json(
        { error: { code: "not_found", message: "That attempt was not found." } },
        { status: 404 },
      );
    }
    throw error;
  }
  if (!posted.ok) {
    return posted.reason === "unknown_room"
      ? NextResponse.json(
          {
            error: {
              code: "not_found",
              message: "That room is not part of this stage.",
            },
          },
          { status: 404 },
        )
      : NextResponse.json(
          {
            error: {
              code: "stage_closed",
              message: "This stage is already resolved.",
            },
          },
          { status: 409 },
        );
  }

  return NextResponse.json(
    messageResponseSchema.parse({
      accepted: true,
      newMessages: posted.newMessages,
      state: posted.state,
    }),
  );
}
