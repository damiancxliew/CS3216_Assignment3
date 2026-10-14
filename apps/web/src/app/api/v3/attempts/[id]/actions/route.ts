import { after, NextResponse } from "next/server";

import { requireUserId, readJson } from "@/lib/play/http";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { postAction, runPostTurnChecks } from "@/lib/play/v3/service";
import { v3Enabled } from "@/lib/v3/flag";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!v3Enabled()) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }

  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { id } = await params;
  const deps = v3PlayDeps();
  const result = await postAction(deps, userId, id, await readJson(request));
  const pending = result.body.pendingCheckIds;
  if (result.status === 200 && Array.isArray(pending) && pending.length > 0) {
    after(async () => {
      await runPostTurnChecks(deps, id, pending);
    });
  }
  return NextResponse.json(result.body, { status: result.status });
}
