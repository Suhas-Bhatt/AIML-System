import { createBrowserClient } from "@supabase/ssr";

let client = null;

/**
 * Browser-side Supabase client (singleton).
 * Uses the anon key — all queries go through RLS.
 */
export function createClient() {
  if (client) return client;

  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        // Bypass navigator.locks to prevent AbortError on public pages
        lock: (
          _name,
          _acquireTimeout,
          fn,
        ) => fn(),
      },
    },
  );

  return client;
}
