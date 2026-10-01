import { Skeleton } from "@/components/ui/skeleton";

/**
 * Analytics loading state (DailyPlan Day 34 — analytics states). Rendered by
 * Next.js while the company-scoped analytics query resolves. Mirrors the page
 * header, the four summary tiles, and the score-trend card so the layout
 * doesn't jump when the real numbers arrive — matching the history and
 * review-detail loading skeletons (Day 13).
 */
export default function AnalyticsLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading your analytics…</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Analytics</h1>
          <p className="mt-2 max-w-2xl text-body">
            How your content is scoring over time, across every review your
            company has run.
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {/* Summary tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-4 h-7 w-16" />
            </div>
          ))}
        </div>

        {/* Score-trend card */}
        <section className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-64 w-full rounded-md" />
        </section>
      </div>
    </div>
  );
}
