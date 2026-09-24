import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Upper bound on one call to Supabase Auth, and on the refresh as a whole. */
const AUTH_FETCH_TIMEOUT_MS = 2_500;
const AUTH_REFRESH_TIMEOUT_MS = 5_000;

/**
 * Refreshes the auth cookie on every navigation. Without this a Server
 * Component sees an expired session and a signed-in student looks anonymous.
 *
 * The refresh is best-effort: Supabase Auth being slow or unreachable must not
 * hold the navigation open, so the request continues with the cookies it came
 * with rather than timing out the middleware.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_FETCH_TIMEOUT_MS) }),
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await Promise.race([
      supabase.auth.getUser(),
      new Promise((resolve) => setTimeout(resolve, AUTH_REFRESH_TIMEOUT_MS)),
    ]);
  } catch {
    // Leave the incoming session cookies alone and let the page render.
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
