import { NextResponse } from "next/server";

import {
  decisionRequestSchema,
  decisionResponseSchema,
} from "@/lib/turn-api/contract";
import { AttemptNotFoundError } from "@/lib/turn-api/supabase-runtime";
import { createTurnRuntimeBackend } from "@/lib/turn-api/service";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = decisionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Expected { optionId }." } },
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

  let result;
  try {
    result = await backend.commitDecision(id, parsed.data.optionId);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      return NextResponse.json(
        { error: { code: "not_found", message: "That attempt was not found." } },
        { status: 404 },
      );
    }
    throw error;
  }
  if (!result) {
    return NextResponse.json(
      {
        error: {
          code: "stale_option",
          message: "That option is no longer available.",
        },
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    decisionResponseSchema.parse({ accepted: true, ...result }),
  );
}
