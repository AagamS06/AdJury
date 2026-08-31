import { requireAdmin } from "@/lib/auth/guard";

/**
 * Brand profile — admin only (DailyPlan Day 4 gate; CRUD lands Day 26).
 *
 * `requireAdmin()` enforces the role server-side: a member is redirected to the
 * dashboard, an anonymous caller to `/login`. This is the real guard — the nav
 * simply hides the link from members; the authorization is here, not in the UI
 * (Rules.md §5).
 */
export default async function BrandPage() {
  const session = await requireAdmin();

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Brand profile</h1>
      <p className="mt-2 text-body">
        Manage {session.company.name}&apos;s tone &amp; style guide. Juror 1
        (Brand Voice Guardian) reviews content against it.
      </p>
      <div className="mt-8 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <p className="text-sm text-muted">
          The brand profile editor arrives on Day 26. This admin-only route is
          gated and ready.
        </p>
      </div>
    </div>
  );
}
