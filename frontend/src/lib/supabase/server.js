import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

async function fetchWithRetry(
  url,
  init,
) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Server-side Supabase client that uses cookies for auth.
 * Call this in Server Components, Route Handlers, and Server Actions.
 */
export async function createClient() {
  return createServerClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      cookies: {
        async getAll() {
          return (await cookies()).getAll();
        },
        async setAll(cookiesToSet) {
          try {
            const store = await cookies();
            cookiesToSet.forEach(({ name, value, options }) =>
              store.set(name, value, options),
            );
          } catch {
            // setAll can throw in Server Components.
          }
        },
      },
      global: {
        fetch: fetchWithRetry,
      },
    },
  );
}
