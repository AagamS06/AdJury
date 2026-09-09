import { Skeleton } from "@/components/ui/skeleton";

/**
 * History loading state (DailyPlan Day 13). Rendered by Next.js while the
 * Server Component's company-scoped review query resolves. Mirrors the page
 * header and the shape of the history table so the layout doesn't jump.
 */
export default function HistoryLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading your review history…</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Review history</h1>
          <p className="mt-2 max-w-2xl text-body">
            Every review your company has run, newest first. Select one to see
            the full scorecard.
          </p>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <div className="border-b border-border bg-canvas px-4 py-3">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-24" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
