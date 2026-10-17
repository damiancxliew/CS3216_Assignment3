import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type DataApiOptions = {
  url: string | undefined;
  key: string | undefined;
  keyName: string;
  accessToken?: () => Promise<string | null>;
  globalFetch?: typeof fetch;
};

const DATA_METHODS = new Set(["from", "rpc", "schema"]);

export function createDataApiProxy(authClient: SupabaseClient, options: DataApiOptions): SupabaseClient {
  if (!options.url) return authClient;
  if (!options.key) throw new Error(`${options.keyName} is required when NEXT_PUBLIC_DATA_URL is set`);

  const dataClient = createClient(options.url, options.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
    ...(options.globalFetch ? { global: { fetch: options.globalFetch } } : {}),
  });

  return new Proxy(authClient, {
    get(target, property) {
      const source = typeof property === "string" && DATA_METHODS.has(property) ? dataClient : target;
      const value = Reflect.get(source, property, source);
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}
