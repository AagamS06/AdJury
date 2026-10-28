import Link from "next/link";
import { HistoryList } from "@/components/review/history-list";
import { requireSession } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import {
  listReviewsByCompany,
  listReviewsWithScoresByCompany,
} from "@/lib/db/queries";
import { getCompanyAnalytics } from "@/lib/reviews/analytics";
import {
  buildDashboardMetrics,
  RECENT_REVIEWS_LIMIT,
  type DashboardMetric,
} from "@/lib/reviews/dashboard-view";
import { listReviewsForCompany } from "@/lib/reviews/read-reviews";

/**
 * Dashboard home (DailyPlan Day 52): the landing surface that summarises company
 * activity — key metrics (reviews run, average score, pass rate), a prominent
 * quick-submit, the most recent reviews, and shortcuts to the rest of the app.
 * This replaces the Day 4 placeholder that only confirmed who was signed in.
 *
 * Tenant-safe by construction (Rules.md §5), mirroring the history/analytics
 * pages: `requireSession()` gates the page, the company is taken from the
 * server-resolved session — never the client — and both reads go through the
 * request-scoped anon client so RLS is the primary tenancy guard. The two reads
 * reuse the Day 31/Day 6 cores (`getCompanyAnalytics`, `listReviewsForCompany`),
 * so the dashboard re-derives nothing and each read maps its own failure to a
 * plain-language message instead of crashing the page (Rules.md §6).
 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const isAdmin = session.role === "admin";

  // Re-resolve for the cores (which own the 401/500 mapping); the guard above
  // has already redirected any unauthenticated caller, so this is non-null here.
  const ctx = await getSessionContext().catch(() => null);

  // Metrics and recent reviews are independent reads — fetch them together.
  const [analyticsResult, recentResult] = await Promise.all([
    getCompanyAnalytics({
      session: ctx,
      fetch: async (companyId, opts) => {
        const db = await createServerSupabase();
        return listReviewsWithScoresByCompany(db, companyId, opts);
      },
    }),
    listReviewsForCompany({
      session: ctx,
      limit: RECENT_REVIEWS_LIMIT,
      list: async (companyId, opts) => {
        const db = await createServerSupabase();
        return listReviewsByCompany(db, companyId, opts);
      },
    }),
  ]);

  const metrics = analyticsResult.ok
    ? buildDashboardMetrics(analyticsResult.analytics)
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-body">
            Welcome back to{" "}
            <span className="font-medium text-ink">{session.company.name}</span>.
            Here&apos;s a snapshot of your content reviews.
          </p>
        </div>
        <Link
          href="/review"
          className="shrink-0 rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          New review
        </Link>
      </div>

      {/* Key metrics (Day 52): a glanceable summary of company activity. */}
      <section className="mt-8" aria-labelledby="dashboard-metrics-heading">
        <h2 id="dashboard-metrics-heading" className="sr-only">
          Key metrics
        </h2>
        {metrics ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {metrics.map((metric) => (
              <MetricTile key={metric.key} metric={metric} />
            ))}
          </div>
        ) : (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {analyticsResult.ok ? null : analyticsResult.error}
          </p>
        )}
      </section>

      {/* Recent reviews (Day 52): the newest few, linking to full history. */}
      <section className="mt-8" aria-labelledby="dashboard-recent-heading">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="dashboard-recent-heading"
            className="text-lg font-semibold text-navy"
          >
            Recent reviews
          </h2>
          {recentResult.ok && recentResult.reviews.length > 0 && (
            <Link
              href="/history"
              className="rounded-sm text-sm font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
            >
              View all
              <span className="sr-only"> reviews in history</span>
            </Link>
          )}
        </div>
        <div className="mt-4">
          {recentResult.ok ? (
            <HistoryList reviews={recentResult.reviews} />
          ) : (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {recentResult.error}
            </p>
          )}
        </div>
      </section>

      {/* Shortcuts into the rest of the app, plus admin-only management. */}
      <section className="mt-8" aria-labelledby="dashboard-shortcuts-heading">
        <h2
          id="dashboard-shortcuts-heading"
          className="text-lg font-semibold text-navy"
        >
          Explore
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ShortcutCard
            title="Submit content"
            description="Run your marketing content past the six jurors."
            href="/review"
            cta="New review"
            primary
          />
          <ShortcutCard
            title="Review history"
            description="Revisit past reviews and their scorecards."
            href="/history"
            cta="View history"
          />
          <ShortcutCard
            title="Analytics"
            description="Track how your content scores over time."
            href="/analytics"
            cta="View analytics"
          />
          <section className="rounded-md border border-border bg-surface p-5 shadow-card">
            <h3 className="text-base font-semibold text-navy">Your access</h3>
            <p className="mt-1 text-sm text-body">
              Role:{" "}
              <span className="font-medium capitalize text-ink">
                {session.role}
              </span>
            </p>
            <p className="mt-2 text-sm text-muted">
              {isAdmin
                ? "As an admin you can manage the brand profile, team, and company settings."
                : "Members can submit content and view reviews. Ask an admin for brand or team changes."}
            </p>
          </section>

          {isAdmin && (
            <section className="rounded-md border border-border bg-surface p-5 shadow-card">
              <h3 className="text-base font-semibold text-navy">
                Company management
              </h3>
              <p className="mt-1 text-sm text-muted">Admin-only surfaces.</p>
              <ul className="mt-3 space-y-1 text-sm">
                <li>
                  <Link
                    href="/brand"
                    className="font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                  >
                    Brand profile
                  </Link>
                </li>
                <li>
                  <Link
                    href="/team"
                    className="font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                  >
                    Team members
                  </Link>
                </li>
                <li>
                  <Link
                    href="/settings"
                    className="font-medium text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
                  >
                    Company settings
                  </Link>
                </li>
              </ul>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

/** One key-metric tile (reviews / average score / pass rate). */
function MetricTile({ metric }: { metric: DashboardMetric }) {
  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {metric.label}
      </p>
      <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
        {metric.value}
        {metric.suffix && (
          <span className="ml-1 text-sm font-normal text-muted">
            {metric.suffix}
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-muted">{metric.hint}</p>
    </div>
  );
}

/** A shortcut card linking into another surface of the app. */
function ShortcutCard({
  title,
  description,
  href,
  cta,
  primary = false,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
  primary?: boolean;
}) {
  return (
    <section className="rounded-md border border-border bg-surface p-5 shadow-card">
      <h3 className="text-base font-semibold text-navy">{title}</h3>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <Link
        href={href}
        className={
          primary
            ? "mt-3 inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
            : "mt-3 inline-block rounded-sm border border-border px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        }
      >
        {cta}
      </Link>
    </section>
  );
}
