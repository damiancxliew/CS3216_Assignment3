import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId, readJson } from "@/lib/play/http";
import { createAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps } from "@/lib/play/v3/http";

export const dynamic = "force-dynamic";

const CreateAttemptRequest = z.strictObject({ versionId: z.string().uuid() });

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const parsed = CreateAttemptRequest.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid attempt request." } },
      { status: 400 },
    );
  }

  const result = await createAttempt(v3PlayDeps(), userId, parsed.data.versionId);
  return NextResponse.json(result.body, { status: result.status });
}
