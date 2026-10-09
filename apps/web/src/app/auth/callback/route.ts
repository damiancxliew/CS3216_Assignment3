import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/safe-next";
import { getViewer, isStaff } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

/** OAuth redirect target: trades the code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // Only same-origin paths, so a share link cannot bounce a signed-in student
  // off to someone else's site.
  const destination = safeNextPath(next, url.origin);

  if (!code) {
    return NextResponse.redirect(new URL("/?error=auth", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/?error=auth", url.origin));
  }

  const { error: claimError } = await supabase.rpc("claim_staff_invites");
  if (claimError) console.error("could not claim staff invitations after sign-in", claimError);

  let target = destination;
  if (!next || destination === "/") {
    const viewer = await getViewer(supabase);
    target = isStaff(viewer)
      ? "/teacher"
      : viewer.membership?.role === "student"
        ? "/library"
        : "/";
  }

  return NextResponse.redirect(new URL(target, url.origin));
}
