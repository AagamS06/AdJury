import { redirect } from "next/navigation";
import { PrimaryNav } from "@/components/ui/primary-nav";
import { MAIN_CONTENT_ID } from "@/lib/ui/a11y";
import { signOutAction } from "@/lib/auth/actions";
import { requireSession } from "@/lib/auth/guard";
import { needsOnboarding } from "@/lib/company/onboarding";

/**
 * Dashboard shell (DailyPlan Day 4 — role-based access; Day 54 — nav/IA).
 *
 * Gates the entire `(dashboard)` route group: `requireSession()` redirects any
 * unauthenticated caller to `/login` before a protected page renders (this is
 * the authoritative server-side gate; the middleware does a coarse first pass).
 * Admin-only surfaces (brand, team) additionally call `requireAdmin()` in their
 * own page, so a member who reaches this layout still cannot see them — and the
 * nav only shows those links to admins.
 *
 * The primary nav itself is the `PrimaryNav` client island (Day 54): its
 * structure and active-route logic live in the pure `lib/ui/nav.ts` core, so the
 * shell stays a server component while the nav can highlight the current page.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  // First-admin onboarding gate (Day 22): guide an admin whose company hasn't
  // been set up into `/onboarding` (a standalone route, so no redirect loop).
  // Members are never redirected — their admin onboards the company; the app
  // still works with the name set at signup.
  if (isAdmin && needsOnboarding(session.company)) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <PrimaryNav role={session.role} />

          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">
              {session.company.name} ·{" "}
              <span className="font-medium capitalize text-body">
                {session.role}
              </span>
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-sm border border-border px-3 py-1.5 font-semibold text-navy hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} className="mx-auto max-w-5xl px-6 py-10">
        {children}
      </main>
    </div>
  );
}
