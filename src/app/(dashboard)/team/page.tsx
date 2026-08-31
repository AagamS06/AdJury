import { requireAdmin } from "@/lib/auth/guard";

/**
 * Team management — admin only (DailyPlan Day 4 gate; UI lands Day 23).
 *
 * Same server-side role enforcement as the brand route via `requireAdmin()`.
 */
export default async function TeamPage() {
  const session = await requireAdmin();

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Team</h1>
      <p className="mt-2 text-body">
        Manage who at {session.company.name} can submit and review content.
      </p>
      <div className="mt-8 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <p className="text-sm text-muted">
          Team management arrives on Day 23. This admin-only route is gated and
          ready.
        </p>
      </div>
    </div>
  );
}
