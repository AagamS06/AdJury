import { Skeleton } from "@/components/ui/skeleton";

/**
 * Review detail loading state (DailyPlan Day 13). Rendered by Next.js while the
 * stored review is reconstructed from the DB. Mirrors the Scorecard shape — a
 * Navy header bar and a two-column grid of juror cards — so the page doesn't
 * jump when the real scorecard arrives.
 */
export default function ReviewDetailLoading() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading this review…</span>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-ink">Review</h1>
          <p className="mt-2 max-w-2xl text-body">
            The full scorecard for this review, reconstructed from your saved
            results.
          </p>
        </div>
      </div>

      <section className="mt-8 overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <header className="flex items-start justify-between gap-4 bg-navy px-6 py-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-28 bg-white/25" />
            <Skeleton className="h-8 w-24 bg-white/25" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full bg-white/25" />
        </header>
        <div className="grid gap-4 bg-canvas p-6 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-md border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-6 w-14" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
