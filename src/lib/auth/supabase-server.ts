import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Request-scoped Supabase client for Server Components, Server Actions, and
 * Route Handlers (anon key, session read from cookies).
 *
 * Reads/writes the session cookies via Next's cookie store so the authenticated
 * user is resolved server-side and RLS applies (Architecture.md §3). This is the
 * anon-key client — reads are constrained by RLS to the caller's own company.
 * For the privileged signup provisioning path use `serverClient()` (service
 * role) from `@/lib/db/supabase` instead (Rules.md §4, §5).
 */

function requiredPublic(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export async function createServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    requiredPublic("NEXT_PUBLIC_SUPABASE_URL"),
    requiredPublic("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `set` throws when called from a Server Component (cookies are
            // read-only there). The session refresh in middleware.ts writes the
            // refreshed cookies instead, so this is safe to ignore.
          }
        },
      },
    },
  );
}
