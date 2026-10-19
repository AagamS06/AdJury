import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { roleLabel } from "@/lib/company/team-view";
import { UserSettingsForm } from "@/components/user/user-settings-form";

/**
 * User (account) settings — DailyPlan Day 51. Any signed-in user manages their
 * own profile here: today that's the display name (how they're shown across the
 * app), which saves and persists. Email, role, and company are shown read-only —
 * email is a Supabase Auth identity and role is changed only by an admin via team
 * management (Day 25). This is the *personal* counterpart to the admin-only
 * company `/settings` page (Day 50).
 *
 * Tenant-safe by construction (Rules.md §5): `requireSession()` gates the page
 * server-side (an anonymous caller → `/login`), and everything shown/saved is the
 * server-resolved session user — never the client. The save (in the form's
 * action) re-derives the caller and writes scoped to their own id + company id.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Account</h1>
      <p className="mt-2 max-w-2xl text-body">
        Manage your personal profile and account details.
      </p>

      {/* Profile (the editable setting) */}
      <section className="mt-8 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Profile</h2>
        <div className="mt-4 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <UserSettingsForm displayName={session.displayName ?? null} />
        </div>
      </section>

      {/* Account details (read-only summary) */}
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Account details</h2>
        <div className="mt-4 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted">Email</dt>
              <dd className="mt-0.5 truncate font-medium text-body">
                {session.email}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Role</dt>
              <dd className="mt-0.5 font-medium text-body">
                {roleLabel(session.role)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Company</dt>
              <dd className="mt-0.5 truncate font-medium text-body">
                {session.company.name}
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-sm text-muted">
            Your role is managed by an admin on the{" "}
            <Link
              href="/team"
              className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              team page
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
