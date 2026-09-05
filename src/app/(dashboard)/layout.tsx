import Link from "next/link";
import { signOutAction } from "@/lib/auth/actions";
import { requireSession } from "@/lib/auth/guard";

/**
 * Dashboard shell (DailyPlan Day 4 — role-based access).
 *
 * Gates the entire `(dashboard)` route group: `requireSession()` redirects any
 * unauthenticated caller to `/login` before a protected page renders (this is
 * the authoritative server-side gate; the middleware does a coarse first pass).
 * Admin-only surfaces (brand, team) additionally call `requireAdmin()` in their
 * own page, so a member who reaches this layout still cannot see them — and the
 * nav only shows those links to admins.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <nav
            aria-label="Primary"
            className="flex items-center gap-1 text-sm font-medium"
          >
            <Link
              href="/dashboard"
              className="rounded-sm px-2 py-1.5 font-semibold uppercase tracking-wide text-royal hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              AdJury
            </Link>
            <NavLink href="/dashboard">Dashboard</NavLink>
            <NavLink href="/review">New review</NavLink>
            {isAdmin && <NavLink href="/brand">Brand</NavLink>}
            {isAdmin && <NavLink href="/team">Team</NavLink>}
          </nav>

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

      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-sm px-2 py-1.5 text-body hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
    >
      {children}
    </Link>
  );
}
