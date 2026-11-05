import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/play/http";
import { v3PreviewDeps } from "@/lib/play/v3/http";
import { previewBodyTooLarge } from "@/lib/play/v3/preview-body";
import { previewCheck } from "@/lib/play/v3/preview";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ adventureId: string }> },
) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;
  const { adventureId } = await params;
  const text = await request.text();
  if (previewBodyTooLarge(text)) {
    return NextResponse.json(
      { error: { code: "too_large", message: "Request body is too large." } },
      { status: 413 },
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Invalid request body." } },
      { status: 400 },
    );
  }

  const result = await previewCheck(v3PreviewDeps(), userId, adventureId, body);
  return NextResponse.json(result.body, { status: result.status });
}
