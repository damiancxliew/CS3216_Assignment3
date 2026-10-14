import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId, readJson } from "@/lib/play/http";
import { createAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { v3Enabled } from "@/lib/v3/flag";

export const dynamic = "force-dynamic";

const CreateAttemptRequest = z.strictObject({ adventureId: z.string().uuid() });

export async function POST(request: Request) {
  if (!v3Enabled()) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }

  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const parsed = CreateAttemptRequest.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid attempt request." } },
      { status: 400 },
    );
  }

  const result = await createAttempt(v3PlayDeps(), userId, parsed.data.adventureId);
  return NextResponse.json(result.body, { status: result.status });
}
