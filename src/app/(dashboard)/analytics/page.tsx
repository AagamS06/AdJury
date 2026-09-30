import Link from "next/link";
import { JurorBreakdown } from "@/components/review/juror-breakdown";
import { ScoreTrendChart } from "@/components/review/score-trend-chart";
import { PILL_CLASSES } from "@/components/review/tone-classes";
import { requireSession } from "@/lib/auth/guard";
import { getSessionContext } from "@/lib/auth/session";
import { createServerSupabase } from "@/lib/auth/supabase-server";
import { listReviewsWithScoresByCompany } from "@/lib/db/queries";
import { getCompanyAnalytics, type CompanyAnalytics } from "@/lib/reviews/analytics";
import { verdictShares } from "@/lib/reviews/analytics-view";
import { formatAggregate } from "@/lib/reviews/scorecard-view";

/**
 * Analytics dashboard (DailyPlan Day 32): the company's score trend over time,
 * plus supporting window-wide summary tiles (total reviews, overall average,
 * verdict distribution). All from the Day 31 data layer.
 *
 * Tenant-safe by construction (Rules.md §5), mirroring the history page:
 * `requireSession()` gates the page and the company is taken from the
 * server-resolved session — never the client — and passed to the query by the
 * `getCompanyAnalytics` core (which owns the 401/500 mapping). The read goes
 * through the request-scoped anon client so RLS is the primary tenancy guard on
 * both `reviews` and `persona_scores`. A load failure surfaces a plain-language
 * message rather than crashing (Rules.md §6).
 *
 * Scope (Day 32): the score-trend chart + summary. The per-juror drill-down is
 * Day 33; the richer empty/low-data and loading/error states are Day 34 — this
 * page ships only a basic empty note and inline error for now.
 */
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireSession();

  // Re-resolve for the core (which owns the 401/500 mapping); the guard above
  // has already redirected any unauthenticated caller, so this is non-null here.
  const session = await getSessionContext().catch(() => null);

  const result = await getCompanyAnalytics({
    session,
    fetch: async (companyId, opts) => {
      const db = await createServerSupabase();
      return listReviewsWithScoresByCompany(db, companyId, opts);
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Analytics</h1>
          <p className="mt-2 max-w-2xl text-body">
            How your content is scoring over time, across every review your
            company has run.
          </p>
        </div>
        <Link
          href="/review"
          className="shrink-0 rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          New review
        </Link>
      </div>

      {!result.ok ? (
        <p
          role="alert"
          className="mt-8 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
        >
          {result.error}
        </p>
      ) : (
        <AnalyticsBody analytics={result.analytics} />
      )}
    </div>
  );
}

function AnalyticsBody({ analytics }: { analytics: CompanyAnalytics }) {
  const {
    totalReviews,
    overallAverageScore,
    verdictDistribution,
    scoreTrend,
    jurorTrends,
  } = analytics;
  const shares = verdictShares(verdictDistribution);

  if (totalReviews === 0) {
    return (
      <div className="mt-8 rounded-md border border-border bg-surface p-8 text-center shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <h2 className="text-lg font-semibold text-navy">No analytics yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Run a review and your score trend and verdict mix will start to appear
          here.
        </p>
        <Link
          href="/review"
          className="mt-4 inline-block rounded-sm bg-royal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          Run your first review
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Reviews" value={String(totalReviews)} />
        <StatTile
          label="Average score"
          value={formatAggregate(overallAverageScore)}
          suffix={overallAverageScore === null ? undefined : "/ 10"}
        />
        {shares.map((share) => (
          <div
            key={share.verdict}
            className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]"
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL_CLASSES[share.tone]}`}
              >
                <span className="sr-only">Verdict: </span>
                {share.label}
              </span>
              <span className="text-xs text-muted tabular-nums">
                {share.pct}%
              </span>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
              {share.count}
            </p>
          </div>
        ))}
      </div>

      {/* Score-trend chart */}
      <section className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <h2 className="text-lg font-semibold text-navy">Score trend</h2>
        {scoreTrend.some((p) => p.averageScore !== null) ? (
          <div className="mt-4">
            <ScoreTrendChart
              scoreTrend={scoreTrend}
              granularity={analytics.granularity}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">
            No scored reviews yet to chart. Once reviews return an aggregate
            score, the trend will appear here.
          </p>
        )}
      </section>

      {/* Per-juror drill-down (Day 33): each lens's trend over time. */}
      <JurorBreakdown
        jurorTrends={jurorTrends}
        granularity={analytics.granularity}
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
        {value}
        {suffix && (
          <span className="ml-1 text-sm font-normal text-muted">{suffix}</span>
        )}
      </p>
    </div>
  );
}
