import { getCompanyById, getUserById } from "@/lib/db/queries";
import type { CompanyRow, UserRole } from "@/types/db";
import { createServerSupabase } from "./supabase-server";

/**
 * Server-side session helper (DailyPlan Day 3).
 *
 * Resolves the authenticated Supabase user into AdJury's app-level context:
 * which company they belong to and their role. Everything tenant-scoped derives
 * `companyId` from HERE — the server session — never from client input
 * (Rules.md §5). Reads go through the request-scoped anon client, so RLS also
 * constrains them to the caller's own company.
 *
 * Returns null when there is no session, or when the user is authenticated but
 * not yet provisioned (no `users` row) — callers treat both as "not signed in".
 */
export interface SessionContext {
  authUserId: string;
  email: string;
  companyId: string;
  role: UserRole;
  company: CompanyRow;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const userRow = await getUserById(supabase, user.id);
  if (!userRow) return null;

  const company = await getCompanyById(supabase, userRow.company_id);
  if (!company) return null;

  return {
    authUserId: user.id,
    email: userRow.email,
    companyId: userRow.company_id,
    role: userRow.role,
    company,
  };
}
