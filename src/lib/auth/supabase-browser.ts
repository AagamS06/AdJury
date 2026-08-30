import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client for auth (anon key, cookie-based session).
 *
 * Uses `@supabase/ssr` so the session is stored in cookies the server can read
 * (see supabase-server.ts and middleware.ts) rather than localStorage — this is
 * what lets a Supabase session persist across server renders. RLS still enforces
 * tenancy on every read (Architecture.md §3). Safe to import into client
 * components; never carries the service-role key (Rules.md §4).
 */

function requiredPublic(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function createBrowserSupabase(): SupabaseClient {
  return createBrowserClient(
    requiredPublic("NEXT_PUBLIC_SUPABASE_URL"),
    requiredPublic("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
