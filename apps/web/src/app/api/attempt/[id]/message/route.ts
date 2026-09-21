import { NextResponse } from "next/server";

import {
  messageRequestSchema,
  messageResponseSchema,
} from "@/lib/turn-api/contract";
import { stubPostMessage } from "@/lib/turn-api/stub";

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

  const posted = stubPostMessage(id, parsed.data.roomId, parsed.data.body);
  if (!posted) {
    return NextResponse.json(
      {
        error: {
          code: "not_found",
          message: "That room is not part of this stage.",
        },
      },
      { status: 404 },
    );
  }
  const { newMessages, state } = posted;

  return NextResponse.json(
    messageResponseSchema.parse({ accepted: true, newMessages, state }),
  );
}
