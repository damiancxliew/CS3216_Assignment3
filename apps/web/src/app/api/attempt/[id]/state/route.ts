import { NextResponse } from "next/server";

import { publicAttemptStateSchema } from "@/lib/turn-api/contract";
import { runtimeState } from "@/lib/turn-api/runtime";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = publicAttemptStateSchema.parse(await runtimeState(id));
  return NextResponse.json(state);
}
