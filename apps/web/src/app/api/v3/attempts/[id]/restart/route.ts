import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/play/http";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { restartAttempt } from "@/lib/play/v3/service";
import { v3Enabled } from "@/lib/v3/flag";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!v3Enabled()) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }

  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const result = await restartAttempt(v3PlayDeps(), userId, id);
  return NextResponse.json(result.body, { status: result.status });
}
