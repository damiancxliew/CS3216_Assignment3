import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/play/http";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { getAttempt } from "@/lib/play/v3/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const result = await getAttempt(v3PlayDeps(), userId, id);
  return NextResponse.json(result.body, { status: result.status });
}
