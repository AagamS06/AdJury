import { requireAdmin } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { listUsersByCompany } from "@/lib/db/queries";
import { getTeamForCompany } from "@/lib/company/read-team";
import { TeamList, TeamSummaryLine } from "@/components/company/team-list";

/**
 * Team management page (DailyPlan Day 23): an admin view of the company's
 * members and their roles.
 *
 * Tenant-safe by construction (Rules.md §5): `requireAdmin()` gates the page
 * server-side (an anonymous caller → `/login`, a member → `/dashboard`), and the
 * company is taken from the server-resolved session — never the client — and
 * passed explicitly to `listUsersByCompany`. The read goes through the
 * request-scoped anon client so RLS is the primary tenancy guard, mirroring the
 * Day 11 history page. `getTeamForCompany` re-checks the admin role as
 * defense-in-depth. A load failure surfaces a plain-language message rather than
 * crashing (Rules.md §6). Role management (promote/demote) is Day 25.
 */
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await requireAdmin();

  // Re-resolve for the core (which owns the 401/403/500 mapping); the guard
  // above has already redirected any non-admin, so this is a non-null admin here.
  const resolved = await getSessionContext().catch(() => null);

  const result = await getTeamForCompany({
    session: resolved,
    list: async (companyId) => {
      const db = await createServerSupabase();
      return listUsersByCompany(db, companyId);
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Team</h1>
          <p className="mt-2 max-w-2xl text-body">
            Everyone at {session.company.name} who can submit and review content.
          </p>
        </div>
        {result.ok && result.members.length > 0 && (
          <p className="shrink-0 text-sm text-muted">
            <TeamSummaryLine members={result.members} />
          </p>
        )}
      </div>

      <div className="mt-8">
        {result.ok ? (
          <TeamList
            members={result.members}
            currentUserId={session.authUserId}
          />
        ) : (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {result.error}
          </p>
        )}
      </div>

      <p className="mt-6 text-sm text-muted">
        Inviting new members and changing roles arrive next (Days 24–25).
      </p>
    </div>
  );
}
