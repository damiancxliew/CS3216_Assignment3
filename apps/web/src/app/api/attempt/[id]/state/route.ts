import { NextResponse } from "next/server";

import { publicAttemptStateSchema } from "@/lib/turn-api/contract";
import { stubState } from "@/lib/turn-api/stub";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = publicAttemptStateSchema.parse(stubState(id));
  return NextResponse.json(state);
}
