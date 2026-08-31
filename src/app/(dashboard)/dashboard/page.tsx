import { requireSession } from "@/lib/auth/guard";

/**
 * Dashboard home (DailyPlan Day 4). Any authenticated, provisioned user may see
 * this. The full landing dashboard (recent reviews, quick-submit, metrics) is
 * Day 52; for now it confirms who is signed in and, for admins, points at the
 * company-management surfaces. `requireSession()` re-checks server-side even
 * though the layout already gated the group — protected pages fail closed on
 * their own (Rules.md §6).
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Dashboard</h1>
      <p className="mt-2 text-body">
        Signed in as{" "}
        <span className="font-medium text-ink">{session.email}</span> at{" "}
        <span className="font-medium text-ink">{session.company.name}</span>.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <h2 className="text-lg font-semibold text-navy">Your access</h2>
          <p className="mt-1 text-sm text-body">
            Role:{" "}
            <span className="font-medium capitalize text-ink">
              {session.role}
            </span>
          </p>
          <p className="mt-2 text-sm text-muted">
            {isAdmin
              ? "As an admin you can manage the brand profile and your team."
              : "Members can submit content and view reviews. Ask an admin for brand or team changes."}
          </p>
        </section>

        {isAdmin && (
          <section className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
            <h2 className="text-lg font-semibold text-navy">Company management</h2>
            <p className="mt-1 text-sm text-muted">Admin-only surfaces.</p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>
                <a
                  href="/brand"
                  className="font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                >
                  Brand profile
                </a>
              </li>
              <li>
                <a
                  href="/team"
                  className="font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                >
                  Team members
                </a>
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
