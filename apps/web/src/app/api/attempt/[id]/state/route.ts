import { NextResponse } from "next/server";

import { publicAttemptStateSchema } from "@/lib/turn-api/contract";
import { AttemptNotFoundError } from "@/lib/turn-api/supabase-runtime";
import { createTurnRuntimeBackend } from "@/lib/turn-api/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const backend = await createTurnRuntimeBackend();
  if (backend === null) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in to access this attempt." } },
      { status: 401 },
    );
  }

  try {
    const state = publicAttemptStateSchema.parse(await backend.getState(id));
    return NextResponse.json(state);
  } catch (error) {
    if (error instanceof AttemptNotFoundError) {
      return NextResponse.json(
        { error: { code: "not_found", message: "That attempt was not found." } },
        { status: 404 },
      );
    }
    throw error;
  }
}
