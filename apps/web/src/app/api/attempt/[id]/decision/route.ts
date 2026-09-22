import { NextResponse } from "next/server";

import {
  decisionRequestSchema,
  decisionResponseSchema,
} from "@/lib/turn-api/contract";
import { commitRuntimeDecision } from "@/lib/turn-api/runtime";

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

  // Options are re-derived from state, so an option that was valid earlier is
  // rejected rather than executed (FR-14).
  const result = await commitRuntimeDecision(id, parsed.data.optionId);
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
