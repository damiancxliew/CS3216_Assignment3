import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/auth/request-origin";
import { createAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps } from "@/lib/play/v3/http";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ adventureId: string }> }) {
  if (!v3Enabled()) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
  const origin = requestOrigin(request);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { adventureId } = await params;
  const release = new URL(request.url).searchParams.get("release") ?? undefined;
  if (!user) return NextResponse.redirect(new URL(`/v3/join/${encodeURIComponent(adventureId)}${release ? `?release=${encodeURIComponent(release)}` : ""}`, origin));

  const result = await createAttempt(v3PlayDeps(), user.id, adventureId, release);
  if (result.status === 201 || result.status === 200) {
    const body = result.body as { attemptId: string };
    return NextResponse.redirect(new URL(`/v3/play/${body.attemptId}`, origin));
  }
  if (result.status === 404) return new Response("Not found.", { status: 404 });
  return new Response("This adventure is not open for play.", { status: 409 });
}
