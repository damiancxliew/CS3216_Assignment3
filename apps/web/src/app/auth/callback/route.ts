import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/** OAuth redirect target: trades the code for a session cookie. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // Only same-origin paths, so a share link cannot bounce a signed-in student
  // off to someone else's site.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) {
    return NextResponse.redirect(new URL("/?error=auth", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/?error=auth", url.origin));
  }

  return NextResponse.redirect(new URL(destination, url.origin));
}
