import { z } from "zod";
import { createGuestSession } from "@/lib/auth/guest";
import { NextResponse } from "next/server";

import { requestOrigin } from "@/lib/auth/request-origin";
import { loadJoinView } from "@/lib/play/v3/publish";
import { createAttempt } from "@/lib/play/v3/service";
import { v3PlayDeps, v3PublishDeps } from "@/lib/play/v3/http";
import { createClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/v3/flag";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  if (!v3Enabled()) {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
  const origin = requestOrigin(request);
  const supabase = await createClient();
  let { data: { user } } = await supabase.auth.getUser();
  const { versionId } = await params;
  if (!z.string().uuid().safeParse(versionId).success) return new Response("Not found.", { status: 404 });
  // A public version starts a guest session instead of asking for sign-in.
  if (!user && (await loadJoinView(v3PublishDeps(), null, versionId)).kind === "ready") {
    const guest = await createGuestSession(supabase);
    if (!guest) return new Response("Could not start guest play. Please try again.", { status: 503 });
    user = guest;
  }
  if (!user) return NextResponse.redirect(new URL(`/v3/join/${encodeURIComponent(versionId)}`, origin));

  const result = await createAttempt(v3PlayDeps(), user.id, versionId);
  if (result.status === 201 || result.status === 200) {
    const body = result.body as { attemptId: string };
    return NextResponse.redirect(new URL(`/v3/play/${body.attemptId}`, origin));
  }
  if (result.status === 404) return new Response("Not found.", { status: 404 });
  return new Response("This adventure is not open for play.", { status: 409 });
}
