import type { SupabaseClient } from "@supabase/supabase-js";
import { insertCompany, insertUser } from "@/lib/db/queries";
import type { CompanyRow, UserRow } from "@/types/db";

/**
 * Signup provisioning: a brand-new user gets their own company and becomes its
 * first admin (DailyPlan Day 3).
 *
 * MUST run with a service-role client (`serverClient()` from
 * `@/lib/db/supabase`): RLS only exposes rows once `auth_company_id()` can
 * resolve the caller's company from an existing `users` row, so the first
 * company + admin row cannot be written under the anon session — they bootstrap
 * that state. Because it bypasses RLS, the caller passes an explicit `userId`
 * (the freshly created `auth.users` id) — never a client-supplied one
 * (Rules.md §5).
 *
 * The two inserts are not a real transaction, so if the admin-user insert fails
 * the just-created company is deleted to avoid orphaning a company with no users
 * (Rules.md §6 — DB write failure: don't leave partial state).
 */
export interface ProvisionParams {
  /** The `auth.users` id returned by Supabase signUp. */
  userId: string;
  email: string;
  companyName: string;
  industry?: string | null;
}

export async function provisionCompanyForNewUser(
  admin: SupabaseClient,
  params: ProvisionParams,
): Promise<{ company: CompanyRow; user: UserRow }> {
  const company = await insertCompany(admin, {
    name: params.companyName,
    industry: params.industry ?? null,
  });

  try {
    const user = await insertUser(admin, {
      id: params.userId,
      company_id: company.id,
      email: params.email,
      role: "admin",
    });
    return { company, user };
  } catch (err) {
    // Roll back the orphaned company before re-throwing so signup can be retried.
    await admin.from("companies").delete().eq("id", company.id);
    throw err;
  }
}
