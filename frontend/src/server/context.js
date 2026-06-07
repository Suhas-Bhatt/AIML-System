import { supabaseAdmin } from '../lib/supabase/admin.js';
import { createClient } from '../lib/supabase/server.js';
import { headers } from "next/headers";

export async function createContext() {
  const serverClient = await createClient();

  let user = null;
  try {
    const { data } = await serverClient.auth.getUser();
    user = data.user;
  } catch {
    // Suppress auth errors (e.g., invalid cookies on public pages)
  }

  if (!user) {
    try {
      const authorization = headers().get("authorization");
      if (authorization?.startsWith("Bearer ")) {
        const { data } = await serverClient.auth.getUser(
          authorization.slice(7),
        );
        user = data.user;
      }
    } catch {
      // Suppress Bearer token errors
    }
  }

  return {
    user,
    supabase: supabaseAdmin,
  };
}
