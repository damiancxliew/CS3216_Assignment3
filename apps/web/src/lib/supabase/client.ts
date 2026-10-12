import { createBrowserClient } from "@supabase/ssr";

import { createDataApiProxy } from "./data-api";

export function createClient() {
  const authClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  return createDataApiProxy(authClient, {
    url: process.env.NEXT_PUBLIC_DATA_URL,
    key: process.env.NEXT_PUBLIC_DATA_ANON_KEY,
    keyName: "NEXT_PUBLIC_DATA_ANON_KEY",
    accessToken: async () => (await authClient.auth.getSession()).data.session?.access_token ?? null,
  });
}
