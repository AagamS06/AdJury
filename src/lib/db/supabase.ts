import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase clients. Two factories:
 *  - browserClient(): anon key, safe for the client; RLS enforces tenancy.
 *  - serverClient(): service-role key, SERVER ONLY. Never import into a
 *    client component (Rules.md §4).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function browserClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

export function serverClient(): SupabaseClient {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}
