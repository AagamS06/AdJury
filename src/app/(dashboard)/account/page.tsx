import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { getUserById } from "@/lib/db/queries";
import { roleLabel } from "@/lib/company/team-view";
import { resolveNotificationPrefs } from "@/lib/user/profile";
import { UserSettingsForm } from "@/components/user/user-settings-form";
import { NotificationPreferencesForm } from "@/components/user/notification-preferences-form";
import { AccountSecurityForms } from "@/components/user/account-security-form";

/**
 * User (account) settings — DailyPlan Day 51. Any signed-in user manages their
 * own account here, the personal counterpart to the admin-only company `/settings`
 * page (Day 50). Part 1 shipped the profile (display name); Part 2 adds
 * notification preferences and the credential changes (password / email).
 *
 * Tenant-safe by construction (Rules.md §5): `requireSession()` gates the page
 * server-side (an anonymous caller → `/login`), and everything shown/saved is the
 * server-resolved session user — never the client. The user's own row is read
 * through the request-scoped (RLS-guarded) client for the fields the session
 * doesn't carry (notification preferences); each save re-derives the caller and
 * writes scoped to their own id.
 */
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireSession();

  // Read the user's own row for the fields the session doesn't carry
  // (notification preferences). RLS scopes this to the caller; if it comes back
  // empty for any reason, the pure resolver fills in the documented defaults.
  const db = await createServerSupabase();
  const userRow = await getUserById(db, session.authUserId).catch(() => null);
  const notificationPrefs = resolveNotificationPrefs(userRow ?? {});
  const displayName = userRow?.display_name ?? session.displayName ?? null;

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Account</h1>
      <p className="mt-2 max-w-2xl text-body">
        Manage your personal profile, notifications, and sign-in details.
      </p>

      {/* Profile (display name) */}
      <section className="mt-8 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Profile</h2>
        <div className="mt-4 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <UserSettingsForm displayName={displayName} />
        </div>
      </section>

      {/* Notification preferences */}
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Notifications</h2>
        <p className="mt-1 max-w-2xl text-sm text-body">
          Choose which emails AdJury sends you.
        </p>
        <div className="mt-4 rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <NotificationPreferencesForm prefs={notificationPrefs} />
        </div>
      </section>

      {/* Security (password + email) */}
      <section className="mt-10 max-w-3xl">
        <h2 className="text-xl font-bold text-ink">Security</h2>
        <p className="mt-1 max-w-2xl text-sm text-body">
          Update your password or the email address you sign in with.
        </p>
        <div className="mt-4">
          <AccountSecurityForms email={session.email} />
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
