import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createDataApiProxy } from "./data-api";

/**
 * Service-role client: bypasses RLS, so it is only ever constructed inside a
 * server action or route handler that has already checked who is asking.
 * Authoring content is server-written by design — clients hold SELECT only.
 */
export function createAdminClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");

  const noStoreFetch: typeof fetch = (input, init) => fetch(input, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? new AbortController().signal,
  });
  const authClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: noStoreFetch },
  });

  return createDataApiProxy(authClient, {
    url: process.env.NEXT_PUBLIC_DATA_URL,
    key: process.env.DATA_SERVICE_ROLE_KEY,
    keyName: "DATA_SERVICE_ROLE_KEY",
    globalFetch: noStoreFetch,
  });
}
