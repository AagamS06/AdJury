import { Skeleton } from "@/components/ui/skeleton";

/**
 * Dashboard loading state (DailyPlan Day 52). Rendered by Next.js while the
 * company-scoped metrics and recent-reviews reads resolve. Mirrors the page
 * header, the three metric tiles, and the recent-reviews card so the layout
 * doesn't jump when the real numbers arrive — matching the history and
 * analytics loading skeletons (Day 13 / Day 34).
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading your dashboard…</span>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Dashboard</h1>
          <p className="mt-2 max-w-2xl text-body">
            Here&apos;s a snapshot of your content reviews.
          </p>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-surface p-5 shadow-card"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-7 w-16" />
            <Skeleton className="mt-3 h-3 w-28" />
          </div>
        ))}
      </div>

      {/* Recent reviews card */}
      <section className="mt-8">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-4 h-40 w-full rounded-md" />
      </section>
    </div>
  );
}
